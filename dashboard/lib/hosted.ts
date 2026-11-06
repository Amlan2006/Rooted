// Hosted mode (spec §5): full per-block X-ray reports are paid via x402, and dashboard compute routes are closed.
// Off by default so self-hosting stays free. Server-side only (not a NEXT_PUBLIC_ variable).
export const hosted = () => ["1", "true"].includes(process.env.ROOTED_HOSTED ?? "");
export const hostedForbidden = () =>
  Response.json({ error: { code: "hosted_read_only", message: "Hosted mode is read-only. Self-host Rooted to run this for free." } }, { status: 403 });
