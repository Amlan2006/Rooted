import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

// Drives mcp.mjs over stdio like an MCP client. The brief list comes from a local stub; no payment is attempted.
test("MCP server lists both tools, serves free briefs and validates the hash before any purchase", async (t) => {
  const stub = createServer((req, res) => res.end(JSON.stringify({ data: [{ block_number: 7, block_hash: "0x" + "ab".repeat(32), validator_bal_time: 19.1, extra: "dropped" }] })));
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  t.after(() => stub.close());
  const child = spawn(process.execPath, [new URL("mcp.mjs", import.meta.url).pathname], { env: { ...process.env, ROOTED_PUBLIC_URL: `http://127.0.0.1:${stub.address().port}` } });
  t.after(() => child.kill());
  const replies = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let id = 0;
  const rpc = async (method, params) => { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n"); return JSON.parse((await replies.next()).value); };

  assert.equal((await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } })).result.serverInfo.name, "rooted-x402");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  assert.deepEqual((await rpc("tools/list")).result.tools.map((x) => x.name), ["recent_xray_blocks", "buy_xray_report"]);
  const briefs = JSON.parse((await rpc("tools/call", { name: "recent_xray_blocks", arguments: { limit: 1 } })).result.content[0].text);
  assert.equal(briefs[0].validator_bal_time, 19.1);
  assert.equal(briefs[0].extra, undefined);
  const bad = (await rpc("tools/call", { name: "buy_xray_report", arguments: { block_hash: "latest" } })).result;
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /32-byte hash/);
  assert.equal((await rpc("tools/call", { name: "nope", arguments: {} })).error.code, -32602);
  assert.equal((await rpc("resources/list")).error.code, -32601);
});
