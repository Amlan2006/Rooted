# Rooted marketing site: design

Approved 2026-11-06. A standalone, static landing site for Rooted in `site/`, separate from the operator dashboard in `dashboard/`.

## Intent

- **Audience:** ETHGlobal judges, Ethereum protocol researchers and client teams, builders who might self-host or call the hosted API.
- **Job:** in under 30 seconds, show what Rooted checks (ePBS payloads, block access lists, native replay, frame mempool) and prove it with real data. Then send people to the dashboard, the docs or GitHub.
- **Success:** it looks like a YC-backed devtool (Resend, Linear, Mintlify, Vercel changelog), every figure is real and sourced, and it holds up at 375, 768 and 1440 px.

## Visual system: editorial mono

| Token | Value |
|---|---|
| `--paper` | `#FAFAF7` (page) |
| `--paper-2` | `#F3F2EE` (inset panels) |
| `--ink` | `#0F0F0E` (text, primary buttons) |
| `--muted` | `#6B6B66` (secondary text; AA on paper) |
| `--line` | `#E7E6E1` (1px hairlines, grid guides) |
| `--signal` | `#FF5A1F` (the only accent: at most one use per viewport, e.g. the capping tx, one italic word, focus ring) |

- **Type:**
  - Display: Instrument Serif. Regular, plus italic for one accent word per headline.
  - Body and UI: Geist.
  - Numbers, labels, code, eyebrows: Geist Mono with `font-variant-numeric: tabular-nums`.
  - Load all three with `next/font/google`.
- **Scale:**
  - Display 56/64 to 88/92 px (clamp), tracking -0.02em.
  - h2 40 to 56 px serif.
  - Body 16–18 px / 1.6.
  - Mono labels 12 px uppercase, tracking 0.08em.
- **Layout:**
  - Max width 1200 px and a 12-column grid. Faint 1px column guides show only in the hero.
  - Sections are separated by full-bleed hairlines.
  - Content is left-aligned, editorial: not centered stacks.
  - Section eyebrows read `01 / Promises` in mono.
- **Surfaces:** flat. Radius 6 px on buttons, 8 px on panels. Borders, not shadows. A single shadow token is allowed only on the floating nav after scroll: `0 1px 0 var(--line)`.
- **Banned** (reviewers reject on sight):
  - Visual: gradients of any kind (text, background, border or radial glow), glassmorphism or `backdrop-blur`, glowing blobs, noise textures, emoji, sparkle or magic icons, purple/indigo, generic icon-in-a-coloured-circle feature cards, rounded-3xl cards with large drop shadows, stock 3D.
  - Fake content: logo walls, testimonials, user counts, "trusted by", lorem ipsum, made-up numbers.
  - Copy: marketing filler such as revolutionize, unleash, supercharge, seamless, cutting-edge, leverage, game-changing, next-gen, "in today's world".
  - Clever, fast copy is fine. Clichés are not.

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

| # | Section | Component file | Content |
|---|---|---|---|
| — | Nav | `components/nav.tsx` | `rooted` wordmark in Geist Mono; links Product · How it works · Pricing · Docs · GitHub; ink "Open dashboard" button. Paper background; the hairline appears after scroll. Mobile: a sheet menu with a focus trap. |
| 0 | Hero | `components/sections/hero.tsx` | Mono eyebrow "Ethereum Sepolia · Glamsterdam". Headline "Every Ethereum block, *checked.*" One-line sub: verifies ePBS payloads, access lists and execution against your own node. CTAs Self-host (ink) and Read the docs (outline). Right or below: `BlockXray`. |
| 1 | Proof strip | `components/sections/proof.tsx` | Four mono figures with count-up: header gas, receipt gas, tx count, largest single tx; plus a short serif line "Gas stopped measuring time." and an EIP-8037 link. |
| 2 | Two promises | `components/sections/promises.tsx` | (a) ePBS: horizontal slot timeline built from `epbs.json` (slot start → block → payload → PTC), offsets in mono. (b) Access lists: a compact lanes view of the same hero block. Each has a 2-line plain explanation. |
| 3 | Product | `components/sections/product.tsx` | Six cells in a hairline grid: PayloadWatch, Block X-ray, BAL analyzer, Frame mempool, Execution profiler, Provider comparison. Each has a small hand-built mono/SVG micro-illustration (no stock icons) and a one-sentence description. |
| 4 | Block tape | `components/sections/tape.tsx` | Horizontally scrolling strip of `blocks.json`: number, txs, gas bar, builder, PTC votes. Pauses on hover; with reduced motion it becomes a static scrollable row. |
| 5 | How it works | `components/sections/how.tsx` | Four steps: Node → Verify (roots, payload hashes, BAL commitments) → Store (replayable captures) → Explain. A hairline progress line draws as you scroll. |
| 6 | Use it | `components/sections/terminal.tsx` | Tabs CLI / API / Agent with a sliding underline (motion `layoutId`). Real commands from the repo docs (`rooted serve`, `rooted ingest`, `curl /api/v1/...`; the agent tab shows the x402 flow). Copy button with a check transition. |
| 7 | Pricing | `components/sections/pricing.tsx` | Two plans. **Self-host**: Free, MIT, everything included. **Hosted API**: pay per block hash via x402 on Hedera testnet, labelled "testnet", price from `pricing.json`. No fake tiers. |
| 8 | Open source + FAQ | `components/sections/faq.tsx` | One-line OSS band with GitHub link; 4 honest Q&As (what's verified vs not, why your own node, what x402 is for, what's measured vs estimated). Accessible accordion with animated height. |
| — | Footer | `components/footer.tsx` | Wordmark, links, "Built at ETHGlobal Mumbai 2026", MIT. |

**Signature visual: `components/block-xray.tsx`.**
- An SVG dot-matrix of `hero-block.json`: one lane per tx, sorted by index. Dots per lane are proportional to `gas_used` on a fixed grid, with ink dots at 80% opacity.
- The capping tx lane is drawn in `--signal`, with a mono callout: "tx 72 · contract creation · 55.72M gas".
- Lanes draw in with a stagger on first view. Hovering or focusing a lane shows a tooltip with index, gas and hash.
- It must stay legible at 375 px: wrap the lanes into a compact grid there.

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
- WCAG AA contrast, visible `--signal` focus rings, semantic landmarks, a skip link, labelled controls, a keyboard-operable tabs and accordion (WAI-ARIA patterns).
- Lighthouse 95+ (performance, a11y, best practices, SEO) on the static build. No layout libraries beyond the above.
- `site/tests/data.test.mjs` asserts:
  - every data file has `source` and `captured_at`;
  - hero block figures match: header 92,173,320, receipts 155,156,084, capping index 72;
  - no file contains placeholder values.
- Copy is spell-checked, and every claim is traceable to data or repo docs.

## Out of scope

Blog, auth, live backend calls from the site, analytics or trackers (CROPS), i18n.
