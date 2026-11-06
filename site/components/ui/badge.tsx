import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

const dots = { acc: "bg-acc", warn: "bg-warn", bad: "bg-bad", muted: "bg-fg-3" };

/** Small mono pill, e.g. <Badge dot="acc">match</Badge> or <Badge>devnet</Badge>. */
export function Badge({ dot, className, children }: { dot?: keyof typeof dots; className?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-fg/[0.025] px-2 font-mono text-[11px] leading-none text-fg-2", className)}>
      {dot && <span aria-hidden="true" className={cx("size-1.5 rounded-full", dots[dot])} />}
      {children}
    </span>
  );
}
