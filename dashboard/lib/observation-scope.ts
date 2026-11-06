/** No live requests are issued until the backend identifies its configured source. */
export function observationScope(mode: "live" | "synthetic", source?: string): string | null {
  if (!source?.trim()) return null;
  return new URLSearchParams({ network: "sepolia", mode, source }).toString();
}
