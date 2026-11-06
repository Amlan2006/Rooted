import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Mono label, 12 px uppercase. With `index`: "01 / Promises". */
export function Eyebrow({ index, className, children }: { index?: number; className?: string; children: ReactNode }) {
  return (
    <p className={cx("font-mono text-label uppercase text-muted", className)}>
      {index !== undefined && (
        <>
          <span className="text-ink">{String(index).padStart(2, "0")}</span>
          <span aria-hidden="true"> / </span>
        </>
      )}
      {children}
    </p>
  );
}
