from datetime import timedelta

from django.db.models import Sum
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin
from ..models import Mission
from ..utils import get_client_ip, parse_json_body

SUBMIT_COOLDOWN = timedelta(hours=1)
MAX_PROMPT_LENGTH = 5000
DEFAULT_LIMIT = 20


def _serialize_mission(m):
    return {
        "id": m.id,
        "prompt": m.prompt,
        "status": m.status,
        "workspace": m.workspace,
        "token_count": m.token_count,
        "tool_calls": m.tool_calls,
        "summary": m.summary,
        "error": m.error,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "approved_at": m.approved_at.isoformat() if m.approved_at else None,
        "started_at": m.started_at.isoformat() if m.started_at else None,
        "completed_at": m.completed_at.isoformat() if m.completed_at else None,
    }


def slops_list(request):
    """GET /api/slops/ — public mission list, excludes rejected, paginated."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    limit = min(int(request.GET.get("limit", DEFAULT_LIMIT)), 100)
    offset = int(request.GET.get("offset", 0))

    qs = Mission.objects.exclude(status="rejected")
    total = qs.count()
    missions = qs[offset : offset + limit]

    return JsonResponse(
        {
            "missions": [_serialize_mission(m) for m in missions],
            "total": total,
        }
    )


def slops_detail(request, mission_id):
    """GET /api/slops/<id>/ — single mission."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    try:
        m = Mission.objects.get(id=mission_id)
    except Mission.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    return JsonResponse(_serialize_mission(m))


@csrf_exempt
def slops_submit(request):
    """POST /api/slops/submit/ — rate-limited 1/hr/IP."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    ip = get_client_ip(request)

    # Rate limit: 1 per hour per IP
    cutoff = timezone.now() - SUBMIT_COOLDOWN
    if Mission.objects.filter(submitter_ip=ip, created_at__gte=cutoff).exists():
        return JsonResponse({"error": "You've already submitted recently. Try again later."}, status=429)

    body, err = parse_json_body(request)
    if err:
        return err

    prompt = body.get("prompt", "").strip()
    if not prompt:
        return JsonResponse({"error": "Prompt required"}, status=400)
    if len(prompt) > MAX_PROMPT_LENGTH:
        return JsonResponse({"error": f"Too long (max {MAX_PROMPT_LENGTH} chars)"}, status=400)

    m = Mission.objects.create(prompt=prompt, submitter_ip=ip)
    return JsonResponse(_serialize_mission(m), status=201)


@csrf_exempt
@require_admin
def slops_approve(request, mission_id):
    """POST /api/slops/<id>/approve/ — admin, sets approved + queues Celery task."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        m = Mission.objects.get(id=mission_id)
    except Mission.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if m.status != "pending":
        return JsonResponse({"error": f"Cannot approve mission with status '{m.status}'"}, status=409)

    # Parse optional workspace from body
    workspace = None
    if request.body and request.content_type == "application/json":
        body, err = parse_json_body(request)
        if err:
            return err
        workspace = body.get("workspace")

    if not workspace:
        workspace = f"task-{m.id}"

    m.status = "approved"
    m.approved_at = timezone.now()
    m.workspace = workspace
    m.save()

    # Queue Celery task
    from website.tasks import run_mission

    run_mission.delay(m.id)

    return JsonResponse(_serialize_mission(m))


@csrf_exempt
@require_admin
def slops_reject(request, mission_id):
    """POST /api/slops/<id>/reject/ — admin."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        m = Mission.objects.get(id=mission_id)
    except Mission.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if m.status != "pending":
        return JsonResponse({"error": f"Cannot reject mission with status '{m.status}'"}, status=409)

    m.status = "rejected"
    m.save()

    return JsonResponse(_serialize_mission(m))


def slops_trace(request, mission_id):
    """GET /api/slops/<id>/trace/ — return trace file contents."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    try:
        m = Mission.objects.get(id=mission_id)
    except Mission.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    if not m.trace_path:
        return JsonResponse({"trace": None})

    # Find newest ATIF JSON in trace dir
    from pathlib import Path

    trace_files = sorted(Path(m.trace_path).glob("*.json"), key=lambda f: f.stat().st_mtime)
    if not trace_files:
        return JsonResponse({"trace": None})

    try:
        import json

        with open(trace_files[-1]) as f:
            content = json.load(f)
    except (OSError, json.JSONDecodeError):
        return JsonResponse({"error": "Failed to read trace file"}, status=500)

    return JsonResponse({"trace": content})


def slops_stats(request):
    """GET /api/slops/stats/ — aggregate stats."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)

    completed = Mission.objects.filter(status__in=["done", "failed"])
    total_missions = completed.count()
    agg = completed.aggregate(
        total_tokens=Sum("token_count"),
        total_tool_calls=Sum("tool_calls"),
    )

    done_count = completed.filter(status="done").count()
    success_rate = round((done_count / total_missions) * 100, 1) if total_missions > 0 else 0.0

    return JsonResponse(
        {
            "total_missions": total_missions,
            "total_tokens": agg["total_tokens"] or 0,
            "total_tool_calls": agg["total_tool_calls"] or 0,
            "success_rate": success_rate,
        }
    )
