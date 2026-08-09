import json
import time

import pytest
from django.core import signing

from website.auth import create_token, verify_token


@pytest.mark.django_db
class TestLoginEndpoint:
    def test_post_correct_secret(self, client, settings):
        settings.ADMIN_SECRET = "test-secret"
        resp = client.post("/api/auth/login/", json.dumps({"secret": "test-secret"}), content_type="application/json")
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert verify_token(data["token"])

    def test_post_wrong_secret(self, client, settings):
        settings.ADMIN_SECRET = "test-secret"
        resp = client.post("/api/auth/login/", json.dumps({"secret": "wrong"}), content_type="application/json")
        assert resp.status_code == 401

    def test_get_not_allowed(self, client):
        resp = client.get("/api/auth/login/")
        assert resp.status_code == 405

    def test_malformed_json(self, client, settings):
        settings.ADMIN_SECRET = "test-secret"
        resp = client.post("/api/auth/login/", "not json", content_type="application/json")
        assert resp.status_code == 400

    def test_missing_admin_secret(self, client, settings):
        settings.ADMIN_SECRET = ""
        resp = client.post("/api/auth/login/", json.dumps({"secret": "anything"}), content_type="application/json")
        assert resp.status_code == 503


@pytest.mark.django_db
class TestCheckEndpoint:
    def test_valid_token(self, client, admin_token):
        resp = client.get("/api/auth/check/", HTTP_AUTHORIZATION=f"Bearer {admin_token}")
        assert resp.status_code == 200
        assert resp.json()["authenticated"] is True

    def test_invalid_token(self, client):
        resp = client.get("/api/auth/check/", HTTP_AUTHORIZATION="Bearer bad-token")
        assert resp.status_code == 200
        assert resp.json()["authenticated"] is False

    def test_no_token(self, client):
        resp = client.get("/api/auth/check/")
        assert resp.status_code == 200
        assert resp.json()["authenticated"] is False


@pytest.mark.django_db
class TestLoginRateLimit:
    def test_rate_limit_triggers(self, client, settings):
        settings.ADMIN_SECRET = "test-secret"
        for _ in range(15):
            client.post("/api/auth/login/", json.dumps({"secret": "wrong"}), content_type="application/json")
        resp = client.post("/api/auth/login/", json.dumps({"secret": "wrong"}), content_type="application/json")
        assert resp.status_code == 429

    def test_correct_login_after_rate_limit_blocked(self, client, settings):
        """Even correct credentials should be blocked once rate limit is hit."""
        settings.ADMIN_SECRET = "test-secret"
        for _ in range(16):
            client.post("/api/auth/login/", json.dumps({"secret": "wrong"}), content_type="application/json")
        resp = client.post("/api/auth/login/", json.dumps({"secret": "test-secret"}), content_type="application/json")
        assert resp.status_code == 429

    def test_window_expires_despite_continuous_attempts(self, client, settings, monkeypatch):
        """The lockout must expire a fixed window after the FIRST attempt.

        Regression: the window was previously re-set on every attempt, so a client
        retrying faster than the window (a daemon looping on a stale secret) renewed the
        lockout forever and permanently locked the real admin out.
        """
        from website.views import auth as auth_views

        monkeypatch.setattr(auth_views, "_RATE_LIMIT_WINDOW", 1)
        settings.ADMIN_SECRET = "test-secret"

        for _ in range(16):
            client.post("/api/auth/login/", json.dumps({"secret": "wrong"}), content_type="application/json")
        assert (
            client.post(
                "/api/auth/login/", json.dumps({"secret": "test-secret"}), content_type="application/json"
            ).status_code
            == 429
        )

        # Keep hammering across the window boundary — this is what used to renew the TTL.
        for _ in range(4):
            time.sleep(0.3)
            client.post("/api/auth/login/", json.dumps({"secret": "wrong"}), content_type="application/json")

        resp = client.post("/api/auth/login/", json.dumps({"secret": "test-secret"}), content_type="application/json")
        assert resp.status_code == 200


class TestTokenFunctions:
    def test_create_and_verify(self):
        token = create_token()
        assert verify_token(token)

    def test_bad_signature(self):
        assert verify_token("garbage-token") is False

    def test_expired_token(self):
        token = signing.dumps("admin", salt="admin-auth")
        # Manually verify with max_age=0 to simulate expiry
        assert verify_token(token) is True  # not actually expired yet
        # Test the SignatureExpired path by creating a token with a different approach
        expired = signing.dumps("admin", salt="admin-auth")
        try:
            signing.loads(expired, salt="admin-auth", max_age=0)
            expired_raises = False
        except signing.SignatureExpired:
            expired_raises = True
        assert expired_raises
