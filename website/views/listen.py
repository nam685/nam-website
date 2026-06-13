import json
import logging
import os
import re
import time
from datetime import timedelta as td

from django.core.cache import cache as redis_cache
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin
from ..models import ListenTrack
from ..utils import parse_json_body, parse_pagination

logger = logging.getLogger(__name__)

BROWSER_JSON_PATH = "browser.json"
VIEW_COUNT_RE = re.compile(r"^\d+\.?\d*\s*[MKBmkb]?\s*views?$", re.IGNORECASE)

# Rate limit: 1 sync per 5 minutes
SYNC_COOLDOWN = 300
_SYNC_KEY = "listens_last_sync_ts"


def listen_list(request):
    """Return recently played tracks (paginated, public)."""
    try:
        limit, offset = parse_pagination(request)
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


def _get_auth_path():
    return os.environ.get("YTMUSIC_BROWSER_JSON", BROWSER_JSON_PATH)


def _load_browser_headers():
    """Load + authorize the YTM browser.json headers dict, or None if not configured."""
    from ytmusicapi.helpers import get_authorization, sapisid_from_cookie

    auth_path = _get_auth_path()
    if not os.path.isfile(auth_path):
        return None

    with open(auth_path) as f:
        headers = json.load(f)
    if "authorization" not in headers and "cookie" in headers:
        sapisid = sapisid_from_cookie(headers["cookie"])
        origin = headers.get("origin", "https://music.youtube.com")
        headers["authorization"] = get_authorization(sapisid + " " + origin)
    return headers


def _init_ytmusic():
    """Initialize YTMusic client from browser.json. Returns (YTMusic, None) or (None, error_str)."""
    from ytmusicapi import YTMusic

    headers = _load_browser_headers()
    if headers is None:
        return None, "Browser auth not configured. Run: ytmusicapi browser"
    return YTMusic(headers), None


def _parse_track_item(item):
    """Extract track fields from a ytmusicapi item dict."""
    video_id = item.get("videoId", "")
    if not video_id:
        return None

    artists = item.get("artists", [])
    artist_names = [a.get("name", "") for a in artists if a.get("name") and not VIEW_COUNT_RE.match(a.get("name", ""))]
    artist_name = ", ".join(artist_names) if artist_names else "Unknown"

    album_info = item.get("album")
    album_name = album_info.get("name", "") if album_info else ""

    thumbnails = item.get("thumbnails", [])
    thumb_url = thumbnails[-1].get("url", "") if thumbnails else ""

    return {
        "video_id": video_id,
        "title": item.get("title", "Unknown"),
        "artist": artist_name,
        "album": album_name,
        "thumbnail_url": thumb_url,
        "duration": item.get("duration", ""),
    }


def _do_sync():
    """Core sync logic shared by the view and Celery task.

    Returns {"synced_history": int, "synced_liked": int} or raises on auth failure.
    """
    yt, err = _init_ytmusic()
    if err:
        raise RuntimeError(err)

    # --- Sync play history ---
    history = yt.get_history()

    cutoff = timezone.now() - timezone.timedelta(hours=24)
    recent_ids = set(ListenTrack.objects.filter(played_at__gte=cutoff).values_list("video_id", flat=True))

    new_tracks = []
    sync_time = timezone.now()
    for i, item in enumerate(history):
        parsed = _parse_track_item(item)
        if not parsed or parsed["video_id"] in recent_ids:
            continue

        new_tracks.append(
            ListenTrack(
                **parsed,
                played_at=sync_time - timezone.timedelta(seconds=i),
            )
        )

    if new_tracks:
        ListenTrack.objects.bulk_create(new_tracks)

    # --- Sync liked tracks ---
    try:
        liked = yt.get_liked_songs(limit=200)
        liked_items = liked.get("tracks", [])
    except Exception:
        logger.warning("Failed to fetch liked songs — skipping")
        liked_items = []

    existing_liked_ids = set(ListenTrack.objects.filter(is_liked=True).values_list("video_id", flat=True))

    new_liked = []
    for item in liked_items:
        parsed = _parse_track_item(item)
        if not parsed or parsed["video_id"] in existing_liked_ids:
            continue

        new_liked.append(
            ListenTrack(
                **parsed,
                played_at=timezone.now(),
                is_liked=True,
            )
        )

    if new_liked:
        ListenTrack.objects.bulk_create(new_liked)

    if new_tracks or new_liked:
        redis_cache.delete("listen_stats")
        redis_cache.delete("listen_total_count")

    # Rebuild the listening graph from the freshly-synced data. Non-fatal: a graph
    # failure must not break the sync. Runs for both the view and the Celery task.
    try:
        from django.conf import settings

        from ..services import music_graph

        music_graph.build_graph(api_key=settings.LASTFM_API_KEY, ytm_headers=_load_browser_headers())
    except Exception:
        logger.exception("Graph rebuild after sync failed")

    return {"synced_history": len(new_tracks), "synced_liked": len(new_liked)}


