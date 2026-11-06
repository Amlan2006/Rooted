# read:bal-analysis (Read phase)

Task prompt given to one Claude Code agent by the `rooted-repo-context` workflow script on 2026-11-06T06:46:36.689Z (UTC), verbatim.

---

You are mapping the "Rooted" repo at /home/ubuntu/Rooted (Go backend + Next.js dashboard + Python probe/smoke scripts, Ethereum Sepolia/Glamsterdam-era observability: ePBS payloads, BAL (block access lists), frame-transaction mempool devnet, execution profiler, provider comparison). There is no README; docs/ holds per-subsystem docs and PHASEn_VERIFICATION.md files. demo/ holds recorded reference evidence.
Go toolchain is at ~/sdk/go/bin/go (not on PATH). A .env with the user's real settings exists at /home/ubuntu/Rooted/.env — local Sepolia Nimbus/Geth via SSH tunnels on 127.0.0.1:18545 (EL) and :15052 (beacon), currently NOT listening; fork RPC :8547 also down. Port 54329 is held by an unrelated docker container, NOT Rooted's compose postgres.
Rules: READ-ONLY. Do not edit files, do not run tests, do not make network calls, do not start services. Read code and docs thoroughly (actually open the files, don't guess from names). Be concrete: cite file:line for claims about behavior and risks. Prefer real defects / doc-vs-code mismatches over style nits. List every file you actually read in files_read (repo-relative paths).

Subsystem: BAL analyzer and contention analysis. Read internal/bal/* (all), internal/analysis/* (all incl. tests), internal/uniswap/*, internal/api/analysis.go and its test, migrations/004_analysis.sql, internal/config/analysis.go, docs/BAL_ANALYZER.md, docs/WORKLOAD_COMPARISON.md, docs/PHASE5_VERIFICATION.md, demo/phase5/** (status and the shape of reference JSONs; do not decompress .gz), workloads/uniswap/** (foundry.toml, SwapWorkload.sol), scripts/probe_uniswap.py, scripts/run_uniswap_workload.py, scripts/run_uniswap_comparison.py, scripts/smoke_phase5.py. Explain how a BAL / access graph is built (native RLP decode vs prestate/parity/geth trace diffs), the analysis anchor (ROOTED_ANALYSIS_ANCHOR_NUMBER/HASH) and fork RPC role (must be loopback), transaction-to-block resolution, conflict detection, persistence, and the workload comparison flow.
