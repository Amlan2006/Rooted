// Analyst tools: one zod schema per tool (validated again before every run) and an executor that reads Rooted's
// backend, the execution node or the x402 agent. The JSON schemas sent to Claude are derived once, in a fixed order.
import { execFile } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { backendURL } from "@/lib/proxy";
import { txLink, xrayLink } from "./evidence";
import type { Executor, ToolOutput, ToolSpec } from "./types";

const hash = z.string().trim().toLowerCase().regex(/^0x[0-9a-f]{64}$/, "expected a 0x-prefixed 32-byte hex hash");
const blockHash = z.strictObject({ block_hash: hash.describe("Sepolia execution block hash, 0x + 64 hex") });
const none = z.strictObject({});
const rpcMethods = ["eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt"] as const;

export const TOOLS: ToolSpec[] = [
  { name: "recent_blocks", action: false, input: z.strictObject({ limit: z.number().int().min(1).max(50).describe("How many of the newest blocks") }),
    description: "Lists the newest blocks Rooted has X-rayed (number, hash, slot, tx count, BAL commitment check, the gas, execution-gas, validator-with-BAL and builder ceilings, the gas and validator capping txs, whether gas misidentifies the bottleneck, and the gas / validator ceiling ratio). Call this first to find recent blocks, block hashes, or blocks that match a pattern." },
  { name: "xray_summary", action: false, input: none,
    description: "Distribution of the ceilings over all stored X-rays (p10, median, p90), the share of blocks bound by a single transaction, how often gas picks the wrong bottleneck, and the BAL commitment success rate. Call this for questions about typical blocks or trends." },
  { name: "uniswap_contention", action: false, input: z.strictObject({ limit: z.number().int().min(1).max(20).describe("How many of the newest blocks with Uniswap contention") }),
    description: "Scans every stored X-ray, not just the newest blocks, and lists the blocks whose conflict edges touch Uniswap-labelled state, newest first: Uniswap edges against all edges, the pools involved (v3 pool address or v4 poolId, with label names such as pool_slot0 or token_balance_of_pool) and whether a pool has an edge on the builder critical path. Pools come from each report's stored hot locations; unlisted_uniswap_edges are labelled edges on locations a report did not keep. Reports do not store which locations each transaction touched, so the number of critical-path transactions that touch Uniswap state is unavailable; critical_path_uniswap_locations (labelled locations with an edge on the critical path) stands in for it. Call this first for any Uniswap or pool contention question." },
  { name: "get_block_xray", action: false, input: blockHash,
    description: "The stored X-ray of one block: ceilings with their capping transactions, the builder critical path, speedup by core count, conflict edges, top hot storage locations with Uniswap labels, ePBS delivery for its slot, replay coverage and the BAL commitment check. Call this before reasoning about a specific block. If none is stored, it says so." },
  { name: "run_block_xray", action: true, input: blockHash,
    description: "Action: replays one block natively on the Sepolia node and stores a new X-ray (up to 85 s). Only blocks within about 128 blocks of the head can be replayed. Call this only when get_block_xray has nothing stored for a block the question needs." },
  { name: "epbs_slot", action: false, input: z.strictObject({ slot: z.number().int().min(0).describe("Beacon slot number") }),
    description: "PayloadWatch's stored ePBS observations for one slot (builder, self-build, payload status, reveal latency, PTC votes) and its event timeline. Call this for questions about payload delivery or timeliness in a slot; slots of recent blocks come from recent_blocks." },
  { name: "builders", action: false, input: none,
    description: "Per-builder ePBS delivery statistics over the last hour of observed commitments. Call this for questions about builder behaviour or delivery rates." },
  { name: "alerts", action: false, input: none,
    description: "Recent PayloadWatch alerts (late, missing or mismatched payloads). Call this when checking whether ePBS delivery has gone wrong recently." },
  { name: "frame_status", action: false, input: none,
    description: "The frame-transaction alt mempool node's status (chain identity, sync and stream state) and its recorded incidents. Call this for questions about the frame mempool's health." },
  { name: "frame_conformance", action: false, input: none,
    description: "Results of Rooted's frame-transaction conformance cases against the frame node. Call this for questions about whether frame transactions behave as specified." },
  { name: "frame_transactions", action: false, input: z.strictObject({ limit: z.number().int().min(1).max(25).describe("How many of the newest frame transactions") }),
    description: "The newest frame transactions Rooted observed and their lifecycle state. Call this for questions about recent frame-transaction activity." },
  { name: "compare_providers", action: true, input: blockHash,
    description: "Action: fetches one block from each configured provider and compares what they return (up to 75 s). Call this only when the question is about provider agreement for a block." },
  { name: "node_read", action: false,
    input: z.strictObject({
      method: z.enum(rpcMethods),
      params: z.array(z.string()).max(1).describe("eth_blockNumber: []. eth_getBlockByNumber: [block number in decimal digits such as 12076467, or latest, safe or finalized]. eth_getTransactionByHash and eth_getTransactionReceipt: [0x transaction hash]."),
    }).superRefine((v, ctx) => {
      const p = v.params[0];
      const ok = v.method === "eth_blockNumber" ? v.params.length === 0
        : v.method === "eth_getBlockByNumber" ? typeof p === "string" && /^(0x[0-9a-f]+|\d{1,15}|latest|safe|finalized)$/.test(p)
          : typeof p === "string" && /^0x[0-9a-f]{64}$/.test(p.toLowerCase());
      if (!ok) ctx.addIssue({ code: "custom", path: ["params"], message: `params do not match ${v.method}` });
    }),
    description: "One read-only JSON-RPC call to the Sepolia execution node: the head block number, a block header by number (transaction hashes only), a transaction, or a receipt. Call this to turn a block number into a hash, or to check a transaction." },
  { name: "buy_xray_report", action: true, payment: true, input: blockHash,
    description: "Action and payment: buys the full X-ray report for one block over x402, settled on Hedera testnet, within the agent's spend limits. Returns the Hedera transaction id, the HashScan link and a one-line finding. Call this only when the user asks to buy a report." },
];

