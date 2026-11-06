# Phase 2 verification

Date: November 6, 2026.

Phase 2 is the Rooted backend core: the CLI, first embedded migration, slot
ingestion, PostgreSQL snapshots, the slot API, and smoke tooling.

## Implemented

- `cmd/rooted`: `serve`, `migrate`, `ingest SLOT`, and help, with argument
  validation before database work, JSON logging, startup checks, and graceful
  signal handling (SIGINT and SIGTERM).
- Configuration through `DATABASE_URL` and `ROOTED_*`, with chain, genesis,
  endpoint, listener, and timeout validation. Go does not load `.env` itself.
- Beacon/execution HTTP clients with bounded responses and timeouts, sanitized
  source origins, safe error messages, and injectable transports for testing.
- Slot → immutable Beacon root → selected commitment → payload envelope →
  execution block correlation, preserving unknown values and included PTC
  evidence.
- Fork-aware PostgreSQL snapshots and raw evidence, atomic saves, canonical
  JSON digests with exact numeric preservation, stale-fetch protection, and
  migration locking.
- `GET /health`, `POST /api/v1/slots/{slot}/ingest`, and
  `GET /api/v1/slots/{slot}` with explicit network and optional root selection.
- A loopback PostgreSQL 16 Compose service with Rooted database/user/volume
  defaults and `.env.example`.
- `scripts/smoke_phase2.py`, with isolated run directories and a separate check
  after an actual application restart.

## Live smoke, November 6, 2026

`rooted serve` ran on `127.0.0.1:8085` against a dedicated database and the
Sepolia Nimbus/Geth nodes in [SEPOLIA_NODE.md](../SEPOLIA_NODE.md), with the
PayloadWatch and frame workers at their `.env` defaults.

| Command | Result |
| --- | --- |
| `python3 scripts/smoke_phase2.py --base http://127.0.0.1:8085 --slot 11518281` | Passed. Slot 11518281, root `0x134b9a5b…bdde0`, payload `0x45f25703…3b83b`; repeated ingestion kept the same root; status `observed`, identifiers matched; live timing and health fields stayed null |
| SIGTERM, start `rooted serve` again, then `python3 scripts/smoke_phase2.py --verify-restart 20261106T081652Z-5be5ddea` | Passed: `/health` ok and the stored slot response was identical after the restart |

The run evidence is under `.tools/phase2-smoke/20261106T081652Z-5be5ddea/`
(gitignored).

## Go tests

```sh
TEST_DATABASE_URL=postgres://rooted:rooted-local-only@127.0.0.1:54330/rooted_w6?sslmode=disable \
  go test -race -count=1 -v ./internal/api/...
```

On November 6, 2026 (08:53 UTC) the `internal/api` package had 50 passing
test/subtest results and no failures. `TestRecordedSlotPostgresRoundTrip` reads
its slot and root from `internal/ingest/testdata` (recaptured from the Nimbus
node at slot 11518268) and covers the recorded collector → HTTP handler →
database path, including repeated ingestion and a read after reopening every
database connection. `TestPostgresPersistence` in `internal/storage` also
passed in the same session.

The recorded HTTP tests use captured source responses through an in-process
`http.RoundTripper`. Recorded fixtures exercise captured responses; they are
not fresh chain observations.

A separate assessment of `internal/ingest` and `internal/bal`, with its own
live smoke run, is recorded in `demo/phase2/status.json`.

## Not run for this document

- `docker compose config` validation.
- Python regression suites outside the smoke scripts.

## Reproduce

Follow [BACKEND.md](../BACKEND.md) to start PostgreSQL, load `.env`
(`set -a; . ./.env; set +a`), and start `rooted serve`. Then:

```sh
TEST_DATABASE_URL="$DATABASE_URL" go test -race ./internal/storage ./internal/api
python3 scripts/smoke_phase2.py --slot RECENT_AVAILABLE_SLOT
# Restart the Rooted process after the smoke run, then use its run ID:
python3 scripts/smoke_phase2.py --verify-restart RUN_ID
```

Pick a slot a few slots behind the current Nimbus head so its payload envelope
and execution block are available.
