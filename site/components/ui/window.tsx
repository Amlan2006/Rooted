import type { ElementType, ReactNode } from "react";
import { cx } from "@/lib/cx";

type Props = {
  /** Title bar, left: plain text or a breadcrumb. */
  title?: ReactNode;
  /** Title bar, right: muted mono meta such as "snapshot · captured 2026-11-06". */
  meta?: ReactNode;
  /** Three muted traffic dots at the start of the title bar. */
  dots?: boolean;
  /** The deep drop shadow. Spec: only the hero app window gets it. */
  shadow?: boolean;
  as?: ElementType;
  className?: string;
  /** Classes for the area under the title bar. */
  bodyClassName?: string;
  children?: ReactNode;
};

/** App-window chrome: 1px line-strong border, radius 14, surface-1, inset top highlight. The title bar renders when any of title/meta/dots is set. */
export function Window({ title, meta, dots, shadow, as: Tag = "div", className, bodyClassName, children }: Props) {
  const bar = title || meta || dots;
  return (
    <Tag className={cx("overflow-hidden rounded-window border border-line-strong bg-surface-1", shadow ? "shadow-window" : "shadow-raised", className)}>
      {bar && (
        <div className="flex h-11 items-center gap-3 border-b border-line px-4 text-[13px]">
          {dots && (
            <span aria-hidden="true" className="flex gap-1.5">
              <i className="size-2.5 rounded-full bg-fg/10" />
              <i className="size-2.5 rounded-full bg-fg/10" />
              <i className="size-2.5 rounded-full bg-fg/10" />
            </span>
          )}
          {title && <div className="max-w-[65%] shrink-0 truncate font-medium text-fg">{title}</div>}
          {/* Meta gives way first on narrow screens (ellipsis). */}
          {meta && <div className="ml-auto min-w-0 truncate pl-2 font-mono text-xs text-fg-3">{meta}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </Tag>
  );
}
