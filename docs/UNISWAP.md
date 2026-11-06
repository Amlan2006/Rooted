# Uniswap in Rooted: contention under block access lists

Rooted watches Sepolia after Glamsterdam (ePBS, EIP-7732, and block access lists, EIP-7928). For each
block it builds a read/write conflict graph from the block's commitment-checked BAL and its per-tx
reads. `internal/uniswap` turns raw `(address, storage key)` locations into Uniswap terms. A hot
location then reads "v4 `pool_slot0` of pool `0x2a41…`", "`tick_info` at tick 3756", or
"`balanceOf[PoolManager]` on USDC" instead of an opaque 32-byte key. This is tooling for Uniswap
integrators, builders and searchers. It shows which swaps must be ordered relative to each other in a
block, and why.

**Framing.** With an EIP-7928 BAL, a validator already knows every post-state value, so it can execute
all transactions in parallel. The conflict DAG is not a validator limit. It is the **builder / no-BAL view**:
what a block builder, or a client without the BAL, must order when it executes speculatively. Every
ceiling Rooted prints is an upper bound. Uniswap pools are a natural serializer in this view: two swaps
on one pool both write `slot0`, so the second cannot be built without the first.

## Contracts (Sepolia, chain 11155111)

| Contract | Address | Source | On-chain check (our Geth v1.17.10 node) |
|---|---|---|---|
| v3 `UniswapV3Factory` | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` | [v3 Ethereum deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments) | 24,535 code bytes; `factory()` and `getPool` round-trip |
| v4 `PoolManager` | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | [v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments) | 24,009 code bytes |
| v4 `StateView` | `0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c` | same page | `poolManager()` returns the PoolManager |
| v4 `PositionManager` | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` | same page | the `sender` of recent `ModifyLiquidity` logs |
| `UniversalRouter` / 2.1.2 | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` / `0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3` | same page | `sender` of 25 / 85 of 188 v4 `Swap` logs in 2,000 blocks |

The old `docs.uniswap.org/contracts/...` URLs redirect to the pages above.

## Where the code is

| What | File and line |
|---|---|
| v4 constants: PoolManager, Swap/ModifyLiquidity/Initialize topics, `_pools` slot 6 | [`internal/uniswap/v4.go:12-18`](../internal/uniswap/v4.go) |
| `DecodeSwapV4`: address, topic and length checks; int128/uint160/uint128/int24/uint24 range checks | [`internal/uniswap/v4.go:71`](../internal/uniswap/v4.go) |
| Position key `keccak256(abi.encodePacked(owner, tickLower, tickUpper, salt))` from `ModifyLiquidity` | [`internal/uniswap/v4.go:97`](../internal/uniswap/v4.go) |
| `PoolStateSlot`: `keccak256(poolId ‖ uint256(6))` | [`internal/uniswap/v4.go:116`](../internal/uniswap/v4.go) |
| `BlockContext`, built from one block's receipt logs | [`internal/uniswap/labels.go:14`](../internal/uniswap/labels.go), [`ContextFromLogs` :36](../internal/uniswap/labels.go) |
| `LabelLocation`: v3 pool slots, v4 PoolManager state, token `balanceOf` keys | [`internal/uniswap/labels.go:58`](../internal/uniswap/labels.go) |
| Derived-slot index (tick +4, positions +6, OZ v5 ERC-7201 balances) | [`internal/uniswap/labels.go:92`](../internal/uniswap/labels.go) |
| `VerifyV3Pools`: `factory()`, `token0()`, `token1()`, `fee()`, then `getPool` round-trip (at most 8 pools per block) | [`internal/uniswap/verify.go:18`](../internal/uniswap/verify.go) |
| v3 Factory constant, v3 `DecodeSwap`, `swap` call decoding (existing) | [`internal/uniswap/v3.go:12`](../internal/uniswap/v3.go), [:87](../internal/uniswap/v3.go), [:115](../internal/uniswap/v3.go) |
| BAL decode (Nimbus envelope RLP, commitment-checked) and conflict graph | [`internal/bal/rlp.go:14`](../internal/bal/rlp.go), [`internal/bal/graph.go:9`](../internal/bal/graph.go) |
| X-ray wiring: `ContextFromLogs` and `VerifyV3Pools` in the engine, `LabelLocation` on hot locations | `internal/xray/engine.go` (`verifyPools`), `internal/xray/compute.go` (`hotEdges`) |

## Label vocabulary

`protocol` is `uniswap_v3` or `uniswap_v4`. `pool` is the v3 pool address or the v4 poolId. For
labels that are not tied to one pool, it is the holder or PoolManager address.

| Where | Key | `name` | `verified` |
|---|---|---|---|
| v3 pool from a `Swap` log | slots 0, 1, 2, 3, 4 | `pool_slot0`, `fee_growth_global0`, `fee_growth_global1`, `protocol_fees`, `liquidity` | true if the factory round-trip passes |
| v3 pool | any other key (ticks, bitmap, positions, observations) | `pool_mapping_or_observation` | same |
| PoolManager, for a poolId seen in its logs, with `S = keccak(poolId ‖ 6)` | `S`, `S+1`, `S+2`, `S+3` | `pool_slot0`, `fee_growth_global0`, `fee_growth_global1`, `liquidity` | true |
| PoolManager | `keccak(int256(tick) ‖ S+4)` + 0..2, for `Swap.tick` and `ModifyLiquidity` bounds | `tick_info` | true |
| PoolManager | `keccak(positionKey ‖ S+6)` + 0..2 | `position` | true |
| PoolManager | field `balance` | `native_balance` | true |
| PoolManager | anything else | `pool_manager_other_storage` | false |
| any token | `keccak(pad32(holder) ‖ s)` for s = 0..20, or the OZ v5 ERC-7201 base `0x52c6…ce00` | `token_balance_of_pool_manager` / `token_balance_of_pool` | false (layout assumed) |

The slot formulas follow v4-core `StateLibrary.sol`: `POOLS_SLOT = 6`, `LIQUIDITY_OFFSET = 3`,
`TICKS_OFFSET = 4`, `TICK_BITMAP_OFFSET = 5`, `POSITIONS_OFFSET = 6`. Nothing is labelled unless the
block's logs contain Uniswap activity (a zero `BlockContext` gives no labels).

## Live evidence (2026-11-06, our Sepolia node)

**1. Raw storage equals Uniswap's own getters.** Run
`ROOTED_TEST_LIVE_EXECUTION=http://127.0.0.1:18545 go test ./internal/uniswap/ -run LiveStorage -v`.
At one pinned head block, the test takes every PoolManager log of the last 1,000 blocks and builds a
`BlockContext`. It then checks that each labelled slot read with `eth_getStorageAt` equals the
StateView getter. StateView computes the slot in its own Solidity code. The checks are:
- `getSlot0`: low 160 bits;
- `getLiquidity`;
- `getTickInfo`: liquidityGross;
- `getPositionInfo(poolId, owner, tickLower, tickUpper, salt)`, which derives the position key itself.

