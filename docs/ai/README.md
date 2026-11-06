# AI usage

Claude Code agents running Claude Opus 5.5 (`claude-opus-5-5`) wrote the code and docs listed below from specs the
team approved. The team chose the direction and the prizes, ran the Sepolia node, directed every round, and reviewed
and ran the results.
The three-picks, analyst and polish workflows ran builders in parallel, then an integrator, review agents and fix
rounds. Agent work landed one commit series per round, which is why parts of the git history arrive in bursts.

## What AI wrote

| Area | Files | How |
|---|---|---|
| Block X-ray | `internal/xray/`, `internal/api/xray.go`, `internal/config/xray.go`, `migrations/008_xray.sql`, the `xray` commands in `cmd/rooted/`, replay fixes in `internal/profiler/` and `workloads/profiler/`, `docs/XRAY.md` | Built from the [three-picks spec](../superpowers/specs/2026-11-06-three-picks-design.md) (agent I1), two review rounds with fixes, live run over 101 Sepolia blocks |
| Uniswap labels | `internal/uniswap/{v4,labels,verify}.go` and tests, `FEEDBACK.md`, `docs/UNISWAP.md` | Same spec (I2), reviewed, pools verified against the v3 factory on Sepolia |
| Frame conformance | `scripts/frame_conformance.py`, `scripts/test_frame_{build,conformance}.py`, `integrations/frame-conformance/`, `internal/api/frame_conformance.go`, changes in `scripts/test_frame_transaction.py`, `internal/framemempool/` and `internal/config/frame.go`, `docs/FRAME_CONFORMANCE.md` | Same spec (I3), reviewed, run against the alt-mempool devnet, where our frame tx was admitted and included |
| X-ray and frame views | `dashboard/components/{xray,frame-conformance}.tsx`, `dashboard/lib/{xray,frame-conformance,hosted}.ts`, `dashboard/app/api/xray/`, their tests | Same spec (I4), reviewed, unit-tested |
| x402 on Hedera | `dashboard/lib/x402.ts`, `dashboard/app/api/paid/`, `integrations/x402-agent/`, `docs/X402_HOSTED.md` | Same spec (I5), security review, three payments settled on Hedera testnet |
| Analyst and briefs | `dashboard/lib/analyst/`, `dashboard/app/api/analyst/`, `dashboard/components/analyst.tsx`, `dashboard/scripts/briefs.ts`, `internal/analyst/`, `internal/api/analyst.go`, `migrations/009_analyst_briefs.sql`, `docs/ANALYST.md` | Built from the [analyst spec](../superpowers/specs/2026-11-06-rooted-analyst-design.md) (B1–B3), correctness and demo-readiness reviews with fixes, live questions with real spend and one Hedera payment |
| CI | `.github/workflows/ci.yml` | [One agent](prompts/rooted-ship/01-ci-docs.md), jobs passed in a clean clone; runs on push to main and on pull requests |
| Node-offline notice | `dashboard/lib/data.ts`, `dashboard/components/dashboard.tsx`, `dashboard/tests/node-offline.test.ts` | [One agent](prompts/rooted-ship/02-demo-resilience.md), every view walked with the node cut off |
| Uniswap contention and hosted polish | the `uniswap_contention` analyst tool and its endpoint over stored X-rays (`dashboard/lib/analyst/`, `internal/api/xray.go`, `internal/xray/`), hosted-mode fixes in `dashboard/` | The [polish workflow](prompts/workflows/rooted-polish.js): three builders in parallel worktrees, then an integrator, two review agents and a fixer |
| Subsystem docs and evidence | the remaining `docs/*.md` pages (backend, API, PayloadWatch, BAL analyzer, frame monitor, profiler, providers, dashboard), `docs/verification/`, `demo/`, testdata under `internal/`, probe and smoke scripts in `scripts/` | Agents recaptured the fixtures from the live node and frame devnet and updated the docs and scripts to match (`e1542f8`, `306a10b`), then re-ran the test suites |
| Specs and docs | the specs, `README.md`, `docs/ai/` | The architect agent wrote the three-picks spec and the main Claude Code session the analyst and site specs, from directions the team chose; integrator and docs agents wrote the README and this folder from the verified runs above |

The first seven commits (`0b801d2` to `f61fca1`, by Amlan2006: foundation, backend tests, PayloadWatch, frame
mempool monitor, BAL analyzer, dashboard, provider comparison and profiler) were not made by these workflows. The
rows above cover what agents added or changed after them. The marketing site, the public deployment and the
submission texts live outside the repo; their prompts are in [`prompts/rooted-site/`](prompts/rooted-site/) and
[`prompts/rooted-ship/`](prompts/rooted-ship/).

## Specs, prompts and plans

| File | What it is |
|---|---|
| [`prizes.md`](prizes.md) | The prize brief the agents worked from, fetched from ethglobal.com on 2026-11-06 |
| [`../superpowers/specs/2026-11-06-three-picks-design.md`](../superpowers/specs/2026-11-06-three-picks-design.md) | Implementation contract for the X-ray and the three partner picks |
| [`../superpowers/specs/2026-11-06-rooted-analyst-design.md`](../superpowers/specs/2026-11-06-rooted-analyst-design.md) | Implementation contract for the analyst |
| [`../superpowers/specs/2026-11-06-site-design.md`](../superpowers/specs/2026-11-06-site-design.md) | Design for the marketing site |
| [`prompts/workflows/`](prompts/workflows/) | Workflow scripts: repo context, three picks, site, analyst, polish. The polish prompts (three builders, integrator, two reviewers, fixer) are inline in [`rooted-polish.js`](prompts/workflows/rooted-polish.js) |
| [`prompts/rooted-repo-context/`](prompts/rooted-repo-context/) | Read-only map of the repo (8 agents) |
| [`prompts/rooted-three-picks/`](prompts/rooted-three-picks/) | Contract, five builders, integrator and the first review round (10 agents) |
| [`prompts/rooted-site/`](prompts/rooted-site/) | The marketing site (6 agents) |
| [`prompts/rooted-analyst/`](prompts/rooted-analyst/) | Three builders, integrator, two reviewers and the fixer (7 agents) |
| [`prompts/rooted-ship/`](prompts/rooted-ship/) | CI, offline demo, public deployment and submission pack (4 standalone agents) |

Prompts are copied verbatim, except that infrastructure details (node host, ssh user, proxy host, public host facts,
deployment paths and ports) are replaced with `<placeholders>` and submission-rule lines are omitted. Keys stay in
gitignored env files and were never given to a prompt.
