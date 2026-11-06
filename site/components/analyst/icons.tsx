// Hand-drawn 16 px line icons for the Analyst section (1.25 stroke, currentColor, decorative).
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** Tool calls: a prompt in a window. */
export const ToolsIcon = ({ className }: { className?: string }) => (
  <svg {...base} className={className}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
    <path d="M4.75 6.25 6.75 8l-2 1.75M8.75 10h2.5" />
  </svg>
);

/** A paid receipt with a torn edge. */
export const ReceiptIcon = ({ className }: { className?: string }) => (
  <svg {...base} className={className}>
    <path d="M3.75 1.75h8.5v12.5l-1.7-1.1-1.4 1.1L8 13.15l-1.15 1.1-1.4-1.1-1.7 1.1z" />
    <path d="M6 5.25h4M6 7.75h4M6 10.25h2" />
  </svg>
);

/** A hash: sha256-pinned evidence. */
export const HashIcon = ({ className }: { className?: string }) => (
  <svg {...base} className={className}>
    <path d="M6.5 2.25 5 13.75M11 2.25 9.5 13.75M2.75 5.75h10.75M2.5 10.25h10.75" />
  </svg>
);

export const ReplayIcon = ({ className }: { className?: string }) => (
  <svg {...base} width={14} height={14} className={className}>
    <path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.77" />
    <path d="M4.25 1.75v2.75H7" />
  </svg>
);

/** Step status: a hairline ring while waiting, a spinning arc while running, a check when done (acc). */
export function Status({ state, className }: { state: "wait" | "run" | "done"; className?: string }) {
  return (
    <span aria-hidden="true" className={`relative inline-flex size-4 shrink-0 items-center justify-center ${className ?? ""}`}>
      {state === "done" ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-acc">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity=".28" strokeWidth="1.25" />
          <path d="M5.4 8.1 7.2 9.9l3.4-3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={state === "run" ? "animate-spin text-fg-2" : "text-fg-4"}>
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.25" />
          {state === "run" && <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
        </svg>
      )}
    </span>
  );
}
