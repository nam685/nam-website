import json
import logging
import os
import time
import urllib.parse
import urllib.request

from django.core.cache import cache as redis_cache
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import timezone
from ytmusicapi import YTMusic
from ytmusicapi.auth.oauth.credentials import OAuthCredentials

from ..auth import require_admin, verify_token
from ..models import ListenTrack
from ..utils import create_oauth_nonce, verify_oauth_nonce

logger = logging.getLogger(__name__)

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
YTM_HISTORY_URL = "https://www.googleapis.com/youtube/v3"

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


def listen_auth(request):
    """Redirect to Google OAuth. Requires admin token as ?token= param."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        return JsonResponse({"error": "Google OAuth not configured"}, status=500)

    admin_token = request.GET.get("token", "")
    if not admin_token or not verify_token(admin_token):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Build the redirect URI from the request
    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    redirect_uri = f"{scheme}://{host}/api/listens/callback/"

    params = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/youtube",
            "access_type": "offline",
            "prompt": "consent",
            "state": create_oauth_nonce(),
        }
    )
    return HttpResponseRedirect(f"{GOOGLE_AUTHORIZE_URL}?{params}")


def listen_callback(request):
    """Google OAuth callback: exchange code, fetch YTM history via ytmusicapi, store, redirect."""
    global _last_sync

    code = request.GET.get("code", "")
    state = request.GET.get("state", "")
    error = request.GET.get("error", "")

    if error:
        return HttpResponseRedirect(f"/listens?error={urllib.parse.quote(error)}")

    if not code:
        return JsonResponse({"error": "Missing code"}, status=400)

    # Verify OAuth nonce (one-time use, not the admin token)
    if not verify_oauth_nonce(state):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Rate limit
    now = time.time()
    if now - _last_sync < SYNC_COOLDOWN:
        remaining = int(SYNC_COOLDOWN - (now - _last_sync))
        return HttpResponseRedirect(f"/listens?error={urllib.parse.quote(f'Rate limited. Try again in {remaining}s')}")

    # Exchange code for access token
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")

    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    redirect_uri = f"{scheme}://{host}/api/listens/callback/"

    token_data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
    ).encode()

    token_req = urllib.request.Request(
        GOOGLE_TOKEN_URL,
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urllib.request.urlopen(token_req, timeout=10) as resp:
            token_resp = json.loads(resp.read())
    except Exception:
        logger.exception("Failed to exchange Google OAuth code")
        return HttpResponseRedirect(f"/listens?error={urllib.parse.quote('Failed to exchange OAuth code')}")

    access_token = token_resp.get("access_token")
    if not access_token:
        return HttpResponseRedirect(f"/listens?error={urllib.parse.quote('No access token received')}")

    # Use ytmusicapi with the short-lived access token to fetch history
    try:
        import time as _time

        oauth_creds = OAuthCredentials(client_id=client_id, client_secret=client_secret)
        token_dict = {
            "access_token": access_token,
            "refresh_token": "unused",
            "scope": "https://www.googleapis.com/auth/youtube",
            "token_type": "Bearer",
            "expires_at": int(_time.time()) + token_resp.get("expires_in", 3600),
            "expires_in": token_resp.get("expires_in", 3600),
        }
        yt = YTMusic(auth=token_dict, oauth_credentials=oauth_creds)
        history = yt.get_history()
    except Exception:
        logger.exception("Failed to fetch YouTube Music history")
        return HttpResponseRedirect(f"/listens?error={urllib.parse.quote('Failed to fetch YTM history')}")

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

    # Token is discarded — never stored
    return HttpResponseRedirect("/listens")


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

    return JsonResponse(
        {
            "available": available,
            "cooldown_remaining": remaining,
            "last_updated": last_updated,
        }
    )
