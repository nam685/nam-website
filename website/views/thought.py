import json
from datetime import timedelta

from django.conf import settings
from django.core.paginator import Paginator
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..models import Thought

COOLDOWN = timedelta(hours=18)


def thought_list(request):
    thoughts = Thought.objects.filter(is_published=True)
    paginator = Paginator(thoughts, 10)
    page_number = request.GET.get("page", 1)
    page = paginator.get_page(page_number)
    data = {
        "thoughts": [
            {
                "id": t.id,
                "content": t.content,
                "created_at": t.created_at.isoformat(),
            }
            for t in page
        ],
        "has_next": page.has_next(),
        "page": page.number,
    }
    return JsonResponse(data)


@csrf_exempt
def thought_create(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    # Auth: Bearer token must match THOUGHT_SECRET env var
    secret = getattr(settings, "THOUGHT_SECRET", None)
    if not secret:
        return JsonResponse({"error": "Not configured"}, status=503)
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {secret}":
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Cooldown: 18h since last thought
    latest = Thought.objects.filter(is_published=True).first()
    if latest and timezone.now() - latest.created_at < COOLDOWN:
        return JsonResponse({"error": "Chill. Too much thinking for today."}, status=429)

    try:
        body = json.loads(request.body)
        content = body.get("content", "").strip()
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    if not content:
        return JsonResponse({"error": "Content required"}, status=400)
    if len(content) > 2000:
        return JsonResponse({"error": "Too long (max 2000 chars)"}, status=400)

    thought = Thought.objects.create(content=content)
    return JsonResponse(
        {
            "id": thought.id,
            "content": thought.content,
            "created_at": thought.created_at.isoformat(),
        },
        status=201,
    )
