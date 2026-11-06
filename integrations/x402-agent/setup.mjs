#!/usr/bin/env node
// One-time Hedera testnet setup for the paying agent. Safe to re-run: each step is skipped once its value exists.
// Usage: node setup.mjs [--hcs] [--usdc]. Writes keys only to the gitignored .env next to this file; prints ids, never keys.
// Exit 0 done, 2 waiting for a human to fund the operator address.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AccountCreateTransaction, Client, Hbar, PrivateKey, TokenAssociateTransaction, TopicCreateTransaction } from "@hiero-ledger/sdk";

const agentEnv = new URL(".env", import.meta.url), dashboardEnv = new URL("../../dashboard/.env.local", import.meta.url);
const flags = new Set(process.argv.slice(2)), USDC = "0.0.429274", account = (id) => `https://hashscan.io/testnet/account/${id}`;
function upsert(file, key, value) {
  const lines = (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").filter((l, i, a) => l || i < a.length - 1);
  const at = lines.findIndex((l) => l.startsWith(`${key}=`));
  at >= 0 ? (lines[at] = `${key}=${value}`) : lines.push(`${key}=${value}`);
  writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  process.env[key] = value;
}
if (existsSync(agentEnv)) process.loadEnvFile(agentEnv);
const env = process.env;

// The SDK's parse error echoes the whole key, so a malformed key gets a fixed message instead.
const parseKey = (name) => { try { return PrivateKey.fromStringECDSA(env[name]); } catch { console.error(`${name} in integrations/x402-agent/.env is not a hex ECDSA private key`); process.exit(2); } };
if (!env.HEDERA_OPERATOR_KEY) upsert(agentEnv, "HEDERA_OPERATOR_KEY", PrivateKey.generateECDSA().toStringRaw());
const operatorKey = parseKey("HEDERA_OPERATOR_KEY");
if (!env.HEDERA_OPERATOR_ID) {
  // A faucet drip to the key's EVM address auto-creates the account (HIP-583); the mirror node maps it to 0.0.x.
  const evm = "0x" + operatorKey.publicKey.toEvmAddress();
  const found = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${evm}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!found?.account) {
    console.log(JSON.stringify({ waiting_for_funding: true, operator_evm_address: evm,
      step: "Paste this address into https://portal.hedera.com/faucet (testnet, 100 HBAR), wait ~10 s, then re-run: node setup.mjs --hcs" }));
    process.exit(2);
  }
  upsert(agentEnv, "HEDERA_OPERATOR_ID", found.account);
}
const operator = env.HEDERA_OPERATOR_ID;
const hedera = Client.forTestnet().setOperator(operator, operatorKey);
// The facilitator verifies payTo, so the merchant needs no key: only its public id goes to the dashboard.
upsert(agentEnv, "ROOTED_EXPECTED_PAY_TO", operator);
upsert(dashboardEnv, "ROOTED_X402_PAY_TO", operator);

if (!env.AGENT_KEY) upsert(agentEnv, "AGENT_KEY", PrivateKey.generateECDSA().toStringRaw()); // saved before the account exists
const agentKey = parseKey("AGENT_KEY");
if (!env.AGENT_ID) {
  const tx = await new AccountCreateTransaction().setKeyWithoutAlias(agentKey.publicKey).setInitialBalance(new Hbar(20)).execute(hedera);
  upsert(agentEnv, "AGENT_ID", (await tx.getReceipt(hedera)).accountId.toString());
}
if (flags.has("--hcs") && !env.ROOTED_AGENT_HCS_TOPIC) { // only the agent's key may append to its audit log
  const tx = await new TopicCreateTransaction().setTopicMemo("Rooted x402 agent spend audit log").setSubmitKey(agentKey.publicKey).execute(hedera);
  upsert(agentEnv, "ROOTED_AGENT_HCS_TOPIC", (await tx.getReceipt(hedera)).topicId.toString());
}
if (flags.has("--usdc")) { // both sides must be associated before an HTS USDC transfer can settle
  for (const [id, key] of [[env.AGENT_ID, agentKey], [operator, operatorKey]]) {
    const tx = await new TokenAssociateTransaction().setAccountId(id).setTokenIds([USDC]).freezeWith(hedera).sign(key);
    const status = await (await tx.execute(hedera)).getReceipt(hedera).then((r) => r.status.toString(), (e) => String(e.status ?? e.message));
    console.log(`usdc association ${id}: ${status}`);
  }
}
hedera.close();
console.log(JSON.stringify({ operator_and_pay_to: operator, operator_url: account(operator), agent: env.AGENT_ID, agent_url: account(env.AGENT_ID),
  hcs_topic: env.ROOTED_AGENT_HCS_TOPIC ?? null, hcs_url: env.ROOTED_AGENT_HCS_TOPIC ? `https://hashscan.io/testnet/topic/${env.ROOTED_AGENT_HCS_TOPIC}` : null }));
process.exit(0);
