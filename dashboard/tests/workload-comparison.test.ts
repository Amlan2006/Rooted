import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { comparisonIssues, parseComparison, workloadMetrics } from "../lib/workload-comparison";
const text = readFileSync(new URL("../public/examples/workload-comparison.json", import.meta.url), "utf8");
const capture = () => parseComparison(text);

test("real fork pair has comparable partial evidence and reconciled counts", () => {
  const c = capture();
  assert.deepEqual(comparisonIssues(c, false), []);
  assert.deepEqual(comparisonIssues(c, true), []);
  const all = c.scenarios.map(s => workloadMetrics(s.report, false));
  assert.deepEqual(all.map(m => m.graph.edges.length), [39, 15]);
  assert.deepEqual(all.map(m => [m.graph.observed_dependency_depth, m.graph.observed_max_layer_width]), [[3, 1], [3, 1]]);
  for (const m of all) {
    assert.equal(m.graph.full_dependency_coverage, false);
    assert.equal(m.breakdown.categories.reduce((n, c) => n + c.count, 0), m.graph.edges.length);
  }
  const storage = c.scenarios.map(s => workloadMetrics(s.report, true));
  assert.deepEqual(storage.map(m => m.graph.edges.length), [36, 12]);
  assert.deepEqual(storage.map(m => [m.graph.observed_dependency_depth, m.graph.observed_max_layer_width]), [[3, 1], [2, 2]]);
  assert.deepEqual(all.map(m => m.breakdown.categories.find(c => c.id === "account")?.count), [3, 3]);
});

test("fork, baseline, successful receipt, and selection mismatches block deltas", () => {
  for (const mutate of [
    (c: ReturnType<typeof capture>) => { c.scenarios[1].report.network_anchor!.hash = "0x" + "a".repeat(64); },
    (c: ReturnType<typeof capture>) => { c.scenarios[1].report.block.parentHash = "0x" + "a".repeat(64); },
    (c: ReturnType<typeof capture>) => { c.scenarios[1].receipts[0].status = "0x0"; },
    (c: ReturnType<typeof capture>) => { c.scenarios[1].transactions.reverse(); },
    (c: ReturnType<typeof capture>) => { c.scenarios[1].report.mode = "live"; },
  ]) {
    const c = capture(); mutate(c); assert.ok(comparisonIssues(c, false).length);
  }
});

test("different coverage, missing traces, and truncated graphs withhold comparisons", () => {
  const c = capture(); c.scenarios[1].report.graph.truncated = true;
  assert.ok(comparisonIssues(c, false).some(x => x.includes("truncated")));
  assert.deepEqual(comparisonIssues(c, true), []); // Scope-specific truncation.
  const d = capture(); d.scenarios[1].report.transaction_access[0].storage_reads_complete = false;
  assert.ok(comparisonIssues(d, false).some(x => x.includes("coverage differs")));
  const raw = JSON.parse(text);
  delete raw.scenarios[1].report.analyzed_transactions[0].opcode_trace_available;
  assert.ok(comparisonIssues(parseComparison(JSON.stringify(raw)), false).some(x => x.includes("trace types")));
});

test("settings and actual calldata must agree; absent metadata never enables deltas", () => {
  const c = capture(); c.scenarios[1].inputs![0].input = "0xdeadbeef";
  assert.ok(comparisonIssues(c, false).some(x => x.includes("actual transaction inputs")));
  const d = capture(); d.scenarios[1].inputs![0].nonce = "0x100";
  assert.ok(comparisonIssues(d, false).some(x => x.includes("nonces")));
  const e = capture(); delete e.scenarios[1].inputs;
  assert.ok(comparisonIssues(e, false).length);
  const missingCoverage = JSON.parse(text); delete missingCoverage.scenarios[0].report.transaction_access[0].coverage;
  assert.ok(comparisonIssues(parseComparison(JSON.stringify(missingCoverage)), false).some(x => x.includes("coverage metadata")));
  const raw = JSON.parse(text); delete raw.settings;
  assert.ok(comparisonIssues(parseComparison(JSON.stringify(raw)), false).length);
});

test("unknown coverage cannot masquerade as matching coverage", () => {
  const raw = JSON.parse(text);
  raw.scenarios.forEach((s: { report: { coverage: string[] } }) => s.report.coverage.push("unknown future semantics"));
  assert.ok(comparisonIssues(parseComparison(JSON.stringify(raw)), false).some(x => x.includes("unrecognized coverage")));
});

test("portable parser excludes unknown operator fields and rejects malformed graphs", () => {
  const raw = JSON.parse(text);
  raw.secret = "private"; raw.settings.token = "private";
  raw.scenarios[0].report.sources = [{ kind: "eth_call", origin: "https://user:password@example.test/?key=secret", fetched_at: "2026-11-06T00:00:00Z" }];
  const safe = JSON.stringify(parseComparison(JSON.stringify(raw)));
  assert.ok(!safe.includes("password") && !safe.includes("private") && !safe.includes("example.test"));
  raw.scenarios[0].report.graph.edges[0].location = null;
  assert.throws(() => parseComparison(JSON.stringify(raw)), /Invalid conflict evidence/);
  assert.throws(() => parseComparison("x".repeat(8_000_001)), /8 MB/);
  assert.throws(() => parseComparison("{}"), /version 1/);
});
