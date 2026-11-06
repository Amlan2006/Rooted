import type { CSSProperties } from "react";
import { epbs } from "@/lib/data";
import { num } from "@/lib/format";
import { cx } from "@/lib/cx";
import { Panel } from "./panel";
import s from "./bento.module.css";

/** The detail axis: all three events and the start of the PTC window land in the slot's first 500 ms. */
const ZOOM = 500;
const GRID = [0, 100, 200, 300, 400, 500];
const at = (t: number) => `${(Math.min(t, ZOOM) / ZOOM) * 100}%`;
const ROW = "h-[26px] md:h-[30px]";

/** PTC seats as a dot matrix, one dot per seat; present votes bright, absent dim (the cell's one accent is payload available). Patterns keep it to three rects. */
function Seats({ votes, size }: { votes: number; size: number }) {
  const cols = 32;
  const step = 5;
  const w = cols * step;
  const h = Math.ceil(size / cols) * step;
  const full = Math.floor(votes / cols);
  const part = votes % cols;
  const dot = (cls: string) => <rect width={3} height={3} rx={0.75} className={cls} />;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block max-w-full" aria-hidden="true">
      <defs>
        <pattern id="ptc-off" width={step} height={step} patternUnits="userSpaceOnUse">{dot("fill-fg/[0.09]")}</pattern>
        <pattern id="ptc-on" width={step} height={step} patternUnits="userSpaceOnUse">{dot("fill-fg/45")}</pattern>
      </defs>
      <rect width={w} height={h} fill="url(#ptc-off)" />
      <rect width={w} height={full * step} fill="url(#ptc-on)" />
      {part > 0 && <rect y={full * step} width={part * step} height={step} fill="url(#ptc-on)" />}
    </svg>
  );
}

/**
 * One live slot from epbs.json on a 0–500 ms axis: every offset as received at our node, the reveal latency, the
 * start of the PTC window (it runs on to 9.1 s), and the included PTC tally. The deadlines are off this scale, so
 * they are named under it. Hover replays the slot at quarter speed and each real point lands as the playhead passes.
 */
