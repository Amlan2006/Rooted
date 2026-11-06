"use client";

import { useDeferredValue, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import { LogoMark } from "@/components/ui/logo";
import { Window } from "@/components/ui/window";
import { Indicator, useIndicator } from "@/components/ui/indicator";
import { cx } from "@/lib/cx";
import { capturedOn, num } from "@/lib/format";
import { AccessLists } from "./access-lists";
import { Analyst } from "./analyst";
import { IconBrief, IconBuilders, IconChevrons, IconCompare, IconFrames, IconList, IconNode, IconPause, IconPlay, IconPulse, IconStopwatch, IconXray } from "./icons";
import { PayloadWatch } from "./payload-watch";
import type { TourData } from "./types";
import { Xray } from "./xray";
import s from "./anim.module.css";

const ease = [0.22, 1, 0.36, 1] as const;
const utc = (iso: string) => `${capturedOn(iso)} ${iso.slice(11, 16)} UTC`;

/** `via` names the endpoints (dropped on phones), `text` what the view shows: never truncated, so a figure is never cut. */
type Tab = { label: string; group: string; icon: (p: { className?: string }) => ReactNode; source: (d: TourData) => { via: string; text: string; at: string } };

const TABS: Tab[] = [
  { label: "PayloadWatch", group: "Monitor", icon: IconPulse, source: (d) => ({ via: "Nimbus events + Geth blocks", text: `slot ${num(d.epbs.slot)}, received at our node`, at: d.epbs.captured }) },
  { label: "Block X-ray", group: "Monitor", icon: IconXray, source: (d) => ({ via: "Geth eth_getBlockReceipts", text: `Sepolia block ${num(d.xray.number)}`, at: d.xray.captured }) },
  { label: "Access lists", group: "Monitor", icon: IconList, source: (d) => ({ via: "Nimbus execution_payload_envelopes", text: `Sepolia block ${num(d.xray.number)}`, at: d.bal.captured }) },
  { label: "Analyst", group: "Investigate", icon: IconBrief, source: (d) => ({ via: "GET /api/analyst/briefs", text: "briefs + Hedera testnet mirror node", at: d.analyst.captured }) },
];

/** Sidebar entries that are not part of the tour: shown for the shape of the product, not clickable. */
const OTHER: Record<string, { label: string; icon: Tab["icon"] }[]> = {
  Monitor: [
    { label: "Frame mempool", icon: IconFrames },
    { label: "Builders", icon: IconBuilders },
  ],
  Investigate: [
    { label: "Execution profiler", icon: IconStopwatch },
    { label: "Provider diff", icon: IconCompare },
  ],
};

/**
 * The hero's product tour: a segmented control (WAI-ARIA tabs, arrow keys, automatic activation) over a miniature of
 * the dashboard. It advances every 7 s with a progress line on the active tab, pauses while hovered, keyboard-focused,
 * off screen or in a background tab, and never auto-plays under reduced motion. Any choice the reader makes (a tab, a
 * click or tap inside the view, the pause button) stops it until they press play (APG carousel).
 */
export function Tour({ data }: { data: TourData }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [dir, setDir] = useState(1);
  const [auto, setAuto] = useState(false); // false until mounted, and always under reduced motion
  const [stopped, setStopped] = useState(false);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setAuto(!mq.matches);
    onMotion();
    mq.addEventListener("change", onMotion);
    let onScreen = true;
    const update = () => setVisible(onScreen && !document.hidden);
    const io = new IntersectionObserver(([e]) => ((onScreen = e.isIntersecting), update()), { threshold: 0.15 });
    if (root.current) io.observe(root.current);
    document.addEventListener("visibilitychange", update);
    return () => {
      mq.removeEventListener("change", onMotion);
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  // Keep the active tab in view when the control scrolls sideways (phones). Scrolls the strip only, never the page.
  const moved = useRef(false);
  useEffect(() => {
    // Not on mount (the first tab is already at the start): no layout read during hydration.
    if (!moved.current) return void (moved.current = true);
    const strip = list.current;
    const tab = tabs.current[active];
    if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return;
    const left = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
    strip.scrollTo({ left, behavior: auto ? "smooth" : "auto" });
  }, [active, auto]);

  const pill = useIndicator(tabs, active);
  const playing = auto && !stopped && visible;
  const running = playing && !hover && !focused;
  const select = (i: number, focus = false) => {
    setDir(i >= active ? 1 : -1);
    setActive(i);
    if (focus) tabs.current[i]?.focus();
  };
  // A reader's pick: autoplay must not take the view away from them mid-read.
  const pick = (i: number, focus = false) => {
    setStopped(true);
    select(i, focus);
  };
  // The tab state paints first; the dense view (hundreds of bars) renders in a follow-up, interruptible pass.
  const view = useDeferredValue(active);

  const onKey = (e: KeyboardEvent) => {
    const last = TABS.length - 1;
    const next = { ArrowRight: active === last ? 0 : active + 1, ArrowLeft: active === 0 ? last : active - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    pick(next, true);
  };

  const tab = TABS[active];
  const source = TABS[view].source(data);

  return (
    <div
      ref={root}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={(e) => e.target.matches(":focus-visible") && setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(false)}
    >
      <div className={s.fadeUp} style={{ animationDelay: "0.38s" }}>
        {/* Phones: the strip runs to the screen edges and scrolls sideways. */}
        <div
          ref={list}
          role="tablist"
          aria-label="Product tour"
          onKeyDown={onKey}
          className="-mx-5 flex overflow-x-auto px-5 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          <div className="relative flex shrink-0 gap-0.5 rounded-[11px] border border-line-strong bg-surface-1 p-[3px] shadow-raised">
            <Indicator box={pill} className="rounded-[8px] border border-line-strong bg-fg/[0.07] shadow-raised" />
            {TABS.map((t, i) => {
              const on = i === active;
              const Icon = t.icon;
              return (
                <button
                  key={t.label}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${i}`}
                  aria-selected={on}
                  aria-controls={`${id}-panel`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => pick(i)}
                  className={cx(
                    "relative flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-[8px] px-3 text-[13px] font-medium tracking-[-0.01em] transition-colors duration-150",
                    on ? "text-fg" : "text-fg-3 hover:text-fg-2",
                  )}
                >
                  {/* Before the sliding pill has measured (server HTML), the active tab draws its own. */}
                  {on && !pill && <span className="absolute inset-0 rounded-[8px] border border-line-strong bg-fg/[0.07] shadow-raised" />}
                  {on && playing && (
                    <span aria-hidden="true" className="absolute inset-x-2.5 bottom-[3px] h-px overflow-hidden rounded-full bg-fg/[0.08]">
                      <span
                        key={active}
                        onAnimationEnd={() => select((active + 1) % TABS.length)}
                        className={cx(s.progress, "absolute inset-0 bg-fg/55")}
                        style={{ animationPlayState: running ? "running" : "paused" }}
                      />
                    </span>
                  )}
                  <Icon className={cx("relative transition-opacity duration-150", on ? "opacity-90" : "opacity-60")} />
                  <span className="relative">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={cx(s.windowIn, "mt-4")}>
        <Window shadow bodyClassName="grid lg:grid-cols-[212px_minmax(0,1fr)]">
          <Sidebar active={active} onSelect={pick} />
          <div className="flex h-[540px] min-w-0 flex-col md:h-[600px]">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4 text-[13px] md:px-5">
              <LogoMark className="mr-1 lg:hidden" />
              <span className="hidden text-fg-3 sm:inline">{tab.group}</span>
              <span aria-hidden="true" className="hidden text-fg-4 sm:inline">
                /
              </span>
              <span className="truncate font-medium text-fg">{tab.label}</span>
              <div className="ml-auto flex shrink-0 items-center gap-2.5 font-mono text-[11.5px] text-fg-3">
                {/* The only motion control. No status dot: a dot beside a snapshot reads as "live". */}
                {auto && (
                  <button
                    type="button"
                    onClick={() => setStopped((v) => !v)}
                    aria-label={stopped ? "Play the tour" : "Pause the tour"}
                    className="-mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors duration-150 hover:bg-fg/[0.05] hover:text-fg-2"
                  >
                    {stopped ? <IconPlay className="size-2.5 opacity-80" /> : <IconPause className="size-2.5 opacity-80" />}
                    {stopped ? "play" : "pause"}
                  </button>
                )}
                {auto && <span aria-hidden="true" className="h-3.5 w-px bg-line-strong" />}
                <span>
                  snapshot<span className="hidden md:inline"> · captured {capturedOn(data.captured)}</span>
                </span>
              </div>
            </div>

            <div
              role="tabpanel"
              id={`${id}-panel`}
              aria-labelledby={`${id}-tab-${active}`}
              // A tab stop only for PayloadWatch, the one view with nothing focusable inside (APG tabs).
              tabIndex={view === 0 ? 0 : undefined}
              onClickCapture={() => setStopped(true)}
              className="@container relative min-h-0 flex-1 overflow-hidden rounded-b-none focus-visible:outline-offset-[-2px]"
            >
              <AnimatePresence initial={false} custom={dir}>
                <m.div
                  key={view}
                  custom={dir}
                  className="absolute inset-0"
                  // The old view leaves quickly before the new one settles in, so two dense panes never sit on top of each other.
                  variants={{
                    enter: (d: number) => ({ opacity: 0, x: 16 * d }),
                    center: { opacity: 1, x: 0, transition: { duration: 0.38, ease, delay: 0.09 } },
                    exit: (d: number) => ({ opacity: 0, x: -8 * d, transition: { duration: 0.14, ease: "easeIn" } }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  {view === 0 && <PayloadWatch epbs={data.epbs} blocks={data.blocks} />}
                  {view === 1 && <Xray x={data.xray} />}
                  {view === 2 && <AccessLists b={data.bal} gas={data.xray.gas} number={data.xray.number} />}
                  {view === 3 && <Analyst briefs={data.analyst.briefs} />}
                </m.div>
              </AnimatePresence>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 border-t px-4 py-2 font-mono text-[11px] leading-4 text-fg-3 md:px-5">
              <span>
                <span className="hidden sm:inline">{source.via} · </span>
                {source.text}
              </span>
              <span className="ml-auto whitespace-nowrap">captured {utc(source.at)}</span>
            </div>
          </div>
        </Window>
      </div>
    </div>
  );
}

/** Decorative copy of the dashboard's sidebar (hidden from assistive tech: the tabs above are the real control). */
function Sidebar({ active, onSelect }: { active: number; onSelect: (i: number) => void }) {
  const groups = ["Monitor", "Investigate"];
  const rows = useRef<(HTMLElement | null)[]>([]);
  const pill = useIndicator(rows, active);
  return (
    <aside aria-hidden="true" className="relative hidden min-w-0 flex-col border-r bg-bg/30 px-2.5 pb-3 pt-2.5 text-[13px] lg:flex">
      <Indicator box={pill} className="rounded-md bg-fg/[0.06] shadow-raised" />
      <div className="flex h-10 items-center gap-2.5 rounded-md px-2">
        <LogoMark />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium leading-4 tracking-[-0.01em] text-fg">Rooted</span>
          <span className="block font-mono text-[10.5px] leading-4 text-fg-3">Sepolia · 11155111</span>
        </span>
        <IconChevrons className="text-fg-3" />
      </div>
      {groups.map((g) => (
        <div key={g} className="mt-4">
          <div className="px-2 pb-1 text-[11.5px] font-medium leading-5 text-fg-3">{g}</div>
          {TABS.map((t, i) =>
            t.group !== g ? null : (
              <div
                key={t.label}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                onClick={() => onSelect(i)}
                className={cx(
                  "relative flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 transition-colors duration-150",
                  i === active ? "text-fg" : "text-fg-2 hover:bg-fg/[0.03] hover:text-fg",
                )}
              >
                {i === active && !pill && <span className="absolute inset-0 rounded-md bg-fg/[0.06] shadow-raised" />}
                <t.icon className={cx("relative", i === active ? "opacity-90" : "opacity-60")} />
                <span className="relative truncate">{t.label}</span>
              </div>
            ),
          )}
          {OTHER[g].map((o) => (
            <div key={o.label} className="flex h-8 items-center gap-2.5 px-2 text-fg-3">
              <o.icon className="opacity-50" />
              <span className="truncate">{o.label}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="mt-auto flex items-center gap-2.5 border-t px-2 pt-3">
        <IconNode className="text-fg-3" />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] leading-4 text-fg-2">Sepolia testnet</span>
          <span className="block truncate text-[11px] leading-4 text-fg-3">Execution + consensus</span>
        </span>
      </div>
    </aside>
  );
}
