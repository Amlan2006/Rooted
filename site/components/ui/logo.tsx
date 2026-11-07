import { cx } from "@/lib/cx";

/** The mark: an R of three lanes, the stem's foot block in the accent. Decorative; pair it with the word "Rooted". */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cx("size-5 shrink-0", className)}>
      <path d="M8 4h32a8 8 0 0 1 0 16H8zM8 24h36a8 8 0 0 1 0 16H8zM28 44h12l16 16H44z" fill="var(--fg)" />
      <rect x="8" y="44" width="16" height="16" fill="var(--acc)" />
    </svg>
  );
}
