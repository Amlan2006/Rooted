import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/backend/[...path]/route";
import { laneRows, parseReport, type Report } from "../lib/xray";

const hash = "0x" + "ab".repeat(32);
const get = (path: string[]) => GET(new Request("http://localhost:3000/api/backend/" + path.join("/") + "?network=sepolia"), { params: Promise.resolve({ path }) });

test("turning the x402 paywall on closes the free report proxy even without ROOTED_HOSTED", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ data: [] }); });
  delete process.env.ROOTED_HOSTED;
  process.env.ROOTED_X402_ENABLED = "true";
  try {
    const paid = await get(["api", "v1", "xray", "blocks", hash]);
    assert.equal(paid.status, 402);
    assert.equal((await paid.json()).error.paid_url, `/api/paid/xray/${hash}`);
    assert.equal(calls, 0, "the paid report never reaches the backend through the free proxy");
    for (const free of [["api", "v1", "xray", "blocks"], ["api", "v1", "xray", "summary"]]) assert.equal((await get(free)).status, 200);
    process.env.ROOTED_X402_ENABLED = "false";
    assert.equal((await get(["api", "v1", "xray", "blocks", hash])).status, 200, "paywall off: self-hosted reports stay free");
  } finally { delete process.env.ROOTED_X402_ENABLED; }
});

test("ROOTED_FREE_XRAY_BLOCKS opens exact listed reports through the hosted proxy; other hashes and paths stay closed", async (t) => {
  const sample = "0x" + "cd".repeat(32), called: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => { called.push(url.pathname); return Response.json({ data: {} }); });
  process.env.ROOTED_FREE_XRAY_BLOCKS = `${hash}0, ${sample.toUpperCase().replace("0X", "0x")} `;
  try {
    for (const env of [{ ROOTED_X402_ENABLED: "true" }, { ROOTED_HOSTED: "1" }]) {
      Object.assign(process.env, env);
      called.length = 0;
      const free = await get(["api", "v1", "xray", "blocks", sample.replace("cd", "CD")]);
      assert.equal(free.status, 200);
      assert.equal(free.headers.get("X-Rooted-Sample"), "free");
      const closed = await get(["api", "v1", "xray", "blocks", hash]);
      assert.equal(closed.status, env.ROOTED_HOSTED ? 403 : 402);
      assert.deepEqual((await closed.json()).error.free_samples, [sample], "a malformed list entry frees nothing");
      for (const trick of [["api", "v1", "xray", "blocks", sample, "capture"], ["api", "v1", "xray", "blocks", sample + "00"], ["api", "v1", "xray", "blocks", sample.slice(0, -2)]])
        assert.equal((await get(trick)).status, 400, trick.join("/"));
      assert.deepEqual(called, [`/api/v1/xray/blocks/${sample.replace("cd", "CD")}`], "only the sample reached the backend");
      for (const k of Object.keys(env)) delete process.env[k];
    }
    const self = await get(["api", "v1", "xray", "blocks", hash]);
    assert.equal(self.status, 200, "self-hosted: every report is free");
    assert.equal(self.headers.get("X-Rooted-Sample"), null, "and none is labelled a sample");
  } finally { delete process.env.ROOTED_FREE_XRAY_BLOCKS; delete process.env.ROOTED_X402_ENABLED; delete process.env.ROOTED_HOSTED; }
});

test("execution-gas lanes and ceiling are optional but validated when present", () => {
  const h = (c: string) => "0x" + c.repeat(64);
  const tx = (index: number, gas: number, exec: number | null) => ({ index, hash: h(String(index + 1)), from: "0x" + "1".repeat(40), to: null, is_create: false, status: 1, gas_used: gas, execution_gas: exec, state_gas: exec == null ? null : gas - exec, apply_ns_median: 100, reads: 0, writes: 0, depends_on: [] });
  const ceiling = (weight: "gas" | "ns", value: number | null) => ({ model: "validator_bal", weight, value, total: null, bottleneck: null, capping_tx_index: 0 });
  const report = (): Report => ({
    schema: "rooted-xray-v1", network: "sepolia", computed_at: "2026-11-06T09:30:00Z", source: "follow", profile_id: null,
    block: { number: 1, hash: h("a"), parent_hash: h("b"), timestamp: 1, slot: 2, beacon_block_root: null, parent_beacon_block_root: h("d"), fee_recipient: "0x" + "e".repeat(40), gas_limit: 60000000, transaction_count: 2 },
    gas: { header_gas_used: 40000, receipts_gas_sum: 90000, differs: true },
    bal: { commitment: h("f"), computed_commitment: h("f"), commitment_verified: true, accounts: 2, source: "beacon_payload_envelope", schema: "x" },
    transactions: [tx(0, 70000, 10000), tx(1, 20000, 20000)],
    edges: { RAW: 0, WAR: 0, WAW: 0, total: 0, dependent_pairs: 0, truncated: false }, independent_transactions: 2,
    ceilings: { gas_weighted: ceiling("gas", 1.29), execution_gas_weighted: ceiling("gas", 1.5), validator_bal_time: ceiling("ns", 2), builder_dag_time: ceiling("ns", 2) },
    schedules: { cores: [1, 2, 4, 8, 16], validator_bal_time: null, builder_dag_time: null },
    hot_locations: [], uniswap: { v3_swap_transactions: 0, v4_swap_transactions: 0, labeled_edges: 0 }, epbs: null,
    replay: { runner: "rooted-native-replay-v1", geth_library: "v1.17.10", cpu_model: "x", logical_cpus: 8, samples: 7, median_apply_ns: 200, timing: "uninstrumented_control" },
    excluded_addresses: [], coverage: [],
  });
  assert.deepEqual(laneRows(report()).map(r => [r.exec, r.widthExec, r.widthGas]), [[10000, 0.5, 1], [20000, 1, 20000 / 70000]]);
  const legacy = report(); delete legacy.ceilings.execution_gas_weighted; for (const t of legacy.transactions) delete t.execution_gas;
  assert.equal(parseReport(legacy).ceilings.execution_gas_weighted, undefined);
  assert.deepEqual(laneRows(legacy).map(r => r.widthExec), [null, null]);
  const broken = report(); broken.ceilings.execution_gas_weighted!.value = 0.5;
  assert.throws(() => parseReport(broken), /at least 1/);
});
