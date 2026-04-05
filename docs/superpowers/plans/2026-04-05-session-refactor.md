# Session Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot Mission model with Session + Turn to support klaude's multi-turn `-c` resume feature.

**Architecture:** Two models — Session (workspace/trace container) and Turn (individual prompt with approval lifecycle). Celery task `run_turn` adds `-c` flag for follow-up turns. Frontend sidebar lists sessions, each with nested turns. TraceViewer unchanged (klaude overwrites single ATIF file).

**Tech Stack:** Django 6.0+, PostgreSQL, Celery, Next.js 16 (React 19), TypeScript

**Depends on:** PR #171 (ATIF trace format) must be merged first. This plan assumes ATIF v1.4 types already exist in `frontend/src/lib/api.ts`.

---

### Task 1: Session and Turn Models

**Files:**
- Create: `website/models/session.py`
- Modify: `website/models/__init__.py`
- Delete: `website/models/mission.py`
- Test: `website/tests/test_slops.py`

- [ ] **Step 1: Write failing test for Session and Turn models**

Replace the entire file `website/tests/test_slops.py`:

```python
import pytest

from website.models import Session, Turn


@pytest.mark.django_db
class TestSessionModel:
    def test_create_session(self):
        s = Session.objects.create()
        assert s.status == "pending"
        assert s.workspace == ""
        assert s.trace_path == ""
        assert s.created_at is not None

    def test_str_representation(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Fix the bug in main.py", submitter_ip="127.0.0.1")
        assert "Fix the bug" in str(s)

    def test_str_no_turns(self):
        s = Session.objects.create()
        assert "empty" in str(s).lower()


@pytest.mark.django_db
class TestTurnModel:
    def test_create_turn(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Fix the bug", submitter_ip="127.0.0.1")
        assert t.status == "pending"
        assert t.prompt == "Fix the bug"
        assert t.token_count == 0
        assert t.tool_calls == 0
        assert t.summary == ""
        assert t.error == ""
        assert t.created_at is not None

    def test_turns_ordered_chronologically(self):
        s = Session.objects.create()
        t1 = Turn.objects.create(session=s, prompt="First", submitter_ip="127.0.0.1")
        t2 = Turn.objects.create(session=s, prompt="Second", submitter_ip="127.0.0.1")
        turns = list(s.turns.all())
        assert turns[0].id == t1.id
        assert turns[1].id == t2.id

    def test_cascade_delete(self):
        s = Session.objects.create()
        Turn.objects.create(session=s, prompt="test", submitter_ip="127.0.0.1")
        s.delete()
        assert Turn.objects.count() == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_slops.py::TestSessionModel::test_create_session -v`
Expected: FAIL — `ImportError: cannot import name 'Session' from 'website.models'`

- [ ] **Step 3: Create the Session and Turn models**

Create `website/models/session.py`:

```python
from django.db import models


class Session(models.Model):
    workspace = models.CharField(max_length=255, blank=True, default="")
    trace_path = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=20, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="session_status_created_idx"),
        ]

    def __str__(self):
        first_turn = self.turns.first()
        if first_turn:
            prompt = first_turn.prompt
            return prompt[:80] + ("..." if len(prompt) > 80 else "")
        return "(empty session)"


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
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["session", "status"], name="turn_session_status_idx"),
            models.Index(fields=["submitter_ip", "-created_at"], name="turn_ip_created_idx"),
        ]

    def __str__(self):
        return self.prompt[:80] + ("..." if len(self.prompt) > 80 else "")
```

- [ ] **Step 4: Update `website/models/__init__.py`**

Replace the entire file:

```python
from .drawing import Drawing
from .feedback import Feedback
from .github import GitHubContributions
from .lichess import LichessToken
from .listen import ListenTrack
from .price_snapshot import PriceSnapshot
from .project import Project
from .session import Session, Turn
from .thought import Thought
from .ticker import Ticker
from .todo import TodoItem, TodoSection
from .watch import WatchChannel, WatchVideo

__all__ = [
    "Drawing",
    "Feedback",
    "GitHubContributions",
    "LichessToken",
    "ListenTrack",
    "PriceSnapshot",
    "Project",
    "Session",
    "Thought",
    "Ticker",
    "TodoSection",
    "TodoItem",
    "Turn",
    "WatchChannel",
    "WatchVideo",
]
```

- [ ] **Step 5: Delete `website/models/mission.py`**

```bash
rm website/models/mission.py
```

- [ ] **Step 6: Create migration to remove Mission and add Session + Turn**

```bash
uv run python manage.py makemigrations website
```

Expected: creates `website/migrations/0019_*.py` that removes Mission and adds Session + Turn.

- [ ] **Step 7: Apply migration**

```bash
uv run python manage.py migrate
```

- [ ] **Step 8: Run model tests**

Run: `uv run pytest website/tests/test_slops.py::TestSessionModel website/tests/test_slops.py::TestTurnModel -v`
Expected: all 6 tests PASS

- [ ] **Step 9: Commit**

```bash
git add website/models/session.py website/models/__init__.py website/migrations/ website/tests/test_slops.py
git rm website/models/mission.py
git commit -m "feat: replace Mission with Session + Turn models"
```

---

### Task 2: Slops Views — Session CRUD + Submit + Approve/Reject

**Files:**
- Rewrite: `website/views/slops.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`
- Test: `website/tests/test_slops.py` (append)

- [ ] **Step 1: Write failing tests for all view endpoints**

Append to `website/tests/test_slops.py`:

