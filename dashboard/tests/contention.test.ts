import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConflictEdge, Graph, Location, Run } from "../lib/data";
import { contentionBreakdown } from "../lib/contention";
const address = (digit: string) => "0x" + digit.repeat(40);
const poolA = address("1"), poolB = address("2"), token = address("3"), unknown = address("4"), unverified = address("5");
const key = "0x" + "0".repeat(64);
const hashes = ["0x" + "a".repeat(64), "0x" + "b".repeat(64), "0x" + "c".repeat(64)];
function edge(address: string, field = "storage", from = 0, to = 1, storageKey = key): ConflictEdge {
  return { from, to, kind: "WAW", location: { address, field, ...(field === "storage" ? { key: storageKey } : {}) } };
}
function graph(edges: ConflictEdge[]): Graph {
  return { edges, truncated: true, observed_conflict_counts: { WAW: edges.length }, observed_layers: [], observed_dependency_depth: 0, observed_max_layer_width: 0, full_dependency_coverage: false, storage_read_coverage_complete: false, theoretical_speedup: null, coverage: ["partial"] };
}
function report(edges: ConflictEdge[] = []): Run {
  const locations: Location[] = edges.map(edge => edge.location);
  return {
    id: "report", network: "sepolia", mode: "live", chain_id: "11155111", created_at: "2026-11-06", canonical_at_fetch: true,
    block: { hash: "block", number: "0x1", transactions: hashes.map(hash => ({ hash })) }, native_bal: null,
    graph: graph(edges), storage_projection: graph(edges.filter(edge => edge.location.field === "storage")), sources: [], coverage: ["partial_reads"],
    uniswap_pools: [
      { address: poolA, token0: token, token1: address("6"), fee: 500, verified: true },
      { address: poolB, token0: token, token1: address("7"), fee: 3000, verified: true },
      { address: unverified, token0: unknown, token1: address("8"), fee: 500, verified: false },
    ], uniswap_swaps: [], uniswap_swap_calls: [],
    transaction_access: hashes.map((hash, index) => ({ hash, index, reads: locations, writes: locations, storage_reads_complete: false, coverage: ["partial_reads"] })),
  };
}
const counts = (result: ReturnType<typeof contentionBreakdown>) => Object.fromEntries(result.categories.map(category => [category.id, category.count]));

test("exclusive categories reconcile with every returned edge, including unclassified data", () => {
  const run = report([edge(poolA), edge(token), edge(poolA, "balance"), edge(unknown), edge(unverified), edge(token, "unsupported"), edge(token, "storage", 0, 1, "")]);
  const result = contentionBreakdown(run, run.graph);
  assert.deepEqual(counts(result), { pool: 1, token: 1, account: 1, unclassified: 4 });
  assert.equal(result.total, 7);
  assert.equal(result.categories.reduce((sum, category) => sum + category.count, 0), result.total);
  assert.ok(Math.abs(result.categories.reduce((sum, category) => sum + category.share!, 0) - 1) < 1e-9);
  assert.equal(run.graph.truncated, true);
});

test("scope and transaction filtering use the full returned edge set, not the map/table limits", () => {
  const edges = Array.from({ length: 75 }, (_, i) => edge(token, "storage", i % 2, 2, "0x" + i.toString(16).padStart(64, "0")));
  edges.push(edge(unknown, "nonce", 1, 2));
  const run = report(edges);
  assert.equal(contentionBreakdown(run, run.graph).total, 76);
  assert.equal(contentionBreakdown(run, run.storage_projection).total, 75);
  const selected = contentionBreakdown(run, run.graph, 0);
  assert.equal(selected.total, 38);
  assert.equal(selected.graphTotal, 76);
  assert.equal(selected.focus, 0);
  assert.equal(counts(selected).token, 38);
  assert.equal(contentionBreakdown(run, run.graph, 10).total, 0);
});

test("metadata is case-insensitive, verified pools win over token identities, and unverified tokens remain unknown", () => {
  const run = report([edge(poolA.toUpperCase().replace("0X", "0x")), edge(unknown)]);
  run.uniswap_pools[1].token1 = poolA;
  assert.deepEqual(counts(contentionBreakdown(run, run.graph)), { pool: 1, token: 0, account: 0, unclassified: 1 });
});

test("hotspots group by exact location and count unique edge-attributed readers/writers", () => {
  const first = edge(token), second = { ...edge(token, "storage", 0, 2), kind: "RAW" };
  const run = report([first, second, edge(token, "storage", 1, 2, "0x" + "1".repeat(64))]);
  const result = contentionBreakdown(run, run.graph);
  assert.equal(result.hotspots.length, 2);
  assert.equal(result.hotspots[0].count, 2);
  assert.deepEqual(result.hotspots[0].writers, [0, 1]);
  assert.deepEqual(result.hotspots[0].readers, [2]);
  assert.deepEqual(result.hotspots[0].transactions, [0, 1, 2]);
});

test("cross-pool token conflict requires committed verified swaps and exact attributed access", () => {
  const run = report([edge(token)]);
  run.uniswap_swap_calls = [
    { pool: poolA, transaction_hash: hashes[0], committed: true, pool_verified: true, transaction_reverted: false, ancestor_failed: false },
    { pool: poolB, transaction_hash: hashes[1], committed: true, pool_verified: true, transaction_reverted: false, ancestor_failed: false },
  ];
  const finding = contentionBreakdown(run, run.graph).crossPool[0];
  assert.deepEqual(finding.poolAddresses, [poolA, poolB]);
  assert.equal(finding.edge.location.key, key);
  assert.deepEqual(finding.transactionHashes, hashes.slice(0, 2));
  run.transaction_access[1].writes = [{ ...edge(token, "storage", 0, 1, "0x" + "1".repeat(64)).location }];
  assert.equal(contentionBreakdown(run, run.graph).crossPool.length, 0, "shared token address alone must not count");
  run.transaction_access[1].writes = [edge(token).location];
  run.uniswap_swap_calls[1].committed = false;
  assert.equal(contentionBreakdown(run, run.graph).crossPool.length, 0);
  run.uniswap_swap_calls[1].committed = true;
  run.uniswap_swap_calls[1].pool = poolA;
  assert.equal(contentionBreakdown(run, run.graph).crossPool.length, 0, "same-pool swaps are not cross-pool");
});

test("empty graphs preserve unknown denominator and cannot invent a cross-pool finding", () => {
  const run = report();
  const result = contentionBreakdown(run, run.graph);
  assert.equal(result.total, 0);
  assert.ok(result.categories.every(category => category.count === 0 && category.share === null));
  assert.deepEqual(result.hotspots, []);
  assert.deepEqual(result.crossPool, []);
});
