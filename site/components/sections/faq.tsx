import type { ReactNode } from "react";
import { Section, SectionHead } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "@/components/ui/icons";
import { Reveal } from "@/components/reveal";
import { Accordion } from "@/components/s4-pricing-faq/accordion";
import { docUrl } from "@/components/s4-pricing-faq/docs";
import { links } from "@/lib/data";

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded-[5px] border border-line bg-fg/[0.04] px-[5px] py-px font-mono text-[13px] text-fg">{children}</code>
);

/** The repo docs an answer is drawn from; a doc the snapshot did not find on main is left out. */
function Sources({ docs }: { docs: [path: string, url?: string][] }) {
  const found = docs.flatMap(([path, url = docUrl(path)]) => (url ? [{ path, url }] : []));
  if (!found.length) return null;
  return (
    <p className="mt-5 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[13px] text-fg-3">{found.length > 1 ? "Sources" : "Source"}</span>
      {found.map((d) => (
        <a
          key={d.path}
          href={d.url}
          className="group/src inline-flex h-6 items-center gap-1 rounded-md border border-line-strong bg-fg/[0.02] px-2 font-mono text-[12px] text-fg-2 transition-[border-color,background-color,color] duration-150 hover:border-fg/20 hover:bg-fg/[0.05] hover:text-fg"
        >
          {d.path.replace("docs/", "")}
          <ArrowUpRight className="size-2.5 opacity-60 transition-transform duration-150 ease-out group-hover/src:-translate-y-px group-hover/src:translate-x-px" />
        </a>
      ))}
    </p>
  );
}

const faqs = [
  {
    q: "What does Rooted verify, and what doesn’t it?",
    a: (
      <>
        <p>
          It verifies identity and commitments. Before an observation is stored, the beacon block, the payload envelope and the
          execution block must agree on slot, root and payload hash. The block access list from the envelope is re-encoded and
          must hash to the header&rsquo;s <Code>blockAccessListHash</Code>, or ingestion stops.
        </p>
        <p className="mt-3">
          It does not prove execution validity. Rooted records the node&rsquo;s import verdict instead of re-executing payloads
          to judge validity. Its replay is for timing, and starts from the node&rsquo;s prestate trace, not from a proof against
          the parent state root.
        </p>
        <Sources docs={[["docs/PAYLOADWATCH.md"], ["docs/BAL_ANALYZER.md"], ["docs/EXECUTION_PROFILER.md"]]} />
      </>
    ),
  },
  {
    q: "Why does it need my own node?",
    a: (
      <>
        <p>
          Public endpoints don&rsquo;t stream beacon events (the public Sepolia beacon answered <Code>/eth/v1/events</Code>{" "}
          with 501), rarely expose Geth debug traces, and arrival times only mean something at a node you run. Public RPCs
          still work as polling fallbacks and as the second source in a provider diff.
        </p>
        <Sources docs={[["docs/SEPOLIA_NODE.md"], ["docs/PROVIDER_COMPARISON.md"]]} />
      </>
    ),
  },
  {
    q: "What is x402 for?",
    a: (
      <>
        <p>
          Letting software pay for a report without signing up. An unpaid request to a hosted instance gets HTTP 402 with the
          price; the agent signs a Hedera testnet transfer and retries, and the payment settles only if the report comes back.
          Hedera, because no public x402 facilitator settles per call on Sepolia. It is off by default, and self-hosted Rooted
          serves the same report free.
        </p>
        <Sources docs={[["docs/X402_HOSTED.md"]]} />
      </>
    ),
  },
  {
    q: "What is measured, and what is estimated?",
    a: (
      <>
        <p>
          Nothing on this page is estimated. Each figure comes from a snapshot of Rooted&rsquo;s own Sepolia node, the Hedera
          testnet mirror node or the repo, and shows its source and capture date. Arrival times are when our node received each event, not when a builder published it.
          Replay timings come from one machine&rsquo;s native Geth replay. When a value is missing, Rooted leaves it empty
          rather than deriving it from gas.
        </p>
        <Sources docs={[["docs/PAYLOADWATCH.md"], ["docs/EXECUTION_PROFILER.md"]]} />
      </>
    ),
  },
];

export function Faq() {
  return (
    <Section id="faq" aria-labelledby="faq-title">
      <div className="grid gap-y-12 lg:grid-cols-12 lg:gap-x-8">
        {/* Head left, list right from lg; the head stays in view while the answers scroll. */}
        <div className="lg:sticky lg:top-24 lg:col-span-5 lg:self-start">
          <SectionHead id="faq-title" size="sm" title="Fair questions, sourced answers." lead="What Rooted checks, what it can’t, and where every number on this page comes from." />
          <div className="mt-8">
            <Button href={links.docs} variant="ghost" arrow="external">
              Read the docs
            </Button>
          </div>
        </div>
        <Reveal className="lg:col-span-7">
          <Accordion items={faqs} />
        </Reveal>
      </div>
    </Section>
  );
}
