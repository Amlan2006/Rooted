"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { cx } from "@/lib/cx";
import { Button } from "./ui/button";
import { Container } from "./ui/container";
import { ArrowUpRight } from "./ui/icons";

// URLs come in as props: importing lib/data here would ship every data/*.json file to the browser.
type Links = { github: string; docs: string; dashboard: string | null };

const Wordmark = ({ onClick }: { onClick?: () => void }) => (
  <a href="#" onClick={onClick} aria-label="Rooted, back to top" className="-mx-1 rounded-[4px] px-1 font-mono text-[15px] font-medium tracking-[-0.01em] transition-colors duration-150 hover:text-muted focus-visible:text-muted">
    rooted
  </a>
);

export function Nav({ links }: { links: Links }) {
  const items = [
    { label: "Product", href: "#product" },
    { label: "How it works", href: "#how-it-works" },
    { label: "Pricing", href: "#pricing" },
    { label: "Docs", href: links.docs, external: true },
    ...(links.dashboard ? [{ label: "GitHub", href: links.github, external: true }] : []),
  ];
  // One primary action per page: the hero's ink Self-host. The nav only goes ink when there is a real app to open.
  const cta = links.dashboard
    ? { href: links.dashboard, label: "Open dashboard", variant: "ink" as const }
    : { href: links.github, label: "GitHub", variant: "outline" as const };
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Sheet: focus the first item, trap Tab, close on Esc or when the viewport grows past md, lock page scroll.
  useEffect(() => {
    if (!open) return;
    const focusables = () => [...(sheet.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])];
    sheet.current?.querySelector<HTMLElement>("nav a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setOpen(false);
      if (e.key !== "Tab") return;
      const all = focusables();
      const first = all[0], last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    };
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => wide.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      document.documentElement.style.overflow = "";
      if (restoreFocus.current) menuButton.current?.focus({ preventScroll: true });
      restoreFocus.current = true;
    };
  }, [open]);

  // Following a link moves the reader on; only Esc / Close return focus to the Menu button.
  const follow = () => {
    restoreFocus.current = false;
    setOpen(false);
  };

  return (
    <header className={cx("sticky top-0 z-40 bg-paper transition-shadow duration-150", scrolled && "shadow-nav")}>
      <Container className="flex h-14 items-center justify-between gap-6">
        <div className="flex items-center gap-10">
          <Wordmark />
          <nav aria-label="Primary" className="hidden md:block">
            <ul className="flex items-center gap-7 text-sm">
              {items.map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="inline-flex items-center gap-1 text-muted transition-colors duration-150 hover:text-ink focus-visible:text-ink">
                    {item.label}
                    {item.external && <ArrowUpRight className="opacity-60" />}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        {/* Wrapped: cx does not merge, so `hidden` on the Button would lose to its own inline-flex. */}
        <div className="hidden md:block">
          <Button href={cta.href} variant={cta.variant} size="sm">
            {cta.label} <ArrowUpRight />
          </Button>
        </div>
        <button
          ref={menuButton}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="-mr-2 h-10 rounded-button px-2 font-mono text-label uppercase transition-colors duration-150 hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-ink md:hidden"
        >
          Menu
        </button>
      </Container>

      <AnimatePresence>
        {open && (
          <m.div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-paper md:hidden"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <Container className="flex h-14 shrink-0 items-center justify-between border-b">
              <Wordmark onClick={follow} />
              <button type="button" onClick={() => setOpen(false)} className="-mr-2 h-10 rounded-button px-2 font-mono text-label uppercase transition-colors duration-150 hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-ink">
                Close
              </button>
            </Container>
            <Container className="flex flex-1 flex-col pb-8">
              <nav aria-label="Primary">
                <ul>
                  {items.map((item) => (
                    <li key={item.label} className="border-b">
                      <a href={item.href} onClick={follow} className="flex items-center justify-between py-4 font-serif text-[2rem] leading-10 transition-colors duration-150 hover:text-muted focus-visible:text-muted">
                        {item.label}
                        {item.external && <ArrowUpRight className="size-4 text-muted" />}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              <Button href={cta.href} variant={cta.variant} onClick={follow} className="mt-auto w-full">
                {cta.label} <ArrowUpRight />
              </Button>
            </Container>
          </m.div>
        )}
      </AnimatePresence>
    </header>
  );
}
