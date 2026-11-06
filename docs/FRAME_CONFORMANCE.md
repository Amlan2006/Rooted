# Frame transaction conformance: boundary cases on the alt-mempool devnet

Rooted sends one boundary transaction per rule edge to the public frame devnet
(chain 1337, genesis `0x2ad3f67b…ae7a`, sidecar v4.1.1). It records what each
written source says should happen next to what the node actually did. The
builder never pre-rejects: the node is the oracle. Expected verdicts were fixed,
each with a quoted basis, before anything was submitted, and none was edited
after an observation.

- Results (committed): `integrations/frame-conformance/results.json` (`rooted-frame-conformance-v1`).
  The backend serves them at `GET /api/v1/frames/conformance?network=frame-devnet`, and each case gains
  `archive_status` from Rooted's durable archive.
- Runner: `scripts/frame_conformance.py`. Builder: `build(key, nonce_seq, overrides)` in `scripts/test_frame_transaction.py`.
- Offline tests: `python3 -m unittest scripts/test_frame_build.py scripts/test_frame_conformance.py`.

## Our own admitted and included frame transaction

| | |
|---|---|
| Hash | `0x9685176c89c2dd351b8fb5d1b6a25047373ae6aabb54c5c17505e03565d7d20c` |
| Explorer | https://explorer.altmempool.wtf/tx/0x9685176c89c2dd351b8fb5d1b6a25047373ae6aabb54c5c17505e03565d7d20c (Miner: "Submitted by RPC", "On chain"; screenshot `integrations/frame-conformance/explorer-baseline.png`) |
| Path | `test_frame_transaction.py --submit --record --node miner` → `rooted frame-submit` → `eth_sendFrameTransaction` |
| Block | `0x7bf` (1983), hash `0xe7c2257320529c584fa7b059555c338ee2ef2314ac88d731faea8fc051666c1d`, status `0x1`, type `0x6`, gasUsed `0x65f6` |
| Rooted proof | `rooted frame-sync miner 0x9685…d20c` gives `status: included`, `inclusion_confirmed: true`, `receipt_check.canonical: true`, `identity_matched: true`, admission to inclusion 17,279 ms |

Reproduce with a fresh key (one faucet call and one submission):

```sh
export PATH=$HOME/.foundry/bin:$PATH; set -a; . ./.env; set +a   # plus your DATABASE_URL
go build -o .tools/rooted ./cmd/rooted
python3 scripts/test_frame_transaction.py --submit --record --node miner
.tools/rooted frame-sync miner <expected_hash>
```

The first attempt shows why the monitor is useful. `0x8624b308…f81d` was sent to the gateway, which
admitted it (`New`). The gateway runs `bundlingMode: manual`, so it never relayed the transaction,
and the miner never saw it. Rooted marks it `admitted` with the incident `inclusion_unresolved`
once the observation window has passed. The same signed bytes, re-sent to the miner, were admitted
and then dropped with the reason "relayed 4 times without being included in a block". That happened
even though `ethrex_simulateFrameTransaction` called them canonical-valid, and other teams'
transactions were dropped the same way in the same minute. A second fresh key sent straight to the
miner was included 17 s later. For this reason the runner submits to the miner (`--node miner`, the default).

## Run `e34c026699511891` (2026-11-06 09:50–09:54 UTC, sender `0xa8b7dD4D81236076F3f422Ac05C6e10630A663D7`)

Signature scheme SECP256K1. "Verify" is the VERIFY frame `limits.execution`. A, R and – mean accept,
reject and n/a. Columns: EIP-8141 | EIP-8250 | ERC-8421 draft | sidecar docs.

