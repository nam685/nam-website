import json
import logging
import random
import re
import time
from datetime import timedelta as td

from django.core.cache import cache as redis_cache
from django.db.models import Count, Max
from django.db.models.functions import TruncDate
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from ..auth import require_admin
from ..models import ListenTrack

logger = logging.getLogger(__name__)

BROWSER_JSON_PATH = "browser.json"
VIEW_COUNT_RE = re.compile(r"^\d+\.?\d*\s*[MKBmkb]?\s*views?$", re.IGNORECASE)

# Rate limit: 1 sync per 5 minutes
_last_sync: float = 0
SYNC_COOLDOWN = 300


def listen_list(request):
    """Return recently played tracks (paginated, public)."""
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
def listen_sync(request):
    """Sync YouTube Music history using browser auth credentials."""
    global _last_sync

    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    # Rate limit
    now = time.time()
    if now - _last_sync < SYNC_COOLDOWN:
        remaining = int(SYNC_COOLDOWN - (now - _last_sync))
        return JsonResponse({"error": f"Rate limited. Try again in {remaining}s"}, status=429)

    # Fetch history using browser auth file
    try:
        import os

        from ytmusicapi import YTMusic
        from ytmusicapi.helpers import get_authorization, sapisid_from_cookie

        auth_path = os.environ.get("YTMUSIC_BROWSER_JSON", BROWSER_JSON_PATH)
        if not os.path.isfile(auth_path):
            return JsonResponse({"error": "Browser auth not configured. Run: ytmusicapi browser"}, status=500)

        # ytmusicapi v1.11.5 requires an authorization header with SAPISIDHASH
        # to detect browser auth, but `ytmusicapi browser` doesn't generate it.
        # Compute it from the __Secure-3PAPISID cookie before passing to YTMusic.
        with open(auth_path) as f:
            headers = json.load(f)
        if "authorization" not in headers and "cookie" in headers:
            sapisid = sapisid_from_cookie(headers["cookie"])
            origin = headers.get("origin", "https://music.youtube.com")
            headers["authorization"] = get_authorization(sapisid + " " + origin)
        yt = YTMusic(headers)
        history = yt.get_history()
    except Exception:
        logger.exception("Failed to fetch YouTube Music history")
        return JsonResponse({"error": "Failed to fetch YTM history"}, status=502)

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
        artist_names = [
            a.get("name", "") for a in artists if a.get("name") and not VIEW_COUNT_RE.match(a.get("name", ""))
        ]
        artist_name = ", ".join(artist_names) if artist_names else "Unknown"

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
        redis_cache.delete("listen_stats")
        redis_cache.delete("listen_total_count")

    _last_sync = now

    return JsonResponse({"synced": len(new_tracks)})


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


