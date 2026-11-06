# Three picks: implementation contract (2026-11-06)

Picks: EF Frame Tx Alt Mempool, Uniswap "Build with Uniswap", Hedera "AI Agents That Pay: x402".
Spine: the Glamsterdam X-ray. This file is the only contract between I1–I5. If something is not
here, choose the smallest option that fits the existing code and write it down in your own doc.

## 0. Ground rules

- Worktree `/home/ubuntu/Rooted-picks` is shared by all five implementers. Keep the tree compiling
  every time you save. Land compiling stubs of every exported signature in §2 and §3 in your first
  10 minutes, then fill them in. Run tests for your own packages only. The integrator runs `./...`.
- Env: `export PATH=$HOME/sdk/go/bin:$HOME/.foundry/bin:$PATH; cd /home/ubuntu/Rooted-picks; set -a; . ./.env; set +a`.
  Then override with your own slot. I1: `rooted_p1`, `127.0.0.1:8181`. I2: `p2`/8182. I3: `p3`/8183.
  I4: `p4`/8184 plus `next dev -p 3104`. I5: `p5`/8185 plus `next dev -p 3105`.
  DSN: `postgres://rooted:rooted-local-only@127.0.0.1:54330/rooted_pN?sslmode=disable`.
  Go DB tests: `TEST_DATABASE_URL=…/rooted_ptest`. Use the schema-per-test pattern from `internal/profiler/store_test.go`.
- Build your own binary (`go build -o .tools/rooted-iN ./cmd/rooted`). Only the integrator writes `.tools/rooted`.
- FRAMING (all docs and UI text): with an EIP-7928 BAL, validators can execute every tx in parallel.
  The validator ceiling is Amdahl on measured time. The RAW/WAR/WAW conflict DAG is the
  **builder / no-BAL** view, never "the validator limit". Every ceiling is labelled "upper bound".
- Verified fact (usable in docs): Sepolia block 12075273 has header gasUsed 92,173,320 and a receipt
  sum of 155,156,084 (EIP-8037 two-dimensional gas). Its tx 72 is a 55,719,446-gas contract creation.
  Our node no longer has state for that block (head is now ~12,075,600), so do not promise to replay it live.
- Facts checked while writing this spec (14:30–15:00 IST):
  - About 40% of recent Sepolia blocks have more than 128 txs; some have more than 1,000.
  - Nimbus `/eth/v1/beacon/execution_payload_envelopes/{slot}` still serves old envelopes. Slot 11461982 returned a 61,864-char BAL for the committed profiler fixture block `0x9f5d…b9ba`, so an offline capture can still get its BAL.
  - Frame devnet genesis is still `0x2ad3…ae7a`, gateway v4.1.1 with `faucetEnabled:true`.
  - npm `@x402/{core,next,hedera,fetch,evm}` are at 2.30.0. `@x402/next` peer-depends on `next>=16.4.1` and `@x402/paywall ^2.30.0`.

## 1. X-ray report JSON (`schema: "rooted-xray-v1"`)

Units: gas is an integer gas count. Time is integer nanoseconds (`*_ns`). Ceilings and speedups are
float64 (dimensionless, ≥1). Hashes and addresses are lowercase `0x` hex. Numbers are JSON numbers.
`null` means unavailable, never zero.

```jsonc
{
  "schema": "rooted-xray-v1", "network": "sepolia",
  "computed_at": "2026-11-06T09:30:00Z",
  "source": "live|profile|capture|follow",          // see §2.4
  "profile_id": "0x…"|null,                          // execution_profiles.id when a capture was saved/reused
  "block": {"number": 12075273, "hash": "0x…", "parent_hash": "0x…", "timestamp": 1793956584,
            "slot": 11461982|null, "beacon_block_root": "0x…"|null,   // from the payload envelope message
            "parent_beacon_block_root": "0x…", "fee_recipient": "0x…", "gas_limit": 200000000, "transaction_count": 128},
  "gas": {"header_gas_used": 92173320, "receipts_gas_sum": 155156084, "differs": true},
  "bal": {"commitment": "0x…", "computed_commitment": "0x…", "commitment_verified": true, "accounts": 812,
          "source": "beacon_payload_envelope", "schema": "eip-7928-rlp-index-value-v1"},
  "transactions": [{"index": 0, "hash": "0x…", "from": "0x…", "to": "0x…"|null, "is_create": false, "status": 1,
                    "gas_used": 21000, "apply_ns_median": 41234|null, "reads": 7, "writes": 3, "depends_on": [ ]}],
  "edges": {"RAW": 10, "WAR": 3, "WAW": 7, "total": 20, "dependent_pairs": 15, "truncated": false},
  "independent_transactions": 100,                   // txs with empty depends_on
  "ceilings": {
    "gas_weighted":       {"model": "validator_bal", "weight": "gas", "value": 2.78, "total": 155156084, "bottleneck": 55719446, "capping_tx_index": 72},
    "validator_bal_time": {"model": "validator_bal", "weight": "ns",  "value": 3.1|null, "total": …, "bottleneck": …, "capping_tx_index": 72|null},
    "builder_dag_time":   {"model": "builder_dag",   "weight": "ns",  "value": 1.9|null, "total": …, "bottleneck": …, "capping_tx_index": 72|null,
                           "critical_path": [3, 40, 72]}
  },
  "schedules": {"cores": [1, 2, 4, 8, 16], "validator_bal_time": [1, 1.98, …]|null, "builder_dag_time": [1, 1.7, …]|null},
  "hot_locations": [{"address": "0x…", "field": "storage|balance|nonce|code", "key": "0x…64"|"",
                     "writers": 3, "readers": 5, "edges": 12, "on_critical_path": true,
                     "label": {"protocol": "uniswap_v4", "name": "pool_slot0", "pool": "0x<poolId>", "verified": true}|null}],
  "uniswap": {"v3_swap_transactions": 2, "v4_swap_transactions": 1, "labeled_edges": 5},
  "epbs": {"slot": 11461982, "beacon_block_root": "0x…", "builder_index": "12", "source": "payloadwatch|envelope",
           "self_build": false|null, "status": "…"|null, "delivery": "…"|null, "reveal_latency_ms": 812|null,
           "ptc_payload_yes": 300|null, "ptc_payload_no": 2|null, "ptc_timely": true|null, "canonical": true|null}|null,
  "replay": {"runner": "rooted-native-replay-v1", "geth_library": "v1.17.10", "cpu_model": "…", "logical_cpus": 8,
             "samples": 7, "median_apply_ns": 123456789}|null,
  "excluded_addresses": ["0x…"],
  "coverage": ["…"]                                  // vocabulary below
}
```

