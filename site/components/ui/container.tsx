import type { ElementType, ReactNode } from "react";
import { cx } from "@/lib/cx";

/** 1120 px content column with 20 / 32 px gutters. */
export function Container({ as: Tag = "div", className, children }: { as?: ElementType; className?: string; children?: ReactNode }) {
  return <Tag className={cx("mx-auto w-full max-w-[1184px] px-5 md:px-8", className)}>{children}</Tag>;
}
