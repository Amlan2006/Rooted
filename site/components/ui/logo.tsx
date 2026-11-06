import { cx } from "@/lib/cx";

/** The mark: a rounded-square outline with a root glyph in the accent. Decorative; pair it with the word "Rooted". */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cx("size-5 shrink-0", className)}>
      <rect x="1" y="1" width="18" height="18" rx="5.25" stroke="var(--fg)" strokeWidth="1.5" />
      <path d="M10 5.25v4.5m0 0-3.25 4M10 9.75l3.25 4M10 9.75v5" stroke="var(--acc)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
