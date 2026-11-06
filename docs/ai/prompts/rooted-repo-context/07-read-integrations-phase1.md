# read:integrations-phase1 (Read phase)

Task prompt given to one Claude Code agent by the `rooted-repo-context` workflow script on 2026-11-06T06:54:56.344Z (UTC), verbatim.

---

You are mapping the "Rooted" repo at /home/ubuntu/Rooted (Go backend + Next.js dashboard + Python probe/smoke scripts, Ethereum Sepolia/Glamsterdam-era observability: ePBS payloads, BAL (block access lists), frame-transaction mempool devnet, execution profiler, provider comparison). There is no README; docs/ holds per-subsystem docs and PHASEn_VERIFICATION.md files. demo/ holds recorded reference evidence.
Go toolchain is at ~/sdk/go/bin/go (not on PATH). A .env with the user's real settings exists at /home/ubuntu/Rooted/.env — local Sepolia Nimbus/Geth via SSH tunnels on 127.0.0.1:18545 (EL) and :15052 (beacon), currently NOT listening; fork RPC :8547 also down. Port 54329 is held by an unrelated docker container (parsewave-atlas-db), NOT Rooted's compose postgres.
Rules: READ-ONLY. Do not edit files, do not run tests, do not make network calls, do not start services. Read code and docs thoroughly (actually open the files, don't guess from names). Be concrete: cite file:line for claims about behavior and risks. Prefer real defects / doc-vs-code mismatches over style nits. List every file you actually read in files_read (repo-relative paths).

Subsystem: Phase 1 probes, external integrations, and demo evidence. Read integrations/cre/probe/** (project.yaml, workflow.yaml, main.ts, capability.ts, config.json, capability.json, package.json), integrations/anon-rpc/probe/** (private-rpc.ts and test, package.json), scripts/probe_common.py, scripts/probe_sepolia.py, scripts/probe_cre.py, scripts/run_phase1.py, scripts/test_phase1.py, scripts/verify_phase1_recorded.py, docs/PHASE1_VERIFICATION.md, and survey demo/phase1/** (list via git ls-files demo/phase1; open status/summary files and a representative sample, explain what each subfolder proves). Explain what Chainlink CRE and anon-rpc are used for here, what the phase1 probes check against Sepolia, how recorded evidence is verified offline, and how demo/phase1/reference relates to demo/phase4 and demo/phase5 (apparent duplicates?).
