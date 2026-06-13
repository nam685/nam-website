# Slops file upload — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let visitors attach files to a `/slops` prompt; files are stored inside the klaude workspace and klaude is auto-informed of their paths. Admin can preview text attachments before approving.

**Architecture:** New `Attachment` model linked to `Turn`. Multipart submit path added to `slops_submit`. Files written under `/home/klaude/workspace/klaude-playground/uploads/<session_id>/<turn_id>/` via `sudo -u klaude`. A prompt prefix listing attachment paths is prepended in `tasks.py` before klaude runs. Cleanup on reject/delete via `sudo -u klaude rm -rf` with strict regex validation (mirrors the pattern in `slops_cancel`). Frontend gets a `+` button, chip UI, and admin-only click-to-expand text preview.

**Tech Stack:** Django 6, Python 3.12, PostgreSQL, Celery, Next.js 16 (React 19), TypeScript, Tailwind v4, vitest, pytest-django.

**Spec:** `docs/superpowers/specs/2026-04-19-slops-file-upload-design.md`

---

## Prep

### Task 0: Create the worktree

**Files:**
- None (shell only)

- [ ] **Step 1: Create a branch/worktree**

Run:
```bash
git worktree add .claude/worktrees/slops-upload -b feat/slops-upload origin/main
cd .claude/worktrees/slops-upload
```

Expected: new worktree at `.claude/worktrees/slops-upload`, branch `feat/slops-upload` tracking `origin/main`.

Run all subsequent tasks from inside this worktree.

---

## Backend

### Task 1: Shared limit constants

**Files:**
- Create: `website/slops_limits.py`

- [ ] **Step 1: Write the file**

```python
"""Shared constants for slops file-upload limits. Mirror in frontend/src/lib/slopsLimits.ts."""

MAX_FILES_PER_TURN = 5
MAX_SINGLE_FILE = 5 * 1024 * 1024        # 5 MB
MAX_TOTAL_UPLOAD = 10 * 1024 * 1024      # 10 MB per turn
PREVIEW_MAX_BYTES = 64 * 1024            # 64 KB

# Extensions split into "text/code" (previewable) and "binary" (storage only for now).
TEXT_EXTENSIONS = frozenset(
    {
        ".txt", ".md", ".json", ".yaml", ".yml", ".csv", ".tsv", ".log",
        ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".sh",
        ".toml", ".xml", ".sql",
    }
)
BINARY_EXTENSIONS = frozenset(
    {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".docx", ".xlsx", ".pptx"}
)
ALLOWED_EXTENSIONS = TEXT_EXTENSIONS | BINARY_EXTENSIONS
```

- [ ] **Step 2: Commit**

```bash
git add website/slops_limits.py
git commit -m "feat(slops): shared upload limit constants"
```

---

### Task 2: Attachment model + migration

**Files:**
- Create: `website/models/attachment.py`
- Modify: `website/models/__init__.py`
- Test: `website/tests/test_attachment_model.py`
- Migration: auto-generated

- [ ] **Step 1: Write the failing test**

Create `website/tests/test_attachment_model.py`:

```python
import pytest

from website.models import Attachment, Session, Turn


@pytest.mark.django_db
class TestAttachmentModel:
    def test_create_attachment(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Hi", submitter_ip="127.0.0.1")
        a = Attachment.objects.create(
            turn=t, filename="foo.csv", size=1234, content_type="text/csv"
        )
        assert a.filename == "foo.csv"
        assert a.size == 1234
        assert a.content_type == "text/csv"
        assert a.created_at is not None

    def test_cascade_delete_with_turn(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="Hi", submitter_ip="127.0.0.1")
        Attachment.objects.create(turn=t, filename="a.txt", size=1)
        t.delete()
        assert Attachment.objects.count() == 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest website/tests/test_attachment_model.py -v`
Expected: FAIL with `ImportError: cannot import name 'Attachment'`.

- [ ] **Step 3: Create the model**

Create `website/models/attachment.py`:

```python
from django.db import models


class Attachment(models.Model):
    turn = models.ForeignKey("Turn", on_delete=models.CASCADE, related_name="attachments")
    filename = models.CharField(max_length=255)
    size = models.PositiveIntegerField()
    content_type = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.filename} ({self.size} B)"
```

- [ ] **Step 4: Wire it into `models/__init__.py`**

Edit `website/models/__init__.py`:

```python
from .attachment import Attachment
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
    "Attachment",
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

- [ ] **Step 5: Generate migration**

Run: `uv run python manage.py makemigrations website`
Expected: output mentions `Create model Attachment`. A new file `website/migrations/00XX_attachment.py` is created.

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_attachment_model.py -v`
Expected: both tests PASS.

- [ ] **Step 7: Commit**

```bash
git add website/models/__init__.py website/models/attachment.py website/migrations/ website/tests/test_attachment_model.py
git commit -m "feat(slops): add Attachment model linked to Turn"
```

---

### Task 3: Sudo helpers for uploads

**Files:**
- Modify: `website/views/slops.py` (add helpers near the top)
- Test: `website/tests/test_slops_upload_helpers.py`

Goal: pure helpers so the submit / preview / cleanup paths can be unit-tested without shelling out.

- [ ] **Step 1: Write the failing test**

Create `website/tests/test_slops_upload_helpers.py`:

```python
import pytest

from website.views.slops import (
    _safe_basename,
    _validate_extension,
    _upload_dir_rel,
)


class TestSafeBasename:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("foo.csv", "foo.csv"),
            ("../../etc/passwd", "passwd"),
            ("C:\\Users\\nam\\foo.txt", "foo.txt"),
            ("dir/sub/a.md", "a.md"),
        ],
    )
    def test_strips_path(self, raw, expected):
        assert _safe_basename(raw) == expected

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            _safe_basename("")

    def test_dotfile_raises(self):
        with pytest.raises(ValueError):
            _safe_basename(".env")

    def test_no_extension_raises(self):
        with pytest.raises(ValueError):
            _safe_basename("README")


class TestValidateExtension:
    def test_text_ok(self):
        _validate_extension("foo.csv")  # no raise

    def test_binary_ok(self):
        _validate_extension("report.pdf")  # no raise

    def test_case_insensitive(self):
        _validate_extension("FOO.CSV")  # no raise

    def test_rejects_unknown(self):
        with pytest.raises(ValueError):
            _validate_extension("evil.exe")


class TestUploadDirRel:
    def test_format(self):
        assert _upload_dir_rel(7, 42) == "uploads/7/42"
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest website/tests/test_slops_upload_helpers.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Add helpers to `website/views/slops.py`**

Insert these near the top of the file, just after the existing `_WORKSPACE_RE` line:

```python
import os.path
from pathlib import PurePosixPath, PureWindowsPath

