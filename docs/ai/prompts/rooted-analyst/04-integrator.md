# integrator (Integrate phase)

Task prompt given to one Claude Code agent by the `rooted-analyst` workflow script on 2026-11-06T13:46:12.539Z (UTC), verbatim except infrastructure details, which are replaced with `<placeholders>`.

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

You are the INTEGRATOR. B1 (core), B2 (UI) and B3 (briefs/backend) just finished in this worktree without committing. Their reports:
[
 {
  "agent": "B1-core",
  "summary": "The analyst core is built and tests pass: `npx tsc --noEmit -p .` is clean, `npm test` passes 102 of 102, `next build` succeeds, and one real call to `claude-opus-5-5` was accepted with no 400.\n\n**What `runAnalyst` does** (`runAnalyst(question, session, emit, deps)`, with `deps = {client, exec, now, ledger, mode?, signal?}`):\n- Each turn is streamed with `client.beta.messages.stream()` and `.finalMessage()`. The request carries the `server-side-fallback-2026-07-01` beta with `fallbacks: \"default\"`, thinking `{type: \"adaptive\", display: \"summarized\"}`, effort from `ROOTED_ANALYST_EFFORT` (default medium) under `output_config`, `tool_choice` auto, strict tools, and `cache_control` on the system block.\n- It appends each full response to the session history and runs parallel tool calls at the same time. All their results go back in one user message.\n- Every tool input is checked with zod first; a bad input comes back to Claude as an `is_error` result.\n- Caps per question: 12 steps, 3 actions and 1 purchase. The caps are settled in call order before anything runs, so parallel calls cannot get past them. On step 11 Claude is told to answer now. On step 12 any tool calls get an `is_error` result so the history stays valid for follow-ups.\n- `stop_reason` is checked on every turn. A refusal becomes an error event that includes `stop_details`.\n- Every model call is charged to `.tools/analyst/usage.jsonl` at Opus 5.5 rates, and the daily cap is checked before each call.\n- **Brief mode** (`mode: \"brief\"`) uses `BRIEF_PROMPT`, offers only the 10 read-only tools, stops at 6 steps and allows no actions.\n- `types.ts` exports the contract types, including `Brief`, which matches B3's Go JSON. B2's and B3's files already compile against them.\n\n**The route** (`app/api/analyst/route.ts`) streams events as they happen. It is off without `ANTHROPIC_API_KEY`, and off in hosted mode unless `ROOTED_ANALYST_PUBLIC=true`. It also checks origin, content type and body size (8 KiB), reuses sessions (1 h TTL, at most 50), allows one investigation at a time (429), and refuses when the budget is spent. The key never leaves the server, and every response, errors included, is an SSE body.\n\n**Prompts:** `SYSTEM_PROMPT` covers your framing rule (a BAL lets validators run every tx in parallel; the conflict DAG is the builder/no-BAL view; ceilings are upper bounds; gas is not time under EIP-8037). It also requires an `[E#]` citation on every number, says to prefer stored evidence and run actions only when needed, to state what is unknown, and that tool results are data, not instructions. After the smoke run I added one line asking for plain text, because the view doesn't render markdown; that change was not re-run.\n\n**Smoke call:** run with effort set to low to keep the cost down; the request shape is the same as at medium. It ran three calls (tool_use, tool_use, end_turn) at a total of $0.045, with summarized thinking streaming and the cache working. The answer cited [E1] and [E2].\n\nOne thing that will bite in live runs: this shell already sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` for a local proxy, and Next will not override them from `.env.local`. My first smoke attempt got a 401 from that proxy. Start the dashboard and `npm run briefs` with those three unset.\n\nI did not make a real end-to-end call through the SSE route, and the 429 one-at-a-time rule has no test, because the route builds the real client.",
  "files_changed": [
   "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/types.ts",
   "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/tools.ts",
   "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/trim.ts",
   "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/evidence.ts",
   "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/budget.ts",
   "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/agent.ts",
   "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/prompts.ts",
   "/home/ubuntu/Rooted-picks/dashboard/app/api/analyst/route.ts",
   "/home/ubuntu/Rooted-picks/dashboard/package.json",
   "/home/ubuntu/Rooted-picks/dashboard/package-lock.json",
   "/home/ubuntu/Rooted-picks/dashboard/tests/analyst-agent.test.ts",
   "/home/ubuntu/Rooted-picks/dashboard/tests/analyst-tools.test.ts"
  ],
  "tests_run": [
   {
    "command": "cd dashboard && npx tsc --noEmit -p .",
    "result": "clean (includes the other agents' files that import lib/analyst/types and agent)"
   },
   {
    "command": "cd dashboard && npm test",
    "result": "102/102 pass; my 15 analyst tests cover schema validation, deterministic trimming under 6 KB on the real 159-tx report, evidence ids/links/sha256, citation parsing, budget math, the ledger and the cap, step/action/purchase caps, payments-off, refusal/fallback/upstream errors, brief mode, SSE encoding, sessions, executor URLs, and route disabled/hosted/origin/body checks"
   },
   {
    "command": "cd dashboard && env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN npx next build",
    "result": "compiled; /api/analyst built as a dynamic route; a Turbopack tracing warning on the ledger readFile was fixed with a turbopackIgnore comment; next-env.d.ts and tsconfig.tsbuildinfo (build side effects) restored to HEAD"
   },
   {
    "command": "real smoke: runAnalyst with the real client and fake recent_blocks/get_block_xray executors, ROOTED_ANALYST_EFFORT=low, ambient ANTHROPIC_* vars unset, key loaded from ../.env and never printed",
    "result": "3 calls; stop_reason tool_use, tool_use, end_turn; no 400; done event with [E1][E2] citations; total $0.045302"
   }
  ],
  "live_evidence": [
   "Call 1: model claude-opus-5-5, stop_reason tool_use, stop_details null, usage input 4 / output 51 / cache_read 0 / cache_write 3647, usage.iterations [\"message\"], blocks [tool_use] (recent_blocks {limit:1})",
   "Call 2: stop_reason tool_use, usage input 2 / output 99 / cache_read 3647 / cache_write 257, blocks [tool_use] (get_block_xray for 0x48cf69b2...75c0)",
   "Call 3: stop_reason end_turn, usage input 2 / output 427 / cache_read 3904 / cache_write 2540, blocks [thinking, text]",
   "Events: 13 thinking deltas (151 chars of summarized thinking), 2 step, 2 step_done (E1, E2), 73 text deltas, 1 done; done.usage {input 8, output 577, cache_read 7551, cache_write 6444, usd 0.045302}",
   "The answer stated the validator-with-BAL ceiling of about 20.7x, capped by tx index 85, and noted that gas picks tx 1 as the bottleneck while time picks tx 85, citing [E1][E2]",
   "The request shape was accepted with the server-side-fallback-2026-07-01 beta, fallbacks \"default\", adaptive/summarized thinking, output_config.effort, strict tools, and both system-block and top-level cache_control",
   "The first attempt returned 401 {\"error\":\"Invalid API key\"} from the ambient ANTHROPIC_BASE_URL proxy (<proxy-url>), not from the Anthropic API"
  ],
  "contract_deviations": [
   "Thinking events carry summarized-thinking deltas (stream.on(\"thinking\")), not whole blocks. B2's ui-state reducer already appends them.",
   "Every route response is SSE, pre-stream errors included, sent with HTTP 503/403/415/413/400/429. The one-at-a-time 429 uses code \"bad_request\" because the contract's error union has no busy code.",
   "Claude API errors, 400s included, map to code \"upstream\" with the SDK message; \"bad_request\" is kept for the browser's own request.",
   "done.evidence lists only the evidence cited in the answer (session-wide ids E1..En). All evidence still arrives through step_done.",
   "After a mid-output fallback, the declined model's thinking and tool_use blocks before the last fallback block are dropped from history and not run, as the API's fallback rules require. Otherwise the full response.content is appended.",
   "Strict tool schemas come from zod via the SDK's transformJSONSchema, which moves ranges, patterns and enums into the descriptions. zod enforces them before any executor runs.",
   "Top-level automatic cache_control is added alongside the breakpoint on the last system block, so the growing history is cached between steps.",
   "The frame-tx explorer link is unused: no tool returns a single frame tx, so frame evidence links to /?view=frames.",
   "epbs_slot, builders and alerts query network=sepolia and rely on the backend's default source and live mode (builders covers a 1 h window).",
   "Extra exports beyond the contract: AnalystDeps.mode/signal, sessionFor, newSession, sse, MODEL, and the Usage, ToolOutput and Executor types."
  ],
  "open_issues": [
   "Integrator: this shell sets ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY for a local proxy. Next and node --env-file do not override existing variables, so start next dev/start and npm run briefs with `env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY`, otherwise every call returns 401.",
   "Integrator: the dashboard loads only dashboard/.env.local, not the root .env. node_read's ROOTED_EXECUTION_URL falls back to publicnode unless set there or in the shell; ROOTED_ANALYST_EFFORT, _DAILY_USD, _PAYMENTS and _PUBLIC likewise. Document them in .env.example and docs/ANALYST.md.",
   "The ledger (.tools/analyst/usage.jsonl at the repo root) and the agent.mjs path for buy_xray_report resolve from process.cwd()/.., so the dashboard and briefs must run from dashboard/ (npm scripts do).",
   "B3: tsx runs these .ts files as CJS. Top-level await fails, which I hit in a smoke script, and import.meta.dirname is undefined. scripts/briefs.ts uses import.meta.url; it typechecks but I did not run it.",
   "Not tested: a real end-to-end SSE call through /api/analyst, and the 429 one-at-a-time rule (the route builds the real Anthropic client).",
   "Usage and cost count only the attempt that served the answer, at Opus 5.5 rates. Refused attempts and fallback-model rates in usage.iterations are not counted (marked with a shortcut: comment).",
   "With ROOTED_ANALYST_PUBLIC=true in hosted mode, the action tools stay on and get_block_xray returns trimmed full-report data that the hosted proxy otherwise sells over x402. Decide whether public hosted mode should run read-only.",
   "B2's lib/analyst/ui-state.ts has its own citations parser; lib/analyst/evidence.ts exports one that accepts both [E3] and [E3, E5] and could be shared."
  ]
 },
 {
  "agent": "B2-ui",
  "summary": "I built the Analyst view, ?view=analyst, as the contract's UI section describes, using only the existing ui.tsx primitives and no new libraries. Nothing is committed. Typecheck, all 87 tests and the production build pass. I checked the layout with headless chromium against `next dev` on port 3018 at 1440 and 390 px, then stopped the server. B1's `app/api/analyst/route.ts` did not exist yet when I finished, so the screenshots use a faked SSE stream and a faked briefs feed in the browser. The UI has not run against a real investigation.\n\n- **Left column, Ask:** a labelled question box (max 2000 characters; Enter asks, Shift+Enter adds a line) and the 4 suggested questions as buttons that ask in one click.\n  - The live trace is one row per tool call. Each row shows the tool name, its input on one shortened line, and a spinner that becomes a duration and an evidence chip. Action tools get an ACTION tag and `buy_xray_report` also gets PAYMENT. Failed steps show their note in red.\n  - Below the trace: the latest summarized thinking as a muted line of up to 2 lines, then the streamed answer in an `aria-live` region whose `[E3]` and `[E1, E2]` citations become chips. A footer shows cost and token counts (input, output, cache read, cache write) plus an \"All evidence\" button.\n- **Evidence drawer:** a modal side drawer that opens from any chip. It shows id, kind, label, link and sha256, and closes with Esc. Links show only if they are https or a same-site path.\n- **Right column, Briefs:** polls `GET /api/analyst/briefs` every 15 s. Each card shows the block number, its age, trigger badges, the first two lines of the brief with citation chips, a link to the X-ray and an evidence button. Loading, empty, error and \"showing last good data\" states each have a message.\n- **States:** disabled, budget, refusal, max_steps, upstream and bad_request each get a clear notice with a hint. A non-streamed reply such as a 429 becomes an error. If the stream ends before a `done` or `error` event, that shows as an upstream error. Earlier partial steps and answer text stay visible after an error.\n- **Sessions:** the `session_id` is sent with follow-ups, and a \"New session\" button clears it.\n- **Event handling:** all the logic that turns events into screen state is in `lib/analyst/ui-state.ts`. That includes the SSE parsing, error mapping, citation splitting and link checks. `tests/analyst-ui.test.ts` covers it with 11 tests.\n- **dashboard.tsx:** adds the \"Analyst\" nav item (after X-ray), the view type, the page title and subtitle, a \"CITED EVIDENCE\" header badge, and renders the view.\n- **globals.css:** a new `/* Analyst */` section, all classes prefixed `.analyst-`. It collapses to one column at 1100 px or narrower and tightens padding at 560 px or narrower.\n\nB1's `types.ts` appeared before I finished and matches the contract, so nothing needed changing. I did not read the Claude API docs because I wrote no Anthropic SDK code.\n\nNot checked: a real Claude stream through B1's route, and screen-reader behaviour beyond the roles and labels.",
  "files_changed": [
   "/home/ubuntu/Rooted-picks/dashboard/components/analyst.tsx",
   "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/ui-state.ts",
   "/home/ubuntu/Rooted-picks/dashboard/tests/analyst-ui.test.ts",
   "/home/ubuntu/Rooted-picks/dashboard/components/dashboard.tsx",
   "/home/ubuntu/Rooted-picks/dashboard/app/globals.css"
  ],
  "tests_run": [
   {
    "command": "cd dashboard && npx tsc --noEmit -p .",
    "result": "exit 0, no errors (with B1's real lib/analyst/types.ts)"
   },
   {
    "command": "cd dashboard && npm test",
    "result": "87 tests, 87 pass, 0 fail (11 of them in tests/analyst-ui.test.ts)"
   },
   {
    "command": "cd dashboard && npm run build",
    "result": "Compiled successfully, TypeScript passed, static pages generated"
   },
   {
    "command": "node /tmp/b2ui/shoot.mjs answer|disabled|empty (headless chromium 1243 vs next dev on :3018, faked /api/analyst SSE and /api/analyst/briefs)",
    "result": "Page loads with no page errors. Enter submits, the trace, answer chips and footer render, a chip opened with the keyboard shows the drawer and Esc closes it (0 dialogs left). Disabled and empty-briefs states render."
   }
  ],
  "live_evidence": [
   "Screenshots: /tmp/b2ui/analyst-answer-1440.png and /tmp/b2ui/analyst-answer-390.png (finished investigation: trace with ACTION/PAYMENT tags, a failed step, thinking line, answer with chips, cost and token footer, briefs feed)",
   "/tmp/b2ui/analyst-drawer-1440.png and /tmp/b2ui/analyst-drawer-390.png (evidence drawer for E3)",
   "/tmp/b2ui/analyst-disabled-1440.png and /tmp/b2ui/analyst-disabled-390.png (disabled error state)",
   "/tmp/b2ui/analyst-empty-1440.png and /tmp/b2ui/analyst-empty-390.png (start state with empty briefs feed)",
   "/tmp/b2ui/analyst-idle-1440.png and /tmp/b2ui/analyst-idle-390.png (start state with two brief cards)",
   "Real `GET /api/analyst/briefs` with ROOTED_BACKEND_URL unset returned 502 {\"error\":{\"message\":\"Rooted backend is unavailable...\"}}, which the feed shows as an error notice",
   "Dev server on port 3018 stopped (no listener or process left)"
  ],
  "contract_deviations": [
   "Additions the contract does not list: a \"New session\" button that clears the session_id, an \"All evidence (n)\" button in the footer, and the age of each brief card.",
   "Links in the drawer and the brief cards open in a new tab, so an investigation in progress is not lost.",
   "A non-streamed HTTP 429 (concurrent investigation) has no error code in the contract, so it is reported as code \"upstream\" with an \"Another investigation is running\" message. Other 4xx replies without a known code become \"bad_request\"."
  ],
  "open_issues": [
   "B1 (`app/api/analyst/route.ts`, not present when I finished): the UI reads the body as a stream only when Content-Type starts with `text/event-stream`. Any other reply is parsed as JSON in the form `{type:\"error\",code,message}` or `{error:{code,message}}`. The integrator should confirm the route follows this, including for disabled and 429 replies.",
   "B1 (`prompts.ts`): the answer is shown as plain text with line breaks kept, so markdown such as ** or # would appear raw. The system prompt should ask for plain prose with [E#] citations.",
   "B1: thinking events are treated as deltas (the comment in types.ts says so). Consecutive deltas are joined into one run, and a new run starts after a step or text event. If the agent sends whole thinking blocks instead, that still works.",
   "B3 (`internal/analyst/store.go` Check): the shape of each brief's evidence items is not validated. The UI drops malformed items, but rejecting them at POST would be cleaner.",
   "Integrator: `lib/analyst/evidence.ts` has a `citations()` that needs node:crypto, so it cannot be used in the browser. `ui-state.ts` has its own `citations()` splitter that uses the same regex but returns text and chip segments. The two share a name but do different jobs.",
   "The full-page 1440 screenshots show the dark sidebar ending at the viewport height. That is how the existing layout behaves on every view, not something this change introduced."
  ]
 },
 {
  "agent": "B3-briefs",
  "summary": "B3 is done: the auto-brief rules and generator, plus the backend that stores briefs, are built and their tests pass. Nothing is committed. One thing is missing before it works end to end: `cmd/rooted/main.go` still has to pass the new store to the API server (see open_issues). Until then the brief routes return 503.\n\n**Backend**\n- `migrations/009_analyst_briefs.sql` adds the `analyst_briefs` table, keyed on (network, block_hash).\n- `internal/analyst/store.go` follows the xray store pattern. It has `Check` (validation) and `Save`, which upserts and stamps `created_at` from the DB, plus `List` (newest `created_at` first).\n- `internal/api/analyst.go` adds `GET` and `POST /api/v1/analyst/briefs?network=sepolia`.\n  - Both require network=sepolia; the store being unset gives 503. `limit` is 1..100, default 20.\n  - POST checks the content type is `application/json` (415 otherwise). Bodies over 64 KiB get 413.\n  - Bad JSON, unknown fields, trailing data or failed validation get 400. Validation covers: network, a 0x + 64-hex hash (lowercased), a positive block number, 1–4 unique triggers from the fixed list, a brief of 1–8000 characters, a model of 1–100 characters, and usd ≥ 0.\n  - It upserts and returns 200 with the stored row.\n- `internal/api/server.go` gets an `Analyst *analyst.Store` field and the two route lines.\n- `docs/API.md` has a new \"Analyst briefs\" section, and the migration count in `internal/storage/postgres_test.go` is now 8.\n\n**Dashboard**\n- `lib/analyst/rules.ts`:\n  - `triggers()` implements the four rules from the spec. A missing value never fires a rule.\n  - `nextBlock()` picks the newest block that fired a rule and has no brief yet, and returns nothing once the hourly cap is used. The cap counts distinct blocks briefed or tried in the last hour.\n- `app/api/analyst/briefs/route.ts` forwards GET to the backend with network fixed to sepolia and `limit` escaped, so a caller can't sneak in extra query parameters.\n- `lib/proxy.ts` now allows `api/v1/analyst/briefs`.\n- `scripts/briefs.ts`, run with `npm run briefs` (loads `.env.local` if present):\n  - Every 12 s it reads the X-ray block list and the stored briefs, then picks a block with `nextBlock`.\n  - It calls B1's `runAnalyst` in brief mode, sharing the daily spend ledger with the dashboard, and POSTs the result.\n  - If the x402 agent's HCS settings are present, it appends `{block_hash, brief_sha256}` to the HCS topic using the agent's own Hedera SDK and key. If they are absent it skips this quietly.\n  - A block that fails is not retried by the same process. A bad `ROOTED_BRIEFS_PER_HOUR` value falls back to 6, so a typo can't remove the cap.\n\nI ran the script once against a stub backend with a $0 daily budget, so no model call was made. It picked the right block, skipped the one already briefed, stopped at the budget check, and did not retry on later ticks. I have not made a real model call or written to HCS. Those are covered by the integrator's live run 5.",
  "files_changed": [
   "/home/ubuntu/Rooted-picks/migrations/009_analyst_briefs.sql",
   "/home/ubuntu/Rooted-picks/internal/analyst/store.go",
   "/home/ubuntu/Rooted-picks/internal/analyst/store_test.go",
   "/home/ubuntu/Rooted-picks/internal/api/analyst.go",
   "/home/ubuntu/Rooted-picks/internal/api/analyst_test.go",
   "/home/ubuntu/Rooted-picks/internal/api/server.go",
   "/home/ubuntu/Rooted-picks/internal/storage/postgres_test.go",
   "/home/ubuntu/Rooted-picks/docs/API.md",
   "/home/ubuntu/Rooted-picks/dashboard/lib/analyst/rules.ts",
   "/home/ubuntu/Rooted-picks/dashboard/tests/analyst-rules.test.ts",
   "/home/ubuntu/Rooted-picks/dashboard/app/api/analyst/briefs/route.ts",
   "/home/ubuntu/Rooted-picks/dashboard/lib/proxy.ts",
   "/home/ubuntu/Rooted-picks/dashboard/scripts/briefs.ts",
   "/home/ubuntu/Rooted-picks/dashboard/package.json (scripts.briefs only)"
  ],
  "tests_run": [
   {
    "command": "go vet ./...",
    "result": "clean"
   },
   {
    "command": "go test -count=1 ./...",
    "result": "all packages ok"
   },
   {
    "command": "TEST_DATABASE_URL=postgres://rooted:***@127.0.0.1:54330/rooted_b3test go test -count=1 ./internal/storage ./internal/analyst ./internal/api",
    "result": "ok. -v confirmed these ran rather than skipped: TestPostgresPersistence (count 8), TestCheck, TestStoreUpsertAndList, TestAnalystBriefScope, TestAnalystBriefRoutes (400/413/415/200, upsert, newest-first list)"
   },
   {
    "command": "cd dashboard && npm test",
    "result": "102 pass, 0 fail (includes 6 analyst-rules tests)"
   },
   {
    "command": "cd dashboard && npx tsc --noEmit -p .",
    "result": "no errors in my files. 3 TS2352 errors, all in B1's tests/analyst-agent.test.ts (lines 76, 136, 178)"
   },
   {
    "command": "env -u ANTHROPIC_API_KEY node --import tsx scripts/briefs.ts",
    "result": "exits 2 with a clear 'auto-briefs are off' message"
   },
   {
    "command": "ROOTED_ANALYST_DAILY_USD=0 ROOTED_BACKEND_URL=<stub :18097> ANTHROPIC_API_KEY=dummy timeout 30 node --import tsx scripts/briefs.ts",
    "result": "chose block 8 (big_block) over the quiet block 9 and the already-briefed block 7; stopped at the budget check with no model call; not retried on the next 2 ticks; no ledger file written"
   }
  ],
  "open_issues": [
   "Integrator wiring is required: cmd/rooted/main.go must set `Analyst: &analyst.Store{Pool: repo.Pool}` in the api.Server literal (around line 339) and import rooted/internal/analyst. Until then both brief routes return 503.",
   "B1: tests/analyst-agent.test.ts fails tsc with TS2352 at lines 76, 136 and 178 (casting message content to Block[] needs `as unknown as`). npm test still passes because tsx does not type-check.",
   "Integrator: consider adding ROOTED_BRIEFS_PER_HOUR (default 6) and ROOTED_AGENT_HCS_TOPIC (read from integrations/x402-agent/.env) to .env.example and docs/ANALYST.md.",
   "dashboard/tsconfig.tsbuildinfo and next-env.d.ts show as modified only because tsc/next typegen ran; they are not real changes, so leave them out of the commit.",
   "The script stores the model name as the constant MODEL (claude-opus-5-5) even if a fallback model actually answered, because the done event does not carry the serving model.",
   "Not checked live: a real model call through runAnalyst in brief mode, and an actual HCS append (I did not want to write test messages to the real audit topic). Both are covered by the integrator's live run 5.",
   "The test database rooted_b3test was left on 54330 for reuse; drop it when no longer needed."
  ],
  "contract_deviations": [
   "POST /api/v1/analyst/briefs also returns 415 for a non-JSON Content-Type, like providers.go does. This makes a browser on another site send a preflight request, which the backend never approves, so it cannot post briefs to the localhost backend.",
   "The network comes from the required ?network=sepolia query parameter, as in the X-ray routes. A body may include network, but anything other than sepolia gets 400. created_at is always set by the database.",
   "The stored brief text is cut to 8000 characters before the POST, so an over-long answer is still stored instead of being rejected after the spend.",
   "The hourly cap counts stored briefs created in the last hour (from the backend) plus this process's attempts, so it holds across restarts instead of resetting."
  ]
 }
]

