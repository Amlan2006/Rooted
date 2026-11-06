import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, limitsFrom, policy, sessionSpent } from "./spend.mjs";

const limits = limitsFrom({ ROOTED_EXPECTED_PAY_TO: "0.0.7001", MAX_PER_REQUEST: "1000000", SESSION_BUDGET: "2500000" });
const offer = (o = {}) => ({ scheme: "exact", network: "hedera:testnet", asset: "0.0.0", payTo: "0.0.7001", amount: "1000000", ...o });

test("accepts a trusted offer within both caps and reports the budget left", () => {
  assert.deepEqual(decide(offer(), { spent: "0" }, limits), { refused: false, amount: "1000000", budget_left: "1500000" });
  assert.deepEqual(decide(offer(), { spent: "1500000" }, limits), { refused: false, amount: "1000000", budget_left: "0" });
});

test("refuses per-request cap, session budget, untrusted payTo, other assets and bad amounts", () => {
  const reason = (o, spent = "0", l = limits) => decide(offer(o), { spent }, l).reason;
  assert.equal(reason({ amount: "1000001" }), "over_per_request_cap");
  assert.equal(reason({}, "1500001"), "session_budget_exceeded");
  assert.equal(reason({}, "9999999"), "session_budget_exceeded");
  assert.equal(reason({ payTo: "0.0.666" }), "untrusted_pay_to");
  assert.equal(reason({ asset: "0.0.429274" }), "asset_not_allowed");
  assert.equal(reason({ network: "hedera:mainnet" }), "asset_not_allowed");
  for (const amount of ["", "-1", "1.5", "1e6", 1000000, undefined]) assert.equal(reason({ amount }), "invalid_amount");
  assert.deepEqual(decide(offer({ amount: "1000001" }), { spent: "3000000" }, limits), { refused: true, reason: "over_per_request_cap", amount: "1000001", budget_left: "0" });
});

test("session spend sums only settled runs for this session and asset; corrupt logs fail closed", () => {
  const log = [
    { session: "2026-11-06", asset: "0.0.0", amount: "1000000", settled: true },
    { session: "2026-11-06", asset: "0.0.0", amount: "1000000", settled: false },
    { session: "2026-11-05", asset: "0.0.0", amount: "7", settled: true },
    { session: "2026-11-06", asset: "0.0.429274", amount: "9", settled: true },
    { session: "2026-11-06", asset: "0.0.0", amount: "250000", settled: true },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n";
  assert.equal(sessionSpent(log, "2026-11-06", "0.0.0"), "1250000");
  assert.equal(sessionSpent("", "2026-11-06", "0.0.0"), "0");
  assert.throws(() => sessionSpent("{not json\n", "s", "0.0.0"));
  assert.throws(() => sessionSpent(JSON.stringify({ session: "s", asset: "0.0.0", amount: "1.5", settled: true }), "s", "0.0.0"));
});

test("limits require a trusted payTo and atomic caps", () => {
  assert.deepEqual(limitsFrom({ ROOTED_EXPECTED_PAY_TO: "0.0.7001" }), { network: "hedera:testnet", asset: "0.0.0", payTo: "0.0.7001", maxPerRequest: "1000000", sessionBudget: "5000000" });
  for (const env of [{}, { ROOTED_EXPECTED_PAY_TO: "0.0.0" }, { ROOTED_EXPECTED_PAY_TO: "0.0.7001", MAX_PER_REQUEST: "0.01" }, { ROOTED_EXPECTED_PAY_TO: "0.0.7001", SESSION_BUDGET: "$1" }])
    assert.throws(() => limitsFrom(env));
});

test("the library policy keeps only offers decide() approves, so a mixed offer cannot pay in another asset", () => {
  const offers = [offer({ asset: "0.0.429274", amount: "900000" }), offer(), offer({ payTo: "0.0.666" }), offer({ amount: "1000001" })];
  assert.deepEqual(policy({ spent: "0" }, limits)(2, offers), [offers[1]]);
  assert.deepEqual(policy({ spent: "2000000" }, limits)(2, offers), [], "over budget: nothing is signable");
});
