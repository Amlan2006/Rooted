import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { cost, fileLedger, overBudget } from "../lib/analyst/budget";
import { addEvidence, citations, txLink, xrayLink } from "../lib/analyst/evidence";
import { EXECUTORS, TOOLS, toolParams } from "../lib/analyst/tools";
import { CAP, fit, trim } from "../lib/analyst/trim";
import type { Evidence } from "../lib/analyst/types";
import { POST } from "../app/api/analyst/route";

const hash = "0x" + "ab".repeat(32);
const spec = (name: string) => TOOLS.find(t => t.name === name)!.input;
const keys = (v: unknown): string[] => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);

test("tool schemas are strict, ordered and leave unsupported constraints to zod", () => {
  const params = toolParams(TOOLS);
  assert.deepEqual(params.map(p => p.name), ["recent_blocks", "xray_summary", "uniswap_contention", "get_block_xray", "run_block_xray", "epbs_slot", "builders", "alerts", "frame_status", "frame_conformance", "frame_transactions", "compare_providers", "node_read", "buy_xray_report"]);
  for (const p of params) {
    assert.equal(p.strict, true);
    assert.equal(p.input_schema.additionalProperties, false);
    for (const k of ["pattern", "minimum", "maximum", "maxItems", "$schema"]) assert.ok(!keys(p.input_schema).includes(k), `${p.name} sends ${k}`);
  }
  assert.deepEqual(JSON.stringify(toolParams(TOOLS)), JSON.stringify(params), "deterministic, so the prefix caches");
  assert.deepEqual(TOOLS.filter(t => t.action).map(t => t.name), ["run_block_xray", "compare_providers", "buy_xray_report"]);

  assert.deepEqual(spec("get_block_xray").parse({ block_hash: " 0x" + "AB".repeat(32) }), { block_hash: hash });
  for (const bad of [{ block_hash: "0x12" }, { block_hash: hash, more: 1 }, {}]) assert.equal(spec("get_block_xray").safeParse(bad).success, false);
  for (const limit of [0, 51, 2.5]) assert.equal(spec("recent_blocks").safeParse({ limit }).success, false);
  assert.equal(spec("frame_transactions").safeParse({ limit: 26 }).success, false);
  assert.equal(spec("xray_summary").safeParse({ x: 1 }).success, false);
  const rpc = spec("node_read");
  for (const ok of [{ method: "eth_blockNumber", params: [] }, { method: "eth_getBlockByNumber", params: ["0xb8466b"] }, { method: "eth_getBlockByNumber", params: ["finalized"] }, { method: "eth_getBlockByNumber", params: ["12076467"] }, { method: "eth_getTransactionReceipt", params: [hash] }])
    assert.equal(rpc.safeParse(ok).success, true, JSON.stringify(ok));
  for (const bad of [{ method: "eth_blockNumber", params: ["x"] }, { method: "eth_getBlockByNumber", params: ["pending"] }, { method: "eth_getTransactionByHash", params: [] }, { method: "eth_call", params: [] }, { method: "eth_getBlockByNumber", params: ["latest", "true"] }])
    assert.equal(rpc.safeParse(bad).success, false, JSON.stringify(bad));
});

