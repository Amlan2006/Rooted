# Rooted marketing site: design

Approved 2026-11-06, visual system revised the same day. A standalone, static landing site for Rooted in `site/`, separate from the operator dashboard in `dashboard/`.

## Intent

- **Audience:** ETHGlobal judges, Ethereum protocol researchers and client teams, builders who might self-host or call the hosted API.
- **Job:** in under 30 seconds, show what Rooted checks (ePBS payloads, block access lists, native replay, frame mempool) and prove it with real data. Then send people to the dashboard, the docs or GitHub.
- **Success:** it looks like a YC-backed devtool (Resend, Linear, Mintlify, Vercel changelog), every figure is real and sourced, and it holds up at 375, 768 and 1440 px.

## Visual system: dark precision

Approved from the mockup at `/home/ubuntu/rooted-design/mock.html` (screenshot `m1.png`). Product-first, in the spirit of Linear, Vercel, Railway and Resend: the product UI is the hero, type does the rest.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#08090A` | page |
| `--surface-1` | `#0D0E10` | app window, raised panels |
| `--surface-2` | `#121316` | cards inside windows |
| `--line` | `rgba(255,255,255,.07)` | 1px hairlines, grid |
| `--line-strong` | `rgba(255,255,255,.11)` | control and window borders |
| `--fg` | `#F4F5F6` | text, primary buttons (black text on white) |
| `--fg-2` | `#9BA1A9` | secondary text |
| `--fg-3` | `#7D838C` | small muted labels (AA on `--bg`) |
| `--fg-4` | `#5B6068` | large text only: the second, dimmed line of two-tone headlines |
| `--acc` | `#4BE38F` | the only accent: "verified / live / selected". Live dots, verified marks, the one highlighted data element per figure, eyebrows, focus rings. Never a big fill or a button. |
| `--warn` / `--bad` | `#F5B54A` / `#F87171` | status only (dashboard) |

- **Type:** Geist for everything, Geist Mono (`tabular-nums`) for numbers, hashes, code and data labels. No serif anywhere.
  - Display 72 to 88 px, weight 600, line-height 0.98, tracking -0.05em. Two-tone headlines: the second line in `--fg-4`.
  - h2 44 to 52 px, weight 600, tracking -0.04em, same two-tone trick.
  - Body 16 to 19 px, line-height 1.5, `--fg-2`, with key terms in `--fg` weight 500.
  - Eyebrows: 13 px Geist weight 500 in `--acc`, sentence case. No `01 /` numbering, no uppercase-tracked labels everywhere.
- **Layout:** 1120 px content width. Left-aligned hero and section heads. Sections separated by space (140 px), not rules.
- **Surfaces:** 1px borders. Radius 8 px for buttons and inputs, 10 px for cards, 14 px for windows and bento grids.
  - Raised panels get `inset 0 1px 0 rgba(255,255,255,.05)`.
  - Only the hero app window gets a deep shadow.
  - Bento grids use 1px gaps on a `--line` background.
- **Atmosphere:** a faint 80 px line grid behind the hero, radially masked so it fades out. The sticky nav may use `rgba(8,9,10,.72)` with `backdrop-filter: blur(12px)`. Nothing else is translucent.
- **Banned** (reviewers reject on sight):
  - Visual:
    - gradient text, or coloured gradient backgrounds, borders or glows;
    - purple, indigo or blue;
    - blobs, noise, glass cards;
    - emoji, and sparkle or "AI magic" icons;
    - icon-in-a-coloured-circle feature cards;
    - serif display type, and uppercase-tracked mono labels used as decoration;
    - centered hero stacks, stock 3D.
  - Fake content: logo walls, testimonials, user counts, made-up numbers.
  - Copy: marketing filler such as revolutionize, unleash, supercharge, seamless, cutting-edge, leverage, next-gen, AI-powered.
- **Quality reference:** every component should survive a side-by-side with linear.app and vercel.com. Check each one for:
  - aligned baselines;
  - consistent 4/8 spacing;
  - optical alignment of icons;
  - no orphan words in headlines;
  - real UI density inside windows, not empty boxes.

## Honesty rule

