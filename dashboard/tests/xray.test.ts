import { test } from "node:test";
import assert from "node:assert/strict";
import { blockHashRequest, formatPrice, formatX, laneRows, parseBriefs, parseReport, parseSummary, paymentTerms, speedupSeries, type Report } from "../lib/xray";
import { POST } from "../app/api/xray/route";

const h = (c: string) => "0x" + c.repeat(64);
// Synthetic 3-tx block worked by hand from spec §1: t=[100,300,200] ns, g=[21000,50000,30000], tx2 depends on 0 and 1.
// gas = 101000/50000 = 2.02; validator = 600/300 = 2; builder dp = [100,300,500] -> 600/500 = 1.2, path [1,2].
const fixture = (): Report => ({
  schema: "rooted-xray-v1", network: "sepolia", computed_at: "2026-11-06T09:30:00Z", source: "capture", profile_id: null,
  block: { number: 1, hash: h("a"), parent_hash: h("b"), timestamp: 1, slot: 2, beacon_block_root: h("c"), parent_beacon_block_root: h("d"), fee_recipient: "0x" + "e".repeat(40), gas_limit: 60000000, transaction_count: 3 },
  gas: { header_gas_used: 101000, receipts_gas_sum: 101000, differs: false },
  bal: { commitment: h("f"), computed_commitment: h("f"), commitment_verified: true, accounts: 4, source: "beacon_payload_envelope", schema: "eip-7928-rlp-index-value-v1" },
  transactions: [
    { index: 0, hash: h("1"), from: "0x" + "1".repeat(40), to: "0x" + "2".repeat(40), is_create: false, status: 1, gas_used: 21000, apply_ns_median: 100, reads: 3, writes: 2, depends_on: [] },
    { index: 1, hash: h("2"), from: "0x" + "3".repeat(40), to: null, is_create: true, status: 1, gas_used: 50000, apply_ns_median: 300, reads: 2, writes: 3, depends_on: [] },
    { index: 2, hash: h("3"), from: "0x" + "1".repeat(40), to: "0x" + "2".repeat(40), is_create: false, status: 1, gas_used: 30000, apply_ns_median: 200, reads: 4, writes: 2, depends_on: [0, 1] },
  ],
  edges: { RAW: 2, WAR: 0, WAW: 1, total: 3, dependent_pairs: 2, truncated: false },
  independent_transactions: 2,
  ceilings: {
    gas_weighted: { model: "validator_bal", weight: "gas", value: 2.02, total: 101000, bottleneck: 50000, capping_tx_index: 1 },
    validator_bal_time: { model: "validator_bal", weight: "ns", value: 2, total: 600, bottleneck: 300, capping_tx_index: 1 },
    builder_dag_time: { model: "builder_dag", weight: "ns", value: 1.2, total: 600, bottleneck: 500, capping_tx_index: 1, critical_path: [1, 2] },
  },
  schedules: { cores: [1, 2, 4, 8, 16], validator_bal_time: [1, 2, 2, 2, 2], builder_dag_time: [1, 1.2, 1.2, 1.2, 1.2] },
  hot_locations: [{ address: "0x" + "2".repeat(40), field: "storage", key: h("0"), writers: 2, readers: 1, edges: 3, on_critical_path: true, label: null }],
  uniswap: { v3_swap_transactions: 0, v4_swap_transactions: 0, labeled_edges: 0 },
  epbs: null, replay: null, excluded_addresses: [], coverage: ["ceilings_are_upper_bounds"],
});

test("parseReport accepts a spec-shaped report and rejects broken identity, counts, ceilings and schedules", () => {
  assert.equal(parseReport(fixture()).block.number, 1);
  const broken: [string, (r: Report) => void, RegExp][] = [
    ["schema", r => { (r as { schema: string }).schema = "rooted-xray-v0"; }, /schema/],
    ["uppercase hash", r => { r.block.hash = r.block.hash.toUpperCase().replace("0X", "0x"); }, /hash/],
    ["count", r => { r.block.transaction_count = 4; }, /count/],
    ["row index", r => { r.transactions[2].index = 5; }, /count/],
    ["ceiling", r => { r.ceilings.builder_dag_time.value = 0.9; }, /at least 1/],
    ["missing ceiling", r => { delete (r.ceilings as Partial<Report["ceilings"]>).gas_weighted; }, /at least 1/],
    ["schedule", r => { r.schedules.validator_bal_time = [1, 2, 2, 2]; }, /5 core/],
    ["cores", r => { r.schedules.cores = [1, 2, 4, 8]; }, /5 core/],
  ];
  for (const [name, mutate, message] of broken) { const r = fixture(); mutate(r); assert.throws(() => parseReport(r), message, name); }
  assert.throws(() => parseReport(null), /schema/);
  const untimed = fixture(); untimed.ceilings.validator_bal_time.value = null; untimed.schedules.validator_bal_time = null;
  assert.equal(parseReport(untimed).schedules.validator_bal_time, null);
});

