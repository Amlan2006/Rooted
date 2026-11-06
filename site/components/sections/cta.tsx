import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Command } from "@/components/ui/command";
import { Eyebrow } from "@/components/ui/eyebrow";
import { SourceLine } from "@/components/ui/mono";
import { Reveal, Stagger, StaggerItem } from "@/components/reveal";
import { links, meta } from "@/lib/data";

// The hero grid, faded from the top-right corner so the headline (bottom-left) sits on clear ground.
const gridMask = "radial-gradient(ellipse 75% 95% at 100% 0%, #000 15%, transparent 72%)";

// What the quick start needs (README.md, Quick start); versions from go.mod and the repo's Node pin (meta.json).
const needs: [name: string, value: string, note: string][] = [
  ["Go", `${meta.go_version.split(".").slice(0, 2).join(".")}+`, "backend and CLI"],
  ["Node", meta.node_version, "dashboard"],
  ["Docker", "compose", "Postgres"],
  ["Geth", "debug API", "execution"],
  ["Nimbus", "envelopes", "consensus"],
];

export function Cta() {
  // Only a deploy that names a dashboard promises an app (as in the nav); otherwise the white button is Self-host.
  const primary = links.dashboard
    ? { href: links.dashboard, label: "Open dashboard", arrow: "right" as const }
    : { href: links.quickStart, label: "Quick start", arrow: "external" as const };
  const clone = `git clone ${links.github}`;
  return (
    <Section id="start" aria-labelledby="start-title">
      <div className="relative isolate overflow-hidden rounded-window border border-line bg-surface-1 shadow-raised">
        <div aria-hidden="true" className="bg-grid absolute inset-0 -z-10" style={{ maskImage: gridMask, WebkitMaskImage: gridMask }} />
        <div className="grid gap-12 px-5 pb-10 pt-16 sm:px-10 md:px-14 md:pb-14 md:pt-24 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end lg:gap-16 lg:px-16 lg:pb-16 lg:pt-32">
          <Stagger gap={0.08}>
            <StaggerItem>
              <Eyebrow className="mb-5">Open source · {meta.license}</Eyebrow>
            </StaggerItem>
            <StaggerItem>
              <h2 id="start-title" className="text-[clamp(2.75rem,1.2rem+4.4vw,4.5rem)] leading-[0.98] font-semibold tracking-[-0.05em]">
                Run it against
                <span className="block text-fg-4">your own node.</span>
              </h2>
            </StaggerItem>
            <StaggerItem>
              <p className="mt-7 max-w-[46ch] text-lead text-fg-2">
                The Go backend, the dashboard and every check on this page. Point them at a Glamsterdam Sepolia node and run them yourself.
              </p>
            </StaggerItem>
          </Stagger>

          {/* What it runs on: the quick start's requirements, as a spec sheet. */}
          <Reveal delay={0.2}>
            <div className="rounded-card border border-line bg-surface-2 shadow-raised">
              <div className="flex h-10 items-center justify-between gap-3 border-b px-4 text-[13px]">
                <span className="font-medium tracking-[-0.01em] text-fg">What it runs on</span>
                <a href={links.quickStart} className="group/q inline-flex items-center gap-1 font-mono text-[12px] text-fg-3 transition-colors duration-150 hover:text-fg">
                  README
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="opacity-70 transition-transform duration-150 group-hover/q:-translate-y-px group-hover/q:translate-x-px">
                    <path d="M3.5 6.5l3-3M4 3.5h2.5V6" />
                  </svg>
                </a>
              </div>
              <dl className="px-4 py-1 font-mono text-[12.5px]">
                {needs.map(([name, value, note]) => (
                  <div key={name} className="grid h-9 grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b last:border-b-0">
                    <dt className="font-sans text-[13px] text-fg-2">{name}</dt>
                    <dd className="whitespace-nowrap text-fg">{value}</dd>
                    <dd className="whitespace-nowrap text-right text-[11.5px] text-fg-3">{note}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <SourceLine className="mt-3" data={{ source: `go.mod and README.md @ ${meta.commit}`, captured_at: null }} />
          </Reveal>
        </div>

        {/* The panel's action bar: the first command, then the two ways in. Side by side only once both fit (lg). */}
        <div className="flex flex-col gap-3 border-t bg-surface-1 px-5 py-5 sm:px-10 md:px-14 lg:flex-row lg:items-center lg:justify-between lg:px-16">
          <Command value={clone} className="lg:w-[440px]" />
          {/* Phones: full-width buttons, the primary on top. */}
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button href={links.docs} variant="ghost" size="lg" arrow="external">
              Read the docs
            </Button>
            <Button href={primary.href} size="lg" arrow={primary.arrow}>
              {primary.label}
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}