```python
from django.utils import timezone


@pytest.mark.django_db
class TestSlopsSubmit:
    def test_submit_creates_session_and_turn(self, client):
        resp = client.post("/api/slops/submit/", {"prompt": "Fix the bug"}, content_type="application/json")
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] is not None
        assert data["status"] == "pending"
        assert len(data["turns"]) == 1
        assert data["turns"][0]["prompt"] == "Fix the bug"
        assert data["turns"][0]["status"] == "pending"
        assert Session.objects.count() == 1
        assert Turn.objects.count() == 1

    def test_submit_followup_to_existing_session(self, client):
        s = Session.objects.create(status="done")
        Turn.objects.create(session=s, prompt="First", submitter_ip="10.0.0.1", status="done")
        resp = client.post(
            "/api/slops/submit/",
            {"prompt": "Follow up", "session_id": s.id},
            content_type="application/json",
        )
        assert resp.status_code == 201
        data = resp.json()
        assert len(data["turns"]) == 2
        assert data["status"] == "pending"

    def test_submit_rejects_if_session_has_active_turn(self, client):
        s = Session.objects.create(status="running")
        Turn.objects.create(session=s, prompt="Running", submitter_ip="10.0.0.1", status="running")
        resp = client.post(
            "/api/slops/submit/",
            {"prompt": "Another", "session_id": s.id},
            content_type="application/json",
        )
        assert resp.status_code == 409

    def test_submit_rate_limited_per_ip(self, client):
        client.post("/api/slops/submit/", {"prompt": "First"}, content_type="application/json")
        resp = client.post("/api/slops/submit/", {"prompt": "Second"}, content_type="application/json")
        assert resp.status_code == 429

    def test_submit_global_rate_limit(self, client):
        for i in range(10):
            Turn.objects.create(
                session=Session.objects.create(),
                prompt=f"task {i}",
                submitter_ip=f"10.0.0.{i + 1}",
            )
        resp = client.post("/api/slops/submit/", {"prompt": "One more"}, content_type="application/json")
        assert resp.status_code == 429

    def test_submit_empty_prompt(self, client):
        resp = client.post("/api/slops/submit/", {"prompt": ""}, content_type="application/json")
        assert resp.status_code == 400

    def test_submit_prompt_too_long(self, client):
        resp = client.post("/api/slops/submit/", {"prompt": "x" * 5001}, content_type="application/json")
        assert resp.status_code == 400

    def test_submit_nonexistent_session(self, client):
        resp = client.post(
            "/api/slops/submit/",
            {"prompt": "Follow up", "session_id": 999},
            content_type="application/json",
        )
        assert resp.status_code == 404


@pytest.mark.django_db
class TestSlopsList:
    def test_list_returns_sessions_with_turns(self, client):
        s = Session.objects.create(status="done")
        Turn.objects.create(session=s, prompt="Task 1", submitter_ip="127.0.0.1", status="done")
        resp = client.get("/api/slops/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert len(data["sessions"]) == 1
        assert len(data["sessions"][0]["turns"]) == 1

    def test_list_excludes_fully_rejected_sessions(self, client):
        s1 = Session.objects.create(status="done")
        Turn.objects.create(session=s1, prompt="Good", submitter_ip="127.0.0.1", status="done")
        s2 = Session.objects.create(status="rejected")
        Turn.objects.create(session=s2, prompt="Bad", submitter_ip="127.0.0.1", status="rejected")
        resp = client.get("/api/slops/")
        data = resp.json()
        assert data["total"] == 1

    def test_list_pagination(self, client):
        for i in range(25):
            s = Session.objects.create()
            Turn.objects.create(session=s, prompt=f"Task {i}", submitter_ip="127.0.0.1")
        resp = client.get("/api/slops/?limit=10&offset=0")
        data = resp.json()
        assert len(data["sessions"]) == 10
        assert data["total"] == 25


@pytest.mark.django_db
class TestSlopsDetail:
    def test_detail_returns_session_with_turns(self, client):
        s = Session.objects.create(status="done", workspace="session-1")
        Turn.objects.create(session=s, prompt="Fix it", submitter_ip="127.0.0.1", status="done")
        resp = client.get(f"/api/slops/{s.id}/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["workspace"] == "session-1"
        assert len(data["turns"]) == 1
        assert data["turns"][0]["prompt"] == "Fix it"

    def test_detail_not_found(self, client):
        resp = client.get("/api/slops/999/")
        assert resp.status_code == 404


@pytest.mark.django_db
class TestSlopsApprove:
    def test_approve_first_turn_sets_workspace(self, client, auth_headers):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t.id}/approve/", **auth_headers)
        assert resp.status_code == 200
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "approved"
        assert t.approved_at is not None
        assert s.status == "approved"
        assert s.workspace == f"session-{s.id}"

    def test_approve_with_custom_workspace(self, client, auth_headers):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(
            f"/api/slops/turns/{t.id}/approve/",
            {"workspace": "playground"},
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 200
        s.refresh_from_db()
        assert s.workspace == "playground"

    def test_approve_followup_keeps_existing_workspace(self, client, auth_headers):
        s = Session.objects.create(workspace="session-1", trace_path="/traces/session-1", status="done")
        Turn.objects.create(session=s, prompt="First", submitter_ip="127.0.0.1", status="done")
        t2 = Turn.objects.create(session=s, prompt="Second", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t2.id}/approve/", **auth_headers)
        assert resp.status_code == 200
        s.refresh_from_db()
        assert s.workspace == "session-1"  # unchanged

    def test_approve_non_pending_fails(self, client, auth_headers):
        s = Session.objects.create(status="running")
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1", status="running")
        resp = client.post(f"/api/slops/turns/{t.id}/approve/", **auth_headers)
        assert resp.status_code == 409

    def test_approve_requires_auth(self, client):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t.id}/approve/")
        assert resp.status_code == 401


@pytest.mark.django_db
class TestSlopsReject:
    def test_reject_turn(self, client, auth_headers):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t.id}/reject/", **auth_headers)
        assert resp.status_code == 200
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "rejected"
        assert s.status == "rejected"

    def test_reject_with_prior_done_turn(self, client, auth_headers):
        s = Session.objects.create(status="done")
        Turn.objects.create(session=s, prompt="First", submitter_ip="127.0.0.1", status="done")
        t2 = Turn.objects.create(session=s, prompt="Second", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t2.id}/reject/", **auth_headers)
        assert resp.status_code == 200
        s.refresh_from_db()
        assert s.status == "done"  # reverts to latest non-rejected

    def test_reject_requires_auth(self, client):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Do it", submitter_ip="127.0.0.1")
        resp = client.post(f"/api/slops/turns/{t.id}/reject/")
        assert resp.status_code == 401


@pytest.mark.django_db
class TestSlopsTrace:
    def test_trace_no_path(self, client):
        s = Session.objects.create()
        resp = client.get(f"/api/slops/{s.id}/trace/")
        assert resp.status_code == 200
        assert resp.json()["trace"] is None

    def test_trace_not_found(self, client):
        resp = client.get("/api/slops/999/trace/")
        assert resp.status_code == 404

    def test_trace_file_exists(self, client, tmp_path):
        trace_dir = tmp_path / "session-1"
        trace_dir.mkdir()
        trace_file = trace_dir / "20260405-120000.json"
        trace_file.write_text('{"schema_version": "ATIF-v1.4", "steps": []}')
        s = Session.objects.create(trace_path=str(trace_dir))
        resp = client.get(f"/api/slops/{s.id}/trace/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["trace"]["schema_version"] == "ATIF-v1.4"


@pytest.mark.django_db
class TestSlopsStats:
    def test_stats_empty(self, client):
        resp = client.get("/api/slops/stats/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_sessions"] == 0
        assert data["total_turns"] == 0
        assert data["total_tokens"] == 0

    def test_stats_counts_from_turns(self, client):
        s1 = Session.objects.create(status="done")
        Turn.objects.create(session=s1, prompt="a", submitter_ip="1.2.3.4", status="done", token_count=100, tool_calls=5)
        s2 = Session.objects.create(status="failed")
        Turn.objects.create(session=s2, prompt="b", submitter_ip="1.2.3.4", status="failed", token_count=50, tool_calls=2)
        s3 = Session.objects.create()
        Turn.objects.create(session=s3, prompt="c", submitter_ip="1.2.3.4", status="pending")
        resp = client.get("/api/slops/stats/")
        data = resp.json()
        assert data["total_sessions"] == 2  # only completed sessions
        assert data["total_turns"] == 2
        assert data["total_tokens"] == 150
        assert data["total_tool_calls"] == 7
        assert data["success_rate"] == 50.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_slops.py::TestSlopsSubmit::test_submit_creates_session_and_turn -v`
