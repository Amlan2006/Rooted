# BAL Analyzer Lite — Phase 5

The core in `internal/bal` works with arbitrary Ethereum transactions. `internal/uniswap` adds Uniswap **v3** interpretations; it is not a dependency of the core. `internal/analysis` binds RPC evidence, calls both modules, and persists reports. This phase provides backend/CLI/API functionality. The dashboard belongs to Phase 6.

## Evidence and identity

Live mode fetches `eth_getBlockAccessList` by immutable block hash. The decoder checks canonical account/slot/change ordering and index ranges, normalizes storage/balance/nonce/code changes, reproduces the EIP-7928 RLP commitment, and compares it to `blockAccessListHash` when exposed. A mismatch aborts ingestion. A missing header commitment is explicitly unknown. Index 0 is pre-execution, 1..n maps to transaction index 0..n-1, and n+1 is post-execution. Pre/post entries remain visible but do not become transaction graph nodes.

Both execution and supplemental tracing providers must match the configured chain ID and network anchor. The built-in Sepolia default is block 1,000,000 (`0xf4240`), hash `0xaad11ee5a3b4b037a4cef3afd30398bf8b0f73e702cf86f86e3f4eaa9d7d39a2`; `ROOTED_ANALYSIS_ANCHOR_NUMBER`/`ROOTED_ANALYSIS_ANCHOR_HASH` override it. The 2026-11-06 runs used the configured anchor `0xa7d8c0` (`0x2896cc6e67bae1116829775906356da77d7263646429faebc769b0404ea3ecf2`), returned identically by the execution and trace endpoints. The analyzer does not check the execution genesis. The Beacon collector retains its separate genesis-root check. Chain identity checks establish configured RPC consistency, not cryptographic verification of a remote provider's honesty.

Selected transaction hashes must belong to the fetched block; transaction index and receipt identities must agree. Trace-provider transaction/block binding is checked before and after replay. Supplemental evidence is staged until both checks pass. Pool metadata uses an EIP-1898 block-hash selector, with a number fallback requiring a final canonical-header match. `canonical_at_fetch` is a snapshot, not a finality guarantee. Re-run ingestion to recheck canonicality after a reorg.

Runs are identified by network, mode, anchor hash, block hash, and sorted selected transaction hashes. PostgreSQL retains current reports, distinct report versions, and raw RPC responses. Unchanged responses deduplicate by canonical JSON digest. Report-version hashing excludes fetch timestamps; a new fetch alone does not create a semantic version. Live, fork, captured, and synthetic scopes never merge automatically.

## Read/write semantics

| Evidence | Use |
| --- | --- |
| Native BAL transaction-indexed changes | Authoritative committed writes in live mode |
| Native block read-only storage keys | Block-level visibility; no invented per-transaction readers |
| Prestate tracer storage keys | Access candidates only, never an exact read set |
| Opcode SLOAD and SSTORE | Attributed reads, including SSTORE's implicit read and reads inside reverted frames |
| `prestateTracer` diff mode | Committed trace-derived writes in local fork mode |
| Call tracer and retained receipt logs | Internal swap attempts versus committed Swap events |

CALL/STATICCALL enter the target's storage context; DELEGATECALL/CALLCODE preserve caller storage. Unresolved creation/lifecycle semantics, errored steps, empty logs, missing traces, and step-limit exhaustion produce incomplete read coverage. A reverted frame's reads may affect execution even though its writes are absent from the committed diff. Whole-transaction gas comes from receipts; it is not pool-exclusive execution time.

In the 2026-11-06 live run against a local Geth, call, prestate, and opcode tracers all succeeded for the selected transaction, so its storage reads are attributed (`storage_reads_complete=true`). Geth does not serve `trace_replayTransaction`, so that report has `state_diff_available=false`; the native BAL remains the committed-write authority. Unselected transactions, or providers that reject the opcode logger, leave per-transaction reads unknown. The controlled Anvil fork has real opcode traces with step tracing enabled. Its writes are labeled trace-derived, its mode is `fork`, its chain ID is 31337, and `native_bal` is null.

