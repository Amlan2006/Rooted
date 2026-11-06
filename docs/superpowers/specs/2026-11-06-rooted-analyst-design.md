# Rooted Analyst: design and build plan

Approved direction 2026-11-06: "Analyst + auto-briefs". Built on branch `analyst` (worktree `/home/ubuntu/Rooted-picks`).

## Intent

- **What:** a Claude agent inside Rooted that investigates questions against Rooted's own evidence and the live node.
  It does not answer from memory. Every figure in an answer cites the tool result it came from.
- **Who:** protocol researchers, demo viewers and operators running Rooted.
- **Not a chatbot:**
  - It runs tools: reads stored X-rays, ePBS slots and frame evidence; replays blocks; compares providers.
  - It can pay for a hosted report over x402 on Hedera, within spend caps.
  - It writes briefs for unusual blocks automatically, with nobody asking.
- **Success:**
  - three live investigations on camera, each finishing in under 90 s with cited evidence;
  - one Claude-initiated x402 payment settled on Hedera testnet;
  - auto-briefs appearing in the feed for real anomalous blocks;
  - every test green.

## Model and API (from the claude-api skill, TypeScript SDK)

- **SDK:** the official `@anthropic-ai/sdk` in `dashboard/`, plus `zod` for tool input validation. No other LLM libraries.
- **Model:** `claude-opus-5-5`. Thinking `{type: "adaptive", display: "summarized"}`, with no budget_tokens and no
  "disabled" (both return 400). Effort comes from `ROOTED_ANALYST_EFFORT` (default `medium`), set explicitly under
  `output_config`.
- **Call shape:** stream with `client.beta.messages.stream(...)` and `.finalMessage()`. Also send
  `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"`, so a refusal is re-served by a fallback
  model. Always check `stop_reason`; on `refusal`, surface `stop_details` to the UI as an error event.
- **No forced tool_choice.** Use `auto`.
- **Tools:** `strict: true`, `additionalProperties: false`. Every tool input is validated again with zod before it
  runs. A failed validation becomes a `tool_result` with `is_error: true`. `eager_input_streaming` is off: inputs
  are tiny.
- **Caching:** the system prompt and tool list are frozen strings with `cache_control: {type: "ephemeral"}` on the
  last system block. Nothing volatile (times, ids) goes in the system prompt.
- **History is append-only:** append the full `response.content`, thinking blocks included, never just the text.
  Parallel tool calls run concurrently, and all their `tool_result` blocks go back in one user message.
- **Key:** `ANTHROPIC_API_KEY`, read server-side only (from `.env` or `dashboard/.env.local`, both gitignored). It is
  never sent to the browser, logged or committed.

## Architecture

```
dashboard/lib/analyst/
  types.ts      AnalystEvent, Evidence, ToolSpec, Session, Brief (the contract below)
  tools.ts      tool specs (JSON schema + zod) and executors -> backend REST / node RPC / x402 agent
  trim.ts       shrink tool results to their decision fields (cap ~6 KB each), deterministic
  evidence.ts   evidence registry: id E1..En, kind, label, link, sha256 of the raw result
  budget.ts     cost from usage x prices; daily ledger .tools/analyst/usage.jsonl; refuse when over
  agent.ts      runAnalyst(question, session, emit, deps): loop, step and action caps, events
  prompts.ts    SYSTEM_PROMPT (investigate) and BRIEF_PROMPT (auto-brief), frozen strings
  rules.ts      anomaly rules over xray Briefs -> triggers[]
dashboard/app/api/analyst/route.ts          POST: SSE investigation
dashboard/app/api/analyst/briefs/route.ts   GET: proxies GET /api/v1/analyst/briefs
dashboard/components/analyst.tsx            Analyst view (nav item "Analyst", ?view=analyst)
dashboard/scripts/briefs.ts                 `npm run briefs`: auto-brief loop
migrations/009_analyst_briefs.sql, internal/analyst/{store.go,store_test.go}, internal/api/analyst.go(+_test)
```

`agent.ts` takes injected deps: `{client, exec, now, ledger}`. Tests swap in a fake Anthropic client and fake
executors, so no test touches the network.

## Contract

