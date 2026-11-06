// Hosted mode (spec §5): full per-block X-ray reports are paid via x402, and dashboard compute routes are closed.
// Off by default so self-hosting stays free. Server-side only (not a NEXT_PUBLIC_ variable).
// Turning the paywall on implies hosted mode, otherwise the free proxy would serve the paid report one URL over.
export const hosted = () => ["1", "true"].includes(process.env.ROOTED_HOSTED ?? "") || process.env.ROOTED_X402_ENABLED === "true";
export const hostedForbidden = () =>
  Response.json({ error: { code: "hosted_read_only", message: "Hosted mode is read-only. Self-host Rooted to run this for free." } }, { status: 403 });
// Block hashes whose full X-ray hosted mode serves without payment, so visitors can open one complete report.
// Exact match after trim + lowercase; an entry that is not a 32-byte hash is dropped, so a typo frees nothing.
export const freeXrayBlocks = () => new Set((process.env.ROOTED_FREE_XRAY_BLOCKS ?? "").split(",")
  .map(s => s.trim().toLowerCase()).filter(s => /^0x[0-9a-f]{64}$/.test(s)));
