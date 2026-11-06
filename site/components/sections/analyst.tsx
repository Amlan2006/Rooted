import type { ReactNode } from "react";
import { Section, SectionHead } from "@/components/ui/section";
import { SourceLine } from "@/components/ui/mono";
import { ArrowUpRight } from "@/components/ui/icons";
import { Reveal } from "@/components/reveal";
import { AnalystRun } from "@/components/analyst/run";
import { analyst } from "@/components/analyst/data";
import { HashIcon, ReceiptIcon, ToolsIcon } from "@/components/analyst/icons";
import { links, pricing } from "@/lib/data";

const facts: { icon: ReactNode; title: string; body: ReactNode }[] = [
  {
    icon: <ToolsIcon />,
    title: "Investigates with Rooted’s own tools",
    body: (
      <>
        {analyst.tools.length} tools: reads over stored X-rays, PayloadWatch slots, builder stats, the frame mempool and the node, plus capped
        actions (replay a block, compare providers). It doesn’t answer protocol data questions from memory.
      </>
    ),
  },
  {
    icon: <ReceiptIcon />,
    title: "Can buy a report over x402",
    body: (
      <>
        When an operator turns payments on, it can buy a full block report over <b>x402 on Hedera</b>
        {pricing.price && <> for <span className="whitespace-nowrap">{pricing.price.display}</span></>}: at most one purchase per question, inside a
        daily budget. Auto-briefs are read-only.
      </>
    ),
  },
  {
    icon: <HashIcon />,
    title: "Cites its sources",
    body: (
      <>
        Each <span className="font-mono text-[14px] text-fg">[E1]</span> points at a tool result and the sha256 of its bytes. Auto-briefs can anchor their hash on Hedera Consensus Service.
      </>
    ),
  },
];

// The head lives in the left column beside the run, not above it: a different shape from the chapter heads around it.
export function Analyst() {
  return (
    <Section id="analyst" aria-labelledby="analyst-title">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,620px)] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHead
            id="analyst-title"
            size="md"
            title="Ask a block anything."
            lead={
              <>
                <b>It shows its work.</b> A Claude agent inside the dashboard: ask about a block, a slot or a builder, and every figure in its
                answer cites a tool result you can check.
              </>
            }
          />
          <dl className="mt-10 border-t">
            {facts.map((f) => (
              <div key={f.title} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3.5 border-b py-5">
                <dt className="contents">
                  <span className="mt-[3px] text-fg-2">{f.icon}</span>
                  <span className="text-[15px] font-medium leading-[22px] tracking-[-0.01em] text-fg">{f.title}</span>
                </dt>
                <dd className="col-start-2 mt-1 text-[15px] leading-[22px] text-pretty text-fg-2">{f.body}</dd>
              </div>
            ))}
          </dl>
          <a href={links.doc("docs/ANALYST.md")} className="group/l mt-6 inline-flex items-center gap-1.5 text-sm text-fg-2 transition-colors hover:text-fg">
            How the Analyst works
            <ArrowUpRight className="opacity-60 transition-transform group-hover/l:-translate-y-px group-hover/l:translate-x-px" />
          </a>
        </div>
        <Reveal>
          <AnalystRun />
          <SourceLine data={analyst} className="mt-3" />
        </Reveal>
      </div>
    </Section>
  );
}
