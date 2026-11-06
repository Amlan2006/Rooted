import { cx } from "@/lib/cx";
import { CopyButton } from "./copy-button";

/**
 * A copyable shell command (hero, final CTA): a 44 px well, the same height as a large Button beside it; `$` is not
 * selectable. It stays one line: a command too long for the well scrolls sideways under a fade (12 px type below sm),
 * and the copy button always copies all of it.
 */
export function Command({ value, className }: { value: string; className?: string }) {
  return (
    <div
      className={cx(
        "flex h-11 min-w-0 items-center rounded-control border border-line-strong bg-bg pl-4 pr-1.5 transition-colors duration-150 hover:border-fg/20",
        className,
      )}
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap pr-3 font-mono text-[12px] leading-5 text-fg [mask-image:linear-gradient(90deg,#000_calc(100%-12px),transparent)] [scrollbar-width:none] sm:text-[13px] [&::-webkit-scrollbar]:hidden">
        <span aria-hidden="true" className="select-none text-fg-3">$ </span>
        <span className="select-all">{value}</span>
      </code>
      <CopyButton value={value} label={`Copy the command ${value}`} />
    </div>
  );
}
