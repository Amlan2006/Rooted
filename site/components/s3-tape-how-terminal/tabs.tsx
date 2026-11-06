"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Indicator, useIndicator } from "@/components/ui/indicator";
import { Window } from "@/components/ui/window";
import { CopyButton } from "@/components/ui/copy-button";
import { cx } from "@/lib/cx";

export type TabSpec = { id: string; label: string; meta: string; copy: string; copyLabel: string; panel: ReactNode };

const ease = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * A terminal window whose title bar is a WAI-ARIA tablist with automatic activation: arrows move and select,
 * Home/End jump. Panels are server-rendered; only the active one is displayed. A switch eases the body from the old
 * height to the new one and brings the new lines in top to bottom. The copy button copies the active tab.
 */
export function TerminalTabs({ label, tabs }: { label: string; tabs: TabSpec[] }) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const fromHeight = useRef<number | null>(null);
  const pill = useIndicator(buttons, active);

  const select = (i: number) => {
    if (i === active) return;
    fromHeight.current = area.current?.offsetHeight ?? null;
    setActive(i);
  };

  // Clipped only while it runs, so focus rings inside are never cut off.
  useLayoutEffect(() => {
    const el = area.current,
      from = fromHeight.current;
    fromHeight.current = null;
    if (!el || from === null || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = el.offsetHeight;
    if (to !== from) el.animate([{ height: `${from}px`, overflow: "hidden" }, { height: `${to}px`, overflow: "hidden" }], { duration: 300, easing: ease });
    el.querySelectorAll(`#panel-${tabs[active].id} [data-line], #panel-${tabs[active].id} [data-note]`).forEach((line, i) =>
      line.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: Math.min(i, 24) * 14, easing: ease, fill: "backwards" }),
    );
  }, [active, tabs]);

  const onKeyDown = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    const next = ({ ArrowRight: active === last ? 0 : active + 1, ArrowLeft: active === 0 ? last : active - 1, Home: 0, End: last } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(next);
    buttons.current[next]?.focus();
  };

  const tab = tabs[active];
  return (
    <Window>
      <div className="flex h-11 items-center gap-3 border-b pl-1.5 pr-1.5">
        <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="relative flex items-center gap-1">
          <Indicator box={pill} className="rounded-control border border-line-strong bg-fg/[0.06] shadow-raised" />
          {tabs.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={i === active}
              aria-controls={`panel-${t.id}`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => select(i)}
              className={cx(
                "relative h-8 rounded-control px-3 text-[13px] font-medium transition-colors focus-visible:outline-offset-0",
                i === active ? "text-fg" : "text-fg-3 hover:bg-fg/[0.03] hover:text-fg-2",
              )}
            >
              {i === active && !pill && <span aria-hidden="true" className="absolute inset-0 rounded-control border border-line-strong bg-fg/[0.06] shadow-raised" />}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
        <span className="ml-auto hidden min-w-0 truncate font-mono text-xs text-fg-3 sm:block">{tab.meta}</span>
        <CopyButton value={tab.copy} label={tab.copyLabel} className="ml-auto sm:ml-0" />
      </div>
      <div ref={area}>
        {tabs.map((t, i) => (
          <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={i !== active}>
            {t.panel}
          </div>
        ))}
      </div>
    </Window>
  );
}
