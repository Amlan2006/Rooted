import type { ReactNode } from "react";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourceLine } from "@/components/ui/mono";
import { ArrowUpRight } from "@/components/ui/icons";
import { Stagger, StaggerItem } from "@/components/reveal";
import { x402Docs } from "@/components/s4-pricing-faq/docs";
import { links, meta, pricing } from "@/lib/data";
import { num } from "@/lib/format";
import { cx } from "@/lib/cx";

const goMinor = meta.go_version.split(".").slice(0, 2).join(".");
const route = (pricing.route ?? "/api/paid/xray/[hash]").replace("[hash]", "{hash}");
const stored = pricing.stored_report;
// Both prices share one face, size and line box, so their baselines line up across the two cards.
const priceFace = "text-[44px] font-semibold leading-none tracking-[-0.045em] tabular-nums text-fg md:text-[52px]";

type Feature = [label: ReactNode, detail: ReactNode];

// Feature claims: README.md, docs/XRAY.md and docs/X402_HOSTED.md on main.
const selfHost: Feature[] = [
  ["Block X-ray", "parallelism ceilings for any recent block"],
  ["PayloadWatch", "ePBS bids, envelopes, PTC votes, arrival times"],
  ["Access lists", "EIP-7928 decode, commitment check, conflict graphs"],
  ["Execution profiler", "native Geth replay of every transaction"],
  ["Frame mempool", "a durable archive of the EIP-8141 devnet"],
  ["Provider diff", "one block hash, two providers, field by field"],
];

const hosted: Feature[] = [
  [<code key="r" className="font-mono text-[13px] tracking-normal">GET {route}</code>, "one block’s stored X-ray report"],
  ["No sign-up or API key", "the 402 response carries the price"],
  ["Charged on success", "unknown hashes and errors cost nothing"],
  ["No gas to hold", "the facilitator pays the Hedera fee"],
  ["Stored reads only", <>live replays stay <span key="s" className="whitespace-nowrap">self-hosted</span></>],
];

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-[4px] shrink-0 text-fg-3">
    <path d="M3 7.25 5.75 10 11 4" />
  </svg>
);

type PlanProps = {
  name: string;
  badge: ReactNode;
  price: ReactNode;
  sub?: ReactNode;
  terms: string;
  cta: ReactNode;
  listTitle: string;
  features: Feature[];
  foot: ReactNode;
  /** The hosted card: line-strong border, surface-1 and the inset top highlight. No gradient, no glow. */
  featured?: boolean;
};

