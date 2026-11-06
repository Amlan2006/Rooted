# internal/bal test fixtures

Captured on 2026-11-06 from a local Sepolia Geth v1.17.10 (`127.0.0.1:18545`) and
Nimbus v26.10.2 (`127.0.0.1:15052`). Each block contains a Uniswap v3 Swap found by
`scripts/probe_uniswap.py` in the same session (WETH/USDC pools 500 and 3000).

- `sample_N_block.json`: raw `eth_getBlockByHash(hash, false)` capture (curl wrapper,
  `body` is the untouched response). It supplies `blockAccessListHash` and the
  transaction count.
- `sample_N_bal.json`: raw `eth_getBlockAccessList(hash)` capture from
  `https://ethereum-sepolia-rpc.publicnode.com` (same curl wrapper, `body` untouched),
  taken on 2026-11-06 at 08:55 UTC. The local Geth returns -32601 for this method.
  `decode_test.go` checks that the request hash is the block hash and that the
  re-encoded BAL keccak equals the header `blockAccessListHash`.

| Sample | Block | Hash | Slot | Txs |
| --- | --- | --- | --- | --- |
| 0 | 12075268 | 0x787eabec3712a09e3f6e806f1bc4e919affd84aead6dd5e77ea6b3c4363e94c6 | 11518221 | 143 |
| 1 | 12075271 | 0x98399bab67e4e7e0eed93273ab8afd27484b4c67b4b41217830987b1a036fee3 | 11518224 | 118 |
| 2 | 12074915 | 0x1ead7c8dcf8e35db5843eefcda6e3083cc0777a249dc8d8468c781f266b03232 | 11517862 | 67 |
| 3 | 12074939 | 0xe2b644aea24e022e746773344317a4b3dc828212d501cf05d6afc6c8cb63047d | 11517886 | 132 |

The RLP decode test (`rlp_test.go`) reads the envelope and block captured for
slot 11518268 in `../../ingest/testdata`.
