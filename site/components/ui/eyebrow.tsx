import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Section kicker: 13 px Geist 500 in the accent, sentence case. No numbering, no uppercase tracking. */
export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cx("text-[13px] font-medium leading-5 tracking-[-0.005em] text-acc", className)}>{children}</p>;
}
