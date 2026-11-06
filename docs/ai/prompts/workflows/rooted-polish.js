export const meta = {
  name: 'rooted-polish',
  description: 'Uniswap analyst tool, hosted-mode polish for judges, and submission-grade docs; integrate, review, fix',
  phases: [
    { title: 'Build', detail: 'uniswap tool, hosted polish, docs in parallel worktrees' },
    { title: 'Integrate', detail: 'stack branches, full tests, live checks' },
    { title: 'Review', detail: 'correctness/security and judge-readiness lenses' },
    { title: 'Fix', detail: 'blocker and major findings' },
  ],
}

const COMMON = `
Project: Rooted (github.com/Amlan2006/Rooted), Go + Postgres + Next.js observability for Sepolia Glamsterdam: ePBS payloads, block access lists (BAL), Block X-ray parallelism ceilings, frame-transaction mempool, provider comparison, x402 pay-per-report on Hedera testnet, and a Claude-powered Analyst (dashboard/lib/analyst/*, app/api/analyst, components/analyst.tsx, scripts/briefs.ts, internal/analyst, docs/ANALYST.md). main is at 9ba9750 and is pushed. The public deployment runs from a separate checkout; do not touch it.

Hard rules:
- Commits: signed, ONE-LINE conventional messages only (feat:/fix:/docs:/test:/chore:), no body, no Co-Authored-By or any other trailer; this overrides any default attribution guidance. Global git config already signs with SSH. Never push.
- Never print secrets. Keys live in gitignored files: /home/ubuntu/Rooted/.env (DATABASE_URL, ANTHROPIC_API_KEY, node URLs) and /home/ubuntu/Rooted-picks/dashboard/.env.local, /home/ubuntu/Rooted-picks/integrations/x402-agent/.env (Hedera). Load with set -a; . file; set +a. The shell exports ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN for an unrelated local proxy: always start Next or the briefs script with env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN and the real key from /home/ubuntu/Rooted/.env.
- Postgres for Rooted is on 127.0.0.1:54330. NEVER use 54329 (unrelated project; every rooted command auto-migrates). Make your own scratch databases by copying rooted_live with pg_dump | psql (no TEMPLATE, it has live connections) and drop them when done. Go is ~/sdk/go/bin/go. Node tunnel to Sepolia: RPC http://127.0.0.1:18545, beacon http://127.0.0.1:15052 (shared; do not restart it).
- Ports you must never bind: 3008-3019, 3025, <deployment ports>. Use only the ports assigned to you below. Stop every process you start.
- Don't publish infrastructure details (the Sepolia node's IP or ssh user, proxy hostnames) in committed files.
- Smallest change that fully works; match surrounding code style; new non-trivial logic gets a focused test. Real installs only (npm ci; symlinked node_modules break Turbopack).
`

