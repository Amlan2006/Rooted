// Shrinks tool results to the fields a decision needs, deterministically, under CAP characters of JSON.
import type { Report } from "../xray";
import { xrayLink } from "./evidence";
import type { RuleInput } from "./rules";

export const CAP = 6000;
const record = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;

function xray(body: unknown) {
  const r = record(record(body).data) as unknown as Report;
  if (!r.block || !r.ceilings) return body;
  const capping = [...new Set(Object.values(r.ceilings).map(c => c?.capping_tx_index).filter((i): i is number => i != null))].sort((a, b) => a - b);
  const tx = r.transactions ?? [];
  return {
    block: { number: r.block.number, hash: r.block.hash, slot: r.block.slot, transaction_count: r.block.transaction_count, gas_limit: r.block.gas_limit, fee_recipient: r.block.fee_recipient },
    computed_at: r.computed_at,
    gas: r.gas,
    commitment_verified: r.bal?.commitment_verified ?? null,
    bal_accounts: r.bal?.accounts ?? null,
    ceilings: Object.fromEntries(Object.entries(r.ceilings).map(([k, c]) => [k, c && { value: c.value, weight: c.weight, total: c.total, bottleneck: c.bottleneck, capping_tx_index: c.capping_tx_index, critical_path_length: c.critical_path?.length ?? null }])),
    capping_txs: capping.map(i => tx[i]).filter(Boolean).map(t => ({ index: t.index, hash: t.hash, to: t.to, gas_used: t.gas_used, execution_gas: t.execution_gas ?? null, state_gas: t.state_gas ?? null, apply_ns_median: t.apply_ns_median, reads: t.reads, writes: t.writes, depends_on: t.depends_on.length })),
    critical_path: r.ceilings.builder_dag_time?.critical_path ?? null,
    speedup: r.schedules && { cores: r.schedules.cores, validator_bal_time: r.schedules.validator_bal_time, builder_dag_time: r.schedules.builder_dag_time },
    edges: r.edges,
    independent_transactions: r.independent_transactions,
    hot_locations: [...(r.hot_locations ?? [])].sort((a, b) => b.edges - a.edges).slice(0, 10),
    uniswap: r.uniswap,
    epbs: r.epbs,
    replay: r.replay && { timing: r.replay.timing ?? null, samples: r.replay.samples, cpu_model: r.replay.cpu_model, median_apply_ns: r.replay.median_apply_ns },
    coverage: r.coverage,
  };
}

const briefKeys = ["block_number", "block_hash", "slot", "transaction_count", "commitment_verified", "gas_weighted", "execution_gas_weighted", "validator_bal_time", "builder_multiversion_time", "builder_dag_time", "gas_capping_tx_index", "validator_capping_tx_index", "gas_misidentifies_bottleneck", "builder_critical_path_length"] as const;
// Columns once, then one array per block: a live run lost 35 of 50 requested blocks to the cap as keyed objects.
// The gas / validator ratio is precomputed: a live answer ranked blocks wrongly by its own arithmetic.
const blocks = (body: unknown) => {
  const rows = record(body).data;
  return Array.isArray(rows) ? {
    columns: [...briefKeys, "gas_to_validator_ratio"],
    rows: rows.map((b: RuleInput) => [...briefKeys.map(k => b[k] ?? null), b.gas_weighted != null && b.validator_bal_time ? b.gas_weighted / b.validator_bal_time : null]),
  } : body;
};

// Each block carries its X-ray view link, so every block the answer names can be opened.
const uniswap = (body: unknown) => {
  const d = record(record(body).data);
  return Array.isArray(d.blocks) ? { ...d, blocks: d.blocks.map((b: { block_hash: string }) => ({ ...b, link: xrayLink(b.block_hash) })) } : body;
};

// Deep copy with ratios rounded to 3 decimals and long strings cut, so small float noise never changes the output.
function compact(v: unknown): unknown {
  if (typeof v === "number") return Number.isInteger(v) ? v : Math.round(v * 1000) / 1000;
  if (typeof v === "string") return v.length > 400 ? v.slice(0, 400) + "…" : v;
  if (Array.isArray(v)) return v.map(compact);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x)]));
  return v;
}

// The array (with items left to drop) that serializes largest; the first one wins a tie, so the result is stable.
function largest(x: unknown, droppable: (a: unknown[]) => boolean): { arr: unknown[]; size: number } | null {
  const children = Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : [];
  let best = Array.isArray(x) && droppable(x) ? { arr: x, size: JSON.stringify(x).length } : null;
  for (const child of children) {
    const found = largest(child, droppable);
    if (found && (!best || found.size > best.size)) best = found;
  }
  return best;
}

// Drops tail items from the largest array (half of it while far over the cap, then one at a time), leaving a
// "… N more omitted" marker.
export function fit(value: unknown, cap = CAP): unknown {
  const v = compact(value), omitted = new Map<unknown[], number>();
  const real = (a: unknown[]) => a.length - (omitted.has(a) ? 1 : 0);
  for (let text = JSON.stringify(v) ?? "null"; text.length > cap; text = JSON.stringify(v)) {
    const arr = largest(v, a => real(a) > 0)?.arr;
    if (!arr) { // nothing left to drop: fall back to a cut string
      let cut = text.slice(0, cap - 40);
      while (JSON.stringify(cut + "…").length > cap) cut = cut.slice(0, -100);
      return cut + "…";
    }
    const keep = real(arr), drop = text.length > 2 * cap ? Math.ceil(keep / 2) : 1, n = (omitted.get(arr) ?? 0) + drop;
    arr.length = keep - drop;
    arr.push(`… ${n} more omitted`);
    omitted.set(arr, n);
  }
  return v;
}

export function trim(tool: string, data: unknown): unknown {
  if (tool === "get_block_xray" || tool === "run_block_xray") return fit(xray(data));
  if (tool === "recent_blocks") return fit(blocks(data), 2 * CAP); // the 50-block maximum fits in about 9 KB
  if (tool === "uniswap_contention") return fit(uniswap(data), 2 * CAP); // about 500 bytes per block with one pool
  return fit(data);
}