Definitions. Notation: `n` is the tx count, `g_i` is the receipt `gasUsed`, and `t_i` is
`apply_ns_median`, the median over the 7 samples of `samples[s].transactions[i].apply_ns`
(sorted ascending, element `ceil(7/2)-1`, which matches `dashboard/lib/profiler.ts median`).

- `gas_weighted.value = Σg / max g`. Its capping tx is `argmax g`. This is Amdahl with gas used as a proxy for time.
- `validator_bal_time.value = Σt / max t`. Its capping tx is `argmax t`.
- `builder_dag_time`: `dp_i = t_i + max(dp_p for p in depends_on(i))`. Edges always run from a lower
  index to a higher one, so evaluate in index order. `bottleneck = max dp`, `value = Σt / bottleneck`.
  `critical_path` backtracks from `argmax dp` through `argmax dp_p`. `capping_tx_index` is the largest `t` on the path.
- Ties resolve to the smallest index everywhere. With no metrics, both time ceilings and both
  schedules are `null`, and `coverage` gets `no_replay_metrics`.
- Schedules, with `speedup_k = Σt / makespan_k`:
  - Validator: LPT. Sort by `t` descending (index ascending on ties). Each task goes to the least-loaded core (lowest core id on ties).
  - Builder: sort by bottom-level descending, then index ascending. Bottom-level is `t_i + max bottom-level of successors`; with `t>0` this is a valid topological order. Each task goes to the core that frees up earliest. `start = max(finish of preds, core free time)`.
  - k=1 must give exactly 1.0 in both models.
- Reads (builder model):
  - every `(addr, storage, key)` in the tx's prestateTracer result;
  - `code` of every prestate account;
  - `balance` and `nonce` of `tx.from`.
- Writes: BAL changes with `transaction_index == i`, via `bal.NativeAccess`. Pre-execution and post-execution indices are ignored.
- Excluded addresses (dropped from reads and writes, listed in `excluded_addresses`):
  - `block.miner`;
  - system contracts `0x000f3df6d732807ef1319fb7b8bb8522d0beac02` (4788), `0x0000f90827f1c53a10cb7a02335b175320002935` (2935), `0x00000961ef480eb55e80d19ad83579a64c007002` (7002), `0x0000bbddc7ce488642fb579f8b00f3a590007251` (7251) and `0xfffffffffffffffffffffffffffffffffffffffe`. All four contracts were confirmed with eth_getCode on our node;
  - precompiles `0x…01` to `0x…11` and `0x…0100`.
- Edges come from `bal.BuildGraph(access, false, 100000)`. `depends_on(i)` is the sorted unique `From` of edges with `To == i`.
- `hot_locations`: the top 10 by edge count, then writers, then `Location.ID()`. `on_critical_path` means some edge on this location joins two consecutive critical-path txs.
- Coverage vocabulary (exact strings):
  - always present: `reads_are_prestate_superset`, `non_sender_balance_reads_not_modeled`, `excluded_fee_recipient_system_contracts_precompiles`, `replay_is_warm_cache_sequential_apply_message`, `state_root_io_and_bal_processing_excluded`, `ceilings_are_upper_bounds`;
  - conditional: `no_replay_metrics`, `bal_commitment_unavailable`, `edge_limit_reached`, `epbs_state_unavailable`, `uniswap_v3_pools_unverified`.

**Brief** (one row of list/summary, stored as its own column):
`{block_hash, block_number, slot, computed_at, source, transaction_count, header_gas_used,
receipts_gas_sum, commitment_verified, gas_weighted, validator_bal_time, builder_dag_time (floats|null),
gas_capping_tx_index, validator_capping_tx_index (int|null), builder_critical_path_length (int|null),
speedup_8_validator, speedup_8_builder (float|null), builder_index (string|null)}`.

**Summary** (`GET /summary`):
`{blocks, from_block, to_block, ceilings: {gas_weighted|validator_bal_time|builder_dag_time: {p10, median, p90}|null},
single_tx_bound_share, gas_misidentifies_bottleneck_share, commitment_verified_share,
speedup_8: {validator_median, builder_median}}`. Percentiles are nearest-rank (`ceil(n·p)-1`) over non-null values.
- `single_tx_bound_share` = share of blocks whose builder critical path has length 1.
- `gas_misidentifies_bottleneck_share` = share of blocks where `gas_capping ≠ validator_capping` (time-bearing blocks only).

## 2. Go: `internal/xray` (I1)

### 2.1 Pure API (`report.go`, `compute.go`, `schedule.go`, `summary.go`)
```go
const Schema = "rooted-xray-v1"
type Inputs struct {
	Capture   profiler.Capture     // Block, Receipts, Traces (prestateTracer, non-diff); Ancestors unused
	Native    bal.Native           // bal.DecodeNativeRLP(envelope BAL, n, block.blockAccessListHash)
	Metrics   json.RawMessage      // rooted-native-replay-v1 output; nil => time views null
	Envelope  *Envelope            // {Slot uint64; BeaconBlockRoot, BuilderIndex string}; nil allowed
	EPBS      *EPBS                // §1 epbs object; nil => coverage epbs_state_unavailable
	Uniswap   uniswap.BlockContext // built by the caller (§3); zero value => no labels
	Source, ProfileID string
	Now       time.Time
}
func Compute(in Inputs) (Report, error)        // validates tx/receipt/trace/metrics identity and counts; error on mismatch
func Ceilings(t []int64, g []uint64, preds [][]int) (gas, validator, builder Ceiling) // exported for tests
func Speedups(t []int64, preds [][]int, cores []int) (validator, builder []float64)
func BriefOf(r Report) Brief
func Summarize(b []Brief) Summary
```
Compute rejects the following: an empty block; `n > 512`; a trace `txHash`, receipt hash or metrics
`transaction_count` that does not match the block; and `ValidateMetrics` failure. Use the existing
helpers (`bal.Address`, `bal.Word`, `bal.Number`, `bal.BuildGraph`, `bal.NativeAccess`, `profiler.ValidateMetrics`).

