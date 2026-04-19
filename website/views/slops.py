import json
import os
import re
import subprocess
from datetime import timedelta
from urllib.parse import quote

from django.db.models import Sum
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin, verify_token
from ..models import Session, Turn
from ..utils import get_client_ip, parse_json_body, parse_pagination

_WORKSPACE_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")


def _is_admin(request):
    auth = request.headers.get("Authorization", "")
    return auth.startswith("Bearer ") and verify_token(auth[7:])


SUBMIT_COOLDOWN = timedelta(hours=1)
GLOBAL_SUBMIT_LIMIT = 10
MAX_PROMPT_LENGTH = 5000
DEFAULT_LIMIT = 20

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
    }
    data["downloads"] = [
        {"id": d.id, "filename": d.filename, "size": d.size, "oversize": d.oversize} for d in t.downloads.all()
    ]
    if include_ip:
        data["submitter_ip"] = t.submitter_ip
    return data


def _serialize_session(s, turns=None, include_ip=False):
    if turns is None:
        turns = s.turns.all()
    return {
        "id": s.id,
        "workspace": s.workspace,
        "status": s.status,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "turns": [_serialize_turn(t, include_ip=include_ip) for t in turns],
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

    try:
        limit, offset = parse_pagination(request, default_limit=DEFAULT_LIMIT, max_limit=100)
    except (ValueError, TypeError):
        return JsonResponse({"error": "Invalid pagination parameters"}, status=400)

    qs = Session.objects.exclude(status="rejected").prefetch_related("turns")
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
        s = Session.objects.prefetch_related("turns").get(id=session_id)
    except Session.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    return JsonResponse(_serialize_session(s))


@csrf_exempt
def slops_submit(request):
    """POST /api/slops/submit/ — rate-limited 1/hr/IP + 10/hr global."""
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

    Turn.objects.create(session=session, prompt=prompt, submitter_ip=ip)
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
            workspace = "klaude-playground"
        elif not _WORKSPACE_RE.match(workspace):
            return JsonResponse(
                {"error": "Invalid workspace name (alphanumeric, dots, hyphens, underscores)"}, status=400
            )

        session.workspace = workspace
        session.trace_path = os.path.join("/home/klaude/traces", workspace, str(session.id))
        session.save(update_fields=["workspace", "trace_path"])

    turn.status = "approved"
    turn.approved_at = timezone.now()
    turn.save()

    _update_session_status(session)

    # Queue Celery task
    from website.tasks import run_turn

    run_turn.delay(turn.id)

    return JsonResponse(_serialize_session(session, include_ip=True))


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

    return JsonResponse(_serialize_session(turn.session, include_ip=True))


@csrf_exempt
@require_admin
def slops_delete(request, session_id):
    """POST /api/slops/<session_id>/delete/ — admin, delete session and all turns."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        session = Session.objects.get(id=session_id)
    except Session.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    session.delete()
    return JsonResponse({"ok": True})


@csrf_exempt
@require_admin
def slops_cancel(request, turn_id):
    """POST /api/slops/turns/<turn_id>/cancel/ — admin, cancel a running turn."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        turn = Turn.objects.select_related("session").get(id=turn_id)
    except Turn.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if turn.status not in ("running", "approved"):
        return JsonResponse({"error": f"Cannot cancel turn with status '{turn.status}'"}, status=409)

    # Kill any running klaude process for this session's trace dir
    if turn.session.trace_path:
        trace = turn.session.trace_path
        # Validate trace_path matches expected format before passing to pkill
        if re.fullmatch(r"/home/klaude/traces/[a-zA-Z0-9._-]+/\d+", trace):
            subprocess.run(
                ["sudo", "-u", "klaude", "pkill", "-f", f"--session-dir {trace}"],
                capture_output=True,
            )

    turn.status = "failed"
    turn.error = "Cancelled by admin"
    turn.completed_at = timezone.now()
    turn.save()

    _update_session_status(turn.session)

    return JsonResponse(_serialize_session(turn.session, include_ip=True))


def _atif_to_messages(atif):
    """Convert ATIF steps to OpenAI chat message format for TraceViewer."""
    messages = []
    for step in atif.get("steps", []):
        source = step.get("source")
        if source == "user":
            messages.append({"role": "user", "content": step.get("message", "")})
        elif source == "agent":
            msg = {"role": "assistant", "content": step.get("message")}
            if step.get("tool_calls"):
                msg["tool_calls"] = [
                    {
                        "id": tc.get("tool_call_id", ""),
                        "type": "function",
                        "function": {
                            "name": tc.get("function_name", ""),
                            "arguments": json.dumps(tc["arguments"])
                            if isinstance(tc.get("arguments"), dict)
                            else tc.get("arguments", "{}"),
                        },
                    }
                    for tc in step["tool_calls"]
                ]
            messages.append(msg)
        elif source == "system":
            results = step.get("observation", {}).get("results", [])
            for r in results:
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": r.get("tool_call_id", ""),
                        "content": r.get("content", ""),
                    }
                )
    return messages


def slops_trace(request, session_id):
    """GET /api/slops/<id>/trace/ — return ATIF trace with messages for TraceViewer."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    try:
        s = Session.objects.get(id=session_id)
    except Session.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if not s.trace_path:
        return JsonResponse({"trace": None})

    from website.tasks import _read_atif_trace

    atif = _read_atif_trace(s.trace_path)
    if not atif:
        return JsonResponse({"trace": None})

    return JsonResponse({"trace": {"messages": _atif_to_messages(atif), "step_count": len(atif.get("steps", []))}})


@csrf_exempt
def slops_trace_download(request, session_id):
    """GET /api/slops/<id>/trace/download/ — download raw ATIF JSON file (admin only).

    Accepts auth via Authorization header OR ?token= query param (for direct download links).
    """
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    # Accept token from header or query param (browser downloads can't set headers)
    token = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
    else:
        token = request.GET.get("token")
    if not token or not verify_token(token):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    try:
        s = Session.objects.get(id=session_id)
    except Session.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if not s.trace_path:
        return JsonResponse({"error": "No trace available"}, status=404)

    from website.tasks import _read_atif_trace

    atif = _read_atif_trace(s.trace_path)
    if not atif:
        return JsonResponse({"error": "No trace available"}, status=404)

    content = json.dumps(atif, indent=2)
    response = HttpResponse(content, content_type="application/json")
    response["Content-Disposition"] = f'attachment; filename="atif-session-{session_id}.json"'
    return response


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
        f"attachment; filename=\"{_ascii_fallback(d.filename)}\"; filename*=UTF-8''{quote(d.filename)}"
    )
    response["Content-Length"] = str(d.size)
    return response