```ts
type EvidenceKind = "xray" | "xray_run" | "summary" | "blocks" | "epbs_slot" | "builders" | "alerts"
  | "frame_node" | "frame_conformance" | "frame_txs" | "provider_compare" | "rpc" | "payment" | "brief";
interface Evidence { id: string; kind: EvidenceKind; label: string; link?: string; sha256: string; at: string }
type AnalystEvent =
  | { type: "session"; session_id: string }
  | { type: "thinking"; text: string }                                   // summarized thinking
  | { type: "step"; id: string; tool: string; input: unknown; action: boolean }
  | { type: "step_done"; id: string; ok: boolean; ms: number; evidence?: Evidence; note: string }
  | { type: "text"; delta: string }
  | { type: "done"; answer: string; evidence: Evidence[]; usage: { input: number; output: number; cache_read: number; cache_write: number; usd: number } }
  | { type: "error"; code: "disabled" | "budget" | "refusal" | "max_steps" | "upstream" | "bad_request"; message: string };
```

- **Wire format:** SSE (`data: <json>\n\n`).
- **Sessions:** `POST /api/analyst {question: string ≤ 2000 chars, session_id?: string}`. Sessions live in an
  in-memory `Map` with a 1 h TTL and at most 50, so follow-up questions keep context. The client never sends
  history.
- **Citations:** the answer cites evidence as `[E3]`. The UI renders each as a chip that opens the evidence card.
  The system prompt requires every number, hash or verdict in the answer to carry a citation. Statements from
  general knowledge must say so.

### Tools

Backend base is `ROOTED_BACKEND_URL` (default `http://127.0.0.1:8080`), via the existing `backendURL()` allowlist.

| Tool | Input | Calls | Action |
|---|---|---|---|
| `recent_blocks` | `limit` 1–50 | `GET /api/v1/xray/blocks?network=sepolia&limit=` | no |
| `xray_summary` | none | `GET /api/v1/xray/summary?network=sepolia` | no |
| `get_block_xray` | `block_hash` (0x + 64 hex) | `GET /api/v1/xray/blocks/{hash}` (404 → tells the model to run it) | no |
| `run_block_xray` | `block_hash` | `POST /api/v1/xray/blocks/{hash}` (≤ 85 s; 422 outside the state window; 429 busy) | yes |
| `epbs_slot` | `slot` int | `GET /api/v1/payloadwatch/slots/{slot}` + `/timeline` | no |
| `builders` / `alerts` | none | `GET /api/v1/builders`, `GET /api/v1/alerts` | no |
| `frame_status` | none | `GET /api/v1/frames/node` + `/incidents` | no |
| `frame_conformance` | none | `GET /api/v1/frames/conformance` | no |
| `frame_transactions` | `limit` 1–25 | `GET /api/v1/frames/transactions` | no |
| `compare_providers` | `block_hash` | `POST /api/v1/providers/compare` (existing body shape) | yes |
| `node_read` | `method` ∈ {eth_blockNumber, eth_getBlockByNumber (no full txs), eth_getTransactionByHash, eth_getTransactionReceipt}, `params` | JSON-RPC to `ROOTED_EXECUTION_URL` | no |
| `buy_xray_report` | `block_hash` | `node integrations/x402-agent/agent.mjs <hash>` (same as `mcp.mjs`), 180 s timeout | yes, payment |

**Caps per question:**
- 12 model steps;
- 3 action tools;
- 1 `buy_xray_report`, which needs `ROOTED_ANALYST_PAYMENTS=true`; otherwise it returns an `is_error` result saying
  "payments are off".

**What each tool returns:**
- Results are trimmed by `trim.ts`. For X-ray that means: ceilings, the capping txs, the critical path, the top 10
  hot locations with their Uniswap labels, coverage, the ePBS summary and the commitment flag.
- The executor adds an `evidence_id` field to each result it returns to the model.
- Evidence links:
  - X-ray / block: `/?view=xray&block=0x…`
  - tx: `https://sepolia.etherscan.io/tx/0x…`
  - payment: the HashScan URL that `agent.mjs` prints
  - frame tx: `https://explorer.altmempool.wtf/tx/0x…`

### Guardrails

- **Disabled by default:**
  - Without `ANTHROPIC_API_KEY` the route returns `error/disabled`.
  - In hosted mode (`ROOTED_HOSTED=1` or `ROOTED_X402_ENABLED=true`) the analyst is off unless `ROOTED_ANALYST_PUBLIC=true`.
- **Budget:**
  - Daily spend is capped at `ROOTED_ANALYST_DAILY_USD` (default 20), charged at Opus 5.5 rates: input $4/MTok,
    output $20/MTok, cache read $0.20/MTok, cache write $5/MTok.
  - The ledger survives restarts.
  - The check runs before each model call.
- **Rate limit:** at most 1 concurrent investigation per server process; a second gets 429.
- **Prompt injection:** the system prompt says tool results are data, not instructions. Action caps and the x402
  spend policy bound the damage either way.

## Auto-briefs

