# Dashboard and Anon-RPC — Phase 6

The dashboard lives in `dashboard/`, alongside the Go backend. Next.js provides the page and a restricted, same-origin read proxy. Existing collectors and PostgreSQL remain the sources of observations. No Ethereum node, wallet, or faucet funds are needed for this phase.

## Views

| View | Data and interactions |
| --- | --- |
| Investigate | Transaction-first workflow or saved-report lookup; scoped URL, exact payload/root journal, transaction-focused conflicts and swaps, relevant window-level CRE checks, and export |
| Overview | Latest stored slot, windowed builder denominator, comparable timing samples, active alerts in the returned page, recent slot strip, collector connections |
| PayloadWatch | Search the latest 50 slots by slot/root/builder/payload hash, select a root, inspect its journal timeline, unknown timing/PTC/blob/execution values, source and coverage |
| Builders | Choose 1h/24h/168h window; observation counts, payload retrieval and fully healthy ratios, unknown counts, P50 and timed-sample denominator |
| Frame mempool | Explicit chain 1337 and gateway/miner selection; admission, canonical inclusion, execution result, rule details, lifecycle events, node identity |
| BAL analyzer | Standalone Markdown/JSON investigation downloads, transaction/block hash form with manual live analysis, pinned requested report, explicit live-native versus local-fork selector; commitment verification, partial dependency graph, storage projection toggle, selectable transaction nodes, exact conflict evidence, pools, and committed/reverted swap calls |
| Compare workloads | Controlled A/A/A versus A/B/A fork comparison bundles; see [WORKLOAD_COMPARISON.md](WORKLOAD_COMPARISON.md) |
| RPC providers | Primary versus reference provider comparison reports; see [PROVIDER_COMPARISON.md](PROVIDER_COMPARISON.md) |
| Execution profiler | Native replay profiles and their saved captures; see [EXECUTION_PROFILER.md](EXECUTION_PROFILER.md) |
| Incidents | Separate scoped PayloadWatch signals and frame-devnet incidents; no CRE policy panel, because the backend has no `/api/v1/cre/*` routes yet; for the same reason, Investigate's step 5 (related CRE policy checks) shows them as unavailable |
| Private RPC | Nox worker transport, supported Sepolia investigation reads, readiness, latency, bootstrap counters, logs, explicit direct mode, and fail-closed drill |

The payload scope selector offers live Sepolia or the clearly labeled **synthetic lifecycle demo** (`phase3-demo`). It does not silently switch frame data to synthetic. Frame observations always identify their independent devnet. BAL fork data uses `sepolia-fork`, chain 31337, and an explicit trace-demo label. The header changes network identity for frame and fork views. Unknown values are rendered as **Unknown**, never zero or confirmed.

Block/pool/slot identifiers, canonical-at-fetch state, source records, analysis time, and omitted semantics remain inspectable. Builder ratios describe observed evidence, not reputation. Graph depth/width are unit-cost metrics on partial evidence, not measured speedup. Shared fee-recipient effects remain in the main graph; the storage projection explicitly excludes them. The map prioritizes known pool overlap and shows at most 12 transactions and 120 grouped lines. Conflict tables show the first 60 matching location-level edges; the full stored report remains inspectable.

The live source is discovered from `/api/v1/collector?network=sepolia`, which returns the backend’s configured `ROOTED_SOURCE_ID`. Slots, builders, alerts, timelines, SSE, and live CRE report reads use that source. Live reads wait for source discovery; they never fall back to a hardcoded `beacon` source. No additional frontend source environment variable is needed.

## Updates and failures

PayloadWatch's backend SSE stream drives refreshes, with a 500 ms burst debounce. The browser EventSource reconnects and sends its last event ID automatically. The proxy forwards that header and streams the backend response without buffering. The backend snapshot/replay semantics remain unchanged. The API-stream badge refers to **Rooted's stream**, not the upstream Beacon source. The overview states separately whether the upstream Beacon stream is connected; on November 6, 2026 the local Nimbus stream was connected, while the public Beacon API returned HTTP 501 for SSE.

REST resources refresh every 15 seconds; the selected analysis report refreshes every 30 seconds. The UI displays loading, empty, failure, and last-success freshness states. Scope changes clear prior-scope output immediately. Failed refreshes retain the last successful response with a warning; the collector does not stay green merely because old data exists. Freshness refers to the latest dashboard response; source success, analysis time, and observation times remain separately visible. Detail panels follow updated matching observations when data refreshes. Page responses are not cached.

The UI is responsive, with a full sidebar on larger screens and named icon navigation on narrow screens. Evidence dialogs use native modal focus behavior; controls have accessible labels, keyboard focus indicators, and reduced-motion support. Wide evidence tables and graphs scroll within their panels.