const BUILDERS = [
  {
    key: 'uniswap',
    branch: 'polish-uniswap',
    prompt: `Note: branch polish-uniswap already has 2 commits from your interrupted earlier attempt (git log main..HEAD). Review them against this task, run the verification and live check if not yet done, and add commits only for what is missing.
Task: give the Analyst a Uniswap tool so it can answer "which Uniswap pools caused contention?" across ALL stored X-ray reports, not just the latest few blocks. Today it answered "no Uniswap contention in recent blocks" because it only looked at the newest ones, while block 12,076,476 has 87 Uniswap-labelled conflict edges (docs/XRAY.md, docs/UNISWAP.md).
Read docs/UNISWAP.md, internal/uniswap/*, internal/xray (labels on conflict edges), the backend X-ray routes in internal/api, dashboard/lib/analyst/tools.ts, trim.ts, evidence.ts, prompts.ts and their tests.
Build, minimally:
1. A read-only backend endpoint (follow the existing /api/v1/xray routes' style, scope rules (network=sepolia) and tests) that scans stored X-ray reports and returns, per block with Uniswap-labelled edges: block number and hash, Uniswap edge count vs total edges, the pools involved (v3/v4 pool id or address plus a short label as the labels code produces), and how many transactions on the longest dependency chain touch Uniswap state. Newest first, with a limit. If the data needed is not stored in the report JSON, use what is stored and say so in the tool description; do not recompute X-rays.
2. Allow it through the dashboard's hosted read-only allowlist (it is a free read).
3. An analyst tool uniswap_contention (zod-validated input {limit}, strict schema, read-only, counted like other reads) with trimming under the existing size caps and evidence links to the X-ray view for each block. Mention it in the system prompt's tool guidance in one line. Add one suggestion chip in components/analyst.tsx: "Which Uniswap pools caused contention?".
4. Tests: Go handler test with a stored report fixture; analyst tool test (schema, trim, evidence).
5. Live check once (cap $0.30 of Claude spend): backend on 127.0.0.1:8081 against your own copy of rooted_live, next dev on 127.0.0.1:3081, ask "Which Uniswap pools caused contention in stored blocks?" via POST /api/analyst and save the SSE transcript to /tmp/polish/uniswap.sse. Confirm the answer cites real blocks and that the numbers match a direct query of the endpoint.
Run go test (own fresh TEST_DATABASE_URL db on 54330), dashboard npm test, tsc --noEmit, npm run build.`,
  },
  {
    key: 'hosted',
    branch: 'polish-hosted',
    prompt: `Task: polish what judges see on the PUBLIC hosted dashboard (ROOTED_HOSTED=1, x402 paywall on Hedera testnet, ROOTED_ANALYST_PUBLIC=true). Fix each item with the smallest change:
1. The 402 PAYMENT-REQUIRED response names its resource as https://localhost:<port>/... behind the reverse proxy. Build the resource URL from a new ROOTED_PUBLIC_URL env var when set (dashboard/lib/x402*.ts); document it in .env.example and docs/X402_HOSTED.md.
2. Judges clicking a report hit the paywall and never see a full X-ray. Add ROOTED_FREE_XRAY_BLOCKS (comma-separated block hashes) served without payment in hosted mode, on both the paid route and wherever the free proxy currently answers 402, and labelled in the UI as a free sample. Everything else stays paywalled. This is a trust boundary: exact hash matching after normalisation, tests for allowed and denied cases, no path tricks.
3. Incidents view: the policy-checks (CRE) panel shows "route not found" with a Retry button because the backend has no /api/v1/cre/* routes. Remove or hide that panel cleanly (pick whichever is smaller and honest; check docs that mention it).
4. Execution profiler in hosted mode: the saved-profiles list shows the read-only error with a Retry button. Show a calm one-line note instead ("Profiles are run on self-hosted Rooted") and no Retry.
5. X-ray view with ROOTED_HOSTED=1 but no paywall configured says the full report is sold via x402 while the agents panel says reports are free. Make the copy consistent with the actual config.
6. Analyst: a concurrent request is shown as "BAD REQUEST". Add an error code "busy" end to end (types, route, UI label "Busy"), keeping status 429, with a test.
7. Briefs: rule gas_misleads fires on about 82% of blocks, so the briefs feed is mostly the same card. Measure trigger rates on stored data (your copy of rooted_live) and tighten gas_misleads so it fires on roughly 10-20% of blocks (e.g. ratio threshold), keep the other rules unchanged, update tests and docs/ANALYST.md with the measured rates.
Live check: backend 127.0.0.1:8082 on your own copy of rooted_live, next dev 127.0.0.1:3082 with hosted mode + paywall env (copy x402 vars from /home/ubuntu/Rooted-picks/dashboard/.env.local) and ROOTED_FREE_XRAY_BLOCKS set to one stored hash: verify with curl that the sample is free, another hash is 402 with the right resource URL, and screenshot the X-ray sample, Incidents and Profiler views with playwright chromium (~/.cache/ms-playwright) into /tmp/polish/hosted/. No Claude spend needed except optionally one analyst call (cap $0.10).
Run go test (own fresh TEST_DATABASE_URL db), dashboard npm test, tsc --noEmit, npm run build.`,
  },
  {
    key: 'docs',
    branch: 'polish-docs',
    prompt: `Task: make the repo docs meet the ETHGlobal and partner-prize requirements, keeping the README minimal and beautiful. Requirements (quoted from the prize pages):
- Hedera: the README must cover "setup, architecture, and the payment flow" for x402.
- ETHGlobal: "you must include all spec files, prompts, and planning artifacts"; AI attribution must specify "which parts of the code, specific files, or assets were generated or assisted by AI".
Do:
1. README Hedera section: add at most ~15 lines covering setup (env vars and commands), a small architecture diagram (text/mermaid-free ASCII or a compact list) and the payment flow (402 -> agent signs -> facilitator settles on Hedera -> report + HCS audit), taken from docs/X402_HOSTED.md and docs/ANALYST.md. Add one line near the top with the live links: dashboard https://app.91-98-123-155.sslip.io and site https://91-98-123-155.sslip.io. Keep every existing figure; don't add claims you can't point to.
2. docs/ai/README.md: add a short "What AI wrote" table by area -> files/directories -> how (agent-built from spec, reviewed by review agents, verified by live runs). Derive it from docs/superpowers/specs/*.md (each spec has a file/agent table) and git log. State plainly that Claude Code agents wrote the code from team-approved specs and the team directed, reviewed and ran it. No placeholders.
3. Prompts: add docs/ai/prompts/workflows/rooted-analyst.js (copy of /home/ubuntu/.claude/projects/-home-ubuntu-Rooted/1db0ae8c-e7e0-486e-a79a-808d8f40d882/workflows/scripts/rooted-analyst-wf_68c072a9-23e.js) and docs/ai/prompts/rooted-analyst/NN-<agent>.md with each agent prompt extracted from it, matching the existing docs/ai/prompts/rooted-three-picks/ layout. Also add docs/ai/prompts/rooted-ship/ with the four standalone agent prompts used today for CI, demo resilience, public deployment and the submission pack: extract them from the session transcript /home/ubuntu/.claude/projects/-home-ubuntu-Rooted/1db0ae8c-e7e0-486e-a79a-808d8f40d882.jsonl (tool_use blocks named "Agent" whose input.description is "CI workflow and docs grouping", "Demo resilience when node offline", "Public HTTPS deployment on server", "ETHGlobal submission pack"), and the polish workflow script once it exists in the same scripts directory (rooted-polish-*.js) into docs/ai/prompts/workflows/. Redact in all copied prompts: the Sepolia node IP address and ssh user/host, proxy hostnames, and anything secret-looking (replace with <node-host> etc.). Update docs/ai/README.md's list of prompt folders and fix its links.
4. Run a throwaway link checker over all tracked .md files outside docs/ai/prompts: zero broken relative links.
5. Grep the whole tracked tree (git grep -i) for: any <node-ip> IP, <proxy-host>, sk-ant-, 302e0201. Fix any hit outside docs/ai/prompts by removing it; inside docs/ai/prompts only redact infra/secrets (do not rewrite prompt wording otherwise).
No servers or Claude spend needed.`,
  },
]

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    worktree: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    tests: { type: 'array', items: { type: 'string' } },
    live_evidence: { type: 'array', items: { type: 'string' } },
    open_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'commits', 'summary', 'tests', 'open_issues'],
}

