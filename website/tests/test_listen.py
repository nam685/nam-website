import json
from unittest.mock import MagicMock, patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from website.models import ListenTrack
from website.views import listen


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    listen._last_sync = 0
    yield
    listen._last_sync = 0


@pytest.fixture()
def sample_tracks(db):  # noqa: ARG001
    now = timezone.now()
    return [
        ListenTrack.objects.create(
            video_id=f"vid_{i}",
            title=f"Track {i}",
            artist=f"Artist {i}",
            album=f"Album {i}",
            thumbnail_url=f"https://img.youtube.com/vi/vid_{i}/0.jpg",
            duration="3:42",
            played_at=now - timezone.timedelta(minutes=i * 10),
        )
        for i in range(5)
    ]


TAKEOUT_SAMPLE = [
    {
        "header": "YouTube Music",
        "title": "Watched Cool Song",
        "titleUrl": "https://www.youtube.com/watch?v=takeout1",
        "subtitles": [{"name": "Cool Artist", "url": "https://youtube.com/channel/123"}],
        "time": "2024-06-15T10:30:00.000Z",
        "products": ["YouTube Music"],
    },
    {
        "header": "YouTube Music",
        "title": "Watched Another Track",
        "titleUrl": "https://www.youtube.com/watch?v=takeout2",
        "subtitles": [{"name": "Another Artist"}],
        "time": "2024-06-14T08:00:00.000Z",
        "products": ["YouTube Music"],
    },
    {
        "header": "YouTube",
        "title": "Watched Some Video",
        "titleUrl": "https://www.youtube.com/watch?v=nomusic",
        "subtitles": [{"name": "Youtuber"}],
        "time": "2024-06-13T12:00:00.000Z",
        "products": ["YouTube"],
    },
]

MOCK_HISTORY = [
    {
        "videoId": "abc123",
        "title": "Test Song",
        "artists": [{"name": "Test Artist"}],
        "album": {"name": "Test Album"},
        "thumbnails": [{"url": "https://lh3.googleusercontent.com/large", "width": 226}],
        "duration": "3:42",
    },
    {
        "videoId": "def456",
        "title": "Another Song",
        "artists": [{"name": "Artist A"}, {"name": "Artist B"}],
        "album": None,
        "thumbnails": [],
        "duration": "4:15",
    },
]


# ── Auth guard ────────────────────────────────────────


@pytest.mark.django_db
class TestAuthRequired:
    def test_list_is_public(self, client):
        """List endpoint is now public — no auth required."""
        assert client.get("/api/listens/").status_code == 200

    def test_stats_is_public(self, client):
        """Stats endpoint is now public — no auth required."""
        assert client.get("/api/listens/stats/").status_code == 200

    def test_sync_status_requires_auth(self, client):
        assert client.get("/api/listens/sync-status/").status_code == 401

    def test_sync_requires_auth(self, client):
        assert client.post("/api/listens/sync/").status_code == 401


# ── List endpoint ─────────────────────────────────────


@pytest.mark.django_db
class TestListenList:
    def test_empty(self, client, auth_headers):
        data = client.get("/api/listens/", **auth_headers).json()
        assert data["tracks"] == []
        assert data["total"] == 0

    def test_returns_tracks_ordered(self, client, auth_headers, sample_tracks):  # noqa: ARG002
        data = client.get("/api/listens/", **auth_headers).json()
        assert len(data["tracks"]) == 5
        assert data["tracks"][0]["video_id"] == "vid_0"

    def test_pagination(self, client, auth_headers, sample_tracks):  # noqa: ARG002
        data = client.get("/api/listens/?limit=2&offset=2", **auth_headers).json()
        assert len(data["tracks"]) == 2
        assert data["total"] == 5


# ── Stats endpoint ────────────────────────────────────


@pytest.mark.django_db
class TestListenStats:
    def test_empty_stats(self, client, auth_headers):
        data = client.get("/api/listens/stats/", **auth_headers).json()
        assert data["today"] == 0
        assert data["total"] == 0
        assert data["top_tracks"] == []

    def test_stats_with_tracks(self, client, auth_headers, sample_tracks):  # noqa: ARG002
        data = client.get("/api/listens/stats/", **auth_headers).json()
        assert data["total"] == 5
        assert isinstance(data["top_tracks"], list)
        assert isinstance(data["daily"], list)


# ── Sync endpoint (browser auth) ─────────────────────

FAKE_BROWSER_JSON = json.dumps({"cookie": "SAPISID=abc; __Secure-3PAPISID=abc", "origin": "https://music.youtube.com"})


def _mock_open_browser():
    """Return a mock for builtins.open that returns fake browser.json content."""
    from unittest.mock import mock_open

    return mock_open(read_data=FAKE_BROWSER_JSON)


