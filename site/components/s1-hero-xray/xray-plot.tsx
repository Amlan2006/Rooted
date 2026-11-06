"use client";

import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { inView } from "motion/react";
import { gasM, num } from "@/lib/format";
import { cx } from "@/lib/cx";
import s from "./xray.module.css";

/** One transaction, trimmed on the server to what the chart and tooltip need. */
export type Lane = { i: number; gas: number; hash: string; create: boolean };

// Geometry in viewBox units. headroom and gap are counted in dot rows so every band sits on the same dot grid.
type Geo = { perBand: number; laneW: number; dotH: number; r: number; headroom: number; gap: number };
// Banded layouts keep 6 rows of headroom: room for the band label above even the tallest lane.
const LAYOUTS: Geo[] = [
  { perBand: Infinity, laneW: 8, dotH: 4.5, r: 1.5, headroom: 8, gap: 0 }, // lg+: one row of 134 lanes
  { perBand: 67, laneW: 10, dotH: 4.5, r: 1.6, headroom: 6, gap: 4 }, // md: two bands
  { perBand: 34, laneW: 10, dotH: 4.5, r: 1.6, headroom: 6, gap: 4 }, // phones: four bands
];
const QUERIES = ["(min-width: 64rem)", "(min-width: 48rem)"]; // Tailwind lg, md

type Placed = Lane & { n: number; x: number; top: number; bandTop: number; bandH: number };
type Plan = { lanes: Placed[]; ink: string; bands: { y: number; h: number; from: number; to: number }[]; w: number; h: number; per: number; geo: Geo };

/** Lanes left to right in block order, wrapped every `perBand`; each band is as tall as its tallest lane. */
function plan(lanes: Lane[], geo: Geo, unit: number, cap: number): Plan {
  const per = Math.min(geo.perBand, lanes.length);
  const placed: Placed[] = [];
  const bands: Plan["bands"] = [];
  let row = 0;
  for (let start = 0; start < lanes.length; start += per) {
    const band = lanes.slice(start, start + per);
    const dots = band.map((l) => Math.max(1, Math.ceil(l.gas / unit)));
    const rows = geo.headroom + Math.max(...dots);
    const y = row * geo.dotH;
    bands.push({ y, h: rows * geo.dotH, from: band[0].i, to: band[band.length - 1].i });
    band.forEach((l, k) => {
      const n = dots[k];
      placed.push({ ...l, n, x: (k + 0.5) * geo.laneW, top: (row + rows - n + 0.5) * geo.dotH, bandTop: y, bandH: rows * geo.dotH });
    });
    row += rows + geo.gap;
  }
  const ink = placed.filter((_, k) => k !== cap).map((l) => dotsPath(l, geo.dotH)).join("");
  return { lanes: placed, ink, bands, w: per * geo.laneW, h: (row - geo.gap) * geo.dotH, per, geo };
}

// A lane is one path of near-zero-length segments; round caps turn each into a dot. Far lighter HTML than a circle per dot.
const dotsPath = (l: Placed, dotH: number) => `M${l.x} ${l.top}v.01` + `m0 ${dotH - 0.01}v.01`.repeat(l.n - 1);

// Keep in step with xray.module.css: the climb starts when the sweep reaches the signal lane, the callout when it tops out.
const WIPE_MS = 900;
const CLIMB_MS = 600;

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

type View = {
  active: number;
  shown: boolean;
  keyFocus: boolean;
  cap: number;
  label: string;
  /** Index of the layout on screen, once known on the client. Only that one renders the interactive listbox. */
  live: number | null;
  onEnter: (k: number) => void;
  onLeave: () => void;
  onFocus: (k: number, e: FocusEvent<SVGRectElement>) => void;
  onBlur: (e: FocusEvent<SVGGElement>) => void;
};

/**
 * Block X-ray: one lane per transaction, `unit` gas per dot (ceil, so every transaction shows at least one).
 * Three fixed layouts swap by breakpoint in CSS, so the server HTML is the finished chart and nothing shifts.
 * The lanes of the visible layout form a listbox with a roving tabindex: Tab lands on one lane, arrows move,
 * Home/End jump, Esc hides the tooltip.
 */
