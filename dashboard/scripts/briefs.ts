// npm run briefs: every 12 s, write an analyst brief for the newest stored X-ray block that trips an anomaly rule.
// Brief mode is read-only (no actions); at most ROOTED_BRIEFS_PER_HOUR briefs (default 6), charged to the
// analyst's daily ledger. With the x402 agent's HCS env present, each stored brief's hash is also appended there.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { parseEnv } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, newSession, runAnalyst } from "../lib/analyst/agent";
import { fileLedger } from "../lib/analyst/budget";
import { nextBlock } from "../lib/analyst/rules";
import { EXECUTORS } from "../lib/analyst/tools";
import type { Brief } from "../lib/analyst/types";
import { backendURL } from "../lib/proxy";
import { parseBriefs } from "../lib/xray";

const base = process.env.ROOTED_BACKEND_URL || "http://127.0.0.1:8080";
const perHour = Number(process.env.ROOTED_BRIEFS_PER_HOUR || 6), cap = Number.isInteger(perHour) && perHour >= 0 ? perHour : 6;
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set (dashboard/.env.local or the environment); auto-briefs are off.");
  process.exit(2);
}
const deps = { client: new Anthropic(), exec: EXECUTORS, now: () => new Date(), ledger: fileLedger(), mode: "brief" as const };
const attempts = new Map<string, number>(); // blocks this process ran, so a failed one is not retried every tick

async function backend(path: string, query: string, init?: RequestInit) {
  const url = backendURL(path.split("/"), "?network=sepolia" + query, base);
  const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Error(`${init?.method ?? "GET"} ${path}: ${response.status} ${body?.error?.message ?? ""}`);
  return body?.data;
}

// The x402 agent's account is the topic's submit key, so its env signs the append; without that env this is a no-op.
async function hcsAppend(message: string) {
  const dir = new URL("../../integrations/x402-agent/", import.meta.url), file = new URL(".env", dir);
  const env = { ...(existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}), ...process.env };
  if (!env.ROOTED_AGENT_HCS_TOPIC || !env.AGENT_ID || !env.AGENT_KEY) return null;
  const { Client, PrivateKey, TopicMessageSubmitTransaction } = createRequire(new URL("package.json", dir))("@hiero-ledger/sdk");
  let key;
  try { key = PrivateKey.fromStringECDSA(env.AGENT_KEY); } catch { throw Error("AGENT_KEY is not a hex ECDSA private key"); } // the SDK error echoes the key
  const hedera = Client.forTestnet().setOperator(env.AGENT_ID, key);
  try {
    const receipt = await (await new TopicMessageSubmitTransaction({ topicId: env.ROOTED_AGENT_HCS_TOPIC, message }).execute(hedera)).getReceipt(hedera);
    return `https://hashscan.io/testnet/topic/${env.ROOTED_AGENT_HCS_TOPIC} seq ${receipt.topicSequenceNumber}`;
  } finally { hedera.close(); }
}

async function tick() {
  const [blocks, stored] = await Promise.all([backend("api/v1/xray/blocks", "&limit=20").then(parseBriefs), backend("api/v1/analyst/briefs", "&limit=100") as Promise<Brief[]>]);
  const done = new Map([...stored.map(b => [b.block_hash, Date.parse(b.created_at)] as const), ...attempts]);
  const pick = nextBlock(blocks, done, Date.now(), cap);
  if (!pick) return;
  const { block, triggers } = pick;
  attempts.set(block.block_hash, Date.now());
  console.log(`block ${block.block_number} ${block.block_hash}: ${triggers.join(", ")}`);
  const question = `Write the brief for block ${block.block_number} (${block.block_hash}). Rules triggered: ${triggers.join(", ")}.`;
  const result = await runAnalyst(question, newSession(), e => {
    if (e.type === "step") console.log(`  ${e.tool} ${JSON.stringify(e.input)}`);
  }, deps);
  if (result.type !== "done") return console.error(`  no brief (${result.type === "error" ? `${result.code}: ${result.message}` : result.type})`);
  const brief = result.answer.trim().slice(0, 8000); // the backend's cap
  await backend("api/v1/analyst/briefs", "", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ block_hash: block.block_hash, block_number: block.block_number, triggers, brief, evidence: result.evidence, model: MODEL, usd: result.usage.usd }),
  });
  console.log(`  stored, $${result.usage.usd.toFixed(4)}`);
  const sha = createHash("sha256").update(brief).digest("hex");
  await hcsAppend(JSON.stringify({ block_hash: block.block_hash, brief_sha256: sha })).then(
    at => at && console.log(`  hcs ${at}`),
    (e: Error) => console.error(`  hcs append failed: ${e.message}`),
  );
}

async function main() {
  console.log(`auto-briefs: ${base}, at most ${cap} per hour`);
  for (;;) {
    await tick().catch((e: Error) => console.error(`briefs: ${e.message}`));
    await sleep(12_000);
  }
}
void main(); // tsx runs this file as CommonJS, which has no top-level await
