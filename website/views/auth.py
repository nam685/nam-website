import json

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..auth import create_token, verify_token


@csrf_exempt
def login(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        body = json.loads(request.body)
        secret = body.get("secret", "")
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    admin_secret = getattr(settings, "ADMIN_SECRET", "")
    if not admin_secret:
        return JsonResponse({"error": "Not configured"}, status=503)

    if secret != admin_secret:
        return JsonResponse({"error": "Wrong secret"}, status=401)

    return JsonResponse({"token": create_token()})


def check(request):
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and verify_token(auth[7:]):
        return JsonResponse({"authenticated": True})
    return JsonResponse({"authenticated": False})