test("trimming keeps the decision fields of a real X-ray, is deterministic and stays under the cap", async () => {
  const report = JSON.parse(await readFile("public/examples/xray-report.json", "utf8"));
  const a = trim("get_block_xray", report) as Record<string, any>;
  assert.equal(JSON.stringify(a), JSON.stringify(trim("run_block_xray", structuredClone(report))));
  assert.ok(JSON.stringify(a).length <= CAP);
  assert.equal(a.block.number, 12076166);
  assert.equal(a.commitment_verified, true);
  assert.equal(a.ceilings.validator_bal_time.capping_tx_index, 85);
  assert.deepEqual(a.capping_txs.map((t: { index: number }) => t.index), [1, 34, 85]);
  assert.equal(a.critical_path.length, a.ceilings.builder_dag_time.critical_path_length);
  assert.ok(a.hot_locations.length <= 10 && a.hot_locations.every((h: { edges: number }, i: number, all: { edges: number }[]) => !i || all[i - 1].edges >= h.edges));
  assert.ok(Array.isArray(a.coverage) && a.epbs && a.speedup);
  assert.equal(a.transactions, undefined, "the per-tx table stays out");

  const briefs = { data: Array.from({ length: 50 }, (_, i) => ({ block_number: 1000 - i, block_hash: "0x" + i.toString(16).padStart(64, "0"), transaction_count: 100, gas_weighted: 3.14159265, validator_bal_time: i === 1 ? null : 12.5, builder_dag_time: 4.25, gas_capping_tx_index: 3, validator_capping_tx_index: 7, gas_misidentifies_bottleneck: true, header_gas_used: 1, extra: "dropped" })) };
  const list = trim("recent_blocks", briefs) as { columns: string[]; rows: unknown[][] };
  assert.ok(JSON.stringify(list).length <= 2 * CAP);
  assert.equal(list.rows.length, 50, "all 50 requested blocks survive");
  assert.deepEqual(list.columns, ["block_number", "block_hash", "slot", "transaction_count", "commitment_verified", "gas_weighted", "execution_gas_weighted", "validator_bal_time", "builder_multiversion_time", "builder_dag_time", "gas_capping_tx_index", "validator_capping_tx_index", "gas_misidentifies_bottleneck", "builder_critical_path_length", "gas_to_validator_ratio"]);
  assert.deepEqual(list.rows[0], [1000, briefs.data[0].block_hash, null, 100, null, 3.142, null, 12.5, null, 4.25, 3, 7, true, null, 0.251]);
  assert.equal(list.rows[1].at(-1), null, "no validator ceiling, no ratio");

  const flat = { blob: "x".repeat(10000), ...Object.fromEntries(Array.from({ length: 400 }, (_, i) => ["k" + i, "v".repeat(30)])) };
  assert.ok(JSON.stringify(fit(flat)).length <= CAP, "objects without arrays fall back to a cut string");
  const nested = { a: Array.from({ length: 300 }, (_, i) => ({ i, b: [i, i, i] })), small: [1, 2] };
  const n = fit(nested) as { a: unknown[]; small: number[] };
  assert.ok(JSON.stringify(n).length <= CAP);
  assert.deepEqual(n.small, [1, 2], "the largest array shrinks first");
  assert.equal(JSON.stringify(fit({ tiny: [1.23456] })), '{"tiny":[1.235]}');
});

test("evidence ids, hashes, links and citation parsing", () => {
  const list: Evidence[] = [], at = new Date("2026-11-06T10:00:00Z");
  const e1 = addEvidence(list, { kind: "xray", label: "X-ray", link: xrayLink(hash), raw: "abc" }, at);
  const e2 = addEvidence(list, { kind: "rpc", label: "head", raw: "" }, at);
  assert.deepEqual(e1, { id: "E1", kind: "xray", label: "X-ray", link: `/?view=xray&block=${hash}`, sha256: createHash("sha256").update("abc").digest("hex"), at: "2026-11-06T10:00:00.000Z" });
  assert.equal(e2.id, "E2");
  assert.equal("link" in e2, false);
  assert.equal(txLink(hash), `https://sepolia.etherscan.io/tx/${hash}`);
  assert.deepEqual(citations("a [E3] b [E1][E3] c [E2, E10] d [E] e E4 [e5]"), ["E3", "E1", "E2", "E10"]);
});

test("budget: Opus 5.5 prices, a persistent daily ledger and the cap", async () => {
  assert.equal(cost({ input: 1e6, output: 0, cache_read: 0, cache_write: 0 }), 4);
  assert.equal(cost({ input: 0, output: 1e6, cache_read: 1e6, cache_write: 1e6 }), 25.2);
  const dir = await mkdtemp(path.join(tmpdir(), "analyst-ledger-"));
  try {
    const file = path.join(dir, "nested", "usage.jsonl"), ledger = fileLedger(file);
    assert.equal(await ledger.spent("2026-11-06"), 0, "no ledger yet is zero spend");
    const row = { input: 1, output: 1, cache_read: 0, cache_write: 0, mode: "investigate" as const };
    await ledger.add({ ...row, at: "2026-11-05T23:59:59.000Z", usd: 50 });
    await ledger.add({ ...row, at: "2026-11-06T08:00:00.000Z", usd: 12.5 });
    await writeFile(file, (await readFile(file, "utf8")) + '{"at":"2026-11-06T09', { flag: "w" });
    await ledger.add({ ...row, at: "2026-11-06T09:00:00.000Z", usd: 7.5 });
    assert.equal(await fileLedger(file).spent("2026-11-06"), 12.5, "a torn line is skipped; a new instance reads the same file");
    assert.equal(await overBudget(ledger, new Date("2026-11-06T12:00:00Z")), false);
    process.env.ROOTED_ANALYST_DAILY_USD = "12.5";
    assert.equal(await overBudget(ledger, new Date("2026-11-06T12:00:00Z")), true);
    assert.equal(await overBudget(ledger, new Date("2026-11-07T00:00:00Z")), false, "the cap resets at 00:00 UTC");
  } finally {
    delete process.env.ROOTED_ANALYST_DAILY_USD;
    await rm(dir, { recursive: true, force: true });
  }
});

