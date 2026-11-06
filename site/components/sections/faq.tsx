import type { ReactNode } from "react";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { ArrowUpRight } from "@/components/ui/icons";
import { Reveal } from "@/components/motion";
import { Accordion } from "@/components/s4-pricing-faq/accordion";
import { docUrl } from "@/components/s4-pricing-faq/docs";
import { links } from "@/lib/data";

const Code = ({ children }: { children: ReactNode }) => <code className="font-mono text-[14px] text-ink">{children}</code>;

/** The repo docs an answer is drawn from; a doc the snapshot did not find on main is left out. */
function Sources({ docs }: { docs: [path: string, url?: string][] }) {
  const found = docs.flatMap(([path, url = docUrl(path)]) => (url ? [{ path, url }] : []));
  if (!found.length) return null;
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-4 font-mono text-label">
      <span className="uppercase">{found.length > 1 ? "Sources" : "Source"}</span>
      {found.map((d) => (
        <a key={d.path} href={d.url} className="link inline-flex items-center gap-1 py-1">
          {d.path.replace("docs/", "")}
          <ArrowUpRight className="text-muted" />
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
          It does not prove execution validity. Rooted records the node&rsquo;s import verdict instead of re-executing payloads,
          and replay starts from the node&rsquo;s prestate trace, not from a proof against the parent state root.
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
          still work as polling fallbacks and as the second source in provider comparison.
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
          Nothing on this page is estimated. Each figure comes from a snapshot of Rooted&rsquo;s own Sepolia node or the repo,
          and shows its source and capture date. Arrival times are when our node received each event, not when a builder published it.
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
    <Section
      id="faq"
      index={7}
      eyebrow="Open source"
      title={
        <>
          Open source. Check our <em className="italic">work.</em>
        </>
      }
      intro="MIT licensed: the Go backend, the dashboard and the captured evidence behind every check. Point it at your own node and run every check yourself."
      compact
    >
      <Reveal className="flex flex-col gap-3 rounded-panel border bg-paper-2 p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-2 pl-3">
          {/* Breaks only between "git clone" and the URL unless the URL alone cannot fit. */}
          <code className="min-w-0 font-mono text-xs leading-5 [overflow-wrap:anywhere] sm:text-sm">
            <span className="select-none text-muted">$ </span>git clone {links.github}
          </code>
          <CopyButton value={`git clone ${links.github}`} label="Copy clone command" className="shrink-0" />
        </div>
        <Button href={links.github} variant="outline" className="bg-paper">
          View on GitHub <ArrowUpRight />
        </Button>
      </Reveal>

      <div className="mt-16 grid grid-cols-12 gap-x-6 gap-y-8 md:mt-24">
        <div className="col-span-12 md:col-span-4 md:pt-3">
          <h3 className="font-serif text-h3">Fair questions.</h3>
          <p className="mt-3 max-w-[30ch] text-muted">Each answer cites the docs it comes from.</p>
        </div>
        <Reveal className="col-span-12 md:col-span-8">
          <Accordion items={faqs} />
        </Reveal>
      </div>
    </Section>
  );
}