Manual BAL analysis uses a dedicated same-origin `POST /api/analysis` handler. It validates the selected hash type, fixes the scope to live Sepolia, and forwards only the corresponding analysis ingestion request to the configured Go backend. The generic `/api/backend/…` proxy remains GET-only. Submitted results remain selected until the user chooses **Show latest saved report**. Transaction submissions include one selected transaction for trace/swap evidence; block submissions request only the block BAL and dependency graph.

## Traffic boundaries

| Traffic | Route | Privacy boundary |
| --- | --- | --- |
| Dashboard document, local static assets | Browser → Next.js | Ordinary traffic; no external font CDN required |
| Stored observations and SSE | Browser → `/api/backend/…` → configured Go origin | Ordinary API traffic; **not anonymized by Nox** |
| Consensus/execution/frame collection | Go → configured providers | Existing server-side collector traffic; **not anonymized** |
| Worker specifier discovery | Browser → public Sepolia bootstrap RPC | Direct `eth_call` restricted to the Nox specifier; visible in its own counter |
| Bundle/topology/relay bootstrap | Harness/worker → resolvers and network relays | Separate visibility/trust boundaries; not a claim that all bootstrap traffic is anonymous |
| Supported execution investigation | Browser → sandboxed Nox worker → mixnet → destination RPC | Default worker route; no automatic direct fallback |
| Explicit direct investigation mode | Browser → destination RPC | User-selected direct fetch; UI warns that source IP is exposed |

The bootstrap provider is trusted for the onchain worker hash. The harness resolves the worker bundle and verifies its hash before executing it in a null-origin iframe/worker sandbox. This verifies bundle integrity relative to the trusted specifier response; it is not an independent guarantee of anonymity or correctness of RPC results. The worker/network are trust dependencies. Nox's topology chain (421614 in the November 6, 2026 diagnostics) is distinct from destination Sepolia (11155111).

Destination RPCs still see query contents. Timing, identifiers, and repeated queries may be correlatable. Uploading an investigation result to Rooted would not become anonymous merely because its RPC read used Nox. The UI does not perform such uploads automatically. No signing keys or wallet permissions are used.

## Transport implementation

`lib/private-rpc.ts` exposes a transport interface around `@anon-rpc/browser-harness` 0.3.3. It creates an actual **Nox** worker, not passthrough, using Sepolia specifier `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A`. Bootstrap and destination RPC are `https://ethereum-sepolia-rpc.publicnode.com`. Investigation methods are restricted to execution reads: chain ID, block number/header, receipt, address/topic-filtered logs, and contract calls. Before marking ready, the transport checks destination chain ID **through the worker**.

One worker stays alive for the inspector session and is closed when that view unmounts, on disconnect, mode change, or failure. Reconnection constructs a fresh worker. Readiness includes bootstrap and the anonymous destination-chain check. The default 45-second request/ready deadline fails visibly. A worker/request error leaves anonymous mode failed until explicit reconnect; direct mode can be selected only through its visible control. Write/broadcast methods are rejected before network access.

RPC duration is browser transport time, including mixnet overhead. It is separate from payload reveal latency, admission-to-inclusion timing, transaction gas, and execution timing. Logs retain the most recent 40 worker/application messages and stay in browser memory. They are not automatically uploaded.

**Test worker failure** deliberately closes a ready Nox worker and attempts `eth_chainId` through that closed worker. The failed request changes the UI to failed, disables further reads, and exposes Reconnect. It does not switch to direct mode. This drill is for demonstrating failure behavior; it does not reproduce every real network outage.

The dashboard's server proxy permits only known GET routes on a configured backend origin. It cannot proxy arbitrary URLs, RPC destinations, mutations, or ingestion. Backend URL configuration stays server-side. The local development server binds loopback; external hosting/access controls are outside this phase.

## Run and verify

Start the existing Go backend/database, then run `npm install --prefix dashboard` and `npm run dev --prefix dashboard`. Review **Private RPC** to run live reads. Select local-fork analysis to inspect the Phase 5 controlled workload without restarting Anvil; its report is persisted in PostgreSQL.

`npm test --prefix dashboard` verifies method restrictions, anonymous routing, bootstrap restrictions, fail-closed startup/RPC/timeout behavior, explicit direct mode, stale worker cleanup, and proxy route isolation. `python3 scripts/smoke_phase6.py` exercises real backend data and SSE through the dashboard proxy. Real Nox worker reads are checked in the browser. The November 6, 2026 run of all of these, with browser captures, is in [PHASE6_VERIFICATION.md](verification/PHASE6_VERIFICATION.md).

A public controlled destination was not available in this local setup. A local loopback endpoint cannot be reached by mixnet exits, so a source-IP comparison was not performed. No endpoint-observed anonymity guarantee is claimed. Browser logs, hash-verified worker startup, real reads, and failure behavior are the verified evidence.

Official references: [Anon-RPC integration and trust model](https://ethereum.github.io/anon-rpc/wallets/), [browser harness package](https://www.npmjs.com/package/@anon-rpc/browser-harness), [Next.js route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route).
