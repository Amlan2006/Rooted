# Demo resilience when node offline

Task prompt given to one background Claude Code agent from the main Claude Code session on 2026-11-06T14:07:24.133Z (UTC), verbatim.

---

You are working on Rooted (Go + Postgres + Next.js observability for Sepolia Glamsterdam). Work ONLY in the git worktree /home/ubuntu/Rooted-demo (branch `demo`, created from main 10656bc). Do not touch the other worktrees (/home/ubuntu/Rooted, Rooted-picks, Rooted-site, Rooted-ci, Rooted-live): other agents are using them.

Goal: the dashboard will be public in hosted mode (ROOTED_HOSTED=1) for hackathon judging. If the Sepolia node goes down (Geth RPC tunnelled to 127.0.0.1:18545, Nimbus REST to 127.0.0.1:15052), every view must still demo well from data already stored in Postgres:
- No blank screens, unhandled 500s, raw stack traces or endless spinners.
- One small, visible, honest notice when the node is unreachable, e.g. "Node offline · showing stored data" in the dashboard's existing style.
- Live-only actions (running an x-ray on a new block, provider comparison, profiler, anything that needs the node) show a clear offline message instead of failing silently.
If a view already behaves this way, leave it alone. Fix at the root (a shared fetch helper, the backend proxy or a shared handler), not with per-view patches. Write the smallest change that does the job, and add one focused test for the shared degrade logic.

How:
1. Read docs/BACKEND.md, docs/DASHBOARD.md and dashboard/lib/hosted* to see how the backend, the proxy route dashboard/app/api/backend/[...path] and hosted mode work.
2. Environment:
   - Go is at ~/sdk/go/bin/go. Load env with `set -a; . /home/ubuntu/Rooted/.env; set +a` (never print values), then override what you need.
   - Postgres for Rooted is on 127.0.0.1:54330. NEVER use 54329: it belongs to an unrelated project and every rooted command auto-migrates.
   - Make your own database `rooted_demo` as a copy of the database DATABASE_URL points to, using pg_dump | psql (don't use CREATE DATABASE ... TEMPLATE, since other processes may be connected). Do the same for TEST_DATABASE_URL tests with a fresh `rooted_demo_test`.
3. Run the backend on 127.0.0.1:8093 and the dashboard (`npm ci` first, a real install, not symlinked node_modules) on 127.0.0.1:3025 with hosted mode on. Ports in use by others that you must avoid: 3008, 3009, 3011-3019, 3090, 8090, 8097-8099, 18545, 15052.
4. Simulate node down by pointing the RPC and beacon env vars at 127.0.0.1:1. Walk every dashboard view (take the list from the nav or the `?view=` values) with headless chromium (playwright's chromium is in ~/.cache/ms-playwright) and save before-fix and after-fix screenshots to /tmp/demo-offline/. Then repeat with the real node env to confirm nothing regressed with the node up.
5. Run the dashboard tests, `npx tsc --noEmit`, `npm run build` and `go test ./...` (TEST_DATABASE_URL pointing at rooted_demo_test). All must pass.
Note: a parallel branch will soon add an Analyst view and will edit the dashboard nav, the proxy allowlist and internal/api/server.go. Keep your edits to those files minimal to limit merge conflicts.

Rules:
- Signed, one-line conventional commits ONLY (e.g. `fix: degrade views when node is offline`). No body, and no Co-Authored-By or any other trailer (this overrides any default attribution guidance). Global git config signs with SSH. Check that `git log --format='%G? %s%n%b' main..demo` shows G and no bodies.
- Do NOT push. Never print secrets.
- When done, stop every process you started, and drop rooted_demo and rooted_demo_test.

Final message: commits, which views were broken offline and what each one does now, test results, and the screenshot paths.