export function XrayPlot({ lanes, cap, unit, label }: { lanes: Lane[]; cap: number; unit: number; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(cap);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState<false | "key" | "pointer">(false);
  const [dismissed, setDismissed] = useState(false);
  const [wait, setWait] = useState(false);
  const [live, setLive] = useState<number | null>(null);
  const plans = useMemo(() => LAYOUTS.map((g) => plan(lanes, g, unit, cap)), [lanes, unit, cap]);
  const shown = (hover || focus !== false) && !dismissed;

  useEffect(() => {
    const mqs = QUERIES.map((q) => matchMedia(q));
    const pick = () => setLive(mqs[0].matches ? 0 : mqs[1].matches ? 1 : 2);
    pick();
    mqs.forEach((mq) => mq.addEventListener("change", pick));
    return () => mqs.forEach((mq) => mq.removeEventListener("change", pick));
  }, []);

  // The CSS draw-in starts at first paint. If the chart is mostly off screen by then, restart it when it scrolls in.
  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = el.getBoundingClientRect();
    if (Math.min(box.bottom, innerHeight) - Math.max(box.top, 0) >= box.height * 0.25) return;
    setWait(true);
    return inView(el, () => setWait(false), { amount: 0.25 });
  }, []);

  // WCAG 1.4.13: hover/focus content can be dismissed without moving the pointer or focus.
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setDismissed(true);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shown]);

  const view: View = {
    active,
    shown,
    keyFocus: focus === "key",
    cap,
    label,
    live,
    onEnter: (k) => (setActive(k), setHover(true), setDismissed(false)),
    onLeave: () => setHover(false),
    onFocus: (k, e) => (setActive(k), setDismissed(false), setFocus(e.currentTarget.matches(":focus-visible") ? "key" : "pointer")),
    onBlur: (e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocus(false),
  };

  return (
    <div ref={root} data-wait={wait || undefined} className={s.root}>
      <Plot index={0} plan={plans[0]} view={view} className="hidden lg:block" />
      <Plot index={1} plan={plans[1]} view={view} className="hidden md:block lg:hidden" />
      <Plot index={2} plan={plans[2]} view={view} className="mx-auto max-w-[26rem] md:hidden" stacked />
    </div>
  );
}