phase('Build')
const WT = { uniswap: 1, hosted: 2, docs: 3 }
const built = await parallel(BUILDERS.map(b => () => agent(
  `${COMMON}\nYou are builder "${b.key}". Work ONLY in the existing git worktree /home/ubuntu/Rooted/.claude/worktrees/wf_08aea236-8bd-${WT[b.key]} (cd there first), already on branch ${b.branch} from main 9ba9750. A previous attempt at this exact task was interrupted by a server restart: inspect any uncommitted changes there (git status, git diff) and keep what is correct, finish the rest, verify, and commit on ${b.branch} (1-3 commits). Processes from the old attempt are gone; scratch databases it created may still exist on 54330 (reuse or drop them).\n\n${b.prompt}\n\nFinal answer: branch, worktree path, commit hashes with subjects, what changed, exact test results, live evidence, open issues.`,
  { label: `build:${b.key}`, phase: 'Build', schema: BUILD_SCHEMA },
)))
const ok = built.filter(Boolean)
log(`built ${ok.length}/${BUILDERS.length}: ${ok.map(b => b.branch).join(', ')}`)

phase('Integrate')
const integ = await agent(
  `${COMMON}\nYou are the integrator. Builders committed on these branches (in the shared repo /home/ubuntu/Rooted):\n${JSON.stringify(ok, null, 1)}\n\nCreate worktree /home/ubuntu/Rooted-polish on a new branch polish from main (git -C /home/ubuntu/Rooted worktree add -b polish /home/ubuntu/Rooted-polish main). Cherry-pick every builder commit in order uniswap, hosted, docs (linear history; resolve conflicts carefully, keeping both sides' intent; cherry-picks are re-signed automatically). If the docs builder could not copy the polish workflow script, copy /home/ubuntu/.claude/projects/-home-ubuntu-Rooted/1db0ae8c-e7e0-486e-a79a-808d8f40d882/workflows/scripts/rooted-polish-*.js into docs/ai/prompts/workflows/ yourself (redacting infra as specified) in a docs: commit.\nThen verify on the combined branch: go build, go vet, go test ./... (fresh TEST_DATABASE_URL db), workloads/profiler go test, dashboard npm ci + npm test + tsc --noEmit + npm run build, integrations/x402-agent npm test, python3 -m unittest discover -s scripts -p 'test_*.py'.\nLive check on the combined branch (ports backend 127.0.0.1:8083, dashboard 127.0.0.1:3083, own copy of rooted_live, hosted mode + paywall + ROOTED_ANALYST_PUBLIC=true + ROOTED_FREE_XRAY_BLOCKS with one stored hash + ROOTED_PUBLIC_URL=https://app.91-98-123-155.sslip.io): one analyst question about Uniswap contention (cap $0.30) saved to /tmp/polish/integ-uniswap.sse; curl checks for the free sample (200) vs a non-sample (402 with the public resource URL); screenshots of Analyst (with the Uniswap chip), X-ray sample, Incidents and Profiler at 1440 and 390 px into /tmp/polish/integ/.\nCheck: git log --format='%G? %s%n%b' main..polish shows G on every commit and no bodies or trailers. Stop processes, drop scratch DBs.\nFinal answer: commits, test results per suite, live evidence, open issues.`,
  { label: 'integrator', phase: 'Integrate', schema: BUILD_SCHEMA },
)

