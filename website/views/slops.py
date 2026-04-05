import os
from datetime import timedelta

from django.db.models import Sum
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin, verify_token
from ..models import Session, Turn
from ..utils import get_client_ip, parse_json_body


def _is_admin(request):
    auth = request.headers.get("Authorization", "")
    return auth.startswith("Bearer ") and verify_token(auth[7:])


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

    from website.tasks import _read_atif_trace

    content = _read_atif_trace(s.trace_path)
    if not content:
        return JsonResponse({"trace": None})

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
