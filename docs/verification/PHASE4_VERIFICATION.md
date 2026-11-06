# Phase 4 verification

Phase 4 adds the frame-devnet monitor, durable evidence schema, receipt proof
reducer, CLI submission recorder, read APIs, WebSocket resume handling, and
recorded-state regression comparison.

Everything below was run on 2026-11-06 on this host.

## Offline and database checks

```sh
export PATH=$HOME/sdk/go/bin:$PATH
TEST_DATABASE_URL=postgres://...rooted_w2 go test -count=1 -v ./internal/framemempool/...
python3 scripts/test_frame_codec.py
python3 scripts/test_frame_regression.py
python3 -m unittest discover -s scripts -p 'test_frame_*.py'
python3 -m py_compile scripts/smoke_phase4.py scripts/probe_frame_devnet.py
node --check scripts/probe_frame_stream.mjs
```

Results:

- `internal/framemempool`: 25 passing test/subtest results, 0 skips, 0
  failures.
- The database-backed tests (`TestDurableDetailDedupeAndScope`,
  `TestGapsAndCanonicalReorg`, `TestConcurrentMetadataDoesNotRegress`) ran
  against Rooted's PostgreSQL. Each runs migrations twice in a temporary
  schema and drops it afterwards.
- Python: 6 frame tests passed (2 codec, 4 regression comparator). The
  compile checks passed.

Other packages (`internal/api`, `internal/config`, `cmd/rooted`) were not run
as part of this check.

What the frame tests cover:

- RPC error redaction and cancellation, and exact large-integer
  canonicalization.
- Admission snapshots take precedence over older lifecycle events.
- Duplicate and reordered events, boot boundaries, gaps, and unresolved
  observation windows.
- Type-0x6 receipt identity and canonical block checks: reorgs, malformed
  headers, receipt absence, RPC failure, and reverted execution.
- Supplemental frame receipt coverage.
- Empty post-ack WebSocket envelopes, wrong subscriptions, invalid events,
  reconnect sequence handling, and acknowledgment/admission separation.
- Durable detail dedupe, restart incidents, and scope isolation. This test
  uses the live explorer detail in
  `demo/phase1/reference/frame-probe/existing_detail.json`.
- The included and unfunded-rejection states captured on 2026-11-06, replayed
  through the reducer (`TestCapturedLifecycleEvidence`).

## Live checks

All live checks used the public devnet (genesis `0x2ad3f67b...5bae7a`). See
`docs/FRAME_DEVNET_TEST.md` for identities and file contents.

- `probe_frame_devnet.py` and `probe_frame_stream.mjs` passed.
- `rooted serve` with only the frame collectors reached `poll_status=ok` and
  `stream_status=connected` on both nodes. The collectors stored 38 gateway
  and 60 miner states.
- `test_frame_transaction.py --submit --record --unfunded-rejection` recorded
  one attempt as `rpc_rejected`. Polling then stored the admission report as
  `rejected` with `admission_confirmed=false`.
- `rooted frame-sync gateway HASH` and `rooted frame-sync miner` exited 0.
- `smoke_phase4.py --base http://127.0.0.1:8082` passed with 38 states, 30
  receipt-verified inclusions, 5 rejections, a connected stream, and 1
  submission attempt.
- `check_frame_regression.py` on the smoke baseline/candidate (an included
  transaction vs a rejected one) exited 1 and listed the newly failed rules,
  as expected.

## Recorded artifacts

- `demo/phase4/reference/*.json` (identical copy in
  `demo/phase1/reference/frame-phase4/`): API responses from the run above.
- `demo/phase4/offline-states.json`: the `ROOTED_PHASE4_OFFLINE_EVIDENCE`
  payload logged by `TestCapturedLifecycleEvidence` in the run above. It
  holds the two captured states re-labelled as mode `captured` and reduced
  offline, plus one synthetic acknowledgment-only state (`unknown`, not
  admitted). Its flags (`persistence_verified=false`,
  `canonicality_rechecked_now=false`, `funded_own_submission_verified=false`)
  describe that offline reducer pass only.
- `demo/phase4/status.json`: summary of this verification.

## Open

- A funded disposable Rooted submission from acknowledgment through admission
  and canonical inclusion. It was not attempted.
- A PostgreSQL restart of a running service. Durability was exercised through
  the database-backed tests and repeated migrations, not by restarting the
  database container.

The submission CLI accepts only externally signed JSON, stores no private key,
and never retries automatically.
