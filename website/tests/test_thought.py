import json
from datetime import timedelta

import pytest
from django.utils import timezone

from website.models import Thought


@pytest.fixture(autouse=True)
def _clear_seeded_thoughts():
    """Remove seeded thoughts from data migrations so tests start clean."""
    Thought.objects.all().delete()


@pytest.mark.django_db
class TestThoughtList:
    def test_empty_list(self, client):
        resp = client.get("/api/thoughts/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["thoughts"] == []

    def test_returns_published_only(self, client):
        Thought.objects.create(content="visible", is_published=True)
        Thought.objects.create(content="hidden", is_published=False)
        resp = client.get("/api/thoughts/")
        data = resp.json()
        assert len(data["thoughts"]) == 1
        assert data["thoughts"][0]["content"] == "visible"

    def test_pagination(self, client):
        for i in range(15):
            Thought.objects.create(content=f"thought {i}")
        resp = client.get("/api/thoughts/?page=1")
        data = resp.json()
        assert len(data["thoughts"]) == 10
        assert data["has_next"] is True


@pytest.mark.django_db
class TestThoughtCreate:
    def test_requires_auth(self, client):
        resp = client.post(
            "/api/thoughts/create/",
            json.dumps({"content": "hello"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_create_valid(self, client, auth_headers):
        resp = client.post(
            "/api/thoughts/create/",
            json.dumps({"content": "A new thought"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 201
        assert Thought.objects.count() == 1

    def test_empty_content(self, client, auth_headers):
        resp = client.post(
            "/api/thoughts/create/",
            json.dumps({"content": ""}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 400

    def test_too_long(self, client, auth_headers):
        resp = client.post(
            "/api/thoughts/create/",
            json.dumps({"content": "x" * 2001}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 400

    def test_cooldown_enforced(self, client, auth_headers):
        Thought.objects.create(content="recent", created_at=timezone.now())
        resp = client.post(
            "/api/thoughts/create/",
            json.dumps({"content": "too soon"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 429

    def test_cooldown_expired(self, client, auth_headers):
        old_time = timezone.now() - timedelta(hours=19)
        t = Thought.objects.create(content="old")
        Thought.objects.filter(pk=t.pk).update(created_at=old_time)
        resp = client.post(
            "/api/thoughts/create/",
            json.dumps({"content": "after cooldown"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 201
