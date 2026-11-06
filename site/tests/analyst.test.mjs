// Guard for data/analyst.json (written by `npm run snapshot:analyst`): one real brief whose citations, hashes and
// Hedera trail check out, so the Analyst section never shows a figure the snapshot cannot back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const a = JSON.parse(readFileSync(new URL("../data/analyst.json", import.meta.url), "utf8"));
const hash = /^0x[0-9a-f]{64}$/, sha = /^[0-9a-f]{64}$/;

test("analyst.json: sourced, one real brief for a real block", () => {
  assert.ok(a.source.length > 10);
  assert.match(a.captured_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
  assert.ok(a.brief.trim().length > 40, "brief is empty");
  assert.match(a.block_hash, hash);
  assert.ok(Number.isInteger(a.block_number) && a.block_number > 0);
  assert.ok(a.triggers.length > 0);
  assert.equal(a.question, `Write the brief for block ${a.block_number} (${a.block_hash}). Rules triggered: ${a.triggers.join(", ")}.`);
});

test("analyst.json: every cited evidence id exists, and every step is a real tool", () => {
  const ids = new Set(a.evidence.map((e) => e.id));
  const cited = [...a.brief.matchAll(/\[(E\d+)\]/g)].map((m) => m[1]);
  assert.ok(cited.length > 0, "brief cites nothing");
  for (const id of cited) assert.ok(ids.has(id), `brief cites ${id}, which is not in evidence`);
  for (const e of a.evidence) assert.match(e.sha256, sha, `${e.id}: sha256`);
  assert.ok(a.steps.length > 0);
  for (const s of a.steps) {
    assert.ok(a.tools.includes(s.tool), `${s.tool} is not an analyst tool`);
    assert.ok(ids.has(s.evidence), `${s.tool} -> ${s.evidence} missing`);
  }
});

test("analyst.json: the brief text is the one anchored on HCS, and the x402 sale is of its evidence", () => {
  const digest = createHash("sha256").update(a.brief).digest("hex");
  assert.equal(a.brief_sha256, digest, "brief text changed since it was hashed");
  assert.equal(a.hcs.brief_sha256, digest);
  assert.match(a.hcs.topic, /^0\.0\.\d+$/);
  const p = a.payment;
  assert.match(p.tx_id, /^0\.0\.\d+@\d+\.\d+$/);
  assert.equal(p.result, "SUCCESS");
  assert.equal(p.network, "hedera:testnet");
  assert.ok(Number.isSafeInteger(p.amount_tinybars) && p.amount_tinybars > 0);
  assert.ok(a.evidence.some((e) => e.sha256 === p.report_sha256), "paid report is not the cited evidence");
  assert.equal(p.hcs_topic, a.hcs.topic);
  assert.ok(Date.parse(p.consensus_at) > Date.parse(a.created_at), "payment ordering assumed by the UI");
});
