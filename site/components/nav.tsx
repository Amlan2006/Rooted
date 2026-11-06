"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { cx } from "@/lib/cx";
import { Button } from "./ui/button";
import { Container } from "./ui/container";
import { ArrowUpRight } from "./ui/icons";
import { LogoMark } from "./ui/logo";

// URLs come in as props: importing lib/data here would ship every data/*.json file to the browser.
type Links = { github: string; docs: string; dashboard: string | null };

const ease = [0.22, 1, 0.36, 1] as const;

const Wordmark = ({ onClick }: { onClick?: () => void }) => (
  <a
    href="#main"
    onClick={onClick}
    aria-label="Rooted, back to top"
    className="-mx-1.5 flex h-8 items-center gap-2.5 rounded-control px-1.5 text-[15px] font-semibold tracking-[-0.02em] text-fg transition-opacity duration-150 hover:opacity-80"
  >
    <LogoMark />
    Rooted
  </a>
);

export function Nav({ links }: { links: Links }) {
  const items = [
    { label: "Product", href: "#product" },
    { label: "Analyst", href: "#analyst" },
    { label: "Hosted API", href: "#pricing" },
    { label: "Docs", href: links.docs, external: true },
  ];
  // Only a deploy that names a dashboard (NEXT_PUBLIC_DASHBOARD_URL) promises an app. Without one, the white button
  // goes to the page's own start panel (clone command, docs, quick start), so it is not a second GitHub link.
  const cta = links.dashboard ? { href: links.dashboard, label: "Open dashboard" } : { href: "#start", label: "Get started" };
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
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

  // The sheet is a sibling of <header>, not a child: once scrolled the header has a backdrop-filter, which would make it
  // the containing block of the fixed sheet and shrink the menu to the 64 px bar.
  return (
    <>
    <header
      className={cx(
        "sticky top-0 z-40 border-b transition-[background-color,border-color,backdrop-filter] duration-200 ease-out",
        scrolled ? "border-line bg-bg/72 backdrop-blur-md" : "border-transparent",
      )}
    >
      <Container className="flex h-16 items-center gap-10">
        <Wordmark />
        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {items.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  className="group/link inline-flex h-8 items-center gap-1 rounded-control px-2.5 text-sm text-fg-2 transition-colors duration-150 hover:bg-fg/[0.04] hover:text-fg focus-visible:text-fg"
                >
                  {item.label}
                  {item.external && <ArrowUpRight className="opacity-50 transition-[translate,opacity] duration-150 group-hover/link:-translate-y-px group-hover/link:translate-x-px group-hover/link:opacity-90" />}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {/* Wrapped: cx does not merge, so `hidden` on a Button would lose to its own inline-flex. */}
        <div className="ml-auto hidden items-center gap-2.5 md:flex">
          <Button href={links.github} variant="ghost" size="sm">
            GitHub
          </Button>
          <Button href={cta.href} size="sm">
            {cta.label}
          </Button>
        </div>
        <button
          ref={menuButton}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Open menu"
          className="-mr-2 ml-auto grid size-10 place-items-center rounded-control text-fg-2 transition-colors duration-150 hover:bg-fg/[0.06] hover:text-fg md:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M3 6.5h12M3 11.5h12" />
          </svg>
        </button>
      </Container>
    </header>

      <AnimatePresence>
        {open && (
          <m.div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease }}
          >
            <Container className="flex h-16 shrink-0 items-center justify-between border-b border-line">
              <Wordmark onClick={follow} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="-mr-2 grid size-10 place-items-center rounded-control text-fg-2 transition-colors duration-150 hover:bg-fg/[0.06] hover:text-fg"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
                </svg>
              </button>
            </Container>
            <Container className="flex flex-1 flex-col pb-8">
              <nav aria-label="Primary">
                <m.ul initial="hidden" animate="shown" variants={{ shown: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } } }}>
                  {items.map((item) => (
                    <m.li key={item.label} className="border-b border-line" variants={{ hidden: { opacity: 0, y: -6 }, shown: { opacity: 1, y: 0, transition: { duration: 0.25, ease } } }}>
                      <a
                        href={item.href}
                        onClick={follow}
                        className="flex items-center justify-between py-4 text-2xl font-semibold tracking-[-0.03em] text-fg transition-colors duration-150 hover:text-fg-2"
                      >
                        {item.label}
                        {item.external && <ArrowUpRight className="size-4 text-fg-3" />}
                      </a>
                    </m.li>
                  ))}
                </m.ul>
              </nav>
              <div className="mt-auto grid gap-3 pt-10">
                <Button href={cta.href} size="lg" onClick={follow} className="w-full">
                  {cta.label}
                </Button>
                <Button href={links.github} variant="ghost" size="lg" onClick={follow} className="w-full">
                  GitHub
                </Button>
              </div>
            </Container>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}
