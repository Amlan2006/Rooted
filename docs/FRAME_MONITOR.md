# Phase 4 — durable frame transaction monitoring

Rooted archives the frame devnet's admission reports and lifecycle events,
then checks canonical execution receipts against the configured execution
endpoint. The default endpoint is on the same host as the miner explorer. The
frame scope is separate from Sepolia and PayloadWatch: it uses network
`frame-devnet`, chain 1337, and the configured execution genesis. On
2026-11-06 the live devnet genesis was
`0x2ad3f67b059fbde111ad7af27cfb4955d997351579612237ca0318937a5bae7a`.
`ROOTED_FRAME_GENESIS_HASH` must match it, or every collector refuses to
store observations.

The implementation is in `internal/framemempool/`, with durable schema
`migrations/003_frame_mempool.sql`. It needs PostgreSQL and reachable frame
nodes for live collection; the reducer, client validation, and stream adapter
also run offline with injected evidence.

## Run

Build and start the service with the environment in `.env.example`:

```sh
go build -o .tools/rooted ./cmd/rooted
.tools/rooted serve
```

When enabled, the service starts independent gateway and miner collectors.
Each verifies explorer protocol version 1, chain ID 1337, the execution chain
ID, and the configured genesis hash before storing observations. The node
origin stored in `frame_nodes` is sanitized to scheme and host only.

Set `ROOTED_FRAME_ENABLED=false` to disable background collection, or
`ROOTED_FRAME_STREAM_ENABLED=false` to keep polling while disabling the event
stream. Explicit CLI sync and submission remain available in either case.

Manual collection:

```sh
.tools/rooted frame-sync gateway
.tools/rooted frame-sync miner
.tools/rooted frame-sync gateway 0x0cd83f6adc761d993402df583cb36483cf3ff20b18da84d56f7233316ff54051
```

## Durable evidence and recovery

- Admission polling revisits the head and rotates through a bounded history-page
  cursor. A highest-ID watermark alone would miss older records whose outcome
  later changes.
- Details retain the frame list, rule checks, source event timeline, source
  timestamps, and pool status. `pass`, `fail`, and `skipped` remain distinct.
- WebSocket events resume with `skandha_subscribe(["explorerEvents", since])`.
  Events are keyed by network, node, boot ID, and sequence. Duplicate events
  are idempotent; reusing a sequence for different evidence is rejected.
- The deployed sidecar can send an empty `{}` after the subscription
  acknowledgment. Rooted ignores that object. Heartbeat pings detect silent
  broken connections, and reconnect delay is bounded at one minute.
- A changed `bootId` creates a restart incident and resets the upstream cursor.
  `oldestSeq` creates explicit history-gap incidents. Evidence lost before
  Rooted began collecting cannot be reconstructed.
- Polling independently rechecks retained transactions, including older boots,
  so a stream outage does not stop receipt verification.
- Raw responses are retained with first/last observation times and canonical
  JSON SHA-256 digests. JSON numbers are decoded with `UseNumber` so large
  integers retain their identity.

## Admission, submission, and inclusion

| Status | Meaning |
| --- | --- |
| `submission_acknowledged` | The submission RPC returned the expected hash. It is not admission evidence. |
| `rpc_rejected` | The submission RPC returned an error; any admission report is collected separately. |
| `acknowledgment_hash_mismatch` | The submission RPC returned a hash different from the expected one. |
| `submission_unknown` | Transport failed or the response was lost. Rooted does not resubmit automatically. |
| `unknown` | No admission report, event, or receipt is stored yet, for example after an acknowledgment alone. |
| `admitted` / `admission_confirmed` | A source admission report or lifecycle event confirms entry into the pool. |
| `included_reported` | The source reports inclusion, without current canonical receipt proof. |
| `included` / `inclusion_confirmed` | A type-0x6 receipt matches the transaction and its block hash matches the canonical block at that height. |
| `reverted` | Canonical inclusion is confirmed but execution status is failure. |
| `reorged` | The receipt block hash differs from the canonical block at that height. |
| `evidence_conflict` | Receipt or block identity is inconsistent. |
| `replaced` / `dropped_reported` | Explicit source evidence; never inferred from elapsed time. |

Missing receipts and failed queries keep inclusion unknown and preserve the raw
response. The supplemental frame receipt is checked against execution receipt
status and block number when available. Receipt gas is measured usage; frame
limits remain budgets. `admission_to_inclusion_ms` is only calculated from
ordered event timestamps from one node boot.

The observation window defaults to two minutes from Rooted's first observation.
Expiry adds `inclusion_unresolved` and
`inclusion_observation_window_elapsed`; it never becomes a rejection or drop.
Archived boots and detected history gaps remain visible in coverage.

## API

Every request requires `network=frame-devnet`; `node=gateway|miner` defaults to
gateway and `mode=live|captured|synthetic` defaults to live. Lists accept
`limit=1..200`, default 50. Evidence uses `after=<sequence>` for pagination.

| Route | Result |
| --- | --- |
| `GET /api/v1/frames/node` | Verified identity, boot, source version, poll/stream status, cursor, and event sequence. |
| `GET /api/v1/frames/transactions` | Recent states for the selected node and mode. |
| `GET /api/v1/frames/transactions/{hash}` | States for one hash across retained boots. |
| `GET /api/v1/frames/transactions/{hash}/evidence` | Deduplicated raw responses with boot and observation timestamps. |
| `GET /api/v1/frames/incidents` | Rejection, restart, gap, reorg, and unresolved-observation facts. |
| `GET /api/v1/frames/submissions` | Rooted's submission attempts, separate from admission state. |

Only read routes are exposed over HTTP. Signing and submission are explicit
local operations.

## Submission and regression tools

For an externally signed transaction:

```sh
.tools/rooted frame-submit /absolute/path/signed.json EXPECTED_HASH gateway
```

The CLI verifies the configured node and execution identity, records the
attempt before one external call, checks the returned hash, and then fetches
available admission evidence. It stores no private key and performs no
automatic retry.

The disposable devnet script has explicit opt-in submission and an unfunded
rejection path:

```sh
python3 scripts/test_frame_transaction.py --submit --record --unfunded-rejection \
  --output .tools/phase4-unfunded
```

The script refuses an unexpected chain or genesis before any state-changing
request. On 2026-11-06 the gateway reported `faucetEnabled=true`, but the
funded path was not run. Only the unfunded rejection was recorded.

Compare two recorded states without executing a transaction:

```sh
python3 scripts/check_frame_regression.py \
  --baseline .tools/phase4-baseline.json \
  --candidate .tools/phase4-candidate.json \
  --output .tools/phase4-comparison.json
```

The comparison keys checks by rule, frame index, and entity; reports newly
failed checks separately from lost coverage; highlights changed frame bodies;
and keeps `causality_verified=false`. Exit code 1 means a new failure, 2 means
lost check coverage, and 0 means no compared regression.

## Evidence boundary

The checked-in frame evidence was captured on 2026-11-06 from the live devnet
by Rooted's probes, CLI, and API (`docs/FRAME_DEVNET_TEST.md`). The reference
JSON files are live-mode API responses. `offline_test.go` re-labels them as
mode `captured` in memory to replay them through the reducer. They show a
third-party included transaction with a canonical receipt check at capture
time, plus Rooted's own unfunded rejection.

They do not show:

- canonicality after the capture;
- a PostgreSQL restart of a running service;
- a funded Rooted-submitted inclusion.
