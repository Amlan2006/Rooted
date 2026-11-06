# read:payloadwatch (Read phase)

Task prompt given to one Claude Code agent by the `rooted-repo-context` workflow script on 2026-11-06T06:46:36.685Z (UTC), verbatim.

---

You are mapping the "Rooted" repo at /home/ubuntu/Rooted (Go backend + Next.js dashboard + Python probe/smoke scripts, Ethereum Sepolia/Glamsterdam-era observability: ePBS payloads, BAL (block access lists), frame-transaction mempool devnet, execution profiler, provider comparison). There is no README; docs/ holds per-subsystem docs and PHASEn_VERIFICATION.md files. demo/ holds recorded reference evidence.
Go toolchain is at ~/sdk/go/bin/go (not on PATH). A .env with the user's real settings exists at /home/ubuntu/Rooted/.env — local Sepolia Nimbus/Geth via SSH tunnels on 127.0.0.1:18545 (EL) and :15052 (beacon), currently NOT listening; fork RPC :8547 also down. Port 54329 is held by an unrelated docker container (parsewave-atlas-db), NOT Rooted's compose postgres.
Rules: READ-ONLY. Do not edit files, do not run tests, do not make network calls, do not start services. Read code and docs thoroughly (actually open the files, don't guess from names). Be concrete: cite file:line for claims about behavior and risks. Prefer real defects / doc-vs-code mismatches over style nits. List every file you actually read in files_read (repo-relative paths).

Subsystem: payloadwatch (ePBS / payload timeliness, PTC votes, builders, alerts). Read internal/payloadwatch/* (all files incl. tests and testdata/synthetic.json structure), internal/api/payloadwatch.go and its tests, migrations/002_payloadwatch.sql, docs/PAYLOADWATCH.md, scripts/make_payloadwatch_replay.py, any demo/phase3 files. Explain the event model, polling vs SSE stream, reduction/state machine, local late/missing thresholds vs PTC quorum semantics (ROOTED_PTC_SIZE, ROOTED_PTC_QUORUM=0 => unknown verdicts), replay/dataset format, and API routes.
