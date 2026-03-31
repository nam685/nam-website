---
status: todo
priority: high
labels: [infra, ci, ai]
---

# Set up auto-review bot with learning database

GitHub Actions workflow that auto-reviews PRs using Claude Code.

## Requirements

1. **Trigger**: when PR is marked as ready (removed from draft)
2. **Agent convention**: agents push PRs as draft, human or `/ship` marks ready
3. **Auth**: `CLAUDE_CODE_OAUTH_TOKEN` stored as GitHub secret
4. **Review**: runs code-review skill on the PR, posts findings as PR comment
5. **Learning DB**: records mistakes spotted over time
   - Store as structured data (JSON/SQLite) in the repo or on the server
   - Each entry: PR number, file, issue type, severity, description, false positive flag
   - Future reviews check past learnings for similar patterns
   - Could be a Django model (part of the website) or a standalone file

## Open questions

- Learning DB: repo file vs Django model vs standalone service?
- Should the bot auto-approve if no issues found?
- Should it block merge on critical findings?

## References

- Claude Code GitHub Action: `anthropics/claude-code-action`
- PR review skill: `code-review:code-review`
