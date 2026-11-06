import type { ConflictEdge, Graph, Location, Run } from "./data";
import { corroboratesConflict } from "./conflict-explanation";

export const contentionCategories = [
  { id: "pool", label: "Verified pool storage" },
  { id: "token", label: "Identified token storage" },
  { id: "account", label: "Shared account effects" },
  { id: "unclassified", label: "Unclassified locations" },
] as const;
export type ContentionCategory = typeof contentionCategories[number]["id"];
const addressPattern = /^0x[0-9a-f]{40}$/i;
const keyPattern = /^0x[0-9a-f]{64}$/i;
const locationID = (location: Location) => `${location.address.toLowerCase()}:${location.field}:${(location.key || "").toLowerCase()}`;
const validEdge = (edge: ConflictEdge) => Number.isSafeInteger(edge.from) && Number.isSafeInteger(edge.to) &&
  edge.from >= 0 && edge.to > edge.from && ["RAW", "WAR", "WAW"].includes(edge.kind);

export function contentionBreakdown(run: Run, graph: Graph, focus: number | null = null) {
  const pools = new Map(run.uniswap_pools.filter(pool => pool.verified && addressPattern.test(pool.address)).map(pool => [pool.address.toLowerCase(), pool]));
  const tokens = new Set([...pools.values()].flatMap(pool => [pool.token0, pool.token1]).filter(token => addressPattern.test(token)).map(token => token.toLowerCase()));
  const edges = graph.edges.filter(edge => focus == null || edge.from === focus || edge.to === focus);
  const classify = (edge: ConflictEdge): ContentionCategory => {
    if (!validEdge(edge) || !addressPattern.test(edge.location.address)) return "unclassified";
    // Account fields are classified before protocol identity. A pool's balance
    // overlap remains an account effect; it is not a pool-storage overlap.
    if (["balance", "nonce", "code"].includes(edge.location.field)) return "account";
    if (edge.location.field !== "storage" || !keyPattern.test(edge.location.key || "")) return "unclassified";
    const address = edge.location.address.toLowerCase();
    // Pool wins if metadata happens to identify an address in both sets.
    if (pools.has(address)) return "pool";
    if (tokens.has(address)) return "token";
    return "unclassified";
  };
  const categories = contentionCategories.map(category => ({ ...category, count: 0, share: null as number | null }));
  type Hotspot = { id: string; category: ContentionCategory; location: Location; count: number; readers: Set<number>; writers: Set<number>; transactions: Set<number>; kinds: Record<string, number> };
  const locations = new Map<string, Hotspot>();
  const categorized = edges.map(edge => {
    const category = classify(edge);
    categories.find(item => item.id === category)!.count++;
    const id = locationID(edge.location);
    let hotspot = locations.get(id);
    if (!hotspot) {
      hotspot = { id, category, location: edge.location, count: 0, readers: new Set(), writers: new Set(), transactions: new Set(), kinds: Object.create(null) };
      locations.set(id, hotspot);
    }
    // Invalid legacy records still count in the denominator and stay unclassified.
    if (category === "unclassified") hotspot.category = "unclassified";
    hotspot.count++;
    hotspot.kinds[edge.kind] = (hotspot.kinds[edge.kind] || 0) + 1;
    if (validEdge(edge)) {
      hotspot.transactions.add(edge.from); hotspot.transactions.add(edge.to);
      if (edge.kind === "RAW") { hotspot.writers.add(edge.from); hotspot.readers.add(edge.to); }
      if (edge.kind === "WAR") { hotspot.readers.add(edge.from); hotspot.writers.add(edge.to); }
      if (edge.kind === "WAW") { hotspot.writers.add(edge.from); hotspot.writers.add(edge.to); }
    }
    return { edge, category };
  });
  for (const category of categories) category.share = edges.length ? category.count / edges.length : null;
  const hotspots = [...locations.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).map(location => ({
    ...location, readers: [...location.readers].sort((a, b) => a - b), writers: [...location.writers].sort((a, b) => a - b), transactions: [...location.transactions].sort((a, b) => a - b),
  }));
  const transactionPools = new Map<string, Set<string>>();
  const remember = (hash: string, pool: string) => {
    if (!pools.has(pool.toLowerCase())) return;
    const addresses = transactionPools.get(hash.toLowerCase()) || new Set<string>();
    addresses.add(pool.toLowerCase()); transactionPools.set(hash.toLowerCase(), addresses);
  };
  for (const swap of run.uniswap_swaps) if (swap.pool_verified) remember(swap.transaction_hash, swap.pool);
  for (const call of run.uniswap_swap_calls) if (call.pool_verified && call.committed) remember(call.transaction_hash, call.pool);
  const crossPool = categorized.flatMap(({ edge, category }) => {
    if (category !== "token") return [];
    const first = run.block.transactions[edge.from]?.hash, second = run.block.transactions[edge.to]?.hash;
    const a = [...(transactionPools.get(first?.toLowerCase()) || [])].sort();
    const b = [...(transactionPools.get(second?.toLowerCase()) || [])].sort();
    const distinct = a.flatMap(from => b.filter(to => from !== to).map(to => [from, to] as const))[0];
    if (!distinct || !corroboratesConflict(run, edge)) return [];
    return [{
      edge, transactionHashes: [first, second], poolAddresses: distinct,
      transactionAccess: run.transaction_access.filter(access => access.index === edge.from || access.index === edge.to),
      verifiedPools: distinct.map(address => pools.get(address)),
      swapEvents: run.uniswap_swaps.filter(swap => swap.pool_verified && (swap.transaction_hash.toLowerCase() === first.toLowerCase() || swap.transaction_hash.toLowerCase() === second.toLowerCase())),
      swapCalls: run.uniswap_swap_calls.filter(call => call.pool_verified && call.committed && (call.transaction_hash.toLowerCase() === first.toLowerCase() || call.transaction_hash.toLowerCase() === second.toLowerCase())),
    }];
  });
  return { total: edges.length, graphTotal: graph.edges.length, focus, categories, hotspots, crossPool, categorized };
}