from website.slops_limits import ALLOWED_EXTENSIONS

_UPLOAD_PATH_RE = re.compile(r"^uploads/\d+(/\d+)?$")


def _safe_basename(filename):
    """Strip any directory components; reject empty, dotfiles, or extensionless names."""
    if not filename:
        raise ValueError("Empty filename")
    # Handle both posix and windows separators.
    base = PurePosixPath(filename).name
    base = PureWindowsPath(base).name
    if not base or base.startswith("."):
        raise ValueError("Invalid filename")
    if "." not in base:
        raise ValueError("Filename must have an extension")
    return base


def _validate_extension(filename):
    """Raise ValueError if the extension is not in the allowlist."""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Extension {ext} not allowed")


def _upload_dir_rel(session_id, turn_id):
    """Relative upload dir inside the workspace."""
    return f"uploads/{session_id}/{turn_id}"


def _upload_dir_abs(workspace, session_id, turn_id):
    """Absolute upload dir under /home/klaude/workspace/<workspace>/."""
    from website.tasks import WORKSPACE_BASE

    return os.path.join(WORKSPACE_BASE, workspace, _upload_dir_rel(session_id, turn_id))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_slops_upload_helpers.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add website/views/slops.py website/tests/test_slops_upload_helpers.py
git commit -m "feat(slops): add upload path/extension helpers"
```

---

### Task 4: Sudo-backed file writer + cleanup

**Files:**
- Modify: `website/tasks.py` (add two new helpers for reuse in views)

- [ ] **Step 1: Add helpers to `website/tasks.py`**

Append to `website/tasks.py`:

```python
def sudo_write_file(path, content_bytes):
    """Write bytes to `path` as the klaude user. Raises CalledProcessError on failure.

    `path` must be absolute. Uses `tee` via sudo with stdin — no shell, so
    special characters in path are safe.
    """
    subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "tee", "--", path],
        input=content_bytes,
        check=True,
        stdout=subprocess.DEVNULL,
    )


def sudo_mkdir_p(path):
    """mkdir -p `path` as the klaude user."""
    subprocess.run(["sudo", "-u", KLAUDE_USER, "mkdir", "-p", path], check=True)


def sudo_rm_rf(path):
    """rm -rf `path` as the klaude user. Caller MUST validate `path` first."""
    subprocess.run(["sudo", "-u", KLAUDE_USER, "rm", "-rf", "--", path], check=True)


def sudo_read_bytes(path):
    """Read bytes from `path` as the klaude user. Returns bytes or None."""
    result = subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "cat", "--", path],
        capture_output=True,
    )
    return result.stdout if result.returncode == 0 else None
```

- [ ] **Step 2: Commit**

```bash
git add website/tasks.py
git commit -m "feat(slops): sudo helpers for write/mkdir/rm/read bytes"
```

No tests here — these are thin shell wrappers; they'll be exercised via the submit/preview tests that mock `subprocess.run`.

---

### Task 5: Multipart submit accepts files

**Files:**
- Modify: `website/views/slops.py` (rewrite `slops_submit` and `_serialize_turn`)
- Test: `website/tests/test_slops.py` (append new test class)

- [ ] **Step 1: Write the failing tests**

Append to `website/tests/test_slops.py`:

```python
from io import BytesIO
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile

from website.models import Attachment
from website.slops_limits import MAX_SINGLE_FILE, MAX_TOTAL_UPLOAD


