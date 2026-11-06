export const meta = {
  name: 'rooted-site',
  description: 'Build the editorial-mono Rooted marketing site in site/ with parallel agents, screenshot-critique it, then design/a11y/honesty review and fix',
  phases: [
    { title: 'Foundation', detail: 'scaffold + design system, live data snapshot (parallel)' },
    { title: 'Sections', detail: 'four parallel section builders' },
    { title: 'Polish', detail: 'integrate + screenshot critique loop at 3 widths' },
    { title: 'Review', detail: 'design, a11y/perf, copy/honesty lenses + fix' },
  ],
}

const WT = '/home/ubuntu/Rooted-site'
const SPEC = `${WT}/docs/superpowers/specs/2026-11-06-site-design.md`
const SHOT = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
const BASE = `You are building the marketing website for "Rooted" (Ethereum Sepolia Glamsterdam observability: ePBS payloads, EIP-7928 block access lists, native Geth replay, frame-tx mempool; open source MIT; built at ETHGlobal Mumbai 2026). Work ONLY inside the git worktree ${WT} (branch 'site'), and ONLY inside ${WT}/site/ (plus reading anything in the repo for facts: README.md, docs/*.md, cmd/rooted/main.go for real commands, internal/api/server.go for real routes). Do NOT touch /home/ubuntu/Rooted, /home/ubuntu/Rooted-picks or dashboard/. Do not git commit/stash/reset/checkout.

THE SPEC IS LAW: read ${SPEC} fully before doing anything. Visual system (editorial mono: paper #FAFAF7, ink #0F0F0E, muted #6B6B66, line #E7E6E1, ONE accent signal #FF5A1F used at most once per viewport; Instrument Serif display + Geist + Geist Mono tabular), the BANNED list (gradients of any kind, glass/backdrop-blur, glows, emoji, sparkle icons, purple, icon-in-circle cards, big drop shadows, fake logos/testimonials/numbers, buzzwords), the HONESTY RULE (every figure from site/data/*.json with a visible source line; nothing estimated), motion rules (motion/react, reduced-motion safe), quality bar (375/768/1440, WCAG AA, keyboard a11y, Lighthouse 95+).
Taste references: Resend, Linear, Mintlify, Vercel changelog, Warp, Cal.com — restraint, typography-led, generous whitespace, precise hairlines, tiny details (tabular figures, aligned baselines, optical sizing, consistent 4/8px spacing). The page must feel designed by a senior product designer, not generated.

ENV: Node 24, npm. export PATH=$HOME/sdk/go/bin:$HOME/.foundry/bin:$PATH if you need go/cast. Live Sepolia node: Geth http://127.0.0.1:18545 (receipts available for old blocks; state only ~128 recent blocks), Nimbus http://127.0.0.1:15052 (Gloas; /eth/v2/beacon/blocks/{id}, /eth/v1/beacon/execution_payload_envelopes/{root}, SSE /eth/v1/events, /eth/v1/beacon/genesis). Headless screenshots: ${SHOT} --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=1440,4000 --screenshot=/tmp/x.png http://127.0.0.1:PORT/ (use --virtual-time-budget=4000 so motion settles; or install playwright into a temp dir OUTSIDE the repo, e.g. /tmp/pw, for scrolling/hover/focus checks). You can view PNGs with the Read tool — DO look at your screenshots and critique them like a designer. Dev/preview servers: use only your assigned port; kill every process you start before finishing.`

const OUT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    checks_run: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, result: { type: 'string' } }, required: ['command', 'result'] } },
    screenshots: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
    notes_for_others: { type: 'array', items: { type: 'string' } },
    open_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'files', 'checks_run', 'screenshots', 'deviations', 'notes_for_others', 'open_issues'],
}

