import json
import logging

from django.core.cache import cache
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from website.auth import require_admin
from website.models import TrackedTool
from website.services.agent_harnesses import fetch_harnesses
from website.utils import parse_json_body

logger = logging.getLogger(__name__)

STALE_AFTER_DAYS = 90
SYNC_STATUS_KEY = "tools:sync_status"
FEED_SOURCE = "feed:best-of-agent-harnesses"


def _serialize(tool: TrackedTool) -> dict:
    stale_cutoff = timezone.now() - timezone.timedelta(days=STALE_AFTER_DAYS)
    return {
        "id": tool.id,
        "name": tool.name,
        "url": tool.url,
        "description": tool.description,
        "category": tool.category,
        "status": tool.status,
        "is_new": tool.is_new,
        "source": tool.source,
        "notes": tool.notes,
        "stars": tool.stars,
        "added_at": tool.added_at.isoformat(),
        "last_reviewed_at": tool.last_reviewed_at.isoformat(),
        "is_stale": tool.status in ("watching", "adopted") and tool.last_reviewed_at < stale_cutoff,
    }


def _do_sync() -> dict:
    """Fetch the feed and upsert. Never touches status/notes/last_reviewed_at on existing rows.

    Writes sync-status to cache on both success and failure so the admin UI reflects the
    weekly Celery Beat run too, not just manually-triggered syncs.
    """
    try:
        projects = fetch_harnesses()

        created = 0
        updated = 0
        for p in projects:
            github_id = p.get("github_id", "")
            if not github_id:
                continue
            tool, was_created = TrackedTool.objects.get_or_create(
                source_key=github_id,
                defaults={
                    "name": p.get("name", github_id),
                    "url": p.get("url", ""),
                    "description": p.get("description", ""),
                    "category": p.get("category", ""),
                    "stars": p.get("stars"),
                    "source": FEED_SOURCE,
                    "status": "watching",
                    "is_new": True,
                },
            )
            if was_created:
                created += 1
            else:
                tool.stars = p.get("stars")
                tool.description = p.get("description", tool.description)
                tool.save(update_fields=["stars", "description"])
                updated += 1

        result = {"fetched": len(projects), "created": created, "updated": updated}
    except Exception as e:
        cache.set(SYNC_STATUS_KEY, json.dumps({"last_sync": timezone.now().isoformat(), "error": str(e)}), None)
        raise

    cache.set(SYNC_STATUS_KEY, json.dumps({"last_sync": timezone.now().isoformat(), **result, "error": None}), None)
    return result


@require_GET
def tool_list(_request):
    """Public: all tracked tools (dropped entries stay visible with their reason)."""
    tools = TrackedTool.objects.all()
    return JsonResponse([_serialize(t) for t in tools], safe=False)


@csrf_exempt
@require_admin
def tool_create(request):
    """Admin: manually add a tool (e.g. a coworker's recommendation)."""
    body, err = parse_json_body(request)
    if err:
        return err

    name = body.get("name", "").strip()
    url = body.get("url", "").strip()
    if not name or not url:
        return JsonResponse({"error": "name and url are required"}, status=400)

    if TrackedTool.objects.filter(source_key=url).exists():
        return JsonResponse({"error": "A tool with this URL is already tracked"}, status=400)

    tool = TrackedTool.objects.create(
        name=name,
        url=url,
        description=body.get("description", "").strip(),
        category=body.get("category", "").strip(),
        notes=body.get("notes", "").strip(),
        source="manual",
        source_key=url,
        status="watching",
        is_new=False,
    )
    return JsonResponse(_serialize(tool), status=201)


@csrf_exempt
@require_admin
def tool_update(_request, tool_id):
    """Admin: triage a tool - change status/notes/category, or bump last_reviewed_at."""
    try:
        tool = TrackedTool.objects.get(pk=tool_id)
    except TrackedTool.DoesNotExist:
        return JsonResponse({"error": "Tool not found"}, status=404)

    body, err = parse_json_body(_request)
    if err:
        return err

    if "status" in body:
        status = body["status"]
        if status not in dict(TrackedTool.STATUS_CHOICES):
            return JsonResponse({"error": f"Invalid status: {status}"}, status=400)
        if status == "dropped" and not body.get("notes", tool.notes).strip():
            return JsonResponse({"error": "A reason (notes) is required when dropping a tool"}, status=400)
        tool.status = status

    if "notes" in body:
        tool.notes = body["notes"].strip()
    if "category" in body:
        tool.category = body["category"].strip()

    tool.is_new = False
    if body.get("mark_reviewed"):
        tool.last_reviewed_at = timezone.now()

    tool.save()
    return JsonResponse(_serialize(tool))


@csrf_exempt
@require_admin
def tool_delete(_request, tool_id):
    """Admin: remove a tool entirely (distinct from status='dropped', which is kept-with-reason)."""
    try:
        tool = TrackedTool.objects.get(pk=tool_id)
    except TrackedTool.DoesNotExist:
        return JsonResponse({"error": "Tool not found"}, status=404)
    tool.delete()
    return JsonResponse({"ok": True})


@csrf_exempt
@require_admin
def tool_sync(_request):
    """Admin: trigger the feed sync on demand (same logic the weekly beat schedule runs)."""
    try:
        result = _do_sync()
    except Exception:
        logger.exception("Manual tool sync failed")
        return JsonResponse({"error": "Sync failed"}, status=502)

    return JsonResponse(result)


@require_GET
@require_admin
def tool_sync_status(_request):
    """Admin: last sync time, counts, and error (if any)."""
    raw = cache.get(SYNC_STATUS_KEY)
    if raw:
        status = json.loads(raw)
    else:
        status = {"last_sync": None, "error": None}
    return JsonResponse(status)
