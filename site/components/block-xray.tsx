import { heroBlock } from "@/lib/data";
import { num, shortHash } from "@/lib/format";
import { SourceLine } from "@/components/ui/mono";
import { XrayPlot, type Lane } from "@/components/s1-hero-xray/xray-plot";

const UNIT = 1_000_000; // gas per dot

/** The hero's signature panel: every transaction of the hero block as a lane of dots, sized by gas used. */
export function BlockXray() {
  const b = heroBlock;
  // Only what the chart and tooltip need crosses to the client (not the full 31 KB snapshot).
  const lanes: Lane[] = [...b.txs]
    .sort((x, y) => x.index - y.index)
    .map((t) => ({ i: t.index, gas: t.gas_used, hash: shortHash(t.hash), create: t.is_create }));
  const cap = lanes.findIndex((l) => l.i === b.capping_tx.index);

  return (
    <figure className="rounded-panel border bg-paper">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-2.5 font-mono text-label uppercase text-muted md:px-5">
        <p>
          <span className="whitespace-nowrap text-ink">Block {num(b.number)}</span>
          <span className="hidden sm:inline"> · {num(b.tx_count)} txs</span>
          {b.slot !== null && <span className="hidden lg:inline"> · slot {num(b.slot)}</span>}
        </p>
        <p className="flex items-center gap-2 whitespace-nowrap">
          <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
            <circle cx="3" cy="3" r="2.5" fill="var(--ink)" fillOpacity="0.8" />
          </svg>
          <span>
            = {UNIT / 1e6}M gas, rounded up
          </span>
        </p>
      </div>
      <div className="px-4 pb-4 pt-5 md:px-5 md:pt-6">
        <XrayPlot lanes={lanes} cap={cap} unit={UNIT} label={`Transactions in block ${num(b.number)}, in block order, sized by gas used`} />
      </div>
      <figcaption className="border-t px-4 py-3 md:px-5">
        <SourceLine data={b} />
      </figcaption>
    </figure>
  );
}
