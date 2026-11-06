# PayloadWatch — Phase 3

Rooted adds continuous Beacon/execution collection, durable lifecycle evidence,
per-root projections, builder observations, alerts, metrics, and a resumable
SSE API. Phase 2 snapshot routes remain available.

## Run

Use the database and environment setup in [BACKEND.md](BACKEND.md), rebuild,
and restart the service:

```sh
go build -o .tools/rooted ./cmd/rooted
.tools/rooted serve
```

Startup applies migrations 001 and 002. The latter adds event journals, root
states, stream sessions, unique outcome counters, latency samples, alerts, and
collector progress. The service starts polling and streaming independently;
stream subscription verifies Beacon genesis and execution chain ID first. A
slow polling or catchup pass cannot hold up stream verification.

| Configuration | Default | Meaning |
| --- | --- | --- |
| `ROOTED_WATCH_ENABLED` | `true` | Enable automatic collection; stored-data queries remain available when disabled |
| `ROOTED_STREAM_ENABLED` | `true` | Enable Beacon SSE alongside polling |
| `ROOTED_SOURCE_ID` | `beacon` | Separate provider/session identity; change when switching nodes/providers |
| `ROOTED_POLL_INTERVAL` | `12s` | Poll period, minimum one second |
| `ROOTED_POLL_LOOKBACK` | `2` | Revisit this lookback through the current head; range 1..64 |
| `ROOTED_MAX_CATCHUP` | `4` | Additional checkpoint catchup per pass; range 1..64 |
| `ROOTED_LOCAL_LATE_AFTER` | `2s` | Local comparable receipt threshold |
| `ROOTED_LOCAL_MISSING_AFTER` | `8s` | Local covered missing-delivery threshold; at least the late threshold |
| `ROOTED_PTC_SIZE` | `512` | Committee positions, configured in multiples of eight |
| `ROOTED_PTC_QUORUM` | `0` | Zero disables PTC/blob verdicts until the operator verifies network policy |

Run one collector process per network/source identity. There is no distributed
collector lease or raw-evidence retention job in this phase.

## Evidence and lifecycle

Polling uses the Phase 2 immutable-root and network checks. Its raw snapshots
are saved before lifecycle derivation. Streaming handles `block`,
`execution_payload_gossip`, `execution_payload`,
`execution_payload_available`, `chain_reorg`, and
`payload_attestation_message`.

Every event retains network, mode (`live`, `replay`, or `synthetic`), source,
root, slot, and observation time. Insert and projection commit together, with
durable sequencing for SSE cursors. Equivalent JSON and duplicate deliveries
retain the first event receipt and do not inflate counters. Distinct large
JSON integers remain distinct in event hashes.

| Health state | Meaning |
| --- | --- |
| `pending` | Some required evidence remains unknown |
| `healthy` | Selected commitment, matching payload, positive configured PTC/blob votes, and source-reported execution validity are present |
| `warning` | Local lateness/missing delivery or negative PTC/blob evidence |
| `failed` | Mismatched payload, conflicting commitment, or reported invalid execution |

Delivery is separate: `unknown`, `pending`, `revealed`, `late`, or `missing`.
A mismatched payload does not satisfy its selected commitment and can therefore
coexist with missing-delivery evidence.

Comparable latency requires matching block and payload receipts in the same
recorded uninterrupted stream session. Session coverage must include both
receipts. A reveal before the block or across a reconnect leaves latency null.
These are collector receipt intervals, including its observation path; they are
not builder publication time, global propagation time, or protocol deadlines.

Missing detection requires received stream activity covering the block receipt
through its local deadline. An open socket, elapsed wall time, or collector
outage alone cannot establish missing delivery. Closed sessions cannot extend
their recorded coverage. Topic-specific loss is not independently detectable
merely because another topic continues to arrive.

The event adapter preserves non-optimistic execution imports as
`source_reported_validation`. It does not independently execute the payload.
Standard stream events do not supply every possible invalid-execution case;
the synthetic fixture explicitly demonstrates the failure path.

PTC aggregates remain attached to their own slot/root. Overlapping committee
positions are unioned, and contradictory yes/no positions are excluded.
Individual validator indices are retained without being treated as committee
positions. Source-node signature and membership checks are trusted. With
quorum zero, `ptc_timely` and `blob_available` remain null even if votes exist.

## Recovery and aggregates

The poller saves its progress and performs bounded catchup plus recent-root
rechecks. It does not jump across an unvisited gap. A provider 404 is unavailable
evidence, not proof of a skipped slot or builder failure. Recent competing
roots are reconciled as canonical/orphaned without discarding their evidence.
Deeper reorgs require a larger lookback or explicit ingestion.

Streams use a 30-second idle watchdog and retry with backoff from one to 60
seconds. Each reconnect performs network verification again. Startup closes
unfinished previous sessions at their last recorded activity. Polling can repair
payload presence after an outage, while missed first-receipt timing remains
unknown.

