"use client";

import { useEffect } from "react";

/**
 * Sections start as content-visibility:auto, so the first render skips everything below the fold. Left that way, a
 * jump past never-rendered sections lands on placeholder heights and the page shifts by up to a viewport when the
 * reader scrolls back. So after hydration they are rendered for real, one per idle period (small tasks, not one
 * long one), and stay rendered: from then on every jump and scroll uses real heights. Handing them back to `auto`
 * was tried; Chrome then reports a re-rendered section's contents as a layout shift.
 */
export function RenderAhead() {
  useEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>("[data-defer]")];
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 50));
    let i = 0;
    let stopped = false;
    const next = () => {
      const s = sections[i++];
      if (!s || stopped) return;
      s.style.contentVisibility = "visible";
      idle(next, { timeout: 1000 });
    };
    idle(next, { timeout: 1000 });
    return () => {
      stopped = true;
    };
  }, []);
  return null;
}
