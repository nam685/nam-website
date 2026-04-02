import logging

from django.http import JsonResponse

from ..auth import require_admin
from ..models import WatchChannel, WatchVideo
from ..utils import parse_json_body

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
def watch_staging(request):
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


@require_admin
def watch_channel_delete(request, channel_id):
    """Admin: hard delete a channel (videos get SET_NULL)."""
    try:
        channel = WatchChannel.objects.get(pk=channel_id)
    except WatchChannel.DoesNotExist:
        return JsonResponse({"error": "Channel not found"}, status=404)

    channel.delete()
    return JsonResponse({"ok": True})


@require_admin
def watch_video_pin(request, video_id):
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


@require_admin
def watch_video_delete(request, video_id):
    """Admin: hard delete a video."""
    try:
        video = WatchVideo.objects.get(pk=video_id)
    except WatchVideo.DoesNotExist:
        return JsonResponse({"error": "Video not found"}, status=404)

    video.delete()
    return JsonResponse({"ok": True})