Builder windows range from one minute to 168 hours, default one hour. Their
denominator is canonical selected commitments first observed by this collector
within the selected network/mode/source/window. Retrieval and fully healthy
ratios keep unknown observations in the denominator. P50/P95/P99 use comparable
non-null samples only. The uint64-max builder index is labeled self-build.
These are observation statistics, not builder reputation or misconduct scores.

Alerts retain first detection, current active state, and resolution. Orphaned
roots retain evidence and resolve active alerts. Durable counters count unique
roots ever observed with each outcome, including later resolved or orphaned
cases; gauges describe current canonical state. The latency histogram retains
the first comparable sample per root.

## API

All scoped reads require `network=sepolia` for the default instance. Optional
`mode=live|replay|synthetic` defaults to live, and `source` defaults to the
configured source ID. Lists use `limit=1..200`, default 50.

| Route | Result |
| --- | --- |
| `GET /api/v1/slots` | Recent per-root lifecycle states |
| `GET /api/v1/payloadwatch/slots/{slot}` | Retained roots for a slot |
| `GET /api/v1/payloadwatch/slots/{slot}/timeline` | Journal entries, paginated with `after=SEQUENCE` |
| `GET /api/v1/builders[/{builder}]` | Observation ratios, counts, and percentiles; optional `window=1h` |
| `GET /api/v1/alerts` | Active and resolved alerts |
| `GET /api/v1/collector` | Configured source, checkpoint, poll/stream status, and policy |
| `GET /api/v1/live` | Resumable journal and current-state snapshots |
| `GET /metrics` | Prometheus text for the configured live source only |

`GET /api/v1/slots/{slot}` remains the Phase 2 snapshot route with HTTP 409 for
ambiguous roots. It is distinct from the PayloadWatch projection endpoint.

SSE `observation` messages have durable numeric IDs and `{sequence,event}` data.
Use `Last-Event-ID: N` or `after=N` on reconnect; the header takes precedence.
Queries retain network/mode/source scope. `snapshot` messages have no ID and
contain the latest 50 states and 50 alerts. Heartbeat comments keep connections
active. The stream has no ordinary 90-second request deadline; each write has a
10-second deadline, and shutdown cancels the stream.

Prometheus names use the `rooted_` prefix. `/metrics` always reads the configured
live source, so replay/synthetic data cannot inflate its counters. A connected
Rooted API stream does not establish that the upstream Beacon stream is healthy.

## Synthetic demonstration

Create a fresh dataset, import it, then inspect exactly that synthetic source:

```sh
python3 scripts/make_payloadwatch_replay.py \
  --source phase3-demo-20261106 --output .tools/payloadwatch-demo.json
.tools/rooted replay .tools/payloadwatch-demo.json
python3 scripts/smoke_phase3.py --source phase3-demo-20261106
```

Choose a new source and output for another experiment. The generator refuses
to overwrite existing files and writes only inside Rooted. The CLI accepts
matching-network replay/synthetic datasets up to 32 MiB, rejects live mode and
mixed identities, and limits fixture-policy overrides to synthetic evidence.
Re-importing identical evidence is additive/idempotent. It is a trusted local
operation, not an HTTP write endpoint or a source of verified chain signatures.

The seven cases cover healthy, late, missing, mismatched payload, invalid
execution, collector outage, and negative PTC/blob votes. There are 23 unique
events plus one duplicate, with reversed delivery order. The smoke checks
seven observations, one healthy state, two failed states, and four comparable
timing samples. The synthetic policy never changes live quorum configuration.

The Go tests read `internal/payloadwatch/testdata/synthetic.json`, generated by
the same script with `--source phase3-demo` (the source the dashboard and
`scripts/smoke_phase6.py` select). To refresh it, delete the file and rerun the
generator with that source and output; all timestamps are the generation time.

## Verification

```sh
go test -race ./...
go vet ./...
TEST_DATABASE_URL="$DATABASE_URL" go test -race ./internal/payloadwatch ./internal/api ./internal/storage
```

Pure tests cover event parsing, lifecycle semantics, scope validation, JSON
precision, duplicate identity, disabled quorum, fixture decoding, and bounded
input. PostgreSQL tests additionally cover durable journals, reorgs, counters,
alert resolution, checkpoints, stream recovery/startup, builder aggregates,
API routes, and SSE resume. They skip explicitly without `TEST_DATABASE_URL`.

`ROOTED_TEST_LIVE_STREAM=1` additionally enables the bounded live-node startup
test. It needs configured endpoints and a test database; it writes only to an
isolated schema. Local synthetic/reducer results must not be labeled fresh
network verification. See [PHASE3_VERIFICATION.md](verification/PHASE3_VERIFICATION.md) for
the checks run on November 6, 2026: database-backed tests, the opt-in live
stream test, a live `serve` with polling `ok` and streaming `connected`, and
both smoke scripts.
