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

# Hop-by-hop / request-specific headers that must not be forwarded when we probe YTM ourselves.
_PROBE_SKIP_HEADERS = {"content-length", "host", "connection", "te", "accept-encoding"}
# The browse response embeds {"key": "logged_in", "value": "0|1"} in its serviceTrackingParams.
_LOGGED_IN_RE = re.compile(r'logged_in"[^}]*?"value":\s*"(\d)"', re.DOTALL)


class YTMAuthError(RuntimeError):
    """Raised when YouTube Music credentials are missing or the session is logged out.

    Distinct from generic errors so callers can surface a clear "re-authenticate" message
    instead of an opaque 502 — the cookie silently expiring is the #1 cause of sync no-ops.
    """


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


def _is_logged_in(headers):
    """Probe YTM to confirm `headers` is an *authenticated* session, not just structurally valid.

    `YTMusic(headers)` construction never hits the network, so a logged-out cookie passes it
    silently — then every sync returns zero. We hit the history browse endpoint and read the
    `logged_in` flag YouTube echoes back. Returns False on any error (treat as not-logged-in).
    """
    import requests
    from ytmusicapi.helpers import get_authorization, sapisid_from_cookie

    cookie = (headers or {}).get("cookie", "")
    if not cookie:
        return False
    try:
        origin = headers.get("origin", "https://music.youtube.com")
        probe_headers = {k: v for k, v in headers.items() if k.lower() not in _PROBE_SKIP_HEADERS}
        probe_headers["authorization"] = get_authorization(sapisid_from_cookie(cookie) + " " + origin)
        body = {
            "browseId": "FEmusic_history",
            "context": {"client": {"clientName": "WEB_REMIX", "clientVersion": "1.20240101.00.00", "hl": "en"}},
        }
        resp = requests.post(
            "https://music.youtube.com/youtubei/v1/browse",
            params={"alt": "json"},
            json=body,
            headers=probe_headers,
            timeout=20,
        )
        match = _LOGGED_IN_RE.search(resp.text)
        return bool(match) and match.group(1) == "1"
    except Exception:
        logger.warning("YTM login probe failed", exc_info=True)
        return False


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


# Home-feed rows that surface YOUR frequently/previously played tracks (not recommendations).
# Matched case-insensitively against the localized row title.
_FREQUENT_HOME_ROW_KEYWORDS = ("listen again", "favourite", "favorite", "forgotten", "your top")


def _fetch_frequent_from_home(yt):
    """Parse song items from the personalized 'listen again / favourites' home rows.

    These are history-derived (things you actually play often), so they respect the
    "my universe" rule — unlike recommendation rows (Quick Picks / Mixed for you),
    which are skipped.
    """
    try:
        home = yt.get_home(limit=8)
    except Exception:
        logger.warning("Failed to fetch home feed — skipping frequent listens")
        return []

    if not isinstance(home, list):
        return []

    parsed_tracks = []
    for row in home:
        title = (row.get("title") or "").lower()
        if not any(keyword in title for keyword in _FREQUENT_HOME_ROW_KEYWORDS):
            continue
        for item in row.get("contents", []):
            if item.get("videoId"):
                parsed = _parse_track_item(item)
                if parsed:
                    parsed_tracks.append(parsed)
    return parsed_tracks


def _rebuild_graph(progress=None):
    """Rebuild the listening graph from current data. Non-fatal — never raises.

    Slow: it fetches Last.fm similarities for every artist/track (minutes). Callers on the
    request path must run this off-thread (see `rebuild_listen_graph` Celery task) so they
    don't blow gunicorn's request timeout.
    """
    try:
        from django.conf import settings

        from ..services import music_graph

        music_graph.build_graph(api_key=settings.LASTFM_API_KEY, ytm_headers=_load_browser_headers(), progress=progress)
    except Exception:
        logger.exception("Graph rebuild failed")


