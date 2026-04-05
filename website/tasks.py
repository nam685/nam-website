import json
import os
import subprocess
from pathlib import Path

from django.utils import timezone

from config.celery import app
from website.models import Mission

KLAUDE_USER = "klaude"
KLAUDE_BIN = "/home/klaude/.local/bin/klaude"
WORKSPACE_BASE = "/home/klaude/workspace"
TRACES_BASE = "/home/klaude/traces"


def _execute_klaude(mission):
    """Run klaude CLI as the klaude user. Returns result dict."""
    workspace_dir = os.path.join(WORKSPACE_BASE, mission.workspace)
    trace_dir = os.path.join(TRACES_BASE, mission.workspace)
    os.makedirs(trace_dir, exist_ok=True)

    result = subprocess.run(
        [
            "sudo",
            "-u",
            KLAUDE_USER,
            KLAUDE_BIN,
            mission.prompt,
            "--auto-approve",
            "--session-dir",
            trace_dir,
        ],
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
        "trace_dir": trace_dir,
    }


@app.task(max_retries=0)
def run_mission(mission_id):
    """Execute a klaude mission."""
    try:
        mission = Mission.objects.get(id=mission_id)
    except Mission.DoesNotExist:
        return

    if mission.status != "approved":
        return

    mission.status = "running"
    mission.started_at = timezone.now()
    mission.save()

    try:
        result = _execute_klaude(mission)
        mission.status = "done" if not result["error"] else "failed"
        mission.summary = result["summary"]
        mission.token_count = result["token_count"]
        mission.tool_calls = result["tool_calls"]
        mission.error = result["error"]
        mission.trace_path = result["trace_dir"]
    except Exception as e:
        mission.status = "failed"
        mission.error = str(e)

    mission.completed_at = timezone.now()
    mission.save()