phase('Foundation')
const [foundation, data] = await parallel([
  () => agent(`${BASE}\n\nTASK F1 — SCAFFOLD + DESIGN SYSTEM (port 3011). Create site/ as its own Next.js app exactly per the spec's Stack section (latest stable next 16.x, react 19, tailwindcss 4 + @tailwindcss/postcss, motion 12+/14, typescript; pin exact versions; output:'export'; images unoptimized). Implement: app/layout.tsx (next/font/google Instrument Serif [400, italic], Geist, Geist Mono as CSS variables; metadata title/description/OG; skip link), app/globals.css (Tailwind v4 @theme tokens from the spec, base typography, selection color, focus-visible ring in --signal, reduced-motion overrides, tabular-nums utility, hairline helpers), app/icon.svg (a crisp mono 'r' mark or root glyph — simple, not clip-art), app/opengraph-image.tsx (static-export compatible: export const dynamic='force-static'; paper bg, serif headline, mono footer line), app/page.tsx composing Nav, every section component in spec order, Footer. Build all shared primitives in components/ui/ (button [ink + outline variants, 150ms transitions, press state], container, section (with eyebrow '01 / Name', top hairline, id anchors), eyebrow, mono, badge, copy-button [clipboard + check transition, aria-live]) and components/motion.tsx (Reveal, Stagger, CountUp — reduced-motion safe). Build components/nav.tsx (scroll-aware hairline, mobile sheet menu with focus trap + Esc) and components/footer.tsx fully. For EVERY section file listed in the spec (components/sections/{hero,proof,promises,product,tape,how,terminal,pricing,faq}.tsx) and components/block-xray.tsx create a minimal compiling placeholder that renders its Section shell with the right id/eyebrow and a muted 'placeholder' note — section builders replace these. Create lib/data.ts with typed loaders/types for every data file named in the spec (import JSON statically from ../data/*.json) and lib/format.ts (gas in M with 2 decimals, thousands separators, short hashes 0x1234…abcd, ms). Until the data agent finishes, create site/data/*.json stubs ONLY if missing, each {"source":"pending snapshot","captured_at":null,...} matching the types (data agent overwrites them). package.json scripts: dev (-p 3011 allowed via CLI), build, snapshot (node scripts/snapshot.mjs), lint (tsc --noEmit), test (node --test tests/). Add site/README.md (3 lines: what, dev, build/deploy to any static host). .gitignore for .next/out/node_modules (repo root .gitignore already ignores .next and node_modules; add site/out). Run npm install, npm run lint, npm run build; screenshot the skeleton at 1440 and 375 and view them; fix type/layout problems. Report the primitives' APIs precisely in notes_for_others.`,
    { label: 'F1-scaffold', phase: 'Foundation', schema: OUT }),
  () => agent(`${BASE}\n\nTASK F2 — REAL DATA SNAPSHOT. Write site/scripts/snapshot.mjs (Node 24, no deps; fetch JSON-RPC/REST; env ROOTED_EXECUTION_URL default http://127.0.0.1:18545, ROOTED_BEACON_URL default http://127.0.0.1:15052) that writes every file in the spec's Data files table to site/data/ (create dir), each with source, captured_at, identifiers:
- hero-block.json for Sepolia block 12075273 (0xb84109): header fields, receipts per tx (gas_used, is_create = contractAddress != null, to), sum; slot/beacon_root/builder_index if Nimbus still has the beacon block (find the slot from the execution block's slotNumber field). Assert header_gas_used 92173320, receipts sum 155156084, capping index 72 — fail loudly otherwise.
- blocks.json: last 24 consecutive head blocks (number, hash, tx_count, gas_limit, header_gas_used, receipts_gas_sum, slot via slotNumber, builder_index from the beacon block's signed_execution_payload_bid, payload_present_votes = popcount of aggregation_bits in the NEXT slot's beacon block payload_attestations whose data.beacon_block_root == this block's beacon root and payload_present==true, ptc_size 512). Handle missed slots honestly (null).
- epbs.json: subscribe to Nimbus /eth/v1/events?topics=block,execution_payload,execution_payload_available,payload_attestation_message for up to ~120s, pick one slot that completes block + payload events, record local receipt offsets (ms) from slot start (genesis_time from /eth/v1/beacon/genesis + slot*12s), count PTC messages received for it, and the included PTC tally from the next block; label offsets as local receipt times at our node.
- pricing.json from /home/ubuntu/Rooted-picks (grep dashboard/lib/x402*.ts, dashboard/.env.example, docs/X402_HOSTED.md for price/network/asset; never read secret env files like .env.local) else {"price":null,...}.
- meta.json (license MIT, repo URL https://github.com/Amlan2006/Rooted, docs links to GitHub blob URLs for README/docs files that exist on branch main at ${WT}/docs).
Run it now against the live node and commit the outputs into site/data/ (overwrite any stubs). Then write site/tests/data.test.mjs (node:test) asserting the spec's data guards, and run it. Report the headline figures (for the copy writers) in summary: exact numbers, the epbs offsets, PTC tallies, block range.`,
    { label: 'F2-data', phase: 'Foundation', schema: OUT }),
])
const fText = JSON.stringify({ foundation, data })
log('foundation + data done')

