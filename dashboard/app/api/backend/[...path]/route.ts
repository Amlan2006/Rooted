import { backendURL } from "@/lib/proxy";
import { hosted } from "@/lib/hosted";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  let url: URL;
  try {
    url = backendURL(
      path,
      new URL(request.url).search,
      process.env.ROOTED_BACKEND_URL || "http://127.0.0.1:8080",
    );
  } catch {
    return Response.json(
      {
        error: {
          message: "Unsupported backend route or invalid server configuration",
        },
      },
      { status: 400 },
    );
  }
  const paid = path.join("/").match(/^api\/v1\/xray\/blocks\/(0x[0-9a-fA-F]{64})$/);
  if (paid && hosted())
    return Response.json(
      {
        error: {
          code: "payment_required",
          message: "Hosted mode: per-block X-ray reports are sold to agents via x402",
          paid_url: `/api/paid/xray/${paid[1].toLowerCase()}`,
        },
      },
      { status: 402, headers: { "Cache-Control": "no-store" } },
    );
  const stream = path.join("/") === "api/v1/live";
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: stream
        ? request.signal
        : AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
      headers: request.headers.has("last-event-id")
        ? { "last-event-id": request.headers.get("last-event-id")! }
        : {},
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          message:
            "Rooted backend is unavailable. Check the Go service and database.",
        },
      },
      { status: 502 },
    );
  }
}
