import { test } from "node:test";
import assert from "node:assert/strict";
import { divergent, explorerTx, matches, parseConformance, type ConformanceCase } from "../lib/frame-conformance";

const item = (expected: ConformanceCase["expected"], observed: ConformanceCase["observed"]): ConformanceCase => ({
  id: "case", group: "nonce_keys", description: "", overrides: {}, expected, expected_basis: {}, tx_hash: null, submitted_at: null,
  rpc: null, admission: null, observed, observed_rule: null, rooted_attempt_id: null, receipt: null,
});

test("divergent flags source disagreement or a node verdict that differs from any applicable source", () => {
  const agreed = item({ eip8141: "reject", eip8250: "n/a", erc8421_draft: "reject", sidecar_docs: "reject" }, "reject");
  assert.equal(divergent(agreed), false);
  assert.deepEqual(["eip8141", "eip8250"].map(s => matches(agreed, s as "eip8141")), [true, null]);
  assert.equal(divergent({ ...agreed, observed: "accept" }), true);
  // keys-zero-mixed: EIP-8250 accepts, the sidecar docs reject, so sources disagree whatever the node does.
  assert.equal(divergent(item({ eip8141: "n/a", eip8250: "accept", erc8421_draft: "n/a", sidecar_docs: "reject" }, "reject")), true);
  // An unknown observation is not evidence either way.
  assert.equal(divergent({ ...agreed, observed: "unknown" }), false);
  assert.equal(matches({ ...agreed, observed: "unknown" }, "eip8141"), null);
});

test("parseConformance rejects foreign schemas and unknown verdicts", () => {
  const ok = { schema: "rooted-frame-conformance-v1", cases: [item({ eip8141: "accept", eip8250: "n/a", erc8421_draft: "accept", sidecar_docs: "accept" }, "accept")] };
  assert.equal(parseConformance(ok).cases.length, 1);
  assert.throws(() => parseConformance({ ...ok, schema: "x" }));
  assert.throws(() => parseConformance({ ...ok, cases: [{ ...ok.cases[0], observed: "maybe" }] }));
  assert.throws(() => parseConformance({ ...ok, cases: [{ ...ok.cases[0], expected: { eip8141: "accept" } }] }));
  assert.equal(explorerTx("0xab"), "https://explorer.altmempool.wtf/tx/0xab");
});