Expected: FAIL — views not implemented yet

- [ ] **Step 3: Rewrite `website/views/slops.py`**

Replace the entire file:

```python
import json
import os
from datetime import timedelta
from pathlib import Path

from django.db.models import Sum
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin
from ..models import Session, Turn
from ..utils import get_client_ip, parse_json_body

SUBMIT_COOLDOWN = timedelta(hours=1)
GLOBAL_SUBMIT_LIMIT = 10
MAX_PROMPT_LENGTH = 5000
DEFAULT_LIMIT = 20


def _serialize_turn(t):
    return {
        "id": t.id,
        "prompt": t.prompt,
        "status": t.status,
        "submitter_ip": t.submitter_ip,
        "token_count": t.token_count,
        "tool_calls": t.tool_calls,
        "summary": t.summary,
        "error": t.error,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "approved_at": t.approved_at.isoformat() if t.approved_at else None,
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
    }


def _serialize_session(s, turns=None):
    if turns is None:
        turns = s.turns.all()
    return {
        "id": s.id,
        "workspace": s.workspace,
        "status": s.status,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "turns": [_serialize_turn(t) for t in turns],
    }


def _update_session_status(session):
    """Set session.status to the latest non-rejected turn's status."""
    latest = session.turns.exclude(status="rejected").order_by("-created_at").first()
    session.status = latest.status if latest else "rejected"
    session.save(update_fields=["status"])


def slops_list(request):
    """GET /api/slops/ — public session list, excludes fully rejected, paginated."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    limit = min(int(request.GET.get("limit", DEFAULT_LIMIT)), 100)
    offset = int(request.GET.get("offset", 0))

    qs = Session.objects.exclude(status="rejected")
    total = qs.count()
    sessions = qs[offset : offset + limit]

    return JsonResponse(
        {
            "sessions": [_serialize_session(s) for s in sessions],
            "total": total,
        }
    )


def slops_detail(request, session_id):
    """GET /api/slops/<id>/ — single session with turns."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    try:
        s = Session.objects.get(id=session_id)
    except Session.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    return JsonResponse(_serialize_session(s))


@csrf_exempt
def slops_submit(request):
    """POST /api/slops/submit/ — rate-limited 1/hr/IP + 10/hr global."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    ip = get_client_ip(request)
    cutoff = timezone.now() - SUBMIT_COOLDOWN

    # Per-IP rate limit
    if Turn.objects.filter(submitter_ip=ip, created_at__gte=cutoff).exists():
        return JsonResponse({"error": "You've already submitted recently. Try again later."}, status=429)

    # Global rate limit
    if Turn.objects.filter(created_at__gte=cutoff).count() >= GLOBAL_SUBMIT_LIMIT:
        return JsonResponse({"error": "Too many submissions globally. Try again later."}, status=429)

    body, err = parse_json_body(request)
    if err:
        return err

    prompt = body.get("prompt", "").strip()
    if not prompt:
        return JsonResponse({"error": "Prompt required"}, status=400)
    if len(prompt) > MAX_PROMPT_LENGTH:
        return JsonResponse({"error": f"Too long (max {MAX_PROMPT_LENGTH} chars)"}, status=400)

    session_id = body.get("session_id")

    if session_id is not None:
        # Follow-up turn on existing session
        try:
            session = Session.objects.get(id=session_id)
        except Session.DoesNotExist:
            return JsonResponse({"error": "Session not found"}, status=404)

        # One active turn at a time
        if session.turns.filter(status__in=["pending", "approved", "running"]).exists():
            return JsonResponse({"error": "Session already has an active turn"}, status=409)
    else:
        # New session
        session = Session.objects.create()

    turn = Turn.objects.create(session=session, prompt=prompt, submitter_ip=ip)
    _update_session_status(session)

    return JsonResponse(_serialize_session(session), status=201)


@csrf_exempt
@require_admin
def slops_approve(request, turn_id):
    """POST /api/slops/turns/<turn_id>/approve/ — admin, approve + queue Celery task."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        turn = Turn.objects.select_related("session").get(id=turn_id)
    except Turn.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if turn.status != "pending":
        return JsonResponse({"error": f"Cannot approve turn with status '{turn.status}'"}, status=409)

    session = turn.session

    # Set workspace on first turn approval
    is_first_turn = not session.turns.filter(status="done").exists()
    if is_first_turn:
        workspace = None
        if request.body and request.content_type == "application/json":
            body, err = parse_json_body(request)
            if err:
                return err
            workspace = body.get("workspace")

        if not workspace:
            workspace = f"session-{session.id}"

        session.workspace = workspace
        session.trace_path = os.path.join("/home/klaude/traces", workspace)
        session.save(update_fields=["workspace", "trace_path"])

    turn.status = "approved"
    turn.approved_at = timezone.now()
    turn.save()

    _update_session_status(session)

    # Queue Celery task
    from website.tasks import run_turn

    run_turn.delay(turn.id)

    return JsonResponse(_serialize_session(session))


@csrf_exempt
@require_admin
def slops_reject(request, turn_id):
    """POST /api/slops/turns/<turn_id>/reject/ — admin."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        turn = Turn.objects.select_related("session").get(id=turn_id)
    except Turn.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if turn.status != "pending":
        return JsonResponse({"error": f"Cannot reject turn with status '{turn.status}'"}, status=409)

    turn.status = "rejected"
    turn.save()

    _update_session_status(turn.session)

    return JsonResponse(_serialize_session(turn.session))


def slops_trace(request, session_id):
    """GET /api/slops/<id>/trace/ — return ATIF trace file contents."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    try:
        s = Session.objects.get(id=session_id)
    except Session.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if not s.trace_path:
        return JsonResponse({"trace": None})

    # Find newest .json file in trace directory
    trace_files = sorted(Path(s.trace_path).glob("*.json"), key=lambda f: f.stat().st_mtime)
    if not trace_files:
        return JsonResponse({"trace": None})

    try:
        with open(trace_files[-1]) as f:
            content = json.load(f)
    except (OSError, json.JSONDecodeError):
        return JsonResponse({"error": "Failed to read trace file"}, status=500)

    return JsonResponse({"trace": content})


def slops_stats(request):
    """GET /api/slops/stats/ — aggregate stats from turns."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    completed_turns = Turn.objects.filter(status__in=["done", "failed"])
    total_turns = completed_turns.count()
    completed_sessions = Session.objects.filter(status__in=["done", "failed"]).count()

    agg = completed_turns.aggregate(
        total_tokens=Sum("token_count"),
        total_tool_calls=Sum("tool_calls"),
    )

    done_turns = completed_turns.filter(status="done").count()
    success_rate = round((done_turns / total_turns) * 100, 1) if total_turns > 0 else 0.0

    return JsonResponse(
        {
            "total_sessions": completed_sessions,
            "total_turns": total_turns,
            "total_tokens": agg["total_tokens"] or 0,
            "total_tool_calls": agg["total_tool_calls"] or 0,
            "success_rate": success_rate,
        }
    )
```

