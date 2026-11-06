import type { CSSProperties } from "react";
import { num, shortHash } from "@/lib/format";
import { cx } from "@/lib/cx";
import { Check, Panel } from "./panel";
import { providers } from "./evidence";
import s from "./bento.module.css";

/** 0x + 8 … 6: long enough to compare by eye where there is room. */
const midHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

function Hash({ value }: { value: string }) {
  return (
    <>
      <span className="sm:hidden">{shortHash(value)}</span>
      <span className="hidden sm:inline">{midHash(value)}</span>
    </>
  );
}

/** The same block from two providers, field by field. Every field matched; the one observation gap is shown, not hidden. */
export function ProvidersMini() {
  const p = providers;
  const rows = [
    ...p.fields.map((f) => ({ name: f.name, value: <Hash value={f.value} /> })),
    { name: "tx hashes", value: `${p.tx_hashes} ordered` },
  ];

  return (
    <Panel crumb="Provider diff" title={<span className="font-mono">{num(p.block_number)}</span>} meta={<span className="hidden sm:inline">slot {num(p.slot)}</span>}>
      <table className="w-full table-fixed font-mono text-[12px]">
        <caption className="sr-only">Block {num(p.block_number)} as returned by your node and by a public Sepolia RPC</caption>
        <colgroup>
          <col className="w-[40%] sm:w-[26%]" />
          <col />
          <col className="hidden sm:table-column" />
          <col className="w-8 sm:w-10" />
        </colgroup>
        <thead>
          <tr className="h-9 border-b text-left font-sans text-[11px]">
            <th className="pl-3 font-normal text-fg-3 sm:pl-4">field</th>
            {/* Phones: one value column, since both providers returned the same value for every row. */}
            <th className="pl-2 font-normal text-fg-2 sm:pl-3">
              <span className="sm:hidden">both providers</span>
              <span className="hidden sm:inline">your node</span>
            </th>
            <th className="hidden pl-2 font-normal text-fg-2 sm:table-cell sm:pl-3">public RPC</th>
            <th className="pr-3 font-normal sm:pr-4">
              <span className="sr-only">match</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} className={cx(s.row, "h-[30px] border-b")} style={{ "--i": i } as CSSProperties}>
              <th scope="row" className="truncate pl-3 text-left sm:pl-4 font-sans text-[12px] font-normal text-fg-2">{r.name}</th>
              <td className="truncate pl-2 text-[11px] text-fg sm:pl-3 sm:text-[12px]">{r.value}</td>
              <td className="hidden truncate pl-2 text-[11px] text-fg sm:table-cell sm:pl-3 sm:text-[12px]">{r.value}</td>
              <td className="pr-3 text-right text-acc sm:pr-4">
                <span className={cx(s.mark, "inline-flex align-middle")} style={{ "--i": i } as CSSProperties}>
                  <Check />
                </span>
                <span className="sr-only">match</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="flex items-baseline gap-2 px-4 py-2.5 font-mono text-[11px] leading-4 text-fg-3">
        <span aria-hidden="true" className="size-1.5 shrink-0 -translate-y-px rounded-full bg-warn" />
        <span className="min-w-0">
          1 observation gap: {p.gap.method} unsupported on your node ({p.gap.code})
        </span>
      </p>
    </Panel>
  );
}