For tokens that received transfers into PoolManager in the last 100 blocks, the test compares ERC20
`balanceOf(PoolManager)` with the labelled balance slot. Finally, it verifies v3 candidates through the
factory and compares slot0 and liquidity with the pool's getters.

```
block 12075744: 38 v4 pools, nonzero matches map[liquidity:30 pool_slot0:38 position:31 tick_info:41];
                4/5 tokens matched balanceOf(PoolManager); 6/15 v3 candidates factory-verified
block 12075779: 37 v4 pools, nonzero matches map[liquidity:30 pool_slot0:37 position:27 tick_info:39];
                6/7 tokens matched balanceOf(PoolManager); 6/20 v3 candidates factory-verified
```

No labelled slot disagreed with its getter. Each run checked the first 8 v3 candidates (the per-block
budget). The factory confirmed 6 of those 8, and their slot0 and liquidity matched the pool getters.

In the first run, the one unmatched "token" was `0xffff…fffe`. It has no code, and it emitted a
`Transfer`-shaped log for an internal 0.001 ETH call-value transfer into PoolManager (tx
`0x60a0265e…0246`, via the Universal Router). This is consistent with EIP-7708 ETH-transfer logs.
PoolManager's ETH is the `balance` field, labelled `native_balance`. All four real ERC20s in that run
use balance slot 0. They include the Sepolia test tokens with symbols USDC (`0xb588…cf48`) and USDT
(`0xcff2…6c04`).

