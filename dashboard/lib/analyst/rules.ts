import type { Brief } from "../xray";

export const TRIGGERS = ["builder_gap", "gas_misleads", "big_block", "commitment"] as const;
export type Trigger = (typeof TRIGGERS)[number];
// The Go list route also returns the strict flag (equal-gas ties do not count), which lib/xray's Brief omits.
export type RuleInput = Brief & { gas_misidentifies_bottleneck?: boolean | null };

// Anomaly rules over one stored X-ray brief; a block gets an auto-brief when any fires. Missing ceilings never fire.
export function triggers(b: RuleInput): Trigger[] {
  const v = b.validator_bal_time, gas = b.gas_weighted, mv = b.builder_multiversion_time, dag = b.builder_dag_time;
  const out: Trigger[] = [];
  if (v != null && ((mv != null && mv < 0.8 * v) || (dag != null && dag < 0.7 * v))) out.push("builder_gap");
  if ((v != null && gas != null && (gas / v > 2 || gas / v < 0.5)) || b.gas_misidentifies_bottleneck === true) out.push("gas_misleads");
  if (b.transaction_count >= 250) out.push("big_block");
  if (b.commitment_verified === false) out.push("commitment");
  return out;
}

// The newest block that trips a rule and is not in done (block hash -> ms it was briefed or attempted), or null when
// none qualifies or perHour of done fall in the last hour. blocks come newest first, as the X-ray list returns them.
// gas_misleads fires on most Sepolia blocks, so a block that trips any other rule goes first.
export function nextBlock(blocks: RuleInput[], done: Map<string, number>, now: number, perHour: number) {
  if ([...done.values()].filter(t => t > now - 3_600_000).length >= perHour) return null;
  const fired = blocks.filter(b => !done.has(b.block_hash)).map(block => ({ block, triggers: triggers(block) })).filter(c => c.triggers.length);
  return fired.find(c => c.triggers.some(t => t !== "gas_misleads")) ?? fired[0] ?? null;
}
