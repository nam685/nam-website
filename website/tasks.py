import json
import os
import subprocess
from pathlib import Path

from django.utils import timezone

from config.celery import app
from website.models import Turn

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
    tool_calls_count = sum(len(s.get("tool_calls", [])) for s in atif.get("steps", []) if s.get("source") == "agent")

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
