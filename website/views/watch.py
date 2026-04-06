import json
import logging
import os
import random
import re
import time
import urllib.parse
import urllib.request

from django.core.cache import cache as redis_cache
from django.db.models import Prefetch, Q
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin
from ..models import WatchChannel, WatchVideo
from ..utils import create_oauth_nonce, parse_json_body, parse_pagination, verify_admin_nonce, verify_oauth_nonce

logger = logging.getLogger(__name__)

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"

SYNC_COOLDOWN = 300
_SYNC_KEY = "watches_last_sync_ts"


def parse_iso8601_duration(duration: str) -> int:
    """Parse ISO 8601 duration (e.g. PT5M30S) to total seconds. Returns 0 on invalid input."""
    if not duration:
        return 0
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


def watch_list(request):
    """Public: return visible channels with their pinned videos, sorted by tier weight."""
    try:
        limit, offset = parse_pagination(request, default_limit=30, max_limit=100)
    except (ValueError, TypeError):
        return JsonResponse({"error": "Invalid pagination parameters"}, status=400)

    # Filter out hidden channels, prefetch pinned videos in one query
    visible_tiers = [t for t, _ in WatchChannel.Tier.choices if t != "hidden"]
    pinned_prefetch = Prefetch(
        "videos",
        queryset=WatchVideo.objects.filter(pinned=True, visible=True),
        to_attr="pinned_videos",
    )
    qs = WatchChannel.objects.filter(tier__in=visible_tiers).prefetch_related(pinned_prefetch)
    total = qs.count()

    # Sort by TIER_WEIGHT mapping, then display_order, then name
    channels = sorted(qs, key=lambda c: (WatchChannel.TIER_WEIGHT.get(c.tier, 99), c.display_order, c.name))
    channels = channels[offset : offset + limit]

    def serialize_channel(ch):
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
                    "view_count": v.view_count,
                    "like_count": v.like_count,
                    "comment_count": v.comment_count,
                    "description": v.description,
                    "duration": v.duration,
                }
                for v in ch.pinned_videos
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


def watch_recommended(request):  # noqa: ARG001
    """Public: return a uniform-random video for the hero section.

    Pool: all videos belonging to a non-hidden channel with duration > 60s.
    """
    visible_tiers = [t for t, _ in WatchChannel.Tier.choices if t != "hidden"]

    all_videos = (
        WatchVideo.objects.filter(
            channel__isnull=False,
            channel__tier__in=visible_tiers,
        )
        .exclude(duration="")
        .select_related("channel")
    )

    # Filter out Shorts (<=60s) in Python since duration is stored as ISO 8601 string
    candidates = [v for v in all_videos if parse_iso8601_duration(v.duration) > 60]

    if not candidates:
        return JsonResponse({"video": None})

    chosen = random.choice(candidates)

    return JsonResponse(
        {
            "video": {
                "id": chosen.id,
                "youtube_video_id": chosen.youtube_video_id,
                "title": chosen.title,
                "thumbnail_url": chosen.thumbnail_url,
                "view_count": chosen.view_count,
                "like_count": chosen.like_count,
                "comment_count": chosen.comment_count,
                "description": chosen.description,
                "duration": chosen.duration,
                "channel_name": chosen.channel.name,
                "channel_thumbnail_url": chosen.channel.thumbnail_url,
            }
        }
    )


@require_admin
def watch_staging(_request):
    """Admin: return all channels sorted by tier weight, with pinned counts."""
    from django.db.models import Count

    channels = WatchChannel.objects.annotate(
        pinned_count=Count("videos", filter=Q(videos__pinned=True)),
    )

    # Sort by tier weight in Python (simple, avoids raw SQL for the custom weight map)
    sorted_channels = sorted(channels, key=lambda ch: (ch.tier_weight, ch.display_order, ch.name))

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
                    "pinned_count": ch.pinned_count,
                }
                for ch in sorted_channels
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

    # Fetch stats if pinning and stats are missing
    if video.pinned and not video.stats_updated_at:
        access_token = _refresh_access_token()
        if access_token:
            _fetch_video_stats(access_token, [video.youtube_video_id])

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


