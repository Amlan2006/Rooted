import type { HeroBlock } from "@/lib/data";
import { num, shortHash } from "@/lib/format";
import { CopyButton } from "@/components/ui/copy-button";
import { SourceLine } from "@/components/ui/mono";
import { Meta } from "./meta";

const LANE = 4; // viewBox units per BAL index: 3 bar + 1 gap
const UP = 96; // slots written, above the axis
const DOWN = 36; // accounts changed, below it
const H = UP + 1 + DOWN;

/**
 * The hero block's EIP-7928 list by BAL index (0 pre-execution, 1..n transactions, n+1 post-execution): storage slots
 * written above the axis, accounts changed below, both linear. Zero is drawn as nothing. Reads carry no index.
 */
export function AccessLanes({ block }: { block: HeroBlock }) {
  const a = block.access_list;
  const { slots_written: slots, accounts_changed: accounts } = a.per_index;
  const n = block.tx_count;
  const W = (n + 2) * LANE;
  const maxSlots = Math.max(...slots);
  const maxAccounts = Math.max(...accounts);
  // The heaviest writer among the transactions (not the system indexes) gets the callout.
  const top = slots.reduce((best, v, i) => (i >= 1 && i <= n && v > slots[best] ? i : best), 1);
  const edge = (i: number) => i === 0 || i === n + 1;
  const up = (i: number) => `M${i * LANE} ${(UP - (slots[i] / maxSlots) * UP).toFixed(2)}h3V${UP}h-3z`;
  const down = (i: number) => `M${i * LANE} ${UP + 1}h3v${((accounts[i] / maxAccounts) * DOWN).toFixed(2)}h-3z`;
  const all = slots.map((_, i) => i);
  const path = (pick: (i: number) => boolean, bar: (i: number) => string) => all.filter(pick).map(bar).join("");
  const topX = (top * LANE + 1.5) / W;
  const callout = `tx ${top - 1} · ${num(slots[top])} slots written`;

  return (
    <figure className="rounded-panel border bg-paper">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-2.5 font-mono text-label uppercase text-muted md:px-5">
        <p className="text-ink">Block {num(block.number)}</p>
        <Meta parts={[`${num(a.accounts)} accounts`, `${num(a.storage_writes)} slot writes`, `${num(a.storage_reads)} slot reads`]} />
      </div>

      <div className="px-4 pt-6 pb-5 md:px-5">
        <div className="relative pt-6">
          <p
            className="absolute top-0 font-mono text-xs whitespace-nowrap"
            // Anchored at the same fraction of its own width as the bar's x, so it sits over the bar and never overflows.
            style={{ left: `${topX * 100}%`, transform: `translateX(-${topX * 100}%)` }}
          >
            {callout}
          </p>
          <div className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              shapeRendering="crispEdges"
              className="block w-full"
              style={{ height: H }}
              role="img"
              aria-label={`Block ${num(block.number)} access list by index: storage slots written by each of the ${num(n)} transactions, most by ${callout.replace(" · ", ", ")}, and accounts each one changed, at most ${maxAccounts}.`}
            >
              <path d={path((i) => !edge(i) && i !== top, up)} fill="var(--ink)" fillOpacity={0.7} />
              <path d={up(top)} fill="var(--ink)" />
              <path d={path((i) => !edge(i), down)} fill="var(--ink)" fillOpacity={0.3} />
              <path d={path(edge, up) + path(edge, down)} fill="var(--muted)" />
              <rect x={0} y={UP} width={W} height={1} fill="var(--ink)" fillOpacity={0.25} />
            </svg>
            <span className="absolute top-0 left-0 font-mono text-xs text-muted" aria-hidden="true">
              slots written
            </span>
            <span className="absolute bottom-0 left-0 font-mono text-xs text-muted" aria-hidden="true">
              accounts changed
            </span>
          </div>
        </div>

        <div className="relative mt-2 h-4 font-mono text-xs text-muted" aria-hidden="true">
          <span className="absolute left-0">0 pre</span>
          <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">1–{num(n)} transactions</span>
          <span className="absolute right-0">{num(n + 1)} post</span>
        </div>

        {block.block_access_list_hash && (
          <>
            {/* One commitment covers every index above. */}
            <div className="mt-3 h-2 border-x border-b border-ink/25" aria-hidden="true" />
            <div className="mx-auto h-3 w-px bg-ink/25" aria-hidden="true" />
            <div className="flex flex-wrap items-center justify-center gap-x-2 font-mono text-[13px]">
              <span className="text-muted">blockAccessListHash</span>
              <span className="inline-flex items-center gap-1.5">
                {shortHash(block.block_access_list_hash)}
                <CopyButton value={block.block_access_list_hash} label="Copy block access list hash" className="-my-1" />
              </span>
            </div>
          </>
        )}
      </div>

      <figcaption className="space-y-2 border-t px-4 py-4 md:px-5">
        <p className="text-sm text-muted">
          Up, the storage slots written at each index; down, the accounts whose balance, nonce, code or storage it changed. Indexes 0 and{" "}
          {num(n + 1)} are pre- and post-execution. Reads have no index: the list names them once for the block, {num(a.storage_reads)} slots and{" "}
          {num(a.accounts_read_only)} accounts that were only read.
        </p>
        <SourceLine data={a} />
      </figcaption>
    </figure>
  );
}
