"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { cx } from "@/lib/cx";
import s from "./marquee.module.css";

/**
 * Endless horizontal tape. Hover, focus (tap on touch) or the Pause button stops it; under reduced motion, and before
 * JS, it is a still, keyboard-scrollable row. The second copy only exists to close the loop: it is cloned in the DOM
 * after hydration (React never sees it, so it costs no hydration work), inert and hidden from AT.
 */
export function Marquee({ label, seconds, aside, className, children }: { label: string; seconds: number; aside: ReactNode; className?: string; children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const [loop, setLoop] = useState(false);
  const track = useRef<HTMLDivElement>(null);

  // The copy is built when the tape comes within a viewport of the screen, not during load: it is a few hundred
  // elements of style and layout work that nobody can see yet. A viewport early, so the switch is never on screen.
  useEffect(() => {
    const el = track.current;
    if (!el?.firstElementChild || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let copy: HTMLElement | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || copy) return;
        io.disconnect();
        copy = el.firstElementChild!.cloneNode(true) as HTMLElement;
        copy.inert = true;
        copy.setAttribute("aria-hidden", "true");
        el.append(copy);
        setLoop(true);
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      copy?.remove();
    };
  }, []);

  return (
    <div className={className}>
      <div role="region" aria-label={label} tabIndex={0} className={cx(s.viewport, "outline-offset-[-2px]", loop && s.loop, paused && s.paused)}>
        <div ref={track} className={s.track} style={{ "--tape-duration": `${seconds}s` } as CSSProperties}>
          {children}
        </div>
      </div>
      <Container className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        {aside}
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          aria-label={paused ? "Play the block tape" : "Pause the block tape"}
          className={cx(
            "-my-1 inline-flex h-7 shrink-0 items-center gap-2 rounded-control border border-line-strong bg-fg/[0.02] pl-2.5 pr-3 text-xs font-medium text-fg-2 transition-[color,background-color,border-color,scale] hover:border-fg/20 hover:bg-fg/[0.05] hover:text-fg active:scale-[0.98]",
            !loop && "invisible",
          )}
        >
          <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" aria-hidden="true">
            {paused ? <path d="M.5.6v8.8a.4.4 0 0 0 .6.34l6.9-4.4a.4.4 0 0 0 0-.68L1.1.26A.4.4 0 0 0 .5.6z" /> : <path d="M0 .75C0 .34.34 0 .75 0h1C2.16 0 2.5.34 2.5.75v8.5c0 .41-.34.75-.75.75h-1A.75.75 0 0 1 0 9.25zm5.5 0c0-.41.34-.75.75-.75h1c.41 0 .75.34.75.75v8.5c0 .41-.34.75-.75.75h-1a.75.75 0 0 1-.75-.75z" />}
          </svg>
          {paused ? "Play" : "Pause"}
        </button>
      </Container>
    </div>
  );
}
