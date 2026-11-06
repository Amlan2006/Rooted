# Analyst

The analyst is a Claude agent inside Rooted (`?view=analyst`). Ask it a question about Sepolia and it investigates
with Rooted's own tools: stored X-rays, PayloadWatch's ePBS slots, builder stats, frame-mempool evidence and
read-only calls to the node. It does not answer protocol data questions from memory. The system prompt requires
every figure in the answer to cite the tool result it came from as `[E3]`; nothing enforces that, so check the chips.
Each piece of evidence carries a sha256 of the raw result bytes. It can also run a few actions (replay a block,
compare providers, buy a report over x402) within hard caps. Next to it, `npm run briefs` writes short briefs on its
own for blocks that trip its rules.

The analyst runs `claude-opus-5-5` through the official `@anthropic-ai/sdk`. It uses adaptive thinking with
summarized display, `output_config.effort` (default `medium`) and server-side fallbacks
(`server-side-fallback-2026-07-01`, `fallbacks: "default"`). The system prompt is frozen and cached.

## How an investigation runs

1. `POST /api/analyst {question, session_id?}` opens a server-sent event stream. The key never leaves the server.
2. Each model turn is streamed. Summarized thinking and answer text reach the view as they arrive.
3. Claude calls tools, several at once if they are independent. Each input is checked again with zod. A bad input
   comes back to Claude as an error result and never runs.
4. Each result is trimmed to the fields a decision needs (about 6 KB, deterministic), registered as evidence
   `E1..En` and returned to Claude with its `evidence_id`.
5. The answer streams back with `[E#]` citations. In the view each citation is a chip that opens the evidence card:
   kind, label, link and sha256.

Sessions are held in memory for 1 h (at most 50), so follow-up questions keep their context. The browser only holds
the session id.

## Tools

| Tool | Reads | Action |
|---|---|---|
| `recent_blocks` | newest stored X-rays, 1–50 (`/api/v1/xray/blocks`) | |
| `xray_summary` | p10 / median / p90 of every ceiling (`/api/v1/xray/summary`) | |
| `uniswap_contention` | blocks with Uniswap-labelled conflict edges across every stored X-ray, by pool, 1–20 (`/api/v1/xray/uniswap`) | |
| `get_block_xray` | one stored X-ray: ceilings, capping txs, critical path, hot locations, ePBS, coverage | |
| `run_block_xray` | replays a block natively and stores the X-ray (≤ 85 s, ~128-block state window) | yes |
| `epbs_slot` | PayloadWatch slot and timeline | |
| `builders`, `alerts` | builder delivery over the last hour, PayloadWatch alerts | |
| `frame_status`, `frame_conformance`, `frame_transactions` | frame-mempool node, incidents, conformance, newest frame txs | |
| `compare_providers` | one block from each configured provider, compared | yes |
| `node_read` | `eth_blockNumber`, `eth_getBlockByNumber` (no full txs), `eth_getTransactionByHash`, `eth_getTransactionReceipt` | |
| `buy_xray_report` | runs `integrations/x402-agent/agent.mjs` and pays over x402 on Hedera testnet (180 s) | yes, payment |

`node_read` takes block numbers as decimal digits and converts them itself: in a live run Claude converted
12,076,467 to the wrong hex number and read a different block. `recent_blocks` is returned as columns plus rows,
so all 50 blocks fit. As keyed objects only 15 survived the trim, and Claude missed the block it was asked about.
Each row also carries the gas misidentification flag and a precomputed gas / validator ratio, because Claude ranked
blocks wrongly when it did that arithmetic itself.

## Guardrails

- **Off by default.** Without `ANTHROPIC_API_KEY` the route answers `error/disabled`. In hosted mode
  (`ROOTED_HOSTED=1` or `ROOTED_X402_ENABLED=true`) the analyst stays off unless `ROOTED_ANALYST_PUBLIC=true`.
- **Caps per question:** 12 model steps, 3 actions, 1 purchase. The caps are settled in call order before any
  tool runs, so parallel calls cannot get past them.
- **Payments:** `buy_xray_report` returns "payments are off" unless `ROOTED_ANALYST_PAYMENTS=true`. When on,
  `agent.mjs` runs unchanged, so its per-request cap, daily budget, trusted `payTo` and one-purchase lock still
  decide.
- **Budget:** each model call is charged to `.tools/analyst/usage.jsonl` at Opus 5.5 list prices (input $4,
  output $20, cache read $0.20, cache write $5 per million tokens). An aborted call is charged for the usage the
  stream reported before the abort. The daily cap `ROOTED_ANALYST_DAILY_USD` (default 20) is checked before
  every call. The ledger survives restarts and is shared with `npm run briefs`.
- **One at a time:** one investigation per server process. A second request gets 429 with `error/busy`.
- **Requests:** same-origin `application/json` only, at most 8 KiB, and the question is 1–2000 characters.
- **Refusals:** `stop_reason` is checked every turn. A refusal reaches the view as `error/refusal` with the
  `stop_details` explanation.
- **Prompt injection:** the system prompt treats tool results as data, not instructions. The action caps and the
  x402 spend policy bound the damage either way.

`ROOTED_ANALYST_PUBLIC=true` opens your Claude budget to anyone who reaches the hosted dashboard. The actions
come with it, and `get_block_xray` answers from the stored report that hosted mode otherwise sells. Turn it on
for a demo, not for a public deployment.

## Configuration

