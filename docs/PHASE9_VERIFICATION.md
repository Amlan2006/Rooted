# Phase 9 — native replay profiler

Rooted includes a native replay baseline, the capture service, immutable capture storage, saved-input reruns, CLI/API routes,
and the execution-profiler dashboard. The separate `workloads/profiler` module
remains pinned to Geth v1.17.10.

## Implemented measurements

- Two warmup pairs and seven alternating instrumented/control pairs, each
  starting from a copy of the same trace-seeded in-memory baseline.
- Complete transaction order, transaction/receipt roots, bound ancestor chain,
  gas, cumulative gas, execution status, and emitted-log validation.
- Monotonic timers around ApplyMessage, root EVM windows, thirteen delegated
  StateDB methods, and separate transaction finalization.
- A representative median-total sample partitioned into four nonoverlapping
  intervals. Nested state/EVM totals are never simply added together.
- Slowest transactions, method counters, control throughput, instrumentation
  overhead, client/module version, and replay-machine hardware context.
- View-only assumed budget minus observed P95. It is not a measured protocol
  deadline or production execution-window margin.
- Immutable gzip captures with SHA-256 identity, reruns without node state
  access, and exact-block links to live BAL/PayloadWatch observations.

Physical disk I/O, complete production import, full state-root processing,
dedicated BAL timings, exclusive EVM compute, protocol deadline margin, and
parallel speedup remain unknown. The deeper instrumentation expansion remains
open; the replay baseline does not establish those measurements.

## Verification run on 2026-11-06

On linux/amd64 (8-CPU Intel Xeon Skylake, Go 1.27.2), with a scratch PostgreSQL
database and the live Geth v1.17.10 Sepolia node:

- `(cd workloads/profiler && go build .)` built the native runner against the
  pinned Geth v1.17.10 module. `go test -count=1 ./...` passed all 4 tests,
  including a full replay of the captured 85-transaction block and the rejection
  of mutated receipts, traces, ancestors, and prestate nonces.
- `go test -race -count=1 ./internal/profiler/...` passed with
  `TEST_DATABASE_URL` set (no skips). This covers metric identity/partition
  validation, saved-capture identity and digest guards, ancestor batch binding,
  output bounds, and the PostgreSQL immutable-capture/correlation test. The
  guard test now requires the specific guard error. With the digest guard
  removed through a `go test -overlay`, the test failed as intended.
- `node --import tsx --test tests/profiler.test.ts` passed (4 tests).
- `.tools/rooted profile` captured and measured Sepolia block 12075311
  (`0x5003b43a…326cdc`, 85 transactions) within the node's state window.
  `.tools/rooted profile-capture` exported its input. These are
  `demo/profiler/profile.json` and `demo/profiler/replay-input.json.gz`; the
  decompressed input's SHA-256 equals `capture_digest`.
- `.tools/rooted profile-replay` reran that saved capture twice with the same
  digest. After `.tools/rooted analyze` saved a live BAL analysis of the block,
  the second rerun linked that exact analysis.
- `scripts/smoke_phases8_9.py` against `.tools/rooted serve` on the same
  database returned `passed`, including the saved profile capture digest and
  timer reconciliation.

Measured values are in [EXECUTION_PROFILER.md](EXECUTION_PROFILER.md#recorded-measurements-and-diagnosis).
The dashboard browser flow, the production frontend build, and node-side
production instrumentation were not exercised.

## Build and run

From `Rooted`:

```sh
mkdir -p .tools
(cd workloads/profiler && go build -o ../../.tools/rooted-replay .)
go build -o .tools/rooted ./cmd/rooted
set -a
source .env
set +a
.tools/rooted serve
```

In another terminal with the same exported environment:

```sh
.tools/rooted profile RECENT_NONEMPTY_BLOCK_HASH
.tools/rooted profile-replay SAVED_PROFILE_ID
.tools/rooted profile-capture SAVED_PROFILE_ID > .tools/replay-input.json
python3 scripts/smoke_phases8_9.py
```

Choose a recent canonical Sepolia block with at most 128 transactions whose
execution state is still available. The live capture adapter requires Geth
1.17.10. The existing **Execution profiler** dashboard view provides the same
capture, rerun, report, and download operations.

```sh
(cd workloads/profiler && go test ./...)
TEST_DATABASE_URL="$DATABASE_URL" go test -race -count=1 ./internal/profiler/... ./internal/providers/...
```

See [EXECUTION_PROFILER.md](EXECUTION_PROFILER.md) for exact timer boundaries.