@require_GET
def listen_recommended(_request):
    """Return a single recommended track using rediscovery algorithm."""
    cached = redis_cache.get("listen_recommended")
    if cached:
        return JsonResponse(cached)

    total_tracks = ListenTrack.objects.values("video_id").annotate(play_count=Count("id")).count()
    if total_tracks == 0:
        result = {"track": None}
        redis_cache.set("listen_recommended", result, 3600)
        return JsonResponse(result)

    # Find tracks in top 25% by play count not played in last 14 days
    cutoff = timezone.now() - timezone.timedelta(days=14)

    candidates = (
        ListenTrack.objects.values("video_id", "title", "artist", "album", "thumbnail_url")
        .annotate(
            play_count=Count("id"),
            last_played=Max("played_at"),
        )
        .filter(last_played__lt=cutoff)
        .order_by("-play_count")
    )

    # Determine top-25% threshold
    all_play_counts = list(
        ListenTrack.objects.values("video_id")
        .annotate(play_count=Count("id"))
        .order_by("-play_count")
        .values_list("play_count", flat=True)
    )
    if all_play_counts:
        threshold_idx = max(0, len(all_play_counts) // 4 - 1)
        threshold = all_play_counts[threshold_idx]
        candidates = candidates.filter(play_count__gte=threshold)

    candidates = list(candidates[:50])

    if candidates:
        # Weighted random: play_count * days_since_last_play
        now = timezone.now()
        weights = []
        for c in candidates:
            days_since = (now - c["last_played"]).days
            weights.append(c["play_count"] * max(days_since, 1))
        pick = random.choices(candidates, weights=weights, k=1)[0]
    else:
        # Fallback: most played track overall
        pick = (
            ListenTrack.objects.values("video_id", "title", "artist", "album", "thumbnail_url")
            .annotate(play_count=Count("id"), last_played=Max("played_at"))
            .order_by("-play_count")
            .first()
        )

    if pick:
        track = {
            "video_id": pick["video_id"],
            "title": pick["title"],
            "artist": pick["artist"],
            "album": pick["album"],
            "thumbnail_url": pick["thumbnail_url"],
            "play_count": pick["play_count"],
            "last_played": pick["last_played"].isoformat() if pick["last_played"] else None,
        }
    else:
        track = None

    result = {"track": track}
    redis_cache.set("listen_recommended", result, 3600)
    return JsonResponse(result)


@require_GET
def listen_top_tracks(request):
    """Return tracks ranked by play count (public)."""
    limit = min(int(request.GET.get("limit", 50)), 200)
    offset = int(request.GET.get("offset", 0))

    tracks = (
        ListenTrack.objects.values("video_id", "title", "artist", "album", "thumbnail_url")
        .annotate(play_count=Count("id"))
        .order_by("-play_count")
    )
    total = tracks.count()
    page = list(tracks[offset : offset + limit])

    return JsonResponse({"tracks": page, "total": total})


@require_GET
def listen_top_artists(request):
    """Return artists ranked by play count (public).

    Collab tracks stored as "Artist A, Artist B" are split and each artist
    is credited independently.
    """
    limit = min(int(request.GET.get("limit", 50)), 200)
    offset = int(request.GET.get("offset", 0))

    # Fetch all tracks — personal site, at most a few thousand rows
    all_tracks = list(ListenTrack.objects.values_list("id", "video_id", "title", "artist", "thumbnail_url"))

    # Aggregate per individual artist name
    artist_play_counts: dict[str, int] = {}
    artist_video_ids: dict[str, set[str]] = {}
    artist_track_refs: dict[str, list[tuple[str, str, str]]] = {}  # name → [(video_id, title, thumbnail_url)]

    for _id, video_id, title, artist_field, thumbnail_url in all_tracks:
        names = [n.strip() for n in artist_field.split(",") if n.strip()]
        for name in names:
            artist_play_counts[name] = artist_play_counts.get(name, 0) + 1
            if name not in artist_video_ids:
                artist_video_ids[name] = set()
                artist_track_refs[name] = []
            artist_video_ids[name].add(video_id)
            artist_track_refs[name].append((video_id, title, thumbnail_url))

    # Sort by play count descending
    sorted_names = sorted(artist_play_counts.keys(), key=lambda n: -artist_play_counts[n])
    total = len(sorted_names)

    page_names = sorted_names[offset : offset + limit]

    page = []
    for name in page_names:
        # Top 3 tracks for this artist by play count (count occurrences across all refs)
        track_play_counts: dict[str, tuple[int, str, str, str]] = {}
        for video_id, title, thumbnail_url in artist_track_refs[name]:
            if video_id not in track_play_counts:
                track_play_counts[video_id] = (0, title, thumbnail_url, video_id)
            prev = track_play_counts[video_id]
            track_play_counts[video_id] = (prev[0] + 1, prev[1], prev[2], prev[3])

        top_tracks_sorted = sorted(track_play_counts.values(), key=lambda t: -t[0])[:3]

        page.append(
            {
                "name": name,
                "play_count": artist_play_counts[name],
                "track_count": len(artist_video_ids[name]),
                "top_tracks": [{"video_id": t[3], "title": t[1], "thumbnail_url": t[2]} for t in top_tracks_sorted],
            }
        )

    return JsonResponse({"artists": page, "total": total})


@require_GET
def listen_top_albums(request):
    """Return albums ranked by play count (public)."""
    limit = min(int(request.GET.get("limit", 50)), 200)
    offset = int(request.GET.get("offset", 0))

    albums = (
        ListenTrack.objects.exclude(album="")
        .values("album")
        .annotate(
            play_count=Count("id"),
            track_count=Count("video_id", distinct=True),
        )
        .filter(track_count__gte=2)
        .order_by("-play_count")
    )
    total = albums.count()
    page = list(albums[offset : offset + limit])

    for entry in page:
        # Pick the most common artist for this album (handles collab variations)
        top_artist = (
            ListenTrack.objects.filter(album=entry["album"])
            .values("artist")
            .annotate(cnt=Count("id"))
            .order_by("-cnt")
            .values_list("artist", flat=True)
            .first()
        )
        entry["artist"] = top_artist or "Unknown"
        track = (
            ListenTrack.objects.filter(album=entry["album"])
            .exclude(thumbnail_url="")
            .values_list("thumbnail_url", flat=True)
            .first()
        )
        entry["name"] = entry.pop("album")
        entry["thumbnail_url"] = track or ""

    return JsonResponse({"albums": page, "total": total})


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
