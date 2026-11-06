# fix (Fix phase)

Task prompt given to one Claude Code agent by the `rooted-analyst` workflow script on 2026-11-06T14:21:29.051Z (UTC), verbatim.

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

You are the FIX agent. Address every blocker and major finding below, and any minor one that is a one-line fix. For each, either fix it (with a test when it is logic) or explain in open_issues why not. Re-run all suites (Go with TEST_DATABASE_URL on a fresh 54330 DB, dashboard tsc/test/build, x402-agent tests). If a fix changes answer behaviour, re-run ONE live question on ports 8097/3017 (rooted_p6) to confirm (spend < $1), then stop your processes. Update docs if claims changed. Commit with one-line signed conventional messages (no body, no trailers) and verify %G? = G.

Blocker/major findings:
[
 {
  "lens": "review-correctness-safety",
  "severity": "major",
  "location": "dashboard/app/api/analyst/route.ts:45-49",
  "issue": "The one-at-a-time limit has a race. The route checks `busy` at line 45, then awaits `overBudget()` (an async ledger read), and only sets `busy = true` at line 49. Two requests that arrive within that window both pass the check. My scratch test with a hanging fake API server got 200 and 200, and saw two upstream calls in flight. If both requests carry the same session_id, they also push into the same session's message history at the same time. That corrupts the tool_use/tool_result pairing, so the follow-up turns of that session fail with 400. A fast double Enter in the view can do this, and so can any scripted client in public hosted mode. The integrator's live check only sent the second request after the first had started.",
  "fix": "Set `busy = true` straight after the `if (busy)` check, before any await. Release it on the over-budget path: `busy = true; if (await overBudget(...)) { busy = false; return fail(...) }`. Better still, wrap the ledger read in try/finally so a ledger read error cannot leave `busy` stuck. Add a route test that fires two POSTs at once against a fake `ANTHROPIC_BASE_URL` that never answers. Assert exactly one 429, and assert that cancelling the first body lets a third request through."
 },
 {
  "lens": "review-correctness-safety",
  "severity": "major",
  "location": "dashboard/lib/analyst/agent.ts:73-84",
  "issue": "The budget misses aborted calls. The ledger is charged only after `stream.finalMessage()` resolves. When a client aborts, or a stream fails partway, the code returns from the catch without recording anything, but Anthropic still bills the input and any output streamed so far. Anyone who sends a question and drops the connection once thinking starts streaming spends real money while the ledger stays at $0, so the daily cap never trips. In hosted mode with ROOTED_ANALYST_PUBLIC=true, anyone who can reach the dashboard can repeat this with curl, because the Origin check only stops browsers. Refused attempts and fallback-model rates are also not counted; that part is a documented shortcut, but it errs the same way.",
  "fix": "Add `currentMessage` to the injected Stream type; the SDK's BetaMessageStream has this getter. In the catch, charge `stream.currentMessage?.usage` (input and cache counts arrive with message_start, output with the last message_delta) through `deps.ledger.add` before returning the upstream error. Add a fake-client test where `finalMessage` rejects after a partial snapshot, and assert that a ledger row is written."
 },
 {
  "lens": "review-demo-readiness",
  "severity": "major",
  "location": "dashboard/lib/analyst/trim.ts:32 (briefKeys)",
  "issue": "recent_blocks drops gas_capping_tx_index and gas_misidentifies_bottleneck, though /api/v1/xray/blocks returns both. Asked for the gas misidentification rate over the last 30 blocks, the analyst replied on camera 'I can't give an exact count for just these 30 blocks' and fell back to the 306-block share and its own rough proxy. The stored data answers it directly: 24 of 30 by the strict flag, 29 of 30 by differing capping index.",
  "fix": "Add \"gas_capping_tx_index\" and \"gas_misidentifies_bottleneck\" to briefKeys and update the column expectation in tests/analyst-tools.test.ts. The 50-row result grows from about 7.1 KB to 7.6 KB, still under the 12 KB cap. The recent_blocks tool description could also mention the flag."
 },
 {
  "lens": "review-demo-readiness",
  "severity": "major",
  "location": "README.md:116, docs/ANALYST.md:118, dashboard/lib/analyst/prompts.ts:11 (FRAMING)",
  "issue": "The paid demo is presented as 'the newest block with a builder gap', but block 12,076,555 has static builder 18.09x against validator 19.28x (0.94). Rooted's own builder_gap rule, defined lower in the same ANALYST.md, needs static < 0.7x or multi-version < 0.8x. Among the 50 blocks Claude listed, exactly one met that rule: 12,076,549 (static 16.33x against 25.57x, 0.64). Its fallback suggestion 12,076,543 (0.817) does not meet the rule either. The prompt never defines 'builder gap', so Claude used 'any builder ceiling below the validator ceiling'.",
  "fix": "Add one line to FRAMING defining a builder gap as Rooted's rule does (multi-version < 0.8x or static < 0.7x of the validator-with-BAL ceiling). Alternatively, or as well, reword the README and ANALYST.md row to what was actually bought: 'the newest block whose static builder ceiling falls below the validator ceiling'."
 },
 {
  "lens": "review-demo-readiness",
  "severity": "major",
  "location": "dashboard/lib/analyst/rules.ts:13 and :20-26; dashboard/components/analyst.tsx:149",
  "issue": "The Briefs column says 'Written automatically for unusual blocks', but gas_misleads fires on 164 of the 200 newest stored blocks (82%); the ratio test alone fires on 58%. builder_gap fires on 7, big_block and commitment on none. On camera the feed shows six near-identical 'Gas points at the wrong bottleneck' cards stored within 2 minutes, while Rooted's own X-ray page shows gas misidentifies the bottleneck in 79% of blocks. A protocol judge will see these are not anomalies.",
  "fix": "Smallest fix, copy only: change the subtitle to something like 'Written automatically for blocks that trip a rule'. Better, as a documented spec deviation: in nextBlock, prefer the rarer triggers (builder_gap, commitment, big_block) before gas_misleads, and/or limit gas_misleads to the extreme ratio test (drop the strict-flag clause)."
 }
]

