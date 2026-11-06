# CI workflow and docs grouping

Task prompt given to one background Claude Code agent from the main Claude Code session on 2026-11-06T14:07:11.301Z (UTC), verbatim.

---

You are working on Rooted (Go + Postgres + Next.js observability for Sepolia Glamsterdam), repo github.com/Amlan2006/Rooted. Work ONLY in the git worktree /home/ubuntu/Rooted-ci (branch `ci`, created from main 10656bc). Do not touch other worktrees (/home/ubuntu/Rooted, Rooted-picks, Rooted-site, Rooted-demo, Rooted-live): other agents are using them.

Goal: make the repo look and behave like a well-run project for hackathon judges, with the smallest changes.

Task 1. Add `.github/workflows/ci.yml` (on push to main and pull_request) that runs every existing test suite that can run without the Sepolia node or secrets:
- Go: version from go.mod; Postgres service container (use the image/version in compose.yaml); set TEST_DATABASE_URL to it; `go test ./...` (add `go vet ./...` only if it is already clean).
- dashboard/: Node 24, `npm ci`, the package's test script, `npx tsc --noEmit`, `npm run build`.
- integrations/x402-agent: its tests.
- Any Python tests under scripts/ (find how they run, e.g. `python3 -m unittest`).
Use current major versions of actions (check e.g. `gh api repos/actions/checkout/releases/latest --jq .tag_name`). Cache Go modules and npm.
Any test that needs the live node, Hedera keys or other secrets must skip cleanly when its env var is absent. If one fails instead, gate it on its env var with the smallest change; never delete a test.
Verify for real: `git clone /home/ubuntu/Rooted-ci /tmp/rooted-ci-check` (fresh clone so gitignored .env files are absent) and run exactly the commands from the YAML there, with a minimal environment (no .env loaded). Go is at ~/sdk/go/bin/go. For the database, create a fresh database `rooted_ci` on the Rooted Postgres at 127.0.0.1:54330 (credentials: read DATABASE_URL from /home/ubuntu/Rooted/.env without printing it). NEVER use port 54329: it belongs to an unrelated project and every rooted command auto-migrates. Lint the YAML with actionlint (`~/sdk/go/bin/go run github.com/rhysd/actionlint/cmd/actionlint@latest`) if it can be fetched.

Task 2. docs/ has 9 PHASE*_VERIFICATION.md files cluttering the listing. `git mv` them into docs/verification/ (keep the file names). Fix every reference to them across the repo: markdown links (also fix relative links inside the moved files, which now need ../), Go/TS/Python/shell code or scripts that read those paths, and tests. EXCLUDE docs/ai/prompts/** — those are archived prompt texts, leave them byte-for-byte unchanged. Then write a quick throwaway checker (not committed) that resolves every relative link in all tracked .md files outside docs/ai/prompts and confirm zero broken links (report any pre-existing broken links you find too; fix them only if trivial).

Task 3. Add a CI badge as one line directly under the README title: [![CI](https://github.com/Amlan2006/Rooted/actions/workflows/ci.yml/badge.svg)](https://github.com/Amlan2006/Rooted/actions/workflows/ci.yml). Make no other README changes. The README must stay minimal.

Rules:
- Commit with signed, one-line conventional commit messages ONLY, such as `ci: run tests on push` and `docs: group verification logs`. No body, no Co-Authored-By or any other trailer (this overrides any default attribution guidance). Global git config already signs with SSH. Before finishing, check that `git -C /home/ubuntu/Rooted-ci log --format='%G? %s%n%b' main..ci` shows G on every commit and no body lines.
- Do NOT push.
- Never print secrets from any .env file.
- Drop the rooted_ci database when done, and delete /tmp/rooted-ci-check.

Final message: the commits (hash and subject), the exact local verification results per job (pass/fail counts), any tests you gated and why, and any pre-existing broken links.