// Strict JSON schemas: constraints the API does not enforce (ranges, patterns, enums) move into the descriptions,
// and zod checks them before the executor runs.
export const toolParams = (specs: ToolSpec[]): BetaTool[] => specs.map(spec => {
  const { $schema: _, ...schema } = z.toJSONSchema(spec.input) as Record<string, unknown>;
  return { name: spec.name, description: spec.description, input_schema: transformJSONSchema(schema) as BetaTool.InputSchema, strict: true };
});

const short = (h: string) => `${h.slice(0, 10)}…`;
const origin = () => backendURL(["health"], "", process.env.ROOTED_BACKEND_URL || "http://127.0.0.1:8080").origin;
const scope = { sepolia: "network=sepolia", frames: "network=frame-devnet&mode=live" };

async function backend(route: string, signal: AbortSignal | undefined, post?: { body: string; ms: number }) {
  const response = await fetch(new URL(route, origin()), {
    method: post ? "POST" : "GET", headers: post ? { "Content-Type": "application/json" } : {}, body: post?.body,
    cache: "no-store", redirect: "error",
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(post?.ms ?? 20000)]),
  });
  const raw = await response.text();
  if (!response.ok) {
    let message = raw.slice(0, 300);
    try { message = JSON.parse(raw).error?.message ?? message; } catch { /* not JSON */ }
    throw Object.assign(new Error(`HTTP ${response.status}: ${message}`), { status: response.status });
  }
  return { raw, data: JSON.parse(raw) as Record<string, unknown> };
}
// Two reads become one piece of evidence; the raw bodies are kept byte for byte inside the hashed envelope.
async function pair(a: string, b: string, keys: [string, string], signal?: AbortSignal) {
  const [x, y] = await Promise.all([backend(a, signal), backend(b, signal)]);
  return { raw: `{"${keys[0]}":${x.raw},"${keys[1]}":${y.raw}}`, data: { [keys[0]]: x.data, [keys[1]]: y.data } };
}
const count = (data: Record<string, unknown>) => (Array.isArray(data.data) ? data.data.length : 0);

