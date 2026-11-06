# Sepolia Nimbus/Geth connection

Rooted's local `.env` points at a Sepolia Nimbus beacon node and a Geth
execution node reached through SSH tunnels. The public endpoints in
`.env.example` are a separate, polling-only setup: on November 6, 2026 the
public Beacon endpoint answered the event stream request
(`/eth/v1/events?topics=block`) with HTTP 501, so PayloadWatch streaming needs
the Nimbus node.

Keep the SSH tunnels running with these local forwards:

| Service | Local address |
| --- | --- |
| Nimbus Beacon REST and events | `http://127.0.0.1:15052` |
| Geth execution RPC and tracing | `http://127.0.0.1:18545` |

The node settings in `.env` are:

```dotenv
ROOTED_NETWORK=sepolia
ROOTED_CHAIN_ID=11155111
ROOTED_BEACON_URL=http://127.0.0.1:15052
ROOTED_EXECUTION_URL=http://127.0.0.1:18545
ROOTED_TRACE_URL=http://127.0.0.1:18545
ROOTED_SOURCE_ID=sepolia-nimbus-geth-1
ROOTED_WATCH_ENABLED=true
ROOTED_STREAM_ENABLED=true
ROOTED_ANALYSIS_ANCHOR_NUMBER=0xa7d8c0
ROOTED_ANALYSIS_ANCHOR_HASH=0x2896cc6e67bae1116829775906356da77d7263646429faebc769b0404ea3ecf2
```

The anchor is Sepolia block 11,000,000. On November 6, 2026 the Geth node
returned exactly this hash for `eth_getBlockByNumber("0xa7d8c0")`. Rooted checks
the anchor against the configured execution and trace providers at analysis
time. A missing or changed anchor is an explicit error; do not remove identity
checks to bypass it.

Use a distinct source ID per node/provider. This keeps a public-provider
`beacon` journal and its receipt clock separate from Nimbus events. The
dashboard discovers the active source from the collector API.

## Restart after changing configuration

Stop the running backend with Ctrl+C (or SIGTERM). In the same terminal, from
`Rooted`:

```sh
set -a
source .env
set +a
.tools/rooted serve
```

The backend reads exported variables at startup. Changing `.env` alone does
not change an already running process, and running the binary again without
reloading the file keeps the previous shell environment. Go never loads `.env`
by itself.

## Check the node and collector

```sh
curl -sS http://127.0.0.1:15052/eth/v1/node/syncing
curl -sS -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  http://127.0.0.1:18545
curl -sS 'http://127.0.0.1:8080/api/v1/collector?network=sepolia'
curl -sS 'http://127.0.0.1:8080/api/v1/slots?network=sepolia&mode=live&source=sepolia-nimbus-geth-1&limit=5'
```

Look for the configured source, polling `ok`, and streaming `connected`. A
listening SSH port alone does not establish remote node health; only a current
collector response confirms the connection.

## Verified on November 6, 2026

| Check | Result |
| --- | --- |
| Nimbus `/eth/v1/node/version` and `/syncing` | `Nimbus/v26.10.2`, head slot 11518273, `is_syncing=false`, `el_offline=false` |
| Geth `web3_clientVersion` and `eth_chainId` | `Geth/v1.17.10-stable`, `0xaa36a7` |
| Nimbus `/eth/v1/events?topics=block` | HTTP 200, `text/event-stream` |
| Anchor block `0xa7d8c0` | Hash matched `ROOTED_ANALYSIS_ANCHOR_HASH` |
| `rooted serve` on `127.0.0.1:8085` with a dedicated database, two runs with a restart between them | Collector reported `poll_status=ok` and `stream_status=connected` in both runs |
| Live lifecycle states (slots 11518270-11518297) | 27 roots, 22 with same-session receipt timing of 67-425 ms, zero alerts |

Details are in [PHASE3_VERIFICATION.md](verification/PHASE3_VERIFICATION.md) and
`demo/phase3/status.json`.

## Node limits

Geth does not expose `eth_getBlockAccessList` (it returned "method does not
exist" on November 6, 2026). The analyzer retrieves the block access list from
the Nimbus payload envelope instead, with execution block/slot identity and
header commitment validation. `ROOTED_BEACON_URL` must therefore point at
Nimbus for that path as well as for event collection.

Geth is snap-synced, so only about the most recent 128 blocks have state. On
November 6, 2026, `eth_getBalance` worked 100 blocks behind head and returned
a state-not-available error 300 blocks behind head. Trace, prestate
and profile requests must target recent blocks. `trace_*` methods are not
available (`trace_block` returned "method does not exist").

PTC quorum remains zero unless explicitly verified and configured; with quorum
zero, live states stay `pending` because no PTC verdict is made. Comparable
receipt timing requires events from one stream session; polling-only slots do
not establish arrival times.
