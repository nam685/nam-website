import base64
import hashlib
import json
import logging
import secrets
import time
import urllib.parse
import urllib.request

from django.core.cache import cache as redis_cache
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt  # used on lichess_disconnect
from django.views.decorators.http import require_GET

from ..auth import require_admin
from ..models import LichessToken
from ..utils import create_oauth_nonce, verify_admin_nonce, verify_oauth_nonce

logger = logging.getLogger(__name__)

CLIENT_ID = "nam685.de"
LICHESS_AUTHORIZE_URL = "https://lichess.org/oauth"
LICHESS_TOKEN_URL = "https://lichess.org/api/token"
LICHESS_ACCOUNT_URL = "https://lichess.org/api/account"
SCOPES = "board:play challenge:write challenge:read"

SYNC_COOLDOWN = 300
_SYNC_KEY = "lichess_last_sync_ts"


def lichess_auth(request):
    """Redirect to Lichess OAuth. Requires short-lived admin nonce as ?nonce= param."""
    nonce = request.GET.get("nonce", "")
    if not verify_admin_nonce(nonce):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # PKCE: generate verifier + S256 challenge
    code_verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

    # Store verifier in Redis cache, keyed by OAuth nonce
    nonce = create_oauth_nonce()
    redis_cache.set(f"lichess_pkce_{nonce}", code_verifier, 600)  # 10 min TTL

    # Build redirect URI
    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    redirect_uri = f"{scheme}://{host}/api/lichess/callback/"

    params = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": redirect_uri,
            "code_challenge_method": "S256",
            "code_challenge": code_challenge,
            "scope": SCOPES,
            "state": nonce,
        },
    )
    return HttpResponseRedirect(f"{LICHESS_AUTHORIZE_URL}?{params}")


def lichess_callback(request):
    """Lichess OAuth callback: exchange code for token, fetch account, store."""
    error = request.GET.get("error", "")
    if error:
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote(error)}")

    code = request.GET.get("code", "")
    state = request.GET.get("state", "")
    if not code:
        return JsonResponse({"error": "Missing code"}, status=400)

    # Verify one-time nonce (replaces admin token in state param — never send tokens to OAuth providers)
    if not verify_oauth_nonce(state):
        return JsonResponse({"error": "Unauthorized"}, status=401)
    nonce = state

    # Rate limit (Redis-based, works across workers)
    last_sync = redis_cache.get(_SYNC_KEY) or 0
    now = time.time()
    if now - last_sync < SYNC_COOLDOWN:
        remaining = int(SYNC_COOLDOWN - (now - last_sync))
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote(f'Rate limited. Try again in {remaining}s')}")

    # Retrieve PKCE verifier from cache
    code_verifier = redis_cache.get(f"lichess_pkce_{nonce}")
    if not code_verifier:
        return JsonResponse({"error": "PKCE verifier expired or invalid"}, status=400)
    redis_cache.delete(f"lichess_pkce_{nonce}")

    # Build redirect URI (must match auth request exactly)
    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    redirect_uri = f"{scheme}://{host}/api/lichess/callback/"

    # Exchange code + verifier for access token
    token_data = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": code_verifier,
            "redirect_uri": redirect_uri,
            "client_id": CLIENT_ID,
        }
    ).encode()

    token_req = urllib.request.Request(
        LICHESS_TOKEN_URL,
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urllib.request.urlopen(token_req, timeout=10) as resp:
            token_resp = json.loads(resp.read())
    except Exception:
        logger.exception("Failed to exchange Lichess OAuth code")
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote('Failed to exchange OAuth code')}")

    access_token = token_resp.get("access_token")
    expires_in = token_resp.get("expires_in", 31536000)  # default ~1 year
    if not access_token:
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote('No access token received')}")

    # Fetch Lichess account for username
    account_req = urllib.request.Request(
        LICHESS_ACCOUNT_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    try:
        with urllib.request.urlopen(account_req, timeout=10) as resp:
            account = json.loads(resp.read())
    except Exception:
        logger.exception("Failed to fetch Lichess account")
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote('Failed to fetch account info')}")

    username = account.get("username", "unknown")

    # Upsert: delete all existing, create new
    LichessToken.objects.all().delete()
    LichessToken.objects.create(
        access_token=access_token,
        lichess_username=username,
        expires_at=timezone.now() + timezone.timedelta(seconds=expires_in),
    )

    redis_cache.set(_SYNC_KEY, now, SYNC_COOLDOWN + 60)
    return HttpResponseRedirect("/plays")


