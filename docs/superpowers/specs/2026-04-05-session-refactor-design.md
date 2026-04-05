# Session Refactor — Session + Turn Models for /slops

## Goal

Introduce Session + Turn models for /slops to support klaude's `-c` (continue) feature. Users can submit follow-up prompts to existing sessions, creating a multi-turn conversation experience similar to Claude web. Each turn goes through independent admin approval.

**Depends on:** PR #171 (ATIF trace format) must land first. This spec assumes ATIF v1.4 is already in place.

## Motivation

The current /slops page is one prompt → one execution. klaude now supports `-c` to continue from an existing ATIF trace, enabling multi-turn sessions. Without this refactor, every follow-up requires a fresh workspace, losing all context from previous work.

## Architecture

Two models:

- **Session** — persistent workspace + trace directory. The container for a multi-turn conversation with klaude. Has denormalized status from its latest turn for efficient listing.
- **Turn** — a single prompt submission within a session. Each turn has its own approval lifecycle (pending → approved → running → done/failed, or rejected). Carries all the per-execution metadata (tokens, tool_calls, summary, error).

klaude invocation changes:
- **First turn:** `klaude "{prompt}" --auto-approve --session-dir {trace_dir}` (same as today)
- **Follow-up turns:** `klaude -c "{prompt}" --auto-approve --session-dir {trace_dir}` (adds `-c` to resume from existing trace)

klaude overwrites the same `{session_id}.json` trace file on each run — `TraceWriter.from_existing()` loads the file, appends new steps, and `save_session()` writes the complete history back. So the trace directory always has one file with the full conversation.

## Models

### Session

```python
class Session(models.Model):
    workspace = models.CharField(max_length=255, blank=True, default="")  # set on first turn approval
    trace_path = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=20, default="pending")  # denormalized from latest non-rejected turn
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="session_status_created_idx"),
        ]
```

`status` is denormalized — set to the status of the latest non-rejected turn. Updated whenever a turn changes state. If all turns are rejected, session status = "rejected". This means:
- Turn submitted → session = "pending"
- Turn approved → session = "approved"
- Turn running → session = "running"
- Turn done → session = "done"
- Turn failed → session = "failed"
- Turn rejected (but prior done turn exists) → session = "done" (latest non-rejected)
- All turns rejected → session = "rejected" (excluded from list)

### Turn

```python
class Turn(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("running", "Running"),
        ("done", "Done"),
        ("failed", "Failed"),
    ]

    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="turns")
    prompt = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    submitter_ip = models.GenericIPAddressField()

    # timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    # execution results
    token_count = models.IntegerField(default=0)
    tool_calls = models.IntegerField(default=0)
    summary = models.TextField(blank=True, default="")
    error = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["created_at"]  # chronological within session
        indexes = [
            models.Index(fields=["session", "status"], name="turn_session_status_idx"),
            models.Index(fields=["submitter_ip", "-created_at"], name="turn_ip_created_idx"),
        ]
```

## API Changes

All endpoints stay under `/api/slops/`. Sessions with nested turns.

### Session endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/slops/` | GET | — | List sessions (paginated). Each session includes its turns array. Excludes sessions where all turns are rejected. |
| `GET /api/slops/<id>/` | GET | — | Session detail with all turns. |
| `GET /api/slops/<id>/trace/` | GET | — | Full ATIF trace. Reads the single `.json` file from session's trace_path. Same shape as ATIF PR: `{trace: ATIFDocument}`. |
| `GET /api/slops/stats/` | GET | — | Aggregate stats (computed from turns). |

### Turn endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `POST /api/slops/submit/` | POST | — | Submit prompt. Body: `{"prompt": "...", "session_id": N?}`. If `session_id` omitted, creates new session. Rate limited 1/hr/IP. |
| `POST /api/slops/turns/<turn_id>/approve/` | POST | admin | Approve turn + queue Celery task. Optional body: `{"workspace": "..."}` (only for first turn of new session). |
| `POST /api/slops/turns/<turn_id>/reject/` | POST | admin | Reject turn. |

### Submission rules

1. **Rate limit:** 1 submission per hour per IP (same as today, checked across all turns).
2. **Max prompt:** 5000 characters.
3. **One pending turn per session:** If a session already has a turn with status `pending`, `approved`, or `running`, new submissions to that session are rejected with 409.
4. **New session:** When `session_id` is omitted, a new Session is created with `workspace=""` (set on approval).
5. **Follow-up:** When `session_id` is provided, the session must exist and have no active turn (rule 3).

### Approval

When approving a turn:
- If it's the first turn of the session (no prior completed turns): set `session.workspace` to the provided workspace or `session-{session.id}`. Set `session.trace_path` to the trace directory.
- Queue `run_turn` Celery task.

