# Rooted Phase 1 capabilities

Assessed on November 6, 2026 (UTC). Phase 1 checks that Rooted can reach and
correctly read each external capability it depends on. All results below come
from runs on that date. The detailed record is in
[PHASE1_VERIFICATION.md](verification/PHASE1_VERIFICATION.md).

| Capability | Result on November 6, 2026 |
| --- | --- |
| Sepolia Beacon/execution identity and payload correlation | Passed. `probe_sepolia.py` against local Nimbus v26.10.2 / Geth v1.17.10 matched chain ID, genesis root, slot, root, builder, parent, payload hash, block number and state root. |
| Native BAL availability / commitment | `eth_getBlockAccessList` is unsupported on the local Geth (-32601). The BAL comes from the Nimbus payload envelope (RLP); its Keccak matches the header `blockAccessListHash`. |
| Tracing and Uniswap v3 | Passed. `probe_uniswap.py` found two factory-verified WETH/USDC pools and four existing swaps with matching receipts, blocks and Swap logs; call and prestate traces worked for blocks inside the node's ~128-block state window. No swaps were submitted. |
| Controlled Uniswap workload | Passed on an owned Anvil 1.9.0 fork (chain 31337) of the local Geth: same-pool pair, different pool, reverted-after-swap. |
| Frame HTTP adapter | Passed. Third-party type-0x6 inclusion and Rooted's own unfunded rejection recorded separately. |
| Frame WebSocket adapter | Passed. Identity gate, subscription acknowledgment and a bounded 20-event replay. |
| Rooted-funded frame submission | Not attempted. Needs devnet funding and a separate, explicit submission step. |
| Anon-RPC / Nox | Passed in headless Chromium on the dashboard Private RPC view: worker ready, destination chain verified through the worker, real reads, fail-closed drill ([Phase 6 verification](verification/PHASE6_VERIFICATION.md)). |
| CRE HTTP + EVM capability | Blocked. CRE CLI v1.39.0 is installed, but `cre workflow simulate` requires an authenticated login that was not performed. |

## Run the gates

From `Rooted`:

```sh
python3 scripts/run_phase1.py --offline
python3 scripts/run_phase1.py
```

The first command checks local prerequisites, the archive, and transport tests
without remote probes. The second also attempts the read-only live checks.
Exit code 0 means local checks pass in offline mode (or every live gate passes),
1 means a local verification failed, and 2 means a live gate is blocked.
Always inspect `report.json`; an offline exit 0 is not fresh network evidence.

Each invocation writes to a new `.tools/phase1/<run-id>/` directory. The archive
under `demo/phase1/reference/` is never used as a live output path. Evidence
writes refuse to overwrite an existing response. Raw new responses remain in
ignored local storage. The scripts use exported `ROOTED_*` configuration (see
`.env.example`).

Individual probes are also runnable:

```sh
python3 scripts/probe_sepolia.py
python3 scripts/probe_uniswap.py
python3 scripts/probe_frame_devnet.py
node scripts/probe_frame_stream.mjs
python3 scripts/probe_cre.py
python3 scripts/verify_phase1_recorded.py
```

## Integration boundaries

- Sepolia is chain 11155111 with genesis validators root
  `0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078`.
- The configured pairing is a local Geth v1.17.10 / Nimbus v26.10.2 node,
  reached through SSH tunnels (see [SEPOLIA_NODE.md](SEPOLIA_NODE.md)). Public
  endpoints are configurable fallbacks; their client versions are not a support
  guarantee.
- The frame sponsor devnet is chain 1337 with execution genesis
  `0x2ad3f67b059fbde111ad7af27cfb4955d997351579612237ca0318937a5bae7a`
  (observed on November 6, 2026). Gateway and miner observations stay separate
  from Sepolia.
- Controlled swaps are on `sepolia-fork`, chain 31337, with simulated funds.
  They provide trace-derived evidence, not native BALs.
- CRE capability execution is simulation. A policy fork using Sepolia's chain
  ID is still a separate network identity. Production DON execution is outside
  this phase.
- Receipt timing, RPC duration, gas, and measured execution time remain distinct.
  These probes do not recover arrival time for past slots, prove execution
  validity, or establish complete transaction read coverage.

## Finish the open checks

1. CRE: log in with the CRE CLI locally, then run `python3 scripts/probe_cre.py`.
   It simulates HTTP and native EVM reads without `--broadcast` and does not
   request wallet keys. Copy its `result.json` and `simulation.json` into
   `demo/phase1/reference/cre-probe/` and regenerate the manifest.
2. Leave the funded frame demonstration open until funding and actual
   admission/inclusion evidence exist. Read-only probes never call a faucet,
   sign, broadcast, or treat an acknowledgment as admission.
3. A source-IP comparison for Nox needs a controlled public destination; it was
   not performed.

## Evidence

`demo/phase1/reference/manifest.json` pins the SHA-256 and size of every file in
the Phase 1 capture archive. The verifier checks every digest before accepting
any findings. Verifying digests is an offline integrity check, not a fresh
network check; a recorded canonical receipt check is not a canonicality recheck
at a later time.

The public summary is `demo/phase1/status.json`; local request records and test
logs remain under `.tools/phase1/`.

Upstream documentation:
[Anon-RPC app guide](https://ethereum.github.io/anon-rpc/wallets/),
[Beacon APIs](https://github.com/ethereum/beacon-APIs),
[Uniswap v3 deployments](https://github.com/Uniswap/docs/blob/main/content/protocols/v3/deployments/v3-ethereum-deployments.mdx),
[frame sidecar](https://github.com/forshtat/mempool-workshop-sidecar), and
[Chainlink CRE](https://docs.chain.link/cre).
These links were not revalidated online in this assessment.
