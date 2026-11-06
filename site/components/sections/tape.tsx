import type { CSSProperties } from "react";
import { blocks, type TapeBlock } from "@/lib/data";
import { gasM, num, shortHash } from "@/lib/format";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { SourceLine } from "@/components/ui/mono";
import { Marquee } from "@/components/s3-tape-how-terminal/marquee";

const list = blocks.blocks;
const range = `${num(blocks.from)} to ${num(blocks.to)}`;

// Bars share one scale, the block's gas limit. Header fill is bright, receipts dim: under EIP-8037 the two differ.
const fills = { header: "before:bg-fg-2", receipts: "before:bg-fg-4" };

// The tape is the page's largest subtree and every element in it is hydrated, so each card is kept to ~15
// elements: each bar is one element (the fill is the track's ::before), labels are bare text nodes.
function Gas({ label, gas, limit, kind }: { label: string; gas: number; limit: number; kind: keyof typeof fills }) {
  return (
    <>
      <p className="mt-3 flex items-baseline justify-between text-xs leading-4 text-fg-3">
        {label}
        <span className="num text-fg">{gasM(gas)}</span>
      </p>
      <div
        aria-hidden="true"
        className={`mt-1.5 h-1 overflow-hidden rounded-full bg-fg/[0.06] before:block before:h-full before:w-(--fill) before:rounded-full before:content-[''] ${fills[kind]}`}
        style={{ "--fill": `${Math.min(100, (gas / limit) * 100).toFixed(2)}%` } as CSSProperties}
      />
    </>
  );
}

function Block({ b }: { b: TapeBlock }) {
  const ptc = b.payload_present_votes !== null && b.ptc_size !== null;
  const full = ptc && b.payload_present_votes === b.ptc_size;
  return (
    // The hairline after each card is the parent-hash link to the next block; none after the last, where the loop restarts.
    <li className="relative w-[232px] shrink-0 rounded-card border bg-surface-1 px-4 pt-3.5 shadow-raised transition-colors duration-200 after:absolute after:top-6 after:-right-3 after:h-px after:w-3 after:bg-line-strong after:content-[''] last:after:hidden hover:border-line-strong hover:bg-surface-2">
      <p className="flex items-baseline justify-between">
        <span className="num text-sm font-medium tracking-[-0.01em] text-fg">{num(b.number)}</span>
        <span className="num text-xs text-fg-3">{num(b.tx_count)} txs</span>
      </p>
      <p className="num mt-0.5 mb-4 flex justify-between text-xs leading-5 text-fg-3">
        {b.slot !== null && `slot ${num(b.slot)}`}
        <span className="ml-auto">{shortHash(b.hash)}</span>
      </p>
      <Gas label="Header gas" gas={b.header_gas_used} limit={b.gas_limit} kind="header" />
      <Gas label="Receipt gas" gas={b.receipts_gas_sum} limit={b.gas_limit} kind="receipts" />
      <p className="-mx-4 mt-4 flex h-10 items-center gap-x-[1ch] border-t px-4 text-xs text-fg-3">
        {/* Gloas marks a proposer-built payload with builder index UINT64_MAX; the snapshot stores that as self_build. */}
        {b.self_build ? (
          <span className="text-fg-2">self-built</span>
        ) : (
          b.builder_index !== null && (
            <>
              builder<span className="num text-fg-2">#{b.builder_index}</span>
            </>
          )
        )}
        {ptc && (
          <span className="ml-auto">
            PTC <span className={`num ${full ? "text-acc" : "text-fg-2"}`}>{`${b.payload_present_votes}/${b.ptc_size}`}</span>
          </span>
        )}
      </p>
    </li>
  );
}

function Swatch({ className }: { className: string }) {
  return <span aria-hidden="true" className={`h-1 w-3 rounded-full ${className}`} />;
}

export function Tape() {
  return (
    <Section id="tape" aria-labelledby="tape-title" bleed>
      <Container className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-12">
        {/* An interstitial, not a chapter: one inline two-tone line instead of a headline. */}
        <h2 id="tape-title" className="max-w-[720px] text-[19px] leading-[1.4] font-medium tracking-[-0.02em]">
          Block tape.{" "}
          <span className="text-fg-3">{list.length} consecutive Sepolia blocks, as our node recorded them.</span>
        </h2>
        <p className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs whitespace-nowrap text-fg-3 md:pb-1">
          <span className="inline-flex items-center gap-2">
            <Swatch className="bg-fg-2" />
            Header gas
          </span>
          <span className="inline-flex items-center gap-2">
            <Swatch className="bg-fg-4" />
            Receipt gas
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="num text-acc">{`${blocks.ptc_size}/${blocks.ptc_size}`}</span>
            PTC voted present
          </span>
        </p>
      </Container>
      <Marquee
        className="mt-8"
        label={`Sepolia blocks ${range}`}
        seconds={list.length * 6}
        aside={<SourceLine data={{ ...blocks, source: `Snapshot · blocks ${range} from Geth and Nimbus on Rooted’s Sepolia node` }} />}
      >
        <ol className="flex gap-3 pr-3">
          {list.map((b) => (
            <Block key={b.number} b={b} />
          ))}
        </ol>
      </Marquee>
    </Section>
  );
}
