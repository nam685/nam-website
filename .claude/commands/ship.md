Ship a completed feature: update TODO.md, write dev log, push, iterate until CI green, open PR.

## Steps

### 1. Tick TODO.md
Find the item(s) in `TODO.md` matching what was just built. Change `- [ ]` to `- [x]`.

### 2. Append to docs/development-log.md
Add a new entry at the top of the log (after the title) in this format:
```
## YYYY-MM-DD — <short title>
<1–3 sentences: what was built and why>
```
Today's date is available in your context. Keep it factual and brief.

### 3. Commit the housekeeping
Stage and commit the TODO.md and docs/development-log.md changes with message:
`chore: tick todo and log <feature name>`

### 4. Push and check CI
Push the current branch. Then poll `gh run list --branch <branch> --limit 1` every 30 seconds until the run completes.

### 5. If CI fails — fix and repeat
Read the failure logs with `gh run view <run-id> --log-failed`. Fix the issue, commit the fix, push again, and go back to step 4. Repeat until CI is green.

### 6. Open or update the PR
- If no PR exists: `gh pr create` with a clear title and summary.
- If a PR already exists: confirm it's up to date — nothing more needed.

Do not tell the user to check the site until after they merge and the deploy workflow completes.
