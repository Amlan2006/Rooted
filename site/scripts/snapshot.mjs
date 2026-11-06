#!/usr/bin/env node
// Writes site/data/*.json from Rooted's own Sepolia node (Geth + Nimbus) and the repo. Node 24, no dependencies.
// ROOTED_EXECUTION_URL / ROOTED_BEACON_URL override the node; fails loudly rather than writing a guessed value.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const EL = process.env.ROOTED_EXECUTION_URL || "http://127.0.0.1:18545";
const CL = (process.env.ROOTED_BEACON_URL || "http://127.0.0.1:15052").replace(/\/$/, "");
const DATA = new URL("../data/", import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const GITHUB = "https://github.com/Amlan2006/Rooted";
const HERO = { number: 12075273, header_gas_used: 92173320, receipts_gas_sum: 155156084, capping_index: 72 };
const TAPE = 24, WATCH_MS = 120_000;
const NODE = "Rooted’s Sepolia node";
const MIRROR = "https://testnet.mirrornode.hedera.com";

const num = (hex) => Number(BigInt(hex));
const now = () => new Date().toISOString();
const git = (...args) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" });
const popcount = (b) => b.toString(2).replaceAll("0", "").length;
// BUILDER_INDEX_SELF_BUILD (UINT64_MAX, Gloas): the proposer built its own payload; too big for a JS number.
const builder = (idx) => (idx === "18446744073709551615" ? { builder_index: null, self_build: true } : { builder_index: +idx, self_build: false });

// Keccak-256 (Ethereum's, not NIST SHA3; Node's OpenSSL has no keccak), to check a BAL against its header commitment.
const M64 = (1n << 64n) - 1n;
const RC = ["1", "8082", "800000000000808a", "8000000080008000", "808b", "80000001", "8000000080008081", "8000000000008009",
  "8a", "88", "80008009", "8000000a", "8000808b", "800000000000008b", "8000000000008089", "8000000000008003",
  "8000000000008002", "8000000000000080", "800a", "800000008000000a", "8000000080008081", "8000000000008080",
  "80000001", "8000000080008008"].map((h) => BigInt("0x" + h));
const rotl = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64;
function keccak256(bytes) {
  const s = Array(25).fill(0n), p = Buffer.alloc((Math.floor(bytes.length / 136) + 1) * 136);
  bytes.copy(p);
  p[bytes.length] ^= 1;
  p[p.length - 1] ^= 0x80;
  for (let o = 0; o < p.length; o += 136) {
    for (let i = 0; i < 17; i++) s[i] ^= p.readBigUInt64LE(o + 8 * i);
    for (const rc of RC) {
      const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 25; y += 5) s[y + x] ^= c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let t = 0, x = 1, y = 0, cur = s[1]; t < 24; t++) {
        [x, y] = [y, (2 * x + 3 * y) % 5];
        [cur, s[x + 5 * y]] = [s[x + 5 * y], rotl(cur, (((t + 1) * (t + 2)) / 2) % 64)];
      }
      for (let y = 0; y < 25; y += 5) {
        const r = s.slice(y, y + 5);
        for (let x = 0; x < 5; x++) s[y + x] = r[x] ^ (~r[(x + 1) % 5] & M64 & r[(x + 2) % 5]);
      }
      s[0] ^= rc;
    }
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(s[i], 8 * i);
  return "0x" + out.toString("hex");
}
assert.equal(keccak256(Buffer.alloc(0)), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", "keccak256 self-check");
assert.equal(keccak256(Buffer.alloc(200, 0x61)), "0x96ea54061def936c4be90b518992fdc6f12f535068a256229aca54267b4d084d", "keccak256 two-block self-check");

// Minimal RLP reader: an item is a Buffer (string) or an array of items (list).
function rlp(buf) {
  const read = (o) => {
    const p = buf[o];
    if (p < 0x80) return [buf.subarray(o, o + 1), o + 1];
    const long = p >= 0xf8 || (p >= 0xb8 && p < 0xc0), base = p >= 0xc0 ? (long ? 0xf7 : 0xc0) : long ? 0xb7 : 0x80;
    const ll = long ? p - base : 0, len = long ? buf.readUIntBE(o + 1, ll) : p - base, start = o + 1 + ll, end = start + len;
    assert.ok(end <= buf.length, "RLP item overruns its buffer");
    if (p < 0xc0) return [buf.subarray(start, end), end];
    const items = [];
    for (let i = start; i < end; ) { const [item, next] = read(i); items.push(item); i = next; }
    return [items, end];
  };
  const [item, end] = read(0);
  assert.equal(end, buf.length, "trailing bytes after RLP");
  return item;
}
const rlpInt = (b) => b.reduce((n, x) => n * 256 + x, 0);

async function rpc(method, ...params) {
  const res = await fetch(EL, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
  const body = await res.json();
  if (body.error || body.result == null) throw Error(`${method}(${JSON.stringify(params)}): ${body.error?.message ?? "null result"}`);
  return body.result;
}

// Returns null on 404: the slot was missed or the node no longer retains it.
async function cl(path) {
  const res = await fetch(CL + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw Error(`GET ${CL}${path}: HTTP ${res.status}`);
  return (await res.json()).data;
}

const spec = await cl("/eth/v1/config/spec");
const PTC_SIZE = +spec.PTC_SIZE, SLOT_MS = +(spec.SLOT_DURATION_MS ?? spec.SECONDS_PER_SLOT * 1000);
const GENESIS_MS = +(await cl("/eth/v1/beacon/genesis")).genesis_time * 1000;
const slotStart = (slot) => GENESIS_MS + slot * SLOT_MS;
assert.equal(PTC_SIZE, 512, "unexpected PTC_SIZE");

// Union of payload_present=true PTC votes for (slot, root) carried in a later beacon block.
function presentVotes(block, slot, root) {
  const bits = new Uint8Array(PTC_SIZE / 8);
  for (const pa of block.message.body.payload_attestations) {
    if (!pa.data.payload_present || pa.data.beacon_block_root !== root || +pa.data.slot !== slot) continue;
    const agg = Buffer.from(pa.aggregation_bits.slice(2), "hex");
    assert.equal(agg.length, bits.length, `slot ${block.message.slot}: aggregation_bits is not a ${PTC_SIZE}-bit vector`);
    agg.forEach((b, i) => (bits[i] |= b));
  }
  return bits.reduce((n, b) => n + popcount(b), 0);
}

// slot comes from the execution header's slotNumber (Glamsterdam); everything else from Nimbus.
async function beaconFacts(el) {
  assert.ok(el.slotNumber, `block ${num(el.number)} has no slotNumber`);
  const slot = num(el.slotNumber);
  const none = { slot, beacon_root: null, proposer_index: null, builder_index: null, self_build: null,
    payload_present_votes: null, ptc_size: PTC_SIZE };
  const blk = await cl(`/eth/v2/beacon/blocks/${slot}`);
  if (!blk) return none;
  const bid = blk.message.body.signed_execution_payload_bid.message;
  assert.equal(bid.block_hash, el.hash, `slot ${slot}: bid commits to a different payload`);
  const { root } = await cl(`/eth/v1/beacon/blocks/${slot}/root`);
  // PTC votes for slot N are only includable in the block at N+1; a missed N+1 means no tally (null).
  const next = await cl(`/eth/v2/beacon/blocks/${slot + 1}`);
  return { ...none, beacon_root: root, proposer_index: +blk.message.proposer_index, ...builder(bid.builder_index),
    payload_present_votes: next ? presentVotes(next, slot, root) : null };
}

async function execBlock(number) {
  const b = await rpc("eth_getBlockByNumber", "0x" + number.toString(16), false);
  const receipts = await rpc("eth_getBlockReceipts", b.hash);
  assert.equal(receipts.length, b.transactions.length, `block ${number}: receipt count`);
  return { b, receipts, receipts_gas_sum: receipts.reduce((s, r) => s + num(r.gasUsed), 0) };
}

const header = (b, receipts_gas_sum) => ({ number: num(b.number), hash: b.hash, parent_hash: b.parentHash,
  tx_count: b.transactions.length, gas_limit: num(b.gasLimit), header_gas_used: num(b.gasUsed), receipts_gas_sum });

// EIP-7928 list from the ePBS payload envelope, checked against the header commitment, counted per BAL index
// (0 pre-execution, 1..n transactions, n+1 post-execution). Reads carry no index, so they are block totals.
async function accessList(el, slot) {
  const path = `/eth/v1/beacon/execution_payload_envelopes/${slot}`;
  const env = await cl(path);
  assert.ok(env, `${path}: envelope not retained`);
  const payload = env.message.payload;
  assert.equal(payload.block_hash, el.hash, `${path}: envelope is for another block`);
  const raw = Buffer.from(payload.block_access_list.slice(2), "hex");
  assert.equal(keccak256(raw), el.blockAccessListHash, `${path}: BAL does not hash to blockAccessListHash`);
  const n = el.transactions.length, accounts = Array(n + 2).fill(0), slots = Array(n + 2).fill(0);
  const list = rlp(raw);
  let readOnly = 0, reads = 0;
  for (const [address, storage, storageReads, ...changes] of list) {
    assert.equal(address.length, 20, "BAL address");
    const touched = new Set();
    for (const [, writes] of storage) for (const [i] of writes) (slots[rlpInt(i)]++, touched.add(rlpInt(i)));
    for (const list of changes) for (const [i] of list) touched.add(rlpInt(i));
    for (const i of touched) accounts[i]++;
    reads += storageReads.length;
    readOnly += touched.size === 0;
  }
  assert.ok(accounts.length === n + 2 && slots.length === n + 2, "BAL index beyond n+1");
  return { source: `Nimbus ${path} on ${NODE}; keccak256 of the list matches the header’s blockAccessListHash`,
    captured_at: now(), bytes: raw.length, accounts: list.length, accounts_read_only: readOnly, storage_reads: reads,
    storage_writes: slots.reduce((a, b) => a + b, 0), commitment_matches: true,
    per_index: { accounts_changed: accounts, slots_written: slots } };
}

async function heroBlock() {
  const { b, receipts, receipts_gas_sum } = await execBlock(HERO.number);
  const txs = receipts.map((r) => ({ index: num(r.transactionIndex), hash: r.transactionHash,
    gas_used: num(r.gasUsed), is_create: r.contractAddress != null, to: r.to }));
  const capping = txs.reduce((a, t) => (t.gas_used > a.gas_used ? t : a));
  assert.equal(num(b.gasUsed), HERO.header_gas_used, "hero header gas_used changed");
  assert.equal(receipts_gas_sum, HERO.receipts_gas_sum, "hero receipts gas sum changed");
  assert.equal(capping.index, HERO.capping_index, "hero capping tx index changed");
  const extra = Buffer.from(b.extraData.slice(2), "hex").toString("latin1");
  return { source: `Geth eth_getBlockByNumber + eth_getBlockReceipts, Nimbus /eth/v2/beacon/blocks on ${NODE}`,
    captured_at: now(), network: "sepolia", ...header(b, receipts_gas_sum),
    timestamp: num(b.timestamp), time: new Date(num(b.timestamp) * 1000).toISOString(),
    base_fee_per_gas: num(b.baseFeePerGas), block_access_list_hash: b.blockAccessListHash ?? null,
    extra_data_text: /^[\x20-\x7e]+$/.test(extra) ? extra : null,
    ...(await beaconFacts(b)), capping_tx: capping, txs, access_list: await accessList(b, num(b.slotNumber)) };
}

async function tape() {
  const head = num(await rpc("eth_blockNumber"));
  const end = head - 1; // one behind head, so every block's next slot has already carried (or missed) its PTC tally
  const rows = await Promise.all(Array.from({ length: TAPE }, async (_, i) => {
    const { b, receipts_gas_sum } = await execBlock(end - TAPE + 1 + i);
    return { ...header(b, receipts_gas_sum), ...(await beaconFacts(b)) };
  }));
  rows.forEach((r, i) => i && assert.equal(r.parent_hash, rows[i - 1].hash, `reorg during capture at ${r.number}`));
  return { source: `Geth eth_getBlockByNumber + eth_getBlockReceipts, Nimbus /eth/v2/beacon/blocks (slot and slot+1) on ${NODE}`,
    captured_at: now(), network: "sepolia", head_at_capture: head, from: rows[0].number, to: rows.at(-1).number,
    ptc_size: PTC_SIZE, note: "payload_present_votes: union of payload_present=true PTC bits for this block's beacon root in the next slot's block; null when that slot was missed or the beacon block is not retained.",
    blocks: rows };
}

// Watches the SSE stream until a slot we saw from its start has block + execution_payload + execution_payload_available
// and the next slot's block has arrived (its PTC window is closed).
async function watchSlot() {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), WATCH_MS);
  const topics = "block,execution_payload,execution_payload_available,payload_attestation_message";
  const seen = new Map(), at = (s) => seen.get(s) ?? seen.set(s, { ptc: [] }).get(s);
  try {
    const res = await fetch(`${CL}/eth/v1/events?topics=${topics}`, { headers: { accept: "text/event-stream" }, signal: ac.signal });
    if (!res.ok) throw Error(`SSE ${res.status}`);
    const opened = Date.now();
    let buf = "";
    for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
      const t = Date.now();
      buf += chunk.replaceAll("\r", "");
      for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
        const frame = buf.slice(0, i), type = frame.match(/^event:\s*(.+)$/m)?.[1], data = frame.match(/^data:\s*(.+)$/m)?.[1];
        if (!type || !data) continue;
        const d = JSON.parse(data);
        if (type === "payload_attestation_message") {
          const m = d.data ?? d;
          at(+m.data.slot).ptc.push({ t, root: m.data.beacon_block_root, present: m.data.payload_present, validator: m.validator_index });
          continue;
        }
        const s = at(+d.slot);
        s[type] ??= { t, ...d }; // first receipt wins
        const p = type === "block" && seen.get(+d.slot - 1), root = p?.block?.block;
        if (root && slotStart(+d.slot - 1) >= opened && p.execution_payload?.block_root === root
          && p.execution_payload_available?.block_root === root) return { slot: +d.slot - 1, ...p };
      }
    }
  } catch (e) {
    if (!ac.signal.aborted) throw e;
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  throw Error(`no slot completed block + payload + next block within ${WATCH_MS / 1000}s`);
}

