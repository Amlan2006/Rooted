# Phase 2 API

Base URL defaults to `http://127.0.0.1:8080`. JSON request bodies are not required. The ingestion route changes the local database, not the Ethereum chain. This development API has no authentication and should remain on loopback/private trusted infrastructure.

## GET /health

Checks database reachability with a 3-second deadline; does not check Ethereum provider health.

Response `HealthResponse`:

```json
{"status":"ok","network":"sepolia"}
```

HTTP 200 when ready, or 503 with `status: "unavailable"` if the database cannot be reached. Startup migrations must succeed before the listener starts.

## POST /api/v1/slots/{slot}/ingest?network=sepolia

`slot`: unsigned decimal uint64. `network`: required, must equal the configured network label. No request body. Fetches the current provider view for this slot and persists a matching snapshot plus raw source records atomically. Repeating a successful request is idempotent for row identity and unchanged evidence.

HTTP 200: `ObservationResponse` as defined below. It may describe a pending observation if the envelope returns 404 or the execution RPC returns a null block. Non-404 upstream errors fail the request rather than infer payload absence.

Possible errors: 400 invalid input; 404 slot unavailable; 422 unsupported block or identifier/network mismatch; 502 upstream failure; 504 ingestion deadline; 500 persistence failure. Disconnected requests are canceled.

## GET /api/v1/slots/{slot}?network=sepolia[&block_root=0x...]

Reads persisted data only. `slot` and `network` have the same requirements as ingestion. Optional `block_root` must be a 32-byte hexadecimal Beacon root; comparison normalizes hex letter case.

- 200: exactly one observation found.
- 404: no stored matching observation. Ingest it explicitly first.
- 409: multiple competing roots stored for the slot. The response supplies `block_roots`; select one explicitly. A stored canonical flag is not a current fork-choice guarantee, so this API does not silently choose a root.
- 400: invalid input; 500: storage read failure.

## ObservationResponse

```json
{
  "data": {
    "network": "sepolia",
    "chain_id": "11155111",
    "genesis_validators_root": "0x...",
    "slot": "11518268",
    "block_root": "0x...",
    "payload_hash": "0x...",
    "builder_index": "18446744073709551615",
    "self_build": true,
    "proposer_index": "1259",
    "execution_block_number": "12075314",
    "canonical_at_fetch": true,
    "finalized_at_fetch": false,
    "execution_optimistic": false,
    "payload_retrieved": true,
    "execution_block_retrieved": true,
    "identifiers_matched": true,
    "status": "observed",
    "fetched_at": "2026-11-06T08:14:22Z",
    "commitment_seen_at": null,
    "payload_seen_at": null,
    "reveal_latency_ms": null,
    "ptc_timely": null,
    "blob_available": null,
    "execution_valid": null,
    "included_ptc_attestations": [],
    "limitations": ["…"],
    "sources": [{"kind":"beacon_block","origin":"https://example.org","fetched_at":"2026-11-06T08:14:22Z"}]
  }
}
```

This is an illustrative abbreviated response. The slot, proposer, block number and finality flag are those of the self-built Sepolia slot in `internal/ingest/testdata` (captured November 6, 2026); the timestamps and origin are placeholders. Real hash/root values are full 32-byte hex strings; the actual flags and PTC aggregates depend on the provider response. `limitations` and `sources` contain the full recorded entries. For a slot fetched after it was produced, `limitations` states that arrival timestamps and reveal latency are unknown.

| Fields | Type and meaning |
| --- | --- |
| `network`, `chain_id`, `genesis_validators_root` | Strings identifying the configured network and verified source identities |
| `slot`, `builder_index`, `proposer_index` | Decimal strings; indexes are not public keys |
| `block_root`, `payload_hash` | Normalized hex strings |
| `self_build` | Boolean; the uint64-max builder sentinel is self-build, not an external builder |
| `execution_block_number` | Nullable decimal string |
| `canonical_at_fetch` | Header's canonical boolean when fetched |
| `finalized_at_fetch`, `execution_optimistic` | Nullable booleans from the beacon-block response |
| `payload_retrieved`, `execution_block_retrieved` | Boolean retrieval evidence, not validity/health judgments |
| `identifiers_matched` | True only when envelope and execution block were retrieved and compared successfully |
| `status` | `observed` or `pending`; no overall health score in Phase 2 |
| `fetched_at`, each source's `fetched_at` | RFC3339 UTC retrieval timestamps |
| `commitment_seen_at`, `payload_seen_at` | Nullable timestamps; always null for this after-the-fact snapshot fetch |
| `reveal_latency_ms` | Nullable integer milliseconds; null in this phase |
| `ptc_timely`, `blob_available`, `execution_valid` | Nullable booleans; no target-slot verdict inferred in this phase |
| `included_ptc_attestations` | Array of raw included aggregates retaining original data slot/root; not necessarily this slot's result |
| `limitations` | Array of strings explaining missing coverage |
| `sources` | Array of `Source`: `kind`, credential-free `origin`, and retrieval `fetched_at` |

