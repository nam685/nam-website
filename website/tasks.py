import json
import logging
import os
import re
import subprocess

from django.utils import timezone

from config.celery import app
from website.models import Download, Turn
from website.slops_limits import MAX_FILES_PER_TURN, MAX_SINGLE_FILE, MAX_TOTAL_UPLOAD

KLAUDE_USER = "klaude"
KLAUDE_BIN = "/home/klaude/.local/bin/klaude"
WORKSPACE_BASE = "/home/klaude/workspace"
TRACES_BASE = "/home/klaude/traces"

logger = logging.getLogger(__name__)


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
    lines = [f"- uploads/{turn.session_id}/{turn.id}/{a.filename} ({_fmt_size(a.size)})" for a in attachments]
    prefix = "[attachments — read these first]\n" + "\n".join(lines) + "\n\n"
    return prefix + turn.prompt


def _sudo_read(path):
    """Read a file as the klaude user. Returns content string or None."""
    result = subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "cat", path],
        capture_output=True,
        text=True,
    )
    return result.stdout if result.returncode == 0 else None


def _sudo_ls_json(trace_dir):
    """List .json files in trace_dir as klaude user, sorted by mtime (newest last)."""
    result = subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "find", trace_dir, "-maxdepth", "1", "-name", "*.json", "-printf", "%T@ %p\n"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return []
    lines = sorted(result.stdout.strip().split("\n"))
    return [line.split(" ", 1)[1] for line in lines]


def _read_atif_trace(trace_dir):
    """Read newest ATIF JSON from trace_dir as klaude user."""
    files = _sudo_ls_json(trace_dir)
    if not files:
        return {}
    content = _sudo_read(files[-1])
    if not content:
        return {}
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {}


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


def _execute_klaude(turn, is_continuation):
    """Run klaude CLI as the klaude user. Returns result dict."""
    session = turn.session
    workspace_dir = os.path.join(WORKSPACE_BASE, session.workspace)
    trace_dir = session.trace_path

    # Create dirs as klaude user (Django runs as nam, can't write to /home/klaude/)
    subprocess.run(["sudo", "-u", KLAUDE_USER, "mkdir", "-p", trace_dir], check=True)
    subprocess.run(["sudo", "-u", KLAUDE_USER, "mkdir", "-p", workspace_dir], check=True)

    cmd = ["sudo", "-u", KLAUDE_USER, KLAUDE_BIN]
    if is_continuation:
        cmd.append("-c")
    effective_prompt = _build_downloads_prefix(session, turn) + _build_prompt_with_attachments(turn)
    cmd += [effective_prompt, "--auto-approve", "--session-dir", trace_dir]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=600,
        cwd=workspace_dir,
    )

    atif = _read_atif_trace(trace_dir)

    # Metrics from ATIF final_metrics
    fm = atif.get("final_metrics", {})
    token_count = fm.get("total_prompt_tokens", 0) + fm.get("total_completion_tokens", 0)
    tool_calls_count = sum(len(s.get("tool_calls", [])) for s in atif.get("steps", []) if s.get("source") == "agent")

    # Summary from last agent step with content
    summary = ""
    for step in reversed(atif.get("steps", [])):
        if step.get("source") == "agent" and step.get("message"):
            summary = step["message"][:500]
            break

    error = result.stderr if result.returncode != 0 else ""
    if not error and not atif:
        error = "klaude produced no trace output"

    return {
        "summary": summary,
        "token_count": token_count,
        "tool_calls": tool_calls_count,
        "error": error,
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
        if turn.status == "done":
            try:
                _register_downloads(turn)
            except Exception:
                # Registration failures must never surface as turn failure
                logger.exception("_register_downloads failed for turn %s", turn.id)
    except Exception as e:
        turn.status = "failed"
        turn.error = str(e)

    turn.completed_at = timezone.now()
    turn.save()

    session.status = turn.status
    session.save(update_fields=["status"])


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
        ["sudo", "-u", KLAUDE_USER, "find", abs_dir, "-maxdepth", "1", "-type", "f", "-printf", "%f|%s\n"],
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
