import hmac

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..auth import create_token, require_admin, verify_token
from ..utils import create_admin_nonce, get_client_ip, parse_json_body

_RATE_LIMIT_MAX = 15
_RATE_LIMIT_WINDOW = 900  # 15 minutes


def _is_rate_limited(ip: str) -> bool:
    try:
        key = f"login_attempts:{ip}"
        count = cache.get(key)
        if count is None:
            cache.set(key, 1, _RATE_LIMIT_WINDOW)
            return False
        count += 1
        cache.set(key, count, _RATE_LIMIT_WINDOW)
        return count > _RATE_LIMIT_MAX
    except Exception:
        # If cache is unavailable, fail closed to prevent brute-force
        return True


@csrf_exempt
def login(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    ip = get_client_ip(request)
    if _is_rate_limited(ip):
        return JsonResponse({"error": "Too many attempts. Try again later."}, status=429)

    body, err = parse_json_body(request)
    if err:
        return err
    secret = body.get("secret", "")

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


@csrf_exempt
@require_admin
def nonce(request):
    """POST /api/auth/nonce/ — create a short-lived nonce for OAuth redirects."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    return JsonResponse({"nonce": create_admin_nonce()})
