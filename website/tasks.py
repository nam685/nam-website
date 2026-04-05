import json
import os
import subprocess

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

    result = subprocess.run(
        [
            "sudo",
            "-u",
            KLAUDE_USER,
            KLAUDE_BIN,
            mission.prompt,
            "--cwd",
            workspace_dir,
        ],
        capture_output=True,
        text=True,
        timeout=600,  # 10 minute max
        cwd=workspace_dir,
    )

    # Read session file if it exists (klaude saves to .klaude/sessions/)
    session_dir = os.path.join(workspace_dir, ".klaude", "sessions")
    session_data = {}
    if os.path.isdir(session_dir):
        sessions = sorted(os.listdir(session_dir))
        if sessions:
            with open(os.path.join(session_dir, sessions[-1])) as f:
                session_data = json.load(f)

    # Count tokens and tool calls from session messages
    token_count = 0
    tool_calls_count = 0
    for msg in session_data.get("messages", []):
        if msg.get("role") == "assistant":
            content = msg.get("content", "") or ""
            token_count += len(content) // 4  # rough estimate
            if msg.get("tool_calls"):
                tool_calls_count += len(msg["tool_calls"])

    # Copy session to traces dir
    os.makedirs(trace_dir, exist_ok=True)
    if session_data:
        with open(os.path.join(trace_dir, "trace.json"), "w") as f:
            json.dump(session_data, f, indent=2)

    # Extract summary from last assistant message
    summary = ""
    for msg in reversed(session_data.get("messages", [])):
        if msg.get("role") == "assistant" and msg.get("content"):
            summary = msg["content"][:500]
            break

    return {
        "summary": summary,
        "token_count": token_count,
        "tool_calls": tool_calls_count,
        "error": result.stderr if result.returncode != 0 else "",
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
    except Exception as e:
        mission.status = "failed"
        mission.error = str(e)

    mission.completed_at = timezone.now()
    mission.save()