## Graph interpretation

A state location is an exact `(address, field, storage key)` tuple. Read/read overlap creates no edge. For transactions i < j, the graph records known RAW, WAR, and WAW overlaps at that same location. An address shared by two transactions is insufficient to establish a storage conflict. All known pairwise conflicts are retained, including transitive ones; counts are location-level edges, not distinct transaction-pair counts.

The primary graph includes known balance, nonce, and code effects, including the fee recipient's shared balance writes. `storage_projection` explicitly excludes those effects. Different Uniswap pools may still share token state or account effects; pool identity does not establish independence.

`observed_dependency_depth` is the longest path length in nodes; layers group nodes by their longest incoming path, and width is the largest layer's size. These are unit-cost metrics for the supplied evidence. They are not a complete execution schedule or a speedup measurement. `full_dependency_coverage` remains false because account existence, authorization/delegation, gas behavior, and other client semantics are not fully modeled. `storage_read_coverage_complete` describes only read-trace coverage. `theoretical_speedup` remains null. Edge truncation is explicit and limits graph metrics.

## Uniswap adapter

The adapter decodes v3 `swap(address,bool,int256,uint160,bytes)` call arguments and `Swap` events, including signed token amounts and ticks. Candidate pools must report the expected Sepolia v3 factory, token0/token1, and fee; that factory's `getPool` must resolve back to the same address before `pool_verified` becomes true. Selector/topic recognition alone does not verify a pool.

Calls retain their own failure, ancestor failure, transaction revert, and committed status separately. Successful inner calls rolled back by an ancestor are not committed swaps. Retained events come only from successful matching receipts. The first five v3 storage slots receive static labels (slot0, global fee growth, protocol fees, active liquidity); mapping/observation keys are explicitly unattributed. There is no v4 adapter, tick-key reversal, token-decimal pricing, or gas speedup claim.

## Native BAL transport compatibility

Live analysis tries the existing `eth_getBlockAccessList(blockHash)` execution RPC first. Its JSON response, validation, and report schema remain supported. If that request fails or returns null, the collector uses the already configured `ROOTED_BEACON_URL` to request `/eth/v1/beacon/execution_payload_envelopes/{slot}`. No extra environment variable is required. Fork/trace-only mode is unchanged.

The envelope fallback requires the execution header's `slotNumber` and `blockAccessListHash`. It checks the envelope's execution block hash, block number, and slot against that header, decodes canonical EIP-7928 RLP, and uses the same account ordering, index, and commitment validation as the JSON path. Malformed JSON account arrays or a commitment mismatch from the successful execution getter are rejected rather than replaced with fallback evidence. Missing/pruned envelopes also fail explicitly; no synthetic substitution occurs.

Reports from this path use native schema `eip-7928-rlp-index-value-v1`; the prior JSON schema remains unchanged. Raw evidence retains both the execution RPC attempt and the Beacon envelope (`analysis_native_bal_envelope`) with sanitized source origins. `canonical_at_fetch` remains a separate snapshot check, and a verified BAL does not imply complete transaction-level read attribution.

On 2026-11-06, Geth v1.17.10 returned no `eth_getBlockAccessList`, and the
Nimbus v26.10.2 envelope fallback supplied the BAL for block
`0x98399bab67e4e7e0eed93273ab8afd27484b4c67b4b41217830987b1a036fee3`
(118 transactions, 348 BAL accounts, 746 normalized changes). Its computed
commitment `0x207322d7c088d05fc87f8db98e0c0bac4732b7b56795fc7e1533a273d6f1e6b4`
matched `blockAccessListHash`. See `demo/phase5/reference/native-summary.json`.

## Guided investigation

Select **Investigate** in the sidebar to start with a transaction hash or open the latest saved live report. In the BAL analyzer, **Investigate this report across modules** opens the same workflow for the current saved report, preserving its network/mode and selected traced transaction. See [guided investigation](GUIDED_INVESTIGATION.md) for identities, source pinning, optional-evidence handling, and verification.

## Downloadable investigation reports

