"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { LazyMotion, MotionConfig, cubicBezier, inView, m, type Variants } from "motion/react";
import { gasM, num } from "@/lib/format";
import { cx } from "@/lib/cx";

const ease = [0.22, 1, 0.36, 1] as const;
const easing = cubicBezier(...ease);
// No delay inside `shown`: a variant delay would override the parent's stagger offset.
const rise: Variants = { hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease } } };
const tags = { div: m.div, section: m.section, ul: m.ul, ol: m.ol, li: m.li, span: m.span, p: m.p };
// The spec's `amount: 0.3` can never fire for a block taller than 3.3 viewports (zoomed or short screens), which
// left it invisible but focusable. "some" with the bottom 20% trimmed looks the same and fires for any height.
const viewport = { once: true, amount: "some", margin: "0px 0px -20% 0px" } as const;
// Animation features (incl. layout, for `layoutId`) are evaluated after hydration instead of during it (lower TBT).
const features = () => import("./motion-features").then((mod) => mod.default);
type Tag = keyof typeof tags;

/**
 * Root wrapper (layout). Client components must use `m.div` etc. from "motion/react", not `motion.div` (strict mode throws).
 * Motion skips transform/layout animations when the OS asks for reduced motion.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={features} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** 8px rise + fade, 0.5s, once when it is above the bottom fifth of the viewport. Under reduced motion (or no JS) the CSS in globals.css pins the final state. */
export function Reveal({ children, as = "div", delay = 0, className }: { children: ReactNode; as?: Tag; delay?: number; className?: string }) {
  const M = tags[as];
  return (
    <M
      data-reveal=""
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={viewport}
      variants={delay ? { ...rise, shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease, delay } } } : rise}
    >
      {children}
    </M>
  );
}

/** Staggers its <StaggerItem> children (direct or nested) as the group enters view. */
export function Stagger({ children, as = "div", gap = 0.06, className }: { children: ReactNode; as?: Tag; gap?: number; className?: string }) {
  const M = tags[as];
  return (
    <M className={className} initial="hidden" whileInView="shown" viewport={viewport} variants={{ hidden: {}, shown: { transition: { staggerChildren: gap } } }}>
      {children}
    </M>
  );
}

export function StaggerItem({ children, as = "div", className }: { children: ReactNode; as?: Tag; className?: string }) {
  const M = tags[as];
  return (
    <M data-reveal="" className={className} variants={rise}>
      {children}
    </M>
  );
}

const formats = { int: (v: number) => num(Math.round(v)), gasM };

/**
 * Counts from 0 to `value` once, when it scrolls into view. The server HTML and screen readers always get the final
 * value; if the figure is already on screen at load, or motion is reduced, it never animates (no flash of 0).
 */
export function CountUp({ value, format = "int", duration = 1.2, className }: { value: number; format?: keyof typeof formats; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const text = formats[format](value);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = el.getBoundingClientRect();
    if (box.top < innerHeight && box.bottom > 0) return;
    el.textContent = formats[format](0);
    let frame = 0;
    const stop = inView(el, () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / (duration * 1000));
        el.textContent = formats[format](value * easing(t));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { amount: 0.6 });
    return () => {
      stop();
      cancelAnimationFrame(frame);
      el.textContent = formats[format](value);
    };
  }, [value, format, duration]);
  return (
    <span className={cx("tabular-nums", className)}>
      <span ref={ref} aria-hidden="true">{text}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
