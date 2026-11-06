import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";

type Style = { variant?: "ink" | "outline"; size?: "sm" | "md"; className?: string; children: ReactNode };
type AsLink = Style & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
type AsButton = Style & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };

// The signal ring is under 3:1 on paper (WCAG 1.4.11), so focus also gets an ink cue: an underline, a full ink border.
const variants = {
  ink: "bg-ink text-paper hover:bg-ink/85 focus-visible:bg-ink/85 focus-visible:underline focus-visible:underline-offset-4",
  outline: "border border-ink/15 text-ink hover:border-ink/35 hover:bg-paper-2 focus-visible:border-ink focus-visible:bg-paper-2",
};
const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm" };

/** Renders <a> when given `href`, else <button type="button">. 150 ms colour transitions, 1px press. */
export function Button({ variant = "ink", size = "md", className, children, ...rest }: AsLink | AsButton) {
  const classes = cx(
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-button font-medium",
    "transition-[background-color,border-color,color,transform] duration-150 ease-out active:translate-y-px",
    variants[variant],
    sizes[size],
    className,
  );
  if (rest.href !== undefined) return <a className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>;
  return <button type="button" className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>{children}</button>;
}
