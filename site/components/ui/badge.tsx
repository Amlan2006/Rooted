import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Small hairline-bordered mono tag, e.g. <Badge>testnet</Badge>. */
export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex h-6 items-center rounded-[4px] border px-2 font-mono text-label uppercase text-muted", className)}>
      {children}
    </span>
  );
}
