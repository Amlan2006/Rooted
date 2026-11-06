# Rooted x402 agent (Hedera testnet)

An autonomous client that buys one Rooted Glamsterdam X-ray report per Sepolia block hash. It pays over
x402 (`exact` scheme on `hedera:testnet`) and needs no human approval. The x402.org facilitator pays the
Hedera network fee, so the agent's HBAR only covers the price. Architecture, pricing and trade-offs are in
[`docs/X402_HOSTED.md`](../../docs/X402_HOSTED.md).

```sh
cd integrations/x402-agent && npm ci
node setup.mjs --hcs          # 1st run: writes a fresh operator key to .env, prints its EVM address, exits 2
#   a human pastes that address into https://portal.hedera.com/faucet (testnet), then:
node setup.mjs --hcs          # creates the agent account (20 HBAR) and an HCS audit topic, writes ids to .env
node agent.mjs [0xBLOCKHASH]  # pays, prints the settled tx id, the HashScan link and a one-line finding
MAX_PER_REQUEST=1 node agent.mjs 0xBLOCKHASH   # refusal demo: prints {"refused":true,...} and exits 3
npm test                      # spend policy unit tests
```

| File | Role |
|---|---|
| `agent.mjs` | `wrapFetchWithPayment` + `ExactHederaScheme(createClientHederaSigner(...))`. It verifies the report schema and hash, decodes `PAYMENT-RESPONSE`, cross-checks the tx on the public mirror node and appends `.tools/x402-agent/runs.jsonl`. With `ROOTED_AGENT_HCS_TOPIC` set, it also writes an HCS audit message. |
| `spend.mjs` | Pure `decide(offer, state, limits)`: allowed network and asset, trusted `payTo`, per-request cap, session budget. |
| `setup.mjs` | One-time and idempotent. Prints ids and HashScan links, never keys. |

The spend controls run in an `onPaymentRequired` hook, before anything is signed:

| Reason | When the agent refuses |
|---|---|
| `over_per_request_cap` | `amount > MAX_PER_REQUEST` |
| `session_budget_exceeded` | settled spend this session + `amount > SESSION_BUDGET`. The session spend is the sum of `runs.jsonl` entries for the session and asset; the session defaults to the UTC date. |
| `untrusted_pay_to` | `payTo` is not `ROOTED_EXPECTED_PAY_TO` |
| `asset_not_allowed` | the offer is not on `hedera:testnet`, or uses a different asset |
| `invalid_amount` | the server sent a non-integer amount |

The x402 library's `spendControls.allowedAssets` cap and a `payTo` policy enforce the same limits again as a backstop.

Exit codes: 0 paid, 1 error, 2 configuration or setup, 3 refused.