### Serialization

**Session response:**
```json
{
  "id": 1,
  "workspace": "session-1",
  "status": "done",
  "created_at": "2026-04-05T10:00:00Z",
  "turns": [
    {
      "id": 1,
      "prompt": "set up the project",
      "status": "done",
      "submitter_ip": "1.2.3.4",
      "token_count": 500,
      "tool_calls": 12,
      "summary": "Set up the project structure...",
      "error": "",
      "created_at": "...",
      "approved_at": "...",
      "started_at": "...",
      "completed_at": "..."
    }
  ]
}
```

**List response:**
```json
{
  "sessions": [...],
  "total": 42
}
```

**Stats response (unchanged shape, different source):**
```json
{
  "total_sessions": 10,
  "total_turns": 25,
  "total_tokens": 50000,
  "total_tool_calls": 300,
  "success_rate": 85.0
}
```


### Trace response

Unchanged from ATIF PR. klaude overwrites the same trace file on each turn, so there's always one file with the full conversation:

```json
{
  "trace": { "schema_version": "ATIF-v1.4", "session_id": "...", "steps": [...], "final_metrics": {...} }
}
```

## Celery Task Changes

Celery task `run_turn` receives a `turn_id`.

```python
@app.task(max_retries=0)
def run_turn(turn_id):
    turn = Turn.objects.select_related("session").get(id=turn_id)
    session = turn.session

    is_continuation = Turn.objects.filter(session=session, status="done").exclude(id=turn.id).exists()

    cmd = ["sudo", "-u", KLAUDE_USER, KLAUDE_BIN]
    if is_continuation:
        cmd.append("-c")  # resume from existing trace
    cmd += [turn.prompt, "--auto-approve", "--session-dir", session.trace_path]
```

Key change: add `-c` flag when the session has prior completed turns. klaude loads the existing ATIF file via `TraceWriter.from_existing()`, appends new steps, and overwrites. After execution, update `turn` fields and `session.status`.

## Frontend Changes

### TypeScript types (api.ts)

Session/Turn types:

```typescript
export type TurnStatus = "pending" | "approved" | "running" | "done" | "failed" | "rejected";

export interface Turn {
  id: number;
  prompt: string;
  status: TurnStatus;
  submitter_ip: string;
  token_count: number;
  tool_calls: number;
  summary: string;
  error: string;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface Session {
  id: number;
  workspace: string;
  status: string;
  created_at: string;
  turns: Turn[];
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

export interface SessionTrace {
  trace: ATIFDocument | null;
}

export interface SlopsStats {
  total_sessions: number;
  total_turns: number;
  total_tokens: number;
  total_tool_calls: number;
  success_rate: number;
}
```

### Page component (slops/page.tsx)

**Sidebar:**
- Lists sessions.
- Each entry shows: first turn's prompt (truncated), session status badge, aggregate token count (sum of turns), timestamp.
- Badge color derived from `session.status`.

**Main area:**
- When a session is selected, show its turns as a timeline above the trace viewer.
- Each turn shows: prompt text, status badge, timestamps.
- Admin approve/reject buttons appear on pending turns (not on the session).
- Error and summary display come from the latest turn, not the session.

**Submit form:**
- When viewing a session: submit creates a follow-up turn (`session_id` in body).
- When not viewing a session (or in "new" mode): submit creates a new session.
- If session has an active turn (pending/approved/running), disable the submit form with message "Waiting for current turn to complete".

**Polling:**
- Poll when any session has status pending/approved/running (same logic, just keyed on sessions).
- Fetch session detail + trace for selected session.

### TraceViewer

- No structural change — still receives a single `ATIFDocument` since klaude overwrites the trace file with the full conversation on each turn.
- Turn boundaries are visible from the user steps in the ATIF data (each user step = start of a turn).
- No code changes needed beyond the ATIF PR's TraceViewer.

## Migration Strategy

Clean break — no data migration needed (existing data is throwaway):

1. Remove old model + migration.
2. Create Session and Turn models (new migration).
3. Update `models/__init__.py`, `views/__init__.py`, `urls.py`.

## Scope Exclusions

- **Session titles/naming:** Sessions are identified by their first turn's prompt. No editable title field for now.
- **Turn editing:** Once submitted, prompts cannot be edited.
- **Session deletion:** No delete endpoint. Can be added later if needed.
- **Multi-user attribution:** Turns track `submitter_ip` but there's no user account system. Anyone can submit follow-ups to any session.
- **Workspace sharing between sessions:** Each session gets its own workspace. No shared workspace feature.
- **Streaming/SSE:** Polling stays at 5s interval. Real-time streaming is a separate feature.
- **Session archiving:** No archive/hide functionality for old sessions.
