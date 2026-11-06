import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Container } from "./container";
import { Eyebrow } from "./eyebrow";

type Props = {
  /** Anchor id: /#product */
  id: string;
  /** "Promises" → with index 1 renders "01 / Promises". */
  eyebrow: ReactNode;
  index?: number;
  /** Serif h2; labels the section landmark. Without it the section is an interstitial: eyebrow, then content. */
  title?: ReactNode;
  /** Muted lead paragraph under the title (or beside it, with `split`). */
  intro?: ReactNode;
  /** From lg: h2 in columns 1–6 and the lead in 8–12, sharing the h2's last baseline. */
  split?: boolean;
  /** Children skip the Container so they can run edge to edge (e.g. the block tape). */
  bleed?: boolean;
  /** Less vertical padding, for secondary sections. */
  compact?: boolean;
  className?: string;
  children?: ReactNode;
};

/**
 * Full-bleed top hairline, vertical rhythm, header, then content. content-visibility skips sections off screen at
 * load (about half the first render's style and layout work); the placeholder is near the typical height per
 * breakpoint, and <RenderAhead> renders each one for real shortly after hydration so later jumps land on real sizes.
 */
export function Section({ id, eyebrow, index, title, intro, split, bleed, compact, className, children }: Props) {
  const gap = title ? "mt-12 md:mt-16" : "mt-6";
  return (
    <section
      id={id}
      aria-labelledby={title ? `${id}-title` : undefined}
      data-defer=""
      className={cx(
        "border-t [content-visibility:auto] [contain-intrinsic-size:auto_2000px] md:[contain-intrinsic-size:auto_1500px] lg:[contain-intrinsic-size:auto_1250px]",
        compact ? "py-16 md:py-20" : "py-20 md:py-28",
        className,
      )}
    >
      <Container>
        <Eyebrow index={index}>{eyebrow}</Eyebrow>
        {title && (
          <div className={cx("mt-6", split && "grid gap-y-5 lg:grid-cols-12 lg:items-baseline-last lg:gap-x-6")}>
            {/* A lone h2 runs on one line; with a lead it is capped for a tighter rag. */}
            <h2 id={`${id}-title`} className={cx("font-serif text-h2", !!intro && "max-w-[20ch]", split && "lg:col-span-6")}>
              {title}
            </h2>
            {intro && <p className={cx("max-w-[58ch] text-lead text-muted", split ? "lg:col-span-5 lg:col-start-8" : "mt-5")}>{intro}</p>}
          </div>
        )}
      </Container>
      {children && (bleed ? <div className={gap}>{children}</div> : <Container className={gap}>{children}</Container>)}
    </section>
  );
}
