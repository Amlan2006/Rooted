import { test } from "node:test";
import assert from "node:assert/strict";
import { backendURL } from "../lib/proxy";
import { GET } from "../app/api/backend/[...path]/route";
import { POST as analysis } from "../app/api/analysis/route";
import { POST as profiler } from "../app/api/profiler/route";
import { POST as providers } from "../app/api/provider-comparison/route";
import { GET as policy } from "../app/api/policy-deployment/route";

const base = "http://127.0.0.1:8080", hash = "0x" + "Ab".repeat(32);
const get = (path: string[]) => GET(new Request("http://localhost:3000/api/backend/" + path.join("/") + "?network=sepolia"), { params: Promise.resolve({ path }) });

test("proxy allows the X-ray and frame conformance reads only", () => {
  for (const route of [["api", "v1", "xray", "blocks"], ["api", "v1", "xray", "blocks", hash], ["api", "v1", "xray", "summary"], ["api", "v1", "frames", "conformance"]])
    assert.equal(backendURL(route, "?network=sepolia", base).pathname, "/" + route.join("/"));
  for (const route of [["api", "v1", "xray"], ["api", "v1", "xray", "blocks", "latest"], ["api", "v1", "xray", "blocks", hash, "capture"], ["api", "v1", "xray", "summary", "x"], ["api", "v1", "xray", "uniswap"], ["api", "v1", "frames", "conformance", "run"]])
    assert.throws(() => backendURL(route, "", base));
});

test("hosted mode without a paywall withholds full block reports, keeps lists free, and closes compute routes", async (t) => {
  let called = "";
  t.mock.method(globalThis, "fetch", async (url: URL) => { called = String(url); return Response.json({ data: [] }); });
  assert.equal((await get(["api", "v1", "xray", "blocks", hash])).status, 200, "self-hosted reports stay free");
  process.env.ROOTED_HOSTED = "1";
  try {
    called = "";
    const withheld = await get(["api", "v1", "xray", "blocks", hash]);
    assert.equal(withheld.status, 403, "nothing is sold, so no 402");
    assert.deepEqual((await withheld.json()).error, { code: "hosted_read_only", message: "This hosted deployment serves block briefs, not full reports. Self-host Rooted to read them for free.", free_samples: [] });
    assert.equal(called, "", "a withheld report never reaches the backend");
    for (const free of [["api", "v1", "xray", "blocks"], ["api", "v1", "xray", "summary"]]) assert.equal((await get(free)).status, 200);
    const post = new Request("http://localhost:3000/x", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: "{}" });
    for (const route of [analysis, profiler, providers]) assert.equal((await route(post.clone())).status, 403);
    assert.equal((await policy()).status, 403);
  } finally { delete process.env.ROOTED_HOSTED; }
});
