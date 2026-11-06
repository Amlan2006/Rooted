import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { gasM, num } from "@/lib/format";
import type { TourData } from "./types";
import { Card, CardHead, Chip, ViewHead } from "./ui";
import s from "./anim.module.css";

const SLOT_MS = 12_000;
/** The detail axis: everything our node received for this slot before the PTC window lands in its first 500 ms. */
const ZOOM_MS = 500;
/** The detail replays at quarter speed: 500 ms of slot time in 2 s. */
const PLAY_S = 2;
const ROWS = 10;
const TICKS = 64;
const GRID = [0, 100, 200, 300, 400, 500];

const at = (ms: number) => `${(Math.min(ms, ZOOM_MS) / ZOOM_MS) * 100}%`;
const slotAt = (ms: number) => `${(ms / SLOT_MS) * 100}%`;
const clock = (ms: number) => `${((Math.min(ms, ZOOM_MS) / ZOOM_MS) * PLAY_S).toFixed(3)}s`;
const v = (vars: Record<string, string | number>) => vars as CSSProperties;

export function PayloadWatch({ epbs: e, blocks }: { epbs: TourData["epbs"]; blocks: TourData["blocks"] }) {
  const o = e.offsets;
  // Reveal latency as PayloadWatch defines it: payload receipt minus block receipt, both at our collector.
  const reveal = o.execution_payload - o.block;
  const events = [
    { label: "Beacon block", ms: o.block, value: `+${num(o.block)}` },
    { label: "Payload envelope", ms: o.execution_payload, from: o.block, note: `reveal ${num(reveal)} ms`, value: `+${num(o.execution_payload)}` },
    { label: "Payload available", ms: o.execution_payload_available, value: `+${num(o.execution_payload_available)}`, on: true },
  ];
  const deadlines = [
    { ms: e.deadlines.attestation, label: "attest" },
    { ms: e.deadlines.payload, label: "payload" },
    { ms: e.deadlines.payload_attestation, label: "PTC" },
  ];
  const ptc = o.first_ptc_message !== null && o.last_ptc_message !== null ? { from: o.first_ptc_message, to: o.last_ptc_message } : null;
  const votes = e.included;
  const filled = Math.round((votes.payload_present_votes / votes.ptc_size) * TICKS);

  return (
    <div className="flex h-full flex-col gap-4 p-4 @2xl:p-5">
      <ViewHead
        title="PayloadWatch"
        sub="Each slot from commitment to payload, as our node saw it."
        aside={
          <>
            <Chip>block {num(e.block)}</Chip>
            <Chip>{e.txs} txs</Chip>
          </>
        }
      />
      <div className="grid min-h-0 flex-1 gap-4 @2xl:grid-cols-[1.35fr_1fr] @4xl:grid-cols-[1.2fr_1fr]">
        <Card className="flex flex-col p-4">
          <CardHead title={<>Slot <span className="font-mono">{num(e.slot)}</span></>} meta={<span className="hidden @xs:inline">ms after slot start</span>} />

          {/* Detail: label | track | value on a 0–500 ms axis. The overlay holds the gridlines and the replay playhead. */}
          <div className="relative mt-3 grid grid-cols-[104px_minmax(0,1fr)_40px] grid-rows-[repeat(4,30px)_18px] items-center gap-x-3 text-[12px] @2xl:grid-cols-[112px_minmax(0,1fr)_44px]">
            <div aria-hidden="true" className="pointer-events-none relative col-start-2 row-[1/6] self-stretch">
              {GRID.map((t) => (
                <span key={t} className={cx("absolute bottom-[18px] top-0 w-px", t === 0 ? "bg-line-strong" : "bg-line")} style={{ left: at(t) }} />
              ))}
              <div className={cx(s.playhead, "absolute bottom-[18px] top-0 left-0 w-full")} style={v({ "--play": `${PLAY_S}s` })}>
                <span className="absolute inset-y-0 left-0 w-px bg-fg/45" />
              </div>
              <div className="absolute inset-x-0 bottom-0 h-[18px] font-mono text-[10.5px] leading-[18px] text-fg-3">
                {GRID.map((t, i) => (
                  <span
                    key={t}
                    className={cx("absolute -translate-x-1/2 whitespace-nowrap", i === 0 && "translate-x-0", i === GRID.length - 1 && "-translate-x-full", i % 2 === 1 && "hidden @4xl:block")}
                    style={{ left: at(t) }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <span aria-hidden="true" className="col-start-3 row-start-5 text-right font-mono text-[10.5px] text-fg-3">ms</span>

            {events.map((ev, i) => (
              <Row key={ev.label} row={i + 1} label={ev.label} value={ev.value} delay={clock(ev.ms)} on={ev.on}>
                {ev.from !== undefined && (
                  <span
                    className={cx(s.span, "absolute top-1/2 h-px bg-fg/30")}
                    style={v({ left: at(ev.from), width: `calc(${at(ev.ms)} - ${at(ev.from)})`, "--d": clock(ev.from), "--dur": `${((ev.ms - ev.from) / ZOOM_MS) * PLAY_S}s` })}
                  >
                    <span className={cx(s.appear, "absolute bottom-1.5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] leading-none text-fg-3 @4xl:block")} style={v({ "--d": clock(ev.ms) })}>
                      {ev.note}
                    </span>
                  </span>
                )}
                {ev.from !== undefined && <span className="absolute top-1/2 -mt-[3px] h-[7px] w-px bg-fg/30" style={{ left: at(ev.from) }} />}
                <span
                  className={cx(s.pop, "absolute top-1/2 -ml-1 -mt-1 size-2 rounded-full", ev.on ? "bg-acc ring-[3px] ring-acc/20" : "bg-fg")}
                  style={v({ left: at(ev.ms), "--d": clock(ev.ms) })}
                />
              </Row>
            ))}
            {ptc && (
              // The PTC window runs on past this axis; the overview below shows all of it.
              <Row row={4} label="PTC messages" value={num(e.ptcSeen)} delay={clock(ptc.from)}>
                <span
                  className={cx(s.span, "absolute top-1/2 -mt-px h-0.5 rounded-l-full bg-fg-2")}
                  style={v({ left: at(ptc.from), right: 0, "--d": clock(ptc.from), "--dur": `${((ZOOM_MS - ptc.from) / ZOOM_MS) * PLAY_S}s` })}
                />
                <svg aria-hidden="true" width="6" height="8" viewBox="0 0 6 8" className={cx(s.appear, "absolute top-1/2 -right-1 -mt-1 text-fg-2")} style={v({ "--d": `${PLAY_S}s` })}>
                  <path d="M1 1l3.5 3L1 7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Row>
            )}
          </div>

          {/* Overview: the whole 12 s slot, the detail window above it, the protocol deadlines and the PTC window. */}
          <div aria-hidden="true" className="grid grid-cols-[104px_minmax(0,1fr)_40px] gap-x-3 @2xl:grid-cols-[112px_minmax(0,1fr)_44px]">
            <span className="col-start-1 row-start-2 self-center text-[12px] text-fg-3">Whole slot</span>
            <svg className="col-start-2 row-start-1 block h-3.5 w-full" viewBox="0 0 100 14" preserveAspectRatio="none">
              <path d={`M0 0 H100 L${(ZOOM_MS / SLOT_MS) * 100} 14 H0 Z`} className="fill-fg/[0.035]" />
              <path d={`M100 0 L${(ZOOM_MS / SLOT_MS) * 100} 14`} vectorEffect="non-scaling-stroke" className="stroke-line-strong" fill="none" />
            </svg>
            <div className="relative col-start-2 row-start-2 h-3.5">
              <span className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
              {deadlines.map((d) => (
                <span key={d.label} className="absolute inset-y-0 w-px border-l border-dashed border-fg/25" style={{ left: slotAt(d.ms) }} />
              ))}
              {ptc && (
                <span
                  className={cx(s.span, "absolute top-1/2 -mt-px h-0.5 rounded-full bg-fg-2/60")}
                  style={v({ left: slotAt(ptc.from), width: slotAt(ptc.to - ptc.from), "--d": `${PLAY_S}s`, "--dur": "0.9s" })}
                />
              )}
              <span className="absolute inset-y-0 left-0 rounded-[2px] border border-fg/35 bg-fg/[0.08]" style={{ width: slotAt(ZOOM_MS) }} />
            </div>
            <span className="col-start-3 row-start-2 self-center text-right font-mono text-[11px] text-fg-3">12 s</span>
            <div className="relative col-start-2 row-start-3 h-5 font-mono text-[10.5px] leading-4 text-fg-3 @4xl:h-9">
              {/* A narrow axis (phones) labels only the payload deadline, so "3 s 6 s 9 s" never run together. */}
              {deadlines.map((d) => (
                <span
                  key={d.label}
                  className={cx("absolute top-1 flex -translate-x-1/2 flex-col items-center whitespace-nowrap", d.label !== "payload" && "hidden @md:flex")}
                  style={{ left: slotAt(d.ms) }}
                >
                  <span className="text-fg-2">{d.ms / 1000} s</span>
                  <span className="hidden @4xl:inline">{d.label}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-baseline justify-between text-[12px] leading-5">
              <span className="text-fg-2">Payload present</span>
              <span className="font-mono">
                <span className="text-acc">{num(votes.payload_present_votes)}</span>
                <span className="text-fg-3"> / {num(votes.ptc_size)}</span>
              </span>
            </div>
            {/* One seat per 8 votes, drawn as a pattern (two elements, not 64); the accent layer wipes in left to right. */}
            <div aria-hidden="true" className="relative mt-2 h-2">
              <span className="absolute inset-0" style={{ background: "repeating-linear-gradient(90deg, var(--line-strong) 0 calc((100% + 2px) / 64 - 2px), transparent 0 calc((100% + 2px) / 64))" }} />
              {filled > 0 && (
              <span
                className={cx(s.wipe, "absolute inset-y-0 left-0")}
                style={v({
                  width: `calc((100% + 2px) * ${filled} / ${TICKS} - 2px)`,
                  background: "repeating-linear-gradient(90deg, rgb(75 227 143 / 0.8) 0 calc((100% + 2px) / " + filled + " - 2px), transparent 0 calc((100% + 2px) / " + filled + "))",
                  "--d": `${PLAY_S + 0.2}s`,
                })}
              />
              )}
            </div>
            <p className="mt-2 font-mono text-[11px] leading-4 text-fg-3">votes on this slot, included in slot {num(votes.slot)}</p>
          </div>

          <dl className="mt-auto grid grid-cols-1 gap-x-4 border-t pt-3 text-[12px] leading-5 @xs:grid-cols-2">
            {[
              ["Block", num(e.block)],
              ["Builder", e.builder ?? "n/a"],
              ["Beacon root", e.beaconRoot],
              ["Block hash", e.blockHash],
            ].map(([k, val], i) => (
              <div key={k} className={cx("flex min-w-0 justify-between gap-2 py-0.5", i > 1 && "hidden @4xl:flex")}>
                <dt className="text-fg-3">{k}</dt>
                <dd className="truncate font-mono text-fg-2">{val}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <RecentBlocks blocks={blocks} />
      </div>
    </div>
  );
}

function Row({ row, label, value, delay, on, children }: { row: number; label: string; value: string; delay: string; on?: boolean; children: ReactNode }) {
  return (
    <>
      <span className={cx("col-start-1 truncate", on ? "text-fg" : "text-fg-2")} style={{ gridRow: row }}>
        {label}
      </span>
      <div className="relative col-start-2 h-full" style={{ gridRow: row }}>
        <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
        {children}
      </div>
      <span className={cx(s.appear, "col-start-3 text-right font-mono", on ? "text-acc" : "text-fg")} style={v({ gridRow: row, "--d": delay })}>
        {value}
      </span>
    </>
  );
}

/**
 * The last blocks at capture, newest first, drawn still: rows sliding in would read as a live feed. Its own capture ran
 * 22 s before the slot card's, so the meta names where it ends rather than calling it the newest.
 */
function RecentBlocks({ blocks }: { blocks: TourData["blocks"] }) {
  const rows = blocks.rows;
  const shown = rows.slice(-ROWS).reverse();
  const last = rows[rows.length - 1];

  return (
    <Card className="hidden min-h-0 flex-col overflow-hidden p-4 pb-0 @2xl:flex">
      <CardHead
        title="Recent blocks"
        meta={
          <>
            to {num(last.n)}
            <span className="hidden @4xl:inline"> · {blocks.captured.slice(11, 16)} UTC</span>
          </>
        }
      />
      <table className="mt-3 w-full table-fixed border-collapse text-[12px]">
        <caption className="sr-only">Recent Sepolia blocks at capture: transactions, header gas, builder and PTC payload-present votes</caption>
        <thead>
          <tr className="text-left text-[11px] text-fg-3">
            <th className="w-[40%] pb-2 font-normal @4xl:w-[27%]">Block</th>
            <th className="hidden w-[10%] pb-2 font-normal @4xl:table-cell">Txs</th>
            <th className="pb-2 font-normal">Gas used</th>
            <th className="hidden w-[26%] pb-2 font-normal @4xl:table-cell">Builder</th>
            <th className="w-[16%] pb-2 text-right font-normal @4xl:w-[10%]">PTC</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.n} className={cx(s.stagger, "h-[33px] border-t")} style={v({ "--i": i })}>
              <td className="font-mono text-fg">{num(r.n)}</td>
              <td className="hidden font-mono text-fg-2 @4xl:table-cell">{r.txs}</td>
              <td>
                <span className="flex items-center gap-2">
                  <span className="relative hidden h-1 w-8 shrink-0 overflow-hidden rounded-full bg-fg/[0.08] @4xl:block">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-fg-2" style={{ width: `${(r.gas / r.limit) * 100}%` }} />
                  </span>
                  <span className="font-mono text-fg-2">{gasM(r.gas)}</span>
                </span>
              </td>
              <td className="hidden truncate font-mono text-fg-2 @4xl:table-cell">{r.builder ?? "n/a"}</td>
              <td className={cx("text-right font-mono", r.ptc !== null && r.ptc === r.size ? "text-acc" : "text-fg-2")}>{r.ptc ?? "n/a"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