The dashboard reads `dashboard/.env.local` and its shell environment. `npm run briefs` reads the same two.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | turns the analyst on (server side only) |
| `ROOTED_ANALYST_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh` or `max` |
| `ROOTED_ANALYST_DAILY_USD` | `20` | daily spend cap, UTC day |
| `ROOTED_ANALYST_PAYMENTS` | off | `true` lets `buy_xray_report` pay; set `ROOTED_PUBLIC_URL` to the paid dashboard |
| `ROOTED_ANALYST_PUBLIC` | off | `true` turns the analyst on in hosted mode |
| `ROOTED_BACKEND_URL` | `http://127.0.0.1:8080` | Rooted's Go API |
| `ROOTED_EXECUTION_URL` | publicnode Sepolia | node for `node_read` |
| `ROOTED_BRIEFS_PER_HOUR` | `6` | auto-brief cap |
| `ROOTED_AGENT_HCS_TOPIC` | from `integrations/x402-agent/.env` | optional HCS topic for brief hashes |

The SDK also reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`. If your shell sets them for another proxy,
unset them before starting the dashboard or the briefs loop.

## Auto-briefs

```sh
cd dashboard && npm run briefs      # with the backend running and a key in .env.local or the shell
```

Every 12 s the loop reads the newest stored X-rays and the stored briefs. It then picks the newest block that trips
a rule and has no brief yet. `gas_misleads` is the most common rule, so a block that trips any other rule goes first:

- `builder_gap`: multi-version builder < 0.8 × validator with BAL, or static builder < 0.7 × validator;
- `gas_misleads`: receipt-gas ceiling / validator ceiling > 4 or < 0.25;
- `big_block`: 250 transactions or more;
- `commitment`: the BAL commitment check failed.

Trigger rates on the 428 stored X-rays of 2026-11-06 (blocks 12,019,547 to 12,077,495), measured by running
`triggers()` over the stored briefs:

| Rule | Newest 200 | All 428 |
|---|---|---|
| `builder_gap` | 9 (4.5%) | 19 (4.4%) |
| `gas_misleads` | 25 (12.5%) | 82 (19.2%) |
| `big_block` | 1 (0.5%) | 1 (0.2%) |
| `commitment` | 0 | 0 |
| any rule | 31 (15.5%) | 96 (22.4%) |

`gas_misleads` used to fire at 2× or on "gas names the wrong bottleneck". That flag alone was true on 131 of the newest
200 blocks, and the rule fired on 137 of 200 (68.5%) and 316 of 428 (73.8%), so the briefs feed was mostly the same
card. The flag still reaches Claude in every `recent_blocks` row.

Brief mode is read-only: 6 steps, no actions. The result is stored with `POST /api/v1/analyst/briefs`
([API](API.md#analyst-briefs)) and appears in the Briefs column, which refreshes every 15 s. When the x402
agent's env is present, `{block_hash, brief_sha256}` is also appended to its HCS topic. A block that fails is not
retried by the same process.

## Live run, 2026-11-06

Real key, backend on `127.0.0.1:8098` with the X-ray follower and PayloadWatch, dashboard on `127.0.0.1:3008`,
effort `medium`. Total Claude spend for everything below, retries and the screenshot run included: $1.07.

| Question | Tool calls | Time | Cost | Answer, first line |
|---|---|---|---|---|
| Why does the builder lose parallelism in block 12,076,467? | 2 | 15 s | $0.075 | A chain of 12 dependent txs (64 … 125) takes 16.1 ms against 10.2 ms for the slowest single tx: static builder 13.3×, validator with BAL 21.0× |
| Is ePBS delivering payloads on time over the last 20 slots? | 6 | 18 s | $0.101 | Mostly yes: one late payload, slot 11,519,966 (builder 2, 2,428 ms after the commitment), still delivered and valid |
| Find Uniswap contention in recent blocks and explain it. | 4 | 16 s | $0.087 | None in blocks 12,076,555 and 12,076,971: Uniswap swaps appear, but no conflict edge is labelled Uniswap; contention comes from repeat senders |
| Buy the full report for the newest block with a builder gap and summarise it. | 4 | 28 s | $0.080 | Bought block 12,076,555 (static builder 18.09× vs 19.28×) and summarised it. That is below the validator ceiling but outside the `builder_gap` rule; the prompt now defines a builder gap |

The purchase settled on Hedera testnet: [`0.0.9185802@1793973360.446037453`](https://hashscan.io/testnet/transaction/0.0.9185802@1793973360.446037453),
1,000,000 tinybars from agent `0.0.11338137` to `0.0.11337330`, mirror node result `SUCCESS`.

The Uniswap miss above only looked at recent blocks; `uniswap_contention` now reads every stored X-ray. Asked later
the same day, against a copy of the 710 stored X-rays:

| Question | Tool calls | Time | Cost | Answer, first line |
|---|---|---|---|---|
| Which Uniswap pools caused contention in stored blocks? | 1 | 16 s | $0.063 | Six pools across 13 of 710 stored X-rays. The heaviest is v3 pool `0x3289680d…eff1`: 87 edges in block 12,076,476 and 14 in 12,076,479. Only the v4 PoolManager in block 12,077,498 has an edge on the critical path |

The briefs loop stored 6 briefs in its first two minutes, for blocks 12,076,992 to 12,077,001, at $0.023–0.038
each. All six tripped `gas_misleads`. Their hashes are messages 4–9 on HCS topic
[`0.0.11338138`](https://hashscan.io/testnet/topic/0.0.11338138).

## Code

`dashboard/lib/analyst/` holds the agent loop (`agent.ts`), tools, trimming, evidence, budget, prompts, the anomaly
rules and the view's event reducer. The rest is in `dashboard/app/api/analyst/` (SSE route, briefs proxy),
`dashboard/components/analyst.tsx`, `dashboard/scripts/briefs.ts`, `internal/analyst/` (brief store) and
`internal/api/analyst.go`. Tests run on a fake Anthropic client and fake executors, so they never touch the network.
