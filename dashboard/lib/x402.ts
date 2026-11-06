import { NextRequest, NextResponse } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { backendURL } from "@/lib/proxy";
import { freeXrayBlocks } from "@/lib/hosted";

// Hosted mode (spec §6): agents pay per block hash on Hedera testnet; off by default so self-hosting stays free.
export type X402Config = { payTo: string; asset: string; amount: string; facilitatorURL: string; maxTimeoutSeconds: number; publicURL: string | null };
export const PAID_ROUTE = "/api/paid/xray/[hash]";
const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export function x402Config(env: Record<string, string | undefined>): X402Config | null {
  if (env.ROOTED_X402_ENABLED !== "true") return null;
  const payTo = env.ROOTED_X402_PAY_TO ?? "", asset = env.ROOTED_X402_HEDERA_ASSET || "0.0.0";
  const amount = env.ROOTED_X402_PRICE_ATOMIC || "1000000", timeout = env.ROOTED_X402_MAX_TIMEOUT_SECONDS || "120";
  // Rejects the 0.0.0000000 placeholder from .env.example as well as malformed ids.
  if (!/^0\.0\.[1-9]\d{0,15}$/.test(payTo)) throw Error("ROOTED_X402_PAY_TO must be a Hedera account id such as 0.0.12345");
  if (!/^0\.0\.\d{1,16}$/.test(asset)) throw Error("ROOTED_X402_HEDERA_ASSET must be 0.0.0 (HBAR) or an HTS token id");
  if (!/^[1-9]\d{0,17}$/.test(amount)) throw Error("ROOTED_X402_PRICE_ATOMIC must be a positive integer in atomic units");
  // Hedera rejects transaction valid durations above 180 s, so a longer payment window cannot settle.
  if (!/^\d{1,3}$/.test(timeout) || +timeout < 1 || +timeout > 180) throw Error("ROOTED_X402_MAX_TIMEOUT_SECONDS must be 1-180");
  let url: URL;
  try { url = new URL(env.ROOTED_X402_FACILITATOR_URL || "https://x402.org/facilitator"); } catch { throw Error("ROOTED_X402_FACILITATOR_URL must be a URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw Error("ROOTED_X402_FACILITATOR_URL must be an https URL without credentials");
  let publicURL: URL | null = null;
  try { if (env.ROOTED_PUBLIC_URL) publicURL = new URL(env.ROOTED_PUBLIC_URL); } catch { throw Error("ROOTED_PUBLIC_URL must be a URL"); }
  if (publicURL && (!["http:", "https:"].includes(publicURL.protocol) || publicURL.username || publicURL.password || publicURL.pathname !== "/" || publicURL.search || publicURL.hash))
    throw Error("ROOTED_PUBLIC_URL must be an http(s) origin such as https://rooted.example.org");
  return { payTo, asset, amount, facilitatorURL: url.href.replace(/\/$/, ""), maxTimeoutSeconds: +timeout, publicURL: publicURL?.origin ?? null };
}

export const paidHash = (pathname: string) => {
  const hash = pathname.split("/").at(-1) ?? "";
  return /^0x[0-9a-f]{64}$/.test(hash) ? hash : null;
};

// Paid handler: a stored-report read. withX402 settles only when this returns < 400, so a 404/502 is never charged.
async function report(request: NextRequest) {
  const hash = paidHash(request.nextUrl.pathname)!;
  let status: number, body: string;
  try {
    // Validate the configured origin using the existing restricted read proxy.
    const origin = backendURL(["health"], "", process.env.ROOTED_BACKEND_URL || "http://127.0.0.1:8080").origin;
    const response = await fetch(new URL(`/api/v1/xray/blocks/${hash}?network=sepolia`, origin), {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    });
    status = response.status; body = await response.text();
  } catch {
    return fail(502, "backend_unavailable", "Rooted backend is unavailable; no payment was settled.");
  }
  if (status < 400) {
    // Never charge for a body that is not the requested report.
    let data: { schema?: unknown; block?: { hash?: unknown } } | undefined;
    try { data = JSON.parse(body)?.data; } catch {}
    if (status !== 200 || data?.schema !== "rooted-xray-v1" || data.block?.hash !== hash)
      return fail(502, "invalid_report", "Backend returned no valid X-ray report for this hash; no payment was settled.");
  }
  return new NextResponse(body, { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export function paidXray(cfg: X402Config | null, facilitator?: FacilitatorClient) {
  if (!cfg)
    return async (_request: NextRequest) => fail(404, "not_found",
      "Paid X-ray is disabled on this instance (ROOTED_X402_ENABLED is not true). Self-hosted Rooted serves the same report free at /api/v1/xray/blocks/<hash>?network=sepolia.");
  const server = new x402ResourceServer(facilitator ?? new HTTPFacilitatorClient({ url: cfg.facilitatorURL }))
    .register("hedera:testnet", new ExactHederaScheme());
  const paid = withX402(report, {
    [PAID_ROUTE]: {
      accepts: [{ scheme: "exact", network: "hedera:testnet", payTo: cfg.payTo,
        price: { amount: cfg.amount, asset: cfg.asset }, maxTimeoutSeconds: cfg.maxTimeoutSeconds }],
      description: "Rooted Glamsterdam X-ray report for one Sepolia block",
      mimeType: "application/json",
    },
  }, server);
  return async (request: NextRequest) => {
    // Reject malformed hashes before asking for payment.
    const hash = paidHash(request.nextUrl.pathname);
    if (!hash) return fail(400, "invalid_hash", "Use a lowercase 0x-prefixed 32-byte block hash.");
    if (freeXrayBlocks().has(hash)) return report(request); // ROOTED_FREE_XRAY_BLOCKS sample: same checks, no payment
    // Behind a reverse proxy request.url is the internal origin; PAYMENT-REQUIRED must name the public one.
    return paid(cfg.publicURL ? new NextRequest(new URL(request.nextUrl.pathname + request.nextUrl.search, cfg.publicURL), { headers: request.headers }) : request);
  };
}
