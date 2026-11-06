# read:framemempool (Read phase)

Task prompt given to one Claude Code agent by the `rooted-repo-context` workflow script on 2026-11-06T06:46:36.687Z (UTC), verbatim.

---

You are mapping the "Rooted" repo at /home/ubuntu/Rooted (Go backend + Next.js dashboard + Python probe/smoke scripts, Ethereum Sepolia/Glamsterdam-era observability: ePBS payloads, BAL (block access lists), frame-transaction mempool devnet, execution profiler, provider comparison). There is no README; docs/ holds per-subsystem docs and PHASEn_VERIFICATION.md files. demo/ holds recorded reference evidence.
Go toolchain is at ~/sdk/go/bin/go (not on PATH). A .env with the user's real settings exists at /home/ubuntu/Rooted/.env — local Sepolia Nimbus/Geth via SSH tunnels on 127.0.0.1:18545 (EL) and :15052 (beacon), currently NOT listening; fork RPC :8547 also down. Port 54329 is held by an unrelated docker container, NOT Rooted's compose postgres.
Rules: READ-ONLY. Do not edit files, do not run tests, do not make network calls, do not start services. Read code and docs thoroughly (actually open the files, don't guess from names). Be concrete: cite file:line for claims about behavior and risks. Prefer real defects / doc-vs-code mismatches over style nits. List every file you actually read in files_read (repo-relative paths).

Subsystem: frame-transaction mempool monitor (independent frame devnet, chain 1337, altmempool.forshtat.com). Read internal/framemempool/* (all), internal/api/frame.go and frame_test.go, migrations/003_frame_mempool.sql, internal/config/frame.go, docs/FRAME_MONITOR.md, docs/FRAME_DEVNET_TEST.md, docs/FRAME_EXPLORER_REVIEW.md, docs/PHASE4_VERIFICATION.md, demo/phase4/** (status + reference JSON shapes), scripts/probe_frame_devnet.py, scripts/probe_frame_stream.mjs, scripts/test_frame_codec.py, scripts/test_frame_transaction.py, scripts/test_frame_regression.py, scripts/check_frame_regression.py, scripts/smoke_phase4.py. Explain gateway vs miner nodes, submission flow (does the backend sign/submit transactions? with what key? is that guarded?), observation window, status reduction, streaming, and how isolation from Sepolia is enforced.