| Case | Overrides | Expected | Observed | Node's reason | Tx |
|---|---|---|---|---|---|
| baseline | defaults | A – A A | **A**, block 0x7bf | | `0x9685…d20c` |
| keys-zero-mixed | keys [0,307], state 2×97,920 | – **A** – R | **R** (RPC −32602, no admission record) | "nonce key 0 is only valid as the sole nonce key" | `0xa9fa…cb48` |
| keys-empty | keys [] | – **A** – R | **R** (−32602) | "nonceKeys count must be between 1 and 16" | `0x3f49…a5b4` |
| keys-17 | keys 101..117 | – R – R | R (−32602) | "nonceKeys count must be between 1 and 16" | `0x5a33…e598` |
| keys-duplicate | keys [205,205] | – R – R | R (−32602) | "nonceKeys must be strictly increasing" | `0xa336…f4f0` |
| keys-16 | keys 1..16, verify 97,000, state 16×97,920 | R R **A** R | **R** `structure` | "validation prefix state gas sum 1566720 exceeds MAX_VERIFY_STATE_GAS 500000" | `0xdf77…08be` |
| verify-99999 | verify 97,199 | A – A A | A, block 0x7fd | | `0x21ff…1bfb` |
| verify-100000 | verify 97,200 | A – A A | A, block 0x800 | | `0xced9…e823` |
| verify-100001 | verify 97,201 | R – R R | **A, included in block 0x805** | | `0x0189…cde1` |
| frames-64 | 63 extra SENDER frames | A – A A | A, block 0x807 | | `0x4d61…0e3e` |
| frames-65 | 64 extra SENDER frames | R – R R | R `simulation` (−32500) | "Frame count must be between 1 and 64" | `0x4b3d…8e4c` |

Every hash links as `https://explorer.altmempool.wtf/tx/<hash>` while the miner's in-memory
history lasts. Rooted's archive keeps them regardless: `/api/v1/frames/transactions/<hash>?network=frame-devnet&node=miner`.

### Divergences found

