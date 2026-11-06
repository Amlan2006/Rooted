import type { CSSProperties } from "react";
import { AppTour } from "@/components/app-window";
import s from "@/components/app-window/anim.module.css";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Command } from "@/components/ui/command";
import { ArrowRight } from "@/components/ui/icons";
import { links } from "@/lib/data";
import { cx } from "@/lib/cx";

const LINES = [["See", "inside", "every"], ["Ethereum", "block."]];
const delay = (sec: number) => ({ animationDelay: `${sec}s` }) as CSSProperties;

export function Hero() {
  // Same rule as the nav: only a deploy that names a dashboard promises one.
  const cta = links.dashboard
    ? { href: links.dashboard, label: "Open dashboard", arrow: "right" as const }
    : { href: links.quickStart, label: "Quick start", arrow: "external" as const };
  let w = 0;

  return (
    <section id="hero" aria-labelledby="hero-title" className="relative isolate">
      {/* Starts behind the transparent nav so the grid runs to the top of the page. */}
      <div aria-hidden="true" className="bg-grid absolute inset-x-0 -top-16 -z-10 h-[820px]" />
      <Container className="pt-14 md:pt-20">
        <a
          href="#product"
          className={cx(
            s.fadeUp,
            "group/pill inline-flex h-[30px] max-w-full items-center gap-2 rounded-full border border-line-strong bg-fg/[0.025] pl-3.5 pr-3 text-[13px] text-fg-2 transition-colors duration-150 hover:border-fg/20 hover:bg-fg/[0.05] hover:text-fg",
          )}
        >
          {/* Describes the fork, not the page: no status dot, since the page is a snapshot and never claims to be live. */}
          <span className="truncate">
            <span className="text-fg">Glamsterdam on Sepolia</span>
            <span className="max-[359px]:hidden">
              <span className="text-fg-3"> · </span>
              ePBS and <span className="hidden sm:inline">block </span>access lists
            </span>
          </span>
          <ArrowRight className="hidden shrink-0 opacity-50 transition-transform duration-150 ease-out group-hover/pill:translate-x-0.5 sm:block" />
        </a>

        <h1 id="hero-title" className="mt-7 text-[clamp(2.625rem,1rem+5.6vw,5.5rem)] font-semibold leading-[0.98] tracking-[-0.05em] md:mt-8">
          {LINES.map((line, i) => (
            <span key={i} className={cx(s.line, i === 1 && "text-fg-4")}>
              {line.map((word, j) => (
                <span key={word}>
                  <span className={s.word} style={delay(0.06 + w++ * 0.055)}>
                    {word}
                  </span>
                  {j < line.length - 1 && " "}
                </span>
              ))}
            </span>
          ))}
        </h1>

        <div className="mt-7 flex flex-col gap-8 md:mt-10 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          <p className={cx(s.fadeUp, "max-w-[35rem] text-lead text-fg-2")} style={delay(0.24)}>
            Rooted checks <b>ePBS payloads</b> and <b>block access lists</b> against your own node, replays every transaction on{" "}
            <b>native Geth</b>, and its <b>Analyst</b> explains what it found.
          </p>
          {/* Phones: both full width, stacked; side by side from sm. */}
          <div className={cx(s.fadeUp, "flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center")} style={delay(0.3)}>
            <Button href={cta.href} size="lg" arrow={cta.arrow}>
              {cta.label}
            </Button>
            {/* The path the README builds to: a bare `rooted` is not on PATH, so copying it would fail. */}
            <Command value=".tools/rooted serve" />
          </div>
        </div>

        <div className="mt-14 md:mt-16">
          <AppTour />
        </div>
      </Container>
    </section>
  );
}
