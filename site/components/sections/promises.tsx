import type { ReactNode } from "react";
import { Section } from "@/components/ui/section";
import { Reveal } from "@/components/motion";
import { SlotTimeline } from "@/components/s2-promises-product/slot-timeline";
import { AccessLanes } from "@/components/s2-promises-product/access-lanes";
import { epbs, heroBlock } from "@/lib/data";

function PromiseRow({ eip, name, title, children, figure }: { eip: string; name: string; title: string; children: ReactNode; figure: ReactNode }) {
  return (
    <Reveal className="grid grid-cols-12 gap-x-6 gap-y-8 border-t py-12 first:border-t-0 first:pt-0 last:pb-0 md:py-16">
      <div className="col-span-12 lg:sticky lg:top-24 lg:col-span-4 lg:self-start">
        <p className="font-mono text-label uppercase text-muted">
          <span className="text-ink">{eip}</span> · {name}
        </p>
        <h3 className="mt-4 max-w-[18ch] font-serif text-h3">{title}</h3>
        <p className="mt-4 max-w-[46ch] text-muted">{children}</p>
      </div>
      <div className="col-span-12 lg:col-span-8">{figure}</div>
    </Reveal>
  );
}

export function Promises() {
  return (
    <Section
      id="promises"
      index={1}
      eyebrow="Promises"
      title="Glamsterdam makes two promises."
      intro="ePBS splits each block from its payload, and EIP-7928 makes every block list the state it touches. Rooted checks both from its own Sepolia node."
    >
      <PromiseRow eip="EIP-7732" name="ePBS" title="The payload arrives on time." figure={<SlotTimeline epbs={epbs} />}>
        The proposer commits to a builder’s bid, then the builder reveals the payload and a committee votes on whether it showed up. Rooted
        logs each step as it reaches the node.
      </PromiseRow>
      <PromiseRow eip="EIP-7928" name="Block access lists" title="The block says what it touches." figure={<AccessLanes block={heroBlock} />}>
        Every block commits to the accounts and storage slots it changes, indexed by transaction, and lists what it only reads.
        Rooted decodes the list, recomputes the commitment and compares it with the header.
      </PromiseRow>
    </Section>
  );
}
