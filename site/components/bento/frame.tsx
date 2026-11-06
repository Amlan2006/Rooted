import type { CSSProperties } from "react";
import { num, shortHash } from "@/lib/format";
import { cx } from "@/lib/cx";
import { Check, Panel, Verified } from "./panel";
import { frame } from "./evidence";
import s from "./bento.module.css";

/** One frame transaction as Rooted archived it: admission rule checks, the admitted → included events, the receipt check. */
export function FrameMini() {
  const f = frame;
  return (
    <Panel crumb="Frame mempool" title={<span className="font-mono">{shortHash(f.tx_hash)}</span>} meta={<span className="md:max-lg:hidden">{f.frames} frames</span>} className="lg:h-[244px]">
      <div className="flex flex-1 flex-col px-4 pt-3.5 pb-4 font-mono text-[12px]">
        <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-fg-2 sm:gap-x-4" aria-label="Admission rule checks">
          {f.checks.map((rule, i) => (
            <li key={rule} className="flex min-w-0 items-center gap-2">
              <span className={cx(s.tick, "text-fg-2")} style={{ "--i": i } as CSSProperties}>
                <Check />
              </span>
              <span className="truncate">{rule}</span>
              <span className="sr-only">pass</span>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-[11px] text-fg-3">
          +{f.checks_total - f.checks.length} more checks · {f.checks_passed} of {f.checks_total} pass
        </p>

        <div className="mt-auto border-t pt-3">
          <p className="flex items-center gap-2 text-[11px]">
            <span className="shrink-0 text-fg-2">admitted</span>
            <span className="relative h-px min-w-[76px] flex-1 bg-line-strong">
              <span className="absolute top-1/2 left-1/2 -translate-1/2 bg-surface-1 px-1.5 text-[11px] leading-none whitespace-nowrap text-fg-3">{num(f.admission_to_inclusion_ms)} ms</span>
            </span>
            <span className="shrink-0 text-fg-2">included</span>
          </p>
          {/* The archive's own event sequence numbers, not block or mempool positions. */}
          <p className="mt-1 flex justify-between text-[11px] text-fg-3">
            <span>event {f.admitted_seq}</span>
            <span>event {f.included_seq}</span>
          </p>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-fg-2">
              <span className="max-[359px]:hidden">type {f.receipt_type} · </span>block {num(f.receipt_block)}
            </span>
            {f.canonical && <Verified>canonical</Verified>}
          </div>
        </div>
      </div>
    </Panel>
  );
}
