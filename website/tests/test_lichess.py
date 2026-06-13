from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone

from website.models import LichessToken
from website.views import lichess as lichess_views


@pytest.mark.django_db
class TestLichessToken:
    def test_create_token(self):
        token = LichessToken.objects.create(
            access_token="lip_test123",
            lichess_username="testuser",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        assert token.access_token == "lip_test123"
        assert token.lichess_username == "testuser"
        assert str(token) == "Lichess: testuser"

    def test_upsert_replaces_existing(self):
        LichessToken.objects.create(
            access_token="old_token",
            lichess_username="olduser",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        # Delete all, then create new (single-row upsert pattern)
        LichessToken.objects.all().delete()
        LichessToken.objects.create(
            access_token="new_token",
            lichess_username="newuser",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        assert LichessToken.objects.count() == 1
        assert LichessToken.objects.first().lichess_username == "newuser"


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    from django.core.cache import cache

    cache.delete(lichess_views._SYNC_KEY)
    yield
    cache.delete(lichess_views._SYNC_KEY)


# ── Auth guard ──────────────────────────────────────


@pytest.mark.django_db
class TestLichessAuthGuard:
    def test_auth_requires_nonce(self, client):
        resp = client.get("/api/lichess/auth/")
        assert resp.status_code == 401

    def test_auth_rejects_bad_nonce(self, client):
        resp = client.get("/api/lichess/auth/?nonce=bad")
        assert resp.status_code == 401

    def test_token_requires_auth(self, client):
        resp = client.get("/api/lichess/token/")
        assert resp.status_code == 401


# ── Auth endpoint ────────────────────────────────────


@pytest.mark.django_db
class TestLichessAuth:
    def test_redirects_to_lichess(self, client):
        from website.utils import create_admin_nonce

        nonce = create_admin_nonce()
        resp = client.get(f"/api/lichess/auth/?nonce={nonce}")
        assert resp.status_code == 302
        location = resp["Location"]
        assert "lichess.org/oauth" in location
        assert "nam685.de" in location
        assert "board%3Aplay" in location
        assert "code_challenge=" in location


# ── Callback endpoint ────────────────────────────────


@pytest.mark.django_db
class TestLichessCallback:
    def test_callback_missing_code(self, client):
        resp = client.get("/api/lichess/callback/")
        assert resp.status_code == 400

    def test_callback_bad_state(self, client):
        resp = client.get("/api/lichess/callback/?code=test&state=bad-nonce")
        assert resp.status_code == 401

    @patch("website.views.lichess.urllib.request.urlopen")
    def test_callback_exchanges_token(self, mock_urlopen, client):
        from django.core.cache import cache

        # Create a valid OAuth nonce + PKCE verifier
        nonce = "nonce123"
        cache.set(f"oauth_nonce:{nonce}", "1", 300)
        cache.set(f"lichess_pkce_{nonce}", "test_verifier_string", 600)

        token_resp = MagicMock()
        token_resp.read.return_value = b'{"access_token":"lip_abc","expires_in":31536000}'
        token_resp.__enter__ = lambda s: s
        token_resp.__exit__ = MagicMock(return_value=False)

        account_resp = MagicMock()
        account_resp.read.return_value = b'{"username":"nam685"}'
        account_resp.__enter__ = lambda s: s
        account_resp.__exit__ = MagicMock(return_value=False)

        mock_urlopen.side_effect = [token_resp, account_resp]

        resp = client.get(f"/api/lichess/callback/?code=authcode&state={nonce}")
        assert resp.status_code == 302
        assert resp["Location"] == "/plays"
        assert LichessToken.objects.count() == 1
        assert LichessToken.objects.first().lichess_username == "nam685"

    @patch("website.views.lichess.urllib.request.urlopen")
    def test_callback_rate_limited(self, mock_urlopen, client):
        from django.core.cache import cache

        nonce1 = "nonce1"
        cache.set(f"oauth_nonce:{nonce1}", "1", 300)
        cache.set(f"lichess_pkce_{nonce1}", "verifier1", 600)

        token_resp = MagicMock()
        token_resp.read.return_value = b'{"access_token":"lip_abc","expires_in":31536000}'
        token_resp.__enter__ = lambda s: s
        token_resp.__exit__ = MagicMock(return_value=False)

        account_resp = MagicMock()
        account_resp.read.return_value = b'{"username":"nam685"}'
        account_resp.__enter__ = lambda s: s
        account_resp.__exit__ = MagicMock(return_value=False)

        mock_urlopen.side_effect = [token_resp, account_resp]
        client.get(f"/api/lichess/callback/?code=code1&state={nonce1}")

        nonce2 = "nonce2"
        cache.set(f"oauth_nonce:{nonce2}", "1", 300)
        cache.set(f"lichess_pkce_{nonce2}", "verifier2", 600)
        resp = client.get(f"/api/lichess/callback/?code=code2&state={nonce2}")
        assert resp.status_code == 302
        assert "error=" in resp["Location"]


# ── Token endpoint ───────────────────────────────────


@pytest.mark.django_db
class TestLichessTokenEndpoint:
    def test_no_token_stored(self, client, auth_headers):
        data = client.get("/api/lichess/token/", **auth_headers).json()
        assert data == {"error": "Not connected"}

    def test_returns_token(self, client, auth_headers):
        LichessToken.objects.create(
            access_token="lip_test",
            lichess_username="nam685",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        data = client.get("/api/lichess/token/", **auth_headers).json()
        assert data["access_token"] == "lip_test"
        assert data["username"] == "nam685"


# ── Status endpoint ──────────────────────────────────


@pytest.mark.django_db
class TestLichessStatus:
    def test_not_connected(self, client):
        data = client.get("/api/lichess/status/").json()
        assert data == {"connected": False, "username": None}

    def test_connected(self, client):
        LichessToken.objects.create(
            access_token="lip_test",
            lichess_username="nam685",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )
        data = client.get("/api/lichess/status/").json()
        assert data == {"connected": True, "username": "nam685"}


# ── Explorer proxy ──────────────────────────────────


EXPLORER_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
EXPLORER_JSON = b'{"opening":{"eco":"B00","name":"King Pawn"},"white":100,"draws":50,"black":50,"moves":[]}'


@pytest.mark.django_db
class TestLichessExplorer:
    def test_invalid_db(self, client):
        resp = client.get("/api/lichess/explorer/invalid/?fen=x")
        assert resp.status_code == 400

    def test_missing_fen(self, client):
        resp = client.get("/api/lichess/explorer/masters/")
        assert resp.status_code == 400

    @patch("website.views.lichess.urllib.request.urlopen")
    def test_proxies_with_token(self, mock_urlopen, client):
        LichessToken.objects.create(
            access_token="lip_proxy",
            lichess_username="nam685",
            expires_at=timezone.now() + timezone.timedelta(days=365),
        )

        mock_resp = MagicMock()
        mock_resp.read.return_value = EXPLORER_JSON
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        resp = client.get(f"/api/lichess/explorer/masters/?fen={EXPLORER_FEN}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["opening"]["eco"] == "B00"

        # Verify auth header was sent
        req_obj = mock_urlopen.call_args[0][0]
        assert req_obj.get_header("Authorization") == "Bearer lip_proxy"

    @patch("website.views.lichess.urllib.request.urlopen")
    def test_proxies_without_token(self, mock_urlopen, client):
        mock_resp = MagicMock()
        mock_resp.read.return_value = EXPLORER_JSON
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        resp = client.get(f"/api/lichess/explorer/lichess/?fen={EXPLORER_FEN}")
        assert resp.status_code == 200

        # No auth header when no token stored
        req_obj = mock_urlopen.call_args[0][0]
        assert not req_obj.has_header("Authorization")
