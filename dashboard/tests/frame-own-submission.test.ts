import { test } from "node:test";
import assert from "node:assert/strict";
import { ownSubmission, type Conformance, type ConformanceCase } from "../lib/frame-conformance";

const hash = "0x" + "96".repeat(32);
const baseline = { id: "baseline", tx_hash: hash, submitted_at: "2026-11-06T09:47:01Z", rooted_attempt_id: "a1", rpc: { acknowledged: true, error_code: null, error_message: null } } as ConformanceCase;
const run = { run_id: "e34c", cases: [baseline] } as unknown as Conformance;

test("own submission prefers the journal and falls back to the acknowledged conformance baseline", () => {
  const journal = [{ attempt_id: "j", expected_hash: "0x" + "01".repeat(32), submitted_at: "t", submission_status: "submission_acknowledged" }];
  assert.equal(ownSubmission(journal, run)?.attempt_id, "j");
  const fallback = ownSubmission([], run);
  assert.equal(fallback?.expected_hash, hash);
  assert.equal(fallback?.fromRun, "e34c");
  assert.equal(ownSubmission(undefined, run), undefined, "journal still loading");
  assert.equal(ownSubmission([], { ...run, cases: [{ ...baseline, rpc: { acknowledged: false, error_code: -32000, error_message: "x" } }] }), undefined);
  assert.equal(ownSubmission([], null), undefined);
});
