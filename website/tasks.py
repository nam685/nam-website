import json
import os
import subprocess

from django.utils import timezone

from config.celery import app
from website.models import Turn

KLAUDE_USER = "klaude"
KLAUDE_BIN = "/home/klaude/.local/bin/klaude"
WORKSPACE_BASE = "/home/klaude/workspace"
TRACES_BASE = "/home/klaude/traces"


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
    cmd += [turn.prompt, "--auto-approve", "--session-dir", trace_dir]

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
    except Exception as e:
        turn.status = "failed"
        turn.error = str(e)

    turn.completed_at = timezone.now()
    turn.save()

    session.status = turn.status
    session.save(update_fields=["status"])