@require_admin
def lichess_token(request):  # noqa: ARG001
    """Return the stored Lichess access token (admin only)."""
    token = LichessToken.objects.first()
    if not token:
        return JsonResponse({"error": "Not connected"}, status=404)
    return JsonResponse(
        {
            "access_token": token.access_token,
            "username": token.lichess_username,
            "expires_at": token.expires_at.isoformat(),
        }
    )


@csrf_exempt
@require_admin
def lichess_disconnect(request):  # noqa: ARG001
    """Revoke stored Lichess token and delete from DB."""
    token = LichessToken.objects.first()
    if not token:
        return JsonResponse({"error": "Not connected"}, status=404)

    # Revoke token at Lichess
    try:
        revoke_req = urllib.request.Request(
            LICHESS_TOKEN_URL, method="DELETE", headers={"Authorization": f"Bearer {token.access_token}"}
        )
        urllib.request.urlopen(revoke_req, timeout=10)
    except Exception:
        logger.warning("Failed to revoke Lichess token (may already be expired)")

    token.delete()
    return JsonResponse({"ok": True})


@require_GET
def lichess_status(request):  # noqa: ARG001
    """Public endpoint: return whether a Lichess account is connected."""
    token = LichessToken.objects.first()
    if token:
        return JsonResponse({"connected": True, "username": token.lichess_username})
    return JsonResponse({"connected": False, "username": None})


EXPLORER_BASE = "https://explorer.lichess.org"
EXPLORER_CACHE_TTL = 300  # 5 min


@require_GET
def lichess_explorer(request, db):
    """Proxy Opening Explorer requests, adding the stored Lichess Bearer token.

    Lichess now requires authentication for explorer.lichess.org (since Feb 2026).
    This endpoint proxies the request server-side so the token stays private.
    """
    if db not in ("masters", "lichess"):
        return JsonResponse({"error": "Invalid database"}, status=400)

    fen = request.GET.get("fen", "")
    if not fen:
        return JsonResponse({"error": "Missing fen parameter"}, status=400)

    # Build upstream URL with same query params
    params = {"fen": fen}
    ratings = request.GET.get("ratings", "")
    if ratings:
        params["ratings"] = ratings
    speeds = request.GET.get("speeds", "")
    if speeds:
        params["speeds"] = speeds

    upstream_url = f"{EXPLORER_BASE}/{db}?{urllib.parse.urlencode(params)}"

    # Check cache first
    cache_key = f"lichess_explorer:{db}:{fen}:{ratings}:{speeds}"
    cached = redis_cache.get(cache_key)
    if cached:
        return JsonResponse(json.loads(cached), safe=False)

    # Get stored Lichess token for auth
    stored = LichessToken.objects.first()
    headers = {"Accept": "application/json"}
    if stored:
        headers["Authorization"] = f"Bearer {stored.access_token}"

    req = urllib.request.Request(upstream_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read().decode()
            redis_cache.set(cache_key, data, EXPLORER_CACHE_TTL)
            return JsonResponse(json.loads(data), safe=False)
    except urllib.error.HTTPError as e:
        logger.warning("Lichess explorer returned %s for %s", e.code, db)
        return JsonResponse({"error": f"Lichess explorer returned {e.code}"}, status=502)
    except Exception:
        logger.exception("Failed to fetch Lichess explorer data")
        return JsonResponse({"error": "Failed to fetch explorer data"}, status=502)
