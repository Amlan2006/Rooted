# Glamsterdam X-ray

For one Sepolia block, the X-ray puts five parallel-execution ceilings next to each other.
Every number is an **upper bound** on speedup for its own execution model, not a measured parallel run.

| View | What it assumes | Value |
|---|---|---|
| `gas_weighted` | time ∝ receipt `gasUsed` (execution + EIP-8037 state gas, after refunds) | `Σg / max g` |
| `execution_gas_weighted` | time ∝ EIP-8037 execution gas, the dimension that prices compute | `Σe / max e` |
| `validator_bal_time` | **validator with an EIP-7928 BAL**: every tx can run in parallel, so Amdahl applies to measured time | `Σt / max t` |
| `builder_multiversion_time` | **builder / no BAL, multi-version executor** (Block-STM style): WAR edges are renamed away by versioned state; RAW and WAW stay, because SSTORE and balance credits are read-modify-writes (their reads are not all modelled) | `Σt / longest time-weighted path without WAR edges` |
| `builder_dag_time` | **builder / no BAL, static scheduler**: orders every RAW/WAR/WAW conflict, no multi-versioning | `Σt / longest time-weighted dependency path` |

Framing rule: with a BAL, validators can execute all transactions in parallel. The conflict DAG
is the builder (or no-BAL) view. It is never "the validator limit". The static builder view bounds only a
scheduler without multi-versioning; a multi-version executor can beat it, up to `builder_multiversion_time`.
Because each DAG contains the next one's edges, validator ≥ multi-version builder ≥ static builder in every block.

Under EIP-8037 the block gas limit applies to execution gas and state gas separately; header gasUsed is
max(Σ execution, Σ state). Receipt gas adds the two, so contract creations (heavy in state gas) dominate it.
Neither gas ceiling is "what the gas limit assumes"; execution gas is the fair comparison with time. The replay
records each tx's execution and state gas as `GasPool.CumulativeExecution()/CumulativeState()` deltas around
`ApplyMessage`, and `Compute` rejects them unless max(Σ execution, Σ state) equals header gasUsed.

`t_i` is the median `apply_ns` of tx `i` over the 7 **uninstrumented control** samples of the native replay
(`workloads/profiler`: Geth v1.17.10 `core.ApplyMessage`, warm cache, sequential; `replay.timing:
"uninstrumented_control"`). The 7 instrumented samples time every state call through a wrapper plus root
tracer hooks; that costs about 2–2.7× per block and inflates state-heavy txs much more than compute-bound
ones, which moves the ratios. Reports from profiles that predate per-tx control timings fall back to the
instrumented samples and say so (`replay.timing: "instrumented"`, coverage `apply_ns_from_instrumented_replay`).
Time ceilings vary by up to about 25% (max/min) between replays of the same block, so quote them to two
significant figures or as ranges. Ties resolve to the smallest index. `schedules` gives `Σt / makespan` for 1, 2, 4, 8 and 16 cores: LPT for validators,
bottom-level list scheduling over the static DAG for builders. One core always gives exactly 1.0. The
multi-version view has a ceiling but no schedule; reports stored before it existed have no
`builder_multiversion_time` (the dashboard shows "not in this report").

Code: `internal/xray/schedule.go` (ceilings, schedules), `internal/xray/compute.go` (read/write model,
graph, hot locations), `internal/xray/engine.go` (capture, envelope, store), `internal/api/xray.go` (REST).

## Read/write model

- Writes: BAL changes with `transaction_index == i`, decoded from the Nimbus payload envelope
  (`/eth/v1/beacon/execution_payload_envelopes/{slot}`, RLP) and checked against the header's
  `blockAccessListHash`. Pre- and post-execution entries are ignored.
- Reads: every prestateTracer storage key (traced with `includeEmpty`, see below), the `code` of every prestate account, and the sender's
  `balance` and `nonce`. Storage and code reads are a superset of the real reads, but balance reads of
  accounts other than the sender (`BALANCE`/`SELFBALANCE` of an account an earlier tx paid) are not
  modelled, so where those occur the builder ceiling can be optimistic (`non_sender_balance_reads_not_modeled`).
