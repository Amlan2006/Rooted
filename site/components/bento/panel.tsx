import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** A crop of the dashboard: card chrome with a breadcrumb bar ("PayloadWatch / Slot 11,519,854") and mono meta. */
export function Panel({ crumb, title, meta, className, children }: { crumb: string; title: ReactNode; meta?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "flex flex-col overflow-hidden rounded-card border border-line bg-surface-1 shadow-raised transition-colors duration-200 ease-out group-hover/cell:border-line-strong",
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b px-3.5 text-[13px] leading-none">
        {/* Phones drop the crumb (the cell's own title names the module), so the figure after it is never cut. */}
        <p className="max-w-[80%] shrink-0 truncate">
          <span className="hidden text-fg-3 sm:inline">{crumb}</span>
          <span aria-hidden="true" className="hidden px-1.5 text-fg-3/50 sm:inline">/</span>
          <span className="text-fg">{title}</span>
        </p>
        {/* Never truncated (a cut figure reads as a different one): callers hide secondary meta on phones instead. */}
        {meta && <div className="ml-auto shrink-0 whitespace-nowrap font-mono text-[12px] text-fg-3">{meta}</div>}
      </div>
      {children}
    </div>
  );
}

/** 12 px check mark; draws itself when its parent animates `stroke-dashoffset` (pathLength 1). */
export function Check({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className={cx("shrink-0", className)}>
      <path d="M2.5 6.25 4.9 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
    </svg>
  );
}

/** Small accent chip for a verified outcome: <Verified>match</Verified>. */
export function Verified({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-acc/25 bg-acc/[0.07] pr-2 pl-1.5 font-mono text-[11px] leading-none text-acc">
      <Check />
      {children}
    </span>
  );
}
