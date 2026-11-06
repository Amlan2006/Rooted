import { heroBlock } from "@/lib/data";
import { gasM, num } from "@/lib/format";
import { cx } from "@/lib/cx";
import { Panel } from "./panel";

const LANE = 3; // viewBox units per tx: 2 bar + 1 gap
const H = 72;
const FLOOR = 1e4; // log axis floor, below the smallest possible tx (21,000 gas)

/**
 * Gas per transaction (log scale) with the capping tx in the accent, and the X-ray's gas-weighted ceiling
 * Σg / max g (docs/XRAY.md): an upper bound on speedup, computed from the same receipts.
 */
export function XrayMini() {
  const b = heroBlock;
  const cap = b.capping_tx;
  const span = Math.log(cap.gas_used / FLOOR);
  const bar = (g: number, i: number) => {
    const h = Math.max(1, (Math.log(Math.max(g, FLOOR) / FLOOR) / span) * H);
    return `M${i * LANE} ${(H - h).toFixed(2)}h2V${H}h-2z`;
  };
  const rest = b.txs.filter((t) => t.index !== cap.index).map((t) => bar(t.gas_used, t.index)).join("");
  const x = (cap.index * LANE + 1) / (b.txs.length * LANE);
  const ceiling = b.receipts_gas_sum / cap.gas_used;

  return (
    <Panel crumb="Block X-ray" title={<span className="font-mono">{num(b.number)}</span>} meta={`${num(b.tx_count)} txs`} className="lg:h-[244px]">
      <div className="flex flex-1 flex-col px-4 pt-3.5 pb-4">
        <div className="flex items-end justify-between gap-3">
          <p className="font-mono text-[22px] leading-none tracking-[-0.03em] text-fg">
            {ceiling.toFixed(2)}
            <span className="text-fg-3">×</span>
          </p>
          <p className="text-right text-[11px] leading-tight text-fg-3">
            gas-weighted ceiling
            <br />
            <span className="font-mono">Σg / max g</span>
          </p>
        </div>
        <div className="relative mt-auto pt-9" aria-hidden="true">
          <p
            className="absolute top-0 rounded-[6px] border border-line-strong bg-bg px-2 py-1 font-mono text-[11px] leading-none whitespace-nowrap text-fg transition-transform duration-200 ease-out group-hover/cell:-translate-y-0.5"
            // Anchored at the bar's own fraction of its width, so it sits over the bar and never overflows.
            style={{ left: `${x * 100}%`, transform: `translateX(-${x * 100}%)` }}
          >
            tx {cap.index} · <span className="text-acc">{gasM(cap.gas_used)}</span>
          </p>
          <svg viewBox={`0 0 ${b.txs.length * LANE} ${H}`} preserveAspectRatio="none" shapeRendering="crispEdges" className="block h-[72px] w-full">
            <path d={rest} className={cx("fill-fg/30 transition-[fill-opacity] duration-200 ease-out group-hover/cell:fill-fg/15")} />
            <path d={bar(cap.gas_used, cap.index)} className="fill-acc" />
          </svg>
          <div className="h-px bg-line-strong" />
          <p className="mt-1.5 flex justify-between font-mono text-[11px] text-fg-3">
            <span>tx 0</span>
            <span>gas per tx, log</span>
            <span>tx {num(b.txs.length - 1)}</span>
          </p>
        </div>
        <p className="sr-only">
          {num(b.tx_count)} transactions. The largest, tx {cap.index}, {cap.is_create ? "a contract creation" : "a call"}, used {num(cap.gas_used)} gas of{" "}
          {num(b.receipts_gas_sum)} receipt gas, which bounds the gas-weighted parallel speedup at {ceiling.toFixed(2)} times.
        </p>
      </div>
    </Panel>
  );
}
