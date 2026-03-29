import hmac
import json

import redis
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..auth import create_token, verify_token

_RATE_LIMIT_MAX = 15
_RATE_LIMIT_WINDOW = 900  # 15 minutes


def _get_client_ip(request):
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def _is_rate_limited(ip: str) -> bool:
    try:
        r = redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
        key = f"login_attempts:{ip}"
        count = r.incr(key)
        if count == 1:
            r.expire(key, _RATE_LIMIT_WINDOW)
        return count > _RATE_LIMIT_MAX
    except redis.RedisError:
        # If Redis is unavailable, fail open to avoid locking out the admin
        return False


@csrf_exempt
def login(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    ip = _get_client_ip(request)
    if _is_rate_limited(ip):
        return JsonResponse({"error": "Too many attempts. Try again later."}, status=429)

    try:
        body = json.loads(request.body)
        secret = body.get("secret", "")
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    admin_secret = getattr(settings, "ADMIN_SECRET", "")
    if not admin_secret:
        return JsonResponse({"error": "Not configured"}, status=503)

    if not hmac.compare_digest(secret.encode(), admin_secret.encode()):
        return JsonResponse({"error": "Wrong secret"}, status=401)

    return JsonResponse({"token": create_token()})


def check(request):
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and verify_token(auth[7:]):
        return JsonResponse({"authenticated": True})
    return JsonResponse({"authenticated": False})
