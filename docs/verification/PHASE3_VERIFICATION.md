# Phase 3 verification

Date: November 6, 2026 (checks run 08:14-08:20 UTC).

PayloadWatch is implemented in Rooted: the collector, durable event engine,
lifecycle projection, builder queries, alerts, metrics, replay tooling,
configuration, CLI startup, and scoped REST/SSE routes. Every result below was
produced on this date against a local PostgreSQL 16 database and the Sepolia
Nimbus/Geth nodes described in [SEPOLIA_NODE.md](../SEPOLIA_NODE.md).

## Implemented

- Migration 002 adds `pw_events`, `pw_states`, `pw_sessions`, `pw_outcomes`,
  `pw_latency_samples`, `pw_alerts`, and `pw_progress`.
- Automatic polling with recent-root reconciliation, bounded catchup, durable
  checkpoints, and independently network-verified event streaming.
- Reconnect/backoff, idle watchdog, restart session closure, and graceful
  cancellation before the PostgreSQL pool closes.
- Duplicate-safe journal insertion and per-root projection, keeping network,
  mode, source, slot, root, and event provenance distinct.
- Matching commitment/payload/validation evidence, same-session receipt timing,
  PTC union/conflict handling, explicit unknowns, coverage-aware missing/late
  detection, and retained orphaned evidence.
- Canonical builder observation ratios, sample denominators, P50/P95/P99,
  self-build labels, active/resolved alerts, and live-only `rooted_` metrics.
- `/api/v1/slots`, PayloadWatch per-slot/timeline reads, builders, alerts,
  collector status, resumable `/api/v1/live`, and `/metrics`.
- Manual Phase 2 ingestion also derives its lifecycle projection.
- `rooted replay PATH.json`, strict 32 MiB replay validation, synthetic-only
  fixture policy, fresh dataset generation, and read-only API/SSE smoke checks.

## Database-backed tests

```sh
TEST_DATABASE_URL=postgres://rooted:rooted-local-only@127.0.0.1:54330/rooted_w5?sslmode=disable \
  go test -race -count=1 -v ./internal/payloadwatch/... ./internal/api/...
```

| Package | Result |
| --- | --- |
| `internal/payloadwatch` | 38 test/subtest results passed, zero failed; the opt-in live test skipped here and was run separately |
| `internal/api` | 50 test/subtest results passed, zero failed (re-run at 08:52 UTC against `rooted_w6`, see below) |
| Opt-in live stream (`ROOTED_TEST_LIVE_STREAM=1`, `.env` loaded) | Passed: verified Nimbus SSE subscription connected and persisted events in an isolated schema |
| `go vet ./internal/payloadwatch/` | Passed |

Every database test ran in its own throwaway schema. The PostgreSQL tests that
passed cover durable journals, reorgs, counters, alert resolution, checkpoint
recovery, stream disconnect/unavailable handling, verified stream startup
while polling is blocked, network-mismatch refusal, replay isolation, the
synthetic fixture through the real engine, builder aggregates, all PayloadWatch
API routes, live-only metrics, and SSE resume.

`TestPollingCheckpointRecovery` and `TestRecordedSlotPostgresRoundTrip` read
their slot and root from `internal/ingest/testdata`, which were recaptured from
the Nimbus node today (slot 11518268). The first run at 08:19 UTC failed
`TestRecordedSlotPostgresRoundTrip` because it still had a fixed slot; after it
was changed to read the fixtures, the same command was run again at 08:52 UTC
against `rooted_w6` and both packages passed (PayloadWatch 38 passed, the
opt-in live test skipped).

## Live collection

`rooted serve` ran on `127.0.0.1:8085` with a dedicated database and the
`.env` node settings (source `sepolia-nimbus-geth-1`, PTC quorum 0), first from
08:14:45 UTC, then again from 08:17:32 UTC after a SIGTERM restart.

