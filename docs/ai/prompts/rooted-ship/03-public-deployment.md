# Public HTTPS deployment on server

Task prompt given to one background Claude Code agent from the main Claude Code session on 2026-11-06T14:07:46.514Z (UTC), verbatim except infrastructure details, which are replaced with `<placeholders>`.

---

Deploy Rooted (Go backend + Postgres + Next.js dashboard, Sepolia Glamsterdam observability) to stable public HTTPS URLs on this server, for hackathon judges. The user approved making it public.

Facts already verified:
- Public IPv4 is <public-ip>. Inbound ports 80 and 443 are reachable from the internet (tested from another host).
- <host facts>
- cloudflared is at <path>. It's a fallback only.

Target URLs (sslip.io resolves to the IP; Caddy gets Let's Encrypt certificates automatically):
- Dashboard (hosted mode): https://app.91-98-123-155.sslip.io
- Marketing site: https://91-98-123-155.sslip.io. It isn't built yet: another agent is making a static Next export in /home/ubuntu/Rooted-site/site. For now, have this host serve <deploy-dir>/site with Caddy file_server and a fallback that redirects to the app host when that directory has no index.html. Then deploying the site later is just copying `site/out` there.
If Let's Encrypt fails for sslip.io, try nip.io; only if both fail, use cloudflared quick tunnels and report it.

Steps:
1. Code checkout: /home/ubuntu/Rooted-live is a detached git worktree of main (10656bc). Use it read-only, apart from builds.
   - Run a real `npm ci` in dashboard/. Symlinked node_modules break the Turbopack build.
   - Build the Go binary with ~/sdk/go/bin/go.
   - Run `npm run build`.
2. Environment file <deploy-dir>/env, mode 600. Never print secret values in output or logs. Copy from the gitignored env files (read without echoing):
   - /home/ubuntu/Rooted/.env (DB, RPC, etc.)
   - /home/ubuntu/Rooted-picks/dashboard/.env.local and /home/ubuntu/Rooted-picks/.env (x402 hosted config and ANTHROPIC_API_KEY)
   Overrides:
   - DB: database `rooted_live`.
   - Node: RPC http://127.0.0.1:<rpc-port>, beacon http://127.0.0.1:<beacon-port>.
   - Hosted mode: ROOTED_HOSTED=1.
   - Backend URL: http://127.0.0.1:<backend-port>.
   Also pre-set these for the Analyst feature that lands on main soon (harmless until then): <analyst settings>. Read docs/X402_HOSTED.md and the dashboard's x402 lib to get the hosted paywall variables right.
3. Database: Postgres for Rooted is at 127.0.0.1:54330 (docker compose project `rooted`).
   - NEVER touch 127.0.0.1:54329. It is an unrelated project's database, and every rooted command auto-migrates.
   - Create `rooted_live` as a copy of the database DATABASE_URL in /home/ubuntu/Rooted/.env points at, using pg_dump | psql. Others are connected, so don't use TEMPLATE.
4. systemd --user units, all with Restart=always and bound to 127.0.0.1 only:
   - `rooted-live-tunnel`: ssh -N -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 127.0.0.1:<rpc-port>:127.0.0.1:8545 -L 127.0.0.1:<beacon-port>:127.0.0.1:5052 -p 22 <ssh-user>@<node-host>. This machine's key is authorized. Do NOT touch the existing manual tunnel on 18545/15052: other work depends on it.
   - `rooted-live-backend`: the API server on 127.0.0.1:<backend-port>, plus whatever ingest/follow process keeps blocks, PayloadWatch and x-ray data fresh. Read docs/BACKEND.md, docs/SEPOLIA_NODE.md, docs/XRAY.md and the CLI to find the right commands; use separate units if needed.
   - `rooted-live-dashboard`: `next start` on 127.0.0.1:<dashboard-port>.
5. Caddy runs as a system service. Install it from the official Caddy apt repo or the official release binary. /etc/caddy/Caddyfile:
   - App host: reverse_proxy to 127.0.0.1:<dashboard-port> with `flush_interval -1`, because the dashboard streams SSE.
   - Site host: as described above.
   - Add sensible security headers.
   Do not modify any other service, container or config on this host: it runs unrelated projects (<other services>).
6. Write <deploy-dir>/deploy.sh, an idempotent redeploy. Usage: `deploy.sh [git-ref, default main]`. It should:
   - check out the ref detached in /home/ubuntu/Rooted-live;
   - run `npm ci` only if package-lock changed;
   - build Go and Next;
   - restart the units (the backend auto-migrates on start; confirm that);
   - optionally rsync a built site from a given path into <deploy-dir>/site;
   - health-check both public URLs and exit non-zero on failure.
   Also write <deploy-dir>/README.md, a short ops note covering units, logs (journalctl --user -u ...), redeploy and rollback.
7. Ports in use by other agents, never bind them: 3008, 3009, 3011-3019, 3025, 8093, 8097-8099, 18545, 15052.
8. Verify from OUTSIDE:
   - Run `ssh -p 22 <ssh-user>@<node-host> 'curl -sS -o /dev/null -w "%{http_code}" https://app.91-98-123-155.sslip.io/'` and the same for the site host.
   - Check that hosted-mode restrictions hold publicly: paid x-ray routes return 402 without payment, write and node-only routes are refused, and there is no open /api/backend passthrough for non-allowlisted paths. Read dashboard/lib/hosted* to know what should be blocked, and test 3–4 such paths from outside.
   - Take a headless screenshot of the public dashboard with playwright's chromium (~/.cache/ms-playwright) and save it to /tmp/live/dashboard.png.
   - Confirm the units survive `systemctl --user restart`.
Do not commit anything to git.

Final message:
- the working URLs and their HTTP status from outside;
- the unit names;
- the deploy command;
- what keeps data fresh;
- the hosted-restriction test results;
- anything that didn't work.
