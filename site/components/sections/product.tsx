import type { ReactNode } from "react";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Reveal } from "@/components/motion";
import { BalArt, FrameArt, PayloadArt, ProfilerArt, ProviderArt, XrayArt } from "@/components/s2-promises-product/product-art";

// Commands are real `rooted` subcommands (cmd/rooted/main.go on main).
const tools: { name: string; art: ReactNode; text: string; cmd: string; badge?: string }[] = [
  {
    name: "PayloadWatch",
    art: <PayloadArt />,
    text: "Follows every slot’s builder bid, payload envelope and PTC votes, and records when each one reached your node.",
    cmd: "rooted serve",
  },
  {
    name: "Block X-ray",
    art: <XrayArt />,
    text: "Shows how parallel a block can really run: gas-based ceilings next to measured time, with and without the access list.",
    cmd: "rooted xray BLOCK_HASH",
  },
  {
    name: "BAL analyzer",
    art: <BalArt />,
    text: "Decodes each EIP-7928 access list, reproduces its commitment and maps RAW, WAR and WAW conflicts between transactions.",
    cmd: "rooted analyze BLOCK_HASH",
  },
  {
    name: "Frame mempool",
    art: <FrameArt />,
    text: "Archives the EIP-8141 devnet’s admissions, rule checks and restarts, then confirms inclusion against canonical receipts.",
    cmd: "rooted frame-sync gateway",
    badge: "devnet",
  },
  {
    name: "Execution profiler",
    art: <ProfilerArt />,
    text: "Replays every transaction in a block on native Geth v1.17.10 and times it down to individual StateDB calls.",
    cmd: "rooted profile BLOCK_HASH",
  },
  {
    name: "Provider comparison",
    art: <ProviderArt />,
    text: "Sends one block hash to two providers and checks their answers field by field.",
    cmd: "rooted compare-providers",
  },
];

export function Product() {
  return (
    <Section
      id="product"
      index={2}
      eyebrow="Product"
      split
      title="Six instruments, one node."
      intro="Each one checks what it sees against the commitments it can reach (beacon roots, payload hashes, header and BAL hashes) and keeps its evidence in Postgres."
    >
      <ul className="grid gap-px overflow-hidden rounded-panel border bg-line md:grid-cols-2 lg:grid-cols-3">
        {tools.map((t, i) => (
          <li key={t.name} className="group flex bg-paper">
            {/* The cell stays opaque and only its contents reveal, so the 1px gap hairlines never show as a grey block. */}
            <Reveal delay={(i % 3) * 0.06} className="flex flex-1 flex-col p-5 sm:p-6 md:p-8">
              {t.art}
              <h3 className="mt-7 flex items-center gap-3 font-medium md:mt-10">
                {t.name}
                {t.badge && <Badge>{t.badge}</Badge>}
              </h3>
              <p className="mt-1.5 text-muted">{t.text}</p>
              <p className="mt-auto pt-5 font-mono text-xs text-muted md:pt-6">
                <span aria-hidden="true">$ </span>
                <code>{t.cmd}</code>
              </p>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
