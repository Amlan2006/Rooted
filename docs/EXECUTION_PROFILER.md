# Execution profiler — native replay baseline

Phase 9 of Rooted: actual native Geth replay measurements of captured Sepolia blocks. It does not claim production block-import timing, physical database performance, full state-root validation, or parallel-execution speedup. See [PHASE9_VERIFICATION.md](verification/PHASE9_VERIFICATION.md) for the checks run on 2026-11-06 and the remaining production-instrumentation limits.

## What is measured

The separate `workloads/profiler` Go module pins the official **Geth v1.17.10** library. The running server node is never patched or replaced. The backend captures a block's transactions, default prestate traces, receipts, and 256 bound ancestor headers. A local native process reconstructs the transaction-touched initial state and runs all transactions in their original order.

Every warmup and measured replay verifies:

- The execution header's recomputed hash and the complete ancestor parent chain used by `BLOCKHASH`.
- Transaction and receipt trie roots against the header, and transaction/trace/receipt identities and order.
- Per-transaction gas, success/revert status, and emitted log addresses/topics/data against captured receipts.
- Receipt cumulative gas and the replayed block's gas dimensions, including Amsterdam gas-pool semantics.

Missing state, changed code/nonce, invalid receipts, unsupported client versions, identity mismatches, and invalid timers produce an error; they are never replaced by gas-derived or RPC-derived timing estimates. The initial state is supplied by the trusted node's prestate tracer, not authenticated against the complete parent state root. Account fields and storage keys take their earliest observed pre-transaction value; later transactions' traces do not overwrite that baseline.

Two warmup pairs precede seven measured instrumented/control pairs. Every pair starts from a copy of the same committed in-memory baseline. Order alternates to reduce one-sided cache-order bias. Warmups, state capture/restoration, signer construction, EVM object construction, receipt comparisons, and log validation are outside the timers.

| Timer | Boundary and interpretation |
| --- | --- |
| ApplyMessage | Monotonic elapsed time immediately around each native `core.ApplyMessage`, summed over transactions. Includes transaction processing, root EVM work, gas/fee handling, and instrumented timer overhead. |
| Root EVM call | Native depth-zero `OnEnter` → `OnExit` windows, including nested calls, native/precompile work, tracing overhead, and state calls inside them. This is not exclusive arithmetic CPU time. |
| Intercepted state methods | Monotonic intervals immediately around 13 delegated StateDB methods, including reads, writes, balances, nonces, code, and existence. Delegation goes to the unwrapped StateDB, so inner native methods are not counted twice. Other StateDB methods remain unclassified. |
| Transaction finalization | A separate timer around `StateDB.Finalise`. This is disjoint from ApplyMessage and does not include full state-root hashing or persistent commit. |
| Control ApplyMessage | Same restored input and validation with state timing wrappers and EVM hooks disabled. This reveals measurement overhead/noise; it is not a faster implementation or a parallel-execution result. |

In-memory state calls can include RAM-backed trie/cache work. They are **not physical disk I/O**. The replay machine's OS, architecture, CPU model, logical CPU count, Go version, Geth library version/module checksum, exact payload identity, and original collection-client version are retained. The remote server's hardware and timing are not inferred from them.

The dashboard partitions one representative sample—the sample with median total ApplyMessage time—into four nonoverlapping slices:

1. Root EVM window outside intercepted state calls.
2. Intercepted state calls inside the root EVM window.
3. Intercepted state calls outside that window.
4. Remaining ApplyMessage processing and timer bookkeeping.

These slices sum to that sample's ApplyMessage total. Raw EVM and total state timers overlap and cannot be added together. Medians of separate per-transaction or per-component measurements do not necessarily sum to a block median.

## Build and run

From the repository root, with Go 1.25+ and an existing configured PostgreSQL database:

```sh
(cd workloads/profiler && \
  GOCACHE="$PWD/../../.tools/go-build" GOMODCACHE="$PWD/../../.tools/go-mod" \
  go build -o ../../.tools/rooted-replay .)
GOCACHE="$PWD/.tools/go-build" GOMODCACHE="$PWD/.tools/go-mod" \
  go build -o .tools/rooted ./cmd/rooted
```

The first native build downloads the pinned Geth dependency and its dependencies. They remain isolated from the main backend's module. `ROOTED_REPLAY_BINARY` defaults to `.tools/rooted-replay`; use an absolute path when launching the backend from another directory.

Restart the Go backend, then open **Execution profiler**, or `http://127.0.0.1:3000/?view=profiler`.

- Enter a **recent immutable Sepolia block hash** with 1–128 transactions and choose **Profile block replay**. Collection uses the configured backend execution RPC directly and requires Geth 1.17.10 with `eth_getBlockReceipts` and `debug_traceBlockByHash`/`prestateTracer` available.
- Read measured/control samples, hardware context, slowest transactions, intercepted state operations, and exact-hash BAL/PayloadWatch correlations.
- **Rerun saved capture** restores the same input and saves a new measured report. It requires the native runner and database, but no node state access, so it still works after the node has pruned that block's state.
- Download the measured report and replay input for inspection. New measurements are immutable and earlier results remain selectable.

A node may expose old block bodies while lacking state required to trace them. That is a capture failure, not proof that the replay runner is broken. Choose a newer block or reuse a previously saved capture. The adapter checks Sepolia chain ID and the configured analysis checkpoint, pins the block hash, and checks canonical identity again after capture.

CLI equivalents:

