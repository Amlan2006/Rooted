<div align="center">

# Rooted

**How parallel can a Glamsterdam block really run?**

ePBS payloads · block access lists · frame-transaction mempool · native execution replay · x402 on Hedera

</div>

---

Rooted runs beside its own Sepolia Nimbus + Geth node. For every fresh block it decodes the commitment-checked
EIP-7928 access list from the ePBS payload envelope, replays each transaction on native Geth v1.17.10, and prints
an **X-ray**: the block's parallelism ceilings side by side. Reports land in Postgres, render in a dashboard and
are sold per block to AI agents over x402 on Hedera. Self-hosting is free.

## The X-ray

| Ceiling | Model | Upper bound |
|---|---|---|
| Receipt gas | gas after refunds, EIP-8037 state gas included | `Σ gasUsed / max` |
| Execution gas | the EIP-8037 compute dimension alone | `Σ exec / max` |
| **Validator with BAL** | every tx runs in parallel | `Σ t / max t` on measured time |
| Builder, multi-version | no BAL, Block-STM style: only RAW and WAW order txs | `Σ t / longest path` |
| Builder, static | no BAL, every RAW/WAR/WAW conflict orders txs | `Σ t / longest path` |

`t` is the median of 7 uninstrumented native replays. Writes come from the BAL, reads from `prestateTracer`.
With a BAL, validators can run every transaction in parallel, so the conflict graph is the builder's view and never
"the validator limit".

**Live, 101 Sepolia blocks** (12,076,454–12,076,555, all BAL-verified; p10 / median / p90):

| Receipt gas | Execution gas | Validator with BAL | Builder, multi-version | Builder, static |
|---|---|---|---|---|
| 3.5× / 8.3× / 30× | 22× / 27× / 30× | 16× / 20× / 24× | 15× / 20× / 24× | 14× / 19× / 23× |

- Gas is a poor clock. Execution gas overstates measured parallelism in 97 of 101 blocks. Receipt gas lands below
  it in 69 and above it in 32. Under EIP-8037 header gasUsed is not the receipt sum either: block 12,075,273 reports
  92,173,320 against receipts totalling 155,156,084.
- The access list matters most against a static scheduler. The static builder is more than 5% below the
  validator in 39 blocks, the multi-version builder in only 9. Largest gap: block 12,076,467 (21.0× / 15.3× / 13.3×).

Definitions, limits and the earlier 81-block run: [docs/XRAY.md](docs/XRAY.md).

## Quick start

```sh
cp .env.example .env          # point ROOTED_EXECUTION_URL / ROOTED_BEACON_URL at your node
set -a; . ./.env; set +a
docker compose --project-name rooted up -d --wait postgres
go build -o .tools/rooted ./cmd/rooted && (cd workloads/profiler && go build -o ../../.tools/rooted-replay .)
ROOTED_XRAY_FOLLOW=true .tools/rooted serve
cd dashboard && npm ci && npm run dev    # http://127.0.0.1:3000/?view=xray
```

Needs Go 1.25+, Node 24, Docker and a Glamsterdam Sepolia node (Geth with `debug`, Nimbus serving payload
envelopes). One block: `rooted xray 0xBLOCKHASH`. Offline: `rooted xray --capture demo/profiler/replay-input.json.gz`.

## Partner prizes

### Ethereum Foundation · Frame Transaction Alt Mempool

A durable archive of the EIP-8141 alt-mempool devnet, plus a differential conformance runner. It sends boundary
transactions and checks the node's verdict against EIP-8141, EIP-8250, the ERC-8421 draft and the sidecar docs.