Select **Download report (.md)** or **Download JSON bundle** above the BAL graph. Both export the displayed saved analysis, active storage/all-state scope, and transaction filter. No new BAL ingestion is triggered. The report is an observation snapshot, not a signed proof or a new chain observation.

The versioned JSON schema is `rooted.investigation`, version `1.0.0`. It includes sanitized analysis and both returned graphs, exact-location hotspots and category counts, up to 60 plain-language findings, JSON-pointer evidence references, identities, timestamps, and limitations. The selected denominator includes all matching returned edges; findings are explicitly capped. Null/false values and live/fork/captured/replay/synthetic identities remain distinct. The Markdown report contains the readable findings and embeds the complete JSON bundle, so it can be read and inspected without Rooted or a companion file. Large blocks produce larger downloads.

Optional evidence joins use existing read APIs. For live Sepolia, the exporter uses the guided investigation’s pinned source, or discovers the current configured collector source in the standalone BAL view and requests the execution header's slot when available; older headers fall back to at most 200 recent observations. A payload row must match network, mode, source, execution block hash, and—when known—slot. CRE lookup considers at most 100 reports and 10 distinct summaries. A check is linked only if its scope, monitored chain, and summary identity match, and its summary explicitly contains a matched payload's slot, Beacon root, and execution hash. Window checks remain labeled as such, with simulation/authentication and policy-network identities retained; they are not transaction verdicts. Exports report unavailable/unsupported/missing-within-search evidence explicitly. Optional requests share a 30-second preparation bound; unavailable optional APIs do not prevent exporting the BAL analysis.

Exports use field allowlists rather than raw response serialization. Endpoint origins, operator source names, session IDs, receiver credentials, unknown fields, and raw HTTP/RPC bodies are excluded. Source identities become bundle-local references (`analysis-source-N`, `payload-source-1`). Only known public diagnostic/source codes are retained; unknown diagnostic text is replaced with an omission marker. Policy RPC origins are excluded while public policy contract/block identities remain. The export does not contain the encoded BAL or raw trace responses and is not a full byte-for-byte replay archive.

Verification: `dashboard/tests/investigation-export.test.ts` and `guided-investigation.test.ts` cover injected-secret omission, mismatched-correlation rejection, bounded summary searches, unknown/false preservation, selection/mode retention, and Markdown embedded-JSON round trips; they passed on 2026-11-06. Browser downloads were not re-exercised in that run.

## Uniswap contention breakdown

The breakdown above the pool cards groups every location-level conflict edge in the selected returned graph, including edges beyond the 60-row table and the 12-node drawing. It follows **Storage projection / All known state** and the selected transaction node. The four category counts always sum to the displayed denominator; percentages are rounded for display. Empty selections have no percentage denominator.

Classification is exclusive and deterministic:

1. Valid balance, nonce, and code overlaps are **Shared account effects**, even for a pool/token address.
2. Storage with an exact key at a verified Uniswap v3 pool is **Verified pool storage**.
3. Storage with an exact key at a token address identified by a verified pool's token0/token1 metadata is **Identified token storage**.
4. Other or unsupported locations stay **Unclassified**. A token's storage-key meaning is not inferred from its address. Pool storage takes precedence if metadata places an address in both sets.

Hotspots group by exact address, field, and key; the first eight are ranked by edge count. Reader/writer and participant sets are derived from those returned edges only. Full lists, category totals, traced hashes, source metadata, graph coverage, and truncation flags are available in **Contention evidence**. The graph may be partial even when its returned edges were not truncated. These counts do not measure execution time or savings.

The cross-pool section requires two transaction identities with committed swaps in different verified pools and a token-storage edge corroborated by the same exact location in their attributed accesses. Its evidence includes the edge, transaction hashes/accesses, pool identities, and swap records. Each transaction may also touch other pools. Shared token addresses alone, rolled-back calls, unavailable read attribution, or unverified pools cannot create a finding. A missing finding does not prove independence.

