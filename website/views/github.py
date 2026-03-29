import json
import os
import time
import urllib.parse
import urllib.request

from django.http import HttpResponseRedirect, JsonResponse

from ..auth import require_admin
from ..models import GitHubContributions

GITHUB_GRAPHQL_URL = "https://api.github.com/graphql"
GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USERNAME = "nam685"

# Simple in-memory rate limit: 1 refresh per 10 minutes
_last_refresh: float = 0
REFRESH_COOLDOWN = 600


def contributions(_request):
    """Public endpoint: return stored contribution data."""
    record = GitHubContributions.objects.first()
    if not record or not record.data:
        return JsonResponse({"contributions": None})
    return JsonResponse({"contributions": record.data, "updated_at": record.updated_at.isoformat()})


def github_auth(request):
    """Redirect to GitHub OAuth. Requires admin token as ?token= param."""
    client_id = os.environ.get("GITHUB_CLIENT_ID", "")
    if not client_id:
        return JsonResponse({"error": "GitHub OAuth not configured"}, status=500)

    # Pass the admin token through OAuth state so callback can verify
    admin_token = request.GET.get("token", "")
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "scope": "read:user",
        "state": admin_token,
    })
    return HttpResponseRedirect(f"{GITHUB_AUTHORIZE_URL}?{params}")


def github_callback(request):
    """GitHub OAuth callback: exchange code, fetch contributions, store, redirect."""
    global _last_refresh

    code = request.GET.get("code", "")
    state = request.GET.get("state", "")  # admin token passed via state

    if not code:
        return JsonResponse({"error": "Missing code"}, status=400)

    # Verify admin via state param
    from ..auth import verify_token

    if not state or not verify_token(state):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Rate limit
    now = time.time()
    if now - _last_refresh < REFRESH_COOLDOWN:
        remaining = int(REFRESH_COOLDOWN - (now - _last_refresh))
        return JsonResponse({"error": f"Rate limited. Try again in {remaining}s"}, status=429)

    # Exchange code for access token
    client_id = os.environ.get("GITHUB_CLIENT_ID", "")
    client_secret = os.environ.get("GITHUB_CLIENT_SECRET", "")

    token_data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
    }).encode()

    token_req = urllib.request.Request(
        GITHUB_TOKEN_URL,
        data=token_data,
        headers={"Accept": "application/json"},
    )

    try:
        with urllib.request.urlopen(token_req, timeout=10) as resp:
            token_resp = json.loads(resp.read())
    except Exception:
        return JsonResponse({"error": "Failed to exchange OAuth code"}, status=502)

    access_token = token_resp.get("access_token")
    if not access_token:
        return JsonResponse({"error": "No access token received"}, status=502)

    # Fetch contributions
    query = """{
      user(login: "%s") {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
      }
    }""" % GITHUB_USERNAME

    gql_req = urllib.request.Request(
        GITHUB_GRAPHQL_URL,
        data=json.dumps({"query": query}).encode(),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(gql_req, timeout=10) as resp:
            gql_data = json.loads(resp.read())
    except Exception:
        return JsonResponse({"error": "Failed to fetch contributions"}, status=502)

    calendar = gql_data.get("data", {}).get("user", {}).get("contributionsCollection", {}).get("contributionCalendar")
    if not calendar:
        return JsonResponse({"error": "No contribution data in response"}, status=502)

    # Store (upsert single record)
    record, _ = GitHubContributions.objects.update_or_create(
        pk=1,
        defaults={"data": calendar},
    )

    _last_refresh = now

    # Token is discarded here — never stored
    return HttpResponseRedirect("/codes")


@require_admin
def refresh_status(_request):
    """Check if refresh is available (rate limit status)."""
    global _last_refresh
    now = time.time()
    elapsed = now - _last_refresh
    available = elapsed >= REFRESH_COOLDOWN
    remaining = max(0, int(REFRESH_COOLDOWN - elapsed)) if not available else 0

    record = GitHubContributions.objects.first()
    updated_at = record.updated_at.isoformat() if record else None

    return JsonResponse({"available": available, "cooldown_remaining": remaining, "last_updated": updated_at})
