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
export function Marquee({ label, seconds, aside, children }: { label: string; seconds: number; aside: ReactNode; children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const [loop, setLoop] = useState(false);
  const track = useRef<HTMLDivElement>(null);

  // The copy is built when the tape comes within a viewport of the screen, not during load: it is ~300 elements of
  // style and layout work that nobody can see yet. A viewport early, so the switch to the loop is never on screen.
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
    <>
      <div role="region" aria-label={label} tabIndex={0} className={cx(s.viewport, "border-y outline-offset-[-2px] focus-visible:outline-ink", loop && s.loop, paused && s.paused)}>
        <div ref={track} className={s.track} style={{ "--tape-duration": `${seconds}s` } as CSSProperties}>
          {children}
        </div>
      </div>
      <Container className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-6">
        {aside}
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          className={cx(
            "-mx-1.5 -my-1.5 inline-flex h-7 shrink-0 items-center gap-2 rounded-[4px] px-1.5 font-mono text-label uppercase text-muted transition-colors duration-150 hover:text-ink focus-visible:text-ink",
            !loop && "invisible",
          )}
        >
          <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor" aria-hidden="true">
            {paused ? <path d="M0 0l8 5-8 5z" /> : <path d="M0 0h2.5v10H0zM5.5 0H8v10H5.5z" />}
          </svg>
          {paused ? "Play" : "Pause"}
        </button>
      </Container>
    </>
  );
}