- [ ] **Step 4: Update `website/views/__init__.py`**

Change the slops import line:

Old:
```python
from .slops import slops_approve, slops_detail, slops_list, slops_reject, slops_stats, slops_submit, slops_trace
```

New:
```python
from .slops import slops_approve, slops_detail, slops_list, slops_reject, slops_stats, slops_submit, slops_trace
```

No change needed — the function names stay the same. The `__all__` list also stays the same.

- [ ] **Step 5: Update `website/urls.py`**

Replace slops URL patterns (lines 59-65):

Old:
```python
    path("slops/", views.slops_list),
    path("slops/submit/", views.slops_submit),
    path("slops/stats/", views.slops_stats),
    path("slops/<int:mission_id>/", views.slops_detail),
    path("slops/<int:mission_id>/approve/", views.slops_approve),
    path("slops/<int:mission_id>/reject/", views.slops_reject),
    path("slops/<int:mission_id>/trace/", views.slops_trace),
```

New:
```python
    path("slops/", views.slops_list),
    path("slops/submit/", views.slops_submit),
    path("slops/stats/", views.slops_stats),
    path("slops/<int:session_id>/", views.slops_detail),
    path("slops/<int:session_id>/trace/", views.slops_trace),
    path("slops/turns/<int:turn_id>/approve/", views.slops_approve),
    path("slops/turns/<int:turn_id>/reject/", views.slops_reject),
```

- [ ] **Step 6: Run all slops tests**

Run: `uv run pytest website/tests/test_slops.py -v`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add website/views/slops.py website/views/__init__.py website/urls.py website/tests/test_slops.py
git commit -m "feat: rewrite slops views for Session + Turn"
```

---

### Task 3: Celery Task — `run_turn`

**Files:**
- Rewrite: `website/tasks.py`
- Rewrite: `website/tests/test_tasks.py`

- [ ] **Step 1: Write failing tests for `run_turn`**

Replace the entire file `website/tests/test_tasks.py`:

```python
from unittest.mock import patch

import pytest

from website.models import Session, Turn
from website.tasks import run_turn


@pytest.mark.django_db
class TestRunTurn:
    def _make_approved_turn(self, **session_kwargs):
        s = Session.objects.create(
            workspace=session_kwargs.get("workspace", "session-1"),
            trace_path=session_kwargs.get("trace_path", "/home/klaude/traces/session-1"),
            status="approved",
        )
        t = Turn.objects.create(session=s, prompt="test", submitter_ip="127.0.0.1", status="approved")
        return s, t

    def test_first_turn_runs_without_continue_flag(self):
        s, t = self._make_approved_turn()
        with patch("website.tasks._execute_klaude") as mock_exec:
            mock_exec.return_value = {
                "summary": "Did stuff",
                "token_count": 100,
                "tool_calls": 5,
                "error": "",
            }
            run_turn(t.id)
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "done"
        assert t.summary == "Did stuff"
        assert t.token_count == 100
        assert t.started_at is not None
        assert t.completed_at is not None
        assert s.status == "done"
        # Check that _execute_klaude was called without is_continuation
        call_args = mock_exec.call_args
        assert call_args[0][0] == t  # turn
        assert call_args[0][1] is False  # is_continuation

    def test_followup_turn_uses_continue_flag(self):
        s = Session.objects.create(workspace="session-1", trace_path="/home/klaude/traces/session-1", status="done")
        Turn.objects.create(session=s, prompt="first", submitter_ip="127.0.0.1", status="done")
        t2 = Turn.objects.create(session=s, prompt="second", submitter_ip="127.0.0.1", status="approved")
        with patch("website.tasks._execute_klaude") as mock_exec:
            mock_exec.return_value = {"summary": "More stuff", "token_count": 50, "tool_calls": 3, "error": ""}
            run_turn(t2.id)
        call_args = mock_exec.call_args
        assert call_args[0][1] is True  # is_continuation

    def test_failed_turn(self):
        s, t = self._make_approved_turn()
        with patch("website.tasks._execute_klaude") as mock_exec:
            mock_exec.side_effect = Exception("klaude crashed")
            run_turn(t.id)
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "failed"
        assert "klaude crashed" in t.error
        assert t.completed_at is not None
        assert s.status == "failed"

    def test_skips_non_approved_turn(self):
        s, t = self._make_approved_turn()
        t.status = "pending"
        t.save()
        with patch("website.tasks._execute_klaude") as mock_exec:
            run_turn(t.id)
        mock_exec.assert_not_called()
        t.refresh_from_db()
        assert t.status == "pending"

    def test_error_in_klaude_output(self):
        s, t = self._make_approved_turn()
        with patch("website.tasks._execute_klaude") as mock_exec:
            mock_exec.return_value = {
                "summary": "",
                "token_count": 10,
                "tool_calls": 1,
                "error": "something went wrong",
            }
            run_turn(t.id)
        t.refresh_from_db()
        s.refresh_from_db()
        assert t.status == "failed"
        assert t.error == "something went wrong"
        assert s.status == "failed"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_tasks.py::TestRunTurn::test_first_turn_runs_without_continue_flag -v`
Expected: FAIL — `ImportError: cannot import name 'run_turn'`

- [ ] **Step 3: Rewrite `website/tasks.py`**

Replace the entire file:

```python
import json
import os
import subprocess
from pathlib import Path

