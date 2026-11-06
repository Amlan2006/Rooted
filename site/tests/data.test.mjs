// Data guards for site/data/*.json (spec: Honesty rule + Quality bar). Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const DIR = new URL("../data/", import.meta.url);
const FILES = ["hero-block.json", "blocks.json", "epbs.json", "pricing.json", "meta.json", "analyst.json", "analyst-hero.json", "evidence.json"];
const load = (f) => JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
const all = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const hash = /^0x[0-9a-f]{64}$/;

test("every spec data file exists and has source + captured_at", () => {
  for (const f of FILES) assert.ok(all.includes(f), `missing data/${f}`);
  for (const f of all) {
    const d = load(f);
    assert.equal(typeof d.source, "string", `${f}: source`);
    assert.ok(d.source.length > 10, `${f}: source too short`);
    assert.match(d.captured_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/, `${f}: captured_at not ISO UTC`);
    assert.ok(Date.parse(d.captured_at) <= Date.now(), `${f}: captured_at in the future`);
  }
});

test("no file contains placeholder values", () => {
  const bad = /lorem|ipsum|placeholder|\btodo\b|\btbd\b|\bfixme\b|changeme|example\.(com|org)|xxx|^0x0+$|^0\.0\.0{2,}$/i;
  const walk = (v, at) => {
    if (typeof v === "string") assert.doesNotMatch(v, bad, at);
    else if (typeof v === "number") assert.ok(Number.isSafeInteger(v) || (Number.isFinite(v) && !Number.isInteger(v)), `${at}: ${v} is not exact`);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  for (const f of all) walk(load(f), f);
});

test("hero block figures match the spec", () => {
  const h = load("hero-block.json");
  assert.equal(h.number, 12075273);
  assert.match(h.hash, hash);
  assert.equal(h.header_gas_used, 92173320);
  assert.equal(h.receipts_gas_sum, 155156084);
  assert.equal(h.tx_count, h.txs.length);
  assert.equal(h.txs.reduce((s, t) => s + t.gas_used, 0), h.receipts_gas_sum, "txs do not sum to receipts_gas_sum");
  h.txs.forEach((t, i) => assert.equal(t.index, i, "txs not sorted by index"));
  const cap = h.txs.reduce((a, t) => (t.gas_used > a.gas_used ? t : a));
  assert.equal(cap.index, 72);
  assert.equal(cap.gas_used, 55719446);
  assert.equal(cap.is_create, true);
  assert.deepEqual(h.capping_tx, cap);
});

test("hero block access list: checked against the header, one count per BAL index", () => {
  const { access_list: a, tx_count } = load("hero-block.json");
  assert.equal(a.commitment_matches, true);
  assert.match(a.source, /execution_payload_envelopes/);
  for (const k of ["accounts_changed", "slots_written"]) {
    assert.equal(a.per_index[k].length, tx_count + 2, `${k}: one entry per index 0..n+1`);
    assert.ok(a.per_index[k].every((v) => Number.isInteger(v) && v >= 0), k);
  }
  assert.equal(a.per_index.slots_written.reduce((s, v) => s + v, 0), a.storage_writes);
  assert.ok(a.accounts_read_only < a.accounts && Math.max(...a.per_index.accounts_changed) <= a.accounts);
});

test("blocks.json: 24 consecutive, parent-linked blocks with honest PTC tallies", () => {
  const { blocks, ptc_size } = load("blocks.json");
  assert.equal(blocks.length, 24);
  assert.equal(ptc_size, 512);
  blocks.forEach((b, i) => {
    assert.match(b.hash, hash);
    assert.ok(b.receipts_gas_sum >= 0 && b.header_gas_used <= b.gas_limit);
    if (i) {
      assert.equal(b.number, blocks[i - 1].number + 1, "not consecutive");
      assert.equal(b.parent_hash, blocks[i - 1].hash, "not parent-linked");
      assert.ok(b.slot > blocks[i - 1].slot, "slots not increasing");
    }
    assert.ok(b.payload_present_votes === null || (b.payload_present_votes >= 0 && b.payload_present_votes <= b.ptc_size));
    assert.ok(b.builder_index === null ? b.self_build !== false : b.self_build === false);
  });
});

test("epbs.json: one slot measured live and labelled as local receipt", () => {
  const e = load("epbs.json");
  assert.match(e.label, /received at our node/i);
  assert.equal(Date.parse(e.slot_start), (e.genesis_time + e.slot * 12) * 1000, "slot_start != genesis + slot*12s");
  for (const k of ["block", "execution_payload", "execution_payload_available"])
    assert.ok(Number.isInteger(e.offsets_ms[k]) && e.offsets_ms[k] > -12000 && e.offsets_ms[k] < 24000, `offsets_ms.${k}`);
  assert.ok(Date.parse(e.captured_at) >= Date.parse(e.slot_start), "offsets captured before the slot started");
  assert.equal(e.included_ptc.slot, e.slot + 1);
  assert.ok(e.included_ptc.payload_present_votes >= 0 && e.included_ptc.payload_present_votes <= e.included_ptc.ptc_size);
  assert.ok(e.ptc_messages_received >= e.ptc_messages_payload_present);
});

test("pricing.json: a real x402 price or an explicit null", () => {
  const p = load("pricing.json");
  if (p.price === null) return;
  assert.match(p.price.amount_atomic, /^[1-9]\d*$/);
  assert.match(p.network, /^hedera:/);
  assert.equal(p.testnet, p.network.endsWith(":testnet"));
  assert.match(p.source, / on main @ [0-9a-f]{7,}/, "pricing must be read from main");
  const paid = p.stored_report;
  assert.match(paid.block_hash, hash);
  assert.match(paid.payment_tx, /^0\.0\.\d+@\d+\.\d+$/, "the agent example must name a real Hedera payment");
  assert.match(paid.hcs_topic, /^0\.0\.\d+$/);
  assert.equal(paid.amount_atomic, p.price.amount_atomic, "paid amount differs from the price shown");
  assert.match(paid.source, /payment SUCCESS/);
});

test("meta.json: MIT, real repo, docs links on main", () => {
  const m = load("meta.json");
  assert.equal(m.license, "MIT");
  assert.equal(m.repo_url, "https://github.com/Amlan2006/Rooted");
  assert.ok(m.docs.length > 0);
  for (const d of m.docs) assert.equal(d.url, `${m.repo_url}/blob/main/${d.path}`);
});