test("laneRows scales bars to the largest tx and flags the capping and critical-path txs", () => {
  const rows = laneRows(fixture());
  assert.deepEqual(rows.map(r => r.widthNs), [100 / 300, 1, 200 / 300]);
  assert.deepEqual(rows.map(r => r.widthGas), [21000 / 50000, 1, 30000 / 50000]);
  assert.deepEqual(rows.map(r => [r.validatorCap, r.gasCap, r.onCriticalPath]), [[false, false, false], [true, true, true], [false, false, true]]);
  const untimed = fixture(); for (const t of untimed.transactions) t.apply_ns_median = null;
  assert.deepEqual(laneRows(untimed).map(r => r.widthNs), [null, null, null]);
});

test("speedupSeries pairs core counts with both schedules, and formatX keeps null unknown", () => {
  assert.deepEqual(speedupSeries(fixture())[1], { k: 2, validator: 2, builder: 1.2 });
  const untimed = fixture(); untimed.schedules.builder_dag_time = null;
  assert.equal(speedupSeries(untimed)[4].builder, null);
  assert.equal(formatX(2.777), "2.78×"); assert.equal(formatX(null), "Unknown"); assert.equal(formatX(NaN), "Unknown");
});

test("brief and summary parsers reject malformed rows", () => {
  assert.equal(parseBriefs([{ block_hash: h("a") }]).length, 1);
  assert.throws(() => parseBriefs([{ block_hash: "latest" }])); assert.throws(() => parseBriefs({}));
  assert.throws(() => parseSummary({ blocks: "3" }));
  assert.equal(parseSummary({ blocks: 0, ceilings: {}, speedup_8: {} }).blocks, 0);
});

test("paymentTerms decodes an x402 v2 PAYMENT-REQUIRED header and ignores junk", () => {
  const header = btoa(JSON.stringify({ x402Version: 2, resource: { url: "/api/paid/xray/x" }, accepts: [
    { scheme: "exact", network: "hedera:testnet", asset: "0.0.0", amount: "1000000", payTo: "0.0.1234", maxTimeoutSeconds: 120, extra: {} },
    { scheme: "exact", network: "hedera:testnet", asset: "0.0.429274", amount: "10000", payTo: "0.0.1234", maxTimeoutSeconds: 120, extra: {} },
    { scheme: "exact", network: "hedera:testnet", asset: "0.0.0", amount: "-1", payTo: "0.0.1234" },
  ] }));
  const terms = paymentTerms(header);
  assert.equal(terms.length, 2);
  assert.deepEqual(terms.map(formatPrice), ["0.01 HBAR", "0.01 USDC"]);
  assert.equal(formatPrice({ ...terms[0], network: "eip155:11155111", asset: "0xabc" }), "1000000 atomic units of 0xabc");
  assert.deepEqual(paymentTerms(null), []); assert.deepEqual(paymentTerms("%%%"), []); assert.deepEqual(paymentTerms(btoa("{}")), []);
});

test("X-ray compute route accepts only a same-origin block hash and forwards one POST", async (t) => {
  assert.deepEqual(blockHashRequest({ block_hash: " " + h("A") + " " }), { block_hash: h("a") });
  for (const bad of [{}, { block_hash: "latest" }, { block_hash: h("a"), profile_id: h("b") }, []]) assert.throws(() => blockHashRequest(bad));
  const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/xray", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await POST(request({ block_hash: h("a") }, "https://foreign.invalid"))).status, 403);
  assert.equal((await POST(request({ block_hash: "latest" }))).status, 400);
  let called = "", method = "";
  t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => { called = String(url); method = String(options.method); return Response.json({ data: fixture() }, { status: 201 }); });
  assert.equal((await POST(request({ block_hash: h("A") }))).status, 201);
  assert.equal(method, "POST");
  assert.equal(new URL(called).pathname + new URL(called).search, `/api/v1/xray/blocks/${h("a")}?network=sepolia`);
  process.env.ROOTED_HOSTED = "1";
  try { assert.equal((await POST(request({ block_hash: h("a") }))).status, 403); } finally { delete process.env.ROOTED_HOSTED; }
});