### 2.2 Live engine (`envelope.go`, `engine.go`)
```go
type Engine struct {
	Profiler  *profiler.Collector; Profiles *profiler.Store; Store *Store
	Execution remote.Execution;    Beacon   remote.Beacon
}
func (e *Engine) Block(ctx context.Context, hash string, source string) (Report, error) // POST + `rooted xray HASH`
func (e *Engine) FromCapture(ctx context.Context, capture, envelope []byte) (Report, error)  // offline; envelope may be nil
func (e *Engine) Follow(ctx context.Context, gate chan struct{}, logger *slog.Logger)       // serve worker / xray-follow
func FetchEnvelope(ctx context.Context, b remote.Beacon, slot uint64, blockHash string, number uint64, n int, commitment string) (bal.Native, Envelope, error)
```
- `Block`:
  1. If `execution_profiles` already has a row for the hash (latest `created_at`), reuse its capture and metrics, with no re-measure and `source="profile"`.
  2. Otherwise call `Profiler.Capture`, then `Profiles.Correlate`, then `Profiles.Save`, with `source="live"`.
  3. Then: envelope by `block.slotNumber`; `uniswap.ContextFromLogs(all receipt logs)`; `uniswap.VerifyV3Pools` with an `eth_call` Caller bound to `{"blockHash": hash}` (at most 8 pools, best effort); `Store.EPBS`; `Compute`; `Store.Save`.
- `FetchEnvelope`: GET `/eth/v1/beacon/execution_payload_envelopes/{slot}`. Check `payload.block_hash`, `block_number` and `slot_number`, as in `internal/analysis/native_bal.go`. Return `message.beacon_block_root` and `message.builder_index`. This copies about 30 lines of the unexported analysis code on purpose (`shortcut:` comment).
- `FromCapture`:
  - Accept gzip (magic `1f 8b`), capped at 32 MiB.
  - Call `Profiler.Measure(ctx, profiler.Report{CaptureMode:"recorded_capture", InputCapturedAt: now, BlockHash, BlockNumber}, capture)`.
  - Take the envelope from the file if given, else `FetchEnvelope` from Nimbus.
  - Leave v3 pools unverified, set `source="capture"`, save.
- `Follow`:
  - Every 12 s, try a non-blocking send on `gate`. If busy, skip the tick; never queue.
  - Target `eth_blockNumber - 2`. Skip it if already stored.
  - Run Capture (no profile save, so no capture blob on disk), then envelope, then Compute, then save with `source="follow"`.
  - Log each skip or failure once as warn and move on. There are no retries; a block that leaves the ~128-block state window is simply missed.
- Tx bound: raise 128 to 512 in `internal/profiler/profiler.go` (Capture and Measure) and in `workloads/profiler/main.go`. Rebuild `.tools/rooted-replay` (`cd workloads/profiler && go build -o ../../.tools/rooted-replay .`). Captures over 32 MiB still fail, and the follower skips them.

### 2.3 Store + migration `migrations/008_xray.sql` (005 is reserved for CRE; 006 and 007 exist)
```sql
CREATE TABLE xray_reports (
 block_hash TEXT PRIMARY KEY, network TEXT NOT NULL CHECK(network='sepolia'),
 block_number BIGINT NOT NULL, slot BIGINT, source TEXT NOT NULL CHECK(source IN ('live','profile','capture','follow')),
 computed_at TIMESTAMPTZ NOT NULL, profile_id TEXT, brief JSONB NOT NULL, report JSONB NOT NULL);
CREATE INDEX xray_reports_number ON xray_reports(network, block_number DESC);
```
`Save` upserts (`ON CONFLICT(block_hash) DO UPDATE`, latest measurement wins). Methods:
`Save(ctx, Report) error`, `Get(ctx, hash) (Report, error)` (returns `pgx.ErrNoRows` when missing),
`Has(ctx, hash) (bool, error)`, `List(ctx, limit) ([]Brief, error)` (block_number DESC),
`EPBS(ctx, hash) (*EPBS, error)`. `EPBS` reads `pw_states WHERE network='sepolia' AND mode='live'
AND state->>'payload_hash'=$1 ORDER BY updated_at DESC LIMIT 1`, as `profiler.Store.Correlate` does.
The envelope's builder index and root apply when no row exists (`source:"envelope"`).

### 2.4 REST (`internal/api/xray.go`; all require `?network=sepolia`, else 400 `invalid_scope`)
| Route | OK | Errors |
|---|---|---|
| `GET /api/v1/xray/blocks/{hash}` | 200 `{"data": Report}` | 400 `invalid_hash`, 404 `not_found` ("no stored X-ray; POST to compute"), 503 `unavailable` |
| `GET /api/v1/xray/blocks?limit=` (1–200, default 50) | 200 `{"data": [Brief]}` | 400 `invalid_limit` |
| `GET /api/v1/xray/summary?limit=` (1–10000, default 2000) | 200 `{"data": Summary}` | 400 `invalid_limit` |
| `POST /api/v1/xray/blocks/{hash}` (body ignored) | 201 `{"data": Report}` | 429 `busy`, 422 `xray_unavailable` (err text), 500 `storage_error`, 503 |

`Server` gains `Xray *xray.Store; XrayEngine *xray.Engine; XrayGate chan struct{}`. The POST uses an 85 s context.
`main.go` creates one `replayGate := make(chan struct{},1)` and passes it as both `ProfileGate` and
`XrayGate` and to `Follow`, so two native replays never overlap.