| Check | Result |
| --- | --- |
| `GET /api/v1/collector?network=sepolia`, first run | `poll_status=ok`, `stream_status=connected`, last slot 11518284 |
| Same, after restart | `poll_status=ok`, `stream_status=connected`, last slot 11518296 |
| Stream sessions | First session closed at shutdown; second session opened on restart |
| Live states, slots 11518270-11518297 | 27 roots: 26 `pending/revealed`, one `pending/unknown`; zero alerts |
| Same-session receipt timing | 22 comparable samples, 67-425 ms; polling-only slots kept timing unknown |
| `/metrics` | `rooted_` counters and latency histogram for the live source only; `rooted_event_stream_connected 1` |

Live health stays `pending` because PTC quorum is zero by configuration. The
latencies are collector receipt intervals, not builder publication times.

## Smoke checks against the live server

| Command | Result |
| --- | --- |
| `python3 scripts/make_payloadwatch_replay.py --source phase3-demo-20261106-w5 --output .tools/phase3/payloadwatch-phase3-demo-20261106-w5.json` | 24 labeled synthetic events; a second run to an existing file was refused |
| `rooted replay` of that file, twice | First: 23 inserted, one duplicate. Second: zero inserted, 24 duplicates |
| `python3 scripts/smoke_phase3.py --base http://127.0.0.1:8085 --source phase3-demo-20261106-w5` | Passed: seven synthetic states, builder counts, timeline cursor, live/synthetic scope separation, metrics isolation, SSE resume |
| `python3 scripts/smoke_phase2.py --base http://127.0.0.1:8085 --slot 11518281` | Passed (see [PHASE2_VERIFICATION.md](PHASE2_VERIFICATION.md)) |
| `python3 scripts/smoke_phase2.py --verify-restart 20261106T081652Z-5be5ddea` after the restart | Passed: identical stored response |

## Synthetic lifecycle evidence

`internal/payloadwatch/testdata/synthetic.json` is a synthetic dataset
generated today by `scripts/make_payloadwatch_replay.py --source phase3-demo`.
Its slots, roots, and hashes are generated labels, not Sepolia data.

`demo/phase3/offline-states.json` (from that fixture) and
`demo/phase3/generated-states.json` (from the separately generated
`phase3-demo-20261106-w5` dataset) are reducer outputs. Each says
`mode=synthetic` and `verification=offline_reducer_only`. Regenerate them with:

```sh
go test -count=1 -v -run TestSyntheticScenariosWithoutDatabase ./internal/payloadwatch/
ROOTED_TEST_DATASET=$PWD/.tools/phase3/DATASET.json \
  go test -count=1 -v -run TestSyntheticScenariosWithoutDatabase ./internal/payloadwatch/
```

Each run logs one `ROOTED_PHASE3_OFFLINE_EVIDENCE=` JSON line; the demo files
are that JSON, indented. Persistence of the same fixture was checked
separately by `TestSyntheticFixture` and `TestPayloadWatchRoutesAndSSE`.

| Slot | Health | Delivery | Scenario |
| --- | --- | --- | --- |
| 101 | healthy | revealed | Matching payload, validity, and configured positive fixture votes |
| 102 | warning | late | Comparable local receipt interval exceeds fixture threshold |
| 103 | warning | missing | Stream activity covers the local deadline without a matching payload |
| 104 | failed | missing | Wrong payload fails the selected commitment |
| 105 | failed | revealed | Payload is present with explicitly invalid execution evidence |
| 106 | pending | pending | Collector coverage stops early; no builder failure inferred |
| 107 | warning | revealed | Payload is present with negative PTC/blob votes |

Both datasets have 23 unique events, one duplicate, and four comparable timing
samples. The fixture has eight committee positions and a six-vote quorum. This
does not change the live default quorum of zero or prove real protocol timing.

## Not verified here

- The full `go test -race ./...` suite; only the two packages above were run.
- A configured non-zero live PTC quorum, so no live `healthy` verdict.
- Live late, missing, mismatch, or invalid-execution cases; none occurred in
  the observed slots, and the synthetic fixture is the only evidence for them.

## Records

Local logs (gitignored) are under `.tools/phase3/20261106/`: the race test
log, live-stream test log, reducer logs, both collector responses, and both
server logs. Smoke reports are under `.tools/phase3-smoke/` and
`.tools/phase2-smoke/`. The machine-readable summary is
`demo/phase3/status.json`.
