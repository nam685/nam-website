from datetime import timedelta

from django.core.paginator import Paginator
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin
from ..models import Thought
from ..utils import parse_json_body

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
@require_admin
def thought_create(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    # Cooldown: 18h since last thought
    latest = Thought.objects.filter(is_published=True).order_by("-created_at").first()
    if latest and timezone.now() - latest.created_at < COOLDOWN:
        return JsonResponse({"error": "Chill. Too much thinking for today."}, status=429)

    body, err = parse_json_body(request)
    if err:
        return err
    content = body.get("content", "").strip()

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