from django.utils import timezone

from config.celery import app
from website.models import Session, Turn

KLAUDE_USER = "klaude"
KLAUDE_BIN = "/home/klaude/.local/bin/klaude"
WORKSPACE_BASE = "/home/klaude/workspace"
TRACES_BASE = "/home/klaude/traces"


def _execute_klaude(turn, is_continuation):
    """Run klaude CLI as the klaude user. Returns result dict."""
    session = turn.session
    workspace_dir = os.path.join(WORKSPACE_BASE, session.workspace)
    trace_dir = session.trace_path
    os.makedirs(trace_dir, exist_ok=True)

    cmd = ["sudo", "-u", KLAUDE_USER, KLAUDE_BIN]
    if is_continuation:
        cmd.append("-c")
    cmd += [turn.prompt, "--auto-approve", "--session-dir", trace_dir]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=600,
        cwd=workspace_dir,
    )

    # Read ATIF trace (newest .json file in trace_dir)
    atif = {}
    trace_files = sorted(Path(trace_dir).glob("*.json"), key=lambda f: f.stat().st_mtime)
    if trace_files:
        with open(trace_files[-1]) as f:
            atif = json.load(f)

    # Metrics from ATIF final_metrics
    fm = atif.get("final_metrics", {})
    token_count = fm.get("total_prompt_tokens", 0) + fm.get("total_completion_tokens", 0)
    tool_calls_count = sum(
        len(s.get("tool_calls", [])) for s in atif.get("steps", []) if s.get("source") == "agent"
    )

    # Summary from last agent step with content
    summary = ""
    for step in reversed(atif.get("steps", [])):
        if step.get("source") == "agent" and step.get("message"):
            summary = step["message"][:500]
            break

    return {
        "summary": summary,
        "token_count": token_count,
        "tool_calls": tool_calls_count,
        "error": result.stderr if result.returncode != 0 else "",
    }


@app.task(max_retries=0)
def run_turn(turn_id):
    """Execute a klaude turn."""
    try:
        turn = Turn.objects.select_related("session").get(id=turn_id)
    except Turn.DoesNotExist:
        return

    if turn.status != "approved":
        return

    session = turn.session

    turn.status = "running"
    turn.started_at = timezone.now()
    turn.save()
    session.status = "running"
    session.save(update_fields=["status"])

    is_continuation = session.turns.filter(status="done").exclude(id=turn.id).exists()

    try:
        result = _execute_klaude(turn, is_continuation)
        turn.status = "done" if not result["error"] else "failed"
        turn.summary = result["summary"]
        turn.token_count = result["token_count"]
        turn.tool_calls = result["tool_calls"]
        turn.error = result["error"]
    except Exception as e:
        turn.status = "failed"
        turn.error = str(e)

    turn.completed_at = timezone.now()
    turn.save()

    session.status = turn.status
    session.save(update_fields=["status"])
```

- [ ] **Step 4: Run all task tests**

Run: `uv run pytest website/tests/test_tasks.py -v`
Expected: all 6 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `uv run pytest -v`
Expected: all tests PASS (including slops tests from Task 2)

- [ ] **Step 6: Commit**

```bash
git add website/tasks.py website/tests/test_tasks.py
git commit -m "feat: rewrite Celery task for Session + Turn with -c flag"
```

---

### Task 4: Frontend TypeScript Types

**Files:**
- Modify: `frontend/src/lib/api.ts:225-268`

- [ ] **Step 1: Replace Mission types with Session/Turn types**

Replace the `/* ── Slops (Agent Showcase) ──── */` section (lines 225-268) in `frontend/src/lib/api.ts`:

Old:
```typescript
/* ── Slops (Agent Showcase) ────────────────────────── */

export type MissionStatus =
  | "pending"
  | "approved"
  | "running"
  | "done"
  | "failed"
  | "rejected";

export interface Mission {
  id: number;
  prompt: string;
  status: MissionStatus;
  workspace: string;
  token_count: number;
  tool_calls: number;
  summary: string;
  error: string;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface MissionListResponse {
  missions: Mission[];
  total: number;
  limit: number;
  offset: number;
}

export interface MissionStats {
  total_missions: number;
  total_tokens: number;
  total_tool_calls: number;
  success_rate: number;
  pending_count: number;
}

export interface MissionTrace {
  trace: Record<string, unknown> | null;
  status: MissionStatus;
}
```

New:
```typescript
/* ── Slops (Agent Showcase) ────────────────────────── */

export type TurnStatus =
  | "pending"
  | "approved"
  | "running"
  | "done"
  | "failed"
  | "rejected";

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
  trace: Record<string, unknown> | null;
}