Spot check by hand with `cast` for the poolId used in the design spec, at block 12075748:
- `S = 0x36d62fe1e6ddebb25f553a4697be8bc2a98c079a1a2db5565b5fd8e4fa02421c`;
- the raw word is `0x000000000bb8000000fcdd1700000000000000000002418dba1a5b2f84a25f0d`;
- it decodes to sqrtPriceX96 2727419861661278430977805, tick −205545, protocolFee 0 and lpFee 3000;
- that is exactly what `StateView.getSlot0` returns.

**2. A Uniswap pool serializing a block, from the BAL alone.** Run
`ROOTED_TEST_LIVE_EXECUTION=… ROOTED_TEST_LIVE_BEACON=http://127.0.0.1:15052 go test ./internal/uniswap/ -run LiveBAL -v`.
Block 12073969 (`0x0c332d17…aba4`, slot 11516904, 114 txs) has a verified BAL commitment. Txs 29, 35 and
83 all swap the factory-verified v3 pool `0x6a8bcbc98ff2485582049e67299fb16ad900728b` (fETH/f564,
0.3%). The BAL's per-tx write sets alone (no traces) show all three writing:
- `pool_slot0`;
- `fee_growth_global1`;
- `balanceOf[pool]` on both tokens (`token_balance_of_pool`).

That gives 12 labelled WAW edges. A builder must order these three txs. A validator holding the BAL
does not have to.

**3. v4 flash accounting does not show up in the BAL.** We labelled every BAL write in three blocks with
v4 activity:
- 12075101 (4 `ModifyLiquidity` and 1 `Swap`);
- 12075612 (4 v4 swaps on 4 pools);
- 12075607 (1 v4 and 7 v3 swaps).

Every PoolManager storage write was per-pool `Pool.State`. Offline brute force identified the
unlabelled ones as one `tickBitmap` word (`S+5`) and the `feeGrowthOutside` slots (+1, +2) of three
crossed ticks. There were no lock, currency-delta or `NonzeroDeltaCount` writes, because v4 keeps those
in EIP-1153 transient storage, which BALs do not record.

So two v4 swaps on different pools conflict only through:
- shared `balanceOf[PoolManager]` token slots;
- PoolManager's native balance;
- whatever their routers touch.

They do not conflict through a global singleton slot. This covers three blocks and is an observation,
not a proof. In those three blocks no Uniswap location had more than one writer. Sepolia v4 activity is
sparse: we saw no block with two txs on the same v4 pool in 2,000 blocks.

## Limits

- Ticks crossed during a swap and `tickBitmap` words are not in the logs (tick spacing is unknown without
  `Initialize`). They stay `pool_manager_other_storage` with `verified:false`.
- v3 ticks, positions and observations get only `pool_mapping_or_observation`.
- Token-balance labels assume a Solidity `mapping(address => uint256)` at slot 0–20 or the OZ v5 namespace.
  Vyper tokens, other ERC-7201 namespaces and rebasing tokens stay unlabelled. Any contract with such a
  mapping keyed by a pool would be labelled too, which is why `verified` is false.
- ERC-6909 claim balances in PoolManager (nested mappings) are `pool_manager_other_storage`.
- v4 poolIds come from logs of the verified singleton. Hooks are not analysed. No prices or USD values.
- At most 8 v3 pools per block are factory-verified. The rest stay `verified:false`, and the X-ray adds coverage
  `uniswap_v3_pools_unverified`.

## Tests

`go test ./internal/uniswap/...` runs offline:
- the `PoolStateSlot` golden;
- `DecodeSwapV4` on the real log in `internal/uniswap/testdata/v4/` (block 12075101), plus 10 rejections;
- `ContextFromLogs` on that block;
- every label name, including tick, position and token slots 0, 9 and OZ v5, with goldens from `cast index`;
- `VerifyV3Pools` with a fake `Caller`.

The two live tests above are skipped unless their env vars are set.
