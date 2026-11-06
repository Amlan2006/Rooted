import type { ConflictEdge, Location, Run } from "./data";

const sameLocation = (a: Location, b: Location) =>
  a.address.toLowerCase() === b.address.toLowerCase() &&
  a.field === b.field && (a.key || "").toLowerCase() === (b.key || "").toLowerCase();
const labels: Record<string, string> = {
  slot0_price_tick_and_lock: "pool price, tick, and lock state (slot0)",
  fee_growth_global_0: "global fee growth for token0",
  fee_growth_global_1: "global fee growth for token1",
  protocol_fees: "protocol fee state",
  active_liquidity: "active liquidity",
};
const relations: Record<string, { name: string; first: "reads" | "writes"; second: "reads" | "writes" }> = {
  RAW: { name: "Read after write", first: "writes", second: "reads" },
  WAR: { name: "Write after read", first: "reads", second: "writes" },
  WAW: { name: "Write after write", first: "writes", second: "writes" },
};

export function corroboratesConflict(run: Run, edge: ConflictEdge): boolean {
  const relation = Object.hasOwn(relations, edge.kind) ? relations[edge.kind] : undefined;
  const accesses = [edge.from, edge.to].map(index => run.transaction_access.find(tx => tx.index === index));
  const hashes = [edge.from, edge.to].map(index => run.block.transactions[index]?.hash);
  return !!relation && Number.isSafeInteger(edge.from) && Number.isSafeInteger(edge.to) &&
    edge.from >= 0 && edge.from < edge.to && accesses.every((tx, index) =>
      tx && hashes[index] && tx.hash.toLowerCase() === hashes[index].toLowerCase()) &&
    accesses[0]![relation.first].some(location => sameLocation(location, edge.location)) &&
    accesses[1]![relation.second].some(location => sameLocation(location, edge.location));
}

// Interpret only an existing edge and corroborating transaction access records.
// Pool semantics require verified metadata; an address match alone proves no read.
export function explainConflict(run: Run, edge: ConflictEdge) {
  const relation = Object.hasOwn(relations, edge.kind) ? relations[edge.kind] : undefined;
  const accesses = [edge.from, edge.to].map(index => run.transaction_access.find(tx => tx.index === index));
  const hashes = [edge.from, edge.to].map(index => run.block.transactions[index]?.hash);
  const supported = corroboratesConflict(run, edge);
  const pool = run.uniswap_pools.find(pool => pool.verified && pool.address.toLowerCase() === edge.location.address.toLowerCase());
  const labelKey = `${edge.location.address.toLowerCase()}:${edge.location.field}:${edge.location.key || ""}`;
  const storedLabel = run.uniswap_storage_labels?.[labelKey] || "";
  const storageLabel = pool && edge.location.field === "storage" && Object.hasOwn(labels, storedLabel)
    ? labels[storedLabel] : undefined;
  const locationName = edge.location.field === "storage"
    ? pool ? "storage location in a verified Uniswap v3 pool" : "storage location"
    : ["balance", "nonce", "code"].includes(edge.location.field) ? `account ${edge.location.field}` : "state location";
  const nativeChanges = (run.native_bal?.changes || []).filter(change =>
    change.phase === "transaction" && change.source === "native_bal" &&
    (change.transaction_index === edge.from || change.transaction_index === edge.to) && sameLocation(change, edge.location));
  const writeEvidence = [edge.from, edge.to].map((index, position) => {
    const action = position === 0 ? relation?.first : relation?.second;
    if (action !== "writes") return "Read attributed by the stored transaction analysis; not inferred from block-level BAL reads.";
    const verified = run.native_bal?.commitment_verified === true && nativeChanges.some(change => change.transaction_index === index);
    if (verified) return "Write backed by a commitment-verified native BAL change at this exact location.";
    return run.native_bal ? "Write attributed by the stored analysis; a verified native BAL change for this location is not established here."
      : "Committed write attributed by trace-based analysis; no native BAL commitment is available.";
  });
  return {
    supported,
    title: relation?.name || "Unsupported dependency type",
    explanation: supported && relation
      ? `Transaction ${edge.from} ${relation.first} this ${locationName}. Later in the block, transaction ${edge.to} ${relation.second} the same location. ${edge.kind === "RAW" ? "The later read follows the earlier write." : edge.kind === "WAR" ? "The earlier read precedes the later write." : "Both writes overlap in state."} This is an observed dependency in block order.`
      : "This stored edge cannot be corroborated with the transaction identities and access records in this report. Its meaning remains unconfirmed.",
    semanticLabel: storageLabel || "Exact storage meaning is unknown or not verified.",
    poolVerified: !!pool,
    hashes,
    actions: [relation?.first, relation?.second],
    evidenceNotes: supported ? writeEvidence : ["Supporting transaction access evidence is missing, inconsistent, or unsupported."],
    evidence: {
      report_id: run.id, network: run.network, mode: run.mode, chain_id: run.chain_id,
      block_hash: run.block.hash, analyzed_at: run.created_at,
      edge, transaction_hashes: hashes, transaction_access: accesses,
      matching_native_changes: nativeChanges,
      native_commitment_verified: run.native_bal?.commitment_verified ?? null,
      verified_pool: pool || null, sources: run.sources,
      coverage: run.coverage,
    },
  };
}
