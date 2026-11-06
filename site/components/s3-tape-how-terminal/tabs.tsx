"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { m } from "motion/react";
import { cx } from "@/lib/cx";

export type TabSpec = { id: string; label: string; panel: ReactNode };

/**
 * WAI-ARIA tabs with automatic activation: arrows move and select, Home/End jump. Panels are server-rendered; only
 * the active one is displayed, at its own height, and a switch eases the area from the old height to the new one.
 */
export function Tabs({ label, tabs }: { label: string; tabs: TabSpec[] }) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const fromHeight = useRef<number | null>(null);

  const select = (i: number) => {
    if (i === active) return;
    fromHeight.current = area.current?.offsetHeight ?? null;
    setActive(i);
  };

  // Same curve and length as the accordion; clipped only while it runs, so focus rings inside are never cut off.
  useLayoutEffect(() => {
    const el = area.current, from = fromHeight.current;
    fromHeight.current = null;
    if (!el || from === null || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = el.offsetHeight;
    if (to !== from)
      el.animate([{ height: `${from}px`, overflow: "hidden" }, { height: `${to}px`, overflow: "hidden" }], { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [active]);

  const onKeyDown = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    const next = ({ ArrowRight: active === last ? 0 : active + 1, ArrowLeft: active === 0 ? last : active - 1, Home: 0, End: last } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(next);
    buttons.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-7 border-b">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={i === active}
            aria-controls={`panel-${tab.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => select(i)}
            className={cx(
              "group relative -mb-px h-11 rounded-[4px] text-sm transition-colors duration-150 focus-visible:outline-ink",
              i === active ? "text-ink" : "text-muted hover:text-ink focus-visible:text-ink",
            )}
          >
            {tab.label}
            {/* Roving tabindex: the focused tab is always the active one, so focus also thickens its underline. */}
            {i === active && <m.span layoutId="use-tab-underline" className="absolute inset-x-0 bottom-0 h-px bg-ink group-focus-visible:h-0.5" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} />}
          </button>
        ))}
      </div>
      <div ref={area} className="mt-8 md:mt-10">
        {tabs.map((tab, i) => (
          <div key={tab.id} role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} hidden={i !== active}>
            {tab.panel}
          </div>
        ))}
      </div>
    </div>
  );
}