Raw responses are stored in PostgreSQL, not returned by these routes. These include the payload envelope and its native BAL where exposed; decoding and graph endpoints belong to Phase 5.

## ErrorResponse

```json
{"error":{"code":"ambiguous_slot","message":"multiple stored roots; select block_root explicitly","block_roots":["0x..."]}}
```

`error.code` and `error.message` are strings. `error.block_roots` is an optional string array used for ambiguity. Codes: `invalid_network`, `invalid_slot`, `invalid_root`, `not_ingested`, `ambiguous_slot`, `slot_unavailable`, `unsupported_block`, `identifier_mismatch`, `upstream_error`, `upstream_timeout`, `storage_error`, `not_found`.

`slot_unavailable` deliberately covers skipped, pruned, and unexposed data because provider 404s do not reliably distinguish them. The configured network is a single-network instance; another network requires matching chain/genesis configuration and its own label.

## Phase 3 — PayloadWatch

Automatic collection, lifecycle projections/timelines, builder observations,
alerts, collector status, Prometheus metrics, and resumable SSE are documented
in [PAYLOADWATCH.md](PAYLOADWATCH.md). The Phase 2 snapshot routes remain stable.
Manual ingestion also projects its persisted snapshot into the configured live
source. If projection fails after storage, HTTP 500 `projection_error` states
that the raw snapshot was saved; retrying rebuilds the projection idempotently.

## Phase 4 — Frame monitor

Frame routes are read-only and always require `network=frame-devnet`. The
optional `node` is `gateway` or `miner` and defaults to `gateway`; `mode` is
`live`, `captured`, or `synthetic` and defaults to `live`; `limit` is 1..200
and defaults to 50.

| Route | Behavior |
| --- | --- |
| `GET /api/v1/frames/node` | Returns verified chain/genesis identity, boot, source version, poll/stream status, cursor, and event sequence. |
| `GET /api/v1/frames/transactions` | Returns the latest derived state rows for the selected scope. |
| `GET /api/v1/frames/transactions/{hash}` | Returns stored rows for one validated 32-byte transaction hash. |
| `GET /api/v1/frames/transactions/{hash}/evidence` | Returns raw responses for that hash; use `after=<sequence>` for pagination. |
| `GET /api/v1/frames/incidents` | Returns stored rejection, restart, gap, reorg, conflict, and unresolved-observation facts. |
| `GET /api/v1/frames/submissions` | Returns Rooted's submission attempts independently of admission state. |

Invalid scope, node, mode, limit, hash, or cursor returns HTTP 400. A valid
scope with no verified node returns 404 for the node route; an unconfigured
frame store returns 503. HTTP exposes no frame mutation route. Use the explicit
`frame-sync` and `frame-submit` CLI commands for collection and submission.

See [FRAME_MONITOR.md](FRAME_MONITOR.md) for lifecycle status semantics and
[PHASE4_VERIFICATION.md](verification/PHASE4_VERIFICATION.md) for the evidence boundary.

## Phase 5 — BAL and Uniswap analysis