async function epbs() {
  const w = await watchSlot(), start = slotStart(w.slot), off = (t) => t - start, root = w.block.block;
  const ptc = w.ptc.filter((m) => m.root === root).sort((a, b) => a.t - b.t);
  const next = await cl(`/eth/v2/beacon/blocks/${w.slot + 1}`);
  assert.ok(next, `slot ${w.slot + 1} block event seen but block not served`);
  const el = await rpc("eth_getBlockByHash", w.execution_payload.block_hash, false);
  const due = (k) => (spec[k] == null ? null : (+spec[k] * SLOT_MS) / 10_000);
  return { source: `Nimbus /eth/v1/events (block, execution_payload, execution_payload_available, payload_attestation_message) on ${NODE}; included tally from /eth/v2/beacon/blocks/${w.slot + 1}; deadlines from /eth/v1/config/spec`,
    captured_at: now(), network: "sepolia",
    label: "Received at our node: local receipt time in ms after slot start (genesis_time + slot × 12 s), by our system clock. Not network-wide propagation.",
    slot: w.slot, slot_start: new Date(start).toISOString(), genesis_time: GENESIS_MS / 1000,
    beacon_root: root, block_hash: w.execution_payload.block_hash, block_number: num(el.number), tx_count: el.transactions.length,
    ...builder(w.execution_payload.builder_index),
    offsets_ms: { block: off(w.block.t), execution_payload: off(w.execution_payload.t),
      execution_payload_available: off(w.execution_payload_available.t),
      first_ptc_message: ptc.length ? off(ptc[0].t) : null, last_ptc_message: ptc.length ? off(ptc.at(-1).t) : null },
    deadlines_ms: { attestation: due("ATTESTATION_DUE_BPS_GLOAS"), payload: due("PAYLOAD_DUE_BPS"),
      payload_attestation: due("PAYLOAD_ATTESTATION_DUE_BPS"), source: "Nimbus /eth/v1/config/spec (*_DUE_BPS × SLOT_DURATION_MS)" },
    ptc_messages_received: ptc.length, ptc_validators_seen: new Set(ptc.map((m) => m.validator)).size,
    ptc_messages_payload_present: ptc.filter((m) => m.present).length,
    ptc_note: "PTC messages for this slot's beacon root that our node received over gossip before the next slot's block arrived.",
    included_ptc: { slot: w.slot + 1, payload_present_votes: presentVotes(next, w.slot, root), ptc_size: PTC_SIZE } };
}

