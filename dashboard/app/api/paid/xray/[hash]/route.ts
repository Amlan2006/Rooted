import { paidXray, x402Config } from "@/lib/x402";
export const dynamic = "force-dynamic";
// Config is validated once at load: a misconfigured paywall fails closed instead of serving free or mispriced reports.
export const GET = paidXray(x402Config(process.env));
