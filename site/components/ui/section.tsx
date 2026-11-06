import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Container } from "./container";
import { Eyebrow } from "./eyebrow";
import { Reveal, Stagger, StaggerItem } from "@/components/reveal";

/**
 * Heads change shape with the section's weight. "chapter" (52 px) is for the few big turns of the page and is the only
 * size that takes the two-tone `dim` line; "md" (40 px) and "sm" (32 px) are one tone.
 */
const sizes = { chapter: "text-h2", md: "text-h3", sm: "text-h4" } as const;

type HeadProps = {
  /** Only where it adds something the nav does not already say. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Second, dimmed line (fg-4) of a two-tone chapter head. */
  dim?: ReactNode;
  /** Muted lead paragraph; at most one key term in <b>. */
  lead?: ReactNode;
  /** id for the heading, so a <section aria-labelledby> can point at it. */
  id?: string;
  size?: keyof typeof sizes;
  className?: string;
  /** Right-hand slot from lg (a lead, buttons), bottom-aligned with the heading; under it below lg. */
  aside?: ReactNode;
};

/** Left-aligned section head: optional eyebrow, headline, optional lead or right-hand aside. */
export function SectionHead({ eyebrow, title, dim, lead, id, size = "chapter", className, aside }: HeadProps) {
  // Every head enters the same way: eyebrow, headline, lead, 60 ms apart (CSS pins the final state without JS or motion).
  const head = (
    <Stagger className={size === "chapter" ? "max-w-[760px]" : "max-w-[680px]"}>
      {eyebrow && (
        <StaggerItem>
          <Eyebrow className="mb-4">{eyebrow}</Eyebrow>
        </StaggerItem>
      )}
      <StaggerItem>
        <h2 id={id} className={sizes[size]}>
          {title}
          {dim && <span className="block text-fg-4">{dim}</span>}
        </h2>
      </StaggerItem>
      {lead && (
        <StaggerItem>
          <p className={cx("max-w-[56ch] text-fg-2", size === "chapter" ? "mt-5 text-lead" : "mt-4 text-[17px] leading-[1.55] tracking-[-0.01em]")}>{lead}</p>
        </StaggerItem>
      )}
    </Stagger>
  );
  if (!aside) return <div className={className}>{head}</div>;
  return (
    <div className={cx("flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-12", className)}>
      {head}
      <Reveal delay={0.18} className="shrink-0">
        {aside}
      </Reveal>
    </div>
  );
}

type Props = Omit<ComponentProps<"section">, "title"> &
  Partial<Pick<HeadProps, "eyebrow" | "title" | "dim" | "lead" | "aside" | "size">> & {
    /** Anchor: /#product */
    id: string;
    /** Children skip the Container so they can run edge to edge (e.g. the block tape). */
    bleed?: boolean;
  };

/**
 * A page section: 96 / 140 px above, no rules. Pass `title` (and eyebrow/dim/lead/aside/size) for a standard head,
 * which also labels the landmark; or omit it and place <SectionHead id={`${id}-title`}> yourself, passing
 * aria-labelledby. content-visibility skips off-screen sections at load; <RenderAhead> renders them after hydration.
 * Paint containment clips anything that overflows the section box.
 */
export function Section({ id, eyebrow, title, dim, lead, aside, size, bleed, className, children, ...rest }: Props) {
  const gap = size === "chapter" || size === undefined ? "mt-12 md:mt-16" : "mt-10 md:mt-12";
  return (
    <section
      id={id}
      aria-labelledby={title ? `${id}-title` : undefined}
      data-defer=""
      {...rest}
      className={cx(
        "pt-24 md:pt-[140px] [content-visibility:auto] [contain-intrinsic-size:auto_1400px] md:[contain-intrinsic-size:auto_1100px]",
        className,
      )}
    >
      {title && (
        <Container>
          <SectionHead id={`${id}-title`} eyebrow={eyebrow} title={title} dim={dim} lead={lead} aside={aside} size={size} />
        </Container>
      )}
      {children && (bleed ? <div className={title ? gap : undefined}>{children}</div> : <Container className={title ? gap : undefined}>{children}</Container>)}
    </section>
  );
}
