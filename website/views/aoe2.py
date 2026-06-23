import hashlib
import logging
import re
from datetime import datetime, timedelta, timezone

from django.conf import settings as dj_settings
from django.core.cache import cache
from django.db.models import Count
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin
from ..models import Aoe2Match
from ..tasks import analyze_match
from ..utils import parse_json_body, parse_pagination

# Matches: "MP Replay v... @YYYY.MM.DD HHMMSS (N).aoe2record"
_REC_FILENAME_RE = re.compile(r"@(\d{4})\.(\d{2})\.(\d{2}) (\d{2})(\d{2})(\d{2})")

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
    data["coach_tier"] = m.coach_tier
    # aoe2coach v2 rich data (sub-projects #1/#2/#3/#5/#6). Optional → old matches degrade gracefully
    # (empty dicts/lists) and the frontend falls back to the flat metrics text view.
    data["reconstruction"] = m.reconstruction
    data["map_geometry"] = m.map_geometry
    data["classifier"] = m.classifier
    data["mistakes"] = m.mistakes
    data["economy"] = m.economy
    # Map PNGs are served from MEDIA; expose absolute media URLs (overall first, then engagements).
    media_url = dj_settings.MEDIA_URL
    data["map_images"] = [f"{media_url}{p}" for p in (m.map_images or [])]
    data["clip_title"] = m.clip_title
    data["clip_note"] = m.clip_note
    data["clip_start_seconds"] = m.clip_start_seconds
    return JsonResponse(data)


def aoe2_stats(_request):
    qs = Aoe2Match.objects.filter(analysis_status="done")
    wins = qs.filter(my_result="win").count()
    losses = qs.filter(my_result="loss").count()
    fav = qs.values("my_civ").annotate(n=Count("my_civ")).order_by("-n").first()

    # Prefer the Relic-cached live ELO/rank (written by enrich_ladder daily task).
    ladder_stat = cache.get("aoe2:ladder_stat") or {}
    current_elo = ladder_stat.get("rating")
    current_rank = ladder_stat.get("rank")

    # Fallback: derive from the most recently played enriched match.
    if current_elo is None:
        current_elo = (
            qs.exclude(my_elo=None).order_by("-played_at", "-created_at").values_list("my_elo", flat=True).first()
        )

    return JsonResponse(
        {
            "total": qs.count(),
            "wins": wins,
            "losses": losses,
            "favourite_civ": fav["my_civ"] if fav and fav["my_civ"] else None,
            "current_elo": current_elo,
            "current_rank": current_rank,
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

    # Parse played_at from the rec filename, e.g.
    # "MP Replay v1.8 @2024.03.15 183042 (1).aoe2record"
    # Timestamp is local time; convert to UTC using AOE2_TZ_OFFSET_HOURS.
    played_at = None
    fname = f.name or ""
    m = _REC_FILENAME_RE.search(fname)
    if m:
        year, month, day, hour, minute, second = (int(x) for x in m.groups())
        tz_offset_hours = getattr(dj_settings, "AOE2_TZ_OFFSET_HOURS", 7)
        local_dt = datetime(year, month, day, hour, minute, second)
        played_at = local_dt.replace(tzinfo=timezone.utc) - timedelta(hours=tz_offset_hours)

    match = Aoe2Match.objects.create(file_hash=file_hash, played_at=played_at)
    match.rec_file.save(fname or f"{file_hash}.aoe2record", ContentFile(raw), save=True)
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


@csrf_exempt
@require_admin
def aoe2_clip(request, match_id):
    """Attach (or update) a highlight clip to a match.

    Body JSON: {url, title?, note?, start_seconds?}.
    Accepts YouTube watch URLs and Twitch VOD/clip URLs; stores the raw watch
    URL (not the embed form — embedding is done client-side via clipEmbedUrl()).
    """
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        match = Aoe2Match.objects.get(id=match_id)
    except Aoe2Match.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    body, err = parse_json_body(request)
    if err:
        return err
    url = (body.get("url") or "").strip()
    if not url:
        return JsonResponse({"error": "url required"}, status=400)

    match.clip_url = url
    match.clip_title = (body.get("title") or "")[:120]
    match.clip_note = (body.get("note") or "")[:300]
    raw_start = body.get("start_seconds")
    if raw_start is not None:
        try:
            match.clip_start_seconds = int(raw_start)
        except (TypeError, ValueError):
            pass
    match.save(update_fields=["clip_url", "clip_title", "clip_note", "clip_start_seconds"])
    return JsonResponse(
        {
            "ok": True,
            "clip_url": match.clip_url,
            "clip_title": match.clip_title,
            "clip_note": match.clip_note,
            "clip_start_seconds": match.clip_start_seconds,
        }
    )


@csrf_exempt
@require_admin
def aoe2_feature(request, match_id):
    """Toggle the featured flag on a match.

    Only one match can be featured at a time.  POSTing to an already-featured
    match un-features it (toggle).  Clearing other featured rows is atomic via a
    single UPDATE.
    """
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        match = Aoe2Match.objects.get(id=match_id)
    except Aoe2Match.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    new_state = not match.featured
    if new_state:
        # Clear any other featured rows first (only one at a time).
        Aoe2Match.objects.exclude(id=match_id).filter(featured=True).update(featured=False)
    match.featured = new_state
    match.save(update_fields=["featured"])
    return JsonResponse({"ok": True, "featured": match.featured})
