import { test } from "node:test";
import assert from "node:assert/strict";
import { backendURL } from "../lib/proxy";
test("proxy only accepts known read routes on its configured backend origin", () => {
  const base = "http://127.0.0.1:8080";
  assert.equal(
    backendURL(["api", "v1", "live"], "?network=sepolia", base).href,
    base + "/api/v1/live?network=sepolia",
  );
  for (const route of [
    ["api", "v1", "slots", "1", "ingest"],
    ["..", "health"],
    ["https:", "", "evil.invalid"],
    ["api", "v1", "secrets"],
    ["api", "v1", "analysis", "runs", "no"],
  ])
    assert.throws(() => backendURL(route, "", base));
  for (const origin of [
    "file:///etc/passwd",
    "http://user:secret@127.0.0.1",
    "https://example.com/path",
  ])
    assert.throws(() => backendURL(["health"], "", origin));
});

test("CRE proxy exposes report reads but no receiver or snapshot-creation mutation", () => {
  const base = "http://127.0.0.1:8080";
  assert.equal(
    backendURL(["api", "v1", "cre", "reports"], "?network=sepolia", base)
      .origin,
    base,
  );
  assert.throws(() =>
    backendURL(["api", "v1", "incidents", "summary"], "", base),
  );
  assert.throws(() =>
    backendURL(["api", "v1", "cre", "reports", "ingest"], "", base),
  );
});
