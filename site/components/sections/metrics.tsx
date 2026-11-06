import type { ReactNode } from "react";
import { Section } from "@/components/ui/section";
import { ArrowUpRight } from "@/components/ui/icons";
import { SourceLine } from "@/components/ui/mono";
import { CountUp } from "@/components/motion";
import { Reveal } from "@/components/reveal";
import { Grow } from "@/components/reveal";
import { epbs, heroBlock } from "@/lib/data";
import { gasM, num } from "@/lib/format";
import { cx } from "@/lib/cx";

const EIP_8037 = "https://eips.ethereum.org/EIPS/eip-8037";
// Axis length only: SECONDS_PER_SLOT is a protocol constant, not a measurement.
const SLOT_MS = 12_000;
const pct = (f: number) => `${Math.min(1, f) * 100}%`;

type Figure = {
  label: string;
  value: number;
  format?: "int" | "gasM";
  unit?: string;
  /** Bar fill as a fraction of the scale named in `scale`. */
  fill: number;
  /** A reference tick on the same scale, captioned above the bar. */
  tick?: { at: number; name: string; label: string };
  scale: string;
  acc?: boolean;
  /** Two short lines: what the figure belongs to, then context. */
  note: [ReactNode, ReactNode];
};

/** Four figures from the snapshot, each on its own scale, then what the two gas figures mean. */
export function Metrics() {
  const b = heroBlock;
  const o = epbs.offsets_ms;
  const t = epbs.included_ptc;
  const over = b.receipts_gas_sum - b.header_gas_used;
  const figures: Figure[] = [
    {
      label: "Header gas used",
      value: b.header_gas_used,
      format: "gasM",
      fill: b.header_gas_used / b.gas_limit,
      scale: `${gasM(b.gas_limit)} gas limit`,
      note: [`block ${num(b.number)}`, `${((b.header_gas_used / b.gas_limit) * 100).toFixed(1)}% of limit`],
    },
    {
      label: "Receipt gas, summed",
      value: b.receipts_gas_sum,
      format: "gasM",
      fill: b.receipts_gas_sum / b.gas_limit,
      tick: { at: b.header_gas_used / b.gas_limit, name: "header", label: "header" },
      scale: `${gasM(b.gas_limit)} gas limit`,
      note: ["same block", `${over >= 0 ? "+" : "−"}${gasM(Math.abs(over))} vs header`],
    },
    {
      label: "Payload available",
      value: o.execution_payload_available,
      unit: "ms",
      fill: o.execution_payload_available / SLOT_MS,
      tick: { at: epbs.deadlines_ms.payload / SLOT_MS, name: "payload deadline", label: `${epbs.deadlines_ms.payload / 1000} s deadline` },
      scale: "12 s slot",
      note: [`slot ${num(epbs.slot)}`, "at our node"],
    },
    {
      label: "Payload-present votes",
      value: t.payload_present_votes,
      unit: `/ ${num(t.ptc_size)}`,
      fill: t.payload_present_votes / t.ptc_size,
      scale: `${num(t.ptc_size)} committee seats`,
      acc: true,
      // The tally is for the slot PayloadWatch measured, carried by the next slot's block.
      note: [`slot ${num(epbs.slot)}`, `included in ${num(t.slot)}`],
    },
  ];

  return (
    <Section id="metrics" aria-labelledby="metrics-title">
      {/* Hairlines are the 1px gaps over opaque cells; bg-clip-padding keeps the top and bottom rules the same weight. */}
      <Reveal>
      <dl className="grid grid-cols-2 gap-px border-y bg-line bg-clip-padding lg:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="bg-bg py-6 odd:pr-4 even:pl-4 sm:py-8 sm:odd:pr-6 sm:even:pl-6 lg:pr-7 lg:even:pl-7 lg:[&:nth-child(3)]:pl-7">
            <dt className="text-[13px] leading-5 text-fg-2">{f.label}</dt>
            {/* Display figures are Geist sans with tabular digits (a mono point takes a full cell and reads as code). */}
            <dd className="mt-3 text-[32px] font-semibold leading-none tracking-[-0.045em] whitespace-nowrap tabular-nums text-fg sm:text-[44px] xl:text-[52px]">
              <CountUp value={f.value} format={f.format} />
              {f.unit && <span className="ml-[0.3em] text-[15px] font-medium tracking-[-0.01em] text-fg-3 sm:text-[19px]">{f.unit}</span>}
            </dd>
            <dd className="relative mt-8 h-[2px] rounded-full bg-fg/[0.08]">
              <Grow className={cx("absolute inset-y-0 left-0 block rounded-full", f.acc ? "bg-acc" : "bg-fg/55")} style={{ width: pct(f.fill) }} />
              {f.tick && (
                <span aria-hidden="true" className="absolute bottom-0 h-[9px] w-px bg-fg-2" style={{ left: pct(f.tick.at) }}>
                  <span className="absolute bottom-[3px] left-1.5 font-mono text-[11px] leading-none whitespace-nowrap text-fg-3">{f.tick.label}</span>
                </span>
              )}
              <span className="sr-only">
                {(f.fill * 100).toFixed(1)}% of the {f.scale}
                {f.tick && `; the ${f.tick.name} is at ${(f.tick.at * 100).toFixed(1)}%`}
              </span>
            </dd>
            <dd className="mt-3 font-mono text-[12px] leading-5 text-fg-3">
              <span className="block">{f.note[0]}</span>
              <span className="block">{f.note[1]}</span>
            </dd>
          </div>
        ))}
      </dl>
      </Reveal>
      <SourceLine data={{ source: "Geth receipts and Nimbus events on Rooted’s own Sepolia node", captured_at: b.captured_at }} className="mt-3" />
      <p className="mt-1 max-w-[88ch] text-[12px] leading-5 text-fg-3">
        {/* Hyphenated words ("network-wide") never split across lines. */}
        {epbs.label.split(/(\S+-\S+)/).map((part, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part))}
      </p>

      <div className="mt-14 grid grid-cols-12 gap-x-6 gap-y-4 md:mt-20">
        <h2 id="metrics-title" className="col-span-12 text-[26px] leading-[1.1] tracking-[-0.03em] md:col-span-5 md:text-[30px]">
          Gas stopped measuring time.
        </h2>
        <p className="col-span-12 max-w-[60ch] text-[15px] leading-[1.6] text-fg-2 md:col-span-7 md:pt-1 md:text-[17px]">
          The header of block {num(b.number)} and its receipts disagree, and both are right.{" "}
          <a href={EIP_8037} className="link inline-flex items-center gap-1">
            EIP-8037
            <ArrowUpRight />
          </a>{" "}
          meters <b>execution</b> and <b>state creation</b> as separate gas. The header keeps the larger of the two sums; receipts charge both. Rooted’s replay checks
          each and times execution natively, not from gas.
        </p>
      </div>
    </Section>
  );
}