1. **The sidecar admits verify-gas budgets that every written source rejects (verify-100001).**
   97,201 + 2,800 (SECP256K1) = 100,001 is above `MAX_VERIFY_GAS` 100,000. EIP-8141 counts the
   signature ("plus the intrinsic cost of validating tx.signatures, must not exceed MAX_VERIFY_GAS").
   ERC-8421 BUDGET-010 does too ("The intrinsic cost of validating tx.signatures counts toward
   tx.sender"). The sidecar still accepted the transaction, and it was mined.
   - For the same shape, ethrex's canonical check (read-only `ethrex_simulateFrameTransaction`) returns
     `"canonicalMempoolViolation": "prefix gas budget exceeded: 100001 > 100000 (MAX_VERIFY_GAS)"`.
     So this transaction is rejected by the canonical mempool and admitted by the alt mempool, by accident.
   - Hypothesis: the sidecar's structure check charges 100 gas (the ARBITRARY price) per signature. Earlier
     today, before the gateway restarted and lost its history, a gateway rejection read "execution gas sum
     1050000 + signature-verification cost 100 = 1050100 exceeds MAX_VERIFY_GAS 100000".
   - Next probe, two transactions not yet sent: verify 99,900 should be accepted and 99,901 rejected if
     that hypothesis is right.
2. **No state-gas cap in the ERC-8421 draft, but the sidecar enforces EIP-8141's cap (keys-16).** The
   draft says "The standard Alternative Mempool has no such cap", yet the node rejects under `structure`
   with `MAX_VERIFY_STATE_GAS 500000`. A consequence: under that cap one transaction can create at most
   5 fresh keyed-nonce slots (5 × 97,920 = 489,600), so `MAX_NONCE_KEYS` 16 is reachable only with keys
   that have already been used.
3. **Legacy nonce wire form (keys-empty).** EIP-8250 says "nonce_keys == [] selects the legacy account
   nonce". The sidecar requires 1–16 keys and uses `["0x0"]` as its legacy form, so a wallet that
   follows EIP-8250 literally cannot send a legacy frame transaction to it.
4. **Key 0 is overloaded (keys-zero-mixed).** In EIP-8250, key 0 is an ordinary NONCE_MANAGER slot,
   and `[0, 307]` is strictly increasing and valid. The sidecar treats key 0 as the legacy nonce and
   rejects the mix, as its docs say.
5. **Rule attribution, not a verdict divergence (frames-65).** The verdict is the expected reject, but
   under `simulation` with ethrex's message and code −32500. The sidecar's own `structure` rule does not
   check `MAX_FRAMES`; it relies on the execution client.
6. **Invisible rejections.** All four key-list rejections happen at the RPC, before an admission record
   exists, so the explorer has nothing to show. Only Rooted's submission journal
   (`/api/v1/frames/submissions`) keeps the error code and message.

### Corrections made before the run (recorded, not after-the-fact)

- keys-16, EIP-8250 column: the contract table said accept, but EIP-8250 says "The existing
  MAX_VERIFY_STATE_GAS cap on the sum of state limits in the validation prefix is unchanged", so it is reject.
- keys-16, sidecar-docs column: changed accept to reject, because the differences page says the sidecar
  follows the earlier draft, where "A per-entity state-gas cap existed" (the value is undocumented).
- keys-zero-mixed overrides: added verify execution 60,000 and state 2 × 97,920. Without them, a
  conformant EIP-8250 node would also reject, because APPROVE needs 97,920 state gas per fresh key,
  and the case would test nothing.

## Trade-offs

**Combined `MAX_VERIFY_GAS` (EIP-8141) vs per-entity budgets (ERC-8421).**
- The combined budget is static: one sum over the prefix plus the signature cost, checked before any
  simulation. It bounds a node's validation work per transaction with no attribution logic. The cost is
  that it cannot be raised for a staked payer without raising it for every entity in the transaction.
- Per-entity budgets (100k unstaked, 1M staked) let a staked paymaster run expensive validation, such as
  an aggregated signature or a Merkle proof, while unstaked entities stay at 100k. But the node must
  attribute work correctly: `pre_verify` counts toward the approving frame that follows it, and the
  signature counts toward the sender. Its worst-case work per transaction also grows with the number of
  entities. Stake and reputation are what make that larger bound safe.
- Divergence 1 shows the failure mode of either design. Mis-pricing one input (here, apparently, the
  signature) silently widens the budget, and only differential testing against a second implementation
  (ethrex's canonical check) exposes it.

**Keyed nonces and the DoS surface.**
- Every fresh `(sender, key)` is a permanent NONCE_MANAGER slot (97,920 state gas, never deleted).
- A transaction can depend on up to 16 slots, and the node must revalidate it when any of them changes.
- Disjoint key sets let one sender keep many transactions pending at once. The draft caps this at 64 per
  unstaked sender and 4 per (sender, key). The sidecar has no per-sender cap for keyed transactions (its
  docs: "No per-sender cap on keyed transactions"), so balance reservation ("pending transactions never
  owe an account more than its balance") is the only backstop against one funded sender filling the pool.
- Validation gas grows with the number of keys. The docs report that 7 keys ran out of gas at 30,000 and
  succeeded at 80,000, which leaves 16 keys little headroom under a 100k budget.
- Divergence 2 adds a hard ceiling: under the 500k state cap, a single transaction cannot use 16 fresh keys.

**Durability across devnet resets.**
- The explorer is in memory. The gateway's boot id changed between this morning's research
  (`075e46bf…`) and this run (`9c7ea46a…`), and the earlier rejection quoted in divergence 1 is gone.
  The devnet itself "may be reset at any time", which changes the genesis.
- Rooted's archive is scoped by boot and already journals `node_restarted` and `history_gap`. A genesis
  change in an existing scope used to be a hard error that stopped every poll. Now it records a
  `devnet_reset` incident (detail: previous/current genesis and boot), resets the stream sequence and
  scan cursor, and continues in the same scope. Rows from before the reset stay readable under their old boot.
- The default is still a pinned `ROOTED_FRAME_GENESIS_HASH`. Re-pinning to the new genesis journals the
  reset. `ROOTED_FRAME_GENESIS_HASH=follow` accepts the live block-0 hash, so an archive left running
  overnight survives a reset with no operator action. The chain id is still enforced. Follow mode trusts
  the endpoint's genesis, so the incident log is the only record of which epoch each row belongs to.
- Known limit: if a reset keeps the same boot id, old and new rows share it, and the incident marks the boundary.
- Drill (live, separate scope `frame-reset-drill`): after setting the stored genesis to the retired
  `0x196a…7bbc`, a follow-mode `frame-sync` recorded `devnet_reset`
  `0x196a…7bbc:0x2ad3…ae7a`, adopted the live genesis and cleared the cursor.

**Conformance as differential testing.**
- The runner tests implementations, not prose. Four sources (EIP-8141, EIP-8250, ERC-8421 draft,
  sidecar docs) disagree with each other on three of ten cases, and the node disagrees with all of them on one.
- It records the RPC answer first, then the admission report's failed `checks[]`, so a rejection is
  attributed to a rule (`structure`, `simulation`) when the node gives one.
- The baseline proves the harness can land a valid transaction, so the rejections are not artefacts of the builder.

**Public devnet etiquette.**
- `.tools/frame-submissions.log` counts every submission from both scripts. The runner refuses to start
  if its planned cases would push the count past 25.
- At most one submission per new block, from fresh random keys funded once from the faucet. Keys stay in
  memory only; signed transactions are public evidence.
- This session used 13 submissions: the gateway baseline, its relay to the miner, the included miner
  baseline, and the 10 cases.