Examples from the 2026-11-06 reports: the live Uniswap report has 11 storage edges (all unclassified); its full graph adds 7,194 account-field edges. The controlled fork report has 20 storage edges (10 pool storage and 10 token storage), plus 6 account effects in the full graph. Neither corroborates a cross-pool token-storage edge. These are observations from saved reports, not measured execution outcomes.

## Plain-language conflict explanations

In the conflict table, select **Explain RAW/WAR/WAW** to expand a finding beneath that row. RAW describes an earlier write followed by a later read; WAR describes an earlier read followed by a later write; WAW describes two writes to the same state location. Transaction indexes are zero-based positions in the execution block. Read/read sharing is not a conflict.

Each finding includes both transaction hashes, exact account/field/storage key, and a supporting-evidence dialog with report/block identity, edge basis, transaction access records, matching native changes, sanitized source metadata, and coverage. Identity or access inconsistencies leave the interpretation unconfirmed. Storage names require both verified pool metadata and a supported label; mapping/unknown keys stay generic. A native write is described as commitment-verified only when a matching transaction/location change exists in the verified BAL. Read attribution remains separate from block-level BAL read visibility. Older reports lacking detailed native changes remain readable without inventing proof.

Explanations follow the active graph scope and transaction filter. They preserve missing coverage and truncation, and describe observed dependencies rather than measured execution delay or speedup.

## Analyze from the dashboard

Open **BAL analyzer → Sepolia · native BAL**. In the analysis form, choose **Transaction hash** or **Block hash**, paste a complete `0x`-prefixed 32-byte hash, and select **Analyze**.

Transaction mode resolves the mined transaction's containing block using the configured execution node, then collects that block's native BAL and the selected transaction's receipts/traces. Missing transactions return 404; pending transactions return 409 with a retry-after-inclusion message. Existing block, receipt, network, and trace binding checks still apply. Block mode collects the native BAL without selecting transactions for supplemental tracing; zero swap observations in that mode do not establish that the block contained no swaps.

The form shows loading, validation, upstream errors, and completion. Results are persisted. On success, the exact requested report stays visible across background refreshes; **Show latest saved report** returns to the automatically refreshed latest report. Fork mode retains its existing report view and CLI workflow.

The browser submits to the same-origin `POST /api/analysis` route with `{ "kind": "transaction" | "block", "hash": "0x…" }`. This dedicated proxy accepts only bounded JSON submissions from the dashboard origin, fixes the monitored scope to live Sepolia, and forwards to the configured backend origin. The existing generic read proxy remains GET-only. Requests use the ordinary backend connection, not Nox. No wallet or transaction submission is involved.

The backend must be restarted after rebuilding to register the new transaction endpoint; the existing block ingestion endpoint remains backward compatible. On 2026-11-06 both backend ingestion endpoints (block with the selected transaction, and transaction) returned 200 for the Sepolia Uniswap example below and resolved to the same report; the dashboard proxy route was not re-exercised in that run.

## Run live analysis

Export `.env` as described in docs/BACKEND.md and build the backend. The command used for the 2026-11-06 report:

```sh
.tools/rooted analyze \
  0x98399bab67e4e7e0eed93273ab8afd27484b4c67b4b41217830987b1a036fee3 \
  0xa5022a3a5d0fc3e2faae2af2ec64816d759a4345ec2b71f87eb44dbca7403927
```

The optional comma-separated transaction argument selects at most four transactions for supplemental tracing. The native BAL always covers the fetched block. Omitting selected hashes retrieves native BAL evidence without per-transaction trace replay. A snap-synced Geth keeps state for only about the latest 128 blocks, so traces need a recent block; that example is now outside the window, so pick a recent block containing a swap.

## Recreate the controlled workload

Requires Foundry (`anvil`, `forge`, `cast`), Python 3, and access to the upstream fork state. Used with Foundry 1.9.0. No wallet or faucet funds are required. Contracts and transactions exist only on the local fork.

Build the workload from the repository root:

```sh
forge build --root workloads/uniswap
```

In a separate terminal, start a fresh fork of a recent block. **`--steps-tracing` is required**. The 2026-11-06 run forked the local Sepolia Geth at block 12,075,317:

