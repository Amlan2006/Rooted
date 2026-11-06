// Glamsterdam X-ray (schema rooted-xray-v1, spec §1). Gas is a gas count, time is ns, null = unavailable.
export type Ceiling = { model: string; weight: "gas" | "ns"; value: number | null; total: number | null; bottleneck: number | null; capping_tx_index: number | null; critical_path?: number[] };
export type XrayTx = { index: number; hash: string; from: string; to: string | null; is_create: boolean; status: number; gas_used: number; apply_ns_median: number | null; reads: number; writes: number; depends_on: number[] };
export type HotLocation = { address: string; field: string; key: string; writers: number; readers: number; edges: number; on_critical_path: boolean; label: { protocol: string; name: string; pool: string; verified: boolean } | null };
export type EPBS = { slot: number; beacon_block_root: string; builder_index: string; source: string; self_build: boolean | null; status: string | null; delivery: string | null; reveal_latency_ms: number | null; ptc_payload_yes: number | null; ptc_payload_no: number | null; ptc_timely: boolean | null; canonical: boolean | null };
export type Report = {
  schema: "rooted-xray-v1"; network: string; computed_at: string; source: string; profile_id: string | null;
  block: { number: number; hash: string; parent_hash: string; timestamp: number; slot: number | null; beacon_block_root: string | null; parent_beacon_block_root: string; fee_recipient: string; gas_limit: number; transaction_count: number };
  gas: { header_gas_used: number; receipts_gas_sum: number; differs: boolean };
  bal: { commitment: string; computed_commitment: string; commitment_verified: boolean; accounts: number; source: string; schema: string };
  transactions: XrayTx[];
  edges: { RAW: number; WAR: number; WAW: number; total: number; dependent_pairs: number; truncated: boolean };
  independent_transactions: number;
  ceilings: { gas_weighted: Ceiling; validator_bal_time: Ceiling; builder_dag_time: Ceiling };
  schedules: { cores: number[]; validator_bal_time: number[] | null; builder_dag_time: number[] | null };
  hot_locations: HotLocation[];
  uniswap: { v3_swap_transactions: number; v4_swap_transactions: number; labeled_edges: number };
  epbs: EPBS | null;
  replay: { runner: string; geth_library: string; cpu_model: string; logical_cpus: number; samples: number; median_apply_ns: number } | null;
  excluded_addresses: string[];
  coverage: string[];
};
export type Brief = {
  block_hash: string; block_number: number; slot: number | null; computed_at: string; source: string; transaction_count: number;
  header_gas_used: number; receipts_gas_sum: number; commitment_verified: boolean;
  gas_weighted: number | null; validator_bal_time: number | null; builder_dag_time: number | null;
  gas_capping_tx_index: number | null; validator_capping_tx_index: number | null; builder_critical_path_length: number | null;
  speedup_8_validator: number | null; speedup_8_builder: number | null; builder_index: string | null;
};
type Spread = { p10: number; median: number; p90: number } | null;
export type Summary = {
  blocks: number; from_block: number | null; to_block: number | null;
  ceilings: { gas_weighted: Spread; validator_bal_time: Spread; builder_dag_time: Spread };
  single_tx_bound_share: number | null; gas_misidentifies_bottleneck_share: number | null; commitment_verified_share: number | null;
  speedup_8: { validator_median: number | null; builder_median: number | null };
};
const isHash = (v: unknown) => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);
const record = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, never>;
export function parseReport(v: unknown): Report {
  const r = record(v) as unknown as Report;
  if (r.schema !== "rooted-xray-v1") throw Error("Unsupported X-ray report schema.");
  if (!isHash(r.block?.hash)) throw Error("X-ray block hash must be a lowercase 32-byte hex hash.");
  if (!Array.isArray(r.transactions) || r.transactions.length !== r.block.transaction_count || r.transactions.some((t, i) => t.index !== i || !Array.isArray(t.depends_on)))
    throw Error("X-ray transaction rows do not match the block transaction count.");
  const c = r.ceilings;
  if (!c || [c.gas_weighted, c.validator_bal_time, c.builder_dag_time].some(x => !x || (x.value != null && !(x.value >= 1))))
    throw Error("X-ray ceilings must be at least 1.");
  const s = r.schedules;
  if (s?.cores?.length !== 5 || [s.validator_bal_time, s.builder_dag_time].some(x => x != null && x.length !== 5))
    throw Error("X-ray schedules must cover exactly 5 core counts.");
  if (!Array.isArray(r.hot_locations) || !Array.isArray(r.coverage)) throw Error("X-ray report is missing hot locations or coverage.");
  return r;
}
export function parseBriefs(v: unknown): Brief[] {
  if (!Array.isArray(v) || v.some(b => !isHash(record(b).block_hash))) throw Error("Invalid X-ray block list.");
  return v;
}
export function parseSummary(v: unknown): Summary {
  const s = record(v) as unknown as Summary;
  if (typeof s.blocks !== "number" || !s.ceilings || !s.speedup_8) throw Error("Invalid X-ray summary.");
  return s;
}
export function laneRows(r: Report) {
  const maxNs = Math.max(0, ...r.transactions.map(t => t.apply_ns_median ?? 0)), maxGas = Math.max(0, ...r.transactions.map(t => t.gas_used));
  const path = new Set(r.ceilings.builder_dag_time.critical_path ?? []);
  return r.transactions.map(t => ({
    index: t.index, hash: t.hash, gas: t.gas_used, ns: t.apply_ns_median,
    widthNs: t.apply_ns_median == null || !maxNs ? null : t.apply_ns_median / maxNs,
    widthGas: maxGas ? t.gas_used / maxGas : 0,
    validatorCap: t.index === r.ceilings.validator_bal_time.capping_tx_index,
    gasCap: t.index === r.ceilings.gas_weighted.capping_tx_index,
    onCriticalPath: path.has(t.index),
  }));
}
export const speedupSeries = (r: Report) =>
  r.schedules.cores.map((k, i) => ({ k, validator: r.schedules.validator_bal_time?.[i] ?? null, builder: r.schedules.builder_dag_time?.[i] ?? null }));
