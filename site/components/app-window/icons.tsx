// 16 px line icons for the miniature dashboard, drawn on a 16 grid with 1.5 strokes (centred on half pixels where it matters).
const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

type P = { className?: string };

export const IconPulse = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M1.75 8.25h2.5l1.5-4.5 3 8.5 1.75-5.5.9 1.5h2.85" />
  </svg>
);

export const IconXray = ({ className }: P) => (
  <svg {...base} className={className}>
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.25" />
    <path d="M5.25 11V9M8 11V5M10.75 11V7.5" />
  </svg>
);

export const IconList = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M6.25 4.25h7.5M6.25 8h7.5M6.25 11.75h4.5" />
    <path d="M2.5 4.25h.5M2.5 8h.5M2.5 11.75h.5" strokeWidth="2" />
  </svg>
);

export const IconBrief = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M3.75 2.25h8.5a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5v-2.5H3.75a1.5 1.5 0 0 1-1.5-1.5v-6.5a1.5 1.5 0 0 1 1.5-1.5Z" />
    <path d="M5.25 5.75h5.5M5.25 8.25h3.5" />
  </svg>
);

export const IconFrames = ({ className }: P) => (
  <svg {...base} className={className}>
    <rect x="2.25" y="2.75" width="11.5" height="4" rx="1.25" />
    <rect x="2.25" y="9.25" width="11.5" height="4" rx="1.25" />
  </svg>
);

export const IconStopwatch = ({ className }: P) => (
  <svg {...base} className={className}>
    <circle cx="8" cy="9" r="5.25" />
    <path d="M8 6.5V9l1.75 1.25M6.5 1.75h3" />
  </svg>
);

export const IconCompare = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M5 2.25v11.5M11 2.25v11.5" />
    <path d="M2.75 5.5H5M2.75 10.5H5M11 8h2.25" />
  </svg>
);

export const IconBuilders = ({ className }: P) => (
  <svg {...base} className={className}>
    <path d="M8 1.75 13.5 4.9v6.2L8 14.25 2.5 11.1V4.9L8 1.75Z" />
    <path d="M2.75 5 8 8l5.25-3M8 8v6" />
  </svg>
);

export const IconNode = ({ className }: P) => (
  <svg {...base} className={className}>
    <rect x="2.25" y="2.75" width="11.5" height="4.5" rx="1.25" />
    <rect x="2.25" y="8.75" width="11.5" height="4.5" rx="1.25" />
    <path d="M5 5h.01M5 11h.01" strokeWidth="2" />
  </svg>
);

export const IconChevrons = ({ className }: P) => (
  <svg {...base} width="12" height="12" viewBox="0 0 12 12" strokeWidth="1.25" className={className}>
    <path d="m3.75 4.5 2.25-2 2.25 2M3.75 7.5l2.25 2 2.25-2" />
  </svg>
);

export const IconCheck = ({ className }: P) => (
  <svg {...base} width="12" height="12" viewBox="0 0 12 12" strokeWidth="1.5" className={className}>
    <path d="m2.5 6.25 2.25 2.25 4.75-5" />
  </svg>
);

export const IconPause = ({ className }: P) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" className={className}>
    <rect x="2.5" y="2" width="2.5" height="8" rx="0.75" />
    <rect x="7" y="2" width="2.5" height="8" rx="0.75" />
  </svg>
);

export const IconPlay = ({ className }: P) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M3.5 2.4v7.2a.6.6 0 0 0 .92.5l5.4-3.6a.6.6 0 0 0 0-1L4.42 1.9a.6.6 0 0 0-.92.5Z" />
  </svg>
);
