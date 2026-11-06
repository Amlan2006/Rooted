# Hosted mode: agents pay for X-ray reports over x402 on Hedera

Rooted is free to self-host. A hosted Rooted instance can additionally sell one thing to software agents:
the stored **Glamsterdam X-ray report** for a Sepolia block. Agents pay per block hash over
[x402](https://github.com/x402-foundation/x402) (v2, `exact` scheme). Payment settles on **Hedera testnet**
through the official x402.org facilitator, and the agent needs no human approval.

The paywall is off by default. With `ROOTED_X402_ENABLED` unset, `/api/paid/xray/<hash>` returns 404 and
points to the free self-hosted route. Nothing else in Rooted changes.

## What is sold

`GET /api/paid/xray/<block_hash>` returns `{"data": Report}`, where Report is the `rooted-xray-v1` report from
[`docs/XRAY.md`](XRAY.md). Each report has three ceilings for one Sepolia block, all labelled "upper bound":

- gas-weighted (what the gas limit assumes);
- validator with BAL (Amdahl on measured `ApplyMessage` time; with an EIP-7928 BAL, validators can execute every tx in parallel);
- builder / no-BAL (critical path of the RAW/WAR/WAW conflict DAG).

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
| One-command end-to-end run | `integrations/x402-agent/e2e.sh` |

Guarantees enforced in `dashboard/lib/x402.ts`:

- Malformed hashes get a 400 before any payment is requested.
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
| `ROOTED_X402_ENABLED` | unset (off) | only the exact value `true` enables the paywall |
| `ROOTED_X402_PAY_TO` | none (required) | `0.0.N`, N ≥ 1; the `.env.example` placeholder `0.0.0000000` is rejected |
| `ROOTED_X402_HEDERA_ASSET` | `0.0.0` (HBAR) | `0.0.429274` = testnet USDC (HTS) |
| `ROOTED_X402_PRICE_ATOMIC` | `1000000` (0.01 HBAR) | positive integer in atomic units; `10000` = 0.01 USDC |
| `ROOTED_X402_FACILITATOR_URL` | `https://x402.org/facilitator` | https without credentials; fallback `https://api.testnet.blocky402.com` |
| `ROOTED_X402_MAX_TIMEOUT_SECONDS` | `120` | 1–180, because Hedera rejects transaction valid durations above 180 s |

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
- `session_budget_exceeded`: settled spend so far plus `amount` would exceed `SESSION_BUDGET` (default 5,000,000). Settled spend is the sum of `.tools/x402-agent/runs.jsonl` entries for the session and asset. The session defaults to the UTC date, which makes this a daily budget. A corrupt log fails closed.
- `untrusted_pay_to`: `payTo` is not `ROOTED_EXPECTED_PAY_TO`.
- `asset_not_allowed`, `invalid_amount`: the offer is on the wrong network or asset, or the amount is not an integer.

A refusal prints one JSON line `{"refused":true,"reason":…,"amount":…,"budget_left":…}` and exits 3.
The x402 library's `spendControls.allowedAssets[{network, asset, maxAmountPerPayment}]` and a `payTo` policy
enforce the same limits again as a backstop. The agent logs every settled payment before it validates the
body, so money that moved always counts against the budget. With `ROOTED_AGENT_HCS_TOPIC` set, each paid call
also appends `{block_hash, report_sha256, payment_tx, amount, asset}` to an HCS topic that only the agent's key
can write, which gives a public spend audit log.

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

- **Stored reads only.** Hedera transfers have a validity window of at most 180 s, and settlement happens after the handler runs. Live compute (`POST /api/v1/xray/blocks`, profiles, analyses) can take up to 90 s, so it is not sold. In hosted mode those routes return 403 (`ROOTED_HOSTED=1`, see `dashboard/lib/hosted.ts`). The paid read has a 10 s backend timeout.
- **Privacy.** A paid query links the payer account, the facilitator and the block hash on a public ledger, and the HCS log makes that link explicit by design. Self-hosting keeps queries private and costs nothing, which is why the paywall exists only on a hosted instance.
- **Trust.** The agent trusts the hosted operator's measurement. The report carries `bal.commitment_verified`, the replay runner and CPU, and the coverage list, so a buyer can re-derive the gas view and the BAL commitment independently.
- **Facilitator dependency.** x402.org is testnet-only. Blocky402 is a drop-in fallback via `ROOTED_X402_FACILITATOR_URL`, and running your own facilitator follows the official `toFacilitatorHederaSigner` example.

## Verified on 2026-11-06 (unfunded)

- An unpaid `GET /api/paid/xray/<stored hash>` against a real stored report (block 12075763) returned 402. Its `PAYMENT-REQUIRED` header decoded to `x402Version 2`, `exact`, `hedera:testnet`, `amount 1000000`, `asset 0.0.0` and `extra.feePayer 0.0.9185802`, fetched live from x402.org. The pay-to was a placeholder because the operator was not yet funded.
- Agent refusals exited 3 with `over_per_request_cap`, `untrusted_pay_to`, `session_budget_exceeded` and `asset_not_allowed`.
- A signed payment from a non-existent payer was rejected by x402.org `/verify` (`invalid_exact_hedera_payload_signature_invalid`). The handler never ran and nothing settled.
- The settled transaction id and its HashScan link come from the first funded `e2e.sh` run and are recorded in the README.