@csrf_exempt
@require_admin
def listen_sync(request):
    """Sync YouTube Music history + liked tracks using browser auth credentials."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    # Rate limit (Redis-based, works across workers)
    last_sync = redis_cache.get(_SYNC_KEY) or 0
    now = time.time()
    if now - last_sync < SYNC_COOLDOWN:
        remaining = int(SYNC_COOLDOWN - (now - last_sync))
        return JsonResponse({"error": f"Rate limited. Try again in {remaining}s"}, status=429)

    try:
        result = _do_sync()
    except RuntimeError as e:
        return JsonResponse({"error": str(e)}, status=500)
    except Exception:
        logger.exception("Failed to sync YouTube Music")
        return JsonResponse({"error": "Failed to fetch YTM history"}, status=502)

    redis_cache.set(_SYNC_KEY, now, SYNC_COOLDOWN + 60)

    return JsonResponse({"synced": result["synced_history"], "synced_liked": result["synced_liked"]})


def listen_stats(_request):
    """Return listening statistics (cached for 5 minutes, public)."""
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
        .order_by("-play_count")[:12]
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
    last_sync = redis_cache.get(_SYNC_KEY) or 0
    now = time.time()
    elapsed = now - last_sync
    available = elapsed >= SYNC_COOLDOWN
    remaining = max(0, int(SYNC_COOLDOWN - elapsed)) if not available else 0

    last_track = ListenTrack.objects.first()
    last_updated = last_track.played_at.isoformat() if last_track else None

    return JsonResponse(
        {
            "available": available,
            "cooldown_remaining": remaining,
            "last_updated": last_updated,
        }
    )


@csrf_exempt
@require_admin
def listen_import(request):
    """Import listening history from Google Takeout watch-history.json."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"error": "No file uploaded. Send as multipart with field name 'file'."}, status=400)

    if uploaded.size and uploaded.size > 50 * 1024 * 1024:
        return JsonResponse({"error": "File too large (max 50 MB)"}, status=400)

    try:
        raw = json.loads(uploaded.read().decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON file"}, status=400)

    if not isinstance(raw, list):
        return JsonResponse({"error": "Expected a JSON array"}, status=400)

    # Filter to YouTube Music entries — the "header" field (not "products") distinguishes YTM from YouTube
    entries = [e for e in raw if e.get("header") == "YouTube Music"]

    imported = 0
    skipped = 0
    batch = []

    for entry in entries:
        title_url = entry.get("titleUrl", "")
        if "watch?v=" not in title_url:
            skipped += 1
            continue

        video_id = title_url.split("watch?v=")[-1].split("&")[0]
        title = entry.get("title", "")
        if title.startswith("Watched "):
            title = title[8:]

        subtitles = entry.get("subtitles") or []
        artist = subtitles[0].get("name", "Unknown") if subtitles else "Unknown"

        time_str = entry.get("time", "")
        played_at = parse_datetime(time_str)
        if not played_at or not video_id:
            skipped += 1
            continue

        # Dedup: check if (video_id, played_at) exists within 60s tolerance
        exists = ListenTrack.objects.filter(
            video_id=video_id,
            played_at__gte=played_at - td(seconds=60),
            played_at__lte=played_at + td(seconds=60),
        ).exists()

        if exists:
            skipped += 1
            continue

        batch.append(
            ListenTrack(
                video_id=video_id,
                title=title,
                artist=artist,
                album="",
                thumbnail_url="",
                duration="",
                played_at=played_at,
            )
        )

        if len(batch) >= 500:
            ListenTrack.objects.bulk_create(batch)
            imported += len(batch)
            batch = []

    if batch:
        ListenTrack.objects.bulk_create(batch)
        imported += len(batch)

    return JsonResponse({"imported": imported, "skipped": skipped})


@csrf_exempt
@require_admin
def listen_reauth(request):
    """Save new browser auth headers for ytmusicapi.

    Accepts JSON body {"headers": "<raw request headers text>"}.
    Parses "Header-Name: value" lines into the JSON dict that ytmusicapi expects.
    """
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    body, err = parse_json_body(request)
    if err:
        return err

    raw_headers = body.get("headers", "").strip()
    if not raw_headers:
        return JsonResponse({"error": "Missing 'headers' field"}, status=400)

    # Parse "Key: Value" lines into a dict
    parsed = {}
    for line in raw_headers.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        # Skip pseudo-headers from HTTP/2 (like :authority, :method)
        if line.startswith(":"):
            continue
        key, _, value = line.partition(":")
        parsed[key.strip().lower()] = value.strip()

    if "cookie" not in parsed:
        return JsonResponse({"error": "No 'cookie' header found in pasted headers"}, status=400)

    # Ensure required fields
    if "origin" not in parsed:
        parsed["origin"] = "https://music.youtube.com"
    if "user-agent" not in parsed:
        parsed["user-agent"] = "Mozilla/5.0"

    # Validate by trying to init YTMusic
    try:
        from ytmusicapi import YTMusic
        from ytmusicapi.helpers import get_authorization, sapisid_from_cookie

        if "authorization" not in parsed and "cookie" in parsed:
            sapisid = sapisid_from_cookie(parsed["cookie"])
            origin = parsed.get("origin", "https://music.youtube.com")
            parsed["authorization"] = get_authorization(sapisid + " " + origin)

        YTMusic(parsed)
    except Exception as e:
        return JsonResponse({"error": f"Headers invalid — YTMusic init failed: {e}"}, status=400)

    # Write to browser.json
    auth_path = _get_auth_path()
    with open(auth_path, "w") as f:
        json.dump(parsed, f, indent=2)

    return JsonResponse({"ok": True})