Do, in order:
1. Reconcile interfaces (types, imports, package.json, proxy allowlist, server.go routes) so everything compiles. Fix what the builders listed in open_issues.
2. Full verification: go build/vet/test ./... (with TEST_DATABASE_URL on a fresh 54330 database), (cd workloads/profiler && go test .), cd dashboard && npx tsc --noEmit -p . && npm test && npm run build, (cd integrations/x402-agent && npm test).
3. Live stack on NON-default ports: create database rooted_p6 on 54330 as a copy of rooted_p4 (CREATE DATABASE rooted_p6 TEMPLATE rooted_p4, it holds stored X-rays incl. blocks 12,076,467 and 12,076,476 and frame data; if the template copy fails, migrate a fresh DB and let the follower fill it). Build .tools/rooted and .tools/rooted-replay, run "rooted serve" on 127.0.0.1:8098 with ROOTED_XRAY_FOLLOW=true and the watch worker, DATABASE_URL pointing at rooted_p6, and "next dev" on port 3008 with ROOTED_BACKEND_URL=http://127.0.0.1:8098.
4. Live investigations with the real key via curl -N against http://127.0.0.1:3008/api/analyst, saving full SSE transcripts to /tmp/analyst-live/q{1..3}.sse: (1) "Why does the builder lose parallelism in block 12,076,467?" (2) "Is ePBS delivering payloads on time over the last 20 slots?" (3) "Find Uniswap contention in recent blocks and explain it." Check that every number in each answer has a citation and that citations resolve to evidence. Fix real problems you see (bad tool output trimming, wrong links, prompts) and re-run at most once per question. Keep total Claude spend for this step under ~$4 (read usage.usd from the done events).
5. Payment run: restart the dashboard on 3008 in hosted+paid mode the way integrations/x402-agent/e2e.sh configures it (ROOTED_X402_ENABLED=true, pay-to from dashboard/.env.local, facilitator x402.org) plus ROOTED_ANALYST_PUBLIC=true and ROOTED_ANALYST_PAYMENTS=true, point the x402 agent at that dashboard as e2e.sh does, and ask: "Buy the full report for the newest block with a builder gap and summarise it." It must settle on Hedera testnet: verify the tx on https://testnet.mirrornode.hedera.com (result SUCCESS) and record tx id + HashScan link.
6. Auto-briefs: run "npm run briefs" (with .env loaded) for ~10 minutes against the 8098 backend; at least one brief must be stored (GET /api/v1/analyst/briefs). If no live block triggers, lower nothing: instead run the generator once against a stored triggering block (e.g. 12,076,467) via a documented one-shot flag you add (--block 0xHASH).
7. Screenshots with headless chromium of http://127.0.0.1:3008/?view=analyst after a finished investigation (1440 px) and of the briefs feed; save under /tmp/analyst-live/.
8. Docs: docs/ANALYST.md (what it is, tools table, guardrails, env vars, cost, how to run briefs, live examples with block numbers and the settled Hedera tx), .env.example entries (no secrets), and a SHORT section in README.md under "The X-ray" or before "Partner prizes" (keep the README minimal; 4-8 lines + link), plus the Hedera prize section bullet: "Claude pays too" with the settled tx link. Add the analyst to docs/ai/README.md only as one line saying the analyst build prompts are in prompts/rooted-analyst/ (do not create that folder; the orchestrator will).
9. Commit in 3-6 logical one-line signed commits (e.g. "feat: analyst agent core", "feat: analyst view", "feat: auto-briefs", "docs: analyst"). Verify git log --format='%G? %s' shows G and no bodies.
10. Stop every process you started (backend, next dev, briefs loop). Leave rooted_p6 in place.
Report live_evidence with the three answers' first lines + cost, the Hedera tx, the brief(s) stored, and screenshot paths.
