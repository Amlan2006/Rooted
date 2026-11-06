import type { ReactNode } from "react";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourceLine } from "@/components/ui/mono";
import { ArrowUpRight } from "@/components/ui/icons";
import { Stagger, StaggerItem } from "@/components/motion";
import { x402Docs } from "@/components/s4-pricing-faq/docs";
import { links, meta, pricing } from "@/lib/data";

const goMinor = meta.go_version.split(".").slice(0, 2).join(".");
const route = (pricing.route ?? "/api/paid/xray/[hash]").replace("[hash]", "{hash}");
// Both prices share one face, size and baseline (mono, as every figure on the page).
const priceFace = "font-mono text-[44px] leading-none tracking-[-0.04em]";

// Feature claims: README.md, docs/XRAY.md and docs/X402_HOSTED.md on main.
const selfHost: [ReactNode, string][] = [
  ["Block X-ray", "parallelism ceilings for any recent block, free"],
  ["PayloadWatch", "ePBS bids, envelopes, PTC votes, arrival times"],
  ["BAL analyzer", "EIP-7928 decode, commitment check, conflict graphs"],
  ["Execution profiler", "native Geth replay of every transaction"],
  ["Frame mempool", "a durable archive of the EIP-8141 devnet"],
  ["Provider comparison", "one block hash, two providers, field by field"],
];

const hosted: [ReactNode, string][] = [
  [<code key="r" className="font-mono text-[13px]">GET {route}</code>, "one block’s stored X-ray report"],
  ["No sign-up or API key", "the 402 response carries the price"],
  ["Charged on success", "unknown hashes and errors cost nothing"],
  ["No gas to hold", "the facilitator pays the Hedera fee"],
  ["Stored reads only", "live replays stay self-hosted"],
];

const Check = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true" className="mt-[7px] shrink-0 text-muted">
    <path d="M2 6.5 4.75 9 10 3" />
  </svg>
);

type PlanProps = { name: string; badge: string; price: ReactNode; terms: string; features: [ReactNode, string][]; cta: ReactNode; foot: ReactNode };

// From md up each plan is a 7-row subgrid of the pair, so price, terms, list and CTA line up across both columns.
function Plan({ name, badge, price, terms, features, cta, foot }: PlanProps) {
  return (
    <StaggerItem className="flex flex-col p-6 sm:p-8 md:row-span-7 md:grid md:grid-rows-subgrid lg:p-10">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-medium">{name}</h3>
        <Badge>{badge}</Badge>
      </div>
      <div className="mt-10 flex h-14 items-end">{price}</div>
      <p className="mt-3 max-w-[44ch] text-muted">{terms}</p>
      <div className="hairline my-8" />
      <ul className="space-y-3">
        {features.map(([label, detail], i) => (
          <li key={i} className="flex gap-3">
            <Check />
            <span>
              <span className="font-medium">{label}</span> <span className="text-muted">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="pt-10">{cta}</div>
      {foot}
    </StaggerItem>
  );
}

export function Pricing() {
  const price = pricing.price;
  const [amount, ...unit] = price?.display.split(" ") ?? [];
  return (
    <Section
      id="pricing"
      index={6}
      eyebrow="Pricing"
      title="Self-host for free, or pay per block."
    >
      <Stagger className="grid divide-y rounded-panel border md:grid-cols-2 md:divide-x md:divide-y-0">
        <Plan
          name="Self-host"
          badge={`${meta.license} license`}
          price={<p className={priceFace}>Free</p>}
          terms="Your node, your Postgres, every module, the dashboard and the REST API. Nothing metered, nothing gated."
          features={selfHost}
          cta={
            <Button href={links.quickStart}>
              Self-host from GitHub <ArrowUpRight />
            </Button>
          }
          foot={
            <p className="mt-4 text-sm text-muted">
              Needs Go {goMinor}+, Node {meta.node_version}, Docker and a Sepolia Geth + Nimbus node.
            </p>
          }
        />
        <Plan
          name="Hosted API"
          badge="testnet"
          price={
            price ? (
              <p className="flex items-baseline gap-2">
                <span className={priceFace}>{amount}</span>
                <span className="font-mono text-lead text-muted">{unit.join(" ")}</span>
              </p>
            ) : (
              <p className="text-lead">Priced per request in the 402 response</p>
            )
          }
          terms={
            price
              ? `Default price ${price.unit}, paid over x402 and settled on Hedera testnet. Operators can change it.`
              : "Paid over x402 and settled on Hedera testnet."
          }
          features={hosted}
          cta={
            <Button href={x402Docs} variant="outline">
              Read the x402 docs <ArrowUpRight />
            </Button>
          }
          foot={<SourceLine data={pricing} className="mt-4" />}
        />
      </Stagger>
    </Section>
  );
}
