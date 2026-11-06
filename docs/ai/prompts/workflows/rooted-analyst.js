export const meta = {
  name: 'rooted-analyst',
  description: 'Build the Rooted Analyst agent and auto-briefs in parallel, integrate with live runs, review and fix',
  phases: [
    { title: 'Build', detail: 'B1 core, B2 UI, B3 briefs in parallel' },
    { title: 'Integrate', detail: 'wire, live runs, docs, signed commits' },
    { title: 'Review', detail: 'correctness/safety and demo readiness' },
    { title: 'Fix', detail: 'address blocker and major findings' },
  ],
}

const SPEC = '/home/ubuntu/Rooted-picks/docs/superpowers/specs/2026-11-06-rooted-analyst-design.md'
const SKILL = '/tmp/claude-1000/bundled-skills/2.1.310/07ea3d3533816d5037b2a5e731934787/claude-api'
const COMMON = `
You are working in the git worktree /home/ubuntu/Rooted-picks (branch "analyst") of Rooted: a Go + Postgres + Next.js observability stack for Ethereum Sepolia Glamsterdam (ePBS, EIP-7928 BALs, frame-tx alt mempool, native replay "X-ray", x402 payments on Hedera). Read the contract first: ${SPEC}. It is authoritative; if you must deviate, say so in contract_deviations.

Environment facts:
- Go is at ~/sdk/go/bin/go (not on PATH): export PATH=$PATH:$HOME/sdk/go/bin:$HOME/.foundry/bin. Node 24, psql, headless chromium in ~/.cache/ms-playwright.
- Postgres for Rooted is 127.0.0.1:54330 (user rooted / pw rooted-local-only). NEVER use port 54329 (another project's DB). Create your own databases on 54330 when you need one.
- The Sepolia node is reachable through SSH tunnels: Geth http://127.0.0.1:18545, Nimbus http://127.0.0.1:15052 (state window ~128 blocks).
- ANTHROPIC_API_KEY is in the gitignored files /home/ubuntu/Rooted-picks/.env and dashboard/.env.local. Never print, log, echo or commit it or any other key (also never commit integrations/x402-agent/.env). Load with: set -a; . ./.env; set +a.
- Do NOT touch /home/ubuntu/Rooted (main checkout) or /home/ubuntu/Rooted-site. Do not push anything.
- Claude API reference (official, current): read ${SKILL}/typescript/claude-api/README.md, ${SKILL}/typescript/claude-api/tool-use.md, ${SKILL}/typescript/claude-api/streaming.md and ${SKILL}/shared/tool-use-concepts.md before writing any Anthropic SDK code. Model claude-opus-5-5, adaptive thinking display summarized, explicit output_config.effort, no budget_tokens, no forced tool_choice, server-side fallbacks ("server-side-fallback-2026-07-01" beta + fallbacks: "default"), check stop_reason (refusal -> stop_details), append full response.content each turn, all parallel tool_results in one user message. Never guess SDK names: if a binding is not in those docs, check node_modules/@anthropic-ai/sdk typings.
- Match the surrounding code style and comment density. Smallest complete change; no speculative abstraction. New non-trivial logic gets a focused test.
- Commit style (only agents told to commit may commit): one-line conventional message like "feat: analyst agent core", no body, no Co-Authored-By or any trailer. Commits are SSH-signed automatically by git config.
`

const RESULT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    tests_run: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, result: { type: 'string' } }, required: ['command', 'result'] } },
    live_evidence: { type: 'array', items: { type: 'string' } },
    contract_deviations: { type: 'array', items: { type: 'string' } },
    open_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'files_changed', 'tests_run', 'open_issues'],
}

const FINDINGS = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      location: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' } },
      required: ['severity', 'location', 'issue', 'fix'] } },
  },
  required: ['verdict', 'findings'],
}

const NO_COMMIT = 'Do NOT git commit (other agents work in the same worktree concurrently; the integrator commits). Only edit files you own per the build plan table; if you need a change in a file someone else owns, list it under open_issues.'

