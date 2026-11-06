// Arrows as SVG: Geist's Google "latin" subset has no → or ↗ glyphs, so text arrows would fall back to another font.
const base = { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: 1.25, "aria-hidden": true } as const;

export const ArrowRight = ({ className }: { className?: string }) => (
  <svg {...base} className={className}>
    <path d="M1.5 6h9M7 2.5 10.5 6 7 9.5" />
  </svg>
);

/** Marks links that leave the site. */
export const ArrowUpRight = ({ className }: { className?: string }) => (
  <svg {...base} className={className}>
    <path d="M3.5 8.5l5-5M4.5 3.5h4v4" />
  </svg>
);
