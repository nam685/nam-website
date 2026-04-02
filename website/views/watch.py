import json
import logging
import os
import time
import urllib.parse
import urllib.request

from django.core.cache import cache as redis_cache
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin, verify_token
from ..models import WatchChannel, WatchVideo
from ..utils import create_oauth_nonce, parse_json_body, verify_oauth_nonce

logger = logging.getLogger(__name__)

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"

_last_sync: float = 0
SYNC_COOLDOWN = 300


def watch_list(request):
    """Public: return visible channels with their pinned videos, sorted by tier weight."""
    try:
        limit = min(max(int(request.GET.get("limit", "30")), 1), 100)
        offset = max(int(request.GET.get("offset", "0")), 0)
    except (ValueError, TypeError):
        return JsonResponse({"error": "Invalid pagination parameters"}, status=400)

    # Filter out hidden channels, sort by tier weight then display_order then name
    visible_tiers = [t for t, _ in WatchChannel.Tier.choices if t != "hidden"]
    qs = WatchChannel.objects.filter(tier__in=visible_tiers)
    total = qs.count()

    # Sort by TIER_WEIGHT mapping, then display_order, then name
    channels = sorted(qs, key=lambda c: (WatchChannel.TIER_WEIGHT.get(c.tier, 99), c.display_order, c.name))
    channels = channels[offset : offset + limit]

    def serialize_channel(ch):
        pinned_videos = WatchVideo.objects.filter(channel=ch, pinned=True, visible=True)
        return {
            "id": ch.id,
            "youtube_channel_id": ch.youtube_channel_id,
            "name": ch.name,
            "description": ch.description,
            "thumbnail_url": ch.thumbnail_url,
            "tier": ch.tier,
            "display_order": ch.display_order,
            "videos": [
                {
                    "id": v.id,
                    "youtube_video_id": v.youtube_video_id,
                    "title": v.title,
                    "thumbnail_url": v.thumbnail_url,
                    "note": v.note,
                }
                for v in pinned_videos
            ],
        }

    return JsonResponse(
        {
            "channels": [serialize_channel(ch) for ch in channels],
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    )


@require_admin
def watch_staging(_request):
    """Admin: return hidden channels and non-visible videos."""
    hidden_channels = WatchChannel.objects.filter(tier="hidden").order_by("name")
    non_visible_videos = WatchVideo.objects.filter(visible=False).order_by("-created_at")

    return JsonResponse(
        {
            "channels": [
                {
                    "id": ch.id,
                    "youtube_channel_id": ch.youtube_channel_id,
                    "name": ch.name,
                    "description": ch.description,
                    "thumbnail_url": ch.thumbnail_url,
                    "tier": ch.tier,
                    "display_order": ch.display_order,
                }
                for ch in hidden_channels
            ],
            "videos": [
                {
                    "id": v.id,
                    "youtube_video_id": v.youtube_video_id,
                    "title": v.title,
                    "thumbnail_url": v.thumbnail_url,
                    "note": v.note,
                    "pinned": v.pinned,
                    "visible": v.visible,
                    "channel_id": v.channel_id,
                }
                for v in non_visible_videos
            ],
        }
    )


@csrf_exempt
@require_admin
def watch_channel_tier(request, channel_id):
    """Admin: set tier for a channel."""
    try:
        channel = WatchChannel.objects.get(pk=channel_id)
    except WatchChannel.DoesNotExist:
        return JsonResponse({"error": "Channel not found"}, status=404)

    body, err = parse_json_body(request)
    if err:
        return err

    tier = body.get("tier")
    valid_tiers = [t for t, _ in WatchChannel.Tier.choices]
    if tier not in valid_tiers:
        return JsonResponse({"error": f"Invalid tier. Must be one of: {valid_tiers}"}, status=400)

    channel.tier = tier
    channel.save(update_fields=["tier"])
    return JsonResponse({"ok": True, "tier": tier})


@csrf_exempt
@require_admin
def watch_channel_order(request, channel_id):
    """Admin: set display_order for a channel."""
    try:
        channel = WatchChannel.objects.get(pk=channel_id)
    except WatchChannel.DoesNotExist:
        return JsonResponse({"error": "Channel not found"}, status=404)

    body, err = parse_json_body(request)
    if err:
        return err

    try:
        display_order = int(body.get("display_order", 0))
    except (ValueError, TypeError):
        return JsonResponse({"error": "display_order must be an integer"}, status=400)

    channel.display_order = display_order
    channel.save(update_fields=["display_order"])
    return JsonResponse({"ok": True, "display_order": display_order})


@csrf_exempt
@require_admin
def watch_channel_delete(_request, channel_id):
    """Admin: hard delete a channel (videos get SET_NULL)."""
    try:
        channel = WatchChannel.objects.get(pk=channel_id)
    except WatchChannel.DoesNotExist:
        return JsonResponse({"error": "Channel not found"}, status=404)

    channel.delete()
    return JsonResponse({"ok": True})


@csrf_exempt
@require_admin
def watch_video_pin(_request, video_id):
    """Admin: toggle pinned on a video; if pinning, also set visible=True."""
    try:
        video = WatchVideo.objects.get(pk=video_id)
    except WatchVideo.DoesNotExist:
        return JsonResponse({"error": "Video not found"}, status=404)

    video.pinned = not video.pinned
    if video.pinned:
        video.visible = True
    video.save(update_fields=["pinned", "visible"])
    return JsonResponse({"ok": True, "pinned": video.pinned, "visible": video.visible})


@csrf_exempt
@require_admin
def watch_video_note(request, video_id):
    """Admin: set note on a video (capped at 200 chars)."""
    try:
        video = WatchVideo.objects.get(pk=video_id)
    except WatchVideo.DoesNotExist:
        return JsonResponse({"error": "Video not found"}, status=404)

    body, err = parse_json_body(request)
    if err:
        return err

    note = str(body.get("note", ""))[:200]
    video.note = note
    video.save(update_fields=["note"])
    return JsonResponse({"ok": True, "note": note})


@csrf_exempt
@require_admin
def watch_video_delete(_request, video_id):
    """Admin: hard delete a video."""
    try:
        video = WatchVideo.objects.get(pk=video_id)
    except WatchVideo.DoesNotExist:
        return JsonResponse({"error": "Video not found"}, status=404)

    video.delete()
    return JsonResponse({"ok": True})


# ---------------------------------------------------------------------------
# YouTube OAuth + Sync helpers
# ---------------------------------------------------------------------------


def _youtube_api_get(endpoint, access_token, params=None):
    """GET request to YouTube Data API v3, returns parsed JSON."""
    url = f"{YOUTUBE_API_BASE}/{endpoint}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def _refresh_access_token():
    """Refresh Google access token using stored refresh token from Redis. Returns access_token or None."""
    # Return cached access token if still valid
    cached = redis_cache.get("watches_google_access_token")
    if cached:
        return cached

    refresh_token = redis_cache.get("watches_google_refresh_token")
    if not refresh_token:
        return None

    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")

    token_data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode()

    req = urllib.request.Request(
        GOOGLE_TOKEN_URL,
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            token_resp = json.loads(resp.read())
    except Exception:
        logger.exception("Failed to refresh Google access token")
        return None

    access_token = token_resp.get("access_token")
    if not access_token:
        return None

    expires_in = token_resp.get("expires_in", 3600)
    redis_cache.set("watches_google_access_token", access_token, expires_in - 60)
    return access_token


def _sync_subscriptions(access_token, max_pages=10):
    """Paginate YouTube subscriptions API, update_or_create WatchChannels. Returns new count."""
    new_count = 0
    page_token = None
    total = 0

    for _ in range(max_pages):
        params = {"mine": "true", "part": "snippet", "maxResults": 50}
        if page_token:
            params["pageToken"] = page_token

        data = _youtube_api_get("subscriptions", access_token, params)
        items = data.get("items", [])

        for item in items:
            if total >= 500:
                break
            snippet = item.get("snippet", {})
            channel_id = snippet.get("resourceId", {}).get("channelId", "")
            if not channel_id:
                continue

            thumbnails = snippet.get("thumbnails", {})
            thumbnail_url = thumbnails.get("default", {}).get("url", "")

            _, created = WatchChannel.objects.update_or_create(
                youtube_channel_id=channel_id,
                defaults={
                    "name": snippet.get("title", ""),
                    "description": snippet.get("description", ""),
                    "thumbnail_url": thumbnail_url,
                },
            )
            if created:
                new_count += 1
            total += 1

        if total >= 500:
            break

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return new_count


def _sync_liked_videos(access_token, max_pages=4):
    """Paginate YouTube liked videos API, update_or_create WatchVideos. Returns new count."""
    new_count = 0
    page_token = None
    total = 0

    for _ in range(max_pages):
        params = {"myRating": "like", "part": "snippet", "maxResults": 50}
        if page_token:
            params["pageToken"] = page_token

        data = _youtube_api_get("videos", access_token, params)
        items = data.get("items", [])

        for item in items:
            if total >= 200:
                break
            video_id = item.get("id", "")
            if not video_id:
                continue

            snippet = item.get("snippet", {})
            channel_yt_id = snippet.get("channelId", "")
            thumbnails = snippet.get("thumbnails", {})
            thumbnail_url = thumbnails.get("high", thumbnails.get("default", {})).get("url", "")

            # Link to channel if it exists
            channel = None
            if channel_yt_id:
                channel = WatchChannel.objects.filter(youtube_channel_id=channel_yt_id).first()

            _, created = WatchVideo.objects.update_or_create(
                youtube_video_id=video_id,
                defaults={
                    "title": snippet.get("title", ""),
                    "thumbnail_url": thumbnail_url,
                    "channel": channel,
                    "visible": False,
                    "pinned": False,
                },
            )
            if created:
                new_count += 1
            total += 1

        if total >= 200:
            break

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return new_count


# ---------------------------------------------------------------------------
# YouTube OAuth + Sync views
# ---------------------------------------------------------------------------


def watch_auth(request):
    """Redirect to Google OAuth. Requires admin token as ?token= param."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        return JsonResponse({"error": "Google OAuth not configured"}, status=500)

    admin_token = request.GET.get("token", "")
    if not admin_token or not verify_token(admin_token):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    redirect_uri = f"{scheme}://{host}/api/watches/callback/"

    nonce = create_oauth_nonce()
    params = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/youtube.readonly",
            "access_type": "offline",
            "prompt": "consent",
            "state": nonce,
        }
    )
    return HttpResponseRedirect(f"{GOOGLE_AUTHORIZE_URL}?{params}")


def watch_callback(request):
    """Google OAuth callback: exchange code for tokens, store refresh token in Redis, redirect."""
    error = request.GET.get("error", "")
    if error:
        return HttpResponseRedirect(f"/watches?error={urllib.parse.quote(error)}")

    code = request.GET.get("code", "")
    if not code:
        return JsonResponse({"error": "Missing code"}, status=400)

    state = request.GET.get("state", "")
    if not verify_oauth_nonce(state):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")

    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    redirect_uri = f"{scheme}://{host}/api/watches/callback/"

    token_data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
    ).encode()

    req = urllib.request.Request(
        GOOGLE_TOKEN_URL,
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            token_resp = json.loads(resp.read())
    except Exception:
        logger.exception("Failed to exchange Google OAuth code for watches")
        return HttpResponseRedirect(f"/watches?error={urllib.parse.quote('Failed to exchange OAuth code')}")

    refresh_token = token_resp.get("refresh_token")
    access_token = token_resp.get("access_token")

    if not access_token:
        return HttpResponseRedirect(f"/watches?error={urllib.parse.quote('No access token received')}")

    if refresh_token:
        redis_cache.set("watches_google_refresh_token", refresh_token, None)

    expires_in = token_resp.get("expires_in", 3600)
    redis_cache.set("watches_google_access_token", access_token, expires_in - 60)

    return HttpResponseRedirect("/watches")


@csrf_exempt
@require_admin
def watch_sync(_request):
    """Trigger a YouTube subscription + liked video sync."""
    global _last_sync

    access_token = _refresh_access_token()
    if not access_token:
        return JsonResponse({"error": "YouTube not connected"}, status=400)

    now = time.time()
    if now - _last_sync < SYNC_COOLDOWN:
        remaining = int(SYNC_COOLDOWN - (now - _last_sync))
        return JsonResponse({"error": f"Rate limited. Try again in {remaining}s"}, status=429)

    try:
        new_channels = _sync_subscriptions(access_token)
        new_videos = _sync_liked_videos(access_token)
    except Exception:
        logger.exception("YouTube sync failed")
        return JsonResponse({"error": "Sync failed"}, status=500)

    _last_sync = now
    redis_cache.set("watches_last_synced", timezone.now().isoformat(), None)

    return JsonResponse({"ok": True, "new_channels": new_channels, "new_videos": new_videos})


@require_admin
def watch_sync_status(_request):
    """Check sync availability and connection status."""
    now = time.time()
    elapsed = now - _last_sync
    available = elapsed >= SYNC_COOLDOWN
    remaining = max(0, int(SYNC_COOLDOWN - elapsed)) if not available else 0
    connected = bool(redis_cache.get("watches_google_refresh_token"))
    last_synced = redis_cache.get("watches_last_synced")

    return JsonResponse(
        {
            "available": available,
            "cooldown_remaining": remaining,
            "connected": connected,
            "last_synced": last_synced,
        }
    )
