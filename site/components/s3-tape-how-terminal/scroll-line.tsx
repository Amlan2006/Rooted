"use client";

import { useRef, type ReactNode } from "react";
import { m, useReducedMotion, useScroll } from "motion/react";

/**
 * A 1px rail down the left of its children, inked in step with the scroll: empty when the top of the list reaches
 * 70% of the viewport, full when its bottom does. Under reduced motion the rail is drawn in full.
 */
export function ScrollLine({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 70%"] });
  return (
    <div ref={ref} className="relative">
      <div className="absolute inset-y-0 left-3.5 w-px bg-line" aria-hidden="true">
        <m.div className="size-full origin-top bg-ink" style={{ scaleY: reduce ? 1 : scrollYProgress }} />
      </div>
      {children}
    </div>
  );
}
