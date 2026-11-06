import type { ElementType, ReactNode } from "react";
import { cx } from "@/lib/cx";

/** 1200 px content column with 20 / 32 px gutters. Lay out inside with `grid grid-cols-12 gap-x-6`. */
export function Container({ as: Tag = "div", className, children }: { as?: ElementType; className?: string; children?: ReactNode }) {
  return <Tag className={cx("mx-auto w-full max-w-[calc(1200px+4rem)] px-5 md:px-8", className)}>{children}</Tag>;
}
