# Hosted mode: agents pay for X-ray reports over x402 on Hedera

Rooted is free to self-host. A hosted Rooted instance can additionally sell one thing to software agents:
the stored **Glamsterdam X-ray report** for a Sepolia block. Agents pay per block hash over
[x402](https://github.com/x402-foundation/x402) (v2, `exact` scheme). Payment settles on **Hedera testnet**
through the official x402.org facilitator, and the agent needs no human approval.

The paywall is off by default. With `ROOTED_X402_ENABLED` unset, `/api/paid/xray/<hash>` returns 404 and
points to the free self-hosted route. Nothing else in Rooted changes. `ROOTED_X402_ENABLED=true` also switches
the dashboard into hosted mode (the same as `ROOTED_HOSTED=1`), so the free read proxy answers 402 for full
reports instead of serving the paid report one URL over.

## What is sold

`GET /api/paid/xray/<block_hash>` returns `{"data": Report}`, where Report is the `rooted-xray-v1` report from
[`docs/XRAY.md`](XRAY.md). Each report has five ceilings for one Sepolia block, all labelled "upper bound":

- receipt gas (execution + EIP-8037 state gas) and execution gas (the EIP-8037 dimension that prices compute);
- validator with BAL (Amdahl on measured `ApplyMessage` time; with an EIP-7928 BAL, validators can execute every tx in parallel);
- builder / no-BAL, twice: a multi-version executor (conflict DAG without write-after-read edges) and a static
  scheduler (critical path of the full RAW/WAR/WAW conflict DAG).

The report also includes the hot storage slots, with Uniswap labels where they apply, and the ePBS strip.

The report is computed once on Rooted's own Geth and Nimbus nodes, by the follower or by `rooted xray`, and
then stored. The paid route only reads it back, which keeps a paid request well inside the Hedera payment
window (see Trade-offs).

## Architecture

```
agent.mjs ──GET──▶ dashboard /api/paid/xray/[hash]   (Next.js route, withX402 from @x402/next)
   ▲   │             │ 1. no PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED (hedera:testnet, payTo, amount, feePayer)
   │   │             │ 2. PAYMENT-SIGNATURE → facilitator /verify ──▶ https://x402.org/facilitator
   │   │             │ 3. handler: GET {ROOTED_BACKEND_URL}/api/v1/xray/blocks/{hash}?network=sepolia (10 s)
   │   │             │ 4. only if the handler returned < 400: facilitator /settle ──▶ Hedera testnet
   │   └─────────────┘ 5. 200 + report + PAYMENT-RESPONSE {transaction: "0.0.x@s.n"}
   └── mirror node check, runs.jsonl, optional HCS audit message
```

| Piece | File |
|---|---|
| Config and validation (`x402Config`), paid handler (`paidXray`) | `dashboard/lib/x402.ts` |
| Route (one line) | `dashboard/app/api/paid/xray/[hash]/route.ts` |
| Tests, with a mocked facilitator | `dashboard/tests/x402.test.ts` |
| Paying agent and spend policy | `integrations/x402-agent/{agent,spend,setup}.mjs`, `spend.test.mjs` |
| MCP tools for LLM agents (`recent_xray_blocks`, `buy_xray_report`) | `integrations/x402-agent/mcp.mjs`, `mcp.test.mjs` |
| Paywall implies hosted mode (free proxy answers 402) | `dashboard/lib/hosted.ts`, `dashboard/tests/xray-paywall.test.ts` |
| One-command end-to-end run | `integrations/x402-agent/e2e.sh` |

Guarantees enforced in `dashboard/lib/x402.ts`:

- Malformed hashes get a 400 before any payment is requested.
- Only an exact `ROOTED_FREE_XRAY_BLOCKS` hash skips payment, and it still goes through the report checks below.
- `withX402` settles only when the handler returns a status below 400. An unknown hash (404), a backend outage (502) or a backend body that is not the `rooted-xray-v1` report for that exact hash (502 `invalid_report`) is never charged.
- The backend origin goes through the same `backendURL` guard as the read proxy: http(s) only, no credentials, no path.
- A misconfigured paywall throws when the module loads (fail closed) instead of serving reports free or at the wrong price.

## Setup

Self-hosting needs none of this. For a hosted instance:

```sh
cd integrations/x402-agent && npm ci
node setup.mjs --hcs   # writes a fresh operator key to .env (gitignored), prints its EVM address, exits 2
# Human step: paste the printed address into https://portal.hedera.com/faucet (testnet). The faucet sits
# behind a Cloudflare challenge, so it cannot be scripted. The drip auto-creates the account (HIP-583).
node setup.mjs --hcs   # creates the agent account (20 HBAR) and an HCS audit topic (submit key = agent key)
                       # and writes ROOTED_X402_PAY_TO=<operator> to dashboard/.env.local
integrations/x402-agent/e2e.sh   # backend + paid dashboard + refusal demo + paid call; stops everything after
```

Instead of the faucet drip, you can log in to portal.hedera.com, create an ECDSA testnet account, and put its id
and HEX private key in `integrations/x402-agent/.env` as `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY`.

Dashboard environment. Set `ROOTED_X402_ENABLED=true` in the hosting environment, not in a shared
`.env.local`, because it switches the route on.

| Variable | Default | Rule |
|---|---|---|
| `ROOTED_X402_ENABLED` | unset (off) | only the exact value `true` enables the paywall; it implies hosted mode |
| `ROOTED_HOSTED` | unset (off) | `1` or `true`: hosted mode without a paywall (full reports and compute routes 403 `hosted_read_only`) |
| `ROOTED_X402_PAY_TO` | none (required) | `0.0.N`, N ≥ 1; the `.env.example` placeholder `0.0.0000000` is rejected |
| `ROOTED_X402_HEDERA_ASSET` | `0.0.0` (HBAR) | `0.0.429274` = testnet USDC (HTS) |
| `ROOTED_X402_PRICE_ATOMIC` | `1000000` (0.01 HBAR) | positive integer in atomic units; `10000` = 0.01 USDC |
| `ROOTED_X402_FACILITATOR_URL` | `https://x402.org/facilitator` | https without credentials; fallback `https://api.testnet.blocky402.com` |
| `ROOTED_X402_MAX_TIMEOUT_SECONDS` | `120` | 1–180, because Hedera rejects transaction valid durations above 180 s |
| `ROOTED_PUBLIC_URL` | unset (request origin) | http(s) origin without a path, such as `https://rooted.example.org`. Behind a reverse proxy the request origin is the internal one, so set this and `PAYMENT-REQUIRED` names the public resource URL. The x402 agent reads the same variable as its base URL |
| `ROOTED_FREE_XRAY_BLOCKS` | unset (none) | comma-separated block hashes whose full report hosted mode serves without payment, on the paid route and the read proxy, labelled as a free sample in the X-ray view. Exact match after trimming and lowercasing; an entry that is not a 32-byte hash is dropped |

Keys:

- The merchant side holds no key. The facilitator co-signs as fee payer, and `payTo` is a public account id.
- The only secrets are the operator and agent keys, which live in `integrations/x402-agent/.env`. Both `.env` and `.env.*` are gitignored; check with `git check-ignore -v`.
- `setup.mjs` prints ids and HashScan links only, never keys.

## Payment flow on Hedera

The `exact` scheme on Hedera (`@x402/hedera`, spec `scheme_exact_hedera.md`) works like this:

1. The agent signs a native `TransferTransaction` (agent → `payTo`, `amount`) whose transaction id account is the facilitator's `feePayer`. On 2026-11-06, x402.org advertised `0.0.9185802` in `/supported`, and the dashboard's live 402 showed the same value.
2. The facilitator checks the payer's signature against the payer's on-chain key (via the mirror node) and runs a balance and association preflight.
3. After the handler succeeds, the facilitator adds the fee-payer signature and submits the transaction. It reports success only after a SUCCESS receipt.

The payer spends exactly the price and nothing on fees. The agent then looks the transaction id up on the public
mirror node (`/api/v1/transactions/0.0.x-s-n`) and prints the result. The evidence is the ledger, not the
facilitator's word. The HashScan link format is `https://hashscan.io/testnet/transaction/<tx id>`.

## Pricing

0.01 HBAR (1,000,000 tinybars) per stored report by default. That is roughly a cent of value for data that cost the
operator a debug trace, a native replay (7 samples) and a BAL decode. The price is one env var. Switching to
USDC (`0.0.429274`, price `10000`) takes three steps:

1. `node setup.mjs --usdc` associates both accounts with the token.
2. Send testnet USDC from https://faucet.circle.com (Hedera testnet) to the agent account.
3. Set the asset and price on the dashboard, and set `ROOTED_X402_HEDERA_ASSET`, `MAX_PER_REQUEST` and `SESSION_BUDGET` for the agent.

## Spending controls (agent side)

`integrations/x402-agent/spend.mjs` `decide(offer, state, limits)` is pure and unit-tested. It runs in the
`x402HTTPClient.onPaymentRequired` hook, before anything is signed, so every refusal can name its reason:

- `over_per_request_cap`: `amount > MAX_PER_REQUEST` (default 1,000,000).
- `session_budget_exceeded`: spend so far plus `amount` would exceed `SESSION_BUDGET` (default 5,000,000). Spend so far is the sum of `.tools/x402-agent/runs.jsonl` runs for the session and asset that are settled or still reserved (see below). The session defaults to the UTC date, which makes this a daily budget. A corrupt log fails closed.
- `purchase_in_progress`: another purchase holds `.tools/x402-agent/lock`. Each run holds it from reading the budget until its run is logged, so overlapping runs cannot each pass the budget check; a lock whose process is gone is taken over.
- `untrusted_pay_to`: `payTo` is not `ROOTED_EXPECTED_PAY_TO`.
- `asset_not_allowed`, `invalid_amount`: the offer is on the wrong network or asset, or the amount is not an integer.

A refusal prints one JSON line `{"refused":true,"reason":…,"amount":…,"budget_left":…}` and exits 3.
The same `decide()` is registered as the x402 library's payment policy (`policy()` in `spend.mjs`), so when a
402 lists several offers the library can only sign one that `decide()` approved. The library's
`spendControls.allowedAssets[{network, asset, maxAmountPerPayment}]` cap is a second backstop. Right after signing, before the payment is sent, the
agent logs a `pending` reservation for the signed amount, and it counts against the budget. The run's later
line replaces it: `settled` once `PAYMENT-RESPONSE` confirms (logged before the body is validated), or
`released` only when the server proves nothing moved (a 402, or a failed settlement). A lost reply, a dropped
connection or a kill at the MCP server's 180 s timeout leaves the reservation in place, so a payment that may
have moved always counts. The MCP server also runs buys one at a time. With `ROOTED_AGENT_HCS_TOPIC` set, each paid call
also appends `{block_hash, report_sha256, payment_tx, amount, asset}` to an HCS topic that only the agent's key
can write, which gives a public spend audit log.

## LLM agents (MCP)

`integrations/x402-agent/mcp.mjs` is a dependency-free MCP server (stdio) with two tools:
`recent_xray_blocks` (free briefs) and `buy_xray_report(block_hash)` (runs `agent.mjs`, so the same spend
controls apply). An LLM agent decides which block to buy and calls the tool; nobody approves the payment.

```sh
claude mcp add rooted-x402 -- node integrations/x402-agent/mcp.mjs   # Claude Code; any MCP client works
# then ask: "Which of the latest X-rayed Sepolia blocks has the biggest gap between the validator and builder
# ceilings? Buy its report and explain what serializes it."
```

## Why the data is Ethereum but the payment is Hedera

The product is Ethereum protocol data: Sepolia blocks under Glamsterdam, with ePBS and EIP-7928 BALs. But no
public x402 facilitator settles on Ethereum Sepolia with a per-call transaction:

- x402.org, Blocky402 and Ax402 list `hedera:testnet` but not `eip155:11155111`.
- Circle Gateway lists Sepolia but nets payments in batches and returns a UUID, not a tx hash.

Hedera settles in seconds, and the facilitator pays the fee, so an agent only needs a funded account and a key.
The data is not bound to the chain that pays for it: the report hash (`report_sha256`) and the Sepolia block
hash travel together in the HCS audit message. A Sepolia USDC rail (EIP-3009 via an in-process facilitator) is
left configured off, because it needs a relayer key that this deployment does not have.

## Trade-offs

- **Stored reads only.** Hedera transfers have a validity window of at most 180 s, and settlement happens after the handler runs. Live compute (`POST /api/v1/xray/blocks`, profiles, analyses) can take up to 90 s, so it is not sold. In hosted mode those routes return 403 (`ROOTED_HOSTED=1` or `ROOTED_X402_ENABLED=true`, see `dashboard/lib/hosted.ts`), and so do profile reads through the free proxy (`/api/v1/profiles…`), because a profile carries the report's inputs: per-tx timings and the full capture. The paid read has a 10 s backend timeout.
- **Privacy.** A paid query links the payer account, the facilitator and the block hash on a public ledger, and the HCS log makes that link explicit by design. Self-hosting keeps queries private and costs nothing, which is why the paywall exists only on a hosted instance.
- **Trust.** The agent trusts the hosted operator's measurement. The report carries `bal.commitment_verified`, the replay runner and CPU, and the coverage list, so a buyer can re-derive the gas view and the BAL commitment independently.
- **Facilitator dependency.** x402.org is testnet-only. Blocky402 is a drop-in fallback via `ROOTED_X402_FACILITATOR_URL`, and running your own facilitator follows the official `toFacilitatorHederaSigner` example.

## Verified on 2026-11-06

- An unpaid `GET /api/paid/xray/<stored hash>` against a real stored report (block 12075763) returned 402. Its `PAYMENT-REQUIRED` header decoded to `x402Version 2`, `exact`, `hedera:testnet`, `amount 1000000`, `asset 0.0.0` and `extra.feePayer 0.0.9185802`, fetched live from x402.org. The pay-to was a placeholder because the operator was not yet funded.
- Agent refusals exited 3 with `over_per_request_cap`, `untrusted_pay_to`, `session_budget_exceeded` and `asset_not_allowed`.
- A signed payment from a non-existent payer was rejected by x402.org `/verify` (`invalid_exact_hedera_payload_signature_invalid`). The handler never ran and nothing settled.
- After funding, two paid calls settled on Hedera testnet, both `SUCCESS` on the public mirror node (agent
  `0.0.11338137` → pay-to `0.0.11337330`, 1,000,000 tinybars, fee paid by `0.0.9185802`):
  [`0.0.9185802@1793963177.452527184`](https://hashscan.io/testnet/transaction/0.0.9185802@1793963177.452527184)
  from `e2e.sh`, and
  [`0.0.9185802@1793963925.399944560`](https://hashscan.io/testnet/transaction/0.0.9185802@1793963925.399944560)
  through the MCP tool `buy_xray_report` against a hosted dashboard with `ROOTED_X402_ENABLED=true` (where the
  free proxy answered 402 for the same report). Each appended an audit message to HCS topic
  [`0.0.11338138`](https://hashscan.io/testnet/topic/0.0.11338138) (sequence 1 and 2).
- With the fixed agent, the refusal demo (`MAX_PER_REQUEST=1`) still exits 3 with `over_per_request_cap`.
