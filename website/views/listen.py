import logging
import os
import time

from django.core.cache import cache as redis_cache
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin
from ..models import ListenTrack

logger = logging.getLogger(__name__)

OAUTH_JSON_PATH = os.environ.get("YTM_OAUTH_JSON", os.path.join(os.path.dirname(__file__), "..", "..", "oauth.json"))

# Rate limit: 1 sync per 5 minutes
_last_sync: float = 0
SYNC_COOLDOWN = 300


@require_admin
def listen_list(request):
    """Return recently played tracks (paginated)."""
    try:
        limit = min(max(int(request.GET.get("limit", "50")), 1), 200)
        offset = max(int(request.GET.get("offset", "0")), 0)
    except (ValueError, TypeError):
        return JsonResponse({"error": "Invalid pagination parameters"}, status=400)

    tracks = ListenTrack.objects.all()[offset : offset + limit]
    data = [
        {
            "id": t.id,
            "video_id": t.video_id,
            "title": t.title,
            "artist": t.artist,
            "album": t.album,
            "thumbnail_url": t.thumbnail_url,
            "duration": t.duration,
            "played_at": t.played_at.isoformat(),
        }
        for t in tracks
    ]
    total = redis_cache.get_or_set("listen_total_count", ListenTrack.objects.count, 300)
    return JsonResponse({"tracks": data, "total": total})


@csrf_exempt
@require_admin
def listen_sync(_request):
    """Sync YouTube Music history using file-based ytmusicapi OAuth."""
    global _last_sync

    if not os.path.exists(OAUTH_JSON_PATH):
        return JsonResponse({"error": "ytmusicapi not configured. Run: uv run ytmusicapi oauth"}, status=500)

    now = time.time()
    if now - _last_sync < SYNC_COOLDOWN:
        remaining = int(SYNC_COOLDOWN - (now - _last_sync))
        return JsonResponse({"error": f"Rate limited. Try again in {remaining}s"}, status=429)

    try:
        from ytmusicapi import YTMusic

        yt = YTMusic(OAUTH_JSON_PATH)
        history = yt.get_history()
    except Exception:
        logger.exception("Failed to fetch YouTube Music history")
        return JsonResponse({"error": "Failed to fetch YTM history"}, status=500)

    # Deduplicate against last 24h
    cutoff = timezone.now() - timezone.timedelta(hours=24)
    recent_ids = set(ListenTrack.objects.filter(played_at__gte=cutoff).values_list("video_id", flat=True))

    new_tracks = []
    sync_time = timezone.now()
    for i, item in enumerate(history):
        video_id = item.get("videoId", "")
        if not video_id or video_id in recent_ids:
            continue

        artists = item.get("artists", [])
        artist_name = ", ".join(a.get("name", "") for a in artists) if artists else "Unknown"

        album_info = item.get("album")
        album_name = album_info.get("name", "") if album_info else ""

        thumbnails = item.get("thumbnails", [])
        thumb_url = thumbnails[-1].get("url", "") if thumbnails else ""

        duration = item.get("duration", "")

        played_at = sync_time - timezone.timedelta(seconds=i)

        new_tracks.append(
            ListenTrack(
                video_id=video_id,
                title=item.get("title", "Unknown"),
                artist=artist_name,
                album=album_name,
                thumbnail_url=thumb_url,
                duration=duration,
                played_at=played_at,
            )
        )

    if new_tracks:
        ListenTrack.objects.bulk_create(new_tracks)

    _last_sync = now

    return JsonResponse({"ok": True, "new_tracks": len(new_tracks), "total_history": len(history)})


@require_admin
def listen_stats(_request):
    """Return listening statistics (cached for 5 minutes)."""
    cached = redis_cache.get("listen_stats")
    if cached:
        return JsonResponse(cached)

    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timezone.timedelta(days=now.weekday())
    month_start = today_start.replace(day=1)

    today_count = ListenTrack.objects.filter(played_at__gte=today_start).count()
    week_count = ListenTrack.objects.filter(played_at__gte=week_start).count()
    total_count = ListenTrack.objects.count()

    top_tracks = (
        ListenTrack.objects.filter(played_at__gte=month_start)
        .values("video_id", "title", "artist", "thumbnail_url")
        .annotate(play_count=Count("id"))
        .order_by("-play_count")[:10]
    )

    daily = (
        ListenTrack.objects.filter(played_at__gte=now - timezone.timedelta(days=30))
        .annotate(date=TruncDate("played_at"))
        .values("date")
        .annotate(count=Count("id"))
        .order_by("date")
    )

    result = {
        "today": today_count,
        "week": week_count,
        "total": total_count,
        "top_tracks": list(top_tracks),
        "daily": [{"date": d["date"].isoformat(), "count": d["count"]} for d in daily],
    }
    redis_cache.set("listen_stats", result, 300)
    return JsonResponse(result)


@require_admin
def listen_sync_status(_request):
    """Check sync availability and last update time."""
    global _last_sync
    now = time.time()
    elapsed = now - _last_sync
    available = elapsed >= SYNC_COOLDOWN
    remaining = max(0, int(SYNC_COOLDOWN - elapsed)) if not available else 0

    last_track = ListenTrack.objects.first()
    last_updated = last_track.played_at.isoformat() if last_track else None
    configured = os.path.exists(OAUTH_JSON_PATH)

    return JsonResponse(
        {
            "available": available,
            "cooldown_remaining": remaining,
            "last_updated": last_updated,
            "configured": configured,
        }
    )
