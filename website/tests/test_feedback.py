import json
from datetime import timedelta

import pytest
from django.utils import timezone

from website.models import Feedback


@pytest.mark.django_db
class TestFeedbackCreate:
    def test_get_not_allowed(self, client):
        resp = client.get("/api/feedback/")
        assert resp.status_code == 405

    def test_create_valid(self, client):
        resp = client.post(
            "/api/feedback/",
            json.dumps({"message": "Great site!"}),
            content_type="application/json",
        )
        assert resp.status_code == 201
        assert Feedback.objects.count() == 1

    def test_empty_message(self, client):
        resp = client.post(
            "/api/feedback/",
            json.dumps({"message": ""}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_too_long(self, client):
        resp = client.post(
            "/api/feedback/",
            json.dumps({"message": "x" * 2001}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_malformed_json(self, client):
        resp = client.post("/api/feedback/", "not json", content_type="application/json")
        assert resp.status_code == 400

    def test_rate_limit(self, client):
        # First request should succeed
        resp = client.post(
            "/api/feedback/",
            json.dumps({"message": "First"}),
            content_type="application/json",
        )
        assert resp.status_code == 201

        # Second request from same IP within 1 hour should be rate limited
        resp = client.post(
            "/api/feedback/",
            json.dumps({"message": "Second"}),
            content_type="application/json",
        )
        assert resp.status_code == 429

    def test_rate_limit_expired(self, client):
        # Create old feedback (>1h ago)
        fb = Feedback.objects.create(message="old", ip_address="127.0.0.1")
        Feedback.objects.filter(pk=fb.pk).update(created_at=timezone.now() - timedelta(hours=2))

        resp = client.post(
            "/api/feedback/",
            json.dumps({"message": "After cooldown"}),
            content_type="application/json",
        )
        assert resp.status_code == 201
