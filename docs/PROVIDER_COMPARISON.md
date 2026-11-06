# RPC provider comparison

Part of Rooted Phase 8. See [PHASE8_VERIFICATION.md](verification/PHASE8_VERIFICATION.md) for the checks run on 2026-11-06. Execution profiling is Phase 9.

## Run a check

Open **RPC providers** in the dashboard (`http://127.0.0.1:3000/?view=providers`). Enter an immutable execution block hash, or leave it empty to select the primary provider's finalized block once. Both providers receive that exact hash. **Recheck this same block** saves a new report and retains earlier observations; it does not silently switch to the latest block.

The page shows each provider's checks, observation times, HTTP/RPC status, sanitized source fingerprints, and inspectable normalized evidence. **Saved checks** selects earlier reports. **Download saved comparison** exports the normalized report as JSON. Reloading the page retrieves saved reports from PostgreSQL; Ethereum nodes are required only for new probes.

For the current local node setup:

```dotenv
# Primary: existing SSH tunnel; do not expose node RPC ports publicly.
ROOTED_EXECUTION_URL=http://127.0.0.1:18545
ROOTED_BEACON_URL=http://127.0.0.1:15052
# Reference: these are defaults, so adding them to .env is optional.
ROOTED_REFERENCE_EXECUTION_URL=https://ethereum-sepolia-rpc.publicnode.com
ROOTED_REFERENCE_BEACON_URL=https://ethereum-sepolia-beacon-api.publicnode.com
```

These are backend-only configuration variables. Restart the Go backend after changing them. Browser input cannot select arbitrary endpoints. No Anon-RPC privacy claim applies: these probes use the backend's disclosed direct provider connections.

A CLI check also saves its report:

```sh
GOCACHE="$PWD/.tools/go-build" GOMODCACHE="$PWD/.tools/go-mod" \
  go build -o .tools/rooted ./cmd/rooted
set -a
. ./.env
set +a
.tools/rooted compare-providers
# Or pin the exact block:
.tools/rooted compare-providers 0x5003b43a843799fd3043275a52cfc9f1d16907e685e0781b0cb13aa21a326cdc
```

## Checks and interpretation

Each execution provider must first return Sepolia chain ID **11155111** and the configured analysis checkpoint number/hash. Network failure or mismatch stops further execution probes for that provider. Each Beacon endpoint separately verifies the configured Sepolia genesis validators root before its payload-envelope probe.

The collector independently records:

- `eth_chainId` and `eth_getBlockByNumber` at the configured network anchor.
- `eth_getBlockByHash` for the same immutable hash, with allowlisted header fields and ordered transaction hashes. Required identifiers and numeric fields are validated and normalized before comparison.
- `eth_getBlockAccessList` for that block. Available native BALs are decoded and checked against its execution-header commitment.
- Beacon genesis and `/eth/v1/beacon/execution_payload_envelopes/{slot}`. The slot comes from that provider's execution header. Envelope execution hash, number, and slot must match before RLP BAL decoding and commitment verification. A changed canonical payload at the slot is recorded as an identity mismatch, never accepted as the requested payload.

The selected block fields are hash, number, parent hash, state root, transactions root, receipts root, BAL commitment, slot, timestamp, and ordered transaction hashes. This does not reconstruct and cryptographically verify the entire execution header. API support refers to these sampled reads, not every method a client supports.

Outcomes:

| Status | Meaning |
| --- | --- |
| Matching observed data | Selected block data matches and all attempted probes succeeded. |
| Matching block data; observation gaps | The selected block data matches, but one or more capability/evidence checks are unavailable, unsupported, or incomplete. |
| Incomplete observations | A provider's execution network or requested block could not be verified/retrieved. |
| Returned evidence needs investigation | Returned identities, BAL schema/commitment, or selected block fields conflict with the request or one another. Neither provider is automatically declared correct. |

A JSON-RPC `-32601` is **unsupported**. Explicit upstream pruning diagnostics become **pruning reported**; null/404 responses remain **not found**, since they do not prove pruning. Rate limiting, HTTP errors, RPC errors, malformed/oversized responses, and connection/timeout failures are separate statuses. Original upstream diagnostic messages are excluded because they can contain endpoint secrets.

Checks are bounded to 8 seconds per request, 16 MiB per response, and a 75-second comparison budget. Two providers run concurrently. The HTTP endpoint permits one comparison at a time per process and reports HTTP 429 when busy. Background comparison loops and automatic retries are intentionally absent; the user chooses a recheck.

## Evidence and privacy boundaries

Each immutable report has a random identity, explicit `network=sepolia`, `mode=live`, block hash, collection time, and independent per-provider checks. PostgreSQL stores reports in `provider_comparisons`; retries create new rows rather than overwriting old reports.

Only allowlisted response data is retained. A SHA-256 digest identifies each original successful/error response body, while raw bodies, upstream error text, URLs, query tokens and HTTP auth are not stored in the comparison report. The normalized saved report is evidence of what the collector observed, not a substitute for the entire raw response or an offline BAL archive.

Source fingerprints hash configured URL identities after removing user information, query strings, and fragments. They identify operator configurations without displaying endpoint paths or credentials. Equal execution fingerprints produce a warning about the lack of an independent cross-check. Different fingerprints do not prove independent infrastructure, especially behind proxies or tunnels.

Provider disagreement can reflect reorganization, pruning, caching, API differences or observation time. A mismatched slot envelope does not by itself prove a consensus failure. Polling timestamps are not payload reveal times. No comparison outcome changes policy contracts or submits transactions.

## API

- `POST /api/v1/providers/compare?network=sepolia`, body `{ "block_hash": "0x..." }` or `{}` for a finalized selection. Additional body fields, moving block tags and non-live modes are rejected.
- `GET /api/v1/providers/comparisons?network=sepolia[&block_hash=0x...]`, latest 20 reports.
- `GET /api/v1/providers/comparisons/{id}?network=sepolia`, one immutable saved report.

The dashboard's same-origin POST proxy accepts only a block hash and forwards it to the fixed configured backend. The generic read proxy permits comparison reads but does not forward the comparison mutation.

## Verification

On 2026-11-06, `.tools/rooted compare-providers 0x5003b43a843799fd3043275a52cfc9f1d16907e685e0781b0cb13aa21a326cdc` (Sepolia block 12075311, slot 11518264) compared the local Geth v1.17.10/Nimbus v26.10.2 tunnel (primary) with the public Sepolia reference. Both providers passed the chain ID and `0xa7d8c0` checkpoint checks and returned matching selected block fields and ordered transaction hashes. Both Beacon envelopes returned BALs whose computed commitments matched the execution header. Geth's direct BAL getter returned `-32601`; the public execution getter succeeded. The saved outcome is **matching block data with observation gaps**, not conflicting chain data.

The CLI saved that report to PostgreSQL, and `demo/provider-comparison/live-report.json` is its unmodified output, indented for reading. `scripts/smoke_phases8_9.py` then read it back through the backend API. The dashboard browser flow was not exercised in this check.

Tests cover matching data, network mismatch, null/404 history, explicit pruning, unsupported methods, rate limits, malformed block responses, conflicting headers, wrong envelope identities, invalid BAL evidence, canceled probes, same-source warnings, credential-safe output, durable rechecks, strict request boundaries and the fixed-origin dashboard proxy.

```sh
# PostgreSQL tests use isolated temporary schemas.
TEST_DATABASE_URL="$DATABASE_URL" go test -race -count=1 ./internal/providers/...
(cd dashboard && node --import tsx --test tests/provider-comparison.test.ts)
```
