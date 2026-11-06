# Rooted backend

Phase 2 provides a Go service and CLI for verified slot snapshots backed by
PostgreSQL. It requires Go 1.25+ and PostgreSQL 16+ (locally through Docker
Compose or an existing database). Phase 1 probes remain independent of the
backend. Phase 3 adds [PayloadWatch](PAYLOADWATCH.md): background polling and
Beacon streaming, lifecycle journals, builder observations, alerts, metrics,
and a resumable SSE feed.
Phase 4 adds [Frame monitoring](FRAME_MONITOR.md): independent gateway/miner
identity checks, admission polling, durable lifecycle streams, receipt proof,
submission recording, incidents, and frame read APIs.

## Start locally

From `Rooted`:

The existing local `.env` selects the tunneled Nimbus/Geth nodes. See
[SEPOLIA_NODE.md](SEPOLIA_NODE.md) for the node addresses, retained analysis
checkpoint, source isolation, and connection checks. Keep that file when it
already exists; `.env.example` contains the public-provider polling defaults.

```sh
test -f .env || cp .env.example .env
set -a
. ./.env
set +a
docker compose --project-name rooted up -d --wait postgres
mkdir -p .tools
go build -o .tools/rooted ./cmd/rooted
.tools/rooted serve
```

Review the configuration before exporting it. The Go process reads exported
variables; it does not load `.env` automatically. Compose reads `.env` for its
database password and `ROOTED_DB_PORT`, the host port it publishes PostgreSQL
on (`127.0.0.1:${ROOTED_DB_PORT:-54329}`, default 54329). If you change
`ROOTED_DB_PORT`, change the port in `DATABASE_URL` to match. The API binds
`127.0.0.1:8080` by default (`ROOTED_LISTEN_ADDR`). An existing database can be
supplied through `DATABASE_URL` instead of starting Compose.

Startup connects to PostgreSQL and applies embedded SQL migrations under a
transaction and advisory lock before opening the HTTP listener. The named
`rooted_postgres` volume retains data across service restarts. SIGINT/SIGTERM
cancels active upstream requests, drains the HTTP service, and closes the pool.
With Phase 3 enabled, it also starts collector workers and waits for their
shutdown before closing PostgreSQL. Set `ROOTED_WATCH_ENABLED=false` for
stored-data-only operation, or `ROOTED_STREAM_ENABLED=false` for polling only.
Set `ROOTED_FRAME_ENABLED=false` to disable frame workers, or
`ROOTED_FRAME_STREAM_ENABLED=false` for frame polling without WebSocket
collection. Frame configuration is deliberately separate from Sepolia.

## Use

```sh
.tools/rooted help
.tools/rooted migrate
.tools/rooted ingest 11518287
curl -sS http://127.0.0.1:8080/health
curl -sS -X POST 'http://127.0.0.1:8080/api/v1/slots/11518287/ingest?network=sepolia'
curl -sS 'http://127.0.0.1:8080/api/v1/slots/11518287?network=sepolia'
```

Frame commands are explicit:

```sh
.tools/rooted frame-sync gateway
.tools/rooted frame-sync miner
.tools/rooted frame-submit /absolute/path/signed.json EXPECTED_HASH gateway
```

Slot 11518287 is the slot the November 6, 2026 Phase 2 smoke run ingested and
read back. Use a recent slot if your providers no longer serve it. Ingestion reads Ethereum APIs and writes Rooted's
database; it does not submit an Ethereum transaction. All slot HTTP requests
require the configured network explicitly. Competing roots remain stored;
select `block_root=0x...` if a read returns HTTP 409.

REST types and errors are in [API.md](API.md). These development endpoints have
no authentication and should be used on loopback or trusted private
infrastructure.

Frame CLI commands verify the configured frame chain and genesis before
collecting or submitting. `frame-submit` accepts externally signed JSON only,
records the attempt before the RPC call, checks the returned hash, and never
stores a private key or retries automatically. An RPC acknowledgment remains
separate from source admission and canonical receipt proof. The frame API is
documented in [API.md](API.md), and lifecycle evidence in
[FRAME_MONITOR.md](FRAME_MONITOR.md).

## Evidence semantics

The collector checks Beacon genesis and execution chain ID, resolves a slot to
its immutable Beacon root, then retrieves the Beacon block, matching payload
envelope, and execution block by the committed payload hash. It checks the
available slot/root/hash/builder/parent/number/state identities before saving.

