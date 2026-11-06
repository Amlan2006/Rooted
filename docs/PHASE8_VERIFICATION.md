# Phase 8 — investigation and provider integration

Rooted includes deterministic conflict explanations, Uniswap contention
classification, guided transaction investigation, Markdown/JSON downloads,
controlled workload comparison, and immutable provider comparison. CRE is
deferred: its service, authenticated receiver, contract, workflow, and migration
005 are not required by these features.

## Delivered behavior

- Conflicts require exact transaction/location/access evidence. Read/read
  overlap, an unverified pool, or a shared address cannot create a conflict.
- Pool/token/account/unclassified category totals cover every returned edge in
  the selected graph, independently of the drawing/table limits.
- Guided investigation pins report, transaction, execution hash, network,
  evidence mode, source, Beacon slot, and root. Competing roots stay distinct.
- Exports use field allowlists, omit endpoint credentials and private operator
  names, preserve unknown/false values, and embed the complete versioned JSON
  bundle in Markdown.
- Controlled A/A/A and A/B/A comparisons require a common fork baseline,
  matching actual inputs, receipt identity, trace coverage, and untruncated
  graphs before showing structural deltas. Speedup is not inferred.
- Provider checks use an immutable block hash and verified chain/checkpoint
  identity. Getter/envelope BAL proofs, pruning, unsupported methods, malformed
  data, timeouts, and disagreements remain distinct.
- Each explicit provider recheck creates a new stored observation. Neither
  provider is automatically considered authoritative.

## Verification run on 2026-11-06

This run covered the provider-comparison part of Phase 8 and the read-only
cross-module smoke. It used a scratch PostgreSQL database, with migrations 001–004,
006, and 007 applied, and the live Geth v1.17.10/Nimbus v26.10.2 Sepolia
tunnel.

- `go test -race -count=1 ./internal/providers/...` passed, including the
  PostgreSQL recheck/scope test (`TEST_DATABASE_URL` set; no skips).
- `node --import tsx --test tests/provider-comparison.test.ts` passed (3 tests).
- `.tools/rooted compare-providers` on block
  `0x5003b43a843799fd3043275a52cfc9f1d16907e685e0781b0cb13aa21a326cdc`
  saved a **matching block data with observation gaps** report. Its output is
  `demo/provider-comparison/live-report.json`; see
  [PROVIDER_COMPARISON.md](PROVIDER_COMPARISON.md#verification).
- With `.tools/rooted serve` running on that database,
  `python3 scripts/smoke_phases8_9.py --base http://127.0.0.1:PORT` returned
  `passed`. It found a configured collector source, isolated payload scope, a
  saved live BAL analysis and its four views, the saved provider comparison,
  and a saved profile capture with reconciled timers.

The run did not cover the conflict explanation, Uniswap contention, guided
investigation, export, or workload-comparison test suites. It also did not
cover the dashboard proxy smoke (`--dashboard`), the production frontend
build, or a clean-checkout install. `demo/phase8/status.json` records the same
scope. Database integration tests skip explicitly when `TEST_DATABASE_URL` is
unset.

## Run

After rebuilding and restarting the backend with the existing `.env`:

```sh
go build -o .tools/rooted ./cmd/rooted
set -a
source .env
set +a
.tools/rooted serve
```

Startup applies migrations 006 and 007 after the existing 001–004 migrations.
The migration loader checks each version independently, so migration 005 can be
added later with CRE. Keep a separate terminal for explicit comparisons:

```sh
.tools/rooted compare-providers
.tools/rooted compare-providers IMMUTABLE_BLOCK_HASH
python3 scripts/smoke_phases8_9.py
python3 scripts/smoke_phases8_9.py --dashboard --base http://127.0.0.1:3000
```

The smoke check reads saved data only and reports `partial` if an analysis,
comparison, or profile has not been created. It does not substitute demo
fixtures or require CRE to make an incomplete check appear successful.

Use the dashboard's **Investigate**, **BAL analyzer**, **Compare workloads**,
and **RPC providers** views. Policy evidence remains optional and unavailable
until the deferred CRE integration is configured.

See [GUIDED_INVESTIGATION.md](GUIDED_INVESTIGATION.md),
[WORKLOAD_COMPARISON.md](WORKLOAD_COMPARISON.md), and
[PROVIDER_COMPARISON.md](PROVIDER_COMPARISON.md) for the detailed boundaries.