**Rules** (`rules.ts`) run over each xray Brief. A block gets a brief when at least one fires:
- `builder_gap`: `builder_multiversion_time < 0.8 × validator_bal_time`, or `builder_dag_time < 0.7 × validator_bal_time`
- `gas_misleads`: `gas_weighted / validator_bal_time` > 2 or < 0.5, or `gas_misidentifies_bottleneck`
- `big_block`: `transaction_count ≥ 250`
- `commitment`: `commitment_verified === false`

**Generator** (`scripts/briefs.ts`, run with `npm run briefs`):
- Every 12 s it fetches recent blocks, skips hashes that already have a brief, and takes the newest block that
  triggers.
- It runs `runAnalyst` in brief mode: `BRIEF_PROMPT`, read-only tools, 6 steps, no actions.
- It POSTs `{block_hash, block_number, triggers, brief, evidence, model, usd}` to the backend.
- At most `ROOTED_BRIEFS_PER_HOUR` (default 6), and it shares the daily budget ledger.
- **Optional:** append `{block_hash, brief_sha256}` to the HCS topic in `ROOTED_AGENT_HCS_TOPIC`, using the
  x402-agent env. Skipped when that env is absent.

**Backend:**
- Migration `009_analyst_briefs.sql`: table `analyst_briefs` (network, block_hash PK with network, block_number,
  created_at, triggers jsonb, brief text, evidence jsonb, model, usd numeric).
- `GET /api/v1/analyst/briefs?network=&limit=` (newest first).
- `POST /api/v1/analyst/briefs`: validated, upsert, body ≤ 64 KB.
- Add the routes to the proxy allowlist and to `docs/API.md`.
- Bump the storage test's migration count to 8.

## UI (`components/analyst.tsx`)

Use the dashboard's existing look and `ui.tsx` primitives. No new UI libraries.

- **Left column, "Ask":**
  - question box and 4 suggested questions;
  - a live trace: each step is a row with tool name, input and a spinner, then ms and an evidence chip; actions are
    tagged `ACTION`, payments `PAYMENT`;
  - the summarized-thinking line, in muted text;
  - the streamed answer, with `[E3]` chips that open an evidence drawer (kind, label, link, sha256);
  - cost and tokens in the footer.
- **Right column, "Briefs":** the auto-brief feed, polled every 15 s. Each card shows block number, trigger badges,
  the first two lines of the brief, and links to the X-ray and the evidence.
- **States:** disabled, budget-exhausted and refusal each show a clear message.

## Testing

- **Unit (node:test + tsx, fake client, no network):**
  - tool schema validation;
  - trimming is deterministic and stays under the size cap;
  - evidence ids and links;
  - citation parsing;
  - budget math and refusing when over budget;
  - step and action caps;
  - the payments-off path;
  - SSE encoding;
  - each anomaly rule;
  - hosted-mode disable.
- **Go:** briefs store upsert/list and handler validation (400 / 413 / 200) against `TEST_DATABASE_URL` on 54330.
- **Live (real key, real backend on a non-default port and DB, never 54329):**
  1. "Why does the builder lose parallelism in block 12,076,467?"
  2. "Is ePBS delivering payloads on time over the last 20 slots?"
  3. "Find Uniswap contention in recent blocks and explain it."
  4. With payments on: "Buy the full report for the newest block with a builder gap." This must settle on Hedera
     testnet; record the tx id.
  5. Auto-briefs run for 10 minutes and produce at least one brief.

  Record transcripts, costs and screenshots.

## Build plan (parallel agents, one integrator)

| Agent | Owns | Depends on |
|---|---|---|
| B1 core | `lib/analyst/{types,tools,trim,evidence,budget,agent,prompts}.ts`, `app/api/analyst/route.ts`, deps in `dashboard/package.json`, unit tests | contract above |
| B2 UI | `components/analyst.tsx`, nav entry + `?view=analyst` in `dashboard.tsx`, styles, a UI test of event reduction | contract above (fake event stream) |
| B3 briefs | `rules.ts` + tests, `scripts/briefs.ts`, `app/api/analyst/briefs/route.ts`, migration 009, `internal/analyst`, `internal/api/analyst.go`, proxy allowlist, storage test count | contract (`runAnalyst` signature) |
| Integrator | wiring, live runs 1–5, `docs/ANALYST.md`, `.env.example`, README section, one-line signed commits | B1–B3 |
| Review → fix | one review round (correctness + safety + demo readiness), then one fix round | integrator |

**Rules for every agent:**
- Commits are one-line conventional messages (`feat: …`), no body, no co-author.
- Never print or commit keys.