def _do_sync(progress=None, rebuild_graph=True):
    """Core sync logic shared by the view and Celery task.

    `progress` is an optional callable(str) for live status output (e.g. a CLI writer).
    `rebuild_graph` rebuilds the graph inline when True; the web view passes False and
    dispatches the rebuild to Celery instead (the Last.fm pass exceeds the request timeout).
    Returns {"synced_history": int, "synced_liked": int, "synced_frequent": int} or raises on auth failure.
    """

    def report(msg):
        if progress:
            progress(msg)

    yt, err = _init_ytmusic()
    if err:
        raise RuntimeError(err)

    # Verify the session is actually logged in before doing any work. A stale/expired cookie
    # still constructs a valid YTMusic client but returns a logged-out (empty/non-JSON) history,
    # which otherwise surfaces as an opaque 502 and silently syncs nothing.
    if not _is_logged_in(_load_browser_headers()):
        raise YTMAuthError("YouTube Music session is logged out — re-authenticate on /listens.")

    # --- Sync play history ---
    report("Fetching YouTube Music play history…")
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
                from_sync=True,
            )
        )

    if new_tracks:
        ListenTrack.objects.bulk_create(new_tracks)

    # --- Sync liked tracks ---
    report("Fetching liked songs…")
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
                from_sync=True,
            )
        )

    if new_liked:
        ListenTrack.objects.bulk_create(new_liked)

    # --- Frequently-listened tracks (from the personalized home feed) ---
    report("Fetching frequently-listened songs…")
    existing_ids = set(ListenTrack.objects.values_list("video_id", flat=True))
    new_frequent = []
    for parsed in _fetch_frequent_from_home(yt):
        if parsed["video_id"] in existing_ids:
            continue
        existing_ids.add(parsed["video_id"])  # dedup within this batch too
        new_frequent.append(ListenTrack(**parsed, played_at=timezone.now(), from_sync=True))

    if new_frequent:
        ListenTrack.objects.bulk_create(new_frequent)

    if new_tracks or new_liked or new_frequent:
        redis_cache.delete("listen_stats")
        redis_cache.delete("listen_total_count")

    report(f"Synced {len(new_tracks)} plays + {len(new_liked)} liked + {len(new_frequent)} frequent")

    if rebuild_graph:
        report("Rebuilding graph…")
        _rebuild_graph(progress=progress)

    return {
        "synced_history": len(new_tracks),
        "synced_liked": len(new_liked),
        "synced_frequent": len(new_frequent),
    }


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
        # Sync the tracks synchronously (fast), but defer the graph rebuild — its Last.fm pass
        # takes minutes and would otherwise blow gunicorn's request timeout (a real success then
        # reported to the user as a 502).
        result = _do_sync(rebuild_graph=False)
    except YTMAuthError as e:
        # 409 (not 401) — the admin token is fine; it's the YTM cookie that's stale. A 401 would
        # trip the frontend's admin-token-expiry path and bounce the user to /sudo. `auth_expired`
        # lets the listens page show a "re-authenticate YTM" prompt instead.
        return JsonResponse({"error": str(e), "auth_expired": True}, status=409)
    except RuntimeError as e:
        return JsonResponse({"error": str(e)}, status=500)
    except Exception:
        logger.exception("Failed to sync YouTube Music")
        return JsonResponse({"error": "Failed to fetch YTM history"}, status=502)

    redis_cache.set(_SYNC_KEY, now, SYNC_COOLDOWN + 60)

    # Rebuild the graph off the request path. Falls back to inline if the broker is unreachable,
    # so a Celery outage degrades to the old (slow) behaviour rather than skipping the rebuild.
    graph_rebuilding = True
    try:
        from ..tasks import rebuild_listen_graph

        rebuild_listen_graph.delay()
    except Exception:
        logger.exception("Could not queue graph rebuild; running inline")
        _rebuild_graph()
        graph_rebuilding = False

    return JsonResponse(
        {
            "synced": result["synced_history"],
            "synced_liked": result["synced_liked"],
            "synced_frequent": result["synced_frequent"],
            "graph_rebuilding": graph_rebuilding,
        }
    )


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

    # Validate that the headers parse into a usable YTMusic client (catches malformed cookies).
    try:
        from ytmusicapi import YTMusic

        YTMusic(dict(parsed))
    except Exception as e:
        return JsonResponse({"error": f"Headers invalid — YTMusic init failed: {e}"}, status=400)

    # Crucially, verify the session is actually *logged in*. YTMusic() construction never hits
    # the network, so a logged-out cookie passes validation and then silently syncs nothing —
    # exactly the failure mode this guards against. Probe before persisting.
    if not _is_logged_in(parsed):
        return JsonResponse(
            {
                "error": "Those headers are not a logged-in session. Copy them from a tab where you're signed into YouTube Music."
            },
            status=400,
        )

    # Never persist a computed `authorization` (SAPISIDHASH): it embeds a timestamp and expires
    # within hours, so a stored value goes stale and later syncs fail. `_load_browser_headers`
    # recomputes a fresh hash on each use (matching what `ytmusicapi browser` writes).
    parsed.pop("authorization", None)

    auth_path = _get_auth_path()
    with open(auth_path, "w") as f:
        json.dump(parsed, f, indent=2)

    return JsonResponse({"ok": True})
