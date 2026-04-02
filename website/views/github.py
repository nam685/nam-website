import json
import os
import time
import urllib.parse
import urllib.request

from django.http import HttpResponseRedirect, JsonResponse

from ..auth import require_admin, verify_token
from ..models import GitHubContributions
from ..utils import create_oauth_nonce, verify_oauth_nonce

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
    admin_token = request.GET.get("token", "")
    if not admin_token or not verify_token(admin_token):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    client_id = os.environ.get("GITHUB_CLIENT_ID", "")
    if not client_id:
        return JsonResponse({"error": "GitHub OAuth not configured"}, status=500)
    params = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "scope": "read:user",
            "state": create_oauth_nonce(),
        }
    )
    return HttpResponseRedirect(f"{GITHUB_AUTHORIZE_URL}?{params}")


def github_callback(request):
    """GitHub OAuth callback: exchange code, fetch contributions, store, redirect."""
    global _last_refresh

    code = request.GET.get("code", "")
    state = request.GET.get("state", "")

    if not code:
        return JsonResponse({"error": "Missing code"}, status=400)

    # Verify OAuth nonce (one-time use, not the admin token)
    if not verify_oauth_nonce(state):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Rate limit
    now = time.time()
    if now - _last_refresh < REFRESH_COOLDOWN:
        remaining = int(REFRESH_COOLDOWN - (now - _last_refresh))
        return JsonResponse({"error": f"Rate limited. Try again in {remaining}s"}, status=429)

    # Exchange code for access token
    client_id = os.environ.get("GITHUB_CLIENT_ID", "")
    client_secret = os.environ.get("GITHUB_CLIENT_SECRET", "")

    token_data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
        }
    ).encode()

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

    # Fetch contributions + repository metadata
    query = (
        """{
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
        repositories(first: 100, orderBy: {field: PUSHED_AT, direction: DESC}, ownerAffiliations: OWNER) {
          nodes {
            name
            url
            pushedAt
          }
        }
      }
    }"""
        % GITHUB_USERNAME
    )

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

    user_data = gql_data.get("data", {}).get("user", {})
    calendar = user_data.get("contributionsCollection", {}).get("contributionCalendar")
    if not calendar:
        return JsonResponse({"error": "No contribution data in response"}, status=502)

    # Extract repo pushed_at dates: {repo_url: pushedAt}
    repos = user_data.get("repositories", {}).get("nodes", [])
    repo_dates = {r["url"]: r["pushedAt"] for r in repos if r.get("url") and r.get("pushedAt")}

    # Store (upsert single record) — calendar + repo metadata
    store_data = {**calendar, "repositoryDates": repo_dates}
    record, _ = GitHubContributions.objects.update_or_create(
        pk=1,
        defaults={"data": store_data},
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
