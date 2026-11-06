import { test } from "node:test";
import assert from "node:assert/strict";
import { nextBlock, triggers, type RuleInput } from "../lib/analyst/rules";
import { backendURL } from "../lib/proxy";
import { GET } from "../app/api/analyst/briefs/route";

// A quiet block: every ceiling within the rule bands, verified commitment, few transactions.
const quiet = (over: Partial<RuleInput> = {}): RuleInput => ({
  block_hash: "0x" + "a".repeat(64), block_number: 12076467, slot: 1, computed_at: "2026-11-06T09:30:00Z", source: "follow", transaction_count: 40,
  header_gas_used: 1, receipts_gas_sum: 1, commitment_verified: true,
  gas_weighted: 4, validator_bal_time: 4, builder_dag_time: 2.8, builder_multiversion_time: 3.2,
  gas_capping_tx_index: 0, validator_capping_tx_index: 0, builder_critical_path_length: 2,
  speedup_8_validator: 3, speedup_8_builder: 2, builder_index: null, gas_misidentifies_bottleneck: false, ...over,
});

test("a quiet block, and one missing every ceiling, trigger nothing", () => {
  assert.deepEqual(triggers(quiet()), []);
  assert.deepEqual(triggers(quiet({ gas_weighted: null, validator_bal_time: null, builder_dag_time: null, builder_multiversion_time: null, gas_misidentifies_bottleneck: null })), []);
  assert.deepEqual(triggers(quiet({ builder_multiversion_time: undefined, gas_misidentifies_bottleneck: undefined })), []);
});

test("builder_gap fires below 0.8x multi-version or 0.7x static DAG of the validator ceiling", () => {
  assert.deepEqual(triggers(quiet({ builder_multiversion_time: 3.19 })), ["builder_gap"]);
  assert.deepEqual(triggers(quiet({ builder_dag_time: 2.79 })), ["builder_gap"]);
  assert.deepEqual(triggers(quiet({ builder_dag_time: 1, validator_bal_time: null })), [], "no validator ceiling, no comparison");
});

test("gas_misleads fires outside 0.5x..2x of the validator ceiling or on the strict misidentification flag", () => {
  assert.deepEqual(triggers(quiet({ gas_weighted: 8.01 })), ["gas_misleads"]);
  assert.deepEqual(triggers(quiet({ gas_weighted: 8 })), []);
  assert.deepEqual(triggers(quiet({ gas_weighted: 1.99 })), ["gas_misleads"]);
  assert.deepEqual(triggers(quiet({ gas_weighted: 2 })), []);
  assert.deepEqual(triggers(quiet({ gas_misidentifies_bottleneck: true })), ["gas_misleads"]);
});

test("big_block and commitment, and several rules together in vocabulary order", () => {
  assert.deepEqual(triggers(quiet({ transaction_count: 249 })), []);
  assert.deepEqual(triggers(quiet({ transaction_count: 250 })), ["big_block"]);
  assert.deepEqual(triggers(quiet({ commitment_verified: false })), ["commitment"]);
  assert.deepEqual(triggers(quiet({ commitment_verified: false, transaction_count: 300, gas_weighted: 1, builder_dag_time: 1 })), ["builder_gap", "gas_misleads", "big_block", "commitment"]);
});

test("nextBlock takes the newest unbriefed anomaly and stops at the hourly cap", () => {
  const h = (c: string) => "0x" + c.repeat(64), now = Date.parse("2026-11-06T12:00:00Z"), hour = 3_600_000;
  const blocks = [quiet({ block_hash: h("1"), block_number: 5 }), quiet({ block_hash: h("2"), block_number: 4, transaction_count: 300 }), quiet({ block_hash: h("3"), block_number: 3, commitment_verified: false })];
  assert.deepEqual(nextBlock(blocks, new Map(), now, 6), { block: blocks[1], triggers: ["big_block"] });
  assert.equal(nextBlock(blocks, new Map([[h("2"), now - 2 * hour]]), now, 6)?.block, blocks[2], "already briefed hashes are skipped");
  assert.equal(nextBlock(blocks, new Map([[h("2"), 0], [h("3"), 0]]), now, 6), null);
  const full = new Map([[h("a"), now - hour + 1], [h("b"), now - 10]]);
  assert.equal(nextBlock(blocks, full, now, 2), null, "two briefs within the hour use up a cap of two");
  assert.equal(nextBlock(blocks, new Map([[h("a"), now - hour], [h("b"), now - 10]]), now, 2)?.block, blocks[1], "a brief exactly an hour old no longer counts");
});

test("the briefs feed is a proxied read pinned to Sepolia", async (t) => {
  const base = "http://127.0.0.1:8080";
  assert.equal(backendURL(["api", "v1", "analyst", "briefs"], "?network=sepolia", base).pathname, "/api/v1/analyst/briefs");
  for (const route of [["api", "v1", "analyst"], ["api", "v1", "analyst", "briefs", "x"]]) assert.throws(() => backendURL(route, "", base));
  const called: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => { called.push(String(url)); return Response.json({ data: [] }); });
  assert.equal((await GET(new Request("http://localhost:3000/api/analyst/briefs?limit=5&network=mainnet"))).status, 200);
  assert.equal((await GET(new Request("http://localhost:3000/api/analyst/briefs?limit=5%26network%3Dmainnet"))).status, 200);
  assert.deepEqual(called, [`${base}/api/v1/analyst/briefs?network=sepolia&limit=5`, `${base}/api/v1/analyst/briefs?network=sepolia&limit=5%26network%3Dmainnet`]);
});