- Excluded from both: the fee recipient, the 4788 and 2935 system contracts (written only before the
  transactions), `0xff…fe`, and precompiles `0x01`–`0x11` and `0x100`. Otherwise every tx would conflict on the
  coinbase balance. The 7002/7251 request contracts are kept: user txs write their queues, so two requests in
  one block really conflict.
- Edges come from `bal.BuildGraph` (100,000 edge cap). When the cap is hit (`edge_limit_reached`), dropped
  edges would shorten the critical path, so both builder ceilings and the schedule are reported as unavailable.
  `depends_on` lists the static-DAG predecessors.
- Captures call `prestateTracer` with `includeEmpty: true`. Without it Geth drops accounts that were empty
  before the tx, so an account created in the block (a CREATE, or a fresh EOA funded by an earlier tx) first
  appears in a later trace already holding its post-creation state. The replay seeds an account's first
  appearance as its block-start state, so the CREATE then collided (status 0, all gas burned) or the
  EIP-8037 new-account state gas was skipped, and the replay's receipt check rejected the block.
  `workloads/profiler/create_test.go` replays such a block (12,076,302: tx 49 creates a contract, tx 54 calls it).

The `coverage` array always lists the model's limits: `reads_are_prestate_superset`,
`non_sender_balance_reads_not_modeled`, `excluded_fee_recipient_system_contracts_precompiles`,
`replay_is_warm_cache_sequential_apply_message`, `state_root_io_and_bal_processing_excluded`,
`ceilings_are_upper_bounds`. Conditional entries: `no_replay_metrics`, `apply_ns_from_instrumented_replay`,
`execution_gas_unavailable`, `bal_commitment_unavailable`, `edge_limit_reached`, `epbs_state_unavailable`,
`uniswap_v3_pools_unverified`.

Briefs carry strict flags `gas_misidentifies_bottleneck` and `execution_gas_misidentifies_bottleneck`: true
only when the time-capping tx uses less gas than the gas-capping tx, so equal-gas ties do not count. The
summary shares use them; briefs stored before they existed fall back to comparing capping indices.

Hot locations are the 10 locations with the most static-DAG edges plus up to 10 more Uniswap-labelled
locations, so labelled contention below the top 10 is still listed. They carry Uniswap v3/v4 labels from
`internal/uniswap` (see `docs/UNISWAP.md`). When no hot location of the selected block is labelled, the
dashboard shows the labelled BAL conflicts of block 12,073,969 (`dashboard/lib/uniswap-contention-example.json`).
The `epbs` object comes from the live PayloadWatch state for the payload. Without one, it falls back to
the envelope's builder index and beacon root (`source: "envelope"`).

## Run it

```sh
rooted xray BLOCK_HASH                                   # capture + replay + envelope, stores the report
rooted xray --capture CAPTURE.json[.gz] [ENVELOPE.json]  # offline, from a saved profiler capture
rooted xray-follow                                       # head-2 every 12 s until SIGINT
ROOTED_XRAY_FOLLOW=true rooted serve                     # same follower inside serve
```

`rooted xray HASH` reuses the newest saved execution profile of the block (`source: "profile"`).
Otherwise it captures and saves one (`"live"`). The follower stores reports only, never captures.
It skips a tick while a replay runs and never retries. Blocks need at most 512 transactions and
recent state (about 128 blocks on our node).

| Route (`?network=sepolia` required) | Result |
|---|---|
| `GET /api/v1/xray/blocks/{hash}` | 200 report, 404 `not_found` |
| `GET /api/v1/xray/blocks?limit=1..200` | 200 briefs, newest block first |
| `GET /api/v1/xray/summary?limit=1..10000` | 200 p10/median/p90 of each ceiling and shares |
| `GET /api/v1/xray/uniswap?limit=1..200` | 200 blocks with Uniswap-labelled edges, newest first, grouped by pool from stored hot locations |
| `POST /api/v1/xray/blocks/{hash}` | 201 report, 429 `busy`, 422 `xray_unavailable` |

