#!/usr/bin/env node
// Writes site/data/analyst.json: one stored Rooted Analyst brief and its Hedera trail (the HCS message that anchors the
// brief's sha256, and the x402 purchase of the report it cites). Node 24, no dependencies, no Claude calls.
// ROOTED_DASHBOARD_URL: a Rooted dashboard whose GET /api/analyst/briefs answers (public). BRIEF_BLOCK picks the brief.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const DASH = process.env.ROOTED_DASHBOARD_URL?.replace(/\/$/, "");
const BLOCK = Number(process.env.BRIEF_BLOCK || 12077198);
const MIRROR = "https://testnet.mirrornode.hedera.com";
const TOPIC = "0.0.11338138"; // README: every paid call (and every auto-brief hash) is logged to this HCS topic
// Evidence kind -> the tool whose executor emits it (dashboard/lib/analyst/tools.ts).
const TOOL = { xray: "get_block_xray", xray_run: "run_block_xray", summary: "xray_summary", blocks: "recent_blocks",
  epbs_slot: "epbs_slot", builders: "builders", alerts: "alerts", frame_node: "frame_status", frame_conformance: "frame_conformance",
  frame_txs: "frame_transactions", provider_compare: "compare_providers", rpc: "node_read", payment: "buy_xray_report" };

assert(DASH, "set ROOTED_DASHBOARD_URL to a Rooted dashboard (its /api/analyst/briefs is public)");
const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  assert(r.ok, `${url}: HTTP ${r.status}`);
  return r.json();
};
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const iso = (consensus) => new Date(Math.round(parseFloat(consensus) * 1000)).toISOString();

const { data: briefs } = await get(`${DASH}/api/analyst/briefs`);
const b = briefs.find((x) => x.block_number === BLOCK);
assert(b, `no stored brief for block ${BLOCK}`);
const ids = new Set(b.evidence.map((e) => e.id));
for (const [, id] of b.brief.matchAll(/\[(E\d+)\]/g)) assert(ids.has(id), `brief cites ${id}, not in its evidence`);

const tools = [...(await readFile(new URL("../../dashboard/lib/analyst/tools.ts", import.meta.url), "utf8")).matchAll(/\{ name: "([a-z_]+)"/g)].map((m) => m[1]);
const steps = b.evidence.map((e) => {
  assert(TOOL[e.kind] && tools.includes(TOOL[e.kind]), `unknown evidence kind ${e.kind}`);
  const block_hash = new URLSearchParams(e.link?.split("?")[1]).get("block");
  return { tool: TOOL[e.kind], input: block_hash ? { block_hash } : {}, evidence: e.id, at: e.at };
});

// Every message on the topic (mirror pages are 100 long).
const messages = [];
for (let url = `/api/v1/topics/${TOPIC}/messages?limit=100&order=asc`; url; ) {
  const page = await get(MIRROR + url);
  for (const m of page.messages) messages.push({ ...JSON.parse(Buffer.from(m.message, "base64").toString()), sequence: m.sequence_number, consensus_at: iso(m.consensus_timestamp) });
  url = page.links?.next;
}
const brief_sha256 = sha256(b.brief);
const anchor = messages.find((m) => m.block_hash === b.block_hash && m.brief_sha256 === brief_sha256);
assert(anchor, `brief sha256 ${brief_sha256} is not on HCS ${TOPIC}`);
const sale = messages.find((m) => m.block_hash === b.block_hash && m.payment_tx && b.evidence.some((e) => e.sha256 === m.report_sha256));
assert(sale, "no x402 purchase of this brief's evidence on HCS");

const tx = (await get(`${MIRROR}/api/v1/transactions/${sale.payment_tx.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`)).transactions[0];
assert.equal(tx.result, "SUCCESS");
const amount = Number(sale.amount);
const to = tx.transfers.find((t) => t.amount === amount), from = tx.transfers.find((t) => t.amount === -amount);
assert(to && from, "transfer of the paid amount not found");

const out = {
  source: `Sepolia block ${BLOCK.toLocaleString("en-US")} brief + Hedera testnet mirror node`,
  captured_at: new Date().toISOString(),
  network: b.network,
  block_number: b.block_number,
  block_hash: b.block_hash,
  triggers: b.triggers,
  created_at: b.created_at,
  model: b.model,
  usd: b.usd,
  // The exact prompt dashboard/scripts/briefs.ts sends for a flagged block.
  question: `Write the brief for block ${b.block_number} (${b.block_hash}). Rules triggered: ${b.triggers.join(", ")}.`,
  question_source: "dashboard/scripts/briefs.ts",
  brief: b.brief,
  brief_sha256,
  steps,
  evidence: b.evidence,
  tools,
  hcs: { topic: TOPIC, sequence: anchor.sequence, consensus_at: anchor.consensus_at, brief_sha256 },
  payment: {
    tx_id: sale.payment_tx,
    result: tx.result,
    network: "hedera:testnet",
    amount_tinybars: amount,
    payer: from.account,
    pay_to: to.account,
    fee_payer: sale.payment_tx.split("@")[0],
    report_sha256: sale.report_sha256,
    consensus_at: iso(tx.consensus_timestamp),
    hcs_topic: TOPIC,
    hcs_sequence: sale.sequence,
  },
};
await writeFile(new URL("../data/analyst.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`analyst.json: block ${BLOCK}, HCS #${anchor.sequence}, x402 ${sale.payment_tx} (#${sale.sequence})`);