@pytest.mark.django_db
class TestListenSync:
    def test_get_not_allowed(self, client, auth_headers):
        resp = client.get("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 405

    @patch("os.path.isfile", return_value=False)
    def test_missing_browser_json(self, _mock_isfile, client, auth_headers):
        resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 500
        assert "Browser auth not configured" in resp.json()["error"]

    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_syncs_tracks(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        mock_yt = MagicMock()
        mock_yt.get_history.return_value = MOCK_HISTORY
        mock_ytmusic_cls.return_value = mock_yt

        with patch("builtins.open", _mock_open_browser()):
            resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 200
        assert resp.json()["synced"] == 2
        assert ListenTrack.objects.count() == 2
        assert ListenTrack.objects.get(video_id="abc123").artist == "Test Artist"
        assert ListenTrack.objects.get(video_id="def456").artist == "Artist A, Artist B"

    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_deduplicates(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        ListenTrack.objects.create(video_id="abc123", title="Old", artist="Old", played_at=timezone.now())

        mock_yt = MagicMock()
        mock_yt.get_history.return_value = MOCK_HISTORY
        mock_ytmusic_cls.return_value = mock_yt

        with patch("builtins.open", _mock_open_browser()):
            resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.json()["synced"] == 1
        assert ListenTrack.objects.count() == 2

    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_rate_limited(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        mock_yt = MagicMock()
        mock_yt.get_history.return_value = []
        mock_ytmusic_cls.return_value = mock_yt

        with patch("builtins.open", _mock_open_browser()):
            client.post("/api/listens/sync/", **auth_headers)
        resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 429
        assert "Rate limited" in resp.json()["error"]

    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_ytmusic_error(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        mock_ytmusic_cls.side_effect = Exception("Auth failed")
        with patch("builtins.open", _mock_open_browser()):
            resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 502

    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_filters_view_counts_from_artist(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        mock_yt = MagicMock()
        mock_yt.get_history.return_value = [
            {
                "videoId": "grissini1",
                "title": "Some Song",
                "artists": [{"name": "Grissini Project"}, {"name": "89M views"}],
                "album": {"name": "Album"},
                "thumbnails": [{"url": "https://example.com/thumb.jpg", "width": 226}],
                "duration": "3:00",
            },
            {
                "videoId": "grissini2",
                "title": "Another Song",
                "artists": [{"name": "Grissini Project"}, {"name": "1.9M views"}],
                "album": None,
                "thumbnails": [],
                "duration": "4:00",
            },
        ]
        mock_ytmusic_cls.return_value = mock_yt

        with patch("builtins.open", _mock_open_browser()):
            resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 200
        assert resp.json()["synced"] == 2
        assert ListenTrack.objects.get(video_id="grissini1").artist == "Grissini Project"
        assert ListenTrack.objects.get(video_id="grissini2").artist == "Grissini Project"


# ── Sync status ───────────────────────────────────────


@pytest.mark.django_db
class TestSyncStatus:
    def test_sync_available(self, client, auth_headers):
        data = client.get("/api/listens/sync-status/", **auth_headers).json()
        assert data["available"] is True
        assert data["cooldown_remaining"] == 0


@pytest.mark.django_db
class TestListenImport:
    def test_requires_auth(self, client):
        resp = client.post("/api/listens/import/")
        assert resp.status_code == 401

    def test_imports_takeout(self, client, auth_headers):
        data = json.dumps(TAKEOUT_SAMPLE).encode()
        file = SimpleUploadedFile("watch-history.json", data, content_type="application/json")
        resp = client.post("/api/listens/import/", {"file": file}, **auth_headers)
        assert resp.status_code == 200
        result = resp.json()
        assert result["imported"] == 2  # only YouTube Music entries
        assert result["skipped"] == 0
        assert ListenTrack.objects.count() == 2
        t = ListenTrack.objects.get(video_id="takeout1")
        assert t.title == "Cool Song"
        assert t.artist == "Cool Artist"
        assert "nomusic" not in ListenTrack.objects.values_list("video_id", flat=True)

    def test_deduplicates(self, client, auth_headers):
        from django.utils.dateparse import parse_datetime

        ListenTrack.objects.create(
            video_id="takeout1",
            title="Cool Song",
            artist="Cool Artist",
            played_at=parse_datetime("2024-06-15T10:30:00+00:00"),
        )
        data = json.dumps(TAKEOUT_SAMPLE).encode()
        file = SimpleUploadedFile("watch-history.json", data, content_type="application/json")
        resp = client.post("/api/listens/import/", {"file": file}, **auth_headers)
        result = resp.json()
        assert result["imported"] == 1
        assert result["skipped"] == 1
        assert ListenTrack.objects.count() == 2

    def test_no_file(self, client, auth_headers):
        resp = client.post("/api/listens/import/", **auth_headers)
        assert resp.status_code == 400