phase('Build')
const builders = [
  { key: 'B1-core', prompt: `You are B1 (core). ${NO_COMMIT}
Own: dashboard/lib/analyst/{types,tools,trim,evidence,budget,agent,prompts}.ts, dashboard/app/api/analyst/route.ts, dashboard/package.json + lockfile (add @anthropic-ai/sdk and zod with npm install in dashboard/), and unit tests under dashboard/tests/analyst-*.test.ts (node:test via tsx, the repo's existing "npm test" pattern; fake Anthropic client + fake executors, no network).
Export runAnalyst(question, session, emit, deps) with the brief mode the briefs generator needs (BRIEF_PROMPT, read-only tools, 6 steps, no actions) exactly as the contract describes, and export the contract types from types.ts so B2 and B3 can import them. Reuse dashboard/lib/proxy.ts backendURL and the existing route patterns in dashboard/app/api/xray/route.ts (origin/health handling, timeouts). For buy_xray_report reuse the execFile approach of integrations/x402-agent/mcp.mjs. The SSE route must stream events as they happen, enforce disabled/hosted-mode/budget/one-concurrent rules, and never expose the key.
Prompts: write SYSTEM_PROMPT as an expert Glamsterdam investigator: framing rule (with a BAL validators can run every tx in parallel; the conflict DAG is the builder/no-BAL view; all ceilings are upper bounds; gas is not time under EIP-8037), cite every number with [E#], prefer stored evidence, run actions only when needed, say what is unknown. Keep it concise and calm (Opus 5.5 over-follows emphatic prompts).
Verify: cd dashboard && npx tsc --noEmit -p . && npm test. Then one REAL smoke call with the real key (cost < $0.10): a tiny question with a fake executor set, to prove the streaming/thinking/fallback request shape is accepted by the API (report stop_reason, usage, any 400 message).` },
  { key: 'B2-ui', prompt: `You are B2 (UI). ${NO_COMMIT}
Own: dashboard/components/analyst.tsx, the "Analyst" nav item + ?view=analyst wiring in dashboard/components/dashboard.tsx (follow how the xray view is wired: nav items, view param, header text), styles in dashboard/app/globals.css (append a scoped section), and dashboard/tests/analyst-ui.test.ts for the pure event-reducer (events -> UI state) you write in dashboard/lib/analyst/ui-state.ts (you own that file).
Build exactly the UI section of the contract with the dashboard's existing look and ui.tsx primitives (no new UI libraries): question box + 4 suggested questions (use: "Why does the builder lose parallelism in block 12,076,467?", "Is ePBS delivering payloads on time over the last 20 slots?", "Find Uniswap contention in recent blocks and explain it.", "Which recent block shows the biggest gap between gas and measured time?"), live trace rows (tool, input, spinner -> ms + evidence chip; ACTION / PAYMENT tags), muted summarized-thinking line, streamed answer with [E#] citation chips opening an evidence drawer (kind, label, link, sha256), usage/cost footer, and the right-hand Briefs feed polling GET /api/analyst/briefs every 15 s (cards: block number, trigger badges, first two lines, links). Clear states for disabled / budget / refusal / max_steps / upstream errors. Accessible: labelled controls, keyboard operable, aria-live for the streamed answer.
Import the AnalystEvent/Evidence/Brief types from dashboard/lib/analyst/types.ts (B1 writes it from the contract; if it does not exist yet when you start, write against the contract and reconcile at the end). Consume the SSE from POST /api/analyst with fetch + ReadableStream parsing (no EventSource, it cannot POST).
Verify: cd dashboard && npx tsc --noEmit -p . && npm test && npm run build. Then screenshot ?view=analyst with headless chromium against "next dev" on port 3018 (ROOTED_BACKEND_URL unset is fine) to check layout at 1440 and 390 px; stop the dev server afterwards. Report the screenshot paths.` },
  { key: 'B3-briefs', prompt: `You are B3 (auto-briefs + backend). ${NO_COMMIT}
Own: dashboard/lib/analyst/rules.ts + dashboard/tests/analyst-rules.test.ts, dashboard/scripts/briefs.ts (+ "briefs" script in dashboard/package.json: coordinate by editing only the scripts entry; B1 edits dependencies), dashboard/app/api/analyst/briefs/route.ts, the proxy allowlist in dashboard/lib/proxy.ts (add api/v1/analyst/briefs), migrations/009_analyst_briefs.sql, internal/analyst/{store.go,store_test.go}, internal/api/analyst.go (+ internal/api/analyst_test.go) and the route registration lines in internal/api/server.go, docs/API.md entries, and internal/storage/postgres_test.go migration count 7 -> 8.
Follow the existing Go patterns exactly (look at internal/xray/store.go, internal/api/xray.go and their tests, migrations/008_xray.sql, how the Store is constructed in cmd/rooted/main.go and passed to the API server). POST validates network, 0x+64-hex hash, triggers from the fixed vocabulary, brief non-empty <= 8000 chars, body <= 64 KB (413), upsert on (network, block_hash). GET newest first with limit 1..100.
scripts/briefs.ts imports runAnalyst and types from dashboard/lib/analyst (B1 writes them per the contract; write against the contract signature) and implements the loop, per-hour cap, shared budget ledger, skip already-briefed hashes, optional HCS append (reuse the HCS approach in integrations/x402-agent if its env is present; otherwise skip cleanly).
Verify: go vet ./... && go test ./... and TEST_DATABASE_URL against a fresh database you create on 54330 (e.g. rooted_b3test) for internal/storage internal/analyst internal/api; cd dashboard && npx tsc --noEmit -p . && npm test (your rules tests).` },
]
const built = await parallel(builders.map(b => () => agent(COMMON + '\n' + b.prompt, { label: b.key, phase: 'Build', schema: RESULT })))