The POST shares one replay gate with profile jobs and the follower. It waits up to 15 s for that gate
before answering 429, because a follow job holds it for about 10 s of every 12.

## Fresh run with the multi-version view (2026-11-06 12:06–12:27 UTC)

`rooted xray-follow` with `includeEmpty` captures: 101 of 102 heights from 12,076,454 to 12,076,555 stored, all
with verified BAL commitments and 51–222 txs. None failed the replay's receipt check (105 contract creations
among 13,276 txs). Stored in our `rooted_p4` database; the briefs come from `GET /api/v1/xray/blocks`.

| Ceiling | p10 | median | p90 |
|---|---|---|---|
| receipt gas | 3.5× | 8.3× | 30× |
| execution gas | 22× | 27× | 30× |
| validator with BAL (time) | 16× | 20× | 24× |
| builder / no BAL, multi-version (time) | 15× | 20× | 24× |
| builder / no BAL, static (time) | 14× | 19× | 23× |

- More than 5% below the validator ceiling: the static builder in 39 of 101 blocks, the multi-version builder in
  9: in 30 of the 39, dropping the write-after-read edges brings the builder within 5% of the validator. The
  multi-version builder equals the validator ceiling
  in 86 blocks (a single-tx critical path); the static one in 59.
- Largest multi-version gap: 12,076,467 (`0xd3c781e7…b463`, 148 txs): validator 21.0×, multi-version 15.3×
  (10-tx path), static 13.3× (12-tx path).
- Execution gas is above the time ceiling in 97 of 101 blocks. Receipt gas is below it in 69 and above it in 32.
- 8-core schedule medians: 8.0× validator, 7.9× static builder.
- Uniswap: four blocks have labelled conflict edges. In 12,076,476 (`0x3266efef…3a28`) four swaps on
  factory-verified v3 pool `0x3289680d…eff1` (USDC/WETH) give 87 labelled edges, 18 on `slot0`. All its labelled
  locations rank 11th to 16th by edge count, which the earlier top-10 cut hid.

## What the live runs showed (2026-11-06 11:00–11:22 UTC, uninstrumented timings)

`serve` with the follower, two windows: blocks 12,076,127–12,076,175 and 12,076,193–12,076,230. 81 of 87
heights were stored, all with verified BAL commitments and 63–297 txs. Five failed the replay's receipt check
(replayed gas differs from the receipt) and one was not attempted. Those failures were blocks that create an
account and use it later in the same block; captures now trace with `includeEmpty` (see the read/write
model), which fixes them. No block had more than 512 txs; the follower skips those (8 of 45 heights in the
earlier 12,075,870–914 run). This run predates the multi-version view, so its builder column is the static one.

| Ceiling | p10 | median | p90 |
|---|---|---|---|
| receipt gas | 5.2× | 9.6× | 27× |
| execution gas | 15× | 26× | 30× |
| validator with BAL (time) | 8.1× | 18× | 22× |
| builder / no BAL, static (time) | 7.3× | 17× | 21× |

8-core schedule medians: 8.0× validator, 7.8× builder.

- Execution gas overstates parallelism: its ceiling is above the time ceiling in 80 of 81 blocks. Receipt gas
  is erratic: below the time ceiling in 46 of 81 blocks, where a tx heavy in EIP-8037 state gas caps it (a
  contract creation in 22 of them; creations apply in microseconds), and above it in 35.
- Strict misidentification (ties excluded): receipt gas names a different capping tx than time in 59 of 81
  blocks, execution gas in 11 of 81.
- One workload dominates: a median of 20 identical 2,491,067-gas calls per block to
  `0x4a656861cae32ca04623763a59f708410de73441`, about 7 ms each uninstrumented (p10–p90 5.9–9.3 ms), a median 75%
  of apply time (44–89%). One of them caps the validator view in 53 blocks. Multicall3 (`0xca11…ca11`, 13 blocks)
  and four other contracts (`0xfb4e2274…`, `0x3622157c…` 6 blocks each, `0x0cd42024…` 2, `0x00352bcf…` 1) cap
  the rest, at 17–73 ms.
