import io
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image as PILImage

from website.models import Thought


@pytest.fixture(autouse=True)
def _clear_seeded_thoughts():
    Thought.objects.all().delete()


def _png(size=(10, 10)):
    buf = io.BytesIO()
    PILImage.new("RGB", size, (200, 30, 60)).save(buf, "PNG")
    return SimpleUploadedFile("x.png", buf.getvalue(), content_type="image/png")


@pytest.mark.django_db
class TestThoughtList:
    def test_empty_list(self, client):
        resp = client.get("/api/thoughts/")
        assert resp.status_code == 200
        assert resp.json()["thoughts"] == []

    def test_returns_published_only(self, client):
        Thought.objects.create(content="visible", is_published=True)
        Thought.objects.create(content="hidden", is_published=False)
        data = client.get("/api/thoughts/").json()
        assert len(data["thoughts"]) == 1
        assert data["thoughts"][0]["content"] == "visible"
        assert data["thoughts"][0]["image"] is None

    def test_includes_image_url(self, client):
        Thought.objects.create(content="", image=_png())
        item = client.get("/api/thoughts/").json()["thoughts"][0]
        assert item["image"] is not None
        assert item["image"].endswith(".png")

    def test_pagination(self, client):
        for i in range(15):
            Thought.objects.create(content=f"thought {i}")
        data = client.get("/api/thoughts/?page=1").json()
        assert len(data["thoughts"]) == 10
        assert data["has_next"] is True


@pytest.mark.django_db
class TestThoughtCreate:
    def test_requires_auth(self, client):
        resp = client.post("/api/thoughts/create/", {"content": "hello"})
        assert resp.status_code == 401

    def test_create_text_only(self, client, auth_headers):
        resp = client.post("/api/thoughts/create/", {"content": "A new thought"}, **auth_headers)
        assert resp.status_code == 201
        assert resp.json()["image"] is None
        assert Thought.objects.count() == 1

    def test_create_image_only(self, client, auth_headers):
        resp = client.post("/api/thoughts/create/", {"image": _png()}, **auth_headers)
        assert resp.status_code == 201
        assert resp.json()["image"] is not None
        assert Thought.objects.get().content == ""

    def test_create_text_and_image(self, client, auth_headers):
        resp = client.post("/api/thoughts/create/", {"content": "look", "image": _png()}, **auth_headers)
        assert resp.status_code == 201
        body = resp.json()
        assert body["content"] == "look"
        assert body["image"] is not None

    def test_empty_post_rejected(self, client, auth_headers):
        resp = client.post("/api/thoughts/create/", {"content": "   "}, **auth_headers)
        assert resp.status_code == 400

    def test_too_long(self, client, auth_headers):
        resp = client.post("/api/thoughts/create/", {"content": "x" * 2001}, **auth_headers)
        assert resp.status_code == 400

    def test_bad_image_rejected(self, client, auth_headers):
        bad = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
        resp = client.post("/api/thoughts/create/", {"image": bad}, **auth_headers)
        assert resp.status_code == 400

    def test_cooldown_enforced(self, client, auth_headers):
        Thought.objects.create(content="recent", created_at=timezone.now())
        resp = client.post("/api/thoughts/create/", {"content": "too soon"}, **auth_headers)
        assert resp.status_code == 429

    def test_cooldown_expired(self, client, auth_headers):
        t = Thought.objects.create(content="old")
        Thought.objects.filter(pk=t.pk).update(created_at=timezone.now() - timedelta(hours=19))
        resp = client.post("/api/thoughts/create/", {"content": "after cooldown"}, **auth_headers)
        assert resp.status_code == 201


@pytest.mark.django_db
class TestThoughtDelete:
    def test_requires_auth(self, client):
        t = Thought.objects.create(content="x")
        resp = client.post(f"/api/thoughts/{t.id}/delete/")
        assert resp.status_code == 401

    def test_delete_removes_row(self, client, auth_headers):
        t = Thought.objects.create(content="bye", image=_png())
        resp = client.post(f"/api/thoughts/{t.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        assert Thought.objects.count() == 0

    def test_delete_missing(self, client, auth_headers):
        resp = client.post("/api/thoughts/9999/delete/", **auth_headers)
        assert resp.status_code == 404