### 2.5 CLI (`cmd/rooted/main.go`; `parseArguments` tests go in a NEW `cmd/rooted/xray_args_test.go`)
- `rooted xray BLOCK_HASH` runs `Engine.Block(…, "live")` and prints `{"data": report}`.
- `rooted xray --capture CAPTURE.json[.gz] [ENVELOPE.json]` runs `Engine.FromCapture`. The command name is `xray-capture`.
- `rooted xray-follow` runs `Follow` in the foreground until SIGINT.
- `serve` starts `Follow` when `ROOTED_XRAY_FOLLOW=true` and `c.Network=="sepolia"`. This is read with `os.Getenv`, the same way `ROOTED_REPLAY_BINARY` is.
- Extend the help and usage strings. Do not change existing accepted or rejected forms, because `main_test.go` pins them.

## 3. Go: Uniswap labels (I2; `internal/uniswap/{v4,labels,verify}.go`, `v3.go` untouched)

Addresses were verified at 14:50 IST with eth_getCode on `127.0.0.1:18545` and cross-checked against the official pages
(https://docs.uniswap.org/contracts/v4/deployments, https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments):
- v3 Factory `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` (24,535 code bytes, already `uniswap.Factory`).
- v4 PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` (24,009 bytes). `StateView 0xe1dd9c3f…37e4c` `.poolManager()` returns it.

The `_pools` slot was checked live. For poolId `0xefd4fde4a8ac2e40092bd3c5025ef3869cfc2e4cff9b3cd900004ba06ab067f8`,
`keccak256(poolId ‖ uint256(6)) = 0x36d62fe1e6ddebb25f553a4697be8bc2a98c079a1a2db5565b5fd8e4fa02421c`.
`eth_getStorageAt` there decodes to the same sqrtPrice 2727419861661278430977805, tick −205545 and lpFee 3000 that StateView.getSlot0 returns.
```go
const PoolManager = "0xe03a1074c86cfedd5c142c4f04f1a1536e203543"
const SwapV4Topic = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"          // Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)
const ModifyLiquidityTopic = "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec" // ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)
const InitializeTopic = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
type SwapV4 struct { PoolID, Transaction, LogIndex, Sender, Amount0, Amount1, SqrtPrice, Liquidity string; Tick int64; Fee uint64 } // json: pool_id, transaction_hash, log_index, sender, amount0_raw, amount1_raw, sqrt_price_x96, liquidity, tick, fee
func DecodeSwapV4(log Log) (SwapV4, error)            // address == PoolManager, 3 topics, 192-byte data, range checks like DecodeSwap
func PoolStateSlot(poolID string) (string, error)    // keccak256(poolId ‖ uint256(6)) as 0x+64 hex
type BlockContext struct {
	V3Pools     map[string]bool     // pool address -> verified by factory (false = Swap-log candidate)
	V4Pools     map[string]bool     // poolId seen in PoolManager Swap/ModifyLiquidity/Initialize logs
	V4Ticks     map[string][]int64  // poolId -> Swap.tick and ModifyLiquidity tickLower/tickUpper
	V4Positions map[string][]string // poolId -> keccak256(abi.encodePacked(owner, tickLower, tickUpper, salt)), owner = ModifyLiquidity sender
}
type Label struct { Protocol string `json:"protocol"`; Name string `json:"name"`; Pool string `json:"pool"`; Verified bool `json:"verified"` }
func ContextFromLogs(logs []Log) BlockContext                        // pure; ignores removed logs
func LabelLocation(c BlockContext, address, field, key string) *Label // nil = unlabelled; key is 0x+64 lowercase (bal.Word)
type Caller func(ctx context.Context, to, data string) (string, error)
func VerifyV3Pools(ctx context.Context, call Caller, c *BlockContext) // factory()/token0()/token1()/fee()/getPool selectors as in internal/analysis/pool.go
```
Label names. Use `protocol` `uniswap_v3` or `uniswap_v4`. `Pool` is the v3 address or the v4 poolId.
- v3, on a pool in `V3Pools`:
  - `pool_slot0` (0), `fee_growth_global0` (1), `fee_growth_global1` (2), `protocol_fees` (3), `liquidity` (4);
  - `pool_mapping_or_observation` for any other key;
  - `Verified` = the pool is factory-verified.
- v4, on PoolManager with S = `PoolStateSlot(id)` for `id` in `V4Pools`:
  - `pool_slot0` (S), `fee_growth_global0` (S+1), `fee_growth_global1` (S+2), `liquidity` (S+3);
  - `tick_info`: `keccak(int256(tick) ‖ S+4)` plus offsets 0–2;
  - `position`: `keccak(positionKey ‖ S+6)` plus offsets 0–2;
  - `native_balance` for field `balance`;
  - `pool_manager_other_storage` for unmatched keys (verified false);
  - all others are verified true.
- Token balance (on any address):
  - `token_balance_of_pool_manager` / `token_balance_of_pool` when key = `keccak(pad32(holder) ‖ uint256(s))`, for s in 0–20 or the OZ v5 ERC-7201 base `0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00`;
  - `verified:false`, because the layout is assumed.

I2 also writes `FEEDBACK.md` (repo root) and `docs/UNISWAP.md`. Leave the README's file:line pointers to the integrator.

## 4. EF frame conformance (I3)

**Builder refactor.** `scripts/test_frame_transaction.py` exposes `build(key, nonce_seq, overrides=None) -> (tx_json, expected_hash)`.
`overrides` keys:
- `verify_execution` (default 30000), `verify_state` (0);
- `nonce_keys` (list of int, default `[0]`);
- `extra_sender_frames` (default 1 self-transfer of 1 wei, limit 50000; N>1 adds N frames of value 0, limit 5000);
- `fees`.

The existing CLI behaviour stays byte-identical. Pin it with a golden hash for a fixed key and nonce.
- Read the genesis from `ROOTED_FRAME_GENESIS_HASH`. The value `follow` skips the genesis pin but keeps the chain==1337 check.
- Read the binary from `ROOTED_BINARY` (default `.tools/rooted`).
- The builder never pre-rejects. The node is the oracle.

**Runner** `scripts/frame_conformance.py --submit [--record]`:
1. Create one fresh random key, fund it once from the faucet, and keep the key in memory only.
2. Submit the cases below at most 1 per new block, through `rooted frame-submit SIGNED.json HASH gateway` when `--record` is set.
3. Observe each verdict. Use the RPC ack or error first, then `skandha_explorer_getTransaction` on the gateway (≤30 s) for the `outcome` and failed `checks[]`. For accepted legacy-nonce txs, wait for the receipt (≤120 s) before the next case.
4. Keep a hard cap: `.tools/frame-submissions.log` counts every submission from both scripts, and the runner refuses to start if the count would pass 25.
5. Run the cases in this order (key-0 cases need account nonce 0).

| id | overrides | eip8141 | eip8250 | erc8421_draft | sidecar_docs |
|---|---|---|---|---|---|
| keys-zero-mixed | keys [0,307], seq 0 | n/a | accept | n/a | reject ("Key 0 is only valid on its own") |
| keys-empty | keys [], seq 0 | n/a | accept (legacy) | n/a | reject ("1 to 16 keys") |
| keys-17 | keys 101..117 | n/a | reject (MAX_NONCE_KEYS 16) | n/a | reject |
| keys-duplicate | keys [205,205] | n/a | reject (strictly increasing) | n/a | reject |
| keys-16 | keys 1..16, verify 97000, state 16×97920 | reject (MAX_VERIFY_STATE_GAS 500k) | accept | accept (no state cap) | accept |
| verify-99999 | verify 97199 (+2800 SECP256K1) | accept | n/a | accept (per-entity 100k) | accept |
| verify-100000 | verify 97200 | accept ("must not exceed") | n/a | accept | accept |
| verify-100001 | verify 97201 | reject | n/a | reject | reject |
| frames-64 | 63 extra SENDER frames | accept (MAX_FRAMES 64) | n/a | accept | accept |
| frames-65 | 64 extra SENDER frames | reject | n/a | reject | reject |

Sources: https://eips.ethereum.org/EIPS/eip-8141 (MAX_FRAMES 64, MAX_VERIFY_GAS 100000 including
signature cost, SECP256K1 = 2800, MAX_VERIFY_STATE_GAS 500000); https://eips.ethereum.org/EIPS/eip-8250
(MAX_NONCE_KEYS 16, `[]` = legacy, strictly increasing, 97,920 state gas per fresh key);
https://docs.altmempool.wtf/rules/constants/ and /rules/budget/ (ERC-8421 draft, per-entity 100k);
https://docs.altmempool.wtf/guides/keyed-nonces/ (sidecar: 1–16 keys, `["0x0"]` is legacy).

Re-read every source before running. Correct any cell with a quoted `expected_basis`. Do not
change an expectation after seeing the observation. The baseline own admitted tx comes from the
existing script (`test_frame_transaction.py --submit --record`, its own fresh key) and is recorded as case `baseline`.

**Results file** (committed): `integrations/frame-conformance/results.json`. The simplest option that
can still be demoed live was chosen: no migration 009.
```jsonc
{"schema": "rooted-frame-conformance-v1", "run_id": "hex16", "network": "<ROOTED_FRAME_NETWORK>", "chain_id": 1337,
 "genesis": "0x…", "gateway": "https://altmempoolgateway.forshtat.com/rpc", "sidecar_version": "v4.1.1",
 "started_at": "…", "finished_at": "…", "sender": "0x…", "sources": {"eip8141": "url", "eip8250": "url", "erc8421_draft": "url", "sidecar_docs": "url"},
 "cases": [{"id": "verify-100001", "group": "verify_budget|nonce_keys|frames|baseline", "description": "…",
   "overrides": {}, "expected": {"eip8141": "accept|reject|n/a", "eip8250": "…", "erc8421_draft": "…", "sidecar_docs": "…"},
   "expected_basis": {"eip8141": "quoted rule"}, "tx_hash": "0x…", "submitted_at": "…",
   "rpc": {"acknowledged": false, "error_code": -32000|null, "error_message": "…"|null},
   "admission": {"outcome": "accepted|rejected|included|…", "failed_checks": [{"rule": "structure", "detail": "…", "frameIndex": 0|null, "entity": ""}]}|null,
   "observed": "accept|reject|unknown", "observed_rule": "structure"|null, "rooted_attempt_id": "…"|null,
   "receipt": {"block_number": "0x…", "status": "0x1"}|null}]}
```
- **Route** (I3 writes `internal/api/frame_conformance.go`; I1 adds the route line): `GET /api/v1/frames/conformance?network=<frame network>`.
  - It uses `frameScope`. It reads `ROOTED_FRAME_CONFORMANCE_FILE` (default `integrations/frame-conformance/results.json`, ≤1 MiB).
  - It rejects a wrong `schema` with 500 `invalid_results` and returns 404 `not_found` when the file is absent.
  - On success it returns 200 `{"data": results}`. Each case gains `archive_status` from `s.Frames.States(gateway scope, hash, 1)`, or `null`.
- **devnet_reset** (`internal/framemempool/store.go Register`):
  - A changed `chain_id` is still a hard error.
  - A changed `genesis_hash` inserts incident `devnet_reset`, identity `old:new`, with detail `{previous_genesis, current_genesis, previous_boot, current_boot}`.
  - It then resets `seq=0` and `scan_cursor`, skips `node_restarted`, and updates `genesis_hash` in the upsert.
  - `ROOTED_FRAME_GENESIS_HASH=follow` (accepted in `internal/config/frame.go`) makes `Verify` accept the live block-0 hash and pass it to `Register`, so an overnight archive survives a reset. The pinned hash stays the default.
  - Known limit: if the boot id is unchanged across a reset, old and new rows share it, and the incident marks the boundary.
- Explorer link: `https://explorer.altmempool.wtf/tx/{hash}` (route taken from the explorer bundle). I3 confirms it in a browser.
- I3 writes `docs/FRAME_CONFORMANCE.md`: trade-offs (durable archive vs in-memory explorer, conformance as differential testing, the 25-tx etiquette, combined vs per-entity budget) and divergences found.

## 5. Dashboard (I4)

- **Proxy** (`lib/proxy.ts`): add `api\/v1\/xray\/(blocks(\/0x[0-9a-fA-F]{64})?|summary)` and `conformance` to the frames group.
  Existing `tests/proxy.test.ts` must still pass. New cases go in `tests/proxy-xray.test.ts`.
- **Hosted mode** (`app/api/backend/[...path]/route.ts`): with `ROOTED_HOSTED=1`, a GET of `api/v1/xray/blocks/0x…` returns 402.
  The body is `{"error": {"code": "payment_required", "message": "Hosted mode: per-block X-ray reports are sold to agents via x402", "paid_url": "/api/paid/xray/<hash>"}}`.
  List and summary stay free. Every dashboard POST route (`analysis`, `profiler`, `provider-comparison`, `policy-deployment`, new `xray`) returns 403 in hosted mode, through `lib/hosted.ts hosted(): boolean`.
- **`app/api/xray/route.ts`** POST `{block_hash}` copies the `app/api/profiler/route.ts` guards (same Origin, JSON, 4 KiB). It forwards to `POST /api/v1/xray/blocks/{hash}?network=sepolia` with a 90 s timeout and `maxDuration = 100`.
- **`lib/xray.ts`** holds the §1 types plus:
  - `parseReport(v: unknown): Report`, which throws on wrong schema, hash format, `transactions.length ≠ block.transaction_count`, ceilings < 1, or schedule length ≠ 5;
  - `parseBriefs`, `parseSummary`;
  - `laneRows(r)` → `{index, hash, gas, ns, widthNs, widthGas, validatorCap, gasCap, onCriticalPath}`;
  - `speedupSeries(r)`, `formatX(v) → "2.78×" | "Unknown"`.
- **`components/xray.tsx`**, the new `xray` View ("Glamsterdam X-ray") and its `?view=xray&block=0x…` route:
  - **Hero:** three cards. Gas-weighted reads "what the gas limit assumes". Validator with BAL reads "Amdahl on measured time". Builder / no BAL reads "conflict-DAG critical path". Each card shows value, capping tx #, weight unit and an "upper bound" badge. Under the hero, a gas strip: header gasUsed vs receipt sum (EIP-8037).
  - **Lane view:** one bar per tx, width ∝ `apply_ns_median`, with a gas/time toggle. Highlight the validator capping tx and the critical-path txs. Clicking a tx shows its `depends_on`.
  - **Speedup vs cores:** inline SVG, k = 1, 2, 4, 8, 16, two series plus a `y=k` reference. No chart dependency.
  - **Hot locations:** a table with the Uniswap label badge, `verified` and on-critical-path markers, plus the `uniswap` counts.
  - **ePBS strip** for the slot, and a **recent blocks strip** from `/blocks?limit=30` (click selects). Under it, summary medians.
  - "Compute X-ray" button, POST `/api/xray`, hidden when the backend answers 402 or 403.
  - **STORED:** when the backend fetch errors, fetch `/examples/xray-report.json` and show `<Badge>STORED</Badge>` with `computed_at`. The integrator commits that file from a real run. If it is absent, show "backend offline, no stored report". A 402 shows the brief plus a "paid via x402" notice.
- **Frames view additions:**
  - `components/frame-conformance.tsx`: a case table with four expected columns, the observed verdict and rule, match/divergence marks, and explorer + Rooted evidence links. Source: `/api/v1/frames/conformance`.
  - An "Own admitted tx" panel, from `/api/v1/frames/submissions` (latest `submission_acknowledged`) joined with `/api/v1/frames/transactions/{hash}`: status, `inclusion_confirmed`, receipt check, explorer link.
  - Replace the stale "Our funded inclusion demo remains blocked" text.
  - `lib/frame-conformance.ts` holds the parser and `divergent(case)`: sources disagree, or observed differs from any non-n/a source.
- Update `components/execution-profiler.tsx` to say "at most 512 transactions".

## 6. Hosted x402 on Hedera (I5)

- Packages (exact pins, dashboard): `@x402/core @x402/next @x402/paywall @x402/hedera @x402/fetch` `2.30.0`.
  `@x402/evm` and `viem` are only for the optional Sepolia path. Re-check `npm view` before installing.
  If Next bundling of `@hiero-ledger/sdk` fails, add it to `serverExternalPackages` in `next.config.ts` (I5 owns that file).
- **Before building, check `curl https://x402.org/facilitator/supported`.** It must list `exact` on `hedera:testnet`
  (research saw feePayer `0.0.9185802`). Fallback: Blocky402 `https://api.testnet.blocky402.com`.
- `lib/x402.ts` exports `x402Config(env)`, which returns `null` unless `ROOTED_X402_ENABLED==="true"`. It validates:
  - `ROOTED_X402_PAY_TO` (`^0\.0\.\d+$`, required);
  - `ROOTED_X402_HEDERA_ASSET` (default `0.0.0` = HBAR; `0.0.429274` = testnet USDC when both accounts are associated);
  - `ROOTED_X402_PRICE_ATOMIC` (digits; default `1000000` tinybars = 0.01 HBAR; `10000` for $0.01 USDC);
  - `ROOTED_X402_FACILITATOR_URL` (https; default `https://x402.org/facilitator`);
  - `ROOTED_X402_MAX_TIMEOUT_SECONDS` (default 120).
- `app/api/paid/xray/[hash]/route.ts`:
  - The handler reads the hash from `request.nextUrl.pathname`, because `withX402` passes only the request. It validates `^0x[0-9a-f]{64}$`, then GETs `/api/v1/xray/blocks/{hash}?network=sepolia` on the validated `ROOTED_BACKEND_URL` origin (10 s). It relays status and body with `Cache-Control: no-store`.
  - Export: `GET = cfg ? withX402(handler, {"/api/paid/xray/[hash]": {accepts: [{scheme: "exact", network: "hedera:testnet", payTo, price: {amount, asset}, maxTimeoutSeconds}], description: "Rooted Glamsterdam X-ray report for one Sepolia block"}}, server) : disabled`. Disabled means a 404 that names the free self-host route.
  - `server = new x402ResourceServer(new HTTPFacilitatorClient({url})).register("hedera:testnet", new ExactHederaScheme())`.
  - `withX402` settles only on status < 400, so an unknown hash (404) or a backend failure (502) is never charged.
  - Optional (cut first): when `ROOTED_X402_SEPOLIA_RELAYER_KEY` is set, add `eip155:11155111`, asset USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (EIP-712 extra `{name:"USDC", version:"2"}`, EIP-3009), settled by an in-process `x402Facilitator` with `@x402/evm`, following the official self-facilitation example.
- **Agent** `integrations/x402-agent/` (own `package.json` with the same pins, `agent.mjs`, `setup.mjs`, `spend.mjs`, `spend.test.mjs`, `README.md`, `.env.example`):
  1. `agent.mjs [HASH]` reads `ROOTED_PUBLIC_URL`. With no hash, it picks the newest stored block from the free `/api/backend/api/v1/xray/blocks?network=sepolia&limit=1`.
  2. It calls `wrapFetchWithPayment(fetch, x402Client)` with `ExactHederaScheme(createClientHederaSigner(AGENT_ID, PrivateKey.fromStringECDSA(AGENT_KEY), {network:"hedera:testnet"}))`.
  3. Spend controls:
     - `spendControls.allowedAssets: [{network:"hedera:testnet", asset, maxAmountPerPayment: MAX_PER_REQUEST}]`;
     - a policy that keeps only `payTo == ROOTED_EXPECTED_PAY_TO`;
     - an `onBeforePaymentCreation` hook that aborts once the session total would exceed `SESSION_BUDGET` (`spend.mjs decide(req, state, limits)`, pure).
  4. Refusals print one JSON line `{"refused":true,"reason":…,"amount":…,"budget_left":…}` and exit with code 3.
  5. On success it checks `report.schema` and `report.block.hash`, decodes `PAYMENT-RESPONSE`, and prints the tx id plus `https://hashscan.io/testnet/transaction/<id>` and a one-line finding (three ceilings, capping tx).
  6. It appends a JSON line to `.tools/x402-agent/runs.jsonl`.
  7. Optional: when `ROOTED_AGENT_HCS_TOPIC` is set, it submits `{block_hash, report_sha256, payment_tx, amount, asset}` to the topic (audit log).
- **Keys:**
  - A human creates one ECDSA testnet account at https://portal.hedera.com (faucet HBAR) and puts `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` in `integrations/x402-agent/.env.local`. All `.env.*` files are gitignored.
  - `setup.mjs` creates the agent account (`AccountCreateTransaction`, ECDSA, 20 HBAR), and optionally an HCS topic and USDC association. It writes `AGENT_ID/AGENT_KEY/ROOTED_AGENT_HCS_TOPIC` to the same `.env.local`, and prints only account and topic ids with HashScan links.
  - Pay-to is the operator account id, which is not secret. It goes in `dashboard/.env.local`.
  - Never print or commit a key. The x402.org feePayer pays network fees.

## 7. File ownership (each shared file has exactly one owner)

| Owner | Edits | Creates |
|---|---|---|
| I1 xray-core | `cmd/rooted/main.go`, `internal/api/server.go` (incl. frames-conformance route line), `internal/profiler/profiler.go`, `workloads/profiler/main.go`, `.env.example` (append §9 verbatim) | `internal/xray/**` (fixtures in `internal/xray/fixtures/`, e.g. `envelope-12019547.json` fetched once from Nimbus), `migrations/008_xray.sql`, `internal/api/xray.go`, `internal/api/xray_test.go`, `cmd/rooted/xray_args_test.go`, `docs/XRAY.md` |
| I2 uniswap | none | `internal/uniswap/{v4,labels,verify}.go` + `*_test.go`, `FEEDBACK.md`, `docs/UNISWAP.md` |
| I3 frame-ef | `scripts/test_frame_transaction.py`, `internal/framemempool/{store,client,collector}.go`, `internal/config/frame.go` | `scripts/frame_conformance.py`, `scripts/test_frame_build.py`, `integrations/frame-conformance/**`, `internal/api/frame_conformance.go` + test, `internal/framemempool/reset_test.go`, `internal/config/frame_follow_test.go`, `docs/FRAME_CONFORMANCE.md` |
| I4 dashboard-ui | `dashboard/components/*` (incl. `dashboard.tsx`), `dashboard/lib/*` except `x402*`, `dashboard/app/{page,layout}.tsx`, `dashboard/app/globals.css`, `dashboard/app/api/{backend,analysis,profiler,provider-comparison,policy-deployment}/**` | `dashboard/components/{xray,frame-conformance}.tsx`, `dashboard/lib/{xray,frame-conformance,hosted}.ts`, `dashboard/app/api/xray/route.ts`, `dashboard/tests/{xray,frame-conformance,proxy-xray}.test.ts` |
| I5 x402-hedera | `dashboard/package.json`, `dashboard/package-lock.json`, `dashboard/next.config.ts` | `dashboard/app/api/paid/**`, `dashboard/lib/x402*.ts`, `dashboard/tests/x402.test.ts`, `integrations/x402-agent/**` |
| Integrator | `README.md`, `LICENSE` (only if the team confirms MIT), `dashboard/public/examples/xray-report.json` | commits |

Never edit: existing `docs/*` files, `demo/**`, existing `dashboard/tests/*` files, `dashboard/public/**` (integrator only),
existing `*_test.go` files, `internal/*/testdata/**`, other `scripts/*.py|*.mjs` files, `dashboard/components/rpc-inspector.tsx`, `cmd/rooted/main_test.go`.
Report needed changes elsewhere in `requests_for_others`.

Cross-dependencies: I1 imports I2's `uniswap.BlockContext`, `ContextFromLogs`, `LabelLocation` and `VerifyV3Pools`; stubs come first.
I1's `server.go` references I3's `s.frameConformance`, so I3 lands a compiling stub first. I4 and I5 code against the JSON in §1 and §4 only.

## 8. Test plans

- **I1:**
  - `schedule_test.go` table. Each case gives (validator, builder) ceilings and speedups:
    - chain t=[1,2,3] with 0→1→2: ceilings (2, 1); k=2 speedups (2, 1);
    - fan-out t=[1,1,1,1] with 0→{1,2,3}: (4, 2);
    - single fat tx t=[10,1,1,1], no edges: both 1.3, `critical_path=[0]`;
    - k=1 gives 1.0 in both; ties use the smallest index.
  - `compute_test.go`, on a synthetic 3-tx capture plus `bal.Native`:
    - coinbase, precompile 0x0a, 0x100 and 4788 writes are dropped;
    - same-sender nonce RAW appears; a create has `is_create`; `gas.differs`;
    - nil metrics give null time views plus `no_replay_metrics`;
    - identity mismatch gives an error.
  - Fixture test: `demo/profiler/replay-input.json.gz` + `demo/profiler/profile.json` metrics + `fixtures/envelope-12019547.json`, which must give a verified commitment, 69 rows and ceilings ≥ 1. Skip if the demo files are missing.
  - Store test on `TEST_DATABASE_URL`; API test for 400, 404, 429 (pre-filled gate) and 503; args test.
  - Live: run `rooted xray <head-3 hash>` and `rooted xray --capture demo/profiler/replay-input.json.gz` on `rooted_p1`, then `serve` with `ROOTED_XRAY_FOLLOW=true` until 3 or more reports are stored. Curl all four routes.
- **I2:**
  - `PoolStateSlot` golden (§3);
  - `DecodeSwapV4` on a real PoolManager Swap log captured with `cast logs` (inline JSON), plus rejections for wrong address, topic count and data length;
  - `LabelLocation` per name, including tick, position and token-balance slots 0, 9 and the OZ v5 base;
  - `VerifyV3Pools` with a fake Caller;
  - a live `eth_getStorageAt` cross-check recorded in `docs/UNISWAP.md`.
- **I3:**
  - `python3 -m unittest scripts/test_frame_build.py` (offline): a golden hash for the unchanged default, override effects, and a 65-frame build;
  - Go: `reset_test.go` (genesis A then B gives the incident and an updated row; a chain change still errors), the config `follow` test, and the conformance route (404, 400, 200, bad schema);
  - Live: one baseline `--submit --record`, then `rooted frame-sync gateway HASH` showing `inclusion_confirmed`, then one runner pass. Total submissions must stay ≤ 12.
- **I4:** `npm test` (all old and new tests), `npm run typecheck`, `npm run build`. Then a headless chromium screenshot of `?view=xray` against `:8184`, both with the backend on and with it stopped (STORED).
- **I5:** `x402.test.ts` (config parsing and defaults, disabled by default, bad pay-to, asset and price) and `node --test integrations/x402-agent/spend.test.mjs` (per-request cap, session budget, payTo mismatch). Live checks:
  - An unpaid GET returns 402 with a `PAYMENT-REQUIRED` header that decodes to hedera:testnet, payTo and amount.
  - A paid GET of an unstored hash returns 404 with no settlement.
  - A funded agent run gets 200 plus a settled tx id on HashScan.
  - A refusal run (`MAX_PER_REQUEST` below the price) exits 3.

**Integrator e2e checklist:**
1. Build and test:
   - `go vet ./... && go test ./...` with TEST_DATABASE_URL;
   - rebuild `.tools/rooted-replay` and `.tools/rooted`;
   - `cd dashboard && npm ci && npm test && npm run typecheck && npm run build`;
   - `python3 -m unittest scripts/test_frame_build.py`.
2. On a fresh DB, `rooted migrate` applies 008. Then `serve` with `ROOTED_XRAY_FOLLOW=true ROOTED_WATCH_ENABLED=true ROOTED_FRAME_ENABLED=true`. After 3 minutes, `/api/v1/xray/blocks` should have 3 or more rows, at least one with an `epbs` object, and `/summary` should be non-empty.
3. Run `rooted xray --capture demo/profiler/replay-input.json.gz`, which gives `source:"capture"`. Commit one real report as `dashboard/public/examples/xray-report.json`.
4. Dashboard `?view=xray`: hero, lanes, cores chart, hot slots with at least one Uniswap label if the block has swaps, ePBS strip. Kill the backend and confirm STORED.
5. Frames tab: the own tx shows admitted and included with a receipt check. The conformance table loads from the file, with divergences highlighted. Do a devnet_reset dry run on a scratch DB.
6. x402: enable it and run the agent. Copy the settled tx id and HashScan link into the README. Show the refusal run.
7. README:
   - exact `file:line` pointers from `grep -n` for `internal/uniswap/{v4,labels}.go` and `internal/xray/{compute,schedule}.go`, the PoolManager and Factory addresses with their docs URLs, and FEEDBACK.md;
   - the EF trade-offs (link `docs/FRAME_CONFORMANCE.md`);
   - the Hedera tx id;
   - the framing rule;
   - the AI-usage disclosure.
8. Run `git grep -nE '(PRIVATE_KEY|OPERATOR_KEY|AGENT_KEY)=.{8}'` (expect only `.env.example` placeholders), then `git status --ignored`, to confirm every `.env.local` is ignored.

## 9. `.env.example` additions (I1 appends verbatim)
```
# Glamsterdam X-ray follower (serve). Captures head-2 every 12s, skips while a replay runs.
ROOTED_XRAY_FOLLOW=false
# ROOTED_FRAME_GENESIS_HASH=follow  # accept devnet resets and journal a devnet_reset incident
ROOTED_FRAME_CONFORMANCE_FILE=integrations/frame-conformance/results.json
# Hosted mode (dashboard). Off by default; self-hosting stays free.
ROOTED_HOSTED=0
ROOTED_X402_ENABLED=false
ROOTED_X402_PAY_TO=0.0.0000000
ROOTED_X402_HEDERA_ASSET=0.0.0
ROOTED_X402_PRICE_ATOMIC=1000000
ROOTED_X402_FACILITATOR_URL=https://x402.org/facilitator
# ROOTED_X402_SEPOLIA_RELAYER_KEY=  # optional; never commit a real key
```