async function pricing() {
  const commit = git("rev-parse", "--short", "main").trim(), src = `dashboard/lib/x402.ts on main @ ${commit}`;
  const empty = { source: `${src} (not found)`, captured_at: now(), price: null, network: null, asset: null };
  let code;
  try { code = git("show", "main:dashboard/lib/x402.ts"); } catch { return empty; }
  const m = (re) => code.match(re)?.[1] ?? null;
  const amount = m(/ROOTED_X402_PRICE_ATOMIC \|\| "(\d+)"/), asset = m(/ROOTED_X402_HEDERA_ASSET \|\| "([\d.]+)"/);
  const network = m(/network: "([^"]+)"/), scheme = m(/scheme: "([^"]+)"/), route = m(/PAID_ROUTE = "([^"]+)"/);
  if (!amount || !asset || !network) return empty;
  const hbar = asset === "0.0.0"; // HBAR has 8 decimals (1 HBAR = 100,000,000 tinybars)
  return { source: `${src} (code defaults; an operator can override them)`, captured_at: now(),
    price: { amount_atomic: amount, display: hbar ? `${+amount / 1e8} HBAR` : null, unit: "per block report" },
    network, testnet: network.endsWith(":testnet"), asset, asset_symbol: hbar ? "HBAR" : null, scheme, route,
    configurable_via: "ROOTED_X402_PRICE_ATOMIC", stored_report: await paidCall(network) };
}

