import { test } from "node:test";
import assert from "node:assert/strict";
import { num, gasM, shortHash, ms, sourceLine } from "../lib/format.ts";

test("format helpers", () => {
  assert.equal(num(12075273), "12,075,273");
  assert.equal(gasM(55719446), "55.72M");
  assert.equal(gasM(92173320), "92.17M");
  assert.equal(shortHash("0x" + "ab12".repeat(16)), "0xab12…ab12");
  assert.equal(shortHash("0x1234"), "0x1234");
  assert.equal(ms(1204.4), "1,204 ms");
  assert.equal(sourceLine({ source: "Sepolia block 12,075,273", captured_at: "2026-11-06T10:00:00Z" }), "Sepolia block 12,075,273 · captured 2026-11-06");
  assert.equal(sourceLine({ source: "pending snapshot", captured_at: null }), "pending snapshot");
});
