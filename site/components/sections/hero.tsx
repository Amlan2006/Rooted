import { BlockXray } from "@/components/block-xray";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ArrowUpRight } from "@/components/ui/icons";
import { links } from "@/lib/data";
import { cx } from "@/lib/cx";
import { Proof } from "./proof";

/**
 * Faint 1px column guides, hero only: 4 columns on phones, 8 on tablets, 12 from lg, on the same grid as the content.
 * One line per column edge (left edges, plus the grid's right edge), and they stop at the X-ray panel.
 */
function Guides() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <Container className="h-full">
        <div className="grid h-full grid-cols-4 gap-x-6 border-r border-line/70 md:grid-cols-8 lg:grid-cols-12">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className={cx("h-full border-l border-line/70", i >= 4 && i < 8 && "hidden md:block", i >= 8 && "hidden lg:block")} />
          ))}
        </div>
      </Container>
    </div>
  );
}

export function Hero() {
  return (
    <section id="hero" aria-labelledby="hero-title" className="isolate pb-20 md:pb-24">
      <div className="relative">
        <Guides />
        <Container className="pt-14 md:pt-20">
          <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
            <div className="col-span-12 lg:col-span-8">
              <Eyebrow>Ethereum Sepolia · Glamsterdam</Eyebrow>
              {/* Not wrapped in Reveal: this is the LCP element and must paint without waiting for JS. */}
              <h1 id="hero-title" className="mt-6 font-serif text-display">
                Every Ethereum block, <em className="italic">checked.</em>
              </h1>
            </div>
            <div className="col-span-12 md:col-span-8 lg:col-span-4 lg:pb-2.5">
              <p className="max-w-[40ch] text-lead text-muted">
                Rooted verifies ePBS payloads and block access lists against your own node, and replays execution natively.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button href={links.quickStart}>
                  Self-host <ArrowUpRight />
                </Button>
                <Button href={links.docs} variant="outline">
                  Read the docs <ArrowUpRight />
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-12 md:mt-14">
            <BlockXray />
          </div>
        </Container>
      </div>
      <Container>
        <Proof />
      </Container>
    </section>
  );
}
