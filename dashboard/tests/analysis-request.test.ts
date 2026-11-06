import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestionPath, parseAnalysisRequest } from "../lib/analysis-request";
import { POST } from "../app/api/analysis/route";
const hash = "0x" + "a".repeat(64);
test("transaction and block requests stay on distinct live Sepolia ingestion routes", () => {
  assert.equal(ingestionPath(parseAnalysisRequest({ kind: "transaction", hash: ` ${hash.toUpperCase().replace("0X", "0x")} ` })), `/api/v1/analysis/transactions/${hash}/ingest?network=sepolia&mode=live`);
  assert.equal(ingestionPath({ kind: "block", hash }), `/api/v1/analysis/blocks/${hash}/ingest?network=sepolia&mode=live`);
  for (const invalid of [null, [], { kind: "fork", hash }, { kind: "transaction", hash: "0x123" }, { kind: "block", hash: `${hash}/ingest` }, { kind: "block", hash, url: "https://other.invalid" }]) assert.throws(() => parseAnalysisRequest(invalid));
});
test("ingestion proxy rejects cross-origin, invalid, and oversized requests before contacting backend", async () => {
  const request = (body: string, origin = "http://localhost:3000", contentType = "application/json") => new Request("http://localhost:3000/api/analysis", { method: "POST", headers: { Origin: origin, "Content-Type": contentType }, body });
  assert.equal((await POST(request("{}", "https://other.invalid"))).status, 403);
  assert.equal((await POST(request("{}", "http://localhost:3000", "text/plain"))).status, 415);
  assert.equal((await POST(request("{}"))).status, 400);
  assert.equal((await POST(request("x".repeat(4097)))).status, 413);
});

test("ingestion proxy forwards only the selected hash to its configured backend and preserves source errors", async (t) => {
  const calls: { url: string; body: string }[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    calls.push({ url: String(url), body: String(options.body) });
    return Response.json({ error: { message: "transaction is pending" } }, { status: 409 });
  });
  const request = new Request("http://localhost:3000/api/analysis", { method: "POST", headers: { Origin: "http://127.0.0.1:3000", Host: "127.0.0.1:3000", "Content-Type": "application/json" }, body: JSON.stringify({ kind: "transaction", hash }) });
  const response = await POST(request);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.message, "transaction is pending");
  assert.equal(new URL(calls[0].url).pathname, `/api/v1/analysis/transactions/${hash}/ingest`);
  assert.deepEqual(JSON.parse(calls[0].body), { transactions: [] });
});
