from functools import wraps

from django.core import signing
from django.http import JsonResponse

TOKEN_MAX_AGE = 7 * 24 * 60 * 60  # 7 days


def create_token():
    return signing.dumps("admin", salt="admin-auth")


def verify_token(token: str) -> bool:
    try:
        value = signing.loads(token, salt="admin-auth", max_age=TOKEN_MAX_AGE)
        return value == "admin"
    except (signing.BadSignature, signing.SignatureExpired):
        return False


def require_admin(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JsonResponse({"error": "Unauthorized"}, status=401)
        token = auth[7:]
        if not verify_token(token):
            return JsonResponse({"error": "Unauthorized"}, status=401)
        return view_func(request, *args, **kwargs)

    return wrapper
