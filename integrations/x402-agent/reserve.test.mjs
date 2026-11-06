import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, sessionSpent } from "./spend.mjs";

const row = (r) => JSON.stringify({ session: "s", asset: "0.0.0", amount: "1000000", ...r });

test("a signed payment counts against the budget until the server proves it did not settle", () => {
  assert.equal(sessionSpent(row({ run_id: "a", pending: true, settled: false }), "s", "0.0.0"), "1000000", "reply lost: still reserved");
  assert.equal(sessionSpent([row({ run_id: "a", pending: true }), row({ run_id: "a", settled: true, pending: false })].join("\n"), "s", "0.0.0"), "1000000", "settled once, not twice");
  assert.equal(sessionSpent([row({ run_id: "a", pending: true }), row({ run_id: "a", settled: false, pending: false, released: 402 })].join("\n"), "s", "0.0.0"), "0");
  assert.equal(sessionSpent([row({ settled: true }), row({ settled: true }), row({ run_id: "b", pending: true })].join("\n"), "s", "0.0.0"), "3000000", "legacy rows without run_id each count");
});

test("only one purchase holds the lock; a dead owner's lock is taken over", () => {
  const dir = mkdtempSync(join(tmpdir(), "rooted-lock-")), file = join(dir, "lock");
  assert.equal(acquireLock(file), true);
  assert.equal(acquireLock(file), false, "this process still holds it");
  const dead = spawnSync(process.execPath, ["-e", "console.log(process.pid)"]).stdout.toString().trim();
  writeFileSync(file, dead);
  assert.equal(acquireLock(file), true);
});