// From md up each card is a 6-row subgrid of the pair, so price, terms, CTA, list and foot start on the same line in both.
function Plan({ name, badge, price, sub, terms, cta, listTitle, features, foot, featured }: PlanProps) {
  return (
    <StaggerItem
      className={cx(
        "flex flex-col rounded-window border p-6 md:row-span-6 md:grid md:grid-cols-1 md:grid-rows-subgrid lg:p-8",
        featured ? "border-line-strong bg-surface-1 shadow-raised" : "border-line",
      )}
    >
      <div className="flex h-6 items-center justify-between gap-4">
        <h3 className="text-[17px] font-semibold tracking-[-0.015em]">{name}</h3>
        {badge}
      </div>
      <div className="mt-8 lg:mt-10">
        <p className="flex h-12 items-end gap-2.5 md:h-[52px]">{price}</p>
        {sub && <p className="mt-3 font-mono text-xs leading-5 text-fg-3">{sub}</p>}
      </div>
      <p className="mt-5 max-w-[46ch] text-[15px] leading-6 text-fg-2">{terms}</p>
      <div className="mt-7 [&>a]:w-full">{cta}</div>
      <div className="-mx-6 mt-8 border-t px-6 pt-7 lg:-mx-8 lg:px-8">
        <p className="text-[13px] font-medium text-fg-3">{listTitle}</p>
        <ul className="mt-4 space-y-3 text-sm leading-[22px]">
          {features.map(([label, detail], i) => (
            <li key={i} className="flex gap-3">
              <Check />
              <span>
                <span className="font-medium tracking-[-0.005em] text-fg">{label}</span> <span className="text-fg-2">{detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="-mx-6 mt-8 border-t px-6 pt-6 lg:-mx-8 lg:px-8">{foot}</div>
    </StaggerItem>
  );
}

type FootLinkProps = { href: string; icon: ReactNode; accent?: boolean; title: ReactNode; detail: ReactNode; action: string; tip?: string };

/** The card's closing row: one fact with its proof link. Its visible text is its name (WCAG 2.5.3). Both cards end on the same shape, so their feet line up. */
function FootLink({ href, icon, accent, title, detail, action, tip }: FootLinkProps) {
  return (
    <a
      href={href}
      title={tip}
      className="group/foot flex items-center gap-3 rounded-card border border-line bg-surface-2 py-3 pl-3.5 pr-3 transition-colors duration-150 hover:border-line-strong hover:bg-fg/[0.035]"
    >
      <span aria-hidden="true" className={cx("grid size-7 shrink-0 place-items-center rounded-full border", accent ? "border-acc/30 text-acc" : "border-line-strong text-fg-2")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-5 text-fg">{title}</span>
        <span className="block font-mono text-xs leading-5 text-fg-3">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-fg-3 transition-colors duration-150 group-hover/foot:text-fg">
        <span className="hidden lg:inline">{action}</span>
        <ArrowUpRight className="transition-transform duration-150 ease-out group-hover/foot:-translate-y-px group-hover/foot:translate-x-px" />
      </span>
    </a>
  );
}

const icon = { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function Pricing() {
  const price = pricing.price;
  const [amount, ...unit] = price?.display.split(" ") ?? [];
  const atomic = price && pricing.asset_symbol === "HBAR" ? ` · ${num(Number(price.amount_atomic))} tinybars` : "";
  return (
    <Section
      id="pricing"
      size="md"
      title="Free to run. Pay per call if you don’t."
      lead={
        <>
          Every module is {meta.license} and runs beside your own node. A hosted instance can also sell stored X-ray reports to software
          agents, <b>one call at a time</b>.
        </>
      }
    >
      <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-y-0" gap={0.08}>
        <Plan
          name="Self-host"
          badge={<Badge>{meta.license} license</Badge>}
          price={<span className={priceFace}>Free</span>}
          sub="your node, your Postgres"
          terms="Every module, the dashboard and the REST API. Nothing metered, nothing gated."
          cta={
            <Button href={links.quickStart} variant="ghost" arrow="external">
              Quick start on GitHub
            </Button>
          }
          listTitle="Everything in the repo"
          features={selfHost}
          foot={
            <>
              <FootLink
                href={links.quickStart}
                icon={<svg {...icon}><path d="M2.5 3.5 5 6 2.5 8.5M6.5 8.75h3" /></svg>}
                title="Runs beside your own node"
                detail={`Go ${goMinor}+\u00a0· Node ${meta.node_version}\u00a0· Docker\u00a0· Geth\u00a0+\u00a0Nimbus`}
                action="Quick start"
              />
            </>
          }
        />
        <Plan
          featured
          name="Hosted API"
          badge={<Badge>x402 · {pricing.network ?? "Hedera testnet"}</Badge>}
          price={
            price ? (
              <>
                <span className={priceFace}>{amount}</span>
                <span className="pb-1 text-[17px] font-medium leading-none tracking-[-0.01em] text-fg-3">{unit.join(" ")}</span>
              </>
            ) : (
              <span className="text-lead text-fg">Priced per request in the 402 response</span>
            )
          }
          sub={price && `${price.unit}${atomic}`}
          terms={
            price
              ? "The default price, paid over x402 and settled on Hedera testnet. Operators can change it."
              : "Paid over x402 and settled on Hedera testnet."
          }
          cta={
            <Button href={x402Docs} arrow="external">
              Read the x402 docs
            </Button>
          }
          listTitle="Each call"
          features={hosted}
          foot={
            <>
              {stored && (
                // The first paid call this repo records: settled SUCCESS on Hedera testnet, logged as HCS message 1.
                <FootLink
                  accent
                  href={`https://hashscan.io/testnet/transaction/${stored.payment_tx}`}
                  icon={<svg {...icon}><path d="M2.75 6.25 5 8.5 9.25 3.75" /></svg>}
                  title="Settled on Hedera testnet"
                  detail={`report for Sepolia block ${num(stored.block_number)}`}
                  tip={`Payment ${stored.payment_tx} on HashScan`}
                  action="HashScan"
                />
              )}
              <SourceLine data={{ source: `dashboard/lib/x402.ts @ ${meta.commit}`, captured_at: pricing.captured_at }} className="mt-4" />
            </>
          }
        />
      </Stagger>
    </Section>
  );
}