phase('Integrate')
const integrated = await agent(COMMON + `
You are the INTEGRATOR. B1 (core), B2 (UI) and B3 (briefs/backend) just finished in this worktree without committing. Their reports:
${JSON.stringify(built.map((r, i) => ({ agent: builders[i].key, ...(r || { summary: 'AGENT FAILED - no result' }) })), null, 1)}

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
Report live_evidence with the three answers' first lines + cost, the Hedera tx, the brief(s) stored, and screenshot paths.`, { label: 'integrator', phase: 'Integrate', schema: RESULT })

phase('Review')
const lenses = [
  { key: 'review-correctness-safety', prompt: `Review lens: correctness, Claude API usage and safety. Read the diff "git log -p a52f78a..HEAD" and the connected code. Check against the contract and the claude-api reference: request shape (model, adaptive thinking, effort, fallbacks beta, cache_control placement and prefix stability, append-only history incl. thinking blocks, parallel tool_results in one message, stop_reason/refusal handling), tool input validation at the trust boundary, step/action/payment caps actually enforced, budget ledger math (Opus 5.5 prices) and fail-closed behaviour, hosted-mode disable, key never reachable by the browser or logs (grep the built .next output and any logs for the key prefix sk-ant without printing the key), prompt injection blast radius, SSE route robustness (client abort cancels the loop, concurrency guard released on error), Go briefs store/handlers validation, and that tests would catch regressions. Run the test suites. Do not change code.` },
  { key: 'review-demo-readiness', prompt: `Review lens: demo readiness and answer quality. Read /tmp/analyst-live/* transcripts and screenshots, docs/ANALYST.md and the README section. Start the stack yourself on ports 8099 (backend, DATABASE_URL rooted_p6 on 54330) and 3009 (next dev) and ask ONE new question that a protocol judge would ask (e.g. "Compare the last 30 blocks: how often does gas pick the wrong bottleneck, and show the worst block"), keeping spend under $1. Judge: are answers correct versus the stored data (spot-check 3 cited numbers against the backend JSON yourself), are citations complete and links working, is latency acceptable (<90 s), does the UI look polished at 1440 and 390 px (take screenshots), are error states clear, does anything look broken or misleading on camera, is the README/docs claim set accurate. Stop your processes. Do not change code.` },
]
const reviews = await parallel(lenses.map(l => () => agent(COMMON + '\n' + l.prompt + `\nIntegrator report for context:\n${JSON.stringify(integrated, null, 1)}`, { label: l.key, phase: 'Review', schema: FINDINGS })))

phase('Fix')
const toFix = reviews.filter(Boolean).flatMap((r, i) => r.findings.filter(f => f.severity !== 'minor').map(f => ({ lens: lenses[i].key, ...f })))
const minors = reviews.filter(Boolean).flatMap(r => r.findings.filter(f => f.severity === 'minor'))
log(`${toFix.length} blocker/major findings, ${minors.length} minor`)
const fixed = await agent(COMMON + `
You are the FIX agent. Address every blocker and major finding below, and any minor one that is a one-line fix. For each, either fix it (with a test when it is logic) or explain in open_issues why not. Re-run all suites (Go with TEST_DATABASE_URL on a fresh 54330 DB, dashboard tsc/test/build, x402-agent tests). If a fix changes answer behaviour, re-run ONE live question on ports 8097/3017 (rooted_p6) to confirm (spend < $1), then stop your processes. Update docs if claims changed. Commit with one-line signed conventional messages (no body, no trailers) and verify %G? = G.

Blocker/major findings:
${JSON.stringify(toFix, null, 1)}

Minor findings:
${JSON.stringify(minors, null, 1)}`, { label: 'fix', phase: 'Fix', schema: RESULT })

return { built, integrated, reviews, fixed }