Analysis routes require explicit scope selection. Live reports use
`network=sepolia&mode=live`; controlled fork reports use
`network=sepolia-fork&mode=fork`. Lists default to five reports and accept a
maximum `limit=20`.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/v1/analysis/runs` | Stored reports in the selected scope. |
| GET | `/api/v1/analysis/blocks/{hash}` | Reports for an immutable block hash. |
| GET | `/api/v1/analysis/runs/{id}` | One scoped report. |
| GET | `/api/v1/analysis/runs/{id}/bal` | Native BAL and commitment coverage. |
| GET | `/api/v1/analysis/runs/{id}/dependencies` | Transaction accesses, full graph, and storage projection. |
| GET | `/api/v1/analysis/runs/{id}/uniswap` | Verified pools, calls, events, and storage labels. |
| GET | `/api/v1/analysis/runs/{id}/evidence` | Raw responses, ten per page; use `offset=0..10000`. |
| POST | `/api/v1/analysis/blocks/{hash}/ingest` | Live Sepolia collection and persistence. |
| POST | `/api/v1/analysis/transactions/{tx}/ingest` | Resolve a mined transaction, then analyze its containing block. |

POST bodies contain `{"transactions":["0x…"]}` with at most four unique
transaction hashes; transaction lookup uses `{}`. HTTP ingestion accepts only
the configured live network. Fork analysis uses `rooted analyze-fork` locally.
Invalid input returns 400, missing reports 404, source failures 502,
unavailable configuration 503, and storage failures 500. Native BAL read-only
keys do not become invented per-transaction reads; trace-derived reads and
writes retain their coverage and source mode.

See [BAL_ANALYZER.md](BAL_ANALYZER.md) for graph semantics, native JSON/RLP
transport, Uniswap v3 verification, and workload reproduction.

## Phase 6 — dashboard and private transport

The `dashboard/` Next.js application uses a server-only `ROOTED_BACKEND_URL`
origin. Its generic `/api/backend/[...path]` handler permits only known GET
routes and forwards `Last-Event-ID` for `/api/v1/live` without buffering.
Analysis, provider-comparison, and profiler POST handlers validate same-origin
JSON, bound request size, and forward only fixed backend operations.

The Private RPC view uses `@anon-rpc/browser-harness` with the configured Nox
specifier for supported Sepolia execution reads. Bootstrap discovery is
restricted to the specifier's `eth_call`; readiness verifies chain ID through
the worker. Worker/request failures close the transport and leave anonymous
mode failed until explicit reconnect. Direct RPC mode is an explicit user
choice and labels source-IP exposure.

Run it with `npm install --prefix dashboard` followed by
`npm run dev --prefix dashboard`. See [DASHBOARD.md](DASHBOARD.md) for traffic
boundaries and verification limits.

## Provider comparison and replay profiling

Provider routes require `network=sepolia` and live mode:

- `POST /api/v1/providers/compare`, body `{}` or `{"block_hash":"0x…"}`.
- `GET /api/v1/providers/comparisons`, optionally filtered by `block_hash`.
- `GET /api/v1/providers/comparisons/{id}`.

Profile routes require `network=sepolia&mode=replay`:

- `POST /api/v1/profiles`, body `{"block_hash":"0x…"}`.
- `POST /api/v1/profiles/{id}/replay`, body `{}`.
- `GET /api/v1/profiles` and `GET /api/v1/profiles/{id}`.
- `GET /api/v1/profiles/{id}/capture`, the original bound replay JSON.

The HTTP service permits one provider-comparison job and one profile job at a
time; busy requests return 429. Browser input cannot configure RPC destinations
or executable paths. A profile is an isolated replay measurement with explicit
timing boundaries, never live production-import timing. Both services persist
new immutable results and are independent of the deferred CRE integration.

## Analyst briefs

Brief routes require `network=sepolia`. `npm run briefs` in `dashboard/` writes them; the dashboard proxies the GET.

- `GET /api/v1/analyst/briefs?network=sepolia[&limit=1..100]`: stored briefs, newest first, default 20.
- `POST /api/v1/analyst/briefs?network=sepolia`, `Content-Type: application/json`, body
  `{"block_hash":"0x…","block_number":N,"triggers":["builder_gap"],"brief":"…","evidence":[…],"model":"…","usd":0.12}`.
  `triggers` holds 1–4 unique values from `builder_gap`, `gas_misleads`, `big_block`, `commitment`. `brief` is
  1–8000 characters. A second brief for the same block replaces the first. Returns 200 with the stored row.

Invalid scope, limit or body returns 400, a non-JSON content type 415, a body over 64 KiB 413, and an
unconfigured store 503.