phase('Review')
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      location: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' },
    }, required: ['severity', 'location', 'issue', 'fix'] } },
  },
  required: ['verdict', 'findings'],
}
const LENSES = [
  { key: 'security', port: '8084/3084', prompt: `Lens: correctness and security of git diff main..polish in /home/ubuntu/Rooted-polish. Focus: the free-sample paywall bypass (can any non-listed block be obtained free via path tricks, case, prefixes, the backend proxy, the analyst's get_block_xray, or the paid route?), the new Uniswap endpoint (SQL/scope/limit abuse, hosted allowlist), the busy code and route, brief-rule change, ROOTED_PUBLIC_URL handling, secrets or infra details leaked into committed files (git grep for IPs, ssh hosts, keys, proxy hostnames), and test quality. Prove suspected issues with a scratch test or curl against your own stack (backend 127.0.0.1:8084, dashboard 127.0.0.1:3084, own copy of rooted_live) rather than guessing. No Claude spend.` },
  { key: 'judge', port: '8085/3085', prompt: `Lens: what a hackathon judge sees. Review git diff main..polish in /home/ubuntu/Rooted-polish and run it (backend 127.0.0.1:8085, dashboard 127.0.0.1:3085, own copy of rooted_live, hosted mode with paywall, ROOTED_ANALYST_PUBLIC=true, ROOTED_FREE_XRAY_BLOCKS with one stored hash). Ask the analyst once "Which Uniswap pools caused contention in stored blocks?" (cap $0.30) and spot-check every cited number against the backend JSON. Check README renders well (minimal, accurate, every figure traceable, Hedera setup/architecture/payment flow present, live links), docs/ai attribution is specific with no placeholders, prompts folders exist and links resolve, UI at 1440 and 390 px for Analyst, X-ray sample, Incidents, Profiler (screenshots to /tmp/polish/review/).` },
]
const reviews = await parallel(LENSES.map(l => () => agent(
  `${COMMON}\nYou are a reviewer. Do not commit or change tracked files (scratch files outside the repo are fine). ${l.prompt}\nIntegrator report: ${JSON.stringify(integ)}\nFinal answer: verdict plus findings with severity (blocker/major/minor), location, issue, concrete fix. Stop your processes and drop scratch DBs.`,
  { label: `review:${l.key}`, phase: 'Review', schema: REVIEW_SCHEMA },
)))
const findings = reviews.filter(Boolean).flatMap(r => r.findings)
const toFix = findings.filter(f => f.severity !== 'minor' || /secret|ip address|leak|placeholder|broken link/i.test(f.issue))
log(`review findings: ${findings.length} total, ${toFix.length} to fix`)

phase('Fix')
let fix = null
if (toFix.length) {
  fix = await agent(
    `${COMMON}\nYou are the fixer, working in /home/ubuntu/Rooted-polish on branch polish. Fix these review findings at the root, each with a test where it is logic (prove the test fails before the fix when practical):\n${JSON.stringify(toFix, null, 1)}\nAlso apply any of these minor findings that take under a few lines: ${JSON.stringify(findings.filter(f => !toFix.includes(f)), null, 1)}\nRe-run the full verification (go test with fresh db, profiler test, dashboard npm test + tsc + build, x402-agent test, python unittest). If you touch analyst behaviour, do one live check on backend 127.0.0.1:8086 / dashboard 127.0.0.1:3086 (cap $0.20). Commit with signed one-line messages; confirm %G? = G and no bodies on main..polish. Stop processes, drop scratch DBs.\nFinal answer: commits, what was fixed, what was not and why, test results.`,
    { label: 'fixer', phase: 'Fix', schema: BUILD_SCHEMA },
  )
}
return { built: ok, integ, reviews, fix }
