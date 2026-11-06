import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/backend/[...path]/route";

const id = "0x" + "cd".repeat(32);
const get = (path: string[]) => GET(new Request("http://localhost:3000/api/backend/" + path.join("/") + "?network=sepolia"), { params: Promise.resolve({ path }) });

test("hosted mode does not serve profiles, which carry the paid report's inputs", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ data: [] }); });
  process.env.ROOTED_X402_ENABLED = "true";
  try {
    for (const path of [["api", "v1", "profiles"], ["api", "v1", "profiles", id], ["api", "v1", "profiles", id, "capture"]])
      assert.equal((await get(path)).status, 403, path.join("/"));
    assert.equal(calls, 0);
    process.env.ROOTED_X402_ENABLED = "false";
    assert.equal((await get(["api", "v1", "profiles", id, "capture"])).status, 200, "self-hosted profiles stay free");
  } finally { delete process.env.ROOTED_X402_ENABLED; }
});