Every number, hash, slot, block, timing and price on the page comes from `site/data/*.json`. Those files are produced by `site/scripts/snapshot.mjs` from Rooted's own Sepolia node (Geth `http://127.0.0.1:18545`, Nimbus `http://127.0.0.1:15052`) and the repo.

- Each file carries `source`, `captured_at` (ISO UTC) and the identifiers of what it covers. Any UI that shows a figure also shows its source line in muted mono, e.g. "Sepolia block 12,075,273 · captured 2026-11-06".
- Values the node cannot provide are omitted from the UI. They are never estimated.
- The site never claims arrival timing for a slot unless the snapshot measured it live (see `epbs.json`).

## Data files (`site/data/`)

| File | Contents |
|---|---|
| `hero-block.json` | Sepolia block 12,075,273 (`0xb84109`): number, hash, timestamp, gas_limit, header_gas_used (92,173,320), receipts_gas_sum (155,156,084), tx_count, and `txs[]` of `{index, hash, gas_used, is_create, to}` from `eth_getBlockReceipts`; slot, beacon_root and builder_index from Nimbus if retained. The capping tx is the max `gas_used` (index 72, 55,719,446, contract creation). |
| `blocks.json` | The last ~24 consecutive head blocks at capture time: number, hash, tx_count, gas_limit, header_gas_used, receipts_gas_sum, slot, builder_index, payload_present_votes and ptc_size (from the next beacon block's `payload_attestations` aggregation bits with `payload_present=true`). |
| `epbs.json` | One fresh slot's lifecycle measured live by subscribing to Nimbus `/eth/v1/events` (`block`, `execution_payload`, `execution_payload_available`, `payload_attestation_message`) for about 90s. Includes local receipt offsets in ms from slot start (`genesis_time + slot*12s`), labelled "received at our node", plus the included PTC tally from the next block. |
| `pricing.json` | Hosted x402 price, network and asset, read from the x402 config on branch `picks` (`/home/ubuntu/Rooted-picks/dashboard/lib/x402*.ts` or `.env.example`) if it exists. Otherwise `{ "price": null }`, and the UI shows "Priced per request in the 402 response" with no number. |
| `meta.json` | Repo facts: license, Go/Node versions, GitHub URL `https://github.com/Amlan2006/Rooted`, docs links. |

## Page structure (single page `/`)

| # | Section | File | Content |
|---|---|---|---|
| — | Nav | `components/nav.tsx` | Logo mark (rounded square with a root glyph in `--acc`) and "Rooted". Links: Product · Analyst · Hosted API · Docs ↗. Right side: GitHub (ghost) and Open dashboard (white). Sticky and blurred after scroll. Mobile sheet with a focus trap. |
| 1 | Hero | `components/sections/hero.tsx` + `components/app-window/*` | Pill "Running on Sepolia · ePBS and block access lists live", headline "See inside every / Ethereum block." (two-tone), sub with **bold** feature terms, CTAs Open dashboard (white) and `$ rooted serve` (copyable ghost). Below: a segmented **tour** (PayloadWatch · Block X-ray · Access lists · Analyst). It auto-advances every 7 s with a progress fill on the active tab, pauses on hover or focus, and is keyboard-operable. Under it sits the **AppWindow**: a faithful miniature of the dashboard (sidebar, top bar, cards) whose main pane switches with the tour. All views use snapshot data. The window footer or top bar says "snapshot · captured {date}" in `--fg-3`. Never claim it is live. |
| 2 | Metrics | `components/sections/metrics.tsx` | Four large mono figures (header gas, receipt gas, payload-available offset, PTC votes) in a hairline row, each with a one-line label and source. Then the EIP-8037 line from the old proof strip. |
| 3 | Bento | `components/sections/bento.tsx` | "Built for Glamsterdam" / "Every new rule in the fork, checked on a real chain." A 6-cell asymmetric bento: ePBS slot lifecycle (wide), access lists, Block X-ray, frame mempool (devnet badge), execution profiler, provider comparison (wide). Each cell holds a small, dense, real-data mini-UI, a title and one sentence. On hover the border brightens and the mini-UI does one subtle thing. |
| 4 | Analyst | `components/sections/analyst.tsx` | Left: eyebrow "Rooted Analyst", h2 "Ask a block anything. / It shows its work.", three short facts (tools it calls, paying for reports over x402 on Hedera, evidence-cited briefs on HCS). Right: a chat window that plays a REAL brief or run from `site/data/analyst.json`: the question, tool steps appearing one by one with mono args, the x402 payment step with a Hedera receipt chip linking to HashScan, then the answer with `[E1]` evidence chips. |
| 5 | Tape | `components/sections/tape.tsx` | Dark marquee of `blocks.json` (number, txs, gas bar, builder, PTC). Pauses on hover; static row with reduced motion. |
| 6 | How | `components/sections/how.tsx` | Architecture in 4 steps on one connected line: your node → verify (roots, payload hashes, BAL commitments) → store (replayable captures) → explain (dashboard, API, Analyst, x402). |
| 7 | Developers | `components/sections/terminal.tsx` | Tabs CLI / API / Agent in a terminal window, with the real commands and x402 exchange from the current site. Copy button. |
| 8 | Pricing | `components/sections/pricing.tsx` | Two cards: Self-host (free, MIT) and Hosted API (x402 on Hedera testnet, price from `pricing.json`). No fake tiers. |
| 9 | FAQ | `components/sections/faq.tsx` | Same honest Q&As, as a dark accordion. |
| 10 | Final CTA | `components/sections/cta.tsx` | Big two-tone h2 "Run it against / your own node." with both CTAs, over the faint grid. |
| — | Footer | `components/footer.tsx` | Logo, link columns (Product, Developers, Project), "Built at ETHGlobal Mumbai 2026 · MIT". |

Extra data file: `site/data/analyst.json` holds one real Analyst brief or run (question or trigger, tool steps, x402 payment with Hedera tx id, answer text with evidence ids, block). It comes from the live `/api/analyst/briefs` endpoint or the Rooted database, with `source` and `captured_at`. Nothing is invented and no Claude calls are made to produce it.

## Motion

Use `motion/react`. Reusable primitives in `components/motion.tsx`:

| Primitive | Behaviour |
|---|---|
| `Reveal` | 8px rise plus fade, 0.5s, ease `[0.22, 1, 0.36, 1]`, once, `amount: 0.3` |
| `Stagger` | Staggers its children |
| `CountUp` | Counts up once on view, tabular |

Other motion: button and link hover at 150 ms, the tab underline uses `layoutId`, and the accordion animates its height.

- Everything is disabled under `prefers-reduced-motion`; use the final states.
- No parallax, no scroll-jacking, no cursor followers.

## Stack and layout

- `site/` is its own Next.js app: React 19, Tailwind v4 via `@tailwindcss/postcss`, `motion`, TypeScript strict.
- `output: 'export'`, so `site/out` is static. `site/package.json` scripts: `dev`, `build`, `snapshot`, `lint` (tsc --noEmit), `test` (`node --test` for data guards).
- Shared UI primitives live in `components/ui/` (button, container, section, eyebrow, mono, badge, copy-button).
- `app/layout.tsx` sets fonts, metadata and the OG image (`app/opengraph-image.tsx`, static), and `app/icon.svg`.
- The `Open dashboard` URL comes from `NEXT_PUBLIC_DASHBOARD_URL` (default `http://127.0.0.1:3000`). Docs links point to GitHub `docs/*.md`.

## Quality bar

- No horizontal scroll or overlap at 375, 768 or 1440 px. CLS ≈ 0, with fonts using `display: swap` and size-adjust from next/font.
- WCAG AA contrast, visible `--acc` focus rings, semantic landmarks, a skip link, labelled controls, a keyboard-operable tabs and accordion (WAI-ARIA patterns).
- Lighthouse 95+ (performance, a11y, best practices, SEO) on the static build. No layout libraries beyond the above.
- `site/tests/data.test.mjs` asserts:
  - every data file has `source` and `captured_at`;
  - hero block figures match: header 92,173,320, receipts 155,156,084, capping index 72;
  - no file contains placeholder values.
- Copy is spell-checked, and every claim is traceable to data or repo docs.

## Out of scope

Blog, auth, live backend calls from the site, analytics or trackers (CROPS), i18n.