- In 61 of 81 blocks the static builder critical path is a single tx, so builder = validator. In 17 the
  static builder ceiling is more than 5% lower, with critical paths of 2–16 txs.
- Uniswap: 94 v3 and 10 v4 swap txs, no labelled conflict edge.

Block 12,076,166 (`0x48cf69b2…75c0`, 159 txs, builder index 0) is the dashboard's offline example
(`dashboard/public/examples/xray-report.json`, run 3 below). Its builder critical path is 15 txs from 15
different senders calling Polaris vaults (yspUSD `0x63d0…7f73`, yspGOLD `0xf577…e717`, svpETH `0x7b11…0539` and
others). They are chained through storage of the pETH Bonding Curve (`0x07ea2ff8…705e`, slot `0xe07a7f10…a6a8`,
7 writers) and `0x133e6955…0965` (slots 2 and 4). The path takes about 16 ms; the slowest single tx about 9 ms.
Four of its 14 links (26→27, 30→34, 62→68, 138→143) are pure write-after-read. Without them (the
multi-version view) the path is 11 txs and, on run 3's timings, the ceilings are validator 20.7×,
multi-version builder 15.5×, static builder 11.1×.

| Replay of 12,076,166 | validator | builder | 8 cores (validator / builder) | 16 cores |
|---|---|---|---|---|
| follower | 19.8× | 10.4× | 8.0× / 6.5× | n/a |
| 1 | 20.2× | 11.6× | 8.0× / 6.9× | 16.0× / 11.6× |
| 2 | 21.5× | 10.8× | 8.0× / 6.5× | 14.8× / 10.8× |
| 3 | 20.7× | 11.1× | 8.0× / 6.5× | 15.4× / 11.1× |
| 4 | 17.7× | 11.1× | 8.0× / 6.6× | 16.0× / 11.1× |
| 5 | 19.0× | 10.7× | 8.0× / 6.6× | 15.5× / 10.7× |

The table's builder column is the static view. The receipt-gas (30×) and execution-gas (28×) ceilings do not
change between replays. Block 12,076,168 shows the same static pattern (11-tx path; validator 23–27×, static
builder 18–19× over 5 replays), but its whole gap is write-after-read: on one replay's timings the
multi-version builder equals the validator ceiling (24.7× both; static 19.3×).

Block 12,075,883 (`0xb0fd451d…939a`), the earlier example, re-measured 5 times from a saved capture with
control timings: validator 16–19×, builder 11–14×, critical path txs 8 → 9 → 10 in every run (the multi-version
view is the same, 11.5× on one replay's timings, because nonce and balance edges are RAW). That chain is
three consecutive txs from one sender (`0xf07d1008…74ac`, nonce and balance), not contract-state contention. Its
stored report from the earlier run (instrumented timings, 18.87× / 13.50×) overstated the precision.

Earlier runs (12,075,736–800 and 12,075,870–914) used instrumented timings and are superseded by the numbers
above. Their gas observations still hold. For example, block 12,075,748 tx 0 is a 21,105,490-gas creation, and
block 12,075,870 tx 47 is a 20,211,245-gas creation; both apply in well under a millisecond.

Another verified example of gas versus execution: Sepolia block 12,075,273 has header gasUsed
92,173,320 and a receipt sum of 155,156,084 (EIP-8037 two-dimensional gas). Its tx 72 is a
55,719,446-gas contract creation. Our node no longer has state for it, so it cannot be replayed here.

## Limits

These are timings of a warm-cache, sequential, uninstrumented `ApplyMessage` replay on one machine
(Intel Xeon Skylake, 8 logical CPUs). State-root computation, disk IO and BAL processing are excluded.
Real clients add scheduling overhead, so every number is an upper bound.
