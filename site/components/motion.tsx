"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { LazyMotion, MotionConfig, cubicBezier, inView } from "motion/react";
import { gasM, num } from "@/lib/format";
import { cx } from "@/lib/cx";

const easing = cubicBezier(0.22, 1, 0.36, 1);
// domAnimation (no layout features: tabs slide with CSS). It is evaluated after hydration, not during it; the download
// is not saved, because motion/react re-exports framer-motion as a namespace and the bundler keeps that code anyway.
const features = () => import("./motion-features").then((mod) => mod.default);

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
    let frame = 0;
    let stop = () => {};
    // Where it is at load comes from the observer's first entry (no layout read during hydration). On screen: never animates.
    const io = new IntersectionObserver(([e]) => {
      io.disconnect();
      if (e.isIntersecting) return;
      el.textContent = formats[format](0);
      stop = inView(el, () => {
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / (duration * 1000));
          el.textContent = formats[format](value * easing(t));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }, { amount: 0.6 });
    });
    io.observe(el);
    return () => {
      io.disconnect();
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
