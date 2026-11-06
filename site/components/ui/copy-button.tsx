"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { cx } from "@/lib/cx";

/** Icon button that copies `value`; the glyph swaps to a check for 1.6 s and a live region announces it. fg-3, fg on hover. */
export function CopyButton({ value, label = "Copy to clipboard", className }: { value: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value); // throws when the page is not a secure context
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className={cx(
          "relative inline-grid size-8 shrink-0 place-items-center rounded-control text-fg-3 transition-[color,background-color,scale] duration-150 ease-out",
          "hover:bg-fg/[0.06] hover:text-fg focus-visible:text-fg active:scale-95",
          className,
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <m.svg
            key={state === "copied" ? "check" : "copy"}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.15 }}
          >
            {state === "copied" ? (
              <path d="M3 8.5l3 3 7-7" stroke="var(--acc)" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <>
                <rect x="5.25" y="5.25" width="8" height="8" rx="1.5" />
                <path d="M10.75 5.25V3.75a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1.5" />
              </>
            )}
          </m.svg>
        </AnimatePresence>
      </button>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : ""}
      </span>
    </>
  );
}