const SECTIONS = [
  { key: 'S1-hero-xray', port: 3012, files: 'components/sections/hero.tsx, components/block-xray.tsx, components/sections/proof.tsx', task: 'Hero (headline exactly per spec, eyebrow, sub, CTAs, faint 12-col guides) + the signature BlockXray dot-matrix SVG (lanes per tx proportional to gas, capping tx in --signal with mono callout, staggered draw-in, hover/focus tooltip with index/gas/hash, keyboard focusable lanes via roving tabindex or a listbox pattern, compact wrap at 375px, source line) + Proof strip (four CountUp mono figures from hero-block.json, serif line "Gas stopped measuring time." with EIP-8037 link https://eips.ethereum.org/EIPS/eip-8037). This is the first impression — make it exceptional.' },
  { key: 'S2-promises-product', port: 3013, files: 'components/sections/promises.tsx, components/sections/product.tsx', task: 'Two promises (ePBS slot timeline from epbs.json with offsets + PTC tally; access-list lanes mini view reusing data from hero-block.json — import BlockXray only if S1 exposes a compact prop, otherwise build a small separate lanes figure) + Product grid of six hairline cells with bespoke tiny mono/SVG micro-illustrations (e.g. PayloadWatch: bid→envelope→PTC ticks; BAL: RAW/WAR/WAW edges; Frame: admission checks list; Profiler: stacked timer bars; Provider comparison: two columns with diff marks; Block X-ray: lanes) and one precise sentence each; hover reveals a subtle detail (line draw / tick), not a lift-and-shadow.' },
  { key: 'S3-tape-how-terminal', port: 3014, files: 'components/sections/tape.tsx, components/sections/how.tsx, components/sections/terminal.tsx', task: 'Block tape (infinite marquee of blocks.json with gas bars + PTC votes, pause on hover/focus, reduced-motion => static scroll row, accessible as a list) + How it works (4 steps, scroll-linked hairline progress via motion useScroll, reduced-motion => full line) + Terminal tabs CLI/API/Agent (WAI-ARIA tabs with arrow keys, sliding underline layoutId, monospace code with subtle token coloring in ink/muted only + signal for prompts, copy button; commands must be REAL — take them from README.md, docs/BACKEND.md, docs/API.md, cmd/rooted/main.go; Agent tab shows the x402 402→pay→retry flow as an annotated HTTP exchange consistent with pricing.json and x402 v2 headers PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE).' },
  { key: 'S4-pricing-faq', port: 3015, files: 'components/sections/pricing.tsx, components/sections/faq.tsx', task: 'Pricing (two plans exactly per spec; Hosted labelled testnet; price from pricing.json or the no-number fallback; feature lists true to the repo; CTA Self-host -> GitHub, Hosted -> docs anchor) + Open-source band + FAQ (4 honest Q&As per spec, WAI-ARIA accordion, animated height, reduced-motion safe). Copy: crisp, specific, no filler.' },
]

phase('Sections')
const sections = (await parallel(SECTIONS.map(s => () =>
  agent(`${BASE}\n\nFOUNDATION REPORTS (primitives API, data figures): ${fText}\n\nTASK ${s.key} (port ${s.port}). You own ONLY: ${s.files} (replace the placeholders) plus new files under site/components/${s.key.toLowerCase()}/ if you need helpers. Use the shared primitives (components/ui/*, components/motion.tsx, lib/data.ts, lib/format.ts) — don't fork them; if a primitive needs a change, put it in notes_for_others. ${s.task}\nVerify: npm run lint && npm run build in site/, then run a static preview of site/out on your port (npx serve -l ${s.port} out, or python3 -m http.server ${s.port} -d out) and screenshot YOUR sections at 1440 and 375 widths (crop/scroll via a playwright script in /tmp/pw if needed), look at them, and iterate until they meet the spec's bar. Report screenshot paths.`,
    { label: s.key, phase: 'Sections', schema: OUT }).then(r => r && { key: s.key, ...r })))).filter(Boolean)
log(`sections: ${sections.map(s => s.key).join(', ')}`)