async function xrayRead({ block_hash }: { block_hash: string }, signal?: AbortSignal): Promise<ToolOutput> {
  try {
    const r = await backend(`/api/v1/xray/blocks/${block_hash}?${scope.sepolia}`, signal);
    const number = (r.data.data as { block?: { number?: number } })?.block?.number;
    return { kind: "xray", label: `X-ray of block ${number ?? short(block_hash)}`, link: xrayLink(block_hash), ...r };
  } catch (error) {
    if ((error as { status?: number }).status === 404)
      throw new Error("No stored X-ray for this block. run_block_xray can compute one if the block is within about 128 blocks of the head.");
    throw error;
  }
}

export const EXECUTORS: Record<string, Executor> = {
  async recent_blocks({ limit }: { limit: number }, signal) {
    const r = await backend(`/api/v1/xray/blocks?${scope.sepolia}&limit=${limit}`, signal);
    return { kind: "blocks", label: `X-ray briefs of the ${count(r.data)} newest blocks`, link: "/?view=xray", ...r };
  },
  async xray_summary(_: object, signal) {
    const r = await backend(`/api/v1/xray/summary?${scope.sepolia}`, signal);
    const s = r.data.data as { blocks?: number; from_block?: number; to_block?: number };
    return { kind: "summary", label: `X-ray summary of ${s?.blocks ?? 0} blocks (${s?.from_block ?? "?"}–${s?.to_block ?? "?"})`, link: "/?view=xray", ...r };
  },
  async uniswap_contention({ limit }: { limit: number }, signal) {
    const r = await backend(`/api/v1/xray/uniswap?${scope.sepolia}&limit=${limit}`, signal);
    const d = r.data.data as { reports_scanned?: number; blocks_with_uniswap_edges?: number };
    return { kind: "uniswap", label: `Uniswap contention in ${d?.blocks_with_uniswap_edges ?? 0} of ${d?.reports_scanned ?? 0} stored X-rays`, link: "/?view=xray", ...r };
  },
  get_block_xray: xrayRead,
  async run_block_xray({ block_hash }: { block_hash: string }, signal) {
    try {
      const r = await backend(`/api/v1/xray/blocks/${block_hash}?${scope.sepolia}`, signal, { body: "{}", ms: 90000 });
      const number = (r.data.data as { block?: { number?: number } })?.block?.number;
      return { kind: "xray_run", label: `New X-ray run of block ${number ?? short(block_hash)}`, link: xrayLink(block_hash), ...r };
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 422) throw new Error(`The node cannot replay this block (outside its ~128-block state window, or unavailable): ${(error as Error).message}`);
      if (status === 429) throw new Error("Another native replay is running. Retry later or use stored evidence.");
      throw error;
    }
  },
  async epbs_slot({ slot }: { slot: number }, signal) {
    const r = await pair(`/api/v1/payloadwatch/slots/${slot}?${scope.sepolia}`, `/api/v1/payloadwatch/slots/${slot}/timeline?${scope.sepolia}`, ["slot", "timeline"], signal);
    return { kind: "epbs_slot", label: `ePBS observations for slot ${slot}`, link: "/?view=payloadwatch", ...r };
  },
  async builders(_: object, signal) {
    const r = await backend(`/api/v1/builders?${scope.sepolia}`, signal);
    return { kind: "builders", label: `Builder delivery stats, last hour (${count(r.data)} builders)`, link: "/?view=builders", ...r };
  },
  async alerts(_: object, signal) {
    const r = await backend(`/api/v1/alerts?${scope.sepolia}`, signal);
    return { kind: "alerts", label: `PayloadWatch alerts (${count(r.data)})`, link: "/?view=payloadwatch", ...r };
  },
  async frame_status(_: object, signal) {
    const r = await pair(`/api/v1/frames/node?${scope.frames}`, `/api/v1/frames/incidents?${scope.frames}`, ["node", "incidents"], signal);
    return { kind: "frame_node", label: "Frame mempool node status and incidents", link: "/?view=frames", ...r };
  },
  async frame_conformance(_: object, signal) {
    const r = await backend(`/api/v1/frames/conformance?${scope.frames}`, signal);
    return { kind: "frame_conformance", label: "Frame-transaction conformance results", link: "/?view=frames", ...r };
  },
  async frame_transactions({ limit }: { limit: number }, signal) {
    const r = await backend(`/api/v1/frames/transactions?${scope.frames}&limit=${limit}`, signal);
    return { kind: "frame_txs", label: `${count(r.data)} newest frame transactions`, link: "/?view=frames", ...r };
  },
  async compare_providers({ block_hash }: { block_hash: string }, signal) {
    const r = await backend(`/api/v1/providers/compare?${scope.sepolia}`, signal, { body: JSON.stringify({ block_hash }), ms: 85000 });
    return { kind: "provider_compare", label: `Provider comparison for block ${short(block_hash)}`, link: "/?view=providers", ...r };
  },
  async node_read({ method, params }: { method: (typeof rpcMethods)[number]; params: string[] }, signal) {
    const url = new URL(process.env.ROOTED_EXECUTION_URL || "https://ethereum-sepolia-rpc.publicnode.com");
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("The execution node URL is not HTTP.");
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", redirect: "error",
      // Decimal block numbers are converted here: the model's own hex conversion picked the wrong block in a live run.
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: method === "eth_getBlockByNumber" ? [/^\d+$/.test(params[0]) ? "0x" + Number(params[0]).toString(16) : params[0], false] : params }),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]),
    });
    const raw = await response.text(); // never echo the URL: it can carry a provider key
    if (!response.ok) throw new Error(`Execution node returned HTTP ${response.status}.`);
    const body = JSON.parse(raw) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(`Execution node error: ${body.error.message ?? "unknown"}`);
    const subject = params[0] ?? "";
    return { kind: "rpc", label: `${method}${subject ? " " + (subject.length > 20 ? short(subject) : subject) : ""}${body.result == null ? " (not found)" : ""}`,
      link: method.includes("Transaction") ? txLink(subject.toLowerCase()) : undefined, raw, data: body.result ?? null };
  },
  // Same approach as integrations/x402-agent/mcp.mjs: run agent.mjs unchanged, so its spend controls decide.
  async buy_xray_report({ block_hash }: { block_hash: string }) {
    if (process.env.ROOTED_ANALYST_PAYMENTS !== "true") throw new Error("payments are off (ROOTED_ANALYST_PAYMENTS is not true)");
    const agent = path.resolve(process.cwd(), "..", "integrations", "x402-agent", "agent.mjs");
    // No abort signal: killing agent.mjs mid-settlement could lose the record of a payment that still lands.
    const stdout = await new Promise<string>((resolve, reject) => execFile(process.execPath, [agent, block_hash], { timeout: 180000, env: { ...process.env, ANTHROPIC_API_KEY: undefined } }, (error, out, err) => {
      if (!error) return resolve(out);
      const code = typeof error.code === "number" ? error.code : 1;
      const why = ({ 2: "configuration", 3: "refused by spend controls" } as Record<number, string>)[code] ?? "error";
      reject(new Error(`${why} (exit ${code}): ${(out + err).trim().slice(0, 2000)}`));
    }));
    const link = stdout.match(/https:\/\/hashscan\.io\/testnet\/transaction\/\S+/)?.[0];
    return { kind: "payment", label: `x402 payment for the X-ray report of block ${short(block_hash)}`, link, raw: stdout, data: stdout.trim() };
  },
};
