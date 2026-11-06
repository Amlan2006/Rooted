# Phase 5 Verification

Every report in `demo/phase5/reference/` was captured on 2026-11-06 from a live
local Sepolia Geth v1.17.10 / Nimbus v26.10.2 pair and from an owned loopback
Anvil 1.9.0 fork of that Geth. The same six top-level files are mirrored in
`demo/phase1/reference/bal-phase5/`. The backend/CLI scope is complete; full
live read attribution and complete execution scheduling are still not claimed.

## Live native BAL

- Network: Sepolia, chain ID 11155111. Analysis anchor `0xa7d8c0`
  (`0x2896cc6e67bae1116829775906356da77d7263646429faebc769b0404ea3ecf2`).
- Block: `0x98399bab67e4e7e0eed93273ab8afd27484b4c67b4b41217830987b1a036fee3`
  (12,075,271, slot 11,518,224), 118 transactions.
- Selected swap: `0xa5022a3a5d0fc3e2faae2af2ec64816d759a4345ec2b71f87eb44dbca7403927`
  (transaction index 63) in the fee-500 v3 pool `0x3289680dd4d6c10bb19b899729cda5eef58aeff1`.
- Geth does not serve `eth_getBlockAccessList`, so the BAL came from Nimbus's
  execution payload envelope (schema `eip-7928-rlp-index-value-v1`): 348
  accounts, 746 normalized changes. Its computed commitment
  `0x207322d7c088d05fc87f8db98e0c0bac4732b7b56795fc7e1533a273d6f1e6b4`
  matches the header's `blockAccessListHash`.
- One v3 Swap event and one internal swap call decoded; the pool was verified
  through factory/token/fee/`getPool` metadata.
- Call, prestate, and opcode traces succeeded for the selected transaction:
  3 attributed storage reads, 11 prestate access candidates, and
  `storage_reads_complete=true`. Geth has no `trace_replayTransaction`, so
  `state_diff_available` is false; the native BAL is the write authority.
- Main graph: 7,205 WAW edges, depth 118, maximum width 1. Storage projection:
  11 WAW edges, depth 3, maximum width 113. `full_dependency_coverage=false`
  and `theoretical_speedup=null`.
- `POST /api/v1/analysis/blocks/{hash}/ingest` (with the selected
  transaction) and `POST /api/v1/analysis/transactions/{tx}/ingest` both
  returned 200 and resolved to the same report ID.

[Compact report](../../demo/phase5/reference/native-summary.json).

## Controlled Uniswap workload

- Anvil 1.9.0, chain 31337, forked from the local Geth at Sepolia block
  12,075,317 (`0x8640c4a49b3397ac92d6fb9d029ea7a30b829698da91e032193301fc46571532`),
  Prague execution rules, opcode step tracing.
- Workload block: `0x9328ccf305e791d718545b1e10351bcb403a463d0e746f8c34ce68c17cc3243a`
  (fork block 12,075,326).
- Four independent sender/harness pairs, all four transactions in that block:
  two swaps in the fee-500 pool, one in the fee-3000 pool
  (`0x6ce0896eae6d4bd668fde41bb784548fb8f59b50`), and one deliberately
  reverted after its pool swap returned.
- Two pools verified. Three committed Swap events, four swap calls, one
  rolled-back call.
- Opcode storage reads and committed diff writes were collected for all four
  transactions. The reverted transaction's pool/token storage writes are
  absent from the committed diff; its reads remain visible.
- Main graph: 12 RAW, 4 WAR, 10 WAW location-level edges; depth 4, maximum
  width 1. Fee-recipient balance writes are included.
- Storage projection: 12 RAW, 4 WAR, 4 WAW; depth 3, maximum width 2. These
  are partial evidence metrics, not a speedup or an execution schedule.
- `mode=fork`, `native_bal=null`, `full_dependency_coverage=false`.

[Report, raw compressed responses, workload summary, persistence and API checks](../../demo/phase5/reference/).

## Persistence and API

Run against a dedicated PostgreSQL database and a backend on a loopback port:

- Repeat ingestion of both the fork and the live report left
  `analysis_raw`/`analysis_versions` counts unchanged (fork 44/1, live 20/1),
  recorded in `persistence-check.json`.
- `scripts/smoke_phase5.py` passed against the running backend
  (`api-check.json`) and again after stopping and restarting the process
  (`persistence-check.json`): persisted native and fork views, exact
  same-pool RAW edge, balance edge, revert handling, evidence paging, and
  fork/live scope isolation (404/400).
- `fork-evidence.json.gz` is the fork report's 44 raw responses as returned
  by the scoped evidence API.

## Checks

- `go test -count=1 ./internal/analysis/... ./internal/uniswap/...`: 32
  passing test/subtest results, 0 failures, 1 skip
  (`TestStoreDurabilityScopeAndIdempotency` without `TEST_DATABASE_URL`). With
  `TEST_DATABASE_URL` pointing at the dedicated database, that test passed.
- `TestCapturedForkTracesAndUniswap` rebuilds the fork graph counts and
  Uniswap outcomes from `fork-evidence.json.gz`;
  `TestControlledComparisonCapturedEvidence` rebuilds both comparison graphs
  from `workload-comparison/evidence.json.gz`.
- Dashboard tests `workload-comparison`, `contention`, `conflict-explanation`,
  `investigation-export`, and `guided-investigation`: 29 passed.
- These packages also test Beacon envelope fallback, network/receipt mismatch
  rejection, unavailable reads staying unknown, transaction-to-block
  resolution, signed Swap ABI values, and ancestor reverts. Graph and trace
  unit tests (RAW/WAR/WAW ordering, delegatecall context, implicit SSTORE
  reads, reverted frames) are in `internal/bal` and were not part of this run.

Not rerun in this pass: the dashboard `POST /api/analysis` proxy, browser
downloads, and the browser comparison view.

See [methodology and reproduction](../BAL_ANALYZER.md).
