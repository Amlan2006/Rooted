import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConflictEdge, Graph, Location, Run } from "../lib/data";
import { explainConflict } from "../lib/conflict-explanation";

const address = "0x" + "1".repeat(40);
const location: Location = { address, field: "storage", key: "0x" + "0".repeat(64) };
const hashes = ["0x" + "a".repeat(64), "0x" + "b".repeat(64)];
const graph: Graph = { edges: [], observed_conflict_counts: {}, observed_layers: [], observed_dependency_depth: 0, observed_max_layer_width: 0, full_dependency_coverage: false, storage_read_coverage_complete: false, theoretical_speedup: null, coverage: [] };
function report(): Run {
  return {
    id: "report-1", network: "sepolia", mode: "live", chain_id: "11155111", created_at: "2026-11-06T00:00:00Z", canonical_at_fetch: true,
    block: { hash: "block-1", number: "0x1", transactions: hashes.map(hash => ({ hash })) },
    native_bal: { accounts: 1, commitment_verified: true, computed_commitment: "commitment-1", changes: [0, 1].map(index => ({ ...location, transaction_index: index, phase: "transaction", source: "native_bal", post_value: "0x1" })) },
    graph, storage_projection: graph, coverage: ["partial_reads"], sources: [{ kind: "analysis_native_bal_envelope", origin: "http://127.0.0.1:15052", fetched_at: "2026-11-06T00:00:00Z" }],
    uniswap_pools: [{ address, verified: true, fee: 500, token0: "token0", token1: "token1" }],
    uniswap_storage_labels: { [`${address}:storage:${location.key}`]: "slot0_price_tick_and_lock" },
    uniswap_swaps: [], uniswap_swap_calls: [],
    transaction_access: hashes.map((hash, index) => ({ hash, index, reads: [location], writes: [location], storage_reads_complete: false, coverage: ["partial_reads"] })),
  };
}
const edge = (kind: string): ConflictEdge => ({ from: 0, to: 1, kind, location, basis: "attributed_read_and_committed_change_evidence" });

test("RAW, WAR and WAW preserve access roles and order without claiming measured delays", () => {
  for (const [kind, first, second] of [["RAW", "writes", "reads"], ["WAR", "reads", "writes"], ["WAW", "writes", "writes"]]) {
    const finding = explainConflict(report(), edge(kind));
    assert.equal(finding.supported, true);
    assert.match(finding.explanation, new RegExp(`Transaction 0 ${first}`));
    assert.match(finding.explanation, new RegExp(`transaction 1 ${second}`));
    assert.deepEqual(finding.hashes, hashes);
    assert.equal(finding.evidence.edge.basis, edge(kind).basis);
    assert.equal(finding.evidence.network, "sepolia");
    assert.doesNotMatch(finding.explanation, /milliseconds|faster|delay|speedup/i);
  }
});

test("semantic labels require verified pool identity and a supported storage interpretation", () => {
  const run = report();
  assert.match(explainConflict(run, edge("WAW")).semanticLabel, /price, tick, and lock/);
  run.uniswap_pools[0].verified = false;
  let finding = explainConflict(run, edge("WAW"));
  assert.equal(finding.poolVerified, false);
  assert.match(finding.semanticLabel, /unknown/);
  assert.doesNotMatch(finding.explanation, /Uniswap/);
  run.uniswap_pools[0].verified = true;
  run.uniswap_storage_labels![`${address}:storage:${location.key}`] = "mapping_or_observation_storage";
  assert.match(explainConflict(run, edge("WAW")).semanticLabel, /unknown/);
});

test("native write proof requires the exact location, transaction index, and verified commitment", () => {
  const run = report();
  assert.ok(explainConflict(run, edge("WAW")).evidenceNotes.every(note => note.includes("commitment-verified")));
  run.native_bal!.changes![1].key = "0x01";
  const finding = explainConflict(run, edge("WAW"));
  assert.match(finding.evidenceNotes[0], /commitment-verified/);
  assert.doesNotMatch(finding.evidenceNotes[1], /backed by a commitment-verified/);
  run.native_bal!.commitment_verified = false;
  assert.ok(explainConflict(run, edge("WAW")).evidenceNotes.every(note => !note.includes("backed by a commitment-verified")));
  const read = explainConflict(report(), edge("RAW")).evidenceNotes[1];
  assert.match(read, /not inferred from block-level BAL reads/);
});

test("missing access, mismatched hashes, reversed edges and read/read cannot create explanations", () => {
  for (const name of ["missing_read", "wrong_hash", "missing_hash", "reversed", "read_read", "unknown_kind"]) {
    const run = report(); let stored = edge("RAW");
    if (name === "missing_read") run.transaction_access[1].reads = [];
    if (name === "wrong_hash") run.transaction_access[1].hash = hashes[0];
    if (name === "missing_hash") run.block.transactions = [];
    if (name === "reversed") stored = { ...stored, from: 1, to: 0 };
    if (name === "read_read") stored = edge("RR");
    if (name === "unknown_kind") stored = edge("constructor");
    const finding = explainConflict(run, stored);
    assert.equal(finding.supported, false, name);
    assert.match(finding.explanation, /unconfirmed/);
  }
});

test("older reports and fork evidence remain usable without inventing native proof", () => {
  const run = report(); delete run.native_bal!.changes; delete run.uniswap_storage_labels;
  const finding = explainConflict(run, edge("WAW"));
  assert.equal(finding.supported, true);
  assert.match(finding.semanticLabel, /unknown/);
  assert.match(finding.evidenceNotes[0], /not established/);
  run.native_bal = null; run.network = "sepolia-fork"; run.mode = "fork";
  const fork = explainConflict(run, edge("WAW"));
  assert.equal(fork.evidence.mode, "fork");
  assert.match(fork.evidenceNotes[0], /trace-based/);
  assert.equal(fork.evidence.native_commitment_verified, null);
});
