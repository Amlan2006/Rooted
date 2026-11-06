# X-ray fixtures

Sepolia block 12075748 `0x2dcf138936ad88b5eb97897ffeddbba207e74c8d8a333395b13206ccad3f5bc9`, slot 11518713, 101 transactions, builder index 12, beacon block root `0xfddd5b9c037b01d9dec7313cb2de52fb51752ab21439ee91592118cfb42a3c04`, BAL commitment `0xe3942c6a406f971fe41f6a34ec95a392d03420ff533a3b9b2afd10cba43cd42f`. Captured live on 2026-11-06 from Geth v1.17.10 (`127.0.0.1:18545`) and Nimbus (`127.0.0.1:15052`) by `rooted xray`.

- `capture-12075748.json.gz`: the profiler capture (block, receipts, prestateTracer traces), trimmed to what `xray.Compute` reads. Ancestors are removed, as are transaction `input` and account `code`/`codeHash` in the traces. It is no longer replayable.
- `metrics-12075748.json.gz`: the `rooted-native-replay-v1` output saved with that profile (7 samples, `state_calls` removed). It still passes `profiler.ValidateMetrics`.
- `envelope-12075748.json`: `GET /eth/v1/beacon/execution_payload_envelopes/11518713`, keeping only the identity fields, the encoded BAL, `builder_index` and the roots.

Tx 0 is a 21,105,490-gas contract creation whose median apply time is 230,675 ns, while tx 13 (2,491,067 gas) takes 31.65 ms. So the gas-weighted view caps on tx 0 and the measured-time view caps on tx 13.
