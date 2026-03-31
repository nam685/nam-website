# Backlog

DIY Linear — file-based issue tracker. Each `.md` file is a ticket.

## How it works

- One file per ticket: `backlog/<id>-<slug>.md`
- IDs are sequential: `001`, `002`, etc.
- Each ticket has YAML frontmatter with status, priority, labels
- Statuses: `todo`, `in-progress`, `done`, `blocked`
- Priorities: `critical`, `high`, `medium`, `low`, `someday`

## Conventions

- **Agents**: when starting work, set status to `in-progress`. When done, set to `done`.
- **New features**: create a ticket before starting work.
- **Keep it lean**: one ticket per deliverable unit of work. If it's bigger than a PR, break it up.

## Quick view

```bash
# All open tickets
grep -l "status: todo\|status: in-progress\|status: blocked" backlog/*.md

# High priority
grep -l "priority: critical\|priority: high" backlog/*.md
```
