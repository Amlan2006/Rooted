"use client";

import { useEffect } from "react";

/**
 * Sections start as content-visibility:auto, so the first render skips everything below the fold. Left that way, a
 * jump past never-rendered sections lands on placeholder heights and the page shifts when the reader scrolls back.
 * So they are rendered for real and stay rendered, but only once the reader acts (scroll, key, pointer): the work
 * then lands after load, not in it. In-page links render whatever is left before the browser jumps, and a deep link
 * (/#pricing) renders everything up front and lands on the target for real.
 */
export function RenderAhead() {
  useEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>("[data-defer]")];
    const show = (s: HTMLElement) => (s.style.contentVisibility = "visible");
    const target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (target) {
      sections.forEach(show);
      target.scrollIntoView({ behavior: "instant" });
    }
    document.documentElement.dataset.smooth = "";
    if (target) return;

    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 50));
    const events = ["scroll", "wheel", "keydown", "pointerdown", "touchstart"] as const;
    let i = 0;
    let started = false;
    let stopped = false;
    // One section per idle period: small tasks, not one long one.
    const next = () => {
      const s = sections[i++];
      if (!s || stopped) return;
      show(s);
      idle(next, { timeout: 1000 });
    };
    const start = () => {
      if (started) return;
      started = true;
      events.forEach((e) => removeEventListener(e, start));
      idle(next, { timeout: 1000 });
    };
    // Capture phase, before the browser follows the link: the jump must measure real heights.
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('a[href^="#"]')) sections.forEach(show);
    };
    events.forEach((e) => addEventListener(e, start, { passive: true, once: true }));
    document.addEventListener("click", onClick, true);
    return () => {
      stopped = true;
      events.forEach((e) => removeEventListener(e, start));
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
