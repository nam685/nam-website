import json
import secrets

from django.core.cache import cache as redis_cache
from django.http import JsonResponse

OAUTH_NONCE_TTL = 300  # 5 minutes
ADMIN_NONCE_TTL = 60  # 1 minute — short-lived, used to replace token-in-URL for OAuth redirects


def create_oauth_nonce():
    """Generate a random nonce, store in Redis, return it. Used as OAuth state param instead of admin token."""
    nonce = secrets.token_urlsafe(32)
    redis_cache.set(f"oauth_nonce:{nonce}", "1", OAUTH_NONCE_TTL)
    return nonce


def verify_oauth_nonce(nonce):
    """Verify and consume a one-time OAuth nonce. Returns True if valid."""
    if not nonce:
        return False
    key = f"oauth_nonce:{nonce}"
    if redis_cache.get(key):
        redis_cache.delete(key)
        return True
    return False


def create_admin_nonce():
    """Generate a short-lived nonce for admin OAuth redirects (replaces token-in-URL)."""
    nonce = secrets.token_urlsafe(32)
    redis_cache.set(f"admin_nonce:{nonce}", "1", ADMIN_NONCE_TTL)
    return nonce


def verify_admin_nonce(nonce):
    """Verify and consume a one-time admin nonce. Returns True if valid."""
    if not nonce:
        return False
    key = f"admin_nonce:{nonce}"
    if redis_cache.get(key):
        redis_cache.delete(key)
        return True
    return False


def get_client_ip(request):
    """Extract client IP from request, using X-Forwarded-For if behind proxy."""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        # Use rightmost IP (added by our reverse proxy, not client-supplied)
        return xff.split(",")[-1].strip()
    return request.META.get("REMOTE_ADDR", "")


def parse_pagination(request, default_limit=50, max_limit=200):
    """Parse and validate limit/offset from GET params. Returns (limit, offset) or raises ValueError."""
    limit = min(max(int(request.GET.get("limit", default_limit)), 1), max_limit)
    offset = max(int(request.GET.get("offset", 0)), 0)
    return limit, offset


def parse_json_body(request):
    """Parse JSON request body. Returns (body_dict, error_response)."""
    try:
        body = json.loads(request.body)
        if not isinstance(body, dict):
            return {}, JsonResponse({"error": "Invalid JSON"}, status=400)
        return body, None
    except (json.JSONDecodeError, AttributeError):
        return {}, JsonResponse({"error": "Invalid JSON"}, status=400)
