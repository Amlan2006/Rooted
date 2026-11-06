# Phase 6 Verification

Verified on November 6, 2026 between 08:27 and 08:40 UTC. Every file in
`demo/phase6/` comes from that run: a Rooted backend built from the current
tree, the production dashboard build, and a headless Chromium session driving
the real UI. Captures were not edited afterwards. Two files are summaries:
`transport-check.json` is labeled `derived_from_browser_session` and condenses
the five Nox snapshots it lists, and `status.json` is the written phase status.

## Setup used

- Backend: `go build -o <tmp>/rooted ./cmd/rooted`, then `rooted serve` on
  `127.0.0.1:8080` with `.env` exported and a dedicated empty local PostgreSQL
  database. Sepolia polling, the Beacon event stream and the frame gateway/miner
  workers were all enabled. Sepolia source `sepolia-nimbus-geth-1` (local Nimbus
  v26.10.2 / Geth v1.17.10); frame devnet chain 1337 with genesis
  `0x2ad3f67b059fbde111ad7af27cfb4955d997351579612237ca0318937a5bae7a`.
- Synthetic PayloadWatch data: `rooted replay internal/payloadwatch/testdata/synthetic.json`
  (23 inserted, 1 duplicate, 7 states, source `phase3-demo`).
- Local-fork BAL report: Anvil 1.9.0 (chain 31337, `--steps-tracing`, Prague)
  forked from the local Geth at Sepolia block 12,075,378; `scripts/run_uniswap_workload.py`
  mined the four cases in fork block 12,075,387
  (`0xa2c667dce5480913e8519043e080167c88f4f5bb7ab118b89f92371f5d54f72e`);
  `rooted analyze-fork` stored report
  `0xbd5c1185510db7de4d588f70383123d2cd754135d29d6c9f046eb0745514ab4e`.
  Anvil was stopped afterwards.
- Live native BAL report: `rooted analyze` on Sepolia block 12,075,378
  (`0x4182f5031028fe934963c1252fdfe92915c788fdfb06ffb47bae00715f34cc71`) with
  Uniswap v3 swap `0x4a32623f9cc2e432e77e3d0ec267d64b87fc21a0ee38960563881844389cc72f`
  selected; report `0xd384d6c001b20a907159076dd2910f4d8bdbbab6d0c5151c874b5a960597a364`,
  commitment verified.
- Dashboard: `npm run build`, then `next start --hostname 127.0.0.1 -p 3000` with
  `ROOTED_BACKEND_URL=http://127.0.0.1:8080`.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run typecheck` (Node v24.18.0) | passed |
| `npm run build` (Next.js 16.4.3) | passed; 8 routes |
| `npm test` | 52 passed, 0 failed |
| `python3 scripts/smoke_phase6.py --base http://127.0.0.1:3000` | passed at 08:30:55 UTC ([api-proxy-check.json](../../demo/phase6/api-proxy-check.json)) |

The smoke run read 22 live slots, the 7 synthetic slots, 50 gateway frame
states, and the native and fork reports above through the proxy. It confirmed
live/synthetic/fork scope separation, rejection of unscoped and unknown routes
(HTTP 400), and SSE resume through the proxy with `Last-Event-ID`. Its first
attempt failed on an outdated assertion that live slots never carry a reveal
latency. With the Beacon stream connected, the backend now reports same-session
receipt timing, so the script accepts a live latency only when the slot also has
a `timing_session`.

## Browser captures

Driven by playwright-core 1.65.0 (installed outside the repository) with
chrome-headless-shell from ms-playwright build 1243, viewport 1280×720 unless
noted. Text captures are accessibility snapshots
(`locator('body').ariaSnapshot()`); each starts with a header giving capture
time, URL, viewport and method.

| File | What it shows |
| --- | --- |
| `overview-browser.txt`, `overview-desktop.png` | Live Sepolia overview at 08:34 UTC: latest slot 11518372, Beacon polling ok, Beacon event source and API stream connected, 39 observed commitments, 36 comparable timing samples, 0 active incidents. The PNG is an unedited viewport screenshot. |
| `builders-browser.txt` | Live builder table, 1-hour window, with observation counts, retrieval and healthy ratios, P50 and timing-sample denominators. |
| `synthetic-timeline-browser.txt` | Synthetic lifecycle demo (`phase3-demo`) selected explicitly; slot 101 revealed at 1,000 ms with its five journal events. |
| `frame-browser.txt` | Frame devnet gateway, chain 1337: 50 states, 39 receipt-verified inclusions, 8 admission rejections; one included transaction opened with confirmed admission, canonical receipt, execution success and per-rule verdicts. |
| `fork-graph-browser.txt` | Local-fork report, block 12,075,387, storage projection RAW 12 / WAR 4 / WAW 4, two verified pools; transaction 3 (the reverted case) shows 15 known reads and 3 committed writes. |
| `investigate-browser.txt` | Investigate → **Open latest saved report**: report `0xd384…a364`, transaction index 82, matched payload observation for slot 11518333 with 2 journal events, and no established CRE policy check. Slot 11518333 was ingested through `POST /api/v1/slots/11518333/ingest` first, because the collector had started after it. |
| `nox-header-browser.txt` … `nox-logs-browser.txt` | Private RPC with a real Nox worker (see below). |
| `nox-failure-browser.txt` | After **Test worker failure**. |
| `backend-outage-browser.txt` | Overview after the Go backend was stopped with SIGTERM at 08:36:06 UTC and **Refresh observations** was clicked about 70 s later: collector stale, "Rooted backend is unavailable … Showing the last successful response", Retry controls, "Update failed". The backend was then restarted and `/api/backend/health` returned `ok` through the proxy. |
| `private-rpc-mobile.png` | Private RPC view at 390×844 (device scale 2) before connecting, with the narrow icon navigation. |

## Anon-RPC browser reads

The Private RPC view used `@anon-rpc/browser-harness` 0.3.3 with the Nox
worker (not passthrough), specifier
`0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A`, destination
`ethereum-sepolia-rpc.publicnode.com`. Session 08:35:01–08:35:13 UTC:

- Two direct specifier `eth_call` bootstrap reads, then worker boot, TLS, relay
  dials and topology acceptance in the activity log. The topology chain
  (421614) is shown separately from the destination.
- Ready in 3,284 ms including the destination `eth_chainId` check through the
  worker ("Destination chain: Sepolia verified").
- Anonymous reads, all successful: latest header (block `0xb8419c`, hash
  `0x59bbfb9e59becdf5be3520ddb9f291623a452eeda23016f895b2980fa38b1e29`, which
  matches the local Geth for that number; 882 ms), receipt for the swap above
  (384 ms), fee-500 pool `slot0` call (394 ms), and Swap logs over the last 64
  blocks (`eth_blockNumber` + `eth_getLogs`, 837 ms). These are single
  observations, not performance figures.
- **Test worker failure** closed the worker and attempted a read. The UI showed
  the worker as failed, "worker closed No automatic direct fallback.", and a
  Reconnect button. The transport stayed on Nox.

Summary: [transport-check.json](../../demo/phase6/transport-check.json).

## Not verified

- Source-IP visibility at a controlled destination. No public controlled
  endpoint was available, and a loopback endpoint cannot be reached by mixnet
  exits, so no endpoint-observed anonymity claim is made.
- Production hosting and access controls; the dashboard was served on loopback.
- Manual keyboard and screen-reader review. The accessibility snapshots show
  roles and labels only.
- The Incidents, Compare workloads, RPC providers and Execution profiler views
  were not captured in this run.

The local fork is trace-derived evidence, not a native BAL.
