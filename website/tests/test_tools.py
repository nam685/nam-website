import json
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.utils import timezone

from website.models import TrackedTool


def _make_tool(**kwargs):
    defaults = {
        "name": "herdr",
        "url": "https://herdr.dev",
        "category": "personal-agent-runtimes",
        "source": "manual",
        "source_key": "https://herdr.dev",
        "status": "watching",
        "is_new": False,
    }
    defaults.update(kwargs)
    return TrackedTool.objects.create(**defaults)


@pytest.mark.django_db
class TestTrackedToolModel:
    def test_defaults(self):
        t = _make_tool()
        assert t.status == "watching"
        assert t.is_new is False
        assert str(t) == "herdr"

    def test_source_key_unique(self):
        _make_tool()
        with pytest.raises(Exception):
            _make_tool(name="herdr again")


@pytest.mark.django_db
class TestToolListEndpoint:
    def test_public_no_auth_required(self, client):
        _make_tool()
        resp = client.get("/api/tools/")
        assert resp.status_code == 200

    def test_includes_dropped_tools(self, client):
        _make_tool(status="dropped", notes="superseded by X")
        data = client.get("/api/tools/").json()
        assert len(data) == 1
        assert data[0]["status"] == "dropped"
        assert data[0]["notes"] == "superseded by X"

    def test_serializes_expected_fields(self, client):
        _make_tool()
        data = client.get("/api/tools/").json()[0]
        for key in [
            "id",
            "name",
            "url",
            "description",
            "category",
            "status",
            "is_new",
            "source",
            "notes",
            "stars",
            "added_at",
            "last_reviewed_at",
            "is_stale",
        ]:
            assert key in data

    def test_stale_flag_false_when_recent(self, client):
        _make_tool()
        data = client.get("/api/tools/").json()[0]
        assert data["is_stale"] is False

    def test_stale_flag_true_past_threshold(self, client):
        t = _make_tool()
        TrackedTool.objects.filter(pk=t.pk).update(last_reviewed_at=timezone.now() - timedelta(days=91))
        data = client.get("/api/tools/").json()[0]
        assert data["is_stale"] is True

    def test_dropped_tools_never_stale(self, client):
        t = _make_tool(status="dropped", notes="nope")
        TrackedTool.objects.filter(pk=t.pk).update(last_reviewed_at=timezone.now() - timedelta(days=200))
        data = client.get("/api/tools/").json()[0]
        assert data["is_stale"] is False


