import hashlib
import logging

from django.db.models import Count
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin
from ..models import Aoe2Match
from ..tasks import analyze_match
from ..utils import parse_pagination

logger = logging.getLogger(__name__)


def _summary(m):
    return {
        "id": m.id,
        "played_at": m.played_at.isoformat() if m.played_at else None,
        "map_name": m.map_name,
        "duration_seconds": m.duration_seconds,
        "my_civ": m.my_civ,
        "opponent_civ": m.opponent_civ,
        "my_result": m.my_result,
        "my_elo": m.my_elo,
        "my_rating_change": m.my_rating_change,
        "opening": (m.metrics or {}).get("opening", ""),
        "featured": m.featured,
        "clip_url": m.clip_url,
    }


def aoe2_list(request):
    try:
        limit, offset = parse_pagination(request)
    except ValueError:
        return JsonResponse({"error": "Invalid pagination parameters"}, status=400)
    qs = Aoe2Match.objects.filter(analysis_status="done")
    total = qs.count()
    matches = [_summary(m) for m in qs[offset : offset + limit]]
    return JsonResponse({"matches": matches, "total": total})


def aoe2_detail(_request, match_id):
    try:
        m = Aoe2Match.objects.get(id=match_id, analysis_status="done")
    except Aoe2Match.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)
    data = _summary(m)
    data["timeline"] = m.timeline
    data["metrics"] = m.metrics
    data["coach_analysis"] = m.coach_analysis
    data["clip_title"] = m.clip_title
    data["clip_note"] = m.clip_note
    data["clip_start_seconds"] = m.clip_start_seconds
    return JsonResponse(data)


def aoe2_stats(_request):
    qs = Aoe2Match.objects.filter(analysis_status="done")
    wins = qs.filter(my_result="win").count()
    losses = qs.filter(my_result="loss").count()
    fav = qs.values("my_civ").annotate(n=Count("my_civ")).order_by("-n").first()
    latest_elo = qs.exclude(my_elo=None).order_by("-played_at").values_list("my_elo", flat=True).first()
    return JsonResponse(
        {
            "total": qs.count(),
            "wins": wins,
            "losses": losses,
            "favourite_civ": fav["my_civ"] if fav and fav["my_civ"] else None,
            "current_elo": latest_elo,
        }
    )


@csrf_exempt
@require_admin
def aoe2_upload(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    f = request.FILES.get("rec")
    if not f:
        return JsonResponse({"error": "rec file required"}, status=400)
    raw = f.read()
    file_hash = hashlib.sha256(raw).hexdigest()

    existing = Aoe2Match.objects.filter(file_hash=file_hash).first()
    if existing:
        return JsonResponse({"id": existing.id, "status": existing.analysis_status, "duplicate": True})

    from django.core.files.base import ContentFile

    match = Aoe2Match.objects.create(file_hash=file_hash)
    match.rec_file.save(f.name or f"{file_hash}.aoe2record", ContentFile(raw), save=True)
    analyze_match.delay(match.id)
    return JsonResponse({"id": match.id, "status": match.analysis_status}, status=201)


@require_admin
def aoe2_sync_status(_request):
    recent = Aoe2Match.objects.order_by("-created_at")[:20]
    return JsonResponse(
        {
            "matches": [
                {"id": m.id, "status": m.analysis_status, "my_civ": m.my_civ, "error": m.error_detail} for m in recent
            ]
        }
    )


@csrf_exempt
@require_admin
def aoe2_delete(request, match_id):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    Aoe2Match.objects.filter(id=match_id).delete()
    return JsonResponse({"ok": True})


@csrf_exempt
@require_admin
def aoe2_reanalyze(request, match_id):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    if not Aoe2Match.objects.filter(id=match_id).exists():
        return JsonResponse({"error": "Not found"}, status=404)
    analyze_match.delay(match_id)
    return JsonResponse({"ok": True})