// The agent example shows a call that was really paid: message 1 on the README's HCS audit topic, which the agent
// writes after each settlement. The ledger, not the doc, confirms it: the transfer must be SUCCESS on the mirror node.
async function paidCall(network) {
  assert.equal(network, "hedera:testnet", "the audit topic lives on Hedera testnet");
  const topic = git("show", "main:README.md").match(/HCS topic \[`(0\.0\.\d+)`\]/)[1], seq = 1;
  const get = async (path) => {
    const res = await fetch(MIRROR + path, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw Error(`GET ${MIRROR}${path}: HTTP ${res.status}`);
    return res.json();
  };
  const msg = JSON.parse(Buffer.from((await get(`/api/v1/topics/${topic}/messages/${seq}`)).message, "base64").toString());
  assert.match(msg.payment_tx, /^0\.0\.\d+@\d+\.\d+$/, "HCS message has no payment_tx");
  const [tx] = (await get(`/api/v1/transactions/${msg.payment_tx.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`)).transactions;
  assert.equal(tx.result, "SUCCESS", `payment ${msg.payment_tx} did not settle`);
  const block = await rpc("eth_getBlockByHash", msg.block_hash, false);
  return { block_number: num(block.number), block_hash: block.hash, payment_tx: msg.payment_tx, amount_atomic: msg.amount,
    hcs_topic: topic, hcs_sequence: seq,
    source: `HCS topic ${topic} message ${seq}, payment ${tx.result} (Hedera testnet mirror node); block number from Geth` };
}

function meta() {
  const readme = git("show", "main:README.md");
  const files = git("ls-tree", "--name-only", "main", "README.md", "docs/").split("\n").filter((f) => f.endsWith(".md"));
  assert.ok(git("show", "main:LICENSE").startsWith("MIT License"), "LICENSE is not MIT");
  return { source: "git branch main of this repo (LICENSE, go.mod, README.md, docs/)", captured_at: now(),
    commit: git("rev-parse", "--short", "main").trim(), license: "MIT", repo_url: GITHUB,
    go_version: git("show", "main:go.mod").match(/^go (\S+)/m)[1], node_version: readme.match(/Node (\d+)/)[1],
    built_at: readme.match(/Built at ([^\n·]+)/)?.[1].trim() ?? null,
    docs: files.map((path) => ({ path, title: git("show", `main:${path}`).match(/^#\s+(.+)$/m)?.[1] ?? path,
      url: `${GITHUB}/blob/main/${path}` })) };
}

await mkdir(DATA, { recursive: true });
// `npm run snapshot -- pricing.json` refreshes only the named files; no arguments writes all of them.
const only = process.argv.slice(2);
const write = async (name, make) => {
  if (only.length && !only.includes(name)) return;
  if (name === "epbs.json") console.log(`watching ${CL}/eth/v1/events for up to ${WATCH_MS / 1000}s...`);
  await writeFile(new URL(name, DATA), JSON.stringify(await make(), null, 2) + "\n");
  console.log(`wrote data/${name}`);
};
await write("pricing.json", pricing);
await write("meta.json", meta);
await write("hero-block.json", heroBlock);
await write("blocks.json", tape);
await write("epbs.json", epbs);
