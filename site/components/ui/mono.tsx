import type { ElementType, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { capturedOn } from "@/lib/format";

/** Geist Mono with tabular figures, for numbers, hashes and code. Inherits size unless you pass one. */
export function Mono({ as: Tag = "span", muted, className, children }: { as?: ElementType; muted?: boolean; className?: string; children: ReactNode }) {
  return <Tag className={cx("font-mono tabular-nums", muted && "text-muted", className)}>{children}</Tag>;
}

/** The honesty line under any figure: "<source> · captured 2026-11-06" (as lib/format sourceLine), muted mono 12 px. */
export function SourceLine({ data, className }: { data: { source: string; captured_at: string | null }; className?: string }) {
  return (
    // break-words: a long API path may split rather than push the page sideways at 375 px.
    <p className={cx("font-mono text-label break-words text-muted", className)}>
      {data.source}
      {/* The date never splits at its hyphens, and a wrapped line never starts with the separator. */}
      {data.captured_at && (
        <>
          {" · "}
          <span className="whitespace-nowrap">captured {capturedOn(data.captured_at)}</span>
        </>
      )}
    </p>
  );
}
