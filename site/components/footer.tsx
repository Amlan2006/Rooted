import { blocks, links, meta } from "@/lib/data";
import { capturedOn } from "@/lib/format";
import { Container } from "./ui/container";
import { ArrowUpRight } from "./ui/icons";
import { LogoMark } from "./ui/logo";

type Item = { label: string; href: string; external?: boolean };

// A docs link only renders if the snapshot found that file in docs/.
const docs: Item[] = [
  ["Quick start", "README.md", links.quickStart],
  ["API reference", "docs/API.md"],
  ["x402 hosted mode", "docs/X402_HOSTED.md"],
  ["Analyst", "docs/ANALYST.md"],
  ["PayloadWatch", "docs/PAYLOADWATCH.md"],
  ["Access lists", "docs/BAL_ANALYZER.md"],
  ["Block X-ray", "docs/XRAY.md"],
].flatMap(([label, path, href]) => {
  const doc = meta.docs.find((d) => d.path === path);
  return doc ? [{ label, href: href ?? doc.url, external: true }] : [];
});

const columns: { title: string; items: Item[] }[] = [
  {
    title: "Product",
    items: [
      { label: "Overview", href: "#product" },
      { label: "Analyst", href: "#analyst" },
      { label: "How it works", href: "#how-it-works" },
      { label: "CLI and API", href: "#use" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  { title: "Developers", items: docs },
  {
    title: "Project",
    items: [
      { label: "GitHub", href: links.github, external: true },
      { label: `${meta.license} license`, href: links.license, external: true },
      { label: "All docs", href: links.docs, external: true },
      ...(links.dashboard ? [{ label: "Open dashboard", href: links.dashboard, external: true }] : []),
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line md:mt-[140px]">
      <Container className="pb-10 pt-16 md:pt-20">
        <div className="grid gap-y-12 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <a href="#main" aria-label="Rooted, back to top" className="-mx-1.5 inline-flex h-8 items-center gap-2.5 rounded-control px-1.5 text-[15px] font-semibold tracking-[-0.02em] transition-opacity duration-150 hover:opacity-80">
              <LogoMark />
              Rooted
            </a>
            <p className="mt-4 max-w-[34ch] text-sm leading-6 text-fg-2">Glamsterdam observability for Ethereum Sepolia, checked against your own node.</p>
          </div>
          {/* Phones: two columns, Developers beside Product and Project under Product. */}
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 md:col-span-8">
            {columns.map((col) => (
              <div key={col.title} className={col.title === "Developers" ? "row-span-2 sm:row-span-1" : undefined}>
                <p className="text-[13px] font-medium text-fg">{col.title}</p>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {col.items.map((item) => (
                    <li key={item.label}>
                      <a href={item.href} className="group/link inline-flex items-center gap-1 whitespace-nowrap text-fg-2 transition-colors duration-150 hover:text-fg focus-visible:text-fg">
                        {item.label}
                        {item.external && <ArrowUpRight className="opacity-40 transition-[translate,opacity] duration-150 group-hover/link:-translate-y-px group-hover/link:translate-x-px group-hover/link:opacity-80" />}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-16 flex flex-col gap-2 border-t border-line pt-6 text-[13px] text-fg-3 lg:flex-row lg:items-baseline lg:justify-between lg:gap-8">
          <p className="shrink-0">
            Built at {meta.built_at} <span className="whitespace-nowrap">· {meta.license}</span>
          </p>
          <p className="font-mono text-[12px] leading-5 lg:text-right">
            Figures: snapshots of Rooted’s Sepolia node, Hedera testnet and the repo’s recorded runs.
            <span className="block">
              captured {capturedOn(blocks.captured_at)} <span className="whitespace-nowrap">· main @ {meta.commit}</span>
            </span>
          </p>
        </div>
      </Container>
    </footer>
  );
}