```sh
anvil --host 127.0.0.1 --port 8547 --chain-id 31337 \
  --fork-url http://127.0.0.1:18545 \
  --fork-block-number RECENT_BLOCK --hardfork prague --steps-tracing
```

Then, with `.env` exported and `ROOTED_FORK_RPC=http://127.0.0.1:8547`:

```sh
python3 scripts/run_uniswap_workload.py
# Read block_hash and the four case hashes from .tools/uniswap-workload/summary.json.
.tools/rooted analyze-fork BLOCK_HASH TX_HASH_1,TX_HASH_2,TX_HASH_3,TX_HASH_4
python3 scripts/smoke_phase5.py --base http://127.0.0.1:8080
```

The script restricts its RPC to loopback, checks Anvil and chain 31337, deploys four independent harnesses, wraps simulated ETH, and mines all four swaps in one block: two in the fee-500 pool, one in the fee-3000 pool, and a fourth reverted after its pool swap returned. Both pools are existing Sepolia v3 deployments on the fork. Hashes can change when re-running; use the generated summary. Start a fresh fork to reproduce the same starting state. Restarting Anvil removes its in-memory chain; persisted analysis remains available in PostgreSQL.

Offline tests replay the committed fork evidence from that run. See [verification](PHASE5_VERIFICATION.md).

## API

All reads require explicit network selection. `mode=live` is the default; fork data requires `network=sepolia-fork&mode=fork`.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/v1/analysis/runs` | Stored reports, default limit 5, maximum 20 |
| GET | `/api/v1/analysis/blocks/{hash}` | Reports for an immutable block hash |
| GET | `/api/v1/analysis/runs/{id}` | One scoped report |
| GET | `/api/v1/analysis/runs/{id}/bal` | Native normalized BAL and coverage |
| GET | `/api/v1/analysis/runs/{id}/dependencies` | Transaction access, full graph, storage projection |
| GET | `/api/v1/analysis/runs/{id}/uniswap` | Pools, events, calls, storage labels |
| GET | `/api/v1/analysis/runs/{id}/evidence` | Raw responses, pages of 10; `offset=0..10000` |
| POST | `/api/v1/analysis/blocks/{hash}/ingest` | Live collection and persistence |
| POST | `/api/v1/analysis/transactions/{tx}/ingest` | Resolve a mined transaction and analyze its block with that transaction selected; body `{}` |

POST body is `{"transactions":["0x…"]}`; at most four unique transaction hashes, maximum body size 4096 bytes. HTTP ingestion supports only the configured live network. Local fork ingestion uses the CLI. All POST ingestion shares the existing 90-second API request deadline; CLI analysis allows four minutes. Each upstream request retains the configured timeout and 32 MiB response limit. Invalid input is 400, a missing scoped report is 404, source failure is 502, unavailable analysis configuration is 503, and storage failure is 500. Raw trace evidence can be large; use individual views for routine investigation.

```sh
curl -sS 'http://127.0.0.1:8080/api/v1/analysis/runs?network=sepolia'
curl -sS 'http://127.0.0.1:8080/api/v1/analysis/runs?network=sepolia-fork&mode=fork'
```

Configuration additions: `ROOTED_TRACE_URL`, `ROOTED_FORK_RPC` (loopback only), `ROOTED_ANALYSIS_ANCHOR_NUMBER`, and `ROOTED_ANALYSIS_ANCHOR_HASH`. Public RPCs are configurable; raw evidence stores only sanitized origin metadata, not endpoint credentials. Protect any private tracing endpoint behind your own access controls, as with existing backend ingestion.

## Controlled workload comparison

The separate **Compare workloads** page compares reproducible A/A/A and A/B/A local fork scenarios with matching-coverage checks, both graph scopes, exact-location hotspots, and portable recorded evidence. See [WORKLOAD_COMPARISON.md](WORKLOAD_COMPARISON.md) for reproduction and the observed 39-versus-15 all-state edge result. Structural metrics remain distinct from measured execution performance.
