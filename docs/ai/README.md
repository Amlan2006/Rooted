# AI usage

Rooted was built with Anthropic Claude through Claude Code, running coordinated agents from workflow scripts. The
team chose the direction and the prizes, ran the node, and reviewed and tested the results. Agent work landed in
batches, one commit series per round, which is why parts of the git history arrive in bursts.

| File | What it is |
|---|---|
| [`prizes.md`](prizes.md) | The prize brief the agents worked from, fetched from ethglobal.com on 2026-11-06 |
| [`../superpowers/specs/2026-11-06-three-picks-design.md`](../superpowers/specs/2026-11-06-three-picks-design.md) | Implementation contract for the X-ray and the three partner picks |
| [`prompts/workflows/`](prompts/workflows/) | Workflow scripts, verbatim |
| [`prompts/rooted-repo-context/`](prompts/rooted-repo-context/) | Read-only map of the repo (8 agents) |
| [`prompts/rooted-three-picks/`](prompts/rooted-three-picks/) | Contract, five builders, integrator and the first review round (10 agents) |
| [`prompts/rooted-site/`](prompts/rooted-site/) | The marketing site (6 agents) |

Keys stay in gitignored env files and were never given to a prompt.
