import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { gasM, num } from "@/lib/format";
import type { TourData } from "./types";
import { Bars, Card, CardHead, Chip, Stat, Tip, ViewHead, useScrub } from "./ui";
import s from "./anim.module.css";

// Log scale, 10K to 100M gas: the smallest tx here (12,000) still shows, the largest (55.7M) nearly tops out.
const LO = 4;
const HI = 8;
const height = (gas: number) => Math.max(1.5, ((Math.log10(gas) - LO) / (HI - LO)) * 100);
const GRID = [
  { at: 25, label: "100K" },
  { at: 50, label: "1M" },
  { at: 75, label: "10M" },
  { at: 100, label: "100M" },
];

export function Xray({ x }: { x: TourData["xray"] }) {
  const n = x.gas.length;
  const { active, props } = useScrub(n, x.cap);
  const creates = new Set(x.creates);
  const kind = (i: number) => (creates.has(i) ? "contract creation" : "call");
  const extra = x.receipts - x.header;
  const capH = height(x.gas[x.cap]);
  const capX = ((x.cap + 0.5) / n) * 100;
  const shown = active ?? x.cap;

  return (
    <div className="flex h-full flex-col gap-4 p-4 @2xl:p-5">
      <ViewHead
        title="Block X-ray"
        sub="Gas per transaction, receipts against the header."
        aside={
          <>
            {x.slot !== null && <Chip>slot {num(x.slot)}</Chip>}
            {x.builder !== null && <Chip>builder #{x.builder}</Chip>}
            {x.extra && <Chip className="hidden @4xl:inline-flex">{x.extra}</Chip>}
          </>
        }
      />
      <Card className="flex min-h-0 flex-1 flex-col p-4">
        <CardHead
          title={
            <>
              Block <span className="font-mono">{num(x.number)}</span>{" "}
              <span className="ml-1 hidden font-mono text-[11px] font-normal text-fg-3 @md:inline">{x.hash}</span>
            </>
          }
          meta={
            <>
              <span className="hidden @2xl:inline">{n} txs · gas per tx, </span>log scale
            </>
          }
        />

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 @2xl:grid-cols-4 @2xl:gap-x-0 @2xl:divide-x">
          <Stat
            label="Header gas used"
            value={num(x.header)}
            note={
              <Meter
                value={x.header}
                of={x.limit}
                label={
                  <>
                    of {+(x.limit / 1e6).toFixed(1)}M<span className="hidden @sm:inline"> limit</span>
                  </>
                }
              />
            }
          />
          <Stat
            label="Receipt gas sum"
            value={num(x.receipts)}
            note={
              <Meter
                value={x.receipts}
                of={x.limit}
                label={
                  <>
                    {extra >= 0 ? "+" : "-"}
                    {gasM(Math.abs(extra))}
                    <span className="hidden @4xl:inline"> vs header</span>
                  </>
                }
                delay="0.25s"
              />
            }
            className="@2xl:pl-4"
          />
          <Stat label="Transactions" value={num(n)} note={`${x.creates.length} contract creations`} className="hidden @2xl:block @2xl:pl-4" />
          <Stat
            label="Largest tx"
            value={<span className="text-acc">{num(x.gas[x.cap])}</span>}
            note={
              <>
                tx {x.cap} · {creates.has(x.cap) ? <><span className="hidden @4xl:inline">contract </span>creation</> : "call"}
              </>
            }
            className="hidden @2xl:block @2xl:pl-4"
          />
        </div>

        {/* Chart: y gridlines, 134 bars, the capping tx in the accent with a callout, a tooltip while scrubbing. */}
        <div className="relative mt-5 min-h-[120px] flex-1 pl-9">
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 right-0">
            {GRID.map((g) => (
              <div key={g.label} className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${g.at}%` }}>
                <span className={cx("w-7 translate-y-1/2 text-right font-mono text-[10.5px] leading-none text-fg-3", g.at === 100 && "invisible @2xl:visible")}>
                  {g.label}
                </span>
                <span className="h-px flex-1 translate-y-1/2 bg-line" />
              </div>
            ))}
            <div className="absolute bottom-0 left-9 right-0 h-px bg-line-strong" />
          </div>

          <div
            {...props}
            aria-label={`Gas used per transaction in block ${num(x.number)}`}
            aria-valuetext={`tx ${shown}: ${num(x.gas[shown])} gas, ${kind(shown)}`}
            className="relative h-full touch-pan-y rounded-sm"
          >
            {/* Resting bars at fg/40: 3.6:1 on surface-2 (WCAG 1.4.11). */}
            <Bars heights={x.gas.map(height)} accent={x.cap} active={active} rest="fill-fg/40" dim="fill-fg/[0.14]" className={s.chart} />
          </div>

          {/* The callout for the capping tx; it gives way to the tooltip while another bar is inspected. */}
          <div
            aria-hidden="true"
            className={cx(
              // Narrow panes: the callout sits left of the bar so it stays inside the card.
              "pointer-events-none absolute flex -translate-x-full flex-row-reverse items-center transition-opacity duration-150 @4xl:translate-x-0 @4xl:flex-row",
              active !== null && active !== x.cap ? "opacity-0" : "opacity-100",
            )}
            style={{ left: `calc(2.25rem + (100% - 2.25rem) * ${capX / 100})`, bottom: `calc(${capH}% - 9px)` }}
          >
            <span className="mx-1 h-px w-4 bg-acc/70" />
            <span className="whitespace-nowrap rounded-md border border-line-strong bg-bg/95 px-2 py-0.5 font-mono text-[11px] leading-[18px] text-fg-2">
              tx {x.cap} · <span className="hidden @2xl:inline">{kind(x.cap)} · </span><span className="text-acc">{gasM(x.gas[x.cap])} gas</span>
            </span>
          </div>

          {active !== null && active !== x.cap && (
            <div className="pointer-events-none absolute inset-y-0 left-9 right-0">
              <Tip x={((active + 0.5) / n) * 100} bottom={`calc(${height(x.gas[active])}% + 10px)`}>
                <div className="flex justify-between gap-4">
                  <span className="text-fg">tx {active}</span>
                  <span>{kind(active)}</span>
                </div>
                <div className="text-fg">{num(x.gas[active])} gas</div>
                <div>{x.hashes[active]}</div>
              </Tip>
            </div>
          )}
        </div>

        <div aria-hidden="true" className="mt-2 flex justify-between pl-9 font-mono text-[10.5px] leading-4 text-fg-3">
          <span>tx 0</span>
          <span className="hidden @2xl:inline">hover or use arrow keys to inspect</span>
          <span>tx {n - 1}</span>
        </div>
        <p className="mt-3 hidden border-t pt-3 text-[12px] leading-5 text-fg-3 @2xl:block">
          <span className="text-fg-2">EIP-8037</span> meters execution and state gas separately: the header keeps the larger sum, receipts charge both.
        </p>
      </Card>
    </div>
  );
}

function Meter({ value, of, label, delay }: { value: number; of: number; label: ReactNode; delay?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="relative h-1 w-7 shrink-0 overflow-hidden rounded-full bg-fg/[0.08] @2xl:w-10">
        <span
          className={cx(s.meter, "absolute inset-y-0 left-0 rounded-full bg-fg-2")}
          style={{ width: `${Math.min(100, (value / of) * 100)}%`, "--d": delay ?? "0.1s" } as CSSProperties}
        />
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}
