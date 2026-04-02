from unittest.mock import MagicMock, patch

import pytest
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
    def test_list_requires_auth(self, client):
        assert client.get("/api/listens/").status_code == 401

    def test_stats_requires_auth(self, client):
        assert client.get("/api/listens/stats/").status_code == 401

    def test_sync_status_requires_auth(self, client):
        assert client.get("/api/listens/sync-status/").status_code == 401

    def test_sync_requires_auth(self, client):
        assert client.post("/api/listens/sync/").status_code == 401

    def test_bad_token_rejected(self, client):
        assert client.get("/api/listens/", HTTP_AUTHORIZATION="Bearer bad").status_code == 401


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


# ── Sync endpoint ─────────────────────────────────────


@pytest.mark.django_db
class TestListenSync:
    def test_not_configured(self, client, auth_headers):
        with patch("website.views.listen.os.path.exists", return_value=False):
            resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 500
        assert "not configured" in resp.json()["error"].lower()

    @patch("website.views.listen.os.path.exists", return_value=True)
    def test_syncs_tracks(self, _mock_exists, client, auth_headers):
        with patch("ytmusicapi.YTMusic") as mock_ytm_cls:
            mock_yt = MagicMock()
            mock_yt.get_history.return_value = MOCK_HISTORY
            mock_ytm_cls.return_value = mock_yt
            resp = client.post("/api/listens/sync/", **auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["new_tracks"] == 2
        assert ListenTrack.objects.count() == 2
        assert ListenTrack.objects.get(video_id="abc123").artist == "Test Artist"

    @patch("website.views.listen.os.path.exists", return_value=True)
    def test_deduplicates(self, _mock_exists, client, auth_headers):
        ListenTrack.objects.create(video_id="abc123", title="Old", artist="Old", played_at=timezone.now())

        with patch("ytmusicapi.YTMusic") as mock_ytm_cls:
            mock_yt = MagicMock()
            mock_yt.get_history.return_value = MOCK_HISTORY
            mock_ytm_cls.return_value = mock_yt
            resp = client.post("/api/listens/sync/", **auth_headers)

        assert resp.status_code == 200
        assert resp.json()["new_tracks"] == 1
        assert ListenTrack.objects.count() == 2

    @patch("website.views.listen.os.path.exists", return_value=True)
    def test_rate_limited(self, _mock_exists, client, auth_headers):
        with patch("ytmusicapi.YTMusic") as mock_ytm_cls:
            mock_yt = MagicMock()
            mock_yt.get_history.return_value = []
            mock_ytm_cls.return_value = mock_yt
            client.post("/api/listens/sync/", **auth_headers)

        resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 429

    @patch("website.views.listen.os.path.exists", return_value=True)
    def test_ytm_error(self, _mock_exists, client, auth_headers):
        with patch("ytmusicapi.YTMusic") as mock_ytm_cls:
            mock_ytm_cls.side_effect = Exception("YTM error")
            resp = client.post("/api/listens/sync/", **auth_headers)

        assert resp.status_code == 500
        assert "failed" in resp.json()["error"].lower()


# ── Sync status ───────────────────────────────────────


@pytest.mark.django_db
class TestSyncStatus:
    def test_sync_available(self, client, auth_headers):
        data = client.get("/api/listens/sync-status/", **auth_headers).json()
        assert data["available"] is True
        assert data["cooldown_remaining"] == 0
