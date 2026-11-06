import type { Epbs } from "@/lib/data";
import { ms, num } from "@/lib/format";
import { SourceLine } from "@/components/ui/mono";
import { Meta } from "./meta";

// Axis length only: SECONDS_PER_SLOT is a protocol constant, not a measurement.
const SLOT_MS = 12_000;
const at = (t: number) => `${(t / SLOT_MS) * 100}%`;

type Row = { label: string; note?: string; from?: number; to: number; value: string };

const grid = "grid grid-cols-[1fr_auto] items-center gap-x-4 md:grid-cols-[10.5rem_1fr_8.5rem]";

/** Waterfall of one live slot from epbs.json: every offset as received at our node, on a shared 0–12 s axis. */
export function SlotTimeline({ epbs }: { epbs: Epbs }) {
  const o = epbs.offsets_ms;
  const rows: Row[] = [
    { label: "Beacon block", to: o.block, value: ms(o.block) },
    { label: "Payload envelope", to: o.execution_payload, value: ms(o.execution_payload) },
    { label: "Payload available", to: o.execution_payload_available, value: ms(o.execution_payload_available) },
  ];
  if (o.first_ptc_message !== null && o.last_ptc_message !== null) {
    rows.push({
      label: "PTC votes",
      note: `${num(epbs.ptc_messages_received)} seen`,
      from: o.first_ptc_message,
      to: o.last_ptc_message,
      value: `${num(o.first_ptc_message)}–${ms(o.last_ptc_message)}`,
    });
  }
  const lines = [0, epbs.deadlines_ms.attestation, epbs.deadlines_ms.payload, epbs.deadlines_ms.payload_attestation, SLOT_MS];
  const ticks = [
    { name: "attest", t: epbs.deadlines_ms.attestation },
    { name: "payload", t: epbs.deadlines_ms.payload },
    { name: "PTC", t: epbs.deadlines_ms.payload_attestation },
  ];
  const builder = epbs.self_build ? "self-built" : epbs.builder_index !== null ? `builder ${epbs.builder_index}` : null;
  const tally = epbs.included_ptc;

  return (
    <figure className="rounded-panel border bg-paper">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-2.5 font-mono text-label uppercase text-muted md:px-5">
        <p className="text-ink">Slot {num(epbs.slot)}</p>
        <Meta parts={[`block ${num(epbs.block_number)}`, `${num(epbs.tx_count)} txs`, builder]} />
      </div>

      <div className="px-4 pt-5 pb-4 md:px-5">
        {/* Axis: slot start, the three protocol deadlines (name over time), slot end. */}
        <div className={grid} aria-hidden="true">
          <span className="hidden md:block" />
          <div className="relative col-span-2 h-8 font-mono text-xs text-muted md:col-span-1">
            <span className="absolute bottom-0 left-0">0 s</span>
            {ticks.map((d) => (
              <span key={d.name} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: at(d.t) }}>
                <span>{d.name}</span>
                <span>{d.t / 1000} s</span>
              </span>
            ))}
            <span className="absolute right-0 bottom-0">{SLOT_MS / 1000} s</span>
          </div>
          <span className="hidden self-end text-right font-mono text-xs text-muted md:block">after slot start</span>
        </div>

        <ol className="mt-2">
          {rows.map((r) => (
            <li key={r.label} className={`${grid} py-1 md:py-0`}>
              <span className="order-1 text-sm">
                {r.label}
                {r.note && <span className="text-muted"> · {r.note}</span>}
              </span>
              <span className="order-2 text-right font-mono text-[13px] md:order-3">{r.value}</span>
              <span className="relative order-3 col-span-2 mt-1.5 h-6 md:order-2 md:col-span-1 md:mt-0 md:h-11" aria-hidden="true">
                {lines.map((t) => (
                  <span key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: t === SLOT_MS ? "calc(100% - 1px)" : at(t) }} />
                ))}
                <span className="absolute top-1/2 left-0 h-px bg-ink/20" style={{ width: at(r.from ?? r.to) }} />
                {r.from === undefined ? (
                  <span className="absolute top-1/2 size-[7px] -translate-1/2 rounded-full bg-ink" style={{ left: at(r.to) }} />
                ) : (
                  <>
                    <span className="absolute top-1/2 h-px bg-ink" style={{ left: at(r.from), width: at(r.to - r.from) }} />
                    <span className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-ink" style={{ left: at(r.from) }} />
                    <span className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-ink" style={{ left: at(r.to) }} />
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="border-t px-4 py-4 md:px-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm text-muted">Payload-present votes included in the next block, slot {num(tally.slot)}</p>
          <p className="shrink-0 font-mono text-[13px]">
            {num(tally.payload_present_votes)}
            <span className="text-muted"> / {num(tally.ptc_size)}</span>
          </p>
        </div>
        {/* One tick per 8 committee seats (PTC size is a multiple of 8); floor, so a tick never overstates the tally. */}
        <div className="mt-3 flex h-3 justify-between" aria-hidden="true">
          {Array.from({ length: Math.ceil(tally.ptc_size / 8) }, (_, i) => (
            <span key={i} className={`w-px ${(i + 1) * 8 <= tally.payload_present_votes ? "bg-ink" : "bg-line"}`} />
          ))}
        </div>
      </div>

      <figcaption className="space-y-2 border-t px-4 py-4 md:px-5">
        <p className="text-sm text-muted">
          {/* Hyphenated words ("network-wide") never split across lines. */}
          {epbs.label.split(/(\S+-\S+)/).map((part, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part))}
        </p>
        <SourceLine data={epbs} />
      </figcaption>
    </figure>
  );
}