phase('Polish')
const polish = await agent(`${BASE}\n\nTASK P1 — INTEGRATOR + ART DIRECTOR (port 3016). You now own all of site/. Reports: ${JSON.stringify({ foundation, data, sections })}\n1. Apply notes_for_others, unify spacing rhythm, type scale, hairlines, section transitions and motion timing across the page so it reads as ONE designed system; remove anything that drifts toward the banned list.\n2. Screenshot critique loop (at least 3 iterations): build + static preview, full-page screenshots at 1440, 768, 375 (playwright in /tmp/pw recommended: also capture nav-scrolled state, mobile menu open, terminal tab 2, FAQ item open, a BlockXray lane focused/hovered). VIEW every screenshot; write a terse designer critique each round (alignment, rhythm, hierarchy, density, contrast, orphan words, awkward wraps, empty areas) and fix it.\n3. npm run lint, npm test, npm run build must pass; no console errors (capture via playwright).\nReport final screenshot paths.`,
  { label: 'P1-integrate', phase: 'Polish', schema: OUT })

const REVIEW = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, where: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'where', 'issue', 'fix'] } },
    score: { type: 'number', description: '0-10 for your lens' },
    verdict: { type: 'string' },
  },
  required: ['findings', 'score', 'verdict'],
}
const LENSES = [
  { key: 'design-critic', port: 3017, prompt: 'Lens: senior product designer from a top YC devtool. Judge taste and craft from fresh screenshots at 1440/768/375 and interaction states. Is it premium, restrained, original — or does anything read as AI-template / slop (centered hero clichés, generic cards, filler copy, gratuitous motion, banned-list items)? Be specific and harsh; score 0-10.' },
  { key: 'a11y-perf', port: 3018, prompt: 'Lens: accessibility + performance engineer. Check keyboard paths (skip link, nav, mobile menu trap, tabs arrows, accordion, BlockXray lanes), focus visibility, contrast of every text color pair (compute ratios), landmarks/headings order, alt/aria, reduced-motion (emulate via playwright), CLS/LCP on the static build (run Lighthouse via npx lighthouse with the headless shell if feasible, else measure with PerformanceObserver), bundle size of out/_next, console errors.' },
  { key: 'copy-honesty', port: 3019, prompt: 'Lens: copy editor + fact checker. Read every visible string. Spelling/grammar, tone (crisp, specific, no buzzwords), and HONESTY: trace every number/claim to site/data/*.json or repo docs/code (cite file); verify commands in the terminal tab actually exist (cmd/rooted/main.go, internal/api/server.go routes); confirm sources are shown next to figures; flag any claim about features the repo does not have (e.g. X-ray/x402 exist only on branch picks at /home/ubuntu/Rooted-picks — check there and flag if the site presents them as shipped while they are not yet merged; the fix may be wording like "on the picks branch / coming in this release" OR it may be acceptable if picks contains them — report precisely).' },
]

phase('Review')
let reviews = [], fixes = []
for (let round = 1; round <= 2; round++) {
  reviews = (await parallel(LENSES.map(l => () =>
    agent(`${BASE}\n\nREVIEW ROUND ${round} — independent, adversarial; do NOT edit site files (write throwaway scripts in /tmp only). Use port ${l.port}. Integrator report: ${JSON.stringify(polish)}\nPrior fixes: ${JSON.stringify(fixes)}\n${l.prompt}\nOnly report verified issues with evidence (screenshot path, selector, file:line, measured value).`,
      { label: `review-${l.key}-r${round}`, phase: 'Review', schema: REVIEW }).then(r => r && { lens: l.key, ...r })))).filter(Boolean)
  const todo = reviews.flatMap(r => r.findings.filter(f => f.severity !== 'minor' || round === 1).map(f => ({ lens: r.lens, ...f })))
  log(`round ${round}: scores ${reviews.map(r => r.lens + '=' + r.score).join(' ')}; ${todo.length} items`)
  if (!todo.filter(f => f.severity !== 'minor').length && round > 1) break
  if (!todo.length) break
  fixes.push(await agent(`${BASE}\n\nFIX ROUND ${round} — you own all of site/ (port 3016). Fix every blocker/major and all reasonable minor findings below, keeping the spec's system intact. Re-run lint/test/build and re-screenshot the affected views at 1440 and 375 and LOOK at them. Findings: ${JSON.stringify(todo)}`,
    { label: `fix-r${round}`, phase: 'Review', schema: OUT }))
}
return { foundation, data, sections, polish, fixes: fixes.filter(Boolean), reviews }
