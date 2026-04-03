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

from ..auth import require_admin, verify_token
from ..models import LichessToken

logger = logging.getLogger(__name__)

CLIENT_ID = "nam685.de"
LICHESS_AUTHORIZE_URL = "https://lichess.org/oauth"
LICHESS_TOKEN_URL = "https://lichess.org/api/token"
LICHESS_ACCOUNT_URL = "https://lichess.org/api/account"
SCOPES = "board:play challenge:write challenge:read"

# Rate limit: 1 OAuth flow per 5 minutes
_last_sync: float = 0
SYNC_COOLDOWN = 300


def lichess_auth(request):
    """Redirect to Lichess OAuth. Requires admin token as ?token= param."""
    admin_token = request.GET.get("token", "")
    if not admin_token or not verify_token(admin_token):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # PKCE: generate verifier + S256 challenge
    code_verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

    # Store verifier in Redis cache, keyed by a random nonce
    nonce = secrets.token_urlsafe(16)
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
            "state": f"{nonce}:{admin_token}",
        },
    )
    return HttpResponseRedirect(f"{LICHESS_AUTHORIZE_URL}?{params}")


def lichess_callback(request):
    """Lichess OAuth callback: exchange code for token, fetch account, store."""
    global _last_sync

    error = request.GET.get("error", "")
    if error:
        return HttpResponseRedirect(f"/plays?error={urllib.parse.quote(error)}")

    code = request.GET.get("code", "")
    state = request.GET.get("state", "")
    if not code:
        return JsonResponse({"error": "Missing code"}, status=400)

    # Parse state: "nonce:adminToken"
    if ":" not in state:
        return JsonResponse({"error": "Unauthorized"}, status=401)
    nonce, admin_token = state.split(":", 1)
    if not verify_token(admin_token):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    # Rate limit
    now = time.time()
    if now - _last_sync < SYNC_COOLDOWN:
        remaining = int(SYNC_COOLDOWN - (now - _last_sync))
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

    _last_sync = now
    return HttpResponseRedirect("/plays")


@require_admin
def lichess_token(request):
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


def lichess_status(request):
    """Public endpoint: return whether a Lichess account is connected."""
    token = LichessToken.objects.first()
    if token:
        return JsonResponse({"connected": True, "username": token.lichess_username})
    return JsonResponse({"connected": False, "username": None})
