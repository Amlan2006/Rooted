import { heroBlock } from "@/lib/data";
import { num, shortHash } from "@/lib/format";
import { cx } from "@/lib/cx";
import { Panel, Verified } from "./panel";
import s from "./bento.module.css";

const LANE = 3; // viewBox units per BAL index: 2 bar + 1 gap
const UP = 22; // slots written, above the axis
const DOWN = 10; // accounts changed, below it

/** The hero block's EIP-7928 list: the commitment check, block totals, and storage slots written at each BAL index. */
export function AccessListMini() {
  const b = heroBlock;
  const a = b.access_list;
  const { slots_written: slots, accounts_changed: accounts } = a.per_index;
  const maxS = Math.max(...slots);
  const maxA = Math.max(...accounts);
  // Zero draws nothing; any non-zero value gets at least one unit so it stays visible.
  const up = slots.map((v, i) => (v ? `M${i * LANE} ${(UP - Math.max(1, (v / maxS) * UP)).toFixed(2)}h2V${UP}h-2z` : "")).join("");
  const down = accounts.map((v, i) => (v ? `M${i * LANE} ${UP + 1}h2v${Math.max(1, (v / maxA) * DOWN).toFixed(2)}h-2z` : "")).join("");
  const rows = [
    { k: "accounts", v: num(a.accounts), note: `${num(a.accounts_read_only)} read-only` },
    { k: "storage writes", v: num(a.storage_writes) },
    { k: "storage reads", v: num(a.storage_reads) },
  ];
  const lanes = (
    <svg viewBox={`0 0 ${slots.length * LANE} ${UP + 1 + DOWN}`} preserveAspectRatio="none" shapeRendering="crispEdges" className="block h-[33px] w-full">
      <path d={up} className="fill-current" />
      <path d={down} className="fill-current opacity-50" />
      <rect y={UP} width={slots.length * LANE} height={1} className="fill-current opacity-40" />
    </svg>
  );

  return (
    <Panel crumb="Access lists" title={<span className="font-mono">{num(b.number)}</span>} meta={a.commitment_matches ? <Verified>match</Verified> : "no match"} className="lg:h-[244px]">
      <div className="flex flex-1 flex-col px-4 pt-1.5 pb-3.5 font-mono text-[12px]">
        <dl>
          <div className="flex h-[26px] items-center gap-3 border-b">
            <dt className="min-w-0 truncate text-fg-3">
              <span className="min-[360px]:hidden">BAL hash</span>
              <span className="max-[359px]:hidden">blockAccessListHash</span>
            </dt>
            <dd className="ml-auto text-fg">{b.block_access_list_hash ? shortHash(b.block_access_list_hash) : "not in header"}</dd>
          </div>
          {rows.map((r) => (
            <div key={r.k} className="flex h-[26px] items-center border-b">
              <dt className="text-fg-2">{r.k}</dt>
              {r.note && <dd className="ml-3 text-[11px] text-fg-3">{r.note}</dd>}
              <dd className="ml-auto text-fg">{r.v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-auto pt-3" aria-hidden="true">
          <div className="relative text-fg/30">
            {lanes}
            <div className={cx(s.wipe, "absolute inset-0 text-fg/75")}>{lanes}</div>
          </div>
          <p className="mt-1.5 truncate text-[11px] text-fg-3">storage writes above, accounts below</p>
        </div>
      </div>
    </Panel>
  );
}