Minor findings:
[
 {
  "severity": "minor",
  "location": "dashboard/tests/analyst-tools.test.ts:134",
  "issue": "No test covers the 429 limit, its release in `finally`, or a client abort cancelling the loop. The race above passes the whole suite.",
  "fix": "Extend the route test as described in the first finding: two requests at once, one 429; then cancel the first body and assert the next request gets 200."
 },
 {
  "severity": "minor",
  "location": "docs/ai/README.md:15",
  "issue": "The new row links to `prompts/rooted-analyst/`, but that directory does not exist, so the link is broken.",
  "fix": "Add the prompts directory, or remove or reword the row."
 },
 {
  "severity": "minor",
  "location": "dashboard/lib/analyst/tools.ts:145",
  "issue": "The spec says frame-transaction evidence links to `https://explorer.altmempool.wtf/tx/0x…`. The code links all frame evidence to `/?view=frames`, and contract_deviations does not mention this.",
  "fix": "List it in contract_deviations (frame_transactions returns a list, so there is no single tx to link), or add explorer links per tx inside the trimmed data."
 },
 {
  "severity": "minor",
  "location": "live answer (/tmp/rooted-review/q.sse); dashboard/lib/analyst/trim.ts blocks()",
  "issue": "A cited ranking is wrong: 'The next biggest gaps are 12077039 (4.212 vs 16.476) and 12077043 (5.191 vs 17.052) [E1]'. Block 12077028 (5.735 vs 21.251; ratio 0.270, gap 15.52) ranks ahead of 12077043 (ratio 0.304, gap 11.86) under both measures; by absolute gap, 12077033 does too. The individual numbers are correct. The ordering came from Claude's own arithmetic over 30 rows.",
  "fix": "Optional: add a precomputed gas_weighted / validator_bal_time ratio column to the recent_blocks rows so Claude ranks blocks from data instead of mental arithmetic. Otherwise steer the demo toward questions about one block."
 },
 {
  "severity": "minor",
  "location": "dashboard/components/analyst.tsx:21 and :94; dashboard/app/api/analyst/route.ts:45",
  "issue": "A second concurrent request renders as 'BAD REQUEST: The question was rejected. Another investigation is running.', which is misleading because nothing about the question was wrong. Every error state also repeats itself: budget shows 'Today's analyst budget is spent... resets with the next day's ledger. The analyst's daily budget is spent. It resets at 00:00 UTC.', and refusal shows 'Claude declined to answer this question. Claude declined this request (...)'.",
  "fix": "At line 94, render the server message alone when present and use the generic hint only when the message is empty. That fixes the duplication and removes 'The question was rejected' from the busy case."
 },
 {
  "severity": "minor",
  "location": "dashboard/components/analyst.tsx:66; README.md:62-63; dashboard/lib/analyst/prompts.ts",
  "issue": "The UI and README say every figure in the answer cites its source, but uncited figures show up on camera. My run's 'Still unknown' line ('the other 29 blocks') has no citation, Q2's opening line (slot range 11519947–11519966) has none, and the brief for block 12,076,993 shows an uncited headline ('tx 40', 'tx 23') in the Briefs column. The rule lives only in the prompt and is not enforced.",
  "fix": "Soften the copy to 'Figures in the answer cite the tool result they came from', or have the view mark answer lines that contain digits but no [E#]."
 },
 {
  "severity": "minor",
  "location": "dashboard/components/analyst.tsx EvidenceDrawer (link text); dashboard/app/globals.css:1963",
  "issue": "The evidence drawer prints the raw relative link as its text, and it breaks awkwardly ('/?' then 'view=xray&block=0xca10…' on the next line) at both 1440 and 390 px. It reads like a debug string on camera.",
  "fix": "Show readable link text (e.g. 'Open X-ray' for same-origin paths, the host for https links) and keep the full URL in a title attribute, or use word-break: break-all for .analyst-drawer a."
 },
 {
  "severity": "minor",
  "location": "dashboard/app/globals.css:1926 (.analyst-form-row)",
  "issue": "When Ask switches to 'Investigating…', the wider button squeezes 'New session' onto two lines. The suggestion grid jumps about 16 px down mid-run (running-1440.png against answer-1440.png).",
  "fix": "Add white-space: nowrap to .analyst-form-row button."
 },
 {
  "severity": "minor",
  "location": "docs/superpowers/specs/2026-11-06-rooted-analyst-design.md:9",
  "issue": "The committed spec names 'demo judges (EF, Uniswap, Hedera, finalists)'. That is sponsor/track framing in shipped docs, against the rule that no tracks are mentioned anywhere.",
  "fix": "Reword to 'protocol researchers, demo viewers and operators running Rooted', or keep the spec out of the shipped branch."
 }
]
