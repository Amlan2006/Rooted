export type Slot = {
  slot: string;
  block_root: string;
  payload_hash: string;
  builder_index: string;
  status: string;
  delivery: string;
  reveal_latency_ms: number | null;
  ptc_timely: boolean | null;
  blob_available: boolean | null;
  execution_valid: boolean | null;
  canonical: boolean | null;
  coverage: string[];
  updated_at: string;
  first_observed_at: string;
  source_id: string;
  mode: string;
  event_count: number;
};
export type Builder = {
  builder_index: string;
  observations: number;
  healthy: number;
  revealed: number;
  failed: number;
  unknown: number;
  timed_samples: number;
  healthy_ratio: number | null;
  reveal_ratio: number | null;
  p50_reveal_ms: number | null;
  p95_reveal_ms: number | null;
  self_build: boolean;
};
export type Alert = {
  slot: string;
  block_root: string;
  code: string;
  active: boolean;
  first_detected_at: string;
};
export type Frame = {
  tx_hash: string;
  network: string;
  mode: string;
  status: string;
  admission_confirmed: boolean;
  inclusion_confirmed: boolean;
  execution_success: boolean | null;
  admission_to_inclusion_ms: number | null;
  updated_at: string;
  coverage: string[];
  events: unknown[];
  admission?: {
    checks?: {
      name?: string;
      rule?: string;
      verdict: string;
      message?: string;
      detail?: string;
    }[];
  };
  receipt_check?: {
    identity_matched: boolean;
    canonical: boolean | null;
    checked_at: string;
  };
};
export type FrameNode = {
  chain_id: string;
  genesis_hash: string;
  poll_status: string;
  stream_status: string;
  updated_at: string;
};
export type Incident = {
  code: string;
  tx_hash: string;
  observed_at: string;
  node: string;
  mode: string;
};
export type Collector = {
  last_slot: string;
  last_success: string;
  stream_status: string;
  poll_status: string;
};
export type Location = { address: string; field: string; key?: string };
export type ConflictEdge = {
  from: number;
  to: number;
  kind: string;
  location: Location;
  basis?: string;
};
export type Graph = {
  edges: ConflictEdge[];
  truncated?: boolean;
  observed_conflict_counts: Record<string, number>;
  observed_layers: number[][];
  observed_dependency_depth: number;
  observed_max_layer_width: number;
  full_dependency_coverage: boolean;
  storage_read_coverage_complete: boolean;
  theoretical_speedup: number | null;
  coverage: string[];
};
export type Run = {
  analyzed_transactions?: { transaction: { hash: string } }[];
  id: string;
  network: string;
  mode: string;
  chain_id: string;
  created_at: string;
  canonical_at_fetch: boolean | null;
  block: { hash: string; number: string; slotNumber?: string; transactions: { hash: string }[] };
  native_bal: {
    commitment_verified: boolean | null;
    accounts: number;
    computed_commitment: string;
    changes?: (Location & {
      transaction_index: number | null;
      phase: string;
      source: string;
      post_value: string;
    })[];
  } | null;
  graph: Graph;
  storage_projection: Graph;
  coverage: string[];
  sources: { kind: string; origin: string; fetched_at: string }[];
  uniswap_storage_labels?: Record<string, string>;
  uniswap_pools: {
    address: string;
    fee: number;
    token0: string;
    token1: string;
    verified: boolean;
  }[];
  uniswap_swaps: {
    pool: string;
    transaction_hash: string;
    amount0_raw: string;
    amount1_raw: string;
    tick: number;
    pool_verified: boolean;
  }[];
  uniswap_swap_calls: {
    pool: string;
    pool_verified?: boolean;
    transaction_hash: string;
    committed: boolean;
    transaction_reverted: boolean;
    ancestor_failed: boolean;
  }[];
  transaction_access: {
    index: number;
    hash: string;
    reads: Location[];
    writes: Location[];
    storage_reads_complete: boolean;
    coverage: string[];
  }[];
};
export const short = (value?: string | null) =>
  value
    ? value.length > 20
      ? value.slice(0, 10) + "…" + value.slice(-6)
      : value
    : "Unknown";
export const ms = (value: number | null | undefined) =>
  value == null ? "Unknown" : `${Math.round(value).toLocaleString()} ms`;
export const verdict = (value: boolean | null | undefined) =>
  value == null ? "Unknown" : value ? "Confirmed" : "Failed";
export const age = (value?: string | null) => {
  if (!value) return "Never";
  const sec = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (!Number.isFinite(sec)) return "Unknown";
  return sec < 60
    ? `${sec}s ago`
    : sec < 3600
      ? `${Math.floor(sec / 60)}m ago`
      : `${Math.floor(sec / 3600)}h ago`;
};
