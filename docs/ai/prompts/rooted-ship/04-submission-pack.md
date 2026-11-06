# ETHGlobal submission pack

Task prompt given to one background Claude Code agent from the main Claude Code session on 2026-11-06T14:08:00.591Z (UTC), verbatim.

---

Write the submission pack for Rooted, a project at ETHGlobal Mumbai 2026 (deadline Sat Nov 7, 09:00 IST, team of 2).

Rooted: github.com/Amlan2006/Rooted. It's Go + Postgres + Next.js observability for Sepolia Glamsterdam: ePBS payload checks, block access lists (BAL), Block X-ray parallelism ceilings, the frame-transaction mempool, provider comparison, and x402 pay-per-report on Hedera.

The three partner prizes chosen:
- EF Frame Transaction Alt Mempool
- Uniswap
- Hedera "AI Agents That Pay: x402"

An AI "Analyst" is being built right now. Claude (claude-opus-5-5) investigates blocks with Rooted's tools, cites evidence, can buy a paid x-ray report over x402 on Hedera by itself, and writes auto-briefs on anomalies. Spec: /home/ubuntu/Rooted-picks/docs/superpowers/specs/2026-11-06-rooted-analyst-design.md. Its live results don't exist yet, so wherever the pack needs them write a clearly marked slot `[after analyst lands: ...]` describing what goes there.

Read for facts: /home/ubuntu/Rooted/README.md, docs/XRAY.md, docs/UNISWAP.md, FEEDBACK.md, docs/X402_HOSTED.md, docs/FRAME_*.md, docs/CAPABILITIES.md, docs/superpowers/specs/*, and the code as needed. Read only; do not edit the repo.

Write these files to /home/ubuntu/rooted-submission/ (outside the repo; do not commit anywhere):
1. checklist.md (do this first). Use WebFetch/WebSearch to find the actual ETHGlobal Mumbai 2026 prize descriptions and qualification requirements for the three partner prizes above, plus ETHGlobal's general submission requirements (video length, required fields, AI-usage disclosure, partner prize limits). Map every requirement to evidence in the repo (file:line, tx hash, URL) or mark it GAP, with the smallest fix. Quote the requirement text and give the source URL. If a page can't be fetched, say so; do not guess requirements.
2. form.md. Ready-to-paste text for every ETHGlobal project field: name, a tagline/short description within the length limit you found, description, "How it's made" (technical, specific, naming each partner technology and exactly how it is used, with real figures), tech tags, and a per-partner-prize "why this qualifies" paragraph with links to the exact files and transactions.
3. video.md. A 2:45–3:00 shot list with timestamps. For each shot: what is on screen (exact dashboard view `?view=...`, block numbers, commands, URLs), and the narration line. Build it around three moments:
   - receipt gas suggests about 3.5× parallel headroom, but the measured ceilings are 16–22× (use the README's 101-block table);
   - Claude investigating a block and paying for a report on Hedera by itself (analyst slot);
   - the frame-transaction conformance finding (100,001 gas) from the EF work.
   Public URLs being set up: dashboard https://app.91-98-123-155.sslip.io and site https://91-98-123-155.sslip.io. Mark them "(verify live)".
4. pitch.md. A 60-second spoken pitch, a 4-minute finalist demo run-of-show, and 12 likely judge questions with crisp answers grounded in the repo, for example: what's measured versus estimated; why your own node; the BAL validator view versus the builder DAG view; what x402 adds; what breaks at mainnet scale; how this helps client teams.

Rules:
- Every number, hash, block and transaction must come from the repo docs or code. Invent nothing; if a figure is missing, leave a marked slot.
- No marketing filler (revolutionize, unleash, supercharge, seamless, cutting-edge, leverage, game-changing, next-gen). Plain and specific.
- Do not include or print any secret from .env files.

Final message: the file list, then the full GAP list from checklist.md (requirement → gap → smallest fix), most important first.