test("executors call the fixed backend and node routes and label their evidence", async (t) => {
  const seen: { url: string; body?: string }[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    seen.push({ url: String(url), body: init.body as string | undefined });
    if (String(url).includes("/xray/blocks/")) return Response.json({ error: { code: "not_found", message: "no stored X-ray; POST to compute" } }, { status: 404 });
    if (String(url).includes("/xray/blocks")) return Response.json({ data: [{ block_number: 1 }] });
    if (String(url).includes("/payloadwatch/")) return Response.json({ data: [] });
    return Response.json({ jsonrpc: "2.0", id: 1, result: { number: "0x1", transactions: [] } });
  });
  process.env.ROOTED_EXECUTION_URL = "http://127.0.0.1:18545";
  try {
    const blocks = await EXECUTORS.recent_blocks({ limit: 5 } as never);
    assert.equal(seen[0].url, "http://127.0.0.1:8080/api/v1/xray/blocks?network=sepolia&limit=5");
    assert.deepEqual([blocks.kind, blocks.label, blocks.raw], ["blocks", "X-ray briefs of the 1 newest blocks", '{"data":[{"block_number":1}]}']);
    await assert.rejects(EXECUTORS.get_block_xray({ block_hash: hash } as never), /run_block_xray can compute one/);
    const slot = await EXECUTORS.epbs_slot({ slot: 42 } as never);
    assert.deepEqual(seen.slice(2).map(s => s.url), ["http://127.0.0.1:8080/api/v1/payloadwatch/slots/42?network=sepolia", "http://127.0.0.1:8080/api/v1/payloadwatch/slots/42/timeline?network=sepolia"]);
    assert.equal(slot.raw, '{"slot":{"data":[]},"timeline":{"data":[]}}');
    const head = await EXECUTORS.node_read({ method: "eth_getBlockByNumber", params: ["latest"] } as never);
    assert.equal(seen.at(-1)!.url, "http://127.0.0.1:18545/");
    assert.deepEqual(JSON.parse(seen.at(-1)!.body!), { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] });
    assert.deepEqual([head.kind, head.label, head.link], ["rpc", "eth_getBlockByNumber latest", undefined]);
    await EXECUTORS.node_read({ method: "eth_getBlockByNumber", params: ["12076467"] } as never);
    assert.deepEqual(JSON.parse(seen.at(-1)!.body!).params, ["0xb845b3", false]);
    const tx = await EXECUTORS.node_read({ method: "eth_getTransactionReceipt", params: [hash] } as never);
    assert.equal(tx.link, `https://sepolia.etherscan.io/tx/${hash}`);
  } finally { delete process.env.ROOTED_EXECUTION_URL; }
});

