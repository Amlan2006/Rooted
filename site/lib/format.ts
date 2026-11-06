// Fixed locale so server-rendered and client-rendered figures always match.
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const two = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12075273 → "12,075,273" */
export const num = (n: number) => int.format(n);

/** 55719446 → "55.72M" */
export const gasM = (gas: number) => `${two.format(gas / 1e6)}M`;

/** "0x1234…abcd" (0x + first 4, last 4) */
export const shortHash = (hash: string) => (hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash);

/** 1204.4 → "1,204 ms" */
export const ms = (n: number) => `${int.format(n)} ms`;

/** ISO UTC timestamp → "2026-11-06" */
export const capturedOn = (iso: string) => iso.slice(0, 10);

/** The muted line every figure carries: "Sepolia block 12,075,273 · captured 2026-11-06". */
export const sourceLine = (file: { source: string; captured_at: string | null }) =>
  file.captured_at ? `${file.source} · captured ${capturedOn(file.captured_at)}` : file.source;
