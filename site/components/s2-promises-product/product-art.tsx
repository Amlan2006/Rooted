import type { ReactNode } from "react";

// Schematic drawings, no data. Fixed 284×96 px (fits the narrowest cell, 287 px) so strokes and labels stay pixel-exact.
// Hover detail is CSS only (a `group` on the cell); the global reduced-motion rule makes it instant.

const W = 284;
const H = 96;
const ease = "duration-500 ease-out";
/** Stroke that draws itself on hover (needs pathLength={1}). */
const draw = `[stroke-dasharray:1] [stroke-dashoffset:1] transition-[stroke-dashoffset] ${ease} group-hover:[stroke-dashoffset:0]`;
const tint = `transition-colors ${ease}`;
const delay = (ms: number) => ({ transitionDelay: `${ms}ms` });

function Art({ children }: { children: ReactNode }) {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" strokeWidth={1} aria-hidden="true" className="block overflow-visible">
      {children}
    </svg>
  );
}

function Label({ x, y, anchor, className = "fill-muted", children }: { x: number; y: number; anchor?: "middle" | "end"; className?: string; children: ReactNode }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={12} className={`font-mono ${className}`}>
      {children}
    </text>
  );
}

/** bid → envelope → PTC votes across one slot. */
export function PayloadArt() {
  return (
    <Art>
      <Label x={0} y={22}>bid</Label>
      <Label x={96} y={22}>envelope</Label>
      <Label x={192} y={22}>PTC votes</Label>
      <path d="M0.5 44V60M283.5 44V60M4 52.5H284" className="stroke-line" />
      <path d="M4 52.5H192" pathLength={1} className={`stroke-ink ${draw}`} />
      <rect x={0.5} y={48.5} width={8} height={8} className="fill-ink" />
      <rect x={96.5} y={48.5} width={8} height={8} className={`fill-paper stroke-ink group-hover:fill-ink ${tint}`} style={delay(220)} />
      {Array.from({ length: 17 }, (_, i) => (
        <path key={i} d={`M${194.5 + i * 5} 42V63`} className={`stroke-ink/25 group-hover:stroke-ink ${tint}`} style={delay(340 + i * 22)} />
      ))}
      <Label x={0} y={86}>slot n</Label>
      <Label x={284} y={86} anchor="end">slot n+1</Label>
    </Art>
  );
}

const lanes = [
  [[26, 96, 1], [100, 160], [164, 224]],
  [[26, 60], [64, 104], [110, 186, 1]],
  [[26, 112], [116, 192], [198, 262, 1]],
  [[26, 78], [82, 134], [138, 214]],
] as const;

/** A block scheduled on four cores; hover traces the critical path through conflicting transactions. */
export function XrayArt() {
  return (
    <Art>
      {lanes.map((boxes, l) => (
        <g key={l}>
          <Label x={0} y={19 + l * 22}>{`c${l + 1}`}</Label>
          {boxes.map(([a, b, crit]) => (
            <rect
              key={a}
              x={a + 0.5}
              y={8.5 + l * 22}
              width={b - a - 1}
              height={13}
              rx={1.5}
              className={crit ? `fill-paper stroke-ink/40 group-hover:fill-ink group-hover:stroke-ink ${tint}` : "fill-paper stroke-ink/40"}
              style={crit ? delay(l * 150) : undefined}
            />
          ))}
        </g>
      ))}
      <path d="M96 15H103V37H110M186 37H192V59H198" pathLength={1} className={`stroke-ink ${draw}`} />
      <path d="M266.5 2V94" strokeDasharray="2 2" className="stroke-muted" />
    </Art>
  );
}

