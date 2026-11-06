// data/evidence.json must equal the repo's own demo evidence files it was copied from (bento: profiler, frame, providers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const j = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const { profile, frame, providers } = j("../data/evidence.json");

test("profiler figures are the median sample of demo/profiler/profile.json", () => {
  const pr = j("../../demo/profiler/profile.json").data;
  const m = pr.metrics;
  const med = m.samples.find((s) => s.apply_ns === m.median_apply_ns);
  assert.equal(profile.block_number, parseInt(pr.block_number, 16));
  assert.equal(profile.tx_count, m.transaction_count);
  assert.equal(profile.samples, m.samples.length);
  for (const k of ["apply_ns", "evm_call_ns", "state_inside_evm_ns", "state_access_ns"]) assert.equal(profile[k], med[k], k);
  assert.equal(profile.control_median_ns, m.control_median_ns);
  assert.equal(profile.captured_at.slice(0, 19), pr.captured_at.slice(0, 19));
});

test("frame mempool figures match demo/phase4/reference/existing-included.json", () => {
  const fr = j("../../demo/phase4/reference/existing-included.json");
  const c = fr.admission.checks;
  assert.equal(frame.tx_hash, fr.tx_hash);
  assert.equal(frame.frames, fr.admission.frames.length);
  assert.deepEqual(frame.checks, c.slice(0, frame.checks.length).map((x) => x.rule));
  assert.equal(frame.checks_total, c.length);
  assert.equal(frame.checks_passed, c.filter((x) => x.verdict === "pass").length);
  assert.deepEqual([frame.admitted_seq, frame.included_seq], fr.events.map((e) => e.seq));
  assert.equal(frame.admission_to_inclusion_ms, fr.admission_to_inclusion_ms);
  assert.equal(frame.receipt_type, fr.receipt_check.receipt.type);
  assert.equal(frame.receipt_block, parseInt(fr.receipt_check.receipt.blockNumber, 16));
  assert.equal(frame.canonical, fr.receipt_check.canonical);
});

test("provider diff matches demo/provider-comparison/live-report.json", () => {
  const pc = j("../../demo/provider-comparison/live-report.json").data;
  const keys = { "block hash": "hash", "parent hash": "parentHash", "state root": "stateRoot", "receipts root": "receiptsRoot", "BAL hash": "blockAccessListHash" };
  for (const o of pc.observations) {
    for (const f of providers.fields) assert.equal(f.value, o.header[keys[f.name]], `${o.provider} ${f.name}`);
    assert.equal(o.header.transactions.length, providers.tx_hashes);
    assert.equal(parseInt(o.header.number, 16), providers.block_number);
    assert.equal(parseInt(o.header.slotNumber, 16), providers.slot);
  }
  assert.deepEqual(pc.observations[0].header.transactions, pc.observations[1].header.transactions);
  const gap = pc.observations.flatMap((o) => o.checks.filter((x) => x.status !== "available").map((x) => [o.provider, x.method, x.status]));
  assert.deepEqual(gap, [["primary", providers.gap.method, "unsupported"]]);
});
