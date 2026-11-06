import type { ReactNode } from "react";
import { Section } from "@/components/ui/section";
import { SourceLine } from "@/components/ui/mono";
import { Reveal } from "@/components/reveal";
import { SlotMini } from "@/components/bento/slot";
import { AccessListMini } from "@/components/bento/access-list";
import { XrayMini } from "@/components/bento/xray";
import { FrameMini } from "@/components/bento/frame";
import { ProfilerMini } from "@/components/bento/profiler";
import { ProvidersMini } from "@/components/bento/providers";
import { frame, profile, providers } from "@/components/bento/evidence";
import { Check } from "@/components/bento/panel";
import s from "@/components/bento/bento.module.css";
import { epbs, heroBlock } from "@/lib/data";
import { cx } from "@/lib/cx";

type Cell = {
  /** The module's name, as in the dashboard sidebar. */
  title: string;
  /** EIP number (and scope) after the title, one style for all. */
  tag?: string;
  text: string;
  mini: ReactNode;
  source: { source: string; captured_at: string };
  className?: string;
  /** Copy beside the mini instead of under it (from lg). */
  side?: boolean;
  /** The outcome in figures, under the copy (side cells, from lg). */
  result?: { value: string; label: string; acc?: boolean }[];
};

// Sentences are the verified copy from the previous product section; sources name what each mini reads.
const cells: Cell[] = [
  {
    title: "Slot lifecycle",
    tag: "EIP-7732",
    text: "Follows every slot’s builder bid, payload envelope and PTC votes, and records when each one reached your node.",
    mini: <SlotMini />,
    source: { source: "Nimbus events, as received at our node (not network-wide)", captured_at: epbs.captured_at },
    className: "md:col-span-2",
  },
  {
    title: "Access lists",
    tag: "EIP-7928",
    text: "Decodes each block access list, reproduces its commitment and maps RAW, WAR and WAW conflicts between transactions.",
    mini: <AccessListMini />,
    source: { source: "Nimbus envelope vs Geth header", captured_at: heroBlock.access_list.captured_at },
  },
  {
    title: "Block X-ray",
    text: "Sets gas-based parallelism ceilings beside measured time, with and without the access list.",
    mini: <XrayMini />,
    source: { source: "Geth eth_getBlockReceipts", captured_at: heroBlock.captured_at },
  },
  {
    title: "Frame mempool archive",
    tag: "EIP-8141 · devnet",
    text: "Archives the devnet’s admissions, rule checks and restarts, then confirms inclusion against canonical receipts.",
    mini: <FrameMini />,
    source: { source: "rooted frame-sync, frame devnet", captured_at: frame.captured_at },
  },
  {
    title: "Execution profiler",
    text: "Replays every transaction in a block on native Geth v1.17.10 and times it down to individual StateDB calls.",
    mini: <ProfilerMini />,
    source: { source: "rooted profile, native replay", captured_at: profile.captured_at },
  },
  {
    title: "Provider diff",
    text: "Sends one block hash to two providers and checks their answers field by field: header roots, ordered transactions and the access list commitment.",
    mini: <ProvidersMini />,
    source: { source: "rooted compare-providers", captured_at: providers.captured_at },
    className: "md:col-span-2 xl:col-span-3",
    side: true,
    result: [
      // Each row of the diff is a field: the header fields plus the ordered tx-hash list.
      { value: `${providers.fields.length + 1}/${providers.fields.length + 1}`, label: "fields match", acc: true },
      { value: "1", label: `unsupported call · ${providers.gap.code}` },
    ],
  },
];

export function Bento() {
  return (
    <Section
      id="product"
      eyebrow="Built for Glamsterdam"
      title="The fork’s new commitments,"
      dim="checked on a real chain."
      aside={
        // Scoped to what the grid shows: two Glamsterdam EIPs on Sepolia, the frame mempool on its own devnet, and tools.
        <p className="max-w-[56ch] text-[15px] leading-[1.55] text-fg-2 lg:max-w-[34ch] lg:pb-1.5">
          ePBS payloads (EIP-7732) and block access lists (EIP-7928), checked on Sepolia against your own node. The frame mempool runs on
          its own devnet; replay and provider diffs explain what the checks find.
        </p>
      }
    >
      {/* Hairlines are the 1px gaps showing the list's line colour; bg-clip-padding keeps the outer border the same weight. */}
      {/* Three columns only from xl: at 1024 a third of the grid is too narrow for the minis' figures, so lg keeps two. */}
      <ul className="grid gap-px overflow-hidden rounded-window border bg-line bg-clip-padding md:grid-cols-2 xl:grid-cols-3">
        {cells.map((c, i) => (
          <li key={c.title} className={cx(s.cell, "group/cell flex min-w-0 bg-bg", c.className)}>
            <Reveal
              delay={(i % 3) * 0.06}
              className={cx("flex min-w-0 flex-1 flex-col p-4 sm:p-7", c.side && "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-x-12")}
            >
              <div className={cx("min-w-0", c.side && "lg:order-2")}>{c.mini}</div>
              <div className={cx("flex flex-1 flex-col", c.side && "lg:order-1")}>
                <h3 className={cx("mt-6 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[15px] leading-6 font-medium tracking-[-0.01em] text-fg", c.side && "lg:mt-0")}>
                  {c.title}
                  {c.tag && <span className="font-mono text-[12px] font-normal tracking-normal text-fg-3">{c.tag}</span>}
                </h3>
                <p className="mt-1.5 max-w-[52ch] text-[15px] leading-[1.55] text-fg-2">{c.text}</p>
                {c.result && (
                  <dl className="mt-auto hidden gap-10 pt-8 lg:flex">
                    {c.result.map((r) => (
                      <div key={r.label} className="flex flex-col-reverse">
                        <dt className="mt-1.5 text-[13px] leading-5 text-fg-3">{r.label}</dt>
                        <dd className="flex items-center gap-2 text-[30px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-fg">
                          {r.value}
                          {r.acc && <Check className="size-4 text-acc" />}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <SourceLine data={c.source} className={cx(c.result ? "pt-5 lg:pt-6" : "mt-auto pt-5")} />
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