def _fetch_video_stats(access_token, video_ids):
    """Fetch statistics, contentDetails, and snippet for video IDs and update DB. Returns count updated."""
    now = timezone.now()
    updated = 0
    for i in range(0, len(video_ids), 50):
        batch_ids = video_ids[i : i + 50]
        ids_param = ",".join(batch_ids)
        try:
            data = _youtube_api_get(
                "videos",
                access_token,
                {"id": ids_param, "part": "statistics,contentDetails,snippet"},
            )
        except Exception:
            logger.exception("Failed to fetch video stats batch")
            continue

        for item in data.get("items", []):
            yt_id = item.get("id", "")
            if not yt_id:
                continue
            try:
                video = WatchVideo.objects.get(youtube_video_id=yt_id)
            except WatchVideo.DoesNotExist:
                continue
            stats = item.get("statistics", {})
            video.view_count = int(stats.get("viewCount", 0))
            video.like_count = int(stats.get("likeCount", 0))
            video.comment_count = int(stats.get("commentCount", 0))
            video.description = item.get("snippet", {}).get("description", "")
            video.duration = item.get("contentDetails", {}).get("duration", "")
            video.stats_updated_at = now
            video.save(
                update_fields=[
                    "view_count",
                    "like_count",
                    "comment_count",
                    "description",
                    "duration",
                    "stats_updated_at",
                ]
            )
            updated += 1
    return updated


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
    synced_video_ids = []

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

            video, created = WatchVideo.objects.get_or_create(
                youtube_video_id=video_id,
                defaults={
                    "title": snippet.get("title", ""),
                    "thumbnail_url": thumbnail_url,
                    "channel": channel,
                    "visible": False,
                    "pinned": False,
                },
            )
            if not created:
                # Update metadata but preserve pinned/visible state
                video.title = snippet.get("title", video.title)
                video.thumbnail_url = thumbnail_url or video.thumbnail_url
                if channel:
                    video.channel = channel
                video.save(update_fields=["title", "thumbnail_url", "channel"])
            else:
                new_count += 1
            synced_video_ids.append(video_id)
            total += 1

        if total >= 200:
            break

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    if synced_video_ids:
        _fetch_video_stats(access_token, synced_video_ids)

    return new_count


# ---------------------------------------------------------------------------
# YouTube OAuth + Sync views
# ---------------------------------------------------------------------------


