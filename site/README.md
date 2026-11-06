Rooted marketing site: a static Next.js page whose every figure comes from `data/*.json` (refresh with `npm run snapshot` against your own Sepolia node).
Dev: `npm install && npm run dev -- -p 3011`.
Build: `npm run build` writes a static site to `out/`; upload that folder to any static host. Set these at build time for a public deploy:
- `NEXT_PUBLIC_SITE_URL`: the site's absolute origin. OG and Twitter image URLs are built from it; unset, they point at `http://127.0.0.1:3011` and social cards break.
- `NEXT_PUBLIC_DASHBOARD_URL`: a hosted dashboard. Set, the nav gets an ink "Open dashboard" button; unset, the nav shows an outline GitHub link and nothing promises an app.
Known gap against the spec: Lighthouse mobile performance measures 88–95 (median 91.5 over 6 runs on a busy 8-core host; TBT 263–485 ms, LCP 1.07 s, CLS 0). Desktop scores 100, and a11y, best practices and SEO score 100 on both. What is left is evaluating the framework bundle and hydrating about 1,600 elements.
