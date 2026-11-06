import type { ReactNode } from "react";
import { CountUp } from "@/components/motion";
import { ArrowUpRight } from "@/components/ui/icons";
import { Mono, SourceLine } from "@/components/ui/mono";
import { heroBlock } from "@/lib/data";
import { num } from "@/lib/format";

const EIP_8037 = "https://eips.ethereum.org/EIPS/eip-8037";

/** Dense band under the hero X-ray: the same block's figures, then one line on what they mean. No section header. */
export function Proof() {
  const b = heroBlock;
  const cap = b.capping_tx;
  const creations = b.txs.filter((t) => t.is_create).length;
  const extra = b.receipts_gas_sum - b.header_gas_used;
  const figures: { label: string; value: number; note: ReactNode }[] = [
    {
      label: "Header gas used",
      value: b.header_gas_used,
      note: (
        <>
          of a <Mono>{num(b.gas_limit)}</Mono> gas limit
        </>
      ),
    },
    {
      label: "Receipt gas sum",
      value: b.receipts_gas_sum,
      note: (
        <>
          <Mono>{num(Math.abs(extra))}</Mono> {extra >= 0 ? "more" : "less"} than the header
        </>
      ),
    },
    {
      label: "Transactions",
      value: b.tx_count,
      note: (
        <>
          <Mono>{num(creations)}</Mono> of them contract creations
        </>
      ),
    },
    {
      label: "Largest single tx",
      value: cap.gas_used,
      note: (
        <>
          tx <Mono>{cap.index}</Mono>, {cap.is_create ? "a contract creation" : "a call"}
        </>
      ),
    },
  ];

  return (
    <div id="proof" className="mt-8 md:mt-10">
      {/* Hairlines are the 1px gaps showing the dl's line colour through opaque cells. */}
      <dl className="grid grid-cols-2 gap-px border-y bg-line lg:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="bg-paper py-5 odd:pr-4 even:pl-4 sm:py-6 sm:odd:pr-6 sm:even:pl-6 lg:pr-6 lg:[&:nth-child(3)]:pl-6">
            <dt className="font-mono text-label uppercase text-muted">{f.label}</dt>
            <dd className="mt-4">
              <CountUp value={f.value} className="block font-mono text-[1.375rem] leading-none tracking-[-0.03em] text-ink sm:text-[2rem] md:text-[2.25rem]" />
            </dd>
            <dd className="mt-3 text-sm text-muted">{f.note}</dd>
          </div>
        ))}
      </dl>
      <SourceLine data={{ source: "Same capture as the block above", captured_at: b.captured_at }} className="mt-3" />

      <div className="mt-10 grid grid-cols-12 gap-x-6 gap-y-3 md:mt-12">
        <h2 id="proof-title" className="col-span-12 font-serif text-h3 md:col-span-5 lg:col-span-4">
          Gas stopped measuring time.
        </h2>
        <p className="col-span-12 max-w-[62ch] text-muted md:col-span-7 md:pt-1 lg:col-span-8">
          The header of block {num(b.number)} and its receipts disagree, and both are right.{" "}
          <a href={EIP_8037} className="link inline-flex items-center gap-1">
            EIP-8037
            <ArrowUpRight />
          </a>{" "}
          meters execution and state creation as separate gas; the header keeps the larger, receipts charge both. Rooted’s replay checks each and times
          execution natively, not from gas.
        </p>
      </div>
    </div>
  );
}
