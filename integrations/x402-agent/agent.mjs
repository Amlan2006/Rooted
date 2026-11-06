#!/usr/bin/env node
// Paying agent: buys one Rooted Glamsterdam X-ray report over x402, settled on Hedera testnet, with no human approval.
// Usage: node agent.mjs [BLOCK_HASH]   (exit 0 paid, 1 error, 2 config, 3 refused by spend controls)
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner } from "@x402/hedera";
import { Client, PrivateKey, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { decide, limitsFrom, sessionSpent } from "./spend.mjs";

const envFile = new URL(".env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile); // shell variables win, so MAX_PER_REQUEST=1 forces a refusal
const env = process.env, runsDir = new URL("../../.tools/x402-agent/", import.meta.url), runsFile = new URL("runs.jsonl", runsDir);
const die = (code, message) => { console.error(message); process.exit(code); };
const refuse = (d) => { console.log(JSON.stringify({ refused: true, reason: d.reason, amount: d.amount, budget_left: d.budget_left })); process.exit(3); };

let limits, key;
try {
  limits = limitsFrom(env);
  if (!/^0\.0\.[1-9]\d*$/.test(env.AGENT_ID ?? "")) throw Error("AGENT_ID is missing; run node setup.mjs first");
  key = PrivateKey.fromStringECDSA(env.AGENT_KEY ?? "");
} catch (e) { die(2, `config: ${e.message}`); }
const base = new URL(env.ROOTED_PUBLIC_URL || "http://127.0.0.1:3000");
const session = env.ROOTED_AGENT_SESSION || new Date().toISOString().slice(0, 10); // default: a daily budget
const state = { spent: sessionSpent(existsSync(runsFile) ? readFileSync(runsFile, "utf8") : "", session, limits.asset) };

let hash = process.argv[2];
if (!hash) { // newest stored report from the free list route
  const list = await fetch(new URL("/api/backend/api/v1/xray/blocks?network=sepolia&limit=1", base)).then((r) => r.json()).catch(() => null);
  hash = list?.data?.[0]?.block_hash;
}
if (!/^0x[0-9a-f]{64}$/.test(hash ?? "")) die(2, "usage: node agent.mjs 0x<lowercase 32-byte block hash> (no stored report found to default to)");

// Spend controls: the decision runs on the full 402 offer before any payload is signed, so every refusal is
// explained; the library allowlist/cap and the payTo policy re-check the same limits as a backstop.
let refusal, signed;
const client = new x402Client()
  .register("hedera:testnet", new ExactHederaScheme(createClientHederaSigner(env.AGENT_ID, key, { network: "hedera:testnet" })))
  .setSpendControls({ allowedAssets: [{ network: limits.network, asset: limits.asset, maxAmountPerPayment: limits.maxPerRequest }] })
  .registerPolicy((_version, offers) => offers.filter((r) => r.payTo === limits.payTo))
  .onAfterPaymentCreation(async ({ paymentPayload }) => { signed = paymentPayload.accepted; });
const http = new x402HTTPClient(client).onPaymentRequired(async ({ paymentRequired }) => {
  const decisions = (paymentRequired.accepts ?? []).map((r) => decide(r, state, limits));
  if (decisions.some((d) => !d.refused)) return;
  refusal = decisions[0] ?? { reason: "no_offer", amount: "", budget_left: "" };
  throw Error(refusal.reason);
});

const url = new URL(`/api/paid/xray/${hash}`, base);
let response;
try { response = await wrapFetchWithPayment(fetch, http)(url); }
catch (e) {
  if (refusal) refuse(refusal);
  if (/spendControls|filtered out by policies/.test(e.message)) refuse({ reason: "client_spend_controls", amount: "", budget_left: "" });
  die(1, `request failed: ${e.message}`);
}
const body = await response.text(), header = response.headers.get("PAYMENT-RESPONSE");
const settle = header ? decodePaymentResponseHeader(header) : null;
const txId = settle?.transaction ?? "", hashscan = `https://hashscan.io/testnet/transaction/${txId}`;
const sha = createHash("sha256").update(body).digest("hex");
if (settle?.success && signed) { // log the spend first: the budget must count money that moved even if anything below fails
  mkdirSync(runsDir, { recursive: true });
  appendFileSync(runsFile, JSON.stringify({ at: new Date().toISOString(), session, block_hash: hash, url: url.href, network: signed.network,
    asset: signed.asset, amount: signed.amount, pay_to: signed.payTo, payer: settle.payer ?? env.AGENT_ID, settled: true, transaction: txId,
    hashscan, report_sha256: sha }) + "\n");
}
if (response.status !== 200 || !settle?.success) die(1, JSON.stringify({ ok: false, status: response.status, settle, body: body.slice(0, 400) }));

const report = JSON.parse(body).data;
if (report?.schema !== "rooted-xray-v1" || report.block?.hash !== hash) die(1, `paid ${txId} but the body is not the X-ray report for ${hash}`);
console.log(`paid ${signed.amount} ${signed.asset === "0.0.0" ? "tinybar" : signed.asset} to ${signed.payTo} for block ${report.block.number} ${hash}`);
console.log(`settled ${txId}`);
console.log(hashscan);

// Independent check on the public mirror node (the facilitator's word is not the evidence).
const mirrorId = txId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
for (let i = 0; i < 10; i++) {
  const t = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/transactions/${mirrorId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (t?.transactions?.[0]) { console.log(`mirror ${t.transactions[0].result} consensus ${t.transactions[0].consensus_timestamp}`); break; }
  await new Promise((r) => setTimeout(r, 2000));
}

const c = report.ceilings ?? {}, x = (v) => (typeof v === "number" ? `${v.toFixed(2)}x` : "unknown");
console.log(`finding: gas-weighted ${x(c.gas_weighted?.value)} (capped by tx ${c.gas_weighted?.capping_tx_index}), validator with BAL ${x(c.validator_bal_time?.value)} (tx ${c.validator_bal_time?.capping_tx_index ?? "?"}), builder/no-BAL ${x(c.builder_dag_time?.value)} (critical path ${c.builder_dag_time?.critical_path?.length ?? "?"} txs); all upper bounds`);

if (env.ROOTED_AGENT_HCS_TOPIC) { // optional audit log; the payment already happened, so a failure here only warns
  const hedera = Client.forTestnet().setOperator(env.AGENT_ID, key);
  try {
    const message = JSON.stringify({ block_hash: hash, report_sha256: sha, payment_tx: txId, amount: signed.amount, asset: signed.asset });
    const receipt = await (await new TopicMessageSubmitTransaction({ topicId: env.ROOTED_AGENT_HCS_TOPIC, message }).execute(hedera)).getReceipt(hedera);
    console.log(`hcs audit ${env.ROOTED_AGENT_HCS_TOPIC} seq ${receipt.topicSequenceNumber} https://hashscan.io/testnet/topic/${env.ROOTED_AGENT_HCS_TOPIC}`);
  } catch (e) { console.error(`hcs audit failed: ${e.message}`); }
  hedera.close();
}
process.exit(0); // the SDK keeps gRPC channels open
