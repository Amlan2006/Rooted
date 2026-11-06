# Phase 1 verification

Date: November 6, 2026 (UTC times below).

Phase 1 checks that Rooted can reach and correctly read each capability it
depends on. The capture archive is `demo/phase1/reference/`. Its manifest
(`manifest.json`, mode `recorded_capture`) pins the SHA-256 and size of all 63
archive files. Every file was produced on 2026-11-06 by a probe, a Rooted API
read, or a browser capture. Derived summaries say so in their own fields.

## Archive contents

| Folder | Produced by | Captured (UTC) |
| --- | --- | --- |
| `sepolia-probe/` | `scripts/probe_sepolia.py` against local Nimbus v26.10.2 and Geth v1.17.10 | 08:14:38-08:14:48 |
| `uniswap-probe/` | `scripts/probe_uniswap.py` against local Geth | 08:14:48-08:14:49 |
| `frame-probe/` | `scripts/probe_frame_devnet.py` and `scripts/probe_frame_stream.mjs` against the public frame devnet (chain 1337) | 08:16:05-08:16:11 |
| `frame-phase4/` | Rooted frame API responses after live gateway/miner collection (copy of `demo/phase4/reference/`) | 08:18:55 |
| `bal-phase5/` | Rooted fork and native BAL analysis (copy of `demo/phase5/reference/`) | 08:15-08:21 |
| `anon-rpc-probe/` | `anon-rpc-probe/capture.mjs`: headless Chromium on the dashboard Private RPC view | 08:29:47-08:29:59 |
| `cre-probe/` | `scripts/probe_cre.py` (blocked attempt, see below) | 08:27:22 |

## Verified offline

`python3 scripts/verify_phase1_recorded.py` passed. It makes no network calls
and does not write to the archive.

- Archive integrity: all 63 files match the manifest, and no archive file is
  unlisted.
- Sepolia: the Nimbus head block (slot 11518273, root `0x5e9489b8...`, builder 7),
  its payload envelope, and the Geth block `0xb84137` agree on block hash,
  number, state root, slot, builder, parent root, and parent hash. The header
  root is also checked. `cast keccak` of the envelope's encoded BAL reproduces
  the header commitment
  `0x5582149e5e4759e6a998c7f09e5f432bf08b0916f97fc3aa7c1131bf009f3185`.
  `eth_getBlockAccessList` returned -32601 (unsupported). The prestate trace
  and the Beacon SSE event types were captured. Reveal timing and PTC
  timeliness are not inferred.
- Uniswap v3: two factory-verified WETH/USDC pools (fees 500 and 3000) and four
  existing swaps. Each swap's receipt, block, and Swap log are bound together.
  The pinned head was re-read and had not changed, and the sample 0 call trace
  is present. No swaps were submitted.
- Controlled workload: the four Anvil fork cases keep their successful and
  reverted receipts, and the reverted swap committed no events. The verifier
  does not execute anything on the fork.
- Frame: the probe's genesis (`0x2ad3f67b...`) and the type `0x6` receipt for
  third-party transaction `0x0cd83f6a...` match. The stream probe acknowledged
  its subscription and replayed 20 events. Rooted's recorded receipt check is
  canonical. Rooted's own unfunded submission `0xbfa4f185...` stays rejected.
  A funded own submission was not attempted.
- Anon-RPC: the dashboard Private RPC view connected the Nox worker. The log
  shows "Nox ready; destination chain verified through worker", and an
  `eth_getBlockByNumber` read completed through the anonymous route. This does
  not verify what the destination RPC or the network operators can see.
- CRE: reported as `not_recorded`, because no simulation result exists.

## Live run

`python3 scripts/run_phase1.py` (run `20261106T083329Z-06d6b5d9`, env from
`.env`) exited 2 because the CRE gate was blocked:

| Gate | Result | Notes |
| --- | --- | --- |
| Sepolia | passed | slot 11518367; envelope BAL commitment verified; native BAL getter unsupported |
| Uniswap | passed | 4 swap samples; call trace unavailable because the sampled blocks were outside the node state window |
| Frame HTTP | passed | genesis `0x2ad3f67b...` |
| Frame stream | passed | 20 replayed events |
| CRE | blocked | `cre_authentication_required` |
| Anon-RPC browser | not run by the runner | captured separately with `anon-rpc-probe/capture.mjs` (above) |
| Funded frame submission | not run | needs devnet funding and a separate submission step |

The six Anon-RPC transport unit tests also passed (Node 24 TypeScript
transform). They use injected workers and are not network proof.
`python3 scripts/run_phase1.py --offline` exited 0. Tool versions observed:
Python 3.12.3, Go 1.27.2, Node 24.18.0, npm 11.16.0, Foundry 1.9.0, Bun 1.4.2,
and CRE CLI v1.39.0.

The runner now exits 2 only for blocked gates. Gates that are `not_run` need a
separate manual step and do not force exit 2.

## CRE blocker

The CRE CLI v1.39.0 was installed with the official installer (signature
verified, into `~/.cre`). The workflow dependencies were installed from
`bun.lock`. `cre workflow simulate` then stopped with "Authentication
required: not logged in and no CRE_API_KEY set". No login was attempted and no
credentials were used. `cre-probe/result.json` and `cre-probe/simulation.json`
record that blocked attempt. To record a result, an operator logs in, runs
`python3 scripts/probe_cre.py`, copies its `result.json` and
`simulation.json` into `cre-probe/`, and regenerates the manifest.

## Reproduce

```sh
python3 scripts/test_phase1.py -v
python3 scripts/verify_phase1_recorded.py
node --experimental-transform-types --test integrations/anon-rpc/probe/private-rpc.test.ts
python3 scripts/run_phase1.py --offline
python3 scripts/run_phase1.py
# after replacing any archive file:
python3 scripts/verify_phase1_recorded.py --write-manifest
```

The browser capture needs a running dashboard (`next dev`) and
`playwright-core` 1.65.0 installed outside the repo. Copy `capture.mjs` next to
that install and run
`node capture.mjs "http://127.0.0.1:<port>/?view=privacy" <output-dir>`. The
script launches the Chromium headless shell from
`~/.cache/ms-playwright/chromium_headless_shell-1243`.

`scripts/test_phase1.py` runs 18 tests, and all passed. They cover failed-network
handling, overwrite refusal, credential-safe metadata, run-identity traversal,
wrong-network rejection, rejection of a mismatched state, slot, builder, or
root, rejection of a tampered or incomplete archive, and the `not_recorded`
handling for missing or blocked CRE and browser evidence.
