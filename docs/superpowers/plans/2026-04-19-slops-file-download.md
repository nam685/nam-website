# Slops File Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Klaude share files with the user by writing them to a conventional `downloads/<session_id>/<turn_id>/` directory; backend registers each file, frontend renders clickable chips below the final assistant message of each turn.

**Architecture:** Prompt-prefix convention tells Klaude where to write. `_execute_klaude` is unchanged; after a turn reaches `status=done`, a new `_register_downloads(turn)` scans the dir (as the `klaude` user via `sudo`) and creates `Download` rows with caps enforced. A new public `/api/slops/downloads/<id>/` endpoint streams the bytes (regex-gated path, `application/octet-stream`, `Content-Disposition: attachment`). Frontend reads `turn.downloads` from the existing session response and renders chips keyed off ATIF user-message boundaries.

**Tech Stack:** Django 6, Python 3.12, Celery (existing queue), PostgreSQL, subprocess + sudo, React 19 / Next.js 16 / TypeScript / Vitest.

**Spec:** [2026-04-19-slops-file-download-design.md](../specs/2026-04-19-slops-file-download-design.md)

**Merge-order note:** The parallel `feat/slops-upload` branch introduces the same `MAX_FILES_PER_TURN / MAX_SINGLE_FILE / MAX_TOTAL_UPLOAD` constants and a `frontend/src/lib/slopsLimits.ts` module with `formatSize`. This plan introduces them under the same names. Whichever PR lands second: during rebase keep a single definition; behavior is identical.

---

## File Structure

**Backend (new):**
- `website/models/download.py` — `Download` model
- `website/migrations/<next>_download.py` — generated
- New view `slops_download` appended to `website/views/slops.py` (same file — small enough; slops.py is already the home for all slops views)

**Backend (modify):**
- `website/models/__init__.py` — export `Download`
- `website/views/__init__.py` — export `slops_download`
- `website/views/slops.py` — add constants, `_fmt_size`, extend `_serialize_turn`, add `slops_download`, extend `slops_delete`
- `website/tasks.py` — add `_build_downloads_prefix`, `_register_downloads`, call them from `_execute_klaude` / `run_turn`
- `website/urls.py` — one new route
- `website/tests/test_slops.py` — new test classes
- `website/tests/test_tasks.py` — new test cases

**Frontend (new):**
- `frontend/src/lib/slopsLimits.ts` — limit constants + `formatSize()`
- `frontend/src/lib/__tests__/slopsLimits.test.ts` — `formatSize` tests

**Frontend (modify):**
- `frontend/src/lib/api.ts` — `Download` type, extend `Turn`
- `frontend/src/app/slops/components/TraceViewer.tsx` — new `DownloadChips` subcomponent + placement
- `frontend/src/app/slops/page.tsx` — pass `turns` to TraceViewer

**Docs:**
- `docs/QA-CHECKLIST.md` — new manual QA items
- `docs/README.md` — update slops description to mention downloads

---

## Task 1: Backend constants + size formatter

Introduce the shared size constants and a `_fmt_size` helper in `website/views/slops.py`. These are consumed by `tasks.py` (prefix builder) and by the registration scanner.

**Files:**
- Modify: `website/views/slops.py` (add near the top, after the `SUBMIT_COOLDOWN` block)
- Test: `website/tests/test_slops.py` (add new class `TestFmtSize`)

- [ ] **Step 1: Write the failing test**

Add `from website.views.slops import _fmt_size` to the imports block at the top of `website/tests/test_slops.py` (alongside `from website.models import Session, Turn`), then append to the end of the file:

```python
class TestFmtSize:
    def test_zero_bytes(self):
        assert _fmt_size(0) == "0 B"

    def test_bytes(self):
        assert _fmt_size(512) == "512 B"

    def test_kilobytes(self):
        assert _fmt_size(1024) == "1.0 KB"

    def test_kilobytes_fraction(self):
        assert _fmt_size(1536) == "1.5 KB"

    def test_megabytes(self):
        assert _fmt_size(5 * 1024 * 1024) == "5.0 MB"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_slops.py::TestFmtSize -v`
Expected: `ImportError: cannot import name '_fmt_size' from 'website.views.slops'`

- [ ] **Step 3: Implement constants and helper**

In `website/views/slops.py`, after the line `DEFAULT_LIMIT = 20` add:

