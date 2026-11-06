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
export function nextBlock(blocks: RuleInput[], done: Map<string, number>, now: number, perHour: number) {
  if ([...done.values()].filter(t => t > now - 3_600_000).length >= perHour) return null;
  for (const block of blocks) {
    const fired = done.has(block.block_hash) ? [] : triggers(block);
    if (fired.length) return { block, triggers: fired };
  }
  return null;
}