Each `(network, slot, block_root)` has one current snapshot. Raw JSON records
are stored atomically with it and deduplicated by kind, sanitized origin, and
canonical JSON digest while preserving large numeric values. Older fetches
cannot overwrite newer observations. A non-404 upstream failure saves no
partial snapshot; an unavailable envelope or null execution block can produce
an explicit pending observation.

`observed` means matching payload and execution identifiers were retrieved.
Original arrival time, reveal latency, target-slot PTC timeliness, blob verdict,
and independent execution validity stay null. Included PTC aggregates keep
their own slot/root. A provider 404 does not establish that a slot was skipped.

## Checks

```sh
go test ./...
go test -race ./...
go vet ./...
TEST_DATABASE_URL="$DATABASE_URL" go test -race ./internal/storage ./internal/api
python3 scripts/smoke_phase2.py --slot RECENT_SLOT
```

The PostgreSQL tests each create and drop a uniquely named test schema. They
verify repeat migrations, raw evidence deduplication, large integers, stale
fetch protection, rollback, network/fork separation, and a captured-slot
collector → API → PostgreSQL → read-after-reconnection round trip.
Without `TEST_DATABASE_URL`, those two tests explicitly skip; a passing unit
suite alone does not establish persistence.

After a successful smoke run, restart the Go service and use its printed run ID:

```sh
python3 scripts/smoke_phase2.py --verify-restart RUN_ID
```

This compares the saved response before and after a real service restart. Every
smoke run has a separate evidence directory under `.tools/phase2-smoke/`; it
never overwrites an earlier run. Run results
and environment limitations are recorded in [PHASE2_VERIFICATION.md](PHASE2_VERIFICATION.md).

Phase 4 offline and captured evidence is recorded in
[PHASE4_VERIFICATION.md](PHASE4_VERIFICATION.md). Database-backed frame
tests use `TEST_DATABASE_URL` when available; without it they skip explicitly.

Phase 5 adds [BAL and Uniswap analysis](BAL_ANALYZER.md). The live collector
uses the configured Sepolia execution RPC and trace endpoint, verifies the
analysis anchor, decodes native EIP-7928 JSON or Beacon-envelope RLP, and
persists versioned reports plus raw evidence. `analyze-fork` uses only the
loopback `ROOTED_FORK_RPC` and labels reports `network=sepolia-fork` and
`mode=fork`; it never presents fork traces as native BAL evidence.

```sh
.tools/rooted analyze BLOCK_HASH [TX_HASH,TX_HASH,...]
.tools/rooted analyze-fork BLOCK_HASH TX_HASH_1,TX_HASH_2
python3 scripts/run_uniswap_workload.py
python3 scripts/smoke_phase5.py --workload .tools/uniswap-workload/summary.json
```

The analyzer keeps native committed changes, block-level read-only keys,
trace-attributed reads, committed diff writes, reverted-frame reads, and
Uniswap call/event evidence separate. Graphs report observed RAW/WAR/WAW
location conflicts with explicit partial coverage; theoretical speedup remains
null. PostgreSQL migration 004 stores current reports, raw-response digests,
and semantic report versions.

Phase 6 adds the Next.js dashboard under `dashboard/`. Configure the server-only
`ROOTED_BACKEND_URL` origin, install dependencies, and run:

```sh
npm install --prefix dashboard
npm run dev --prefix dashboard
```

The dashboard proxy is same-origin and route allowlisted; it forwards SSE
resume cursors, rejects arbitrary URLs and mutations, and keeps backend traffic
separate from browser Nox reads. See [DASHBOARD.md](DASHBOARD.md) for the full
view inventory and private transport boundary.

Phase 8 adds the provider-comparison backend and connects the existing guided
investigation, exact conflict explanations, contention breakdown, workload
comparison, and downloads. Phase 9 adds the replay capture service and separate
native runner. Build `.tools/rooted-replay` from `workloads/profiler` before
requesting a profile. The main backend still builds independently of Geth.
Startup applies migrations 006 and 007; CRE migration 005 remains deferred.

See [PHASE8_VERIFICATION.md](PHASE8_VERIFICATION.md) and
[PHASE9_VERIFICATION.md](PHASE9_VERIFICATION.md) for setup, current checks, and
the native replay runner. Existing node and database settings in the local
`.env` are preserved.