@pytest.mark.django_db
class TestSlopsSubmitWithFiles:
    @patch("website.views.slops.sudo_write_file")
    @patch("website.views.slops.sudo_mkdir_p")
    def test_submit_with_single_file(self, mock_mkdir, mock_write, client):
        f = SimpleUploadedFile("data.csv", b"a,b\n1,2\n", content_type="text/csv")
        resp = client.post(
            "/api/slops/submit/",
            {"prompt": "summarize this", "files": [f]},
        )
        assert resp.status_code == 201, resp.content
        data = resp.json()
        assert len(data["turns"]) == 1
        turn = data["turns"][0]
        assert len(turn["attachments"]) == 1
        a = turn["attachments"][0]
        assert a["filename"] == "data.csv"
        assert a["size"] == 8
        assert a["previewable"] is True
        assert Attachment.objects.count() == 1
        mock_mkdir.assert_called_once()
        mock_write.assert_called_once()

    @patch("website.views.slops.sudo_write_file")
    @patch("website.views.slops.sudo_mkdir_p")
    def test_submit_multiple_files(self, mock_mkdir, mock_write, client):
        f1 = SimpleUploadedFile("a.txt", b"hello", content_type="text/plain")
        f2 = SimpleUploadedFile("b.pdf", b"%PDF-1.4...", content_type="application/pdf")
        resp = client.post(
            "/api/slops/submit/",
            {"prompt": "look at these", "files": [f1, f2]},
        )
        assert resp.status_code == 201
        turn = resp.json()["turns"][0]
        assert len(turn["attachments"]) == 2
        names = [a["filename"] for a in turn["attachments"]]
        assert names == ["a.txt", "b.pdf"]
        assert [a["previewable"] for a in turn["attachments"]] == [True, False]

    def test_reject_oversize_single(self, client):
        big = SimpleUploadedFile("big.txt", b"x" * (MAX_SINGLE_FILE + 1))
        resp = client.post("/api/slops/submit/", {"prompt": "p", "files": [big]})
        assert resp.status_code == 413
        assert "too large" in resp.json()["error"].lower()
        assert Attachment.objects.count() == 0

    def test_reject_oversize_total(self, client):
        half = b"x" * ((MAX_TOTAL_UPLOAD // 2) + 1)
        f1 = SimpleUploadedFile("a.txt", half)
        f2 = SimpleUploadedFile("b.txt", half)
        resp = client.post("/api/slops/submit/", {"prompt": "p", "files": [f1, f2]})
        assert resp.status_code == 413
        assert Attachment.objects.count() == 0

    def test_reject_too_many_files(self, client):
        files = [SimpleUploadedFile(f"f{i}.txt", b"x") for i in range(6)]
        resp = client.post("/api/slops/submit/", {"prompt": "p", "files": files})
        assert resp.status_code == 400
        assert "too many" in resp.json()["error"].lower()

    def test_reject_disallowed_extension(self, client):
        f = SimpleUploadedFile("evil.exe", b"MZ...")
        resp = client.post("/api/slops/submit/", {"prompt": "p", "files": [f]})
        assert resp.status_code == 400
        assert ".exe" in resp.json()["error"]

    def test_reject_dotfile(self, client):
        f = SimpleUploadedFile(".env", b"SECRET=1")
        resp = client.post("/api/slops/submit/", {"prompt": "p", "files": [f]})
        assert resp.status_code == 400
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest website/tests/test_slops.py::TestSlopsSubmitWithFiles -v`
Expected: FAIL — responses are 400 "Invalid JSON" because the current `slops_submit` only handles JSON.

- [ ] **Step 3: Rewrite `slops_submit` and `_serialize_turn`**

In `website/views/slops.py`, replace `_serialize_turn` with:

```python
def _serialize_turn(t, include_ip=False):
    data = {
        "id": t.id,
        "prompt": t.prompt,
        "status": t.status,
        "token_count": t.token_count,
        "tool_calls": t.tool_calls,
        "summary": t.summary,
        "error": t.error,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "approved_at": t.approved_at.isoformat() if t.approved_at else None,
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "attachments": [
            {
                "id": a.id,
                "filename": a.filename,
                "size": a.size,
                "previewable": os.path.splitext(a.filename)[1].lower() in TEXT_EXTENSIONS,
            }
            for a in t.attachments.all()
        ],
    }
    if include_ip:
        data["submitter_ip"] = t.submitter_ip
    return data
```

Add to the imports at the top:

```python
from website.slops_limits import (
    ALLOWED_EXTENSIONS,
    MAX_FILES_PER_TURN,
    MAX_SINGLE_FILE,
    MAX_TOTAL_UPLOAD,
    PREVIEW_MAX_BYTES,
    TEXT_EXTENSIONS,
)
from website.tasks import sudo_mkdir_p, sudo_read_bytes, sudo_rm_rf, sudo_write_file
```

Replace the existing `slops_submit` with:

```python
@csrf_exempt
def slops_submit(request):
    """POST /api/slops/submit/ — rate-limited 1/hr/IP + 10/hr global.

    Accepts JSON (text-only) or multipart/form-data (with files under key `files`).
    """
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    ip = get_client_ip(request)

    # Rate limiting (skip for admin)
    if not _is_admin(request):
        cutoff = timezone.now() - SUBMIT_COOLDOWN
        if Turn.objects.filter(submitter_ip=ip, created_at__gte=cutoff).exists():
            return JsonResponse({"error": "You've already submitted recently. Try again later."}, status=429)
        if Turn.objects.filter(created_at__gte=cutoff).count() >= GLOBAL_SUBMIT_LIMIT:
            return JsonResponse({"error": "Too many submissions globally. Try again later."}, status=429)

    # Parse prompt/session_id based on content-type.
    is_multipart = (request.content_type or "").startswith("multipart/form-data")
    if is_multipart:
        prompt = (request.POST.get("prompt") or "").strip()
        session_id_raw = request.POST.get("session_id")
        session_id = int(session_id_raw) if session_id_raw else None
        files = request.FILES.getlist("files")
    else:
        body, err = parse_json_body(request)
        if err:
            return err
        prompt = body.get("prompt", "").strip()
        session_id = body.get("session_id")
        files = []

    if not prompt:
        return JsonResponse({"error": "Prompt required"}, status=400)
    if len(prompt) > MAX_PROMPT_LENGTH:
        return JsonResponse({"error": f"Too long (max {MAX_PROMPT_LENGTH} chars)"}, status=400)

    # Validate files before touching the DB.
    if len(files) > MAX_FILES_PER_TURN:
        return JsonResponse({"error": f"Too many files (max {MAX_FILES_PER_TURN})"}, status=400)
    total = 0
    validated = []  # list of (basename, UploadedFile)
    for f in files:
        if f.size > MAX_SINGLE_FILE:
            return JsonResponse(
                {"error": f"File '{f.name}' too large (max {MAX_SINGLE_FILE // (1024 * 1024)} MB)"},
                status=413,
            )
        total += f.size
        if total > MAX_TOTAL_UPLOAD:
            return JsonResponse(
                {"error": f"Total upload size too large (max {MAX_TOTAL_UPLOAD // (1024 * 1024)} MB)"},
                status=413,
            )
        try:
            base = _safe_basename(f.name)
            _validate_extension(base)
        except ValueError as e:
            return JsonResponse({"error": str(e)}, status=400)
        validated.append((base, f))

    # Session resolution (unchanged behaviour).
    if session_id is not None:
        try:
            session = Session.objects.get(id=session_id)
        except Session.DoesNotExist:
            return JsonResponse({"error": "Session not found"}, status=404)
        if session.turns.filter(status__in=["pending", "approved", "running"]).exists():
            return JsonResponse({"error": "Session already has an active turn"}, status=409)
    else:
        session = Session.objects.create()

    turn = Turn.objects.create(session=session, prompt=prompt, submitter_ip=ip)

    # Files need a workspace dir to live under. If session.workspace isn't set yet
    # (approval normally assigns it), default to "klaude-playground" here so uploads
    # have a stable home — approval won't override an already-set workspace.
    if files:
        if not session.workspace:
            session.workspace = "klaude-playground"
            session.trace_path = os.path.join("/home/klaude/traces", session.workspace, str(session.id))
            session.save(update_fields=["workspace", "trace_path"])

        dest_dir = _upload_dir_abs(session.workspace, session.id, turn.id)
        try:
            sudo_mkdir_p(dest_dir)
            for base, f in validated:
                sudo_write_file(os.path.join(dest_dir, base), f.read())
                Attachment.objects.create(
                    turn=turn,
                    filename=base,
                    size=f.size,
                    content_type=(f.content_type or "")[:100],
                )
        except Exception as e:
            # Best-effort cleanup: remove dir + turn row.
            rel = _upload_dir_rel(session.id, turn.id)
            if _UPLOAD_PATH_RE.match(rel):
                try:
                    sudo_rm_rf(dest_dir)
                except Exception:
                    pass
            turn.delete()
            return JsonResponse({"error": f"Failed to save uploads: {e}"}, status=500)

    _update_session_status(session)
    return JsonResponse(_serialize_session(session), status=201)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_slops.py::TestSlopsSubmitWithFiles -v`
Expected: all 7 tests PASS.

- [ ] **Step 5: Prefetch attachments in `slops_list`**

To avoid N+1 on the public list endpoint, update the queryset in `slops_list`:

Replace:
```python
    qs = Session.objects.exclude(status="rejected").prefetch_related("turns")
```

With:
```python
    qs = Session.objects.exclude(status="rejected").prefetch_related("turns__attachments")
```

And the same change in `slops_detail`:

Replace:
```python
        s = Session.objects.prefetch_related("turns").get(id=session_id)
```

With:
```python
        s = Session.objects.prefetch_related("turns__attachments").get(id=session_id)
```

- [ ] **Step 6: Run the existing slops tests to confirm no regression**

Run: `uv run pytest website/tests/test_slops.py -v`
Expected: all PASS (existing JSON path still works).

- [ ] **Step 7: Commit**

```bash
git add website/views/slops.py website/tests/test_slops.py
git commit -m "feat(slops): accept multipart uploads on submit"
```

---

### Task 6: Cleanup on reject + session delete

**Files:**
- Modify: `website/views/slops.py` (extend `slops_reject` and `slops_delete`)
- Test: `website/tests/test_slops.py`

- [ ] **Step 1: Write the failing tests**

Append to `website/tests/test_slops.py`:

```python
@pytest.mark.django_db
class TestSlopsCleanupOnReject:
    @patch("website.views.slops.sudo_rm_rf")
    @patch("website.views.slops.sudo_write_file")
    @patch("website.views.slops.sudo_mkdir_p")
    def test_reject_cleans_up_uploads(self, mock_mkdir, mock_write, mock_rm, client, auth_headers):
        f = SimpleUploadedFile("a.txt", b"hi")
        resp = client.post("/api/slops/submit/", {"prompt": "p", "files": [f]})
        assert resp.status_code == 201
        turn_id = resp.json()["turns"][0]["id"]
        session_id = resp.json()["id"]

        resp = client.post(f"/api/slops/turns/{turn_id}/reject/", **auth_headers)
        assert resp.status_code == 200
        mock_rm.assert_called_once()
        call_arg = mock_rm.call_args[0][0]
        assert call_arg.endswith(f"uploads/{session_id}/{turn_id}")

    @patch("website.views.slops.sudo_rm_rf")
    @patch("website.views.slops.sudo_write_file")
    @patch("website.views.slops.sudo_mkdir_p")
    def test_delete_session_cleans_up_uploads(
        self, mock_mkdir, mock_write, mock_rm, client, auth_headers
    ):
        f = SimpleUploadedFile("a.txt", b"hi")
        resp = client.post("/api/slops/submit/", {"prompt": "p", "files": [f]})
        session_id = resp.json()["id"]

        resp = client.post(f"/api/slops/{session_id}/delete/", **auth_headers)
        assert resp.status_code == 200
        mock_rm.assert_called_once()
        call_arg = mock_rm.call_args[0][0]
        assert call_arg.endswith(f"uploads/{session_id}")
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest website/tests/test_slops.py::TestSlopsCleanupOnReject -v`
Expected: FAIL — `mock_rm.assert_called_once()` fails because reject/delete don't call rm yet.

- [ ] **Step 3: Add cleanup helper + wire into `slops_reject` / `slops_delete`**

In `website/views/slops.py`, add a cleanup helper above `slops_reject`:

```python
def _cleanup_uploads(workspace, session_id, turn_id=None):
    """rm -rf the per-turn or per-session upload dir. No-op if workspace unset.

    Path is built from validated regex inputs; final path is verified absolute +
    anchored under WORKSPACE_BASE before shelling out.
    """
    if not workspace:
        return
    rel = _upload_dir_rel(session_id, turn_id) if turn_id is not None else f"uploads/{session_id}"
    if not _UPLOAD_PATH_RE.match(rel):
        return

    from website.tasks import WORKSPACE_BASE

    abs_path = os.path.join(WORKSPACE_BASE, workspace, rel)
    # Defensive: ensure resolved path stays under the workspace root.
    workspace_root = os.path.realpath(os.path.join(WORKSPACE_BASE, workspace))
    if not os.path.realpath(os.path.dirname(abs_path)).startswith(workspace_root):
        return
    try:
        sudo_rm_rf(abs_path)
    except Exception:
        pass
```

Edit `slops_reject` — inside the function, after `turn.save()` and before `_update_session_status(turn.session)`, add:

```python
    _cleanup_uploads(turn.session.workspace, turn.session.id, turn.id)
```

Edit `slops_delete` — replace `session.delete(); return JsonResponse(...)` with:

```python
    workspace = session.workspace
    session_id_copy = session.id
    session.delete()
    _cleanup_uploads(workspace, session_id_copy, None)
    return JsonResponse({"ok": True})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_slops.py::TestSlopsCleanupOnReject -v`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add website/views/slops.py website/tests/test_slops.py
git commit -m "feat(slops): clean up upload dirs on reject and session delete"
```

---

### Task 7: Auto-inform klaude via prompt prefix

**Files:**
- Modify: `website/tasks.py` (`_execute_klaude`)
- Test: `website/tests/test_slops_prompt_prefix.py`

- [ ] **Step 1: Write the failing test**

Create `website/tests/test_slops_prompt_prefix.py`:

```python
import pytest

from website.models import Attachment, Session, Turn
from website.tasks import _build_prompt_with_attachments


@pytest.mark.django_db
class TestPromptPrefix:
    def test_no_attachments_returns_raw(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="hello", submitter_ip="127.0.0.1")
        assert _build_prompt_with_attachments(t) == "hello"

    def test_single_attachment(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="summarize", submitter_ip="127.0.0.1")
        Attachment.objects.create(turn=t, filename="data.csv", size=2048)
        out = _build_prompt_with_attachments(t)
        assert out.endswith("summarize")
        assert "[attachments" in out
        assert f"uploads/{s.id}/{t.id}/data.csv" in out
        assert "2.0 KB" in out

    def test_multiple_attachments_listed(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="look", submitter_ip="127.0.0.1")
        Attachment.objects.create(turn=t, filename="a.txt", size=100)
        Attachment.objects.create(turn=t, filename="b.pdf", size=1024 * 200)
        out = _build_prompt_with_attachments(t)
        assert "a.txt" in out and "b.pdf" in out
        assert "200.0 KB" in out
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest website/tests/test_slops_prompt_prefix.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Add the helper and wire it in**

In `website/tasks.py`, add near the top (after existing constants):

```python
def _fmt_size(n):
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / (1024 * 1024):.1f} MB"


def _build_prompt_with_attachments(turn):
    attachments = list(turn.attachments.all())
    if not attachments:
        return turn.prompt
    lines = [
        f"- uploads/{turn.session_id}/{turn.id}/{a.filename} ({_fmt_size(a.size)})"
        for a in attachments
    ]
    prefix = "[attachments — read these first]\n" + "\n".join(lines) + "\n\n"
    return prefix + turn.prompt
```

Edit `_execute_klaude`: replace the line `cmd += [turn.prompt, "--auto-approve", "--session-dir", trace_dir]` with:

```python
    cmd += [_build_prompt_with_attachments(turn), "--auto-approve", "--session-dir", trace_dir]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_slops_prompt_prefix.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add website/tasks.py website/tests/test_slops_prompt_prefix.py
git commit -m "feat(slops): prepend attachment list to klaude prompt"
```

---

### Task 8: Attachment preview endpoint (admin-only)

**Files:**
- Modify: `website/views/slops.py` (add `slops_attachment_preview`)
- Modify: `website/views/__init__.py` (export)
- Modify: `website/urls.py` (route)
- Test: `website/tests/test_slops.py`

- [ ] **Step 1: Write the failing tests**

Append to `website/tests/test_slops.py`:

```python
@pytest.mark.django_db
class TestAttachmentPreview:
    def _make_turn_with_attachment(self, client, filename, content):
        with patch("website.views.slops.sudo_write_file"), patch("website.views.slops.sudo_mkdir_p"):
            f = SimpleUploadedFile(filename, content)
            resp = client.post("/api/slops/submit/", {"prompt": "p", "files": [f]})
            assert resp.status_code == 201
            return resp.json()["turns"][0]["attachments"][0]["id"]

    def test_requires_admin(self, client):
        a_id = self._make_turn_with_attachment(client, "a.txt", b"hello")
        resp = client.get(f"/api/slops/attachments/{a_id}/preview/")
        assert resp.status_code == 401

    @patch("website.views.slops.sudo_read_bytes")
    def test_returns_content_for_text(self, mock_read, client, auth_headers):
        mock_read.return_value = b"hello world"
        a_id = self._make_turn_with_attachment(client, "a.txt", b"hello world")
        resp = client.get(f"/api/slops/attachments/{a_id}/preview/", **auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["content"] == "hello world"
        assert data["truncated"] is False
        assert data["total_size"] == 11

    def test_404_for_binary(self, client, auth_headers):
        a_id = self._make_turn_with_attachment(client, "a.pdf", b"%PDF")
        resp = client.get(f"/api/slops/attachments/{a_id}/preview/", **auth_headers)
        assert resp.status_code == 404

    @patch("website.views.slops.sudo_read_bytes")
    def test_truncates_large(self, mock_read, client, auth_headers):
        big = b"x" * (64 * 1024 + 500)
        mock_read.return_value = big
        a_id = self._make_turn_with_attachment(client, "a.txt", big)
        resp = client.get(f"/api/slops/attachments/{a_id}/preview/", **auth_headers)
        data = resp.json()
        assert data["truncated"] is True
        assert len(data["content"].encode()) <= 64 * 1024 + 200  # content + footer
        assert data["total_size"] == len(big)

    @patch("website.views.slops.sudo_read_bytes")
    def test_rejects_non_utf8(self, mock_read, client, auth_headers):
        mock_read.return_value = b"\xff\xfe\x00\x00binary"
        a_id = self._make_turn_with_attachment(client, "fake.txt", b"ignored")
        resp = client.get(f"/api/slops/attachments/{a_id}/preview/", **auth_headers)
        assert resp.status_code == 400
        assert "utf-8" in resp.json()["error"].lower()
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest website/tests/test_slops.py::TestAttachmentPreview -v`
Expected: all FAIL — route 404 / view missing.

- [ ] **Step 3: Add the view**

In `website/views/slops.py`, add:

```python
from ..models import Attachment  # add to existing model imports


@require_admin
def slops_attachment_preview(request, attachment_id):
    """GET /api/slops/attachments/<id>/preview/ — admin-only text preview."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    try:
        a = Attachment.objects.select_related("turn__session").get(id=attachment_id)
    except Attachment.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    ext = os.path.splitext(a.filename)[1].lower()
    if ext not in TEXT_EXTENSIONS:
        return JsonResponse({"error": "Not previewable"}, status=404)

    session = a.turn.session
    if not session.workspace:
        return JsonResponse({"error": "No workspace"}, status=404)

    rel = _upload_dir_rel(session.id, a.turn_id)
    if not _UPLOAD_PATH_RE.match(rel):
        return JsonResponse({"error": "Invalid path"}, status=500)

    from website.tasks import WORKSPACE_BASE

    abs_path = os.path.join(WORKSPACE_BASE, session.workspace, rel, a.filename)
    raw = sudo_read_bytes(abs_path)
    if raw is None:
        return JsonResponse({"error": "File not found"}, status=404)

    total_size = len(raw)
    truncated = total_size > PREVIEW_MAX_BYTES
    chunk = raw[:PREVIEW_MAX_BYTES]
    try:
        text = chunk.decode("utf-8")
    except UnicodeDecodeError:
        return JsonResponse({"error": "Not valid UTF-8 text"}, status=400)

    if truncated:
        text += f"\n[truncated — showing first {PREVIEW_MAX_BYTES // 1024} KB of {total_size // 1024} KB]"

    return JsonResponse({"content": text, "truncated": truncated, "total_size": total_size})
```

- [ ] **Step 4: Export the view**

Check `website/views/__init__.py` and ensure `slops_attachment_preview` is re-exported next to the other `slops_*` names. If the file uses `from .slops import *`, no change needed; otherwise add the explicit import.

- [ ] **Step 5: Wire the route**

Edit `website/urls.py`: add, anywhere inside the `urlpatterns` list, next to the other slops routes:

```python
    path("slops/attachments/<int:attachment_id>/preview/", views.slops_attachment_preview),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_slops.py::TestAttachmentPreview -v`
Expected: all 5 PASS.

- [ ] **Step 7: Commit**

```bash
git add website/views/slops.py website/views/__init__.py website/urls.py website/tests/test_slops.py
git commit -m "feat(slops): admin attachment preview endpoint"
```

---

## Frontend

### Task 9: Shared frontend limits module

**Files:**
- Create: `frontend/src/lib/slopsLimits.ts`
- Test: `frontend/src/lib/__tests__/slopsLimits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/__tests__/slopsLimits.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  MAX_FILES_PER_TURN,
  MAX_SINGLE_FILE,
  MAX_TOTAL_UPLOAD,
  TEXT_EXTENSIONS,
  ALLOWED_EXTENSIONS,
  formatSize,
  validateFiles,
} from "../slopsLimits";

describe("slopsLimits constants", () => {
  it("mirrors backend numbers", () => {
    expect(MAX_FILES_PER_TURN).toBe(5);
    expect(MAX_SINGLE_FILE).toBe(5 * 1024 * 1024);
    expect(MAX_TOTAL_UPLOAD).toBe(10 * 1024 * 1024);
  });

  it("text extensions subset of allowed", () => {
    for (const ext of TEXT_EXTENSIONS) {
      expect(ALLOWED_EXTENSIONS.has(ext)).toBe(true);
    }
  });
});

describe("formatSize", () => {
  it("formats bytes/KB/MB", () => {
    expect(formatSize(500)).toBe("500 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("validateFiles", () => {
  const mk = (name: string, size: number): File =>
    new File([new Uint8Array(size)], name);

  it("accepts valid batch", () => {
    const res = validateFiles([mk("a.txt", 100), mk("b.pdf", 200)]);
    expect(res.ok).toBe(true);
  });

  it("rejects too many files", () => {
    const files = Array.from({ length: 6 }, (_, i) => mk(`f${i}.txt`, 1));
    const res = validateFiles(files);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too many/i);
  });

  it("rejects oversize single", () => {
    const res = validateFiles([mk("big.txt", MAX_SINGLE_FILE + 1)]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too large/i);
  });

  it("rejects oversize total", () => {
    const half = Math.floor(MAX_TOTAL_UPLOAD / 2) + 1;
    const res = validateFiles([mk("a.txt", half), mk("b.txt", half)]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/total/i);
  });

  it("rejects disallowed extension", () => {
    const res = validateFiles([mk("evil.exe", 100)]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/\.exe/);
  });

  it("rejects dotfile", () => {
    const res = validateFiles([mk(".env", 100)]);
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

From `frontend/`: `pnpm test slopsLimits`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `frontend/src/lib/slopsLimits.ts`:

```typescript
// Mirror of website/slops_limits.py — keep numbers in sync.

export const MAX_FILES_PER_TURN = 5;
export const MAX_SINGLE_FILE = 5 * 1024 * 1024;
export const MAX_TOTAL_UPLOAD = 10 * 1024 * 1024;

export const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".yaml", ".yml", ".csv", ".tsv", ".log",
  ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".sh",
  ".toml", ".xml", ".sql",
]);
export const BINARY_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic",
  ".docx", ".xlsx", ".pptx",
]);
export const ALLOWED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...BINARY_EXTENSIONS,
]);

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export type ValidateResult = { ok: true } | { ok: false; error: string };

export function validateFiles(files: File[]): ValidateResult {
  if (files.length > MAX_FILES_PER_TURN) {
    return { ok: false, error: `Too many files (max ${MAX_FILES_PER_TURN})` };
  }
  let total = 0;
  for (const f of files) {
    if (!f.name || f.name.startsWith(".") || !f.name.includes(".")) {
      return { ok: false, error: `Invalid filename: ${f.name || "(empty)"}` };
    }
    const ext = extOf(f.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return { ok: false, error: `Extension ${ext} not allowed` };
    }
    if (f.size > MAX_SINGLE_FILE) {
      return {
        ok: false,
        error: `File '${f.name}' too large (max ${MAX_SINGLE_FILE / (1024 * 1024)} MB)`,
      };
    }
    total += f.size;
    if (total > MAX_TOTAL_UPLOAD) {
      return {
        ok: false,
        error: `Total upload size too large (max ${MAX_TOTAL_UPLOAD / (1024 * 1024)} MB)`,
      };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

From `frontend/`: `pnpm test slopsLimits`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/slopsLimits.ts frontend/src/lib/__tests__/slopsLimits.test.ts
git commit -m "feat(slops): shared frontend upload limits + validator"
```

---

### Task 10: Extend Turn/Attachment types

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the type**

Open `frontend/src/lib/api.ts`. Find the existing `Turn` type (or wherever slops types are defined — look for `TurnStatus` or `Session`). Add:

```typescript
export interface Attachment {
  id: number;
  filename: string;
  size: number;
  previewable: boolean;
}
```

And extend the `Turn` interface with:

```typescript
  attachments: Attachment[];
```

If older backend responses lack the field, default-handle it at the call site (`t.attachments ?? []`) rather than making it optional — the backend always returns it going forward.

- [ ] **Step 2: Run typecheck**

From `frontend/`: `pnpm build` (or `pnpm tsc --noEmit` if available) to surface type errors in call sites that didn't know about `attachments`. Fix any (they'll be in `page.tsx` and `TraceViewer.tsx`, both of which are touched in later tasks).

Expected: no type errors after the changes in later tasks; for now a few "not all paths return" may show — note them and move on.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(slops): add Attachment type to api.ts"
```

---

### Task 11: File picker + chip UI on the submit form

**Files:**
- Modify: `frontend/src/app/slops/page.tsx`

- [ ] **Step 1: Add state, refs, handlers**

Inside `SlopsPage`, near the other state declarations, add:

```typescript
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
```

Import at the top:

```typescript
import { validateFiles, formatSize, ALLOWED_EXTENSIONS } from "@/lib/slopsLimits";
```

Add handlers anywhere above the JSX `return`:

```typescript
  const onPickFiles = () => fileInputRef.current?.click();

  const onFilesChanged = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    const merged = [...pendingFiles];
    for (const f of picked) {
      if (!merged.some((m) => m.name === f.name && m.size === f.size)) {
        merged.push(f);
      }
    }
    const res = validateFiles(merged);
    if (!res.ok) {
      setFileError(res.error);
      // Reset the input so re-picking the same file triggers change.
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFileError(null);
    setPendingFiles(merged);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
    setFileError(null);
  };
```

- [ ] **Step 2: Render the chips and `+` button**

In the composer area (the `<div>` with `padding: "12px 40px 16px"` and the `<input type="text">`), just above the `<div style={{ display: "flex", gap: 8 }}>` wrapping the input+send button, add:

```tsx
          {pendingFiles.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 8,
              }}
            >
              {pendingFiles.map((f, i) => (
                <span
                  key={`${f.name}-${f.size}-${i}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: `1px solid ${ACCENT}40`,
                    background: `${ACCENT}10`,
                    color: "#ccc",
                    fontSize: 11,
                  }}
                >
                  {f.name}
                  <span style={{ color: "#666" }}>· {formatSize(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#ccc",
                      cursor: "pointer",
                      fontSize: 12,
                      lineHeight: 1,
                      padding: 0,
                    }}
                    aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          {fileError && (
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
              {fileError}
            </div>
          )}
```

Change the input+send row to include a `+` button on the left:

```tsx
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={Array.from(ALLOWED_EXTENSIONS).join(",")}
              style={{ display: "none" }}
              onChange={onFilesChanged}
            />
            <button
              type="button"
              onClick={onPickFiles}
              disabled={!!hasActiveTurn}
              aria-label="Attach files"
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${ACCENT}44`,
                background: "#000",
                color: ACCENT,
                fontSize: 18,
                fontFamily: "monospace",
                cursor: hasActiveTurn ? "not-allowed" : "pointer",
                opacity: hasActiveTurn ? 0.3 : 1,
                lineHeight: 1,
              }}
            >
              +
            </button>
            <input
              /* existing text input unchanged */
```

Leave the existing text `<input>` and send `<button>` as they are.

- [ ] **Step 3: Run the dev server and smoke-test**

```bash
make dev   # (or `cd frontend && pnpm dev` separately)
```

Open `http://localhost:3001/slops`. Click `+`, pick a small `.txt`, see the chip. Pick a 6 MB file — chip doesn't appear, error banner shows "File too large". Click the `✕` on a chip — it disappears.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/slops/page.tsx
git commit -m "feat(slops): file picker and attachment chip UI"
```

---

### Task 12: Multipart submit when files are attached

**Files:**
- Modify: `frontend/src/app/slops/page.tsx` (`handleSubmit`)

- [ ] **Step 1: Update `handleSubmit`**

Replace the existing `handleSubmit` body with:

```typescript
  const handleSubmit = async () => {
    if ((!prompt.trim() && pendingFiles.length === 0) || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      const headers: Record<string, string> = {};
      if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;

      let res: Response;
      if (pendingFiles.length > 0) {
        const fd = new FormData();
        fd.append("prompt", prompt.trim());
        if (selectedId !== null) fd.append("session_id", String(selectedId));
        for (const f of pendingFiles) fd.append("files", f);
        // Do NOT set Content-Type — browser sets the multipart boundary.
        res = await fetch(`${API}/api/slops/submit/`, {
          method: "POST",
          headers,
          body: fd,
        });
      } else {
        const body: { prompt: string; session_id?: number } = {
          prompt: prompt.trim(),
        };
        if (selectedId !== null) body.session_id = selectedId;
        res = await fetch(`${API}/api/slops/submit/`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (res.status === 429) {
        setSubmitError("Rate limited. Try again later.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError((data as { error?: string }).error || "Submission failed");
        return;
      }
      const created: Session = await res.json();
      setPrompt("");
      setPendingFiles([]);
      setFileError(null);
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 3000);
      setSelectedId(created.id);
      await fetchSessions();
    } catch {
      setSubmitError("Network error");
    } finally {
      setSubmitting(false);
    }
  };
```

Also update the send-button disabled condition to allow file-only submit (files with empty prompt should still be blocked since backend requires a prompt — keep the prompt requirement):

The existing check `!prompt.trim() || submitting || !!hasActiveTurn` is already correct; the backend requires a non-empty prompt, so no change needed.

- [ ] **Step 2: Smoke-test**

With dev servers running:
1. Submit a prompt only (no files) → should still work exactly as before.
2. Submit a prompt + one `.txt` file → session appears, reselect it, verify attachment chip shows up on the turn (Task 13 will render it; for now confirm `GET /api/slops/` response includes the attachment in dev tools).
3. Submit a 6 MB file → frontend blocks before network. Verify by watching Network tab.
4. Admin rejects a session that had attachments → `make up` logs should show `sudo rm -rf`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/slops/page.tsx
git commit -m "feat(slops): multipart submit when files attached"
```

---

### Task 13: Render attachments + admin preview in TraceViewer

**Files:**
- Modify: `frontend/src/app/slops/components/TraceViewer.tsx`

Note: This task displays attachments under each user message in the trace, with admin-only click-to-expand text previews.

- [ ] **Step 1: Inspect existing TraceViewer**

Read `frontend/src/app/slops/components/TraceViewer.tsx` to understand how user messages are rendered. The component currently renders trace messages returned by the backend (`_atif_to_messages`) and doesn't know about turn-level metadata.

Key decision: attachments belong to a **turn**, not an ATIF message. Pass the session (which has turns with attachments) into `TraceViewer`, or render attachments **outside** TraceViewer in `page.tsx` above the trace. Pick the second approach — lower coupling.

- [ ] **Step 2: Render attachments in `page.tsx` above `TraceViewer`**

In `frontend/src/app/slops/page.tsx`, replace the existing `{trace && (<TraceViewer ... />)}` block with:

```tsx
                    {selected && selected.turns.some((t) => t.attachments?.length) && (
                      <AttachmentList
                        turns={selected.turns}
                        isAdmin={!!adminToken}
                        adminToken={adminToken}
                      />
                    )}
                    {trace && (
                      <TraceViewer
                        trace={trace}
                        status={selected?.status ?? "pending"}
                        error={latestTurn?.error || ""}
                      />
                    )}
```

Create a new component `frontend/src/app/slops/components/AttachmentList.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { Turn } from "@/lib/api";
import { API } from "@/lib/api";
import { formatSize } from "@/lib/slopsLimits";

const ACCENT = "#39ff14";

export default function AttachmentList({
  turns,
  isAdmin,
  adminToken,
}: {
  turns: Turn[];
  isAdmin: boolean;
  adminToken: string | null;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      {turns
        .filter((t) => (t.attachments ?? []).length > 0)
        .map((t) => (
          <div
            key={t.id}
            style={{
              padding: "8px 12px",
              border: "1px solid #222",
              borderRadius: 6,
              marginBottom: 8,
              background: "#0d0d0d",
            }}
          >
            <div style={{ color: "#666", fontSize: 10, marginBottom: 6, textTransform: "uppercase" }}>
              Turn {t.id} attachments
            </div>
            {(t.attachments ?? []).map((a) => (
              <AttachmentRow
                key={a.id}
                attachment={a}
                isAdmin={isAdmin}
                adminToken={adminToken}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

function AttachmentRow({
  attachment,
  isAdmin,
  adminToken,
}: {
  attachment: { id: number; filename: string; size: number; previewable: boolean };
  isAdmin: boolean;
  adminToken: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPreview = isAdmin && attachment.previewable;

  const toggle = async () => {
    if (!canPreview) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (preview !== null) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/slops/attachments/${attachment.id}/preview/`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to load preview");
        return;
      }
      const data = await res.json();
      setPreview(data.content);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontSize: 12 }}>
      <div
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 0",
          cursor: canPreview ? "pointer" : "default",
          color: "#ccc",
        }}
      >
        <span style={{ color: canPreview ? ACCENT : "#666", fontFamily: "monospace" }}>
          {canPreview ? (expanded ? "▾" : "▸") : "·"}
        </span>
        <span>{attachment.filename}</span>
        <span style={{ color: "#666" }}>({formatSize(attachment.size)})</span>
      </div>
      {expanded && canPreview && (
        <pre
          style={{
            marginTop: 4,
            padding: "8px 10px",
            maxHeight: 300,
            overflow: "auto",
            background: "#050505",
            border: "1px solid #222",
            borderRadius: 4,
            color: "#ccc",
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {loading ? "Loading…" : error ? error : preview}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Smoke-test**

Dev server running:
1. As logged-out viewer on `/slops`, open a session with a `.txt` attachment → see the filename/size listed but no expand icon, no click action.
2. Log in at `/sudo` with `ADMIN_SECRET`, return to `/slops`, pick the session → expand icon (▸) appears; click it → preview loads in a `<pre>`.
3. Pick a session with a `.pdf` attachment as admin → name shown, no expand icon.
4. Large text file (>64 KB) → preview shows content with trailing `[truncated — ...]` line.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/slops/page.tsx frontend/src/app/slops/components/AttachmentList.tsx
git commit -m "feat(slops): render attachments + admin text preview"
```

---

## Docs

### Task 14: Update CLAUDE.md, README, QA checklist

**Files:**
- Modify: `CLAUDE.md` (API endpoint list)
- Modify: `docs/README.md`
- Modify: `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Update `CLAUDE.md` API list**

Find the `slops/` block in `CLAUDE.md` and add two entries:

```
POST /api/slops/submit/             submit prompt (1/hr/IP + 10/hr global), optional session_id for follow-up, optional multipart `files[]`
GET  /api/slops/attachments/<id>/preview/ auth required, returns UTF-8 text content (64 KB cap)
```

(Replace the existing `POST /api/slops/submit/` line; add the preview line below it.)

- [ ] **Step 2: Update `docs/README.md`**

Find the slops section. Add a sentence describing the new attachment capability (one line, no fluff).

- [ ] **Step 3: Update `docs/QA-CHECKLIST.md`**

Append to the slops section:

```
- Submit without files — session appears, turn pending.
- Submit with one `.txt` attachment — chip visible before send, attachment listed on turn after send.
- Submit with 5 files including a `.pdf` — all land, PDF shown as non-previewable.
- Try to submit a 6 MB file — blocked client-side before network, error banner shows.
- Try to attach `evil.exe` — blocked client-side.
- Admin: expand a text attachment preview — content loads in-place.
- Admin: expand a text attachment >64 KB — content truncated with footer.
- Admin: reject a session with attachments — session updates, SSH to server and confirm `ls /home/klaude/workspace/klaude-playground/uploads/<id>/` is gone.
- Admin: delete a session with attachments — session dir gone.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs(slops): document file upload + preview endpoints"
```

---

## Final

### Task 15: Full test run + lint + push

**Files:** none

- [ ] **Step 1: Run everything**

```bash
make test
make lint
```

Expected: all green. Fix any regressions before proceeding.

- [ ] **Step 2: Push and open a PR**

```bash
git push -u origin feat/slops-upload
```

Open a PR via `gh pr create` or the GitHub UI. Title: `feat(slops): file upload with admin text preview`. Body: link to the design spec and the plan file, mention the depends-on relationship to `nam685/klaude#14` for future binary support.

- [ ] **Step 3: Manual QA pass**

Walk through every line in the slops section of `docs/QA-CHECKLIST.md` on a preview deploy before merging. Server-side cleanup items require SSH to the production host.

---

## Out of this plan

- Klaude binary-file support (PDF parsing, image OCR, VLM) — tracked in `nam685/klaude#14`. When that ships, update the spec to drop the "non-previewable" limitation for binaries if desired; no changes to this codebase strictly required.
- Per-IP upload byte quota — can be added later by summing `Attachment.size` for a window.
- Orphan-dir sweep cron — revisit if disk usage ever becomes a concern.