test("uniswap_contention: strict limit, the scan route, and an X-ray link on every block under the cap", async (t) => {
  const s = spec("uniswap_contention");
  assert.deepEqual(s.parse({ limit: 5 }), { limit: 5 });
  for (const bad of [{ limit: 0 }, { limit: 21 }, { limit: 2.5 }, {}, { limit: 5, pool: "x" }]) assert.equal(s.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(TOOLS.find(t => t.name === "uniswap_contention")!.action, false);

  // Shaped like block 12,076,476's stored report: one verified v3 pool, 87 of 2,751 edges.
  const pool = { protocol: "uniswap_v3", pool: "0x3289680dd4d6c10bb19b899729cda5eef58aeff1", verified: true, edges: 87, on_critical_path: false, labels: ["token_balance_of_pool", "pool_slot0", "fee_growth_global0", "liquidity", "pool_mapping_or_observation"] };
  const block = (i: number) => ({ block_number: 12076476 - i, block_hash: "0x" + i.toString(16).padStart(64, "0"), uniswap_edges: 87, total_edges: 2751, unlisted_uniswap_edges: 0, critical_path_length: 9, critical_path_uniswap_locations: 0, pools: [pool] });
  const body = (n: number, pools = 1) => ({ data: { reports_scanned: 308, blocks_with_uniswap_edges: n, blocks: Array.from({ length: n }, (_, i) => ({ ...block(i), pools: Array(pools).fill(pool) })) } });
  t.mock.method(globalThis, "fetch", async (url: URL) => { assert.equal(String(url), "http://127.0.0.1:8080/api/v1/xray/uniswap?network=sepolia&limit=7"); return Response.json(body(7)); });
  const out = await EXECUTORS.uniswap_contention({ limit: 7 } as never);
  assert.deepEqual([out.kind, out.label, out.link], ["uniswap", "Uniswap contention in 7 of 308 stored X-rays", "/?view=xray"]);

  const few = trim("uniswap_contention", out.data) as { reports_scanned: number; blocks: Record<string, unknown>[] };
  assert.equal(few.reports_scanned, 308);
  assert.deepEqual(few.blocks, body(7).data.blocks.map(b => ({ ...b, link: xrayLink(b.block_hash) })), "nothing dropped, one X-ray link per block");
  assert.equal((trim("uniswap_contention", body(20)) as { blocks: unknown[] }).blocks.length, 20, "the 20-block maximum fits with one pool each");
  const many = trim("uniswap_contention", body(20, 3));
  assert.ok(JSON.stringify(many).length <= 2 * CAP);
  assert.equal(JSON.stringify(many), JSON.stringify(trim("uniswap_contention", body(20, 3))));
  const kept = (many as { blocks: unknown[] }).blocks;
  assert.match(String(kept.at(-1)), /^… \d+ more omitted$/, "the oldest blocks go first");
  for (const b of kept.slice(0, -1) as { block_hash: string; link: string }[]) assert.equal(b.link, xrayLink(b.block_hash));
});

const ask = (body: unknown, headers: Record<string, string> = {}) => POST(new Request("http://localhost:3000/api/analyst", {
  method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(body),
}));

test("the route is disabled without a key and in hosted mode, and checks origin and body", async () => {
  const event = async (r: Response) => { assert.equal(r.headers.get("content-type"), "text/event-stream; charset=utf-8"); return JSON.parse((await r.text()).slice(6)); };
  const saved = { key: process.env.ANTHROPIC_API_KEY, hosted: process.env.ROOTED_HOSTED, pub: process.env.ROOTED_ANALYST_PUBLIC };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    let r = await ask({ question: "hi" });
    assert.equal(r.status, 503);
    assert.equal((await event(r)).code, "disabled");
    process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
    process.env.ROOTED_HOSTED = "1";
    r = await ask({ question: "hi" });
    assert.equal(r.status, 403);
    const hostedOff = await event(r);
    assert.equal(hostedOff.code, "disabled");
    assert.doesNotMatch(JSON.stringify(hostedOff), /sk-test/);
    process.env.ROOTED_ANALYST_PUBLIC = "true";
    r = await ask({ question: "hi" }, { origin: "https://evil.example" });
    assert.equal(r.status, 403, "public hosted mode passes the switch and still checks origin");
    delete process.env.ROOTED_HOSTED;
    for (const [body, status] of [[{ question: "" }, 400], [{ question: "x".repeat(2001) }, 400], [{ question: "hi", history: [] }, 400], [{ question: "hi", session_id: "nope" }, 400], [{ question: "x".repeat(9000) }, 413]] as const) {
      r = await ask(body);
      assert.equal(r.status, status, JSON.stringify(body).slice(0, 40));
      assert.equal((await event(r)).code, "bad_request");
    }
    r = await ask({ question: "hi" }, { "content-type": "text/plain" });
    assert.equal(r.status, 415);
  } finally {
    for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["ROOTED_HOSTED", saved.hosted], ["ROOTED_ANALYST_PUBLIC", saved.pub]] as const)
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("one investigation at a time: a concurrent request gets 429, a cancelled one frees the slot", async () => {
  let reached!: () => void;
  const upstream = new Promise<void>(resolve => (reached = resolve));
  const server = createServer(() => reached()); // a Claude API that never answers
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const keys = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ROOTED_HOSTED", "ROOTED_X402_ENABLED", "ROOTED_ANALYST_DAILY_USD"] as const;
  const saved = keys.map(k => process.env[k]);
  Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-test-not-a-real-key", ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`, ROOTED_ANALYST_DAILY_USD: "1000000" });
  for (const k of keys.slice(2, 5)) delete process.env[k];
  try {
    const both = await Promise.all([ask({ question: "a" }), ask({ question: "b" })]);
    assert.deepEqual(both.map(r => r.status).sort(), [200, 429], "the second request loses even when both arrive together");
    const [running, busy] = both[0].status === 200 ? both : [both[1], both[0]];
    assert.match(await busy.text(), /Another investigation is running/);
    await upstream;
    await running.body!.cancel();
    let next = await ask({ question: "c" });
    for (let i = 0; next.status === 429 && i < 100; i++) { await sleep(20); next = await ask({ question: "c" }); }
    assert.equal(next.status, 200, "cancelling the first investigation releases the slot");
    await next.body!.cancel();
  } finally {
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
    server.closeAllConnections();
    server.close();
  }
});
