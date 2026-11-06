import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { IconCheck } from "./icons";
import type { TourData } from "./types";
import { Bars, Card, CardHead, Chip, Tip, ViewHead, useScrub } from "./ui";
import s from "./anim.module.css";

/** BAL index → what it covers: 0 is pre-execution, 1..n are txs 0..n-1, n+1 is post-execution. */
const name = (i: number, last: number) => (i === 0 ? "pre-execution" : i === last ? "post-execution" : `tx ${i - 1}`);

export function AccessLists({ b, gas, number }: { b: TourData["bal"]; gas: number[]; number: number }) {
  const n = b.writesPer.length;
  const last = n - 1;
  const { active, props } = useScrub(n, 0);
  const maxW = Math.max(...b.writesPer);
  const maxA = Math.max(...b.accountsPer);
  const hot = b.writesPer.indexOf(maxW);
  const top = b.writesPer
    .map((w, i) => ({ i, w }))
    .filter((r) => r.i > 0 && r.i < last && r.w > 0)
    .sort((p, q) => q.w - p.w)
    .slice(0, 5);
  const shown = active ?? hot;

  return (
    <div className="flex h-full flex-col gap-4 p-4 @2xl:p-5">
      <ViewHead
        title="Access lists"
        sub="The EIP-7928 list from the payload envelope, decoded."
        aside={
          b.matches && (
            <Chip on>
              <IconCheck />
              hash matches header
            </Chip>
          )
        }
      />

      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line p-0 @2xl:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="col-span-2 bg-surface-2 px-4 py-3 @2xl:col-span-1">
          <div className="text-[12px] leading-4 text-fg-3">blockAccessListHash</div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="font-mono text-[15px] leading-6 tracking-[-0.01em] text-fg">{b.hash ?? "n/a"}</span>
            {b.matches && (
              <Chip on>
                <IconCheck />
                match
              </Chip>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[11px] leading-4 text-fg-3">keccak256 of {num(b.bytes)} bytes</div>
        </div>
        {[
          { label: "Accounts", value: num(b.accounts), note: `${num(b.readOnly)} read-only` },
          { label: "Storage writes", value: num(b.writes), note: `max ${maxW} in one tx` },
          { label: "Storage reads", value: num(b.reads), note: "block total" },
        ].map((c, i) => (
          <div key={c.label} className={cx("bg-surface-2 px-4 py-3", i === 2 && "hidden @2xl:block")}>
            <div className="text-[12px] leading-4 text-fg-3">{c.label}</div>
            <div className="mt-1.5 font-mono text-[17px] leading-6 tracking-[-0.02em] text-fg">{c.value}</div>
            <div className="mt-0.5 font-mono text-[11px] leading-4 text-fg-3">{c.note}</div>
          </div>
        ))}
      </Card>

      <div className="grid min-h-0 flex-1 gap-4 @2xl:grid-cols-[1fr_248px]">
        <Card className="flex min-h-0 flex-col p-4">
          <CardHead
            title={
              <>
                Per transaction<span className="hidden @md:inline"> · block <span className="font-mono">{num(number)}</span></span>
              </>
            }
            meta={`${n} indexes`}
          />
          <div className="mt-3 flex gap-4 text-[11px] leading-4 text-fg-3">
            <span className="flex items-center gap-1.5">
              <i aria-hidden="true" className="size-2 rounded-[2px] bg-fg/40" />
              slots written
            </span>
            <span className="flex items-center gap-1.5">
              <i aria-hidden="true" className="size-2 rounded-[2px] bg-fg/35" />
              accounts changed
            </span>
          </div>

          {/* Mirrored bars on one axis: writes up, changed accounts down. Linear scales; the busiest index in the accent. */}
          <div className="relative mt-3 min-h-[110px] flex-1">
            <div
              {...props}
              aria-label={`Storage writes and changed accounts per access-list index in block ${num(number)}`}
              aria-valuetext={`${name(shown, last)}: ${b.writesPer[shown]} slots written, ${b.accountsPer[shown]} accounts changed`}
              className="grid h-full touch-pan-y grid-rows-[3fr_1px_1fr] rounded-sm"
            >
              <Bars heights={b.writesPer.map((w) => (w ? Math.max(2, (w / maxW) * 100) : 0))} accent={hot} active={active} rest="fill-fg/40" dim="fill-fg/[0.16]" className={s.chart} />
              <div className="bg-line-strong" />
              {/* Under the axis at fg/35 (3.1:1 on surface-2), the inspected index brighter. */}
              <div className="pt-px">
                <Bars heights={b.accountsPer.map((a) => (a / maxA) * 100)} active={active} down rest="fill-fg/35" dim="fill-fg/35" on="fill-fg/75" className={s.chartDown} />
              </div>
            </div>

            <div
              aria-hidden="true"
              className={cx(
                "pointer-events-none absolute flex items-center whitespace-nowrap transition-opacity duration-150",
                hot / n > 0.5 ? "-translate-x-full flex-row-reverse" : "",
                active !== null && active !== hot ? "opacity-0" : "opacity-100",
              )}
              style={{ left: `${((hot + 0.5) / n) * 100}%`, top: 0 }}
            >
              <span className="mx-1 h-px w-3 bg-acc/70" />
              <span className="rounded-md border border-line-strong bg-bg/95 px-2 py-0.5 font-mono text-[11px] leading-[18px] text-fg-2">
                {name(hot, last)} · <span className="text-acc">{maxW} slots</span>
              </span>
            </div>

            {active !== null && active !== hot && (
              <Tip x={((active + 0.5) / n) * 100} bottom="calc(25% + 14px)">
                <div className="text-fg">{name(active, last)}</div>
                <div>
                  {b.writesPer[active]} slots · {b.accountsPer[active]} accounts
                </div>
              </Tip>
            )}
          </div>
          <div aria-hidden="true" className="mt-2 flex justify-between font-mono text-[10.5px] leading-4 text-fg-3">
            <span>pre</span>
            <span>tx 0 … tx {last - 2}</span>
            <span>post</span>
          </div>
        </Card>

        <Card className="hidden min-h-0 flex-col p-4 @2xl:flex">
          <CardHead title="Most storage writes" meta="tx · slots" />
          <ol className="mt-2">
            {top.map((r, k) => (
              <li key={r.i} className={cx(s.stagger, "flex h-[38px] items-center gap-3 border-t text-[12.5px]")} style={{ "--i": k } as CSSProperties}>
                <span className={cx("w-12 font-mono", r.i === hot ? "text-acc" : "text-fg")}>tx {r.i - 1}</span>
                <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-fg/[0.08]">
                  <span className={cx("absolute inset-y-0 left-0 rounded-full", r.i === hot ? "bg-acc" : "bg-fg-2")} style={{ width: `${(r.w / maxW) * 100}%` }} />
                </span>
                <span className="w-6 text-right font-mono text-fg">{r.w}</span>
              </li>
            ))}
          </ol>
          <p className="mt-auto border-t pt-3 font-mono text-[11px] leading-4 text-fg-3">
            tx {top[0].i - 1}: {num(gas[top[0].i - 1])} gas, {b.accountsPer[top[0].i]} accounts changed
          </p>
        </Card>
      </div>
    </div>
  );
}
