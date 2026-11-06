import { links, meta } from "@/lib/data";
import { Container } from "./ui/container";
import { ArrowUpRight } from "./ui/icons";

// Labels from the README docs line; a link only renders if the snapshot found that file in docs/.
const docs = [
  ["Block X-ray", "docs/XRAY.md"],
  ["x402 hosted mode", "docs/X402_HOSTED.md"],
  ["API", "docs/API.md"],
  ["PayloadWatch", "docs/PAYLOADWATCH.md"],
  ["BAL analyzer", "docs/BAL_ANALYZER.md"],
  ["Frame monitor", "docs/FRAME_MONITOR.md"],
  ["Profiler", "docs/EXECUTION_PROFILER.md"],
  ["Sepolia node", "docs/SEPOLIA_NODE.md"],
].flatMap(([label, path]) => {
  const doc = meta.docs.find((d) => d.path === path);
  return doc ? [{ label, href: doc.url, external: true }] : [];
});

const columns = [
  {
    title: "Site",
    items: [
      { label: "Product", href: "#product" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  { title: "Docs", items: docs },
  {
    title: "Project",
    items: [
      { label: "GitHub", href: links.github, external: true },
      { label: `${meta.license} license`, href: links.license, external: true },
      links.dashboard ? { label: "Open dashboard", href: links.dashboard, external: true } : { label: "Quick start", href: links.quickStart, external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t">
      <Container className="py-16 md:py-20">
        <div className="grid grid-cols-12 gap-x-6 gap-y-12">
          <div className="col-span-12 md:col-span-5">
            <p className="font-mono text-[15px] font-medium leading-4 tracking-[-0.01em]">rooted</p>
            <p className="mt-4 max-w-[32ch] text-balance text-sm text-muted">Live, verifiable telemetry for Glamsterdam-era Ethereum.</p>
          </div>
          <nav aria-label="Footer" className="col-span-12 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:col-span-7">
            {columns.map((col) => (
              <div key={col.title}>
                <p className="font-mono text-label uppercase text-muted">{col.title}</p>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {col.items.map((item) => (
                    <li key={item.label}>
                      <a href={item.href} className="inline-flex items-center gap-1 py-0.5 transition-colors duration-150 hover:text-muted focus-visible:text-muted">
                        {item.label}
                        {"external" in item && item.external && <ArrowUpRight className="text-muted" />}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-16 flex flex-col gap-2 border-t pt-6 font-mono text-label uppercase text-muted sm:flex-row sm:justify-between">
          <p>Built at {meta.built_at}</p>
          <p>
            {meta.license} license · main @ <span className="normal-case">{meta.commit}</span>
          </p>
        </div>
      </Container>
    </footer>
  );
}
