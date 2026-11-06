import type { CSSProperties } from "react";
import { blocks, type TapeBlock } from "@/lib/data";
import { gasM, num } from "@/lib/format";
import { Section } from "@/components/ui/section";
import { SourceLine } from "@/components/ui/mono";
import { Marquee } from "@/components/s3-tape-how-terminal/marquee";

const list = blocks.blocks;
const range = `${num(blocks.from)} to ${num(blocks.to)}`;

// 12 elements a block: the tape is the page's largest hydrated subtree, so labels sit beside bare text (an anonymous
// flex item) and each bar's fill is the track's ::before.
function Gas({ label, gas, limit, fill, className }: { label: string; gas: number; limit: number; fill: string; className?: string }) {
  return (
    <>
      <p className={`flex justify-between ${className ?? ""}`}>
        <span className="text-label uppercase text-muted">{label}</span>
        {gasM(gas)}
      </p>
      <div
        aria-hidden="true"
        className={`mt-1.5 h-1 bg-line before:block before:h-full before:w-(--fill) before:content-[''] ${fill}`}
        style={{ "--fill": `${Math.min(100, (gas / limit) * 100).toFixed(2)}%` } as CSSProperties}
      />
    </>
  );
}

function Block({ b }: { b: TapeBlock }) {
  const ptc = b.payload_present_votes !== null && b.ptc_size !== null;
  return (
    <li className="flex w-60 shrink-0 flex-col border-r px-5 pb-4 pt-5 font-mono text-xs tabular-nums">
      <p className="text-sm">{num(b.number)}</p>
      <p className="mb-6 mt-1 text-muted">{`${b.slot !== null ? `slot ${num(b.slot)} · ` : ""}${num(b.tx_count)} txs`}</p>
      <Gas label="Header gas" gas={b.header_gas_used} limit={b.gas_limit} fill="before:bg-ink" />
      <Gas label="Receipt gas" gas={b.receipts_gas_sum} limit={b.gas_limit} fill="before:bg-muted/55" className="mt-3" />
      <p className="mt-6 flex gap-x-[1ch] border-t pt-3">
        {/* Gloas marks a proposer-built payload with builder index UINT64_MAX; the snapshot stores that as self_build. */}
        {b.self_build ? "self-built" : b.builder_index !== null && (
          <>
            <span className="text-label uppercase text-muted">Builder</span>
            {String(b.builder_index)}
          </>
        )}
        {ptc && (
          <>
            <span className="ml-auto text-label uppercase text-muted">PTC</span>
            {`${b.payload_present_votes}/${b.ptc_size}`}
          </>
        )}
      </p>
    </li>
  );
}

export function Tape() {
  return (
    // An interstitial, not a chapter: one mono label, the strip, its source.
    <Section
      id="tape"
      index={3}
      eyebrow={
        <>
          Block tape <span aria-hidden="true">·</span> {list.length} consecutive blocks
        </>
      }
      bleed
      compact
    >
      <Marquee label={`Sepolia blocks ${range}`} seconds={list.length * 5} aside={<SourceLine data={{ ...blocks, source: `Sepolia blocks ${range} · ${blocks.source}` }} />}>
        <ol className="flex">
          {list.map((b) => (
            <Block key={b.number} b={b} />
          ))}
        </ol>
      </Marquee>
    </Section>
  );
}