export const formatX = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) + "×" : "Unknown");
export function blockHashRequest(value: unknown): { block_hash: string } {
  const v = record(value) as Record<string, unknown>;
  const hash = typeof v.block_hash === "string" ? v.block_hash.trim().toLowerCase() : "";
  if (Object.keys(v).length !== 1 || !/^0x[0-9a-f]{64}$/.test(hash)) throw Error("Only an immutable 32-byte block hash is accepted.");
  return { block_hash: hash };
}
// x402 v2 PAYMENT-REQUIRED header: base64(JSON PaymentRequired). Read-only display of what an agent would be asked to pay.
export type PaymentTerms = { network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number | null };
export function paymentTerms(header: string | null): PaymentTerms[] {
  if (!header) return [];
  try {
    const body = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(header), c => c.charCodeAt(0))));
    return (Array.isArray(body.accepts) ? body.accepts : [])
      .filter((a: Record<string, unknown>) => ["network", "amount", "asset", "payTo"].every(k => typeof a?.[k] === "string") && /^\d+$/.test(a.amount as string))
      .map((a: PaymentTerms) => ({ network: a.network, amount: a.amount, asset: a.asset, payTo: a.payTo, maxTimeoutSeconds: typeof a.maxTimeoutSeconds === "number" ? a.maxTimeoutSeconds : null }));
  } catch { return []; }
}
const hederaAssets: Record<string, [string, number]> = { "0.0.0": ["HBAR", 8], "0.0.429274": ["USDC", 6] };
export function formatPrice(t: PaymentTerms) {
  const known = t.network.startsWith("hedera:") ? hederaAssets[t.asset] : undefined;
  return known ? `${Number(t.amount) / 10 ** known[1]} ${known[0]}` : `${t.amount} atomic units of ${t.asset}`;
}