export interface SlopsStats {
  total_sessions: number;
  total_turns: number;
  total_tokens: number;
  total_tool_calls: number;
  success_rate: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: replace Mission types with Session/Turn types"
```

---

### Task 5: Frontend Page — Rewrite `slops/page.tsx`

**Files:**
- Rewrite: `frontend/src/app/slops/page.tsx`

- [ ] **Step 1: Rewrite the slops page**

Replace the entire file `frontend/src/app/slops/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Session,
  type SessionListResponse,
  type SessionTrace,
  type TurnStatus,
  type Turn,
  API,
} from "@/lib/api";
import HeroSection from "./components/HeroSection";
import MatrixBg from "./components/MatrixBg";
import TraceViewer from "./components/TraceViewer";

const ACCENT = "#39ff14";

/* ── Status badge colors ──────────────────────────────── */

const STATUS_COLORS: Record<TurnStatus, string> = {
  pending: "#f59e0b",
  approved: "#60a5fa",
  running: "#39ff14",
  done: "#4ade80",
  failed: "#ef4444",
  rejected: "#666",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status as TurnStatus] || "#666";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        background: `${color}18`,
        border: `1px solid ${color}40`,
        color,
        fontSize: 10,
        fontFamily: "monospace",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  );
}

/* ── Time formatting ──────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Main Page ────────────────────────────────────────── */