```python
# Shared upload/download limits — mirrored in frontend/src/lib/slopsLimits.ts
MAX_FILES_PER_TURN = 5
MAX_SINGLE_FILE = 5 * 1024 * 1024  # 5 MB
MAX_TOTAL_UPLOAD = 10 * 1024 * 1024  # 10 MB


def _fmt_size(n: int) -> str:
    """Format a byte count as '512 B', '1.5 KB', or '5.0 MB'."""
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / (1024 * 1024):.1f} MB"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_slops.py::TestFmtSize -v`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add website/views/slops.py website/tests/test_slops.py
git commit -m "feat(slops): add shared file-size constants + _fmt_size helper"
```

---

## Task 2: Download model + migration

**Files:**
- Create: `website/models/download.py`
- Modify: `website/models/__init__.py`
- Create: `website/migrations/<N>_download.py` (generated — N is next available number)
- Test: `website/tests/test_slops.py` (add `TestDownloadModel`)

- [ ] **Step 1: Write the failing test**

Add `from website.models import Download` to the imports block at the top of `website/tests/test_slops.py` (alongside `from website.models import Session, Turn` — either merge into that line or add a second line). Then append to the end of the file:

```python
@pytest.mark.django_db
class TestDownloadModel:
    def test_create_download(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1")
        d = Download.objects.create(turn=t, filename="out.md", size=123)
        assert d.filename == "out.md"
        assert d.size == 123
        assert d.oversize is False
        assert d.created_at is not None

    def test_download_cascade_on_turn_delete(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1")
        Download.objects.create(turn=t, filename="a.txt", size=1)
        t.delete()
        assert Download.objects.count() == 0

    def test_download_cascade_on_session_delete(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1")
        Download.objects.create(turn=t, filename="a.txt", size=1)
        s.delete()
        assert Download.objects.count() == 0

    def test_oversize_flag(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1")
        d = Download.objects.create(turn=t, filename="big.bin", size=10 * 1024 * 1024, oversize=True)
        assert d.oversize is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_slops.py::TestDownloadModel -v`
Expected: `ImportError: cannot import name 'Download' from 'website.models'`

- [ ] **Step 3: Create the model file**

Create `website/models/download.py`:

```python
from django.db import models

from .session import Turn


class Download(models.Model):
    turn = models.ForeignKey(Turn, on_delete=models.CASCADE, related_name="downloads")
    filename = models.CharField(max_length=255)
    size = models.PositiveIntegerField()
    oversize = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["turn", "id"], name="download_turn_idx"),
        ]

    def __str__(self):
        return f"{self.filename} ({self.size}B)"
```

- [ ] **Step 4: Register the model**

Edit `website/models/__init__.py`. Add the import (alphabetical placement, after `Drawing`):

```python
from .download import Download
```

Add `"Download",` to `__all__` (alphabetical placement).

- [ ] **Step 5: Generate migration**

Run: `uv run python manage.py makemigrations website`
Expected: new file created at `website/migrations/<N>_download.py` containing `CreateModel` for `Download`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_slops.py::TestDownloadModel -v`
Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add website/models/download.py website/models/__init__.py website/migrations/*_download.py website/tests/test_slops.py
git commit -m "feat(slops): add Download model + migration"
```

---

## Task 3: Downloads prompt-prefix builder

A pure function in `tasks.py` that builds the prefix string klaude sees. Wired into `_execute_klaude` in the next task.

**Files:**
- Modify: `website/tasks.py`
- Test: `website/tests/test_tasks.py`

- [ ] **Step 1: Write the failing test**

Add `from website.tasks import _build_downloads_prefix` to the imports block at the top of `website/tests/test_tasks.py` (alongside `from website.tasks import run_turn`). Then append to the end of the file:

```python
@pytest.mark.django_db
class TestBuildDownloadsPrefix:
    def test_includes_path_with_ids(self):
        s = Session.objects.create(workspace="ws1", trace_path="/t")
        t = Turn.objects.create(session=s, prompt="x", submitter_ip="127.0.0.1")
        prefix = _build_downloads_prefix(s, t)
        assert f"downloads/{s.id}/{t.id}/" in prefix

    def test_mentions_caps(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="x", submitter_ip="127.0.0.1")
        prefix = _build_downloads_prefix(s, t)
        assert "5 files" in prefix
        assert "5.0 MB" in prefix
        assert "10.0 MB" in prefix

    def test_ends_with_blank_line(self):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="x", submitter_ip="127.0.0.1")
        prefix = _build_downloads_prefix(s, t)
        assert prefix.endswith("\n\n")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_tasks.py::TestBuildDownloadsPrefix -v`
Expected: `ImportError: cannot import name '_build_downloads_prefix'`.

- [ ] **Step 3: Implement the builder**

Append to `website/tasks.py` (after the existing imports, placed before `_execute_klaude`):

```python
from website.views.slops import (
    MAX_FILES_PER_TURN,
    MAX_SINGLE_FILE,
    MAX_TOTAL_UPLOAD,
    _fmt_size,
)


def _build_downloads_prefix(session, turn) -> str:
    """Prefix klaude sees telling it where to drop files for the user."""
    return (
        f"[downloads — you can share files with the user by writing them to "
        f"downloads/{session.id}/{turn.id}/. "
        f"Max {MAX_FILES_PER_TURN} files, {_fmt_size(MAX_SINGLE_FILE)} each, "
        f"{_fmt_size(MAX_TOTAL_UPLOAD)} total. "
        f"Files exceeding the per-file size will be shown to the user but "
        f"marked as too large to download.]\n\n"
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_tasks.py::TestBuildDownloadsPrefix -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add website/tasks.py website/tests/test_tasks.py
git commit -m "feat(slops): add _build_downloads_prefix builder"
```

---

## Task 4: Wire the downloads prefix into `_execute_klaude`

Prepend the prefix to `turn.prompt` before passing it to the CLI. `turn.prompt` in the DB is not mutated.

**Files:**
- Modify: `website/tasks.py` (`_execute_klaude`, around the `cmd += [turn.prompt, ...]` line)
- Test: `website/tests/test_tasks.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_tasks.py`:

```python
@pytest.mark.django_db
class TestExecuteKlaudeUsesPrefix:
    def test_prompt_passed_to_klaude_includes_downloads_prefix(self):
        s = Session.objects.create(workspace="ws", trace_path="/home/klaude/traces/ws/1")
        t = Turn.objects.create(session=s, prompt="do the thing", submitter_ip="127.0.0.1", status="approved")
        with patch("website.tasks.subprocess.run") as mock_run, patch(
            "website.tasks._read_atif_trace", return_value={}
        ):
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = ""
            mock_run.return_value.stderr = ""
            from website.tasks import _execute_klaude

            _execute_klaude(t, is_continuation=False)

        # Find the call that invoked the klaude CLI (last arg looks like the CLI path)
        klaude_cmds = [
            c for c in mock_run.call_args_list
            if any("/klaude" in (a or "") for a in c.args[0])
        ]
        assert klaude_cmds, "klaude CLI was not invoked"
        cmd = klaude_cmds[0].args[0]
        # Find the prompt argument (the one not starting with '-' or '/')
        prompt_args = [a for a in cmd if a.startswith("[downloads")]
        assert prompt_args, f"no downloads-prefixed prompt in {cmd!r}"
        assert "do the thing" in prompt_args[0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_tasks.py::TestExecuteKlaudeUsesPrefix -v`
Expected: FAIL — current `_execute_klaude` passes `turn.prompt` raw, no prefix.

- [ ] **Step 3: Modify `_execute_klaude`**

Edit `website/tasks.py`. Replace the block:

```python
    cmd = ["sudo", "-u", KLAUDE_USER, KLAUDE_BIN]
    if is_continuation:
        cmd.append("-c")
    cmd += [turn.prompt, "--auto-approve", "--session-dir", trace_dir]
```

with:

```python
    cmd = ["sudo", "-u", KLAUDE_USER, KLAUDE_BIN]
    if is_continuation:
        cmd.append("-c")
    effective_prompt = _build_downloads_prefix(session, turn) + turn.prompt
    cmd += [effective_prompt, "--auto-approve", "--session-dir", trace_dir]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_tasks.py::TestExecuteKlaudeUsesPrefix -v`
Expected: PASS.

- [ ] **Step 5: Run the wider task test file to confirm no regressions**

Run: `uv run pytest website/tests/test_tasks.py -v`
Expected: all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add website/tasks.py website/tests/test_tasks.py
git commit -m "feat(slops): prepend downloads prefix to klaude CLI prompt"
```

---

## Task 5: `_register_downloads` scanner

Scans `downloads/<session_id>/<turn_id>/` after a turn completes. Enforces file-count cap, per-file size (marks `oversize=True` for over-cap files), and total-servable-bytes cap.

**Files:**
- Modify: `website/tasks.py`
- Test: `website/tests/test_tasks.py`

- [ ] **Step 1: Write the failing tests**

Add these imports to the top of `website/tests/test_tasks.py` (alongside the existing `from unittest.mock import patch` and `from website.models import Session, Turn`):

```python
from unittest.mock import MagicMock
from website.models import Download
```

Then append to the end of the file:

```python
def _mock_find_result(pairs):
    """Return a MagicMock that mimics subprocess.run's CompletedProcess for find."""
    m = MagicMock()
    m.returncode = 0
    m.stdout = "\n".join(f"{name}|{size}" for name, size in pairs) + "\n"
    return m


@pytest.mark.django_db
class TestRegisterDownloads:
    def _setup(self):
        s = Session.objects.create(workspace="ws", trace_path="/t")
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="done")
        return s, t

    def test_no_dir_creates_no_rows(self):
        s, t = self._setup()
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="")
            from website.tasks import _register_downloads
            _register_downloads(t)
        assert Download.objects.count() == 0

    def test_missing_dir_returncode_nonzero(self):
        s, t = self._setup()
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stdout="")
            from website.tasks import _register_downloads
            _register_downloads(t)
        assert Download.objects.count() == 0

    def test_single_file_creates_row(self):
        s, t = self._setup()
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = _mock_find_result([("a.md", 100)])
            from website.tasks import _register_downloads
            _register_downloads(t)
        rows = list(Download.objects.all())
        assert len(rows) == 1
        assert rows[0].filename == "a.md"
        assert rows[0].size == 100
        assert rows[0].oversize is False

    def test_respects_max_files(self):
        s, t = self._setup()
        pairs = [(f"f{i}.txt", 10) for i in range(7)]
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = _mock_find_result(pairs)
            from website.tasks import _register_downloads
            _register_downloads(t)
        assert Download.objects.count() == 5

    def test_marks_oversize(self):
        s, t = self._setup()
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = _mock_find_result([("big.bin", 6 * 1024 * 1024)])
            from website.tasks import _register_downloads
            _register_downloads(t)
        row = Download.objects.get()
        assert row.oversize is True
        assert row.size == 6 * 1024 * 1024

    def test_servable_total_cap_stops_after_10mb(self):
        s, t = self._setup()
        # 3 files of 4 MB each — second fits (total 8 MB), third (12 MB total) skipped
        pairs = [(f"f{i}.bin", 4 * 1024 * 1024) for i in range(3)]
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = _mock_find_result(pairs)
            from website.tasks import _register_downloads
            _register_downloads(t)
        assert Download.objects.count() == 2

    def test_oversize_does_not_count_toward_total(self):
        s, t = self._setup()
        # oversize first, then a 9 MB servable: both should be registered
        pairs = [("big.bin", 6 * 1024 * 1024), ("ok.bin", 9 * 1024 * 1024)]
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = _mock_find_result(pairs)
            from website.tasks import _register_downloads
            _register_downloads(t)
        rows = list(Download.objects.order_by("id"))
        assert len(rows) == 2
        assert rows[0].oversize is True
        assert rows[1].oversize is False

    def test_shells_out_with_klaude_user(self):
        s, t = self._setup()
        with patch("website.tasks.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="")
            from website.tasks import _register_downloads
            _register_downloads(t)
        cmd = mock_run.call_args.args[0]
        assert cmd[0] == "sudo"
        assert cmd[1] == "-u"
        assert cmd[2] == "klaude"
        assert cmd[3] == "find"
        assert f"downloads/{s.id}/{t.id}" in cmd[4]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_tasks.py::TestRegisterDownloads -v`
Expected: `ImportError: cannot import name '_register_downloads'`.

- [ ] **Step 3: Implement `_register_downloads`**

Edit `website/tasks.py`. Add `import re` to the top-level imports (alphabetical placement, after `import os`). Then append below the existing functions:

```python
from website.models import Download


_DOWNLOAD_REL_RE = re.compile(r"downloads/\d+/\d+")


def _register_downloads(turn):
    """After a turn completes, scan its downloads dir and create Download rows."""
    session = turn.session
    if not session.workspace:
        return
    rel_dir = f"downloads/{session.id}/{turn.id}"
    if not _DOWNLOAD_REL_RE.fullmatch(rel_dir):
        return  # defensive: should be unreachable
    abs_dir = os.path.join(WORKSPACE_BASE, session.workspace, rel_dir)

    result = subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "find", abs_dir,
         "-maxdepth", "1", "-type", "f", "-printf", "%f|%s\n"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return

    servable_total = 0
    created = 0
    for line in result.stdout.strip().split("\n"):
        try:
            name, size_str = line.rsplit("|", 1)
            size = int(size_str)
        except (ValueError, IndexError):
            continue
        if created >= MAX_FILES_PER_TURN:
            break
        oversize = size > MAX_SINGLE_FILE
        if not oversize and servable_total + size > MAX_TOTAL_UPLOAD:
            break
        Download.objects.create(turn=turn, filename=name, size=size, oversize=oversize)
        if not oversize:
            servable_total += size
        created += 1
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_tasks.py::TestRegisterDownloads -v`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add website/tasks.py website/tests/test_tasks.py
git commit -m "feat(slops): add _register_downloads dir scanner with caps"
```

---

## Task 6: Call `_register_downloads` after a successful turn

**Files:**
- Modify: `website/tasks.py` (`run_turn`)
- Test: `website/tests/test_tasks.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_tasks.py`:

```python
@pytest.mark.django_db
class TestRunTurnRegistersDownloads:
    def test_done_turn_calls_register_downloads(self):
        s = Session.objects.create(workspace="ws", trace_path="/home/klaude/traces/ws/1", status="approved")
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="approved")
        with patch("website.tasks._execute_klaude") as mock_exec, patch(
            "website.tasks._register_downloads"
        ) as mock_reg:
            mock_exec.return_value = {"summary": "ok", "token_count": 0, "tool_calls": 0, "error": ""}
            run_turn(t.id)
        mock_reg.assert_called_once()
        assert mock_reg.call_args.args[0].id == t.id

    def test_failed_turn_does_not_register_downloads(self):
        s = Session.objects.create(workspace="ws", trace_path="/t", status="approved")
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="approved")
        with patch("website.tasks._execute_klaude") as mock_exec, patch(
            "website.tasks._register_downloads"
        ) as mock_reg:
            mock_exec.return_value = {"summary": "", "token_count": 0, "tool_calls": 0, "error": "boom"}
            run_turn(t.id)
        mock_reg.assert_not_called()

    def test_exception_does_not_register_downloads(self):
        s = Session.objects.create(workspace="ws", trace_path="/t", status="approved")
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="approved")
        with patch("website.tasks._execute_klaude", side_effect=Exception("x")), patch(
            "website.tasks._register_downloads"
        ) as mock_reg:
            run_turn(t.id)
        mock_reg.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_tasks.py::TestRunTurnRegistersDownloads -v`
Expected: FAIL — `_register_downloads` never called.

- [ ] **Step 3: Modify `run_turn`**

Edit `website/tasks.py` `run_turn`. Find the existing block:

```python
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
```

Replace with:

```python
    try:
        result = _execute_klaude(turn, is_continuation)
        turn.status = "done" if not result["error"] else "failed"
        turn.summary = result["summary"]
        turn.token_count = result["token_count"]
        turn.tool_calls = result["tool_calls"]
        turn.error = result["error"]
        if turn.status == "done":
            try:
                _register_downloads(turn)
            except Exception:
                # Registration failures must never surface as turn failure
                pass
    except Exception as e:
        turn.status = "failed"
        turn.error = str(e)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_tasks.py -v`
Expected: all tests PASS (including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add website/tasks.py website/tests/test_tasks.py
git commit -m "feat(slops): register downloads after a turn finishes successfully"
```

---

## Task 7: Serialize downloads on turn JSON

Extend `_serialize_turn` so the session detail endpoint includes `downloads` on each turn.

**Files:**
- Modify: `website/views/slops.py` (`_serialize_turn`)
- Test: `website/tests/test_slops.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_slops.py`:

```python
@pytest.mark.django_db
class TestDownloadsInSerialization:
    def test_turn_includes_downloads_field(self, client):
        s = Session.objects.create()
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="done")
        Download.objects.create(turn=t, filename="out.md", size=100)
        Download.objects.create(turn=t, filename="big.bin", size=10_000_000, oversize=True)

        resp = client.get(f"/api/slops/{s.id}/")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["turns"]) == 1
        downloads = data["turns"][0]["downloads"]
        assert len(downloads) == 2
        assert downloads[0]["filename"] == "out.md"
        assert downloads[0]["size"] == 100
        assert downloads[0]["oversize"] is False
        assert downloads[1]["oversize"] is True
        assert "id" in downloads[0]

    def test_turn_without_downloads_has_empty_list(self, client):
        s = Session.objects.create()
        Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="done")
        resp = client.get(f"/api/slops/{s.id}/")
        assert resp.json()["turns"][0]["downloads"] == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_slops.py::TestDownloadsInSerialization -v`
Expected: FAIL — `downloads` key missing.

- [ ] **Step 3: Extend `_serialize_turn`**

Edit `website/views/slops.py`. In `_serialize_turn`, before the `if include_ip:` block, add:

```python
    data["downloads"] = [
        {"id": d.id, "filename": d.filename, "size": d.size, "oversize": d.oversize}
        for d in t.downloads.all()
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_slops.py::TestDownloadsInSerialization -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/views/slops.py website/tests/test_slops.py
git commit -m "feat(slops): include downloads in turn serialization"
```

---

## Task 8: `slops_download` streaming view

Public endpoint that streams a registered download's bytes as an attachment.

**Files:**
- Modify: `website/views/slops.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`
- Test: `website/tests/test_slops.py`

- [ ] **Step 1: Write the failing tests**

Ensure `from unittest.mock import MagicMock, patch` exists at the top of `website/tests/test_slops.py` (if only `patch` is imported, extend it to `MagicMock, patch`). Then append to the end of the file:

```python
@pytest.mark.django_db
class TestSlopsDownload:
    def _make_download(self, **kwargs):
        s = Session.objects.create(workspace="ws", trace_path="/t")
        t = Turn.objects.create(session=s, prompt="p", submitter_ip="127.0.0.1", status="done")
        return Download.objects.create(
            turn=t, filename=kwargs.get("filename", "a.md"),
            size=kwargs.get("size", 10),
            oversize=kwargs.get("oversize", False),
        )

    def test_404_on_missing(self, client):
        resp = client.get("/api/slops/downloads/99999/")
        assert resp.status_code == 404

    def test_403_on_oversize(self, client):
        d = self._make_download(size=10_000_000, oversize=True)
        resp = client.get(f"/api/slops/downloads/{d.id}/")
        assert resp.status_code == 403

    def test_streams_bytes(self, client):
        d = self._make_download(filename="hello.txt", size=12)
        fake_proc = MagicMock()
        fake_proc.stdout = iter([b"hello, world"])
        with patch("website.views.slops.subprocess.Popen", return_value=fake_proc):
            resp = client.get(f"/api/slops/downloads/{d.id}/")
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/octet-stream"
        assert "attachment" in resp["Content-Disposition"]
        assert "hello.txt" in resp["Content-Disposition"]
        assert b"".join(resp.streaming_content) == b"hello, world"

    def test_post_rejected(self, client):
        d = self._make_download()
        resp = client.post(f"/api/slops/downloads/{d.id}/")
        assert resp.status_code == 405

    def test_popen_called_with_sudo_klaude(self, client):
        d = self._make_download(filename="x.bin", size=3)
        fake_proc = MagicMock()
        fake_proc.stdout = iter([b"abc"])
        with patch("website.views.slops.subprocess.Popen", return_value=fake_proc) as mock_popen:
            client.get(f"/api/slops/downloads/{d.id}/")
        cmd = mock_popen.call_args.args[0]
        assert cmd[0] == "sudo"
        assert cmd[1] == "-u"
        assert cmd[2] == "klaude"
        assert cmd[3] == "cat"
        assert f"downloads/{d.turn.session.id}/{d.turn.id}/x.bin" in cmd[4]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_slops.py::TestSlopsDownload -v`
Expected: FAIL — endpoint does not exist (likely 404 due to no URL match).

- [ ] **Step 3: Add `slops_download` view**

At the top of `website/views/slops.py`, add imports:

```python
import subprocess
from urllib.parse import quote

from django.http import StreamingHttpResponse
```

(`HttpResponse`, `JsonResponse` and `subprocess` may already be imported — do not duplicate. Keep existing imports; only add what is missing.)

Then append to `website/views/slops.py`:

```python
WORKSPACE_BASE = "/home/klaude/workspace"
_DOWNLOAD_REL_RE_FULL = re.compile(r"downloads/\d+/\d+/.+")


def _ascii_fallback(name: str) -> str:
    """ASCII-only fallback for Content-Disposition filename=, with quotes escaped."""
    ascii_name = name.encode("ascii", "replace").decode("ascii").replace('"', "_")
    return ascii_name or "download"


def slops_download(request, download_id):
    """GET /api/slops/downloads/<id>/ — public, streams the file bytes."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    from website.models import Download

    try:
        d = Download.objects.select_related("turn__session").get(id=download_id)
    except Download.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if d.oversize:
        return JsonResponse({"error": "File too large to download"}, status=403)

    session = d.turn.session
    rel = f"downloads/{session.id}/{d.turn.id}/{d.filename}"
    if not _DOWNLOAD_REL_RE_FULL.fullmatch(rel):
        return JsonResponse({"error": "Invalid download"}, status=400)

    abs_path = os.path.join(WORKSPACE_BASE, session.workspace, rel)

    proc = subprocess.Popen(
        ["sudo", "-u", "klaude", "cat", abs_path],
        stdout=subprocess.PIPE,
    )
    response = StreamingHttpResponse(proc.stdout, content_type="application/octet-stream")
    response["Content-Disposition"] = (
        f'attachment; filename="{_ascii_fallback(d.filename)}"; '
        f"filename*=UTF-8''{quote(d.filename)}"
    )
    response["Content-Length"] = str(d.size)
    return response
```

- [ ] **Step 4: Export the view**

Edit `website/views/__init__.py`. Add `slops_download` to the `from .slops import (...)` block (alphabetical placement) and to `__all__`.

- [ ] **Step 5: Add the URL route**

Edit `website/urls.py`. Add this line inside `urlpatterns`, alongside the other `slops/` routes:

```python
    path("slops/downloads/<int:download_id>/", views.slops_download),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_slops.py::TestSlopsDownload -v`
Expected: all 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add website/views/slops.py website/views/__init__.py website/urls.py website/tests/test_slops.py
git commit -m "feat(slops): add GET /api/slops/downloads/<id>/ streaming endpoint"
```

---

## Task 9: Clean up downloads dir on session delete

**Files:**
- Modify: `website/views/slops.py` (`slops_delete`)
- Test: `website/tests/test_slops.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_slops.py`:

```python
@pytest.mark.django_db
class TestSlopsDeleteCleansDownloads:
    def test_delete_shells_rm_rf_for_session_downloads(self, client, auth_headers):
        s = Session.objects.create(workspace="ws")
        with patch("website.views.slops.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            resp = client.post(f"/api/slops/{s.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        # Find the rm -rf call
        rm_calls = [c for c in mock_run.call_args_list if "rm" in c.args[0]]
        assert rm_calls, f"no rm call found among {mock_run.call_args_list}"
        cmd = rm_calls[0].args[0]
        assert cmd[:4] == ["sudo", "-u", "klaude", "rm"]
        assert "-rf" in cmd
        assert any(f"downloads/{s.id}" in a for a in cmd)

    def test_delete_skips_rm_when_no_workspace(self, client, auth_headers):
        s = Session.objects.create()  # workspace=""
        with patch("website.views.slops.subprocess.run") as mock_run:
            resp = client.post(f"/api/slops/{s.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        rm_calls = [c for c in mock_run.call_args_list if "rm" in c.args[0]]
        assert not rm_calls
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_slops.py::TestSlopsDeleteCleansDownloads -v`
Expected: FAIL — current `slops_delete` only deletes the DB row.

- [ ] **Step 3: Extend `slops_delete`**

Edit `website/views/slops.py` `slops_delete`. Replace its body with:

```python
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        session = Session.objects.get(id=session_id)
    except Session.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if session.workspace:
        rel = f"downloads/{session.id}"
        if re.fullmatch(r"downloads/\d+", rel):
            abs_dir = os.path.join(WORKSPACE_BASE, session.workspace, rel)
            subprocess.run(
                ["sudo", "-u", "klaude", "rm", "-rf", "--", abs_dir],
                capture_output=True,
            )

    session.delete()
    return JsonResponse({"ok": True})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_slops.py -v`
Expected: all slops tests PASS (pre-existing + new).

- [ ] **Step 5: Commit**

```bash
git add website/views/slops.py website/tests/test_slops.py
git commit -m "feat(slops): rm -rf downloads/<session>/ on session delete"
```

---

## Task 10: Frontend `slopsLimits.ts` + `formatSize`

**Files:**
- Create: `frontend/src/lib/slopsLimits.ts`
- Create: `frontend/src/lib/__tests__/slopsLimits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/__tests__/slopsLimits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MAX_FILES_PER_TURN,
  MAX_SINGLE_FILE,
  MAX_TOTAL_UPLOAD,
  formatSize,
} from "../slopsLimits";

describe("slopsLimits constants", () => {
  it("mirrors backend values", () => {
    expect(MAX_FILES_PER_TURN).toBe(5);
    expect(MAX_SINGLE_FILE).toBe(5 * 1024 * 1024);
    expect(MAX_TOTAL_UPLOAD).toBe(10 * 1024 * 1024);
  });
});

describe("formatSize", () => {
  it("formats bytes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
  });
  it("formats kilobytes with one decimal", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
  });
  it("formats megabytes with one decimal", () => {
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test slopsLimits --run`
Expected: FAIL — `slopsLimits.ts` does not exist.

- [ ] **Step 3: Create `slopsLimits.ts`**

Create `frontend/src/lib/slopsLimits.ts`:

```ts
export const MAX_FILES_PER_TURN = 5;
export const MAX_SINGLE_FILE = 5 * 1024 * 1024;
export const MAX_TOTAL_UPLOAD = 10 * 1024 * 1024;

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && pnpm test slopsLimits --run`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/slopsLimits.ts frontend/src/lib/__tests__/slopsLimits.test.ts
git commit -m "feat(slops): add shared slopsLimits module with formatSize"
```

---

## Task 11: Extend `Turn` type with `downloads`

**Files:**
- Modify: `frontend/src/lib/api.ts`

This task has no dedicated test — it is a type-only change covered by the TypeScript compiler via `pnpm build` / `pnpm lint`.

- [ ] **Step 1: Add the type and extend `Turn`**

Edit `frontend/src/lib/api.ts`. After the existing `TurnStatus` type, add:

```ts
export interface Download {
  id: number;
  filename: string;
  size: number;
  oversize: boolean;
}
```

Then modify the `Turn` interface: add at the end (after `completed_at`):

```ts
  downloads?: Download[];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && pnpm lint`
Expected: no errors.

Run: `cd frontend && pnpm test --run`
Expected: all frontend tests still PASS (no regressions).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(slops): add Download type to Turn"
```

---

## Task 12: `DownloadChips` component + placement in TraceViewer

Renders one chip row per completed turn, below that turn's final assistant message. Turn boundaries are detected by counting user messages in the ATIF-derived message list.

**Files:**
- Modify: `frontend/src/app/slops/components/TraceViewer.tsx`
- Modify: `frontend/src/app/slops/page.tsx` (pass `turns` prop)

- [ ] **Step 1: Add `DownloadChips` subcomponent and plumbing**

Edit `frontend/src/app/slops/components/TraceViewer.tsx`.

Update the imports at top:

```tsx
import { type SessionTrace, type Turn, type Download } from "@/lib/api";
import { API } from "@/lib/api";
import { formatSize } from "@/lib/slopsLimits";
```

Add a new component above `TraceViewer`:

```tsx
function DownloadChips({ downloads }: { downloads: Download[] }) {
  if (downloads.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 8,
      }}
    >
      {downloads.map((d) =>
        d.oversize ? (
          <span
            key={d.id}
            style={{
              padding: "4px 8px",
              border: `1px solid #333`,
              borderRadius: 4,
              background: "#111",
              color: "#666",
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            {d.filename} · {formatSize(d.size)} · (too large)
          </span>
        ) : (
          <a
            key={d.id}
            href={`${API}/api/slops/downloads/${d.id}/`}
            download
            style={{
              padding: "4px 8px",
              border: `1px solid ${ACCENT}40`,
              borderRadius: 4,
              background: `${ACCENT}10`,
              color: "#ddd",
              fontSize: 11,
              fontFamily: "monospace",
              textDecoration: "none",
            }}
          >
            {d.filename} · {formatSize(d.size)} · ⬇
          </a>
        ),
      )}
    </div>
  );
}
```

Change the TraceViewer signature from:

```tsx
export default function TraceViewer({ trace, status, error }: { trace: SessionTrace; status: string; error?: string }) {
```

to:

```tsx
export default function TraceViewer({
  trace,
  status,
  error,
  turns = [],
}: {
  trace: SessionTrace;
  status: string;
  error?: string;
  turns?: Turn[];
}) {
```

Immediately inside the function body, after `const messages: TraceMessage[] = ...`, add:

```tsx
  // Turn boundaries: each user message = start of a new turn. The Nth user
  // message corresponds to turns[N] (ordered chronologically, same as backend).
  const lastAssistantOfTurn = new Map<number, number>(); // message_index -> turn_index
  {
    let turnIdx = -1;
    let lastAssistantIdxInTurn = -1;
    messages.forEach((m, i) => {
      if (m.role === "user") {
        if (turnIdx >= 0 && lastAssistantIdxInTurn >= 0) {
          lastAssistantOfTurn.set(lastAssistantIdxInTurn, turnIdx);
        }
        turnIdx += 1;
        lastAssistantIdxInTurn = -1;
      } else if (m.role === "assistant" && m.content) {
        lastAssistantIdxInTurn = i;
      }
    });
    if (turnIdx >= 0 && lastAssistantIdxInTurn >= 0) {
      lastAssistantOfTurn.set(lastAssistantIdxInTurn, turnIdx);
    }
  }
```

Then inside the assistant-branch rendering (the `if (msg.role === "assistant")` block), change the `return` from:

```tsx
          return (
            <div key={i} style={{ maxWidth: "90%" }}>
              {msg.content && (
                <div
```

to:

```tsx
          const turnForChips = lastAssistantOfTurn.get(i);
          const chipsDownloads =
            turnForChips !== undefined ? (turns[turnForChips]?.downloads ?? []) : [];
          return (
            <div key={i} style={{ maxWidth: "90%" }}>
              {msg.content && (
                <div
```

And just before the block's closing `</div>`, add the chip row. Find the end of the assistant rendering block, which currently ends with:

```tsx
              {msg.tool_calls?.map((tc) => (
                <ToolCallBlock key={tc.id} call={tc} />
              ))}
            </div>
          );
```

Replace with:

```tsx
              {msg.tool_calls?.map((tc) => (
                <ToolCallBlock key={tc.id} call={tc} />
              ))}
              {chipsDownloads.length > 0 && <DownloadChips downloads={chipsDownloads} />}
            </div>
          );
```

- [ ] **Step 2: Pass `turns` from the page**

Edit `frontend/src/app/slops/page.tsx`. Find the existing `<TraceViewer ... />` usage near line 768 and add the `turns` prop:

```tsx
                      <TraceViewer
                        trace={trace}
                        status={selected?.status ?? "pending"}
                        error={latestTurn?.error || ""}
                        turns={selected?.turns ?? []}
                      />
```

- [ ] **Step 3: Run frontend lint and tests**

Run: `cd frontend && pnpm lint`
Expected: no errors.

Run: `cd frontend && pnpm test --run`
Expected: all tests PASS.

- [ ] **Step 4: Manual visual check (dev server)**

Run: from repo root, in two terminals: `uv run python manage.py runserver` and `cd frontend && pnpm dev`.

Open a session in a browser at `http://localhost:3001/slops/<id>` where the DB has a session with a completed turn plus `Download` rows (insert via shell: `uv run python manage.py shell` → `Session.objects.first()` → create Download). Verify: chips render below the final assistant message, non-oversize chips are clickable links with `download` attribute, oversize chips are plain spans with "(too large)".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/slops/components/TraceViewer.tsx frontend/src/app/slops/page.tsx
git commit -m "feat(slops): render download chips below assistant messages"
```

---

## Task 13: Docs — README + QA checklist

**Files:**
- Modify: `docs/README.md` (slops section)
- Modify: `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Update `docs/README.md`**

Find the slops section (search for `/slops`). Append a sentence that Klaude can now share downloadable files with the user. Example (the exact neighbouring prose may differ — match the section's voice):

> Klaude can attach files for the user to download by writing them to a
> per-turn `downloads/` directory; these show as clickable chips below its
> final message. Limits: 5 files per turn, 5 MB per file, 10 MB total.

- [ ] **Step 2: Update `docs/QA-CHECKLIST.md`**

Append under the slops section (or add one if it doesn't exist yet):

```markdown
### Slops downloads

- [ ] Submit a prompt instructing klaude to write a small markdown file to
      `downloads/<session>/<turn>/hello.md`. Approve. After the turn
      completes, a clickable chip appears below klaude's final message;
      clicking downloads the bytes.
- [ ] Submit a prompt instructing klaude to write 6 files. Only 5 chips appear.
- [ ] Submit a prompt instructing klaude to write a file > 5 MB. The chip
      shows "(too large)" with no link.
- [ ] Delete a session with downloads. Confirm
      `/home/klaude/workspace/<ws>/downloads/<id>/` is gone.
```

- [ ] **Step 3: Commit**

```bash
git add docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs(slops): document the file-download feature"
```

---

## Task 14: Full-suite verification

- [ ] **Step 1: Run all backend tests**

Run: `uv run pytest`
Expected: all tests PASS.

- [ ] **Step 2: Run all frontend tests + lint**

Run: `cd frontend && pnpm test --run && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 3: Run linters**

Run: `uvx ruff check . && uvx ruff format .`
Expected: no changes needed (hook should have handled it during edits). If ruff made changes, commit them:

```bash
git add -u
git commit -m "style: ruff auto-format"
```

- [ ] **Step 4: Confirm migrations are clean**

Run: `uv run python manage.py makemigrations --check`
Expected: `No changes detected`.