/** Transactions in block order, joined by the three conflict kinds. */
export function BalArt() {
  const arcs = ["M22 54Q61 22 100 54", "M100 54Q178-6 256 54", "M178 62Q217 96 256 62"];
  return (
    <Art>
      <path d="M0 58.5H280M276 55l4 3.5-4 3.5" className="stroke-line" />
      {arcs.map((d, i) => (
        <g key={d}>
          <path d={d} className="stroke-ink/40" />
          <path d={d} pathLength={1} className={`stroke-ink ${draw}`} style={delay(i * 120)} />
        </g>
      ))}
      {[22, 100, 178, 256].map((x) => (
        <rect key={x} x={x - 4} y={54.5} width={8} height={8} className="fill-ink" />
      ))}
      <Label x={61} y={31} anchor="middle" className={`fill-muted group-hover:fill-ink ${tint}`}>RAW</Label>
      <Label x={178} y={17} anchor="middle" className={`fill-muted group-hover:fill-ink ${tint}`}>WAR</Label>
      <Label x={217} y={76} anchor="middle" className={`fill-muted group-hover:fill-ink ${tint}`}>WAW</Label>
    </Art>
  );
}

const steps = ["submission_acknowledged", "admission_confirmed", "rule checks", "inclusion_confirmed"];

/** A frame transaction's lifecycle; hover confirms the receipt. */
export function FrameArt() {
  return (
    <Art>
      {steps.map((label, i) => {
        const y = 18 + i * 24;
        const last = i === steps.length - 1;
        return (
          <g key={label}>
            <rect x={0.5} y={y - 9.5} width={10} height={10} rx={1.5} className="stroke-ink/40" />
            <path d={`M3 ${y - 4.5}l2 2 3.5-4`} pathLength={1} className={last ? `stroke-ink ${draw}` : "stroke-ink"} />
            <Label x={20} y={y} className={last ? `fill-muted group-hover:fill-ink ${tint}` : "fill-ink"}>
              {label}
            </Label>
          </g>
        );
      })}
      <Label x={112} y={66}>pass · pass · skipped</Label>
      <Label x={162} y={90} className={`fill-muted opacity-0 transition-opacity group-hover:opacity-100 ${ease}`}>
        type 0x6 receipt
      </Label>
    </Art>
  );
}

const stateCalls = [100, 115, 123, 136, 146, 160, 173, 181, 198, 212, 230, 236];

/** Nested timers of one replay; hover runs a time cursor across them. */
export function ProfilerArt() {
  return (
    <Art>
      <Label x={0} y={18}>ApplyMessage</Label>
      <Label x={0} y={42}>EVM call</Label>
      <Label x={0} y={66}>StateDB</Label>
      <Label x={0} y={90}>Finalise</Label>
      <path d="M96.5 2V94" className="stroke-line" />
      <rect x={96.5} y={10.5} width={144} height={7} className="stroke-ink" />
      <rect x={108} y={34} width={118} height={8} className="fill-ink/80" />
      {stateCalls.map((x) => (
        <rect key={x} x={x} y={58} width={2} height={8} className="fill-ink" />
      ))}
      <rect x={246} y={82} width={36} height={8} className="fill-ink/40" />
      <path
        d="M96.5 2V94"
        className="stroke-ink opacity-0 transition-[translate,opacity] duration-[900ms] ease-out group-hover:translate-x-[186px] group-hover:opacity-100"
      />
    </Art>
  );
}

const fields = [
  { name: "hash", dash: "5 2" },
  { name: "parent", dash: "3 2 6 2" },
  { name: "state root", dash: "7 2 2 2" },
  { name: "BAL", dash: "2 2 4 2" },
];

/** The same fields from two providers, compared row by row. */
export function ProviderArt() {
  return (
    <Art>
      <Label x={100} y={12}>primary</Label>
      <Label x={196} y={12}>reference</Label>
      {fields.map((f, i) => {
        const y = 34 + i * 19;
        return (
          <g key={f.name}>
            <Label x={0} y={y}>{f.name}</Label>
            <path d={`M100 ${y - 4}H166M196 ${y - 4}H262`} strokeWidth={4} strokeDasharray={f.dash} className="stroke-ink/35" />
            <path d={`M176 ${y - 6}H186M176 ${y - 2}H186`} className={`stroke-ink/25 group-hover:stroke-ink ${tint}`} style={delay(i * 90)} />
          </g>
        );
      })}
    </Art>
  );
}
