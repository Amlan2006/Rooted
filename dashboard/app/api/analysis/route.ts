import { backendURL } from "@/lib/proxy";
import { hosted, hostedForbidden } from "@/lib/hosted";
import { ingestionPath, parseAnalysisRequest } from "@/lib/analysis-request";
export const dynamic = "force-dynamic";
export const maxDuration = 100;
const fail = (message: string, status: number) => Response.json({ error: { message } }, { status });
export async function POST(request: Request) {
  if (hosted()) return hostedForbidden();
  const requestURL = new URL(request.url);
  // Next's internal URL can use localhost even when the browser used 127.0.0.1.
  // Host is the browser's destination; browsers cannot override it with fetch.
  const expectedOrigin = `${requestURL.protocol}//${request.headers.get("host") || requestURL.host}`;
  if (request.headers.get("origin") !== expectedOrigin)
    return fail("Analysis must be submitted from this dashboard.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    return fail("Send an application/json analysis request.", 415);
  let input;
  try {
    const reader = request.body?.getReader();
    if (!reader) return fail("Provide an analysis request.", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return fail("Analysis request exceeds 4 KiB.", 413); }
      chunks.push(value);
    }
    const raw = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
    input = parseAnalysisRequest(JSON.parse(new TextDecoder().decode(raw)));
  } catch (error) { return fail(error instanceof Error ? error.message : "Invalid analysis request.", 400); }
  try {
    // Validate the configured origin using the existing restricted read proxy.
    const origin = backendURL(["health"], "", process.env.ROOTED_BACKEND_URL || "http://127.0.0.1:8080").origin;
    const response = await fetch(new URL(ingestionPath(input), origin), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: [] }), cache: "no-store", redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(95000)]),
    });
    return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return fail("Analysis could not finish. Check the backend and node connection, then retry.", 502);
  }
}
