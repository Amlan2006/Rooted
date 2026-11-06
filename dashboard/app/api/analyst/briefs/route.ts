import { backendURL } from "@/lib/proxy";
export const dynamic = "force-dynamic";
// The Analyst view's auto-brief feed, pinned to Sepolia; the backend validates limit (1..100).
export async function GET(request: Request) {
  const query = new URLSearchParams({ network: "sepolia" });
  const limit = new URL(request.url).searchParams.get("limit");
  if (limit) query.set("limit", limit);
  try {
    const url = backendURL(["api", "v1", "analyst", "briefs"], "?" + query, process.env.ROOTED_BACKEND_URL || "http://127.0.0.1:8080");
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]) });
    return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: { message: "Rooted backend is unavailable. Check the Go service and database." } }, { status: 502 });
  }
}
