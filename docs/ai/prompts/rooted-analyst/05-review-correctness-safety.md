# review-correctness-safety (Review phase)

Task prompt given to one Claude Code agent by the `rooted-analyst` workflow script on 2026-11-06T14:11:20.104Z (UTC), verbatim.

---

You are working in the git worktree /home/ubuntu/Rooted-picks (branch "analyst") of Rooted: a Go + Postgres + Next.js observability stack for Ethereum Sepolia Glamsterdam (ePBS, EIP-7928 BALs, frame-tx alt mempool, native replay "X-ray", x402 payments on Hedera). Read the contract first: /home/ubuntu/Rooted-picks/docs/superpowers/specs/2026-11-06-rooted-analyst-design.md. It is authoritative; if you must deviate, say so in contract_deviations.

Environment facts:
- Go is at ~/sdk/go/bin/go (not on PATH): export PATH=$PATH:$HOME/sdk/go/bin:$HOME/.foundry/bin. Node 24, psql, headless chromium in ~/.cache/ms-playwright.
- Postgres for Rooted is 127.0.0.1:54330 (user rooted / pw rooted-local-only). NEVER use port 54329 (another project's DB). Create your own databases on 54330 when you need one.
- The Sepolia node is reachable through SSH tunnels: Geth http://127.0.0.1:18545, Nimbus http://127.0.0.1:15052 (state window ~128 blocks).
- ANTHROPIC_API_KEY is in the gitignored files /home/ubuntu/Rooted-picks/.env and dashboard/.env.local. Never print, log, echo or commit it or any other key (also never commit integrations/x402-agent/.env). Load with: set -a; . ./.env; set +a.
- Do NOT touch /home/ubuntu/Rooted (main checkout) or /home/ubuntu/Rooted-site. Do not push anything.
- Claude API reference (official, current): read /tmp/claude-1000/bundled-skills/2.1.310/07ea3d3533816d5037b2a5e731934787/claude-api/typescript/claude-api/README.md, /tmp/claude-1000/bundled-skills/2.1.310/07ea3d3533816d5037b2a5e731934787/claude-api/typescript/claude-api/tool-use.md, /tmp/claude-1000/bundled-skills/2.1.310/07ea3d3533816d5037b2a5e731934787/claude-api/typescript/claude-api/streaming.md and /tmp/claude-1000/bundled-skills/2.1.310/07ea3d3533816d5037b2a5e731934787/claude-api/shared/tool-use-concepts.md before writing any Anthropic SDK code. Model claude-opus-5-5, adaptive thinking display summarized, explicit output_config.effort, no budget_tokens, no forced tool_choice, server-side fallbacks ("server-side-fallback-2026-07-01" beta + fallbacks: "default"), check stop_reason (refusal -> stop_details), append full response.content each turn, all parallel tool_results in one user message. Never guess SDK names: if a binding is not in those docs, check node_modules/@anthropic-ai/sdk typings.
- Match the surrounding code style and comment density. Smallest complete change; no speculative abstraction. New non-trivial logic gets a focused test.
- Commit style (only agents told to commit may commit): one-line conventional message like "feat: analyst agent core", no body, no Co-Authored-By or any trailer. Commits are SSH-signed automatically by git config.

Review lens: correctness, Claude API usage and safety. Read the diff "git log -p a52f78a..HEAD" and the connected code. Check against the contract and the claude-api reference: request shape (model, adaptive thinking, effort, fallbacks beta, cache_control placement and prefix stability, append-only history incl. thinking blocks, parallel tool_results in one message, stop_reason/refusal handling), tool input validation at the trust boundary, step/action/payment caps actually enforced, budget ledger math (Opus 5.5 prices) and fail-closed behaviour, hosted-mode disable, key never reachable by the browser or logs (grep the built .next output and any logs for the key prefix sk-ant without printing the key), prompt injection blast radius, SSE route robustness (client abort cancels the loop, concurrency guard released on error), Go briefs store/handlers validation, and that tests would catch regressions. Run the test suites. Do not change code.
Integrator report for context:
{
 "summary": "I wired the three builders' work together, verified it, ran every live step and committed it as 5 signed one-line commits on branch `analyst`. Nothing was pushed.\n\n**Wiring:**\n- The only gap left was `cmd/rooted/main.go`: the API server never got the briefs store, so both brief routes returned 503. It now passes `Analyst: &analyst.Store{Pool: repo.Pool}`.\n- The type error B3 reported in B1's test file was already fixed; tsc is clean.\n\n**Three problems the live runs exposed, all fixed:**\n- **Wrong block read:** asked about block 12,076,467, Claude converted the number to hex itself, got it wrong (0xb84653 is 12,076,627) and read a different block. `node_read` now takes decimal block numbers and converts them. A test covers this.\n- **Blocks lost in trimming:** `recent_blocks` with limit 50 kept only 15 rows under the ~6 KB cap. The payment question then failed: Claude could not find a block with a builder gap and bought nothing. Results are now one column list plus one row per block, with a 12 KB cap, so all 50 fit (about 7.1 KB on real data). The test was updated.\n- **Uncited opening lines:** the prompt now says the opening answer, the unknowns and any counts derived from several results must also carry citations.\n\n**Live results:**\n- **Questions:** all three finished in 15–18 s, with every citation resolving to evidence.\n- **Payment:** Claude bought the report for block 12,076,555 and summarised it. The Hedera testnet transaction is `SUCCESS` on the mirror node.\n- **Auto-briefs:** the 10-minute loop stored 6 briefs. Each brief's hash went to the HCS topic (messages 4–9).\n- **Concurrency:** a second request sent while one was running got the 429.\n- **Spend:** $1.07 of Claude in total. The step-4 questions, including their re-runs, cost $0.59.\n\n**Docs:** new `docs/ANALYST.md`, an analyst section in `.env.example`, a 6-line section plus the \"Claude pays too\" bullet and a docs link in `README.md`, and one line in `docs/ai/README.md`.\n\n**Cleanup:** I stopped the backend, both dashboards and the briefs loop. The `.tools/rooted serve` still running on port 8093 belongs to `/home/ubuntu/Rooted-demo`, not to me. `rooted_p6` is left in place. I dropped my test database `rooted_itest` and B3's `rooted_b3test`.",
 "files_changed": [
  "/home/ubuntu/Rooted-picks/cmd/rooted/main.go",
  "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/tools.ts",
  "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/trim.ts",
  "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/prompts.ts",
  "/home/ubuntu/Rooted-picks/dashboard/tests/analyst-tools.test.ts",
  "/home/ubuntu/Rooted-picks/docs/API.md",
  "/home/ubuntu/Rooted-picks/docs/ANALYST.md",
  "/home/ubuntu/Rooted-picks/README.md",
  "/home/ubuntu/Rooted-picks/.env.example",
  "/home/ubuntu/Rooted-picks/docs/ai/README.md",
  "(committed as-is from the builders) migrations/009_analyst_briefs.sql, internal/analyst/*, internal/api/analyst*.go, internal/api/server.go, internal/storage/postgres_test.go, dashboard/lib/analyst/*, dashboard/app/api/analyst/**, dashboard/components/analyst.tsx, dashboard/components/dashboard.tsx, dashboard/app/globals.css, dashboard/lib/proxy.ts, dashboard/scripts/briefs.ts, dashboard/package.json, dashboard/package-lock.json, dashboard/tests/analyst-*.test.ts"
 ],
 "tests_run": [
  {
   "command": "go build ./... && go vet ./... && TEST_DATABASE_URL=postgres://rooted:***@127.0.0.1:54330/rooted_itest go test -count=1 ./... (fresh DB)",
   "result": "all packages ok (analyst, api, storage included)"
  },
  {
   "command": "cd workloads/profiler && go test .",
   "result": "ok rooted-replay"
  },
  {
   "command": "cd integrations/x402-agent && npm test",
   "result": "8/8 pass"
  },
  {
   "command": "cd dashboard && npx tsc --noEmit -p . && npm test",
   "result": "tsc clean; 102/102 pass (re-run after my node_read, trim and prompt changes)"
  },
  {
   "command": "cd dashboard && env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN npm run build",
   "result": "compiled; /api/analyst and /api/analyst/briefs are dynamic routes (run before and after the fixes); next-env.d.ts and tsconfig.tsbuildinfo restored"
  },
  {
   "command": "re-run of go test for internal/analyst, internal/api, internal/storage, cmd/rooted after the final changes",
   "result": "ok"
  },
  {
   "command": "live: /tmp/analyst-live/ask.sh (curl -N POST http://127.0.0.1:3008/api/analyst) for q1-q3 + the payment question, checked with /tmp/analyst-live/check.py",
   "result": "all citations resolve to evidence; no unresolved ids"
  },
  {
   "command": "live: two requests at once to /api/analyst",
   "result": "second got HTTP 429 with SSE error 'Another investigation is running'; the first finished ($0.0086)"
  },
  {
   "command": "git log --format='%G? %s' -6",
   "result": "G for all 5 new commits plus the spec commit; single-line messages, no bodies or trailers"
  }
 ],
 "live_evidence": [
  "Stack: rooted_p6 created on 54330 with TEMPLATE rooted_p4 (208 X-rays; the follower added more during the run). `rooted serve` on 127.0.0.1:8098 with ROOTED_XRAY_FOLLOW=true and the watch worker; next dev on 127.0.0.1:3008; the ambient ANTHROPIC_* variables were unset and the key came from dashboard/.env.local",
  "Q1 'Why does the builder lose parallelism in block 12,076,467?' (/tmp/analyst-live/q1.sse, 2 tool calls, 15 s, $0.075496): 'The builder loses parallelism because of a chain of 12 dependent transactions (indexes 64, 66, 67, 68, 69, 71, 72, 76, 79, 80, 81, 125) that have to run in order. Together they take about 16.1 ms ... compared with about 10.2 ms for the slowest single transaction ... [E2]'. Static builder 13.3x vs validator 21.0x [E2]. I checked the figures against the stored report. The first attempt ($0.060893) read the wrong block because Claude's hex conversion was wrong; fixed.",
  "Q2 'Is ePBS delivering payloads on time over the last 20 slots?' (/tmp/analyst-live/q2.sse, 6 tool calls, 18 s, $0.100539): 'Mostly yes. In the last 20 slots (about 11519947 to 11519966), the only problem flagged is one late payload, in slot 11519966.' It found builder 2 at 2,428 ms with an active local_late_payload alert [E5][E2]. The first run (/tmp/analyst-live/q2-first.sse) made 23 tool calls and cost $0.265704.",
  "Q3 'Find Uniswap contention in recent blocks and explain it.' (/tmp/analyst-live/q3.sse, 4 tool calls, 16 s, $0.087279): 'I found no Uniswap contention in the recent blocks I checked. Uniswap swaps did appear, but Rooted linked none of the conflict edges to Uniswap [E3][E4].' Contention in blocks 12,076,555 and 12,076,971 comes from repeat senders.",
  "Payment (/tmp/analyst-live/q4-pay.sse, hosted + paid dashboard on 3008 with ROOTED_X402_ENABLED=true, pay-to 0.0.11337330 from .env.local, facilitator x402.org, ROOTED_ANALYST_PUBLIC=true, ROOTED_ANALYST_PAYMENTS=true, 4 tool calls, 28 s, $0.080134): 'I bought the report for block 12076555 ... static-DAG builder ceiling is 18.09x against 19.28x for a validator with the BAL [E2][E3].' The first attempt ($0.177756, /tmp/analyst-live/q4-pay-first.sse) did not buy because of the trimming bug.",
  "Hedera tx 0.0.9185802@1793973360.446037453: mirror node result SUCCESS, CRYPTOTRANSFER, consensus 1793973367.395153931, 1,000,000 tinybar from 0.0.11338137 to 0.0.11337330 (fee 291,026 paid by 0.0.9185802). https://hashscan.io/testnet/transaction/0.0.9185802@1793973360.446037453 . runs.jsonl report_sha256 86d4c724f2459c9311cc61100a3d0e0a0a321744192a7ff8050fda322e19f844",
  "Auto-briefs (npm run briefs, 620 s against 8098; log /tmp/analyst-live/briefs.log): 6 briefs stored (GET /api/v1/analyst/briefs) for blocks 12077001, 12076999, 12076997, 12076995, 12076993 and 12076992, all gas_misleads, $0.0227-$0.0384 each. Example: 'Gas points to the wrong bottleneck in block 12076992: tx 22 caps the gas-weighted ceiling at 3.54x, but measured time puts tx 19 as the limit, at 18.641x [E1].' HCS topic 0.0.11338138 messages seq 4-9; mirror node seq 9 = {block_hash 0xeb9f9edc..., brief_sha256 4b7f143a...}",
  "Total Claude spend on the ledger (.tools/analyst/usage.jsonl): $1.074 = investigate $0.906 (including the re-runs, a $0.0585 browser run and a $0.0086 concurrency check) + briefs $0.168. The step-4 questions cost $0.59.",
  "Screenshots: /tmp/analyst-live/analyst-answer-1440.png (real finished Q1 in the browser: trace, thinking line, cited answer, cost footer, briefs column), /tmp/analyst-live/analyst-briefs-1440.png (briefs feed with 6 real briefs), /tmp/analyst-live/analyst-drawer-1440.png (evidence drawer for E2 with link and sha256)"
 ],
 "contract_deviations": [
  "node_read's eth_getBlockByNumber also accepts decimal block numbers and converts them to hex in the executor, because Claude's own hex conversion read the wrong block in a live run.",
  "recent_blocks is trimmed to {columns, rows} (one array per block) with a 12 KB cap (2x CAP) instead of ~6 KB, so all 50 blocks survive; as keyed objects only 15 did.",
  "No --block one-shot flag was added to scripts/briefs.ts: live blocks tripped gas_misleads, so the loop stored briefs without it.",
  "The hosted + paid payment run used next dev, not next build + start as e2e.sh does. The environment was the same: ROOTED_X402_ENABLED=true, pay-to from .env.local, the x402.org facilitator, plus ROOTED_PUBLIC_URL for agent.mjs.",
  "5 commits: briefs store (Go), agent core, view, auto-briefs, docs. The core commit staged a package.json without the 'briefs' script line, which arrives with scripts/briefs.ts in the auto-briefs commit.",
  "After the Q2 re-run its opening line still had no citation. I then added 'cited like everything else' to the answer format but did not re-run Q2, because its one re-run was used. The later browser Q1 run had a cited opening line."
 ],
 "open_issues": [
  "gas_misleads fires on almost every live block: under EIP-8037 the receipt-gas ceiling is below half the validator ceiling. The 6-per-hour cap therefore went to the first 6 blocks in about 2 minutes, all gas_misleads. A rarer builder_gap or commitment block later in the hour gets no brief. Consider ranking rarer triggers first. I did not change the spec's rules.",
  "With ROOTED_ANALYST_PUBLIC=true in hosted mode, the actions stay on and get_block_xray answers from the trimmed report that hosted mode otherwise sells. This is documented in docs/ANALYST.md as demo-only, not a public deployment.",
  "scripts/briefs.ts stores the model as the constant claude-opus-5-5 even if a fallback model answered. Cost counts only the attempt that served the answer, at Opus 5.5 rates.",
  "A citation in the opening line is a prompt rule, not enforced: the brief for block 12,076,993 has an uncited headline.",
  "The Go store's Check does not validate the shape of each brief's evidence items. The UI drops malformed items.",
  "The first Q1 transcript (the wrong-block run) was overwritten by the re-run. The first Q2 and payment transcripts are kept as q2-first.sse and q4-pay-first.sse."
 ]
}