@pytest.mark.django_db
class TestToolCreateEndpoint:
    def test_requires_auth(self, client):
        resp = client.post("/api/tools/create/", content_type="application/json", data=json.dumps({}))
        assert resp.status_code == 401

    def test_creates_manual_entry(self, client, auth_headers):
        resp = client.post(
            "/api/tools/create/",
            content_type="application/json",
            data=json.dumps({"name": "herdr", "url": "https://herdr.dev", "notes": "coworker rec"}),
            **auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "herdr"
        assert data["source"] == "manual"
        assert data["is_new"] is False
        assert data["status"] == "watching"

    def test_requires_name_and_url(self, client, auth_headers):
        resp = client.post(
            "/api/tools/create/",
            content_type="application/json",
            data=json.dumps({"name": "herdr"}),
            **auth_headers,
        )
        assert resp.status_code == 400

    def test_rejects_duplicate_url(self, client, auth_headers):
        _make_tool()
        resp = client.post(
            "/api/tools/create/",
            content_type="application/json",
            data=json.dumps({"name": "herdr", "url": "https://herdr.dev"}),
            **auth_headers,
        )
        assert resp.status_code == 400


@pytest.mark.django_db
class TestToolUpdateEndpoint:
    def test_requires_auth(self, client):
        t = _make_tool()
        resp = client.post(f"/api/tools/{t.id}/update/", content_type="application/json", data=json.dumps({}))
        assert resp.status_code == 401

    def test_not_found(self, client, auth_headers):
        resp = client.post(
            "/api/tools/999/update/", content_type="application/json", data=json.dumps({}), **auth_headers
        )
        assert resp.status_code == 404

    def test_adopt(self, client, auth_headers):
        t = _make_tool()
        resp = client.post(
            f"/api/tools/{t.id}/update/",
            content_type="application/json",
            data=json.dumps({"status": "adopted"}),
            **auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "adopted"

    def test_drop_requires_reason(self, client, auth_headers):
        t = _make_tool()
        resp = client.post(
            f"/api/tools/{t.id}/update/",
            content_type="application/json",
            data=json.dumps({"status": "dropped"}),
            **auth_headers,
        )
        assert resp.status_code == 400

    def test_drop_with_reason(self, client, auth_headers):
        t = _make_tool()
        resp = client.post(
            f"/api/tools/{t.id}/update/",
            content_type="application/json",
            data=json.dumps({"status": "dropped", "notes": "too niche"}),
            **auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "dropped"
        assert data["notes"] == "too niche"

    def test_invalid_status_rejected(self, client, auth_headers):
        t = _make_tool()
        resp = client.post(
            f"/api/tools/{t.id}/update/",
            content_type="application/json",
            data=json.dumps({"status": "bogus"}),
            **auth_headers,
        )
        assert resp.status_code == 400

    def test_touching_clears_is_new(self, client, auth_headers):
        t = _make_tool(is_new=True)
        client.post(f"/api/tools/{t.id}/update/", content_type="application/json", data=json.dumps({}), **auth_headers)
        t.refresh_from_db()
        assert t.is_new is False

    def test_mark_reviewed_bumps_timestamp(self, client, auth_headers):
        t = _make_tool()
        TrackedTool.objects.filter(pk=t.pk).update(last_reviewed_at=timezone.now() - timedelta(days=200))
        client.post(
            f"/api/tools/{t.id}/update/",
            content_type="application/json",
            data=json.dumps({"mark_reviewed": True}),
            **auth_headers,
        )
        t.refresh_from_db()
        assert (timezone.now() - t.last_reviewed_at) < timedelta(minutes=1)


@pytest.mark.django_db
class TestToolDeleteEndpoint:
    def test_requires_auth(self, client):
        t = _make_tool()
        resp = client.post(f"/api/tools/{t.id}/delete/")
        assert resp.status_code == 401

    def test_deletes(self, client, auth_headers):
        t = _make_tool()
        resp = client.post(f"/api/tools/{t.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        assert not TrackedTool.objects.filter(pk=t.id).exists()

    def test_not_found(self, client, auth_headers):
        resp = client.post("/api/tools/999/delete/", **auth_headers)
        assert resp.status_code == 404


FAKE_FEED = [
    {
        "github_id": "someorg/herdr",
        "name": "herdr",
        "url": "https://github.com/someorg/herdr",
        "description": "terminal multiplexer for agents",
        "category": "personal-agent-runtimes",
        "stars": 100,
    },
    {
        "github_id": "someorg/other-tool",
        "name": "other-tool",
        "url": "https://github.com/someorg/other-tool",
        "description": "",
        "category": "coding-harness-configs",
        "stars": 5,
    },
]


@pytest.mark.django_db
class TestToolSyncEndpoint:
    @patch("website.views.tools.fetch_harnesses")
    def test_requires_auth(self, mock_fetch, client):
        resp = client.post("/api/tools/sync/")
        assert resp.status_code == 401
        mock_fetch.assert_not_called()

    @patch("website.views.tools.fetch_harnesses")
    def test_creates_new_tools(self, mock_fetch, client, auth_headers):
        mock_fetch.return_value = FAKE_FEED
        resp = client.post("/api/tools/sync/", **auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"fetched": 2, "created": 2, "updated": 0}
        assert TrackedTool.objects.count() == 2
        herdr = TrackedTool.objects.get(source_key="someorg/herdr")
        assert herdr.status == "watching"
        assert herdr.is_new is True
        assert herdr.source == "feed:best-of-agent-harnesses"

    @patch("website.views.tools.fetch_harnesses")
    def test_resync_updates_stars_without_clobbering_triage(self, mock_fetch, client, auth_headers):
        mock_fetch.return_value = FAKE_FEED
        client.post("/api/tools/sync/", **auth_headers)

        herdr = TrackedTool.objects.get(source_key="someorg/herdr")
        herdr.status = "adopted"
        herdr.notes = "using this daily"
        herdr.is_new = False
        herdr.save()

        updated_feed = [dict(FAKE_FEED[0], stars=9999), FAKE_FEED[1]]
        mock_fetch.return_value = updated_feed
        resp = client.post("/api/tools/sync/", **auth_headers)
        assert resp.json() == {"fetched": 2, "created": 0, "updated": 2}

        herdr.refresh_from_db()
        assert herdr.stars == 9999
        assert herdr.status == "adopted"
        assert herdr.notes == "using this daily"
        assert herdr.is_new is False

    @patch("website.views.tools.fetch_harnesses")
    def test_sync_failure_returns_502_and_records_error(self, mock_fetch, client, auth_headers):
        mock_fetch.side_effect = RuntimeError("feed unreachable")
        resp = client.post("/api/tools/sync/", **auth_headers)
        assert resp.status_code == 502

        status = json.loads(cache.get("tools:sync_status"))
        assert status["error"] == "feed unreachable"


@pytest.mark.django_db
class TestToolSyncStatusEndpoint:
    def test_requires_auth(self, client):
        resp = client.get("/api/tools/sync-status/")
        assert resp.status_code == 401

    def test_returns_empty_when_never_synced(self, client, auth_headers):
        data = client.get("/api/tools/sync-status/", **auth_headers).json()
        assert data["last_sync"] is None

    def test_returns_status_after_sync(self, client, auth_headers):
        cache.set("tools:sync_status", json.dumps({"last_sync": "2026-07-26T06:00:00", "error": None}))
        data = client.get("/api/tools/sync-status/", **auth_headers).json()
        assert data["last_sync"] == "2026-07-26T06:00:00"
        assert data["error"] is None
