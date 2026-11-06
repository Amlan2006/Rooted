Rooted marketing site: a static Next.js page whose every figure comes from `data/*.json` (refresh with `npm run snapshot` against your own Sepolia node).
Dev: `npm install && npm run dev -- -p 3011`.
Build: `npm run build` writes a static site to `out/`; upload that folder to any static host. Set these at build time for a public deploy:
- `NEXT_PUBLIC_SITE_URL`: the site's absolute origin. OG and Twitter image URLs are built from it; unset, they point at `http://127.0.0.1:3011` and social cards break.
- `NEXT_PUBLIC_DASHBOARD_URL`: a hosted dashboard. Set, the nav and footer link a white "Open dashboard" button; unset, that button is "Get started" (it scrolls to the page's own start panel) and nothing promises an app.
Known gap against the spec: mobile Lighthouse performance is not verified at 95. On a shared host under load (load average 5–8, Lighthouse benchmark index 1,060–1,240) runs scored 88–93: LCP 1.2 s, CLS 0, TBT 330–490 ms. What remains is React hydrating about 2,200 elements in one task (about 300 ms at Lighthouse's 4× CPU throttle). Desktop scores 100; accessibility, best practices and SEO score 100 on both. Re-measure on a quiet machine.
