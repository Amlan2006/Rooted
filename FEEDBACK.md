# Uniswap developer feedback (ETHGlobal Mumbai, Rooted)

Rooted is a Go observability stack for Glamsterdam on Sepolia. We used Uniswap v3 and v4 from raw
chain data, not from the SDK. The inputs were `eth_getLogs` and receipts, `eth_call`, `eth_getStorageAt`,
and EIP-7928 block access lists from a Nimbus beacon node. The goal was to label Uniswap state inside BAL
conflict graphs (see [docs/UNISWAP.md](docs/UNISWAP.md)). This file covers what helped and what was hard.

## What worked well

- **Sepolia deployment tables were right.** The v3 Factory (`0x0227…DaC1c`), v4 PoolManager
  (`0xE03A…3543`), StateView, PositionManager and UniversalRouter addresses on the v3 and v4 deployment
  pages all matched what our own node returned (`eth_getCode`, `StateView.poolManager()`). The recent log
  senders also matched: the two listed UniversalRouter versions sent 110 of 188 recent v4 swaps, and
  PositionManager is the `ModifyLiquidity` sender. The warning
  not to assume the same addresses across chains is useful.
- **StateView is excellent for tooling.** We cross-checked our own storage-slot derivation against
  `getSlot0`, `getLiquidity`, `getTickInfo` and `getPositionInfo(poolId, owner, tickLower, tickUpper,
  salt)`. That took one test file and no ABI tooling. It agreed on every slot across 38 live pools.
- **`StateLibrary.sol` is the real storage spec.** `POOLS_SLOT = 6` and the
  `LIQUIDITY/TICKS/TICK_BITMAP/POSITIONS` offsets are clear and stable. That is why
  `keccak256(poolId ‖ 6)` works for raw-state tools.
- **v4 events carry what an indexer needs.** `ModifyLiquidity` includes the `salt`, so position keys can be
  derived from logs alone. `Swap` includes the effective `fee`.
- **Flash accounting in transient storage is good for parallelism under BALs.** In the Sepolia blocks we
  examined, every PoolManager write in the BAL was per-pool state. There was no global lock or delta slot.
  Cross-pool v4 swaps therefore conflict only through `balanceOf[PoolManager]` token slots and native ETH.
  This is a real advantage of the singleton design, and it deserves to be stated in the docs.
- **The `llms.mdx` versions of the docs pages** (served to non-browser clients) were easy to read
  programmatically.

## What was hard or confusing

1. **The storage layout is only in source.** No docs page says "PoolManager `_pools` is at slot 6,
   `Pool.State` is `slot0, feeGrowthGlobal0, feeGrowthGlobal1, liquidity, ticks, tickBitmap, positions`,
   `TickInfo` and `Position.State` are 3 slots each". The token1 fee-growth offset (2) has no constant,
   only a comment. Tools that work on state diffs, BALs or `eth_getStorageAt` would benefit from a short
   "v4 storage layout" reference page with one worked `cast index` example.
2. **There is no PoolId → PoolKey getter on PoolManager.** To learn a pool's currencies or tick spacing you
   must either index `Initialize` back to the pool's creation, or call `PositionManager.poolKeys(bytes25)`.
   The second works only if a position was minted through that PositionManager, and it uses a truncated id.
   Per-block tools see poolIds in `Swap` logs and cannot cheaply resolve them. A documented recommended
   path, or a view on StateView, would help.
3. **The v4 `Swap` amount sign is the opposite of v3.** v4 reports amounts from the swapper's side
   (negative means paid in). v3 reports them from the pool's side. This is easy to miss when porting
   a v3 decoder. A side-by-side callout on the events page would save time.
4. **Ticks crossed during a swap are invisible in logs.** `Swap.tick` is the final tick, and the
   `feeGrowthOutside` writes of crossed ticks appear in state but not in events. Reconstructing them needs
   the tick spacing (from 2) and the bitmap. We left these unlabelled.
5. **Docs URLs moved.** `docs.uniswap.org/contracts/v4/deployments` now redirects to
   `developers.uniswap.org/...`, and older links in blog posts and READMEs go through several redirects. That
   is fine for browsers but easy to break in scripts. Some v3 Sepolia rows (Multicall, the original Quoter
   and SwapRouter) are blank.
6. **Non-factory contracts emit the v3 `Swap` topic.** In each live run, 2 of the 8 v3 candidates we checked
   were not factory pools. Topic matching alone is not enough. The factory `getPool` round-trip should be
   recommended explicitly for indexers.
7. **Sepolia v4 activity is thin for demos.** We saw 188 v4 swaps in 2,000 blocks. 110 came through
   UniversalRouter (85 via 2.1.2), 9 through PoolSwapTest, and the rest through a few custom contracts.
   No block had two transactions on the same v4 pool. That made it
   hard to demo v4 contention live; our contention example is a v3 pool. A small official "busy pool"
   script on Sepolia would help hackathon teams.
8. **Glamsterdam detail for indexers.** On Glamsterdam Sepolia, internal ETH transfers into PoolManager
   appear as `Transfer`-shaped logs from `0xffff…fffe`, which is consistent with EIP-7708. An indexer that
   treats every `Transfer` to PoolManager as an ERC20 will see a phantom "token" with no code. This is not a
   Uniswap bug, but Uniswap's analytics and indexers will meet it.

## SDK

We did not use the TypeScript SDKs. The backend is Go, so we used raw ABI selectors and topics, and we
checked every constant with `cast sig` / `cast keccak`. Official ABI JSON or Go bindings for
PoolManager, StateView and PositionManager, published per release, would have saved the hand-copied
selectors.
