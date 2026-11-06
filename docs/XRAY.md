# Glamsterdam X-ray

For one Sepolia block, the X-ray puts three parallel-execution ceilings next to each other.
Every number is an **upper bound** on speedup, not a measured parallel run.

| View | What it assumes | Value |
|---|---|---|
| `gas_weighted` | what the gas limit assumes: time is proportional to receipt `gasUsed` | `Σg / max g` |
| `validator_bal_time` | **validator with an EIP-7928 BAL**: every tx can run in parallel, so Amdahl applies to measured time | `Σt / max t` |
| `builder_dag_time` | **builder / no BAL**: txs must respect RAW/WAR/WAW conflicts | `Σt / longest time-weighted dependency path` |

Framing rule: with a BAL, validators can execute all transactions in parallel. The conflict DAG
is the builder (or no-BAL) view. It is never "the validator limit".

`t_i` is the median `apply_ns` of tx `i` over the 7 instrumented samples of the native replay
(`workloads/profiler`: Geth v1.17.10 `core.ApplyMessage`, warm cache, sequential). Ties resolve to the
smallest index. `schedules` gives `Σt / makespan` for 1, 2, 4, 8 and 16 cores: LPT for validators,
bottom-level list scheduling over the DAG for builders. One core always gives exactly 1.0.

Code: `internal/xray/schedule.go` (ceilings, schedules), `internal/xray/compute.go` (read/write model,
graph, hot locations), `internal/xray/engine.go` (capture, envelope, store), `internal/api/xray.go` (REST).

## Read/write model

- Writes: BAL changes with `transaction_index == i`, decoded from the Nimbus payload envelope
  (`/eth/v1/beacon/execution_payload_envelopes/{slot}`, RLP) and checked against the header's
  `blockAccessListHash`. Pre- and post-execution entries are ignored.
- Reads: every prestateTracer storage key, the `code` of every prestate account, and the sender's
  `balance` and `nonce`. This is a superset of real reads, so the builder ceiling is conservative.
- Excluded from both: the fee recipient, the 4788/2935/7002/7251 system contracts, `0xff…fe`, and
  precompiles `0x01`–`0x11` and `0x100`. Otherwise every tx would conflict on the coinbase balance.
- Edges come from `bal.BuildGraph` (100,000 edge cap; `edge_limit_reached` when hit).

The `coverage` array always lists the model's limits: `reads_are_prestate_superset`,
`non_sender_balance_reads_not_modeled`, `excluded_fee_recipient_system_contracts_precompiles`,
`replay_is_warm_cache_sequential_apply_message`, `state_root_io_and_bal_processing_excluded`,
`ceilings_are_upper_bounds`. Conditional entries: `no_replay_metrics`, `bal_commitment_unavailable`,
`edge_limit_reached`, `epbs_state_unavailable`, `uniswap_v3_pools_unverified`.

Hot locations carry Uniswap v3/v4 labels from `internal/uniswap` (see `docs/UNISWAP.md`).
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
| `POST /api/v1/xray/blocks/{hash}` | 201 report, 429 `busy`, 422 `xray_unavailable` |

The POST shares one replay gate with profile jobs and the follower. It waits up to 15 s for that gate
before answering 429, because a follow job holds it for about 10 s of every 12.

## What the live runs showed (2026-11-06, blocks 12,075,736 to 12,075,800)

We took 22 Sepolia blocks with 69–220 transactions (21 live plus the demo capture of 12,019,547).
All had verified BAL commitments.

- The gas-weighted ceiling ranged from **3.07×** to **30.56×**. The measured-time ceiling stayed between
  **16.7×** and **20.7×**. Gas is a poor proxy for apply time.
- Large contract creations dominate gas but not time. In block 12,075,748, tx 0 is a 21,105,490-gas
  creation whose median apply time is 230,675 ns. Tx 13 used 2,491,067 gas and took 31.65 ms.
  Block 12,075,791 has a 31,730,738-gas creation that applied in 284 µs. Under EIP-8037, receipt
  gas includes state gas, which is not execution time.
- In every block, the time bottleneck was a call that uses 2,491,067 gas, writes no storage and takes
  about 29–37 ms (to `0x4a656861cae32ca04623763a59f708410de73441` in all live blocks). It is
  independent of every other transaction, so the builder critical path has length 1 and
  `builder_dag_time == validator_bal_time` in all 22 blocks. On these blocks a BAL does not raise the
  time ceiling over a perfect conflict-aware builder. One heavy transaction bounds both views.
- `gas_misidentifies_bottleneck_share` compares capping indices. Several blocks contain more than
  one of these identical-gas calls. In those blocks the gas view picks the first one and the time view
  picks the slowest, so the share also counts ties.

Integration run (2026-11-06 10:07–10:16 UTC, `serve` with the follower, blocks 12,075,870–12,075,914):
33 blocks stored, all with verified BAL commitments and an ePBS object. Gas-weighted p10/median/p90 was
4.06× / 9.23× / 26.43×; validator with BAL 17.86× / 19.47× / 20.86×; builder 16.98× / 19.47× / 20.86×.
The follower skipped 8 blocks with more than 512 txs and 2 whose replay failed receipt validation.
Two blocks broke the single-tx pattern, so the builder view is not always equal to the validator view:
- Block 12,075,883 (`0xb0fd451d…939a`, 64 txs, self-build): validator with BAL **18.87×** (capped by tx 38),
  builder **13.50×**. Txs 8 → 9 → 10 (about 1.41M gas and 15 ms each) are chained through shared state, and
  that path is longer than any single tx. Gas-weighted is 23.05×, capped by tx 18.
  This report is the dashboard's offline example (`dashboard/public/examples/xray-report.json`).
- Block 12,075,870 (`0x81757b22…dcf0`): validator 13.69× vs builder 12.82×. The critical path is tx 18 → tx 67,
  where tx 67 is a 53.6 ms Multicall3 call. Gas-weighted is 4.99×, capped by tx 47, a 20,211,245-gas creation
  that applies in 196 µs.

Another verified example of gas versus execution: Sepolia block 12,075,273 has header gasUsed
92,173,320 and a receipt sum of 155,156,084 (EIP-8037 two-dimensional gas). Its tx 72 is a
55,719,446-gas contract creation. Our node no longer has state for it, so it cannot be replayed here.

## Limits

These are timings of a warm-cache, sequential `ApplyMessage` replay on one machine
(Intel Xeon Skylake, 8 logical CPUs). State-root computation, disk IO and BAL processing are excluded.
Real clients add scheduling overhead, so every number is an upper bound.