function Plot({ index, plan: p, view: v, className, stacked }: { index: number; plan: Plan; view: View; className?: string; stacked?: boolean }) {
  const id = useId();
  const { geo, w, h } = p;
  const lane = p.lanes[v.active];
  const capLane = p.lanes[v.cap];
  const last = p.lanes.length - 1;
  const single = p.bands.length === 1;
  const live = v.live === index;
  const shown = live && v.shown;

  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    const row = single ? 1 : p.per;
    const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: row, ArrowUp: -row, PageDown: 10, PageUp: -10 };
    const next = e.key === "Home" ? 0 : e.key === "End" ? last : e.key in steps ? Math.min(last, Math.max(0, v.active + steps[e.key])) : null;
    if (next === null) return;
    e.preventDefault();
    e.currentTarget.querySelector<SVGRectElement>(`[data-i="${next}"]`)?.focus();
  };

  // Lanes reaching the top of the chart leave no room above: put the tooltip beside the lane top, on the roomier side.
  const beside = lane.top < 14 * geo.dotH;
  const tipStyle = beside
    ? { left: pct(lane.x, w), top: pct(lane.top, h), transform: lane.x / w > 0.5 ? "translate(calc(-100% - 14px), -6px)" : "translate(14px, -6px)" }
    : { left: `clamp(5.5rem, ${pct(lane.x, w)}, calc(100% - 5.5rem))`, top: pct(lane.top, h), transform: "translate(-50%, calc(-100% - 10px))" };

  return (
    <div className={className}>
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} className={cx("block h-auto w-full overflow-visible", shown && s.dim)}>
          <defs>
            <pattern id={`${id}g`} width={geo.laneW} height={geo.dotH} patternUnits="userSpaceOnUse">
              <circle cx={geo.laneW / 2} cy={geo.dotH / 2} r={geo.r * 0.62} fill="var(--line)" />
            </pattern>
          </defs>
          {p.bands.map((b) => (
            <rect key={b.y} x={0} y={b.y} width={w} height={b.h} fill={`url(#${id}g)`} />
          ))}
          {shown && <rect x={lane.x - geo.laneW / 2} y={lane.bandTop} width={geo.laneW} height={lane.bandH} fill="var(--ink)" fillOpacity={0.05} />}

          {/* Two paths per layout, not one per lane: the DOM (and hydration) stays small. Inspecting a lane dims the
              group and redraws that one lane on top at full strength. */}
          <g aria-hidden="true" fill="none" strokeWidth={geo.r * 2} strokeLinecap="round">
            <g className={s.lanes}>
              <path d={p.ink} stroke="var(--ink)" strokeOpacity={0.8} />
              <path d={dotsPath(capLane, geo.dotH)} stroke="var(--signal)" />
            </g>
            {shown && <path d={dotsPath(lane, geo.dotH)} stroke={v.active === v.cap ? "var(--signal)" : "var(--ink)"} strokeOpacity={v.active === v.cap ? 1 : 0.8} />}
          </g>

          {/* Drawn whenever a lane has keyboard focus, even after Esc hides the tooltip: it is the only focus indicator. */}
          {live && v.keyFocus && (
            <rect
              x={lane.x - geo.laneW / 2 + 0.5}
              y={lane.top - geo.dotH / 2 - 1.5}
              width={geo.laneW - 1}
              height={lane.n * geo.dotH + 3}
              rx={1.5}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Client-only, and only for the layout on screen: keeps the static HTML small and the a11y tree single. */}
          {live && (
            <g
              role="listbox"
              aria-label={v.label}
              aria-orientation={single ? "horizontal" : undefined}
              onKeyDown={onKey}
              onBlur={v.onBlur}
              onPointerLeave={v.onLeave}
            >
              {p.lanes.map((l, k) => (
                <rect
                  key={l.i}
                  role="option"
                  data-i={k}
                  tabIndex={k === v.active ? 0 : -1}
                  aria-selected={k === v.active}
                  aria-label={`Transaction ${l.i}: ${num(l.gas)} gas, ${l.create ? "contract creation" : "call"}, ${l.hash}`}
                  x={l.x - geo.laneW / 2}
                  y={l.bandTop}
                  width={geo.laneW}
                  height={l.bandH}
                  fill="transparent"
                  className="outline-none"
                  onPointerEnter={() => v.onEnter(k)}
                  onFocus={(e) => v.onFocus(k, e)}
                />
              ))}
            </g>
          )}
        </svg>

        {/* Draw-in: paper covers retract on the compositor (a left-to-right sweep, then the signal lane climbs), so the
            SVG paints once instead of every frame. */}
        <div aria-hidden="true" className={cx(s.wipe, "pointer-events-none absolute -inset-px bg-paper")} />
        <div
          aria-hidden="true"
          className={cx(s.climb, "pointer-events-none absolute bg-paper")}
          style={{
            left: pct(capLane.x - geo.laneW / 2, w),
            width: pct(geo.laneW, w),
            top: pct(capLane.bandTop, h),
            height: pct(capLane.bandH, h),
            animationDelay: `${Math.round(WIPE_MS * (capLane.x / w))}ms`,
          }}
        />

        <p
          aria-hidden="true"
          className={cx(
            s.callout,
            "pointer-events-none absolute flex -translate-y-1/2 items-center gap-2 font-mono text-xs text-ink transition-opacity duration-150",
            // The tooltip says the same about the signal lane; don't stack the two.
            shown && v.active === v.cap && "opacity-0",
          )}
          style={{ left: pct(capLane.x + geo.laneW / 2, w), top: pct(capLane.top, h), animationDelay: `${Math.round(WIPE_MS * (capLane.x / w)) + CLIMB_MS}ms` }}
        >
          <span className="h-px w-4 shrink-0 bg-signal" />
          <span className={cx("bg-paper px-1", stacked ? "flex flex-col" : "whitespace-nowrap")}>
            <span>
              tx {capLane.i} · {capLane.create ? "contract creation" : "call"}
              {!stacked && " · "}
            </span>
            <span>{gasM(capLane.gas)} gas</span>
          </span>
        </p>

        {!single &&
          p.bands.map((b) => (
            <span
              key={b.y}
              aria-hidden="true"
              className="absolute left-0 bg-paper pr-1.5 font-mono text-xs leading-3 text-muted"
              style={{ top: pct(b.y, h) }}
            >
              tx {b.from}–{b.to}
            </span>
          ))}

        {shown && (
          <div
            aria-hidden="true"
            className={cx(s.tip, "pointer-events-none absolute z-10 w-44 rounded-button bg-ink px-3 py-2 font-mono text-xs leading-[18px] text-paper")}
            style={tipStyle}
          >
            <div className="flex justify-between gap-3">
              <span>tx {lane.i}</span>
              <span className="text-paper/60">{lane.create ? "creation" : "call"}</span>
            </div>
            <div>{num(lane.gas)} gas</div>
            <div className="text-paper/60">{lane.hash}</div>
          </div>
        )}
      </div>

      <div aria-hidden="true" className="mt-3 flex justify-between gap-4 font-mono text-label text-muted">
        {single && <span>tx {p.lanes[0].i}</span>}
        {/* Invisible, not absent, until the listbox exists: no layout shift, and no promise the static HTML can't keep. */}
        <span className={cx(v.live === null && "invisible")}>
          <span className="[@media(hover:none)]:hidden">hover or tab to a lane</span>
          <span className="hidden [@media(hover:none)]:inline">tap a lane</span>
        </span>
        {single && <span>tx {p.lanes[last].i}</span>}
      </div>
    </div>
  );
}
