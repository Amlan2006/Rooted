import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { ArrowRight, ArrowUpRight } from "./icons";

type Style = {
  /** primary: white with black text (one per view). ghost: 1px line-strong border, faint white fill. */
  variant?: "primary" | "ghost";
  size?: "sm" | "md" | "lg";
  /** Trailing arrow: "right" nudges right on hover, "external" (↗) nudges up-right. */
  arrow?: "right" | "external";
  className?: string;
  children: ReactNode;
};
type AsLink = Style & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
type AsButton = Style & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };

const variants = {
  primary: "bg-fg text-bg hover:bg-fg/90 focus-visible:bg-fg/90",
  ghost: "border border-line-strong bg-fg/[0.025] text-fg hover:border-fg/20 hover:bg-fg/[0.06] focus-visible:bg-fg/[0.06]",
};
const sizes = { sm: "h-8 gap-1.5 px-3 text-[13px]", md: "h-9 gap-2 px-3.5 text-sm", lg: "h-11 gap-2 px-[18px] text-[15px]" };
const arrows = {
  right: <ArrowRight className="-mr-0.5 opacity-55 transition-transform duration-150 ease-out group-hover/btn:translate-x-0.5" />,
  external: <ArrowUpRight className="-mr-0.5 opacity-55 transition-transform duration-150 ease-out group-hover/btn:-translate-y-px group-hover/btn:translate-x-px" />,
};

/** Renders <a> when given `href`, else <button type="button">. 150 ms colour transitions, slight press. */
export function Button({ variant = "primary", size = "md", arrow, className, children, ...rest }: AsLink | AsButton) {
  const classes = cx(
    "group/btn inline-flex select-none items-center justify-center whitespace-nowrap rounded-control font-medium tracking-[-0.01em]",
    "transition-[background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.98]",
    variants[variant],
    sizes[size],
    className,
  );
  const body = (
    <>
      {children}
      {arrow && arrows[arrow]}
    </>
  );
  if (rest.href !== undefined) return <a className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>{body}</a>;
  return <button type="button" className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>{body}</button>;
}
