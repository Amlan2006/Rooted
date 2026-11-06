# Frame transaction devnet evidence

All frame-devnet evidence in this repository was captured on 2026-11-06
(08:16-08:19 UTC) from the public sponsor devnet, using Rooted's own probes,
CLI, and API.

## Devnet identity on 2026-11-06

| Item | Value |
| --- | --- |
| Network label | `frame-devnet`, chain 1337 |
| Execution endpoint | `https://altmempool.forshtat.com` |
| Execution genesis | `0x2ad3f67b059fbde111ad7af27cfb4955d997351579612237ca0318937a5bae7a` |
| Gateway explorer | `https://altmempoolgateway.forshtat.com/rpc`, v4.1.1, bundling `manual`, bootId `9c7ea46a50c67b59`, `faucetEnabled=true` |
| Miner explorer | `https://altmempool.forshtat.com/rpc`, v4.1.1, bundling `auto`, bootId `bb2fdf74c0a68783`, no faucet field reported |

The devnet has been reset with a new genesis. Every Rooted component checks
genesis, so Rooted must run with
`ROOTED_FRAME_GENESIS_HASH=0x2ad3f67b...5bae7a`. The probes and
`scripts/smoke_phase4.py` default to this value and also honor the variable.

## Read-only probes

```sh
python3 scripts/probe_frame_devnet.py
node scripts/probe_frame_stream.mjs
```

The probes write to `.tools/phase1/<run>/frame/` and `.../frame_stream/`.
They passed on 2026-11-06. Their raw output is in
`demo/phase1/reference/frame-probe/`:

- `execution_chain.json`, `genesis.json`: execution chain ID and block 0.
- `{gateway,miner}_{chain,info,admissions}.json`: identity, explorer info, and
  the five newest admissions on each node.
- `existing_detail.json`, `existing_receipt.json`,
  `existing_frame_receipt.json`: the newest included gateway admission at probe
  time, `0x0cd83f6adc761d993402df583cb36483cf3ff20b18da84d56f7233316ff54051`.
  These hold its explorer detail (admitted seq 58, included seq 59), its type
  `0x6` execution receipt, and its supplemental frame receipt.
- `result.json`: the probe summary.
- `stream_result.json`: the WebSocket probe. The subscription was
  acknowledged, the sidecar then sent an empty `{}`, and 20 events were
  replayed from `since=0`.

## Rooted collection run

`rooted serve` was run on loopback with a dedicated database. It used
`ROOTED_WATCH_ENABLED=false`, so only the gateway and miner frame collectors
were running. Both nodes reached `poll_status=ok` and
`stream_status=connected`. The unfunded rejection was submitted through the
Rooted CLI:

```sh
python3 scripts/test_frame_transaction.py --submit --record --unfunded-rejection \
  --output .tools/phase4-unfunded
```

The script made a fresh random key and skipped the faucet. It signed with
Foundry `cast` and relayed the transaction once through
`.tools/rooted frame-submit`. No funded transaction was sent.

Next, `rooted frame-sync gateway 0x0cd83f6a...` and `rooted frame-sync miner`
were run against the same database. Both exited 0.
`python3 scripts/smoke_phase4.py --base http://127.0.0.1:8082` passed with 38
gateway states, 30 receipt-verified inclusions, 5 rejections, the stream
connected, and 1 submission attempt.

The API responses are saved in `demo/phase4/reference/`. An identical copy is
in `demo/phase1/reference/frame-phase4/`, which is the copy the Go tests read:

- `gateway-node.json`, `miner-node.json`: `GET /api/v1/frames/node`.
- `existing-included.json`: a third-party transaction that Rooted did not
  submit (`0x0cd83f6a...`). The gateway events are admitted, then included,
  16786 ms apart. Rooted's receipt check at 08:18:31Z found a type `0x6`
  receipt in block `0x420`, with matching identity and a canonical block hash.
  The status is `included`.
- `own-submission.json`: Rooted's attempt `098a70d2...` for
  `0xbfa4f1855f410cad0b8ed67fd792ab3752f3aaf0bd55aeba0d1faf6bf93a25c7`.
  The result is `rpc_rejected` with code -32500.
- `own-rejection.json`: the same hash as stored by Rooted. Structure and
  signature checks passed. Simulation failed with "payer ... has 0 wei", and
  later checks were skipped. The status is `rejected`, with
  `admission_confirmed=false` and incident `admission_rejected`.
- `summary.json`: counts computed from the API at 08:18:55Z. Gateway: 38
  states, 30 receipt-verified inclusions, 5 rejected. Miner: 60 states, 29
  receipt-verified inclusions, 28 rejected.

## Not verified

- A funded Rooted submission through canonical inclusion. The gateway now
  reports `faucetEnabled=true`, but no funded transaction was attempted.
- Canonicality after 2026-11-06 08:19 UTC. The included state's receipt check
  is a point-in-time observation.

Upstream interfaces used: `skandha_explorer_info`,
`skandha_explorer_listAdmissions`, `skandha_explorer_getTransaction`,
`eth_getTransactionReceipt`, `eth_getFrameTransactionReceipt`,
`eth_sendFrameTransaction`, and `skandha_subscribe` with `explorerEvents`.
