# Slops Tool Radar — Design

**Date:** 2026-07-26
**Status:** Approved

## Goal

Add a "tool radar" to the existing `/slops` page (not a new subpage) that lets Nam
discover trendy devops/agent-harness tools and track which tools he's using are
getting stale enough to drop. Public and read-only for visitors, as part of the
`/slops` showcase; only the admin can add/edit/triage entries.

Motivating example: a coworker recommended `herdr` (a terminal multiplexer for AI
coding agents) — this should be easy to jot down and revisit later, and the radar
should also surface tools like it automatically instead of relying only on word of
mouth.

## Approach

### Data model — `website/models/tool.py`, `TrackedTool`

```python
class TrackedTool(models.Model):
    STATUS_CHOICES = watching / adopted / dropped   # default: watching

    name = CharField
    url = URLField
    category = CharField                  # e.g. "harness", "cli", "spec-driven"
    status = CharField(default="watching")
    is_new = BooleanField(default=True)   # badge only; cleared on first admin touch
    source = CharField                    # "manual" or "feed:best-of-agent-harnesses"
    source_key = CharField                # stable slug/URL from feed; dedup key on re-sync
    notes = TextField(blank=True)         # e.g. "coworker rec", "why dropped"
    stars = IntegerField(null=True)       # snapshot from feed; null for manual entries
    added_at = DateTimeField(auto_now_add=True)
    last_reviewed_at = DateTimeField(auto_now_add=True)
```

Three statuses, not four — a separate "new" status was considered and rejected in
favor of `is_new` as a badge inside `watching`, since the only practical difference
was presentation, not behavior.

- **Manual add** (coworker recommendation, something read about): admin creates with
  `status="watching", is_new=False` — already reviewed by definition.
- **Feed sync**: creates with `status="watching", is_new=True`. `is_new` clears the
  first time an admin opens/acts on the entry (view-triage, not passive page load
  by a visitor).
- **Staleness**: no extra field. Any `watching`/`adopted` entry with
  `last_reviewed_at` older than 90 days (a module-level constant, easy to tune) is
  flagged stale at read time. An admin "still relevant" action just bumps
  `last_reviewed_at` to now.

### Feed sync — `website/tasks.py`

- New Celery task fetches the `best-of-Agent-Harnesses` published JSON/`llms.txt`
  feed, filters to a hardcoded allowlist of relevant category tags (e.g. `cli`,
  `harness`, `orchestration`, `spec-driven` — adjust the constant as the source's
  taxonomy is better understood), and upserts by `source_key`.
- Upsert only touches `stars` and existence; it never overwrites `status`, `notes`,
  or `last_reviewed_at` on an existing row, so triage decisions are never clobbered
  by a re-sync.
- **Trigger — both, matching the `listens`/`watches`/`bets` convention:**
  - Weekly entry in `CELERY_BEAT_SCHEDULE` (`config/settings.py`), alongside
    `sync-listens-daily`/`enrich-aoe2-ladder-daily`.
  - Admin-triggered `POST /api/tools/sync/` for on-demand refresh, with
    `GET /api/tools/sync-status/` for polling (same shape as the existing sync
    endpoints).

### Views — `website/views/tools.py`

| Endpoint | Access | Behavior |
|---|---|---|
| `GET /api/tools/` | public | List all tracked tools (all statuses — dropped entries stay visible with their reason, not deleted). |
| `POST /api/tools/sync/` | admin | Trigger the Celery sync task manually. |
| `GET /api/tools/sync-status/` | admin | Last-sync timestamp + running state. |
| `POST /api/tools/create/` | admin | Manual add (name/url/category/notes). |
| `POST /api/tools/<id>/update/` | admin | Change status/notes/category, or bump `last_reviewed_at` ("still relevant"). Also where `is_new` clears. |
| `POST /api/tools/<id>/delete/` | admin | Remove a tool entirely (distinct from `status="dropped"`, which is a kept-with-reason state). |

Follows the existing `website/models/<name>.py` / `website/views/<name>.py` split;
registers in the `models/__init__.py` and `views/__init__.py` re-exports and
`website/urls.py` per `CLAUDE.md`.

### Frontend — `frontend/src/app/slops/`

- Top of the page gets a **Sessions / Tools** tab toggle (local state in
  `page.tsx`, no route change — `/slops` stays a single route).
- Inside the Tools view, a second-level horizontal tab strip: **Watching /
  Adopted / Dropped**, paged left/right, with **Adopted selected by default**.
- Each row: name, category, link, stars (if feed-sourced), notes, and — only in
  the Watching tab — a "NEW" badge for `is_new` entries and a "stale" badge for
  entries past the 90-day review threshold.
- Admin-only, gated the same way the existing approve/reject menu is (bearer
  token already used elsewhere on this page):
  - "+ Add tool" form (manual entries).
  - "Sync now" button + status indicator.
  - Per-row status change (watching → adopted / dropped, with a reason field
    required when moving to dropped) and a "still relevant" button to clear
    staleness.
- New pure helper in `frontend/src/lib/` for the staleness-threshold calculation,
  covered by a vitest test per the project's testing convention (only pure
  `lib/` functions are unit-tested on the frontend).

## Testing

- Backend: `website/tests/test_tools.py` — CRUD endpoints, admin-auth gating on
  all mutating endpoints, sync upsert/dedup behavior (re-sync doesn't clobber
  status/notes, does refresh stars), staleness threshold logic.
- Frontend: vitest test for the staleness-calculation helper in
  `frontend/src/lib/__tests__/`.
- Manual: add a tool manually (e.g. herdr), trigger a sync, confirm dedup on a
  second sync, confirm dropped entries stay visible with their reason, confirm
  the stale badge appears/clears correctly, confirm public visitors can view but
  not see any admin controls.

## Docs

Per `CLAUDE.md`, update `docs/README.md` (new bullet under the Slops section)
and `docs/QA-CHECKLIST.md` (new checklist items for the Tools tab: tab
switching, sync button, manual add, status triage, stale badge, public
read-only view) when this ships.

## Out of scope

- Automated GitHub-trending scraping or any source beyond
  `best-of-Agent-Harnesses` (raised and explicitly deferred during brainstorming).
- Historical rank/star trend charts — only the latest snapshot is stored.
- Notifications/alerts when something goes stale (the badge is passive; no
  email/push).
