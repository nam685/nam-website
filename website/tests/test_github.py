from unittest.mock import MagicMock, patch

import pytest
from django.core.cache import cache

from website.models import GitHubContributions
from website.views import github as github_views


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    cache.delete(github_views._SYNC_KEY)
    yield
    cache.delete(github_views._SYNC_KEY)


# ── Contributions (public) ──────────────────────────


@pytest.mark.django_db
class TestContributions:
    def test_no_data(self, client):
        data = client.get("/api/github/contributions/").json()
        assert data == {"contributions": None}

    def test_returns_stored_data(self, client):
        GitHubContributions.objects.create(data={"totalContributions": 42, "weeks": []})
        resp = client.get("/api/github/contributions/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["contributions"]["totalContributions"] == 42
        assert "updated_at" in data


# ── Auth guard ──────────────────────────────────────


@pytest.mark.django_db
class TestGitHubAuthGuard:
    def test_auth_requires_nonce(self, client):
        resp = client.get("/api/github/auth/")
        assert resp.status_code == 401

    def test_auth_rejects_bad_nonce(self, client):
        resp = client.get("/api/github/auth/?nonce=bad")
        assert resp.status_code == 401

    def test_refresh_status_requires_auth(self, client):
        resp = client.get("/api/github/refresh-status/")
        assert resp.status_code == 401


# ── Auth redirect ───────────────────────────────────


@pytest.mark.django_db
class TestGitHubAuth:
    def test_missing_client_id(self, client):
        from website.utils import create_admin_nonce

        nonce = create_admin_nonce()
        resp = client.get(f"/api/github/auth/?nonce={nonce}")
        assert resp.status_code == 500

    @patch.dict("os.environ", {"GITHUB_CLIENT_ID": "test-client-id"})
    def test_redirects_to_github(self, client):
        from website.utils import create_admin_nonce

        nonce = create_admin_nonce()
        resp = client.get(f"/api/github/auth/?nonce={nonce}")
        assert resp.status_code == 302
        location = resp["Location"]
        assert "github.com/login/oauth" in location
        assert "test-client-id" in location
        assert "state=" in location


# ── Callback ────────────────────────────────────────


@pytest.mark.django_db
class TestGitHubCallback:
    def test_missing_code(self, client):
        resp = client.get("/api/github/callback/")
        assert resp.status_code == 400

    def test_bad_state(self, client):
        resp = client.get("/api/github/callback/?code=test&state=bad-nonce")
        assert resp.status_code == 401

    @patch("website.views.github.urllib.request.urlopen")
    def test_exchanges_token_and_stores_contributions(self, mock_urlopen, client):
        nonce = "nonce123"
        cache.set(f"oauth_nonce:{nonce}", "1", 300)

        token_resp = MagicMock()
        token_resp.read.return_value = b'{"access_token":"gho_abc123"}'
        token_resp.__enter__ = lambda s: s
        token_resp.__exit__ = MagicMock(return_value=False)

        gql_resp = MagicMock()
        gql_resp.read.return_value = b"""{
            "data": {
                "user": {
                    "contributionsCollection": {
                        "contributionCalendar": {
                            "totalContributions": 100,
                            "weeks": []
                        }
                    },
                    "repositories": {
                        "nodes": [
                            {"name": "test-repo", "url": "https://github.com/nam685/test-repo", "pushedAt": "2026-01-01T00:00:00Z"}
                        ]
                    }
                }
            }
        }"""
        gql_resp.__enter__ = lambda s: s
        gql_resp.__exit__ = MagicMock(return_value=False)

        mock_urlopen.side_effect = [token_resp, gql_resp]

        resp = client.get(f"/api/github/callback/?code=authcode&state={nonce}")
        assert resp.status_code == 302
        assert resp["Location"] == "/codes"

        record = GitHubContributions.objects.first()
        assert record is not None
        assert record.data["totalContributions"] == 100
        assert "repositoryDates" in record.data

    @patch("website.views.github.urllib.request.urlopen")
    def test_rate_limited(self, mock_urlopen, client):
        # First request succeeds
        nonce1 = "nonce1"
        cache.set(f"oauth_nonce:{nonce1}", "1", 300)

        token_resp = MagicMock()
        token_resp.read.return_value = b'{"access_token":"gho_abc"}'
        token_resp.__enter__ = lambda s: s
        token_resp.__exit__ = MagicMock(return_value=False)

        gql_resp = MagicMock()
        gql_resp.read.return_value = b'{"data":{"user":{"contributionsCollection":{"contributionCalendar":{"totalContributions":1,"weeks":[]}},"repositories":{"nodes":[]}}}}'
        gql_resp.__enter__ = lambda s: s
        gql_resp.__exit__ = MagicMock(return_value=False)

        mock_urlopen.side_effect = [token_resp, gql_resp]
        client.get(f"/api/github/callback/?code=code1&state={nonce1}")

        # Second request is rate limited
        nonce2 = "nonce2"
        cache.set(f"oauth_nonce:{nonce2}", "1", 300)
        resp = client.get(f"/api/github/callback/?code=code2&state={nonce2}")
        assert resp.status_code == 429

    @patch("website.views.github.urllib.request.urlopen")
    def test_token_exchange_failure(self, mock_urlopen, client):
        nonce = "nonce_fail"
        cache.set(f"oauth_nonce:{nonce}", "1", 300)

        mock_urlopen.side_effect = Exception("connection refused")

        resp = client.get(f"/api/github/callback/?code=bad&state={nonce}")
        assert resp.status_code == 502

    @patch("website.views.github.urllib.request.urlopen")
    def test_no_access_token_in_response(self, mock_urlopen, client):
        nonce = "nonce_notoken"
        cache.set(f"oauth_nonce:{nonce}", "1", 300)

        token_resp = MagicMock()
        token_resp.read.return_value = b'{"error":"bad_verification_code"}'
        token_resp.__enter__ = lambda s: s
        token_resp.__exit__ = MagicMock(return_value=False)

        mock_urlopen.return_value = token_resp

        resp = client.get(f"/api/github/callback/?code=bad&state={nonce}")
        assert resp.status_code == 502


# ── Refresh status ──────────────────────────────────


@pytest.mark.django_db
class TestRefreshStatus:
    def test_no_contributions(self, client, auth_headers):
        data = client.get("/api/github/refresh-status/", **auth_headers).json()
        assert data["available"] is True
        assert data["last_updated"] is None

    def test_with_contributions(self, client, auth_headers):
        GitHubContributions.objects.create(data={"totalContributions": 10})
        data = client.get("/api/github/refresh-status/", **auth_headers).json()
        assert data["available"] is True
        assert data["last_updated"] is not None