def watch_auth(request):
    """Redirect to Google OAuth. Requires short-lived admin nonce as ?nonce= param."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        return JsonResponse({"error": "Google OAuth not configured"}, status=500)

    nonce = request.GET.get("nonce", "")
    if not verify_admin_nonce(nonce):
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
    access_token = _refresh_access_token()
    if not access_token:
        return JsonResponse({"error": "YouTube not connected"}, status=400)

    last_sync = redis_cache.get(_SYNC_KEY) or 0
    now = time.time()
    if now - last_sync < SYNC_COOLDOWN:
        remaining = int(SYNC_COOLDOWN - (now - last_sync))
        return JsonResponse({"error": f"Rate limited. Try again in {remaining}s"}, status=429)

    try:
        new_channels = _sync_subscriptions(access_token)
        new_videos = _sync_liked_videos(access_token)
    except Exception:
        logger.exception("YouTube sync failed")
        return JsonResponse({"error": "Sync failed"}, status=500)

    redis_cache.set(_SYNC_KEY, now, SYNC_COOLDOWN + 60)
    redis_cache.set("watches_last_synced", timezone.now().isoformat(), None)

    return JsonResponse({"ok": True, "new_channels": new_channels, "new_videos": new_videos})


@require_admin
def watch_sync_status(_request):
    """Check sync availability and connection status."""
    last_sync = redis_cache.get(_SYNC_KEY) or 0
    now = time.time()
    elapsed = now - last_sync
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


@require_admin
def watch_channel_uploads(_request, channel_id):
    """Admin: fetch popular uploads for a channel from YouTube API, sorted by view count."""
    try:
        channel = WatchChannel.objects.get(pk=channel_id)
    except WatchChannel.DoesNotExist:
        return JsonResponse({"error": "Channel not found"}, status=404)

    yt_id = channel.youtube_channel_id
    if not yt_id.startswith("UC"):
        return JsonResponse({"videos": [], "message": "Channel ID format not supported"})

    access_token = _refresh_access_token()
    if not access_token:
        return JsonResponse({"error": "YouTube not connected"}, status=400)

    # Fetch ~150 uploads (3 pages of 50) to find popular videos
    playlist_id = "UU" + yt_id[2:]
    all_items = []
    next_page_token = None
    for _ in range(3):
        params = {"playlistId": playlist_id, "part": "snippet", "maxResults": 50}
        if next_page_token:
            params["pageToken"] = next_page_token
        try:
            data = _youtube_api_get("playlistItems", access_token, params=params)
        except Exception:
            logger.exception("Failed to fetch uploads for channel %s", channel.name)
            break
        all_items.extend(data.get("items", []))
        next_page_token = data.get("nextPageToken")
        if not next_page_token:
            break

    if not all_items:
        return JsonResponse({"videos": [], "message": "Failed to fetch uploads"})

    # Collect video IDs and filter out already-pinned ones
    vid_map = {}
    for item in all_items:
        snippet = item.get("snippet", {})
        vid_id = snippet.get("resourceId", {}).get("videoId")
        if vid_id:
            thumbs = snippet.get("thumbnails", {})
            thumb_url = (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url", "")
            vid_map[vid_id] = {"title": snippet.get("title", ""), "thumbnail_url": thumb_url}

    existing_ids = set(
        WatchVideo.objects.filter(youtube_video_id__in=list(vid_map.keys())).values_list("youtube_video_id", flat=True)
    )
    for eid in existing_ids:
        vid_map.pop(eid, None)

    if not vid_map:
        return JsonResponse({"videos": []})

    # Batch-fetch stats + duration to sort by view count and filter shorts
    stats = {}
    durations = {}
    vid_ids_list = list(vid_map.keys())
    for i in range(0, len(vid_ids_list), 50):
        batch_ids = vid_ids_list[i : i + 50]
        try:
            data = _youtube_api_get(
                "videos", access_token, {"id": ",".join(batch_ids), "part": "statistics,contentDetails"}
            )
        except Exception:
            logger.exception("Failed to fetch video stats for uploads")
            continue
        for item in data.get("items", []):
            yt_id = item.get("id", "")
            view_count = int(item.get("statistics", {}).get("viewCount", 0))
            stats[yt_id] = view_count
            durations[yt_id] = item.get("contentDetails", {}).get("duration", "")

    # Build response sorted by view count descending, excluding shorts (<=60s)
    videos = []
    for vid_id, info in vid_map.items():
        duration = durations.get(vid_id, "")
        if duration and parse_iso8601_duration(duration) <= 60:
            continue
        videos.append(
            {
                "youtube_video_id": vid_id,
                "title": info["title"],
                "thumbnail_url": info["thumbnail_url"],
                "view_count": stats.get(vid_id, 0),
            }
        )
    videos.sort(key=lambda v: v["view_count"], reverse=True)

    return JsonResponse({"videos": videos})


@csrf_exempt
@require_admin
def watch_channel_pin_videos(request, channel_id):
    """Admin: bulk pin videos to a channel."""
    try:
        channel = WatchChannel.objects.get(pk=channel_id)
    except WatchChannel.DoesNotExist:
        return JsonResponse({"error": "Channel not found"}, status=404)

    body, err = parse_json_body(request)
    if err:
        return err

    videos_data = body.get("videos", [])
    pinned_count = 0

    pinned_yt_ids = []
    for vdata in videos_data:
        yt_id = vdata.get("youtube_video_id")
        if not yt_id:
            continue
        video, _ = WatchVideo.objects.get_or_create(
            youtube_video_id=yt_id,
            defaults={"title": vdata.get("title", ""), "thumbnail_url": vdata.get("thumbnail_url", "")},
        )
        video.channel = channel
        video.title = vdata.get("title", video.title)
        video.thumbnail_url = vdata.get("thumbnail_url", video.thumbnail_url)
        video.pinned = True
        video.visible = True
        video.save(update_fields=["channel", "title", "thumbnail_url", "pinned", "visible"])
        pinned_yt_ids.append(yt_id)
        pinned_count += 1

    # Fetch stats (view/like/comment counts, description, duration) for newly pinned videos
    if pinned_yt_ids:
        access_token = _refresh_access_token()
        if access_token:
            _fetch_video_stats(access_token, pinned_yt_ids)

    return JsonResponse({"pinned": pinned_count})


@csrf_exempt
@require_admin
def watch_backfill_stats(_request):
    """Admin: backfill video stats from YouTube API for videos with stale or missing stats."""
    access_token = _refresh_access_token()
    if not access_token:
        return JsonResponse({"error": "YouTube not connected"}, status=400)

    threshold = timezone.now() - timezone.timedelta(days=7)
    stale_videos = list(WatchVideo.objects.filter(Q(stats_updated_at__isnull=True) | Q(stats_updated_at__lt=threshold)))

    if not stale_videos:
        return JsonResponse({"updated": 0})

    video_ids = [v.youtube_video_id for v in stale_videos]
    updated = _fetch_video_stats(access_token, video_ids)
    return JsonResponse({"updated": updated})
