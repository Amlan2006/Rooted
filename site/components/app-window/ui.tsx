import { useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "@/lib/cx";

/** A card inside the app window: surface-2, hairline, radius 10. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("min-w-0 rounded-card border border-line bg-surface-2 shadow-raised", className)}>{children}</div>;
}

/** Card title row: title left, muted meta right, on one baseline. A <p>, not a heading: these are labels inside a product miniature. */
export function CardHead({ title, meta, className }: { title: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 text-[13px] leading-5", className)}>
      <p className="min-w-0 truncate font-medium tracking-[-0.01em] text-fg">{title}</p>
      {meta && <div className="shrink-0 font-mono text-[11px] text-fg-3">{meta}</div>}
    </div>
  );
}

/** The view's page header, as in the dashboard: title, one line of purpose, optional right slot. */
export function ViewHead({ title, sub, aside }: { title: string; sub: string; aside?: ReactNode }) {
  return (
    <div className="hidden items-end justify-between gap-4 @2xl:flex">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-5 tracking-[-0.02em] text-fg">{title}</p>
        <p className="mt-0.5 truncate text-[13px] leading-5 text-fg-3">{sub}</p>
      </div>
      {aside && <div className="hidden shrink-0 items-center gap-1.5 @3xl:flex">{aside}</div>}
    </div>
  );
}

/** Small mono chip; `on` marks the one verified / selected element in the accent. */
export function Chip({ on, className, children }: { on?: boolean; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 font-mono text-[11px] leading-none",
        on ? "border-acc/25 bg-acc/[0.08] text-acc" : "border-line-strong bg-fg/[0.03] text-fg-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Label over a large mono figure, with an optional note. */
export function Stat({ label, value, note, className }: { label: ReactNode; value: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="truncate text-[12px] leading-4 text-fg-3">{label}</div>
      <div className="mt-1.5 font-mono text-[17px] leading-6 tracking-[-0.02em] text-fg tabular-nums">{value}</div>
      {note && <div className="mt-0.5 truncate font-mono text-[11px] leading-4 text-fg-3">{note}</div>}
    </div>
  );
}

const LANE = 3; // viewBox units per bar: a 2-unit bar centred in its lane, so bar i's centre sits at (i + 0.5) / n

/**
 * A bar series as an SVG: one path for the resting bars, one each for the accent and the inspected bar, instead of
 * an element (and an animation) per bar. `heights` are percentages of the box; 0 draws nothing. `up` bars stand on the
 * bottom edge, `down` bars hang from the top. The resting fill dims while another bar is inspected.
 */
export function Bars({
  heights,
  accent,
  active,
  down,
  rest,
  dim,
  on = "fill-fg",
  className,
}: {
  heights: number[];
  accent?: number;
  active: number | null;
  down?: boolean;
  rest: string;
  dim: string;
  on?: string;
  className?: string;
}) {
  const path = (keep: (i: number) => boolean) =>
    heights
      .map((h, i) => {
        if (!h || !keep(i)) return "";
        const x = i * LANE + 0.5;
        return down ? `M${x} 0h2v${h.toFixed(2)}h-2z` : `M${x} ${(100 - h).toFixed(2)}h2V100h-2z`;
      })
      .join("");
  const inspected = active !== null && active !== accent ? active : null;
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${heights.length * LANE} 100`} preserveAspectRatio="none" shapeRendering="crispEdges" className={cx("block h-full w-full", className)}>
      <path d={path((i) => i !== accent && i !== inspected)} className={cx("transition-[fill] duration-150", active === null ? rest : dim)} />
      {inspected !== null && <path d={path((i) => i === inspected)} className={on} />}
      {accent !== undefined && <path d={path((i) => i === accent)} className="fill-acc" />}
    </svg>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Scrubbing a bar chart: pointer position (or touch drag) picks a bar, and the chart is a WAI-ARIA slider for the
 * keyboard (arrows, Page keys, Home/End; Esc clears). `active` is null when nothing is being inspected.
 */
export function useScrub(count: number, start: number) {
  const [active, setActive] = useState<number | null>(null);
  const pick = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setActive(clamp(Math.floor(((e.clientX - r.left) / r.width) * count), 0, count - 1));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const at = active ?? start;
    const step: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
    let next: number | null = null;
    if (e.key in step) next = clamp(at + step[e.key], 0, count - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else if (e.key === "Escape" && active !== null) next = -1;
    if (next === null) return;
    e.preventDefault();
    setActive(next < 0 ? null : next);
  };
  return {
    active,
    props: {
      role: "slider" as const,
      tabIndex: 0,
      "aria-valuemin": 0,
      "aria-valuemax": count - 1,
      "aria-valuenow": active ?? start,
      onPointerMove: pick,
      onPointerDown: pick,
      onPointerLeave: (e: PointerEvent<HTMLElement>) => e.currentTarget !== document.activeElement && setActive(null),
      onFocus: (e: FocusEvent<HTMLElement>) => e.currentTarget.matches(":focus-visible") && setActive((a) => a ?? start),
      onBlur: () => setActive(null),
      onKeyDown,
    },
  };
}

/** Tooltip box for a scrubbed bar, kept inside the chart: `x` is the bar centre in percent. */
export function Tip({ x, bottom, children }: { x: number; bottom: string; children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-10 w-max -translate-x-1/2 rounded-control border border-line-strong bg-bg/95 px-2.5 py-1.5 font-mono text-[11px] leading-4 text-fg-2 shadow-raised"
      style={{ left: `clamp(84px, ${x}%, calc(100% - 84px))`, bottom }}
    >
      {children}
    </div>
  );
}
