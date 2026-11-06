import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { hosted } from "@/lib/hosted";
import { runAnalyst, sessionFor, sse } from "@/lib/analyst/agent";
import { fileLedger, overBudget } from "@/lib/analyst/budget";
import { EXECUTORS } from "@/lib/analyst/tools";
import type { AnalystEvent } from "@/lib/analyst/types";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" };
// Every response is an SSE body, so the view reads errors the same way whatever the status.
const fail = (code: Extract<AnalystEvent, { type: "error" }>["code"], message: string, status: number) =>
  new Response(sse({ type: "error", code, message }), { status, headers });
const Body = z.strictObject({ question: z.string().trim().min(1).max(2000), session_id: z.uuid().optional() });
let busy = false; // one investigation per server process

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return fail("disabled", "The analyst is off: ANTHROPIC_API_KEY is not set on this server.", 503);
  if (hosted() && process.env.ROOTED_ANALYST_PUBLIC !== "true") return fail("disabled", "The analyst is off in hosted mode. Self-host Rooted to use it.", 403);
  const requestURL = new URL(request.url);
  // Next's internal URL can use localhost even when the browser used 127.0.0.1.
  // Host is the browser's destination; browsers cannot override it with fetch.
  const expectedOrigin = `${requestURL.protocol}//${request.headers.get("host") || requestURL.host}`;
  if (request.headers.get("origin") !== expectedOrigin)
    return fail("bad_request", "Questions must be submitted from this dashboard.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    return fail("bad_request", "Send an application/json question.", 415);
  let input;
  try {
    const reader = request.body?.getReader();
    if (!reader) return fail("bad_request", "Provide a question.", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return fail("bad_request", "The request exceeds 8 KiB.", 413); }
      chunks.push(value);
    }
    const raw = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
    const parsed = Body.safeParse(JSON.parse(new TextDecoder().decode(raw)));
    if (!parsed.success) return fail("bad_request", "Send {question: 1-2000 characters, session_id?: uuid}.", 400);
    input = parsed.data;
  } catch { return fail("bad_request", "Invalid JSON.", 400); }
  if (busy) return fail("bad_request", "Another investigation is running. Retry when it finishes.", 429);
  const ledger = fileLedger();
  if (await overBudget(ledger, new Date())) return fail("budget", "The analyst's daily budget is spent. It resets at 00:00 UTC.", 429);

  busy = true;
  const session = sessionFor(input.session_id), stop = new AbortController(), encoder = new TextEncoder();
  const question = input.question;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AnalystEvent) => { try { controller.enqueue(encoder.encode(sse(event))); } catch { /* reader gone */ } };
      try {
        emit({ type: "session", session_id: session.id });
        await runAnalyst(question, session, emit, {
          client: new Anthropic(), exec: EXECUTORS, now: () => new Date(), ledger,
          signal: AbortSignal.any([request.signal, stop.signal]),
        });
      } catch {
        emit({ type: "error", code: "upstream", message: "The investigation stopped unexpectedly." });
      } finally {
        busy = false;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() { stop.abort(); },
  });
  return new Response(body, { headers });
}
