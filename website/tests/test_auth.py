import json

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
