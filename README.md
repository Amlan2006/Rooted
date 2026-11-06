<div align="center">

# Rooted

**Live, verifiable telemetry for Glamsterdam-era Ethereum.**

ePBS payloads · block access lists · frame-transaction mempool · native execution replay

</div>

---

Rooted watches Sepolia from its own Nimbus + Geth node and checks the new protocol's promises block by block. Every observation is cross-checked against beacon roots, payload hashes and header commitments, stored in Postgres, and replayable offline.

## What it does

| | |
|---|---|
| **PayloadWatch** | ePBS bids, payload envelopes, PTC votes and local arrival timing per slot |
| **BAL analyzer** | EIP-7928 access lists decoded, commitment-checked and turned into RAW/WAR/WAW dependency graphs, with Uniswap v3 swap decoding |
| **Frame mempool** | Durable archive of the EIP-8141 alt-mempool devnet: admissions, rule checks, receipts, restarts |
| **Execution profiler** | Native Geth v1.17.10 replay of every transaction in a block, timed down to StateDB calls |
| **Provider comparison** | One block hash, two providers, field-by-field agreement |
| **Dashboard** | One UI over all of the above, plus an anonymous-RPC (Nox) inspector |

## Quick start

```sh
cp .env.example .env          # point ROOTED_EXECUTION_URL / ROOTED_BEACON_URL at your node
set -a; . ./.env; set +a
docker compose --project-name rooted up -d --wait postgres
go build -o .tools/rooted ./cmd/rooted && .tools/rooted serve
cd dashboard && npm ci && npm run dev    # http://127.0.0.1:3000
```

Needs Go 1.25+, Node 24 and Docker. The profiler's replay runner builds separately:
`(cd workloads/profiler && go build -o ../../.tools/rooted-replay .)`

## Docs

[Backend](docs/BACKEND.md) · [API](docs/API.md) · [PayloadWatch](docs/PAYLOADWATCH.md) · [BAL analyzer](docs/BAL_ANALYZER.md) · [Frame monitor](docs/FRAME_MONITOR.md) · [Profiler](docs/EXECUTION_PROFILER.md) · [Providers](docs/PROVIDER_COMPARISON.md) · [Dashboard](docs/DASHBOARD.md) · [Sepolia node](docs/SEPOLIA_NODE.md)

## License

[MIT](LICENSE) · Built at ETHGlobal Mumbai 2026