export function SlotMini() {
  const o = epbs.offsets_ms;
  const d = epbs.deadlines_ms;
  const tally = epbs.included_ptc;
  const ptc = o.first_ptc_message !== null && o.last_ptc_message !== null ? { from: o.first_ptc_message, to: o.last_ptc_message } : null;
  const marks = [
    { label: "Beacon block", t: o.block },
    { label: "Payload envelope", t: o.execution_payload, from: o.block },
    { label: "Payload available", t: o.execution_payload_available, acc: true },
  ];
  const builder = epbs.self_build ? "self-built" : epbs.builder_index !== null ? `builder #${epbs.builder_index}` : null;
  const frac = (t: number) => Math.min(t, ZOOM) / ZOOM;

  return (
    <Panel
      crumb="PayloadWatch"
      title={<>Slot <span className="font-mono">{num(epbs.slot)}</span></>}
      meta={
        <span className="hidden sm:inline">
          block {num(epbs.block_number)}
          {builder && ` · ${builder}`}
        </span>
      }
      className="lg:h-[244px]"
    >
      <p className="sr-only">
        Received at our node, in milliseconds after slot start: beacon block {num(o.block)}, payload envelope {num(o.execution_payload)}, payload
        available {num(o.execution_payload_available)}
        {ptc && `, ${num(epbs.ptc_messages_received)} PTC messages between ${num(ptc.from)} and ${num(ptc.to)}`}. The next block included{" "}
        {num(tally.payload_present_votes)} of {num(tally.ptc_size)} payload-present votes.
      </p>
      <div aria-hidden="true" className="flex flex-1 flex-col gap-5 p-4 md:flex-row md:gap-6">
        {/* Timeline: label column, track column (gridlines, marks, playhead), value column. */}
        <div className="flex min-w-0 flex-1 flex-col text-[12px]">
          <div className="flex min-w-0 flex-1">
            <ul className="w-[108px] shrink-0 text-fg-2 sm:w-[116px]">
              {marks.map((m) => (
                <li key={m.label} className={cx(ROW, "flex items-center", m.acc && "text-fg")}>{m.label}</li>
              ))}
              {ptc && <li className={cx(ROW, "flex items-center")}>PTC messages</li>}
            </ul>
            <div className="relative min-w-0 flex-1">
              <div className="relative">
                {GRID.map((t) => (
                  <span key={t} className={cx("absolute inset-y-0 w-px", t === 0 ? "bg-line-strong" : "bg-line")} style={{ left: at(t) }} />
                ))}
                {marks.map((m) => (
                  <div key={m.label} className={cx(ROW, "relative")}>
                    {m.from !== undefined ? (
                      <>
                        <span className="absolute top-1/2 -mt-[3px] h-[7px] w-px bg-fg/30" style={{ left: at(m.from) }} />
                        <span
                          className={cx(s.lead, "absolute top-1/2 h-px origin-left bg-fg/30")}
                          style={{ left: at(m.from), width: `calc(${at(m.t)} - ${at(m.from)})`, "--t0": frac(m.from), "--t": frac(m.t) } as CSSProperties}
                        />
                        <span className="absolute bottom-[calc(50%+5px)] hidden -translate-x-1/2 font-mono text-[11px] leading-none whitespace-nowrap text-fg-3 sm:block" style={{ left: `calc((${at(m.from)} + ${at(m.t)}) / 2)` }}>
                          reveal {num(m.t - m.from)} ms
                        </span>
                      </>
                    ) : (
                      <span className={cx(s.lead, "absolute top-1/2 left-0 h-px origin-left bg-fg/15")} style={{ width: at(m.t), "--t0": 0, "--t": frac(m.t) } as CSSProperties} />
                    )}
                    <span
                      className={cx(s.dot, "absolute top-1/2 size-[7px] -translate-1/2 rounded-full ring-[3px] ring-surface-1", m.acc ? "bg-acc" : "bg-fg")}
                      style={{ left: at(m.t), "--t": frac(m.t) } as CSSProperties}
                    />
                  </div>
                ))}
                {ptc && (
                  <div className={cx(ROW, "relative")}>
                    <span
                      className={cx(s.window, "absolute top-1/2 right-0 h-[3px] origin-left -translate-y-1/2 rounded-l-full bg-fg/45")}
                      style={{ left: at(ptc.from), "--t0": frac(ptc.from) } as CSSProperties}
                    />
                    <svg width="6" height="8" viewBox="0 0 6 8" className="absolute top-1/2 -right-1 -mt-1 text-fg/45">
                      <path d="M1 1l3.5 3L1 7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <span className={cx(s.playhead, "absolute inset-0")}>
                    <span className="absolute inset-y-0 right-0 w-px bg-fg/60" />
                  </span>
                </div>
              </div>
              <div className="relative h-5 font-mono text-[11px] text-fg-3">
                {GRID.map((t, i) => (
                  <span
                    key={t}
                    className={cx("absolute bottom-0 whitespace-nowrap", i === 0 ? "" : i === GRID.length - 1 ? "-translate-x-full" : "-translate-x-1/2", i % 2 === 1 && "hidden sm:block")}
                    style={{ left: at(t) }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <ul className="w-[56px] shrink-0 text-right font-mono text-fg sm:w-[64px]">
              {marks.map((m) => (
                <li key={m.label} className={cx(ROW, "flex items-center justify-end", m.acc && "text-acc")}>+{num(m.t)}</li>
              ))}
              {ptc && <li className={cx(ROW, "flex items-center justify-end text-fg-2")}>{num(epbs.ptc_messages_received)}</li>}
              <li className="flex h-5 items-end justify-end text-[11px] text-fg-3">ms</li>
            </ul>
          </div>
          {/* Off this scale, so named rather than drawn. */}
          <p className="mt-3 font-mono text-[11px] leading-4 text-fg-3">
            Deadlines past 500 ms: attest {d.attestation / 1000} s · payload {d.payload / 1000} s · PTC {d.payload_attestation / 1000} s
          </p>
        </div>
        {/* Included tally: the next block's payload-present bits, one dot per committee seat. */}
        <div className="flex shrink-0 flex-col border-t pt-4 md:w-[160px] md:box-content md:border-t-0 md:border-l md:pt-0 md:pl-6">
          <p className="text-[12px] leading-5 text-fg-2">Payload-present votes</p>
          <p className="font-mono text-[11px] leading-4 text-fg-3">in slot {num(tally.slot)}</p>
          <div className="mt-3">
            <Seats votes={tally.payload_present_votes} size={tally.ptc_size} />
          </div>
          <p className="mt-auto pt-3 font-mono text-[20px] leading-none tracking-[-0.02em] whitespace-nowrap text-fg">
            {num(tally.payload_present_votes)}
            <span className="text-[13px] tracking-normal text-fg-3"> / {num(tally.ptc_size)}</span>
          </p>
        </div>
      </div>
    </Panel>
  );
}
