# Controlled workload comparison

A fork experiment using simulated ETH and real Uniswap v3 contracts from pinned Sepolia state. It does not run on public Sepolia, produce native BALs, or measure execution speed.

## Use the dashboard

Open `http://127.0.0.1:3000/?view=compare`, or choose **Compare workloads**, then **Load recorded experiment**. This reads the bundled capture and works without Geth, Nimbus, a tunnel, Anvil, or a running backend. The surrounding dashboard's collectors still use their independently configured connection.

Use **Open comparison JSON** to read a newly generated `comparison.json` locally in the browser. The file is not uploaded. Version, size (8 MB), report identities, graph shape, and transaction shape are checked. Operator endpoint origins and unknown fields are excluded from the comparison evidence view.

Choose **All observed state** to include balance/nonce/code effects, or **Storage only** to explicitly exclude them. The table shows RAW/WAR/WAW location-level edge counts, exclusive contention categories, unit-cost dependency depth, and maximum layer width. Both scenarios show their transaction identities, coverage, and first five ranked exact-location hotspots. **Comparison evidence** contains the complete selected graphs, full keys, source references, receipts, and scenario settings.

Numeric deltas are withheld if the fork, common baseline, actual transaction inputs, successful receipts, selected transaction set, trace availability, coverage signatures, or graph truncation do not support comparison. Incomplete reports can still be read separately. BAL reports without comparison metadata cannot establish a controlled comparison.

## Reproduce a pair

Prerequisites: a Rooted PostgreSQL database, configured root `.env`, Go, Python 3, and Foundry (`anvil`, `cast`, `forge`; used with 1.9.0). The upstream RPC must serve Sepolia state at the pinned block. A snap-synced Geth keeps state for only about the latest 128 blocks, so the runner pins the upstream head minus 2 unless `--block` is given; run it promptly. The backend HTTP server is optional; the CLI writes directly to the configured database.

From the repository root:

```sh
forge build --root workloads/uniswap
go build -o .tools/rooted ./cmd/rooted
set -a
. ./.env
set +a
python3 scripts/run_uniswap_comparison.py \
  --upstream http://127.0.0.1:18545 --port 8549 \
  --output .tools/workload-comparison-new
```

Choose a fresh output directory for each run. The runner refuses an occupied port and does not reset or stop existing nodes. It starts its own loopback Anvil, performs both experiments, and stops only that owned process in cleanup. No wallet, faucet, public transaction, or Nimbus is required. Without `--upstream`, `ROOTED_COMPARISON_UPSTREAM` or a public Sepolia RPC is used; keep credentials out of shared commands and files.

The output includes `comparison.json`, a JSON file per scenario, and local diagnostic logs. Open `comparison.json` in the dashboard. Analysis and raw RPC responses also remain in PostgreSQL, available through the scoped analysis/evidence APIs. Logs are local diagnostics; review them before sharing.

The runner:

1. Checks upstream chain ID 11155111 and pins the chosen block number with its returned hash.
2. Starts Anvil chain 31337, hardfork Prague, step tracing, FIFO transaction order. Deploys three independent `SwapWorkload` contracts and funds each with simulated WETH.
3. Saves a prepared-state snapshot and common baseline hash. Each sender submits one swap of **1,000,000,000,000 raw WETH units**, fixed gas/fee limits, and `revertAfter=false`.
4. Mines **A/A/A** in one block, verifies successful receipts and exact block order, then immediately collects call, prestate/diff, and opcode evidence through the existing `analyze-fork` CLI. Opcode limit: 20,000 per transaction.
5. Restores its own prepared-state snapshot and mines **A/B/A** with the same accounts, contracts, amounts, nonces, timestamp, and gas settings. Collects and saves its evidence before stopping Anvil.

Pool A is `0x3289680dd4d6c10bb19b899729cda5eef58aeff1` (fee 500). Pool B is `0x6ce0896eae6d4bd668fde41bb784548fb8f59b50` (fee 3000). Both are checked against the existing Uniswap v3 factory. Changing routes also changes fee tier, liquidity, and pool state: this is a controlled routing comparison, not an isolated causal benchmark of one variable's execution time.

The restored fork makes the two resulting blocks alternative local histories. They are separately captured experiments; do not interpret both blocks as simultaneously canonical. Shared transaction hashes across scenarios are scoped by their distinct block and report hashes.

## Recorded findings

Captured 2026-11-06 with Anvil 1.9.0 forking the local Sepolia Geth v1.17.10 at block 12,075,320 (`0xa0038510b048ca39b286cdbe59e947d58c8726669ba8536cb3cf59195696e9a3`); common baseline 12,075,326 (`0x5515e33446e7e448655558e31549dc7ff225ec73e583e9dae72a2c971cc1accc`). Scenario blocks: same pool `0xa22830eb9f15f9c969096f76127e837908d280293c6047f631770dc2d67e216a`, spread pools `0x1b3b1750367a29aa51ae3a153bc169b3428418cdd2fd1a1084f2249887636c58`.

The bundled capture `dashboard/public/examples/workload-comparison.json` (also at `demo/phase5/reference/workload-comparison/workload-comparison.json`) is the runner's `comparison.json` passed through the dashboard's own portable parser (`parseComparison`), which drops operator origins and unknown fields. `demo/phase5/reference/workload-comparison/evidence.json.gz` holds the 32 and 37 raw RPC responses of the two reports, read from the scoped evidence API with endpoint origins removed: block/transaction bindings, receipts, prestate/diff traces, opcode traces, call trees, and pool metadata reads. Source digests refer to the stored response bytes; the JSON file is reserialized, so compare parsed values, not bytes.

| Scope / metric | Same pool | Spread pools |
| --- | ---: | ---: |
| All observed state: edges | 39 | 15 |
| Pool-storage edges | 18 | 6 |
| Identified token-storage edges | 18 | 6 |
| Shared account-effect edges | 3 | 3 |
| All-state depth / maximum width | 3 / 1 | 3 / 1 |
| Storage-only edges | 36 | 12 |
| Storage-only depth / maximum width | 3 / 1 | 2 / 2 |

Both reports have matching **partial dependency coverage**, successful call/diff/opcode traces for all three selected transactions, complete storage-read attribution, and untruncated returned graphs. Neither claims complete Ethereum execution semantics. Account balance effects retain an all-state dependency chain even when routing reduces pool/token storage overlaps. Reordering is not presented as removing conflicts. These findings do not imply measured runtime savings or a universal result for other pools, senders, amounts, or clients.

## Verify offline

```sh
(cd dashboard && node --import tsx --test tests/workload-comparison.test.ts)
go test ./internal/analysis -run TestControlledComparisonCapturedEvidence -count=1
```

The Go test reconstructs **both exact edge sets**, conflict counts, depth, and width from the raw trace responses. Frontend tests cover positive/negative comparability, differing scopes, routing/input mismatches, unknown metadata, truncated graphs, missing traces, and portable-file validation. Both passed on 2026-11-06. The browser view was not re-exercised in that run.