```sh
set -a
. ./.env
set +a
.tools/rooted profile BLOCK_HASH
.tools/rooted profile-replay SAVED_PROFILE_ID
.tools/rooted profile-capture SAVED_PROFILE_ID > .tools/replay-input.json
.tools/rooted-replay < .tools/replay-input.json > .tools/new-native-metrics.json
```

Backend-native jobs accept only a block hash or saved profile identity. Binary path and node URLs are operator configuration. One HTTP profiling job runs at a time per process, with an 85-second budget and bounded input/output. Captures are at most 32 MiB; ancestor batches are capped at 16 MiB. The runner restores state outside timed boundaries and has no network client. Failed jobs save no fabricated metrics.

## Saved evidence and correlation

`execution_profiles` stores immutable replay-mode reports and gzip-compressed capture bytes. SHA-256 identifies the exact original replay input. Re-running a capture retains its original capture timestamp and digest but records a new measurement time and identifier. URLs, endpoint credentials, hostnames and raw upstream diagnostic messages are absent from exported reports and replay inputs.

BAL links require `network=sepolia`, original `mode=live`, and the exact execution block hash. PayloadWatch links additionally retain their Beacon block roots, slots, live mode, and per-report source aliases. These are separate live observations attached to a replay benchmark; a matching identity is not a causal claim about delivery latency. Missing correlations remain absent. At most 20 records per module are linked.

The optional dashboard budget is a **view-only assumption** over the sum of timed ApplyMessage windows. Its margin is `assumed milliseconds − observed P95 ApplyMessage milliseconds`. It excludes capture/setup/finalization and does not represent a protocol slot deadline or predict inclusion. With only seven samples, nearest-rank P95 is the observed maximum, not a stable tail-latency estimate.

## Recorded measurements and diagnosis

`demo/profiler/profile.json` and `demo/profiler/replay-input.json.gz` are one live capture and measurement made on 2026-11-06 with `.tools/rooted profile` and exported with `.tools/rooted profile-capture`. The block is Sepolia `12075311` (`0x5003b43a843799fd3043275a52cfc9f1d16907e685e0781b0cb13aa21a326cdc`, slot 11518264): 85 transactions and 60,112,779 gas. Collection used the local Geth v1.17.10 node (`capture_mode: live_rpc_capture`). The SHA-256 of the decompressed replay input equals the report's `capture_digest` (`faf10482…266e11a`).

That run measured an instrumented ApplyMessage median of **599.651 ms**, an uninstrumented control median of **193.021 ms**, and instrumented P95 **640.106 ms**. The replay host was linux/amd64, an 8-CPU Intel Xeon (Skylake, IBRS, no TSX), Go 1.27.2. The 3.11× instrumented/control ratio is instrumentation overhead, not an execution improvement. A rerun of the same saved capture minutes later measured 621.711 ms instrumented and 191.970 ms control medians. Exact timing values are not reproducibility assertions.

For the representative sample, 589.771 ms (98.4%) fell in the root EVM window outside intercepted state calls. Intercepted state intervals totaled about 7.955 ms. This supports a narrow diagnosis: the measured instrumented replay interval was dominated by root EVM work and tracing overhead rather than the intercepted in-memory state methods. It does **not** prove that the production node is CPU-bound, that physical database I/O is cheap, or that this block was slow in production.

On the same day, `.tools/rooted profile-replay` reran the saved capture twice (`capture_mode: recorded_capture`, same digest, new measurement identities). After `.tools/rooted analyze` saved a live BAL analysis of the same block, the second rerun linked exactly that analysis ID. No PayloadWatch observation for slot 11518264 existed in that database, so `payload_observations` stayed empty. The dashboard browser flow was not exercised in this check.

## Unsupported production measurements

The following remain unknown, rather than zero:

- Physical database reads/writes and cold-cache disk behavior.
- Full block import, header/consensus validation, signature-recovery timer, state-root hashing/commit, and system calls outside transactions.
- Dedicated BAL generation/validation timings and measured production execution deadline margins.
- Exclusive EVM compute time and demonstrated parallel-execution speedup.

Geth/Nimbus running normally does not automatically expose these measurements. Production diagnosis requires additional compatible node-side instrumentation or controlled full-state replay. Accordingly the deeper Phase 9 acceptance items remain open in the build plan.

## API and verification

- `POST /api/v1/profiles?network=sepolia&mode=replay`, body `{ "block_hash": "0x..." }`.
- `POST /api/v1/profiles/{id}/replay?network=sepolia&mode=replay`, body `{}`.
- `GET /api/v1/profiles?network=sepolia&mode=replay`, latest 20 saved measurements.
- `GET /api/v1/profiles/{id}?network=sepolia&mode=replay`.
- `GET /api/v1/profiles/{id}/capture?network=sepolia&mode=replay`, original replay JSON.

```sh
export DATABASE_URL=postgres://...   # a scratch database; store tests use temporary schemas
TEST_DATABASE_URL="$DATABASE_URL" go test -race -count=1 ./internal/profiler/...
(cd workloads/profiler && go test -count=1 ./...)
(cd dashboard && node --import tsx --test tests/profiler.test.ts)
```

Native tests actually replay the captured block (all 85 transactions, seven measured/control pairs), check interval reconciliation and reject changed prestates, receipt roots and bindings. Backend tests cover durable immutable captures, mode/digest checks and exact correlation scope. Frontend tests cover interval partitions, identity checks, assumed budgets and the fixed-origin request proxy. See the official [Geth tracing API](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-debug) and [native tracing hooks](https://github.com/ethereum/go-ethereum/blob/v1.17.10/core/tracing/hooks.go) for the source interfaces used by the implementation.
