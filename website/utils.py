import json

from django.http import JsonResponse


def get_client_ip(request):
    """Extract client IP from request, using X-Forwarded-For if behind proxy."""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        # Use rightmost IP (added by our reverse proxy, not client-supplied)
        return xff.split(",")[-1].strip()
    return request.META.get("REMOTE_ADDR", "")


def parse_json_body(request):
    """Parse JSON request body. Returns (body_dict, error_response)."""
    try:
        body = json.loads(request.body)
        if not isinstance(body, dict):
            return {}, JsonResponse({"error": "Invalid JSON"}, status=400)
        return body, None
    except (json.JSONDecodeError, AttributeError):
        return {}, JsonResponse({"error": "Invalid JSON"}, status=400)