export default function SlopsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [trace, setTrace] = useState<SessionTrace | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Load admin token (SSR-safe) ────────────────────── */

  useEffect(() => {
    setAdminToken(localStorage.getItem("adminToken"));
  }, []);

  /* ── Fetch sessions ────────────────────────────────── */

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/slops/?limit=50`);
      if (!res.ok) return;
      const data: SessionListResponse = await res.json();
      setSessions(data.sessions || []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  /* ── Fetch trace for selected session ──────────────── */

  const fetchTrace = useCallback(async (id: number) => {
    setTraceLoading(true);
    try {
      const res = await fetch(`${API}/api/slops/${id}/trace/`);
      if (!res.ok) {
        setTrace(null);
        return;
      }
      const data: SessionTrace = await res.json();
      setTrace(data);
    } catch {
      setTrace(null);
    } finally {
      setTraceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      fetchTrace(selectedId);
    } else {
      setTrace(null);
    }
  }, [selectedId, fetchTrace]);

  /* ── Poll active sessions ──────────────────────────── */

  useEffect(() => {
    const hasActive = sessions.some(
      (s) =>
        s.status === "running" ||
        s.status === "approved" ||
        s.status === "pending",
    );

    if (hasActive) {
      pollRef.current = setInterval(() => {
        fetchSessions();
        if (
          selectedId !== null &&
          sessions.find(
            (s) =>
              s.id === selectedId &&
              (s.status === "running" || s.status === "approved"),
          )
        ) {
          fetchTrace(selectedId);
        }
      }, 5000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessions, selectedId, fetchSessions, fetchTrace]);

  /* ── Select session ────────────────────────────────── */

  const selectSession = (id: number) => {
    setSelectedId(id === selectedId ? null : id);
    setSidebarOpen(false);
    setMenuOpen(false);
  };

  /* ── Admin actions ─────────────────────────────────── */

  const doAction = async (turnId: number, action: "approve" | "reject") => {
    if (!adminToken) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API}/api/slops/turns/${turnId}/${action}/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        await fetchSessions();
        if (selectedId !== null) await fetchTrace(selectedId);
      }
    } catch {
      /* silent */
    } finally {
      setActionLoading(false);
    }
  };

  /* ── Submit prompt ─────────────────────────────────── */

  const handleSubmit = async () => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      const body: { prompt: string; session_id?: number } = {
        prompt: prompt.trim(),
      };
      // If viewing a session, submit as follow-up
      if (selectedId !== null) {
        body.session_id = selectedId;
      }

      const res = await fetch(`${API}/api/slops/submit/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        setSubmitError("Rate limited. Try again later.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(
          (data as { error?: string }).error || "Submission failed",
        );
        return;
      }
      setPrompt("");
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 3000);
      await fetchSessions();
    } catch {
      setSubmitError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Derived state ─────────────────────────────────── */

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const latestTurn = selected?.turns[selected.turns.length - 1] ?? null;
  const pendingTurn = selected?.turns.find((t) => t.status === "pending") ?? null;
  const hasActiveTurn = selected?.turns.some(
    (t) => t.status === "pending" || t.status === "approved" || t.status === "running",
  );

  /* ── Render ────────────────────────────────────────── */

  return (
    <div
      className="flex flex-col lg:flex-row"
      style={{
        height: "calc(100vh - 60px)",
        fontFamily: "monospace",
        overflow: "hidden",
      }}
    >
      <MatrixBg />

      {/* ── Mobile sidebar toggle ──────────────────────── */}
      <button
        className="lg:hidden"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{
          position: "fixed",
          bottom: 80,
          right: 16,
          zIndex: 50,
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: ACCENT,
          color: "#000",
          border: "none",
          fontSize: 18,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: `0 0 20px ${ACCENT}40`,
        }}
      >
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>

      {/* ── Sidebar ────────────────────────────────────── */}
      <aside
        className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
        style={{
          position: "fixed",
          top: 60,
          left: 0,
          bottom: 0,
          width: sidebarCollapsed ? 40 : 280,
          zIndex: 40,
          background: "#0a0a0a",
          borderRight: `1px solid ${ACCENT}40`,
          overflowY: sidebarCollapsed ? "hidden" : "auto",
          overflowX: "hidden",
          transition: "width 0.2s ease, transform 0.2s ease",
          cursor: "pointer",
        }}
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        {sidebarCollapsed ? (
          <div
            style={{
              writingMode: "vertical-rl",
              padding: "16px 0",
              fontSize: 11,
              color: "#666",
              textTransform: "uppercase",
              letterSpacing: 1,
              textAlign: "center",
              width: "100%",
              userSelect: "none",
            }}
          >
            Sessions
          </div>
        ) : (
          <>
            <div
              style={{
                padding: "16px 12px 8px",
                fontSize: 11,
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Sessions
            </div>

            {sessions.length === 0 && (
              <div
                style={{ padding: "20px 12px", color: "#555", fontSize: 12 }}
              >
                No sessions yet. Submit the first one!
              </div>
            )}

            {sessions.map((s) => {
              const firstTurn = s.turns[0];
              const promptText = firstTurn?.prompt ?? "(empty)";
              const totalTokens = s.turns.reduce((sum, t) => sum + t.token_count, 0);
              const totalToolCalls = s.turns.reduce((sum, t) => sum + t.tool_calls, 0);
              return (
                <button
                  key={s.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectSession(s.id);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "10px 12px",
                    background:
                      s.id === selectedId ? `${ACCENT}10` : "transparent",
                    border: "none",
                    borderLeft:
                      s.id === selectedId
                        ? `2px solid ${ACCENT}`
                        : "2px solid transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (s.id !== selectedId)
                      e.currentTarget.style.background = `${ACCENT}08`;
                  }}
                  onMouseLeave={(e) => {
                    if (s.id !== selectedId)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        color: "#ccc",
                        fontSize: 12,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {promptText.length > 40
                        ? promptText.slice(0, 40) + "\u2026"
                        : promptText}
                    </span>
                    <StatusBadge status={s.status} />
                  </div>
                  <div style={{ color: "#555", fontSize: 10 }}>
                    {timeAgo(s.created_at)}
                    {s.turns.length > 1 && (
                      <span style={{ marginLeft: 8 }}>
                        {s.turns.length} turns
                      </span>
                    )}
                    {totalTokens > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        {totalTokens.toLocaleString()} tokens
                      </span>
                    )}
                    {totalToolCalls > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        {totalToolCalls} tool calls
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </>
        )}
      </aside>

      {/* ── Main area ──────────────────────────────────── */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          height: "100%",
          marginLeft: sidebarCollapsed ? 40 : 280,
          transition: "margin-left 0.2s ease",
        }}
        className="max-lg:!ml-0"
      >
        {/* Hero */}
        <HeroSection compact={selectedId !== null} />

        {/* Trace area */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 20px",
          }}
        >
          {selectedId === null
            ? null
            : traceLoading
              ? (
                  <div
                    style={{
                      padding: 40,
                      textAlign: "center",
                      color: "#555",
                      fontSize: 12,
                    }}
                  >
                    Loading trace...
                  </div>
                )
              : (
                  <>
                    {/* Session summary bar */}
                    {selected && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 0",
                          borderBottom: "1px solid #222",
                          marginBottom: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <StatusBadge status={selected.status} />
                        <span style={{ color: "#999", fontSize: 12, flex: 1 }}>
                          {selected.turns[0]?.prompt ?? ""}
                        </span>
                        {selected.turns.reduce((s, t) => s + t.token_count, 0) > 0 && (
                          <span style={{ color: "#555", fontSize: 11 }}>
                            {selected.turns.reduce((s, t) => s + t.token_count, 0).toLocaleString()} tokens
                          </span>
                        )}

                        {/* Admin menu for pending turn */}
                        {!!adminToken && pendingTurn && (
                          <div style={{ position: "relative" }}>
                            <button
                              onClick={() => setMenuOpen(!menuOpen)}
                              style={{
                                width: 28,
                                height: 28,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: `1px solid ${ACCENT}40`,
                                borderRadius: 4,
                                background: "transparent",
                                color: ACCENT,
                                cursor: "pointer",
                                fontSize: 14,
                                lineHeight: 1,
                              }}
                            >
                              &#8942;
                            </button>
                            {menuOpen && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: "100%",
                                  right: 0,
                                  marginTop: 4,
                                  background: "#111",
                                  border: `1px solid ${ACCENT}40`,
                                  borderRadius: 4,
                                  zIndex: 50,
                                  minWidth: 120,
                                  overflow: "hidden",
                                }}
                              >
                                <button
                                  onClick={() => {
                                    setMenuOpen(false);
                                    doAction(pendingTurn.id, "approve");
                                  }}
                                  disabled={actionLoading}
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    padding: "8px 12px",
                                    border: "none",
                                    background: "transparent",
                                    color: ACCENT,
                                    fontSize: 12,
                                    fontFamily: "monospace",
                                    cursor: actionLoading ? "not-allowed" : "pointer",
                                    textAlign: "left",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.background = `${ACCENT}15`)
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background = "transparent")
                                  }
                                >
                                  {actionLoading ? "\u2026" : "Approve"}
                                </button>
                                <button
                                  onClick={() => {
                                    setMenuOpen(false);
                                    doAction(pendingTurn.id, "reject");
                                  }}
                                  disabled={actionLoading}
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    padding: "8px 12px",
                                    border: "none",
                                    borderTop: "1px solid #222",
                                    background: "transparent",
                                    color: "#ef4444",
                                    fontSize: 12,
                                    fontFamily: "monospace",
                                    cursor: actionLoading ? "not-allowed" : "pointer",
                                    textAlign: "left",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.background =
                                      "rgba(239,68,68,0.1)")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background = "transparent")
                                  }
                                >
                                  {actionLoading ? "\u2026" : "Reject"}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Error display (from latest turn) */}
                    {latestTurn?.error && (
                      <div
                        style={{
                          padding: "10px 14px",
                          marginBottom: 12,
                          background: "rgba(239,68,68,0.1)",
                          border: "1px solid rgba(239,68,68,0.3)",
                          borderRadius: 6,
                          color: "#f87171",
                          fontSize: 12,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {latestTurn.error}
                      </div>
                    )}

                    {/* Summary display (from latest turn) */}
                    {latestTurn?.summary && (
                      <div
                        style={{
                          padding: "10px 14px",
                          marginBottom: 12,
                          background: `${ACCENT}08`,
                          border: `1px solid ${ACCENT}20`,
                          borderRadius: 6,
                          color: "#aaa",
                          fontSize: 12,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        <span
                          style={{
                            color: ACCENT,
                            fontWeight: 600,
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                            display: "block",
                            marginBottom: 4,
                          }}
                        >
                          Summary
                        </span>
                        {latestTurn.summary}
                      </div>
                    )}

                    {/* Trace viewer */}
                    {trace && (
                      <TraceViewer trace={trace} status={selected?.status ?? "pending"} />
                    )}
                  </>
                )}
        </div>

        {/* ── Prompt box ───────────────────────────────── */}
        <div
          style={{
            padding: "12px 40px 16px",
            borderTop: "1px solid #222",
            background: "#0a0a0a",
            maxWidth: 800,
            width: "100%",
            alignSelf: "center",
          }}
        >
          {submitSuccess && (
            <div
              style={{
                marginBottom: 8,
                padding: "6px 12px",
                borderRadius: 6,
                background: `${ACCENT}15`,
                border: `1px solid ${ACCENT}30`,
                color: ACCENT,
                fontSize: 11,
              }}
            >
              Submitted! It will appear once approved.
            </div>
          )}
          {submitError && (
            <div
              style={{
                marginBottom: 8,
                padding: "6px 12px",
                borderRadius: 6,
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "#f87171",
                fontSize: 11,
              }}
            >
              {submitError}
            </div>
          )}
          {hasActiveTurn && (
            <div
              style={{
                marginBottom: 8,
                padding: "6px 12px",
                borderRadius: 6,
                background: `${ACCENT}08`,
                border: `1px solid ${ACCENT}20`,
                color: "#888",
                fontSize: 11,
              }}
            >
              Waiting for current turn to complete...
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={
                selectedId !== null
                  ? "continue this session..."
                  : "will code for food..."
              }
              disabled={!!hasActiveTurn}
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${ACCENT}25`,
                background: "#111",
                color: "#ddd",
                fontSize: 13,
                fontFamily: "monospace",
                outline: "none",
                opacity: hasActiveTurn ? 0.4 : 1,
              }}
              onFocus={(e) =>
                (e.currentTarget.style.borderColor = `${ACCENT}60`)
              }
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = `${ACCENT}25`)
              }
            />
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || submitting || !!hasActiveTurn}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${ACCENT}44`,
                background: "#000",
                color: ACCENT,
                fontSize: 16,
                cursor:
                  !prompt.trim() || submitting || hasActiveTurn
                    ? "not-allowed"
                    : "pointer",
                opacity: !prompt.trim() || submitting || hasActiveTurn ? 0.3 : 1,
                transition: "opacity 0.15s, box-shadow 0.15s",
                boxShadow:
                  !prompt.trim() || submitting || hasActiveTurn
                    ? "none"
                    : `0 0 8px ${ACCENT}30`,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                if (prompt.trim() && !submitting && !hasActiveTurn)
                  e.currentTarget.style.boxShadow = `0 0 14px ${ACCENT}50`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow =
                  prompt.trim() && !submitting && !hasActiveTurn
                    ? `0 0 8px ${ACCENT}30`
                    : "none";
              }}
            >
              {submitting ? "\u2026" : "\u21B5"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/slops/page.tsx
git commit -m "feat: rewrite slops page for Session + Turn"
```

---

### Task 6: Update TraceViewer for Session Types

**Files:**
- Modify: `frontend/src/app/slops/components/TraceViewer.tsx`

- [ ] **Step 1: Update TraceViewer to accept SessionTrace**

The TraceViewer currently imports `MissionTrace` and uses `trace.trace?.messages`. After the ATIF PR (which this depends on), it will use ATIF steps. We need to update the import and props to use `SessionTrace` instead.

Change the import and component signature in `frontend/src/app/slops/components/TraceViewer.tsx`:

Old (line 4):
```typescript
import { type MissionTrace } from "@/lib/api";
```

New:
```typescript
import { type SessionTrace } from "@/lib/api";
```

Old (line 165):
```typescript
export default function TraceViewer({ trace }: { trace: MissionTrace }) {
```

New:
```typescript
export default function TraceViewer({ trace, status }: { trace: SessionTrace; status: string }) {
```

Update the empty state check. Old:
```typescript
        {trace.status === "running" || trace.status === "approved"
          ? "Waiting for trace data\u2026"
          : trace.status === "pending"
            ? "Mission awaiting approval"
            : "No trace data available"}
```

New:
```typescript
        {status === "running" || status === "approved"
          ? "Waiting for trace data\u2026"
          : status === "pending"
            ? "Awaiting approval"
            : "No trace data available"}
```

Note: The rest of the TraceViewer uses pre-ATIF message format. After ATIF PR merges, it will use ATIF steps — those changes are already in PR #171. This task only updates the type import and status prop.

- [ ] **Step 2: Verify frontend builds**

```bash
cd frontend && pnpm build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/slops/components/TraceViewer.tsx
git commit -m "feat: update TraceViewer for SessionTrace type"
```

---

### Task 7: Update CLAUDE.md and Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/README.md`
- Modify: `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Update API endpoints in CLAUDE.md**

Replace the slops section in CLAUDE.md (the API endpoint listing):

Old:
```
GET  /api/slops/                    mission list (paginated)
GET  /api/slops/<id>/               single mission detail
GET  /api/slops/<id>/trace/         trace file contents
POST /api/slops/submit/             submit prompt (rate-limited, 1/hr/IP)
POST /api/slops/<id>/approve/       auth required, approve + queue
POST /api/slops/<id>/reject/        auth required, reject
GET  /api/slops/stats/              aggregate stats
```

New:
```
GET  /api/slops/                    session list (paginated, with turns)
GET  /api/slops/<id>/               single session detail with turns
GET  /api/slops/<id>/trace/         ATIF trace file contents
POST /api/slops/submit/             submit prompt (1/hr/IP + 10/hr global), optional session_id for follow-up
POST /api/slops/turns/<id>/approve/ auth required, approve turn + queue
POST /api/slops/turns/<id>/reject/  auth required, reject turn
GET  /api/slops/stats/              aggregate stats (from turns)
```

- [ ] **Step 2: Update docs/README.md**

Update the /slops description to mention multi-turn sessions instead of single missions.

- [ ] **Step 3: Update docs/QA-CHECKLIST.md**

Add/update QA items for:
- Submit new session (creates session + first turn)
- Submit follow-up turn to existing session
- Approve/reject turns (new URL pattern)
- Rate limiting (per-IP + global)
- Active turn blocks new submissions
- Session status reflects latest non-rejected turn

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs: update API docs and QA checklist for session refactor"
```

---

### Task 8: Final Integration Test

- [ ] **Step 1: Run full backend test suite**

```bash
uv run pytest -v
```

Expected: all tests PASS

- [ ] **Step 2: Run frontend build + lint**

```bash
cd frontend && pnpm build && pnpm lint
```

Expected: no errors

- [ ] **Step 3: Run backend lint**

```bash
uvx ruff check . && uvx ruff format --check .
```

Expected: no errors
