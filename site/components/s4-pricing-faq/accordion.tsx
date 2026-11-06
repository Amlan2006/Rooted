"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { m, useReducedMotion } from "motion/react";
import { cx } from "@/lib/cx";

type Item = { q: string; a: ReactNode };

const ease = [0.22, 1, 0.36, 1] as const;

/**
 * WAI-ARIA accordion: heading > button[aria-expanded] controlling a labelled region. Up/Down/Home/End move between
 * headers. The server HTML has every answer open, so all of them read without JavaScript; after hydration all but
 * `defaultOpen` close at once (no animation, the section is below the fold). Closed panels stay in the DOM, inert, at
 * height 0.
 */
export function Accordion({ items, defaultOpen = 0 }: { items: Item[]; defaultOpen?: number }) {
  // null: not hydrated yet, everything open.
  const [open, setOpen] = useState<Set<number> | null>(null);
  const [touched, setTouched] = useState(false);
  const reduce = useReducedMotion();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(new Set([defaultOpen])), [defaultOpen]);

  const toggle = (i: number) => {
    setTouched(true);
    setOpen((prev) => {
      const next = new Set(prev ?? items.keys());
      if (!next.delete(i)) next.add(i);
      return next;
    });
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const triggers = [...(root.current?.querySelectorAll<HTMLButtonElement>("[data-trigger]") ?? [])];
    const at = triggers.indexOf(e.currentTarget);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: triggers.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    triggers[(to + triggers.length) % triggers.length]?.focus();
  };

  return (
    <div ref={root} className="border-t">
      {items.map((item, i) => {
        const isOpen = open ? open.has(i) : true;
        return (
          <div key={item.q} className="border-b">
            <h3>
              <button
                type="button"
                data-trigger=""
                id={`${id}-t${i}`}
                aria-expanded={isOpen}
                aria-controls={`${id}-p${i}`}
                onClick={() => toggle(i)}
                onKeyDown={onKey}
                // -mx/px: the focus ring gets 10 px of air around the question while the text stays on the hairlines' edge.
                className="group -mx-2.5 flex w-[calc(100%+20px)] items-start justify-between gap-6 rounded-control px-2.5 py-5 text-left text-[17px] font-medium leading-7 tracking-[-0.015em] text-fg md:py-6"
              >
                <span>{item.q}</span>
                {/* Plus to minus: the vertical stroke turns 90° onto the horizontal one. */}
                <span
                  aria-hidden="true"
                  className={cx(
                    "grid size-7 shrink-0 place-items-center rounded-control border transition-[border-color,background-color,color] duration-150 ease-out",
                    "group-hover:border-fg/20 group-hover:bg-fg/[0.04] group-hover:text-fg group-focus-visible:text-fg",
                    isOpen ? "border-line-strong text-fg" : "border-line text-fg-3",
                  )}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M1.75 6h8.5" />
                    <path d="M6 1.75v8.5" className={cx("origin-center transition-transform duration-[250ms] ease-out [transform-box:fill-box]", isOpen && "rotate-90")} />
                  </svg>
                </span>
              </button>
            </h3>
            <m.div
              id={`${id}-p${i}`}
              role="region"
              aria-labelledby={`${id}-t${i}`}
              inert={!isOpen}
              className="overflow-hidden"
              initial={false}
              animate={isOpen ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
              transition={reduce || !touched ? { duration: 0 } : { height: { duration: 0.3, ease }, opacity: { duration: isOpen ? 0.25 : 0.15, ease } }}
            >
              <div className="max-w-[64ch] pb-7 text-[15px] leading-[1.65] text-fg-2 md:pr-12">{item.a}</div>
            </m.div>
          </div>
        );
      })}
    </div>
  );
}
