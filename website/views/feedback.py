from datetime import timedelta

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..models import Feedback
from ..utils import get_client_ip, parse_json_body

COOLDOWN = timedelta(hours=1)
MAX_LENGTH = 2000


@csrf_exempt
def feedback_create(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    ip = get_client_ip(request)

    # Rate limit: 1 per hour per IP
    cutoff = timezone.now() - COOLDOWN
    if Feedback.objects.filter(ip_address=ip, created_at__gte=cutoff).exists():
        return JsonResponse({"error": "You've already sent feedback recently. Try again later."}, status=429)

    body, err = parse_json_body(request)
    if err:
        return err
    message = body.get("message", "").strip()

    if not message:
        return JsonResponse({"error": "Message required"}, status=400)
    if len(message) > MAX_LENGTH:
        return JsonResponse({"error": f"Too long (max {MAX_LENGTH} chars)"}, status=400)

    Feedback.objects.create(message=message, ip_address=ip)
    return JsonResponse({"ok": True}, status=201)
