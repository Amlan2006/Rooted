"use client";

import { useEffect, useState, type RefObject } from "react";
import { cx } from "@/lib/cx";

/**
 * The sliding "selected" pill behind a row (or column) of tabs: one element whose position and size follow the active
 * item with a 300 ms CSS transition, instead of motion's layoutId (which needs its layout-projection bundle).
 * Until it has measured (server HTML, first paint) it renders nothing and `fallback` should draw the pill in the item.
 */
export function useIndicator(items: RefObject<(HTMLElement | null)[]>, active: number) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // A ResizeObserver reports the item's size on observe, after layout: nothing is measured during hydration, and the
  // item's own pill shows until then, so there is no flash.
  useEffect(() => {
    const el = items.current?.[active];
    if (!el) return;
    const update = () => setBox({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items, active]);
  return box;
}

export function Indicator({ box, className }: { box: { x: number; y: number; w: number; h: number } | null; className?: string }) {
  if (!box) return null;
  return (
    <span
      aria-hidden="true"
      className={cx("pointer-events-none absolute top-0 left-0 transition-[translate,width,height] duration-300 ease-out", className)}
      style={{ translate: `${box.x}px ${box.y}px`, width: box.w, height: box.h }}
    />
  );
}
