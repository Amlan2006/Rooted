"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { m, useReducedMotion } from "motion/react";

type Item = { q: string; a: ReactNode };

/**
 * WAI-ARIA accordion: heading > button[aria-expanded] controlling a labelled region. Up/Down/Home/End move between
 * headers. Closed panels stay in the DOM (searchable, indexable) but inert, at height 0.
 */
export function Accordion({ items, defaultOpen = 0 }: { items: Item[]; defaultOpen?: number }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set([defaultOpen]));
  const reduce = useReducedMotion();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const triggers = [...(root.current?.querySelectorAll<HTMLButtonElement>("[data-trigger]") ?? [])];
    const at = triggers.indexOf(e.currentTarget);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: triggers.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    triggers[(to + triggers.length) % triggers.length]?.focus();
  };

  return (
    <div ref={root} className="border-y divide-y">
      {items.map((item, i) => {
        const isOpen = open.has(i);
        return (
          <div key={item.q}>
            <h4>
              <button
                type="button"
                data-trigger=""
                id={`${id}-t${i}`}
                aria-expanded={isOpen}
                aria-controls={`${id}-p${i}`}
                onClick={() => toggle(i)}
                onKeyDown={onKey}
                // Hover and focus stay inside the hairlines: an ink underline on the question (focus is never the ring alone).
                className="group flex w-full items-start justify-between gap-6 py-5 text-left text-lead font-medium"
              >
                <span className="underline decoration-transparent decoration-1 underline-offset-4 transition-[text-decoration-color] duration-150 group-hover:decoration-ink/30 group-focus-visible:decoration-ink">
                  {item.q}
                </span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true" className="mt-2 shrink-0 text-muted transition-colors duration-150 group-hover:text-ink group-focus-visible:text-ink">
                  <path d="M1 6h10" />
                  <path d="M6 1v10" className={`origin-center transition-transform duration-200 ease-out ${isOpen ? "scale-y-0" : ""}`} />
                </svg>
              </button>
            </h4>
            <m.div
              id={`${id}-p${i}`}
              role="region"
              aria-labelledby={`${id}-t${i}`}
              inert={!isOpen}
              className="overflow-hidden"
              initial={false}
              animate={isOpen ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="max-w-[62ch] pb-6 pr-8 text-muted">{item.a}</div>
            </m.div>
          </div>
        );
      })}
    </div>
  );
}
