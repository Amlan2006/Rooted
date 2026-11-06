#!/usr/bin/env node
// MCP server (stdio, JSON-RPC 2.0, no SDK) that lets an LLM agent browse free X-ray briefs and buy a full report over
// x402. Buying runs agent.mjs unchanged, so its spend controls decide; nobody approves the payment by hand.
// Claude Code: claude mcp add rooted-x402 -- node integrations/x402-agent/mcp.mjs
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

const envFile = new URL(".env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const base = () => new URL(process.env.ROOTED_PUBLIC_URL || "http://127.0.0.1:3000");
const hashSchema = { type: "string", pattern: "^0x[0-9a-f]{64}$", description: "Lowercase 0x-prefixed 32-byte Sepolia execution block hash" };
const tools = [
  { name: "recent_xray_blocks", description: "Free. Lists the newest stored Glamsterdam X-ray briefs (per Sepolia block: receipt-gas, execution-gas, validator-with-BAL and builder/no-BAL parallelism ceilings, all upper bounds).",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 30 } } } },
  { name: "buy_xray_report", description: "Paid. Buys the full X-ray report for one block over x402 on Hedera testnet (default price 0.01 HBAR). The agent's spend controls (per-request cap, daily budget, trusted payTo, allowed asset) may refuse. Returns the settled Hedera transaction id, the HashScan link and a one-line finding.",
    inputSchema: { type: "object", properties: { block_hash: hashSchema }, required: ["block_hash"] } },
];
const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], isError });

async function call(name, args = {}) {
  if (name === "recent_xray_blocks") {
    const limit = Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 30 ? args.limit : 10;
    const r = await fetch(new URL(`/api/backend/api/v1/xray/blocks?network=sepolia&limit=${limit}`, base()), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return text(`brief list unavailable: HTTP ${r.status}`, true);
    const keep = ["block_number", "block_hash", "transaction_count", "gas_weighted", "execution_gas_weighted", "validator_bal_time", "builder_dag_time", "validator_capping_tx_index", "builder_critical_path_length"];
    return text(JSON.stringify(((await r.json()).data ?? []).map((b) => Object.fromEntries(keep.map((k) => [k, b[k] ?? null])))));
  }
  if (name === "buy_xray_report") {
    if (typeof args.block_hash !== "string" || !/^0x[0-9a-f]{64}$/.test(args.block_hash)) return text("block_hash must be a lowercase 0x-prefixed 32-byte hash", true);
    return new Promise((resolve) => execFile(process.execPath, [new URL("agent.mjs", import.meta.url).pathname, args.block_hash], { timeout: 180000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      const why = { 1: "error", 2: "configuration", 3: "refused by spend controls" }[code] ?? "error";
      resolve(code === 0 ? text(stdout.trim()) : text(`${why} (exit ${code}): ${(stdout + stderr).trim().slice(0, 2000)}`, true));
    }));
  }
  return null;
}

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: "parse error" } }); }
  if (m.id === undefined) return; // notifications (e.g. notifications/initialized) need no answer
  try {
    if (m.method === "initialize") return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "rooted-x402", version: "0.1.0" } } });
    if (m.method === "ping") return send({ id: m.id, result: {} });
    if (m.method === "tools/list") return send({ id: m.id, result: { tools } });
    if (m.method === "tools/call") {
      const result = await call(m.params?.name, m.params?.arguments);
      return send(result ? { id: m.id, result } : { id: m.id, error: { code: -32602, message: `unknown tool ${m.params?.name}` } });
    }
    send({ id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
  } catch (e) { send({ id: m.id, result: text(`failed: ${e.message}`, true) }); }
});