- **Our admitted and included frame tx:** [`0x9685176c…d20c`](https://explorer.altmempool.wtf/tx/0x9685176c89c2dd351b8fb5d1b6a25047373ae6aabb54c5c17505e03565d7d20c),
  submitted by [`scripts/test_frame_transaction.py`](scripts/test_frame_transaction.py#L94) through `rooted frame-submit`.
- **Finding:** the sidecar admitted and mined a 100,001 verify-gas tx ([`0x0189d4ef…`](https://explorer.altmempool.wtf/tx/0x0189d4ef069085da70a39bd0b9b7541a227e21a06b6098530752961f6426cde1))
  that EIP-8141, ERC-8421, its own docs and ethrex (`prefix gas budget exceeded: 100001 > 100000`) all reject.
  Full results: [`integrations/frame-conformance/results.json`](integrations/frame-conformance/results.json).
- **Code:** [`scripts/frame_conformance.py`](scripts/frame_conformance.py), [`internal/framemempool/store.go:82`](internal/framemempool/store.go#L82)
  (devnet resets at line 118), `GET /api/v1/frames/conformance`. Trade-offs: [docs/FRAME_CONFORMANCE.md](docs/FRAME_CONFORMANCE.md#trade-offs).

### Uniswap · Build with Uniswap

Contention tooling: raw `(address, slot)` locations in a block's access list become Uniswap terms (v4 `pool_slot0`,
`balanceOf[PoolManager]`), so the X-ray shows which swaps must be ordered and why. v3 pools are verified against the
factory at the block's state. In block 12,076,476, four swaps contend on factory-verified v3 pool `0x3289680d…eff1`
(87 labelled edges).

**Contracts (Sepolia):** v3 Factory [`0x0227628f…DaC1c`](https://sepolia.etherscan.io/address/0x0227628f3F023bb0B980b67D528571c95c6DaC1c) ·
v4 PoolManager [`0xE03A1074…3543`](https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543) ·
StateView [`0xe1dd9c3f…7e4c`](https://sepolia.etherscan.io/address/0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c) (cross-check)

| What | Where |
|---|---|
| v4 PoolManager, event topics, `_pools` slot 6 | [`internal/uniswap/v4.go:12-18`](internal/uniswap/v4.go#L12-L18) |
| `DecodeSwapV4` · position keys · `PoolStateSlot` | [`v4.go:71`](internal/uniswap/v4.go#L71) · [`v4.go:95`](internal/uniswap/v4.go#L95) · [`v4.go:116`](internal/uniswap/v4.go#L116) |
| `ContextFromLogs` · `LabelLocation` | [`internal/uniswap/labels.go:36`](internal/uniswap/labels.go#L36) · [`labels.go:58`](internal/uniswap/labels.go#L58) |
| `VerifyV3Pools` (factory round-trip) | [`internal/uniswap/verify.go:18`](internal/uniswap/verify.go#L18) |
| v3 Factory · `DecodeSwap` | [`internal/uniswap/v3.go:12`](internal/uniswap/v3.go#L12) · [`v3.go:87`](internal/uniswap/v3.go#L87) |
| X-ray wiring | [`internal/xray/engine.go:224`](internal/xray/engine.go#L224) · [`internal/xray/compute.go:374`](internal/xray/compute.go#L374) |

Developer feedback: **[FEEDBACK.md](FEEDBACK.md)** · more in [docs/UNISWAP.md](docs/UNISWAP.md).

### Hedera · AI Agents That Pay (x402)

`GET /api/paid/xray/{block_hash}` sells a full report for 0.01 HBAR (`exact` scheme on `hedera:testnet`).
Settlement goes through the x402.org facilitator, which also pays the network fee. An agent pays with no human
approval, under a per-request cap, a daily budget, a trusted `payTo` list and one purchase at a time.

**Settled on Hedera testnet** (agent `0.0.11338137` → `0.0.11337330`, 1,000,000 tinybars, `SUCCESS`):
- [`0.0.9185802@1793963177.452527184`](https://hashscan.io/testnet/transaction/0.0.9185802@1793963177.452527184) via `e2e.sh`
- [`0.0.9185802@1793963925.399944560`](https://hashscan.io/testnet/transaction/0.0.9185802@1793963925.399944560) via the MCP tool `buy_xray_report`

Every paid call is logged to HCS topic [`0.0.11338138`](https://hashscan.io/testnet/topic/0.0.11338138).
The code is in [`integrations/x402-agent`](integrations/x402-agent) (agent, spend policy, MCP server) and
[`dashboard/lib/x402.ts`](dashboard/lib/x402.ts) (paid route). Run it with `integrations/x402-agent/e2e.sh`.
Details: [docs/X402_HOSTED.md](docs/X402_HOSTED.md).

## Docs

[X-ray](docs/XRAY.md) · [Frame conformance](docs/FRAME_CONFORMANCE.md) · [Uniswap](docs/UNISWAP.md) ·
[x402](docs/X402_HOSTED.md) · [Backend](docs/BACKEND.md) · [API](docs/API.md) · [PayloadWatch](docs/PAYLOADWATCH.md) ·
[BAL analyzer](docs/BAL_ANALYZER.md) · [Frame monitor](docs/FRAME_MONITOR.md) · [Profiler](docs/EXECUTION_PROFILER.md) ·
[Providers](docs/PROVIDER_COMPARISON.md) · [Dashboard](docs/DASHBOARD.md) · [Sepolia node](docs/SEPOLIA_NODE.md) ·
[AI usage](docs/ai/README.md)

## License

[MIT](LICENSE) · Built at ETHGlobal Mumbai 2026
