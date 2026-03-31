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

    @patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "test-id"})
    def test_auth_requires_token(self, client):
        assert client.get("/api/listens/auth/").status_code == 401

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


# ── OAuth auth endpoint ───────────────────────────────


@pytest.mark.django_db
class TestListenAuth:
    def test_no_google_client_id(self, client, admin_token):
        with patch.dict("os.environ", {"GOOGLE_CLIENT_ID": ""}, clear=False):
            resp = client.get(f"/api/listens/auth/?token={admin_token}")
            assert resp.status_code == 500

    @patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "test-client-id"})
    def test_redirects_to_google(self, client, admin_token):
        resp = client.get(f"/api/listens/auth/?token={admin_token}")
        assert resp.status_code == 302
        assert "accounts.google.com" in resp["Location"]
        assert "test-client-id" in resp["Location"]
        assert "youtube.readonly" in resp["Location"]


# ── OAuth callback ────────────────────────────────────


@pytest.mark.django_db
class TestListenCallback:
    def test_callback_missing_code(self, client):
        resp = client.get("/api/listens/callback/")
        assert resp.status_code == 400

    def test_callback_bad_state(self, client):
        resp = client.get("/api/listens/callback/?code=test&state=bad")
        assert resp.status_code == 401

    def test_callback_error_redirects(self, client):
        resp = client.get("/api/listens/callback/?error=access_denied")
        assert resp.status_code == 302
        assert "/listens?error=" in resp["Location"]

    @patch("website.views.listen.urllib.request.urlopen")
    def test_callback_syncs_tracks(self, mock_urlopen, client, admin_token):
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"access_token":"fake","expires_in":3600}'
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        with (
            patch("website.views.listen.YTMusic") as mock_ytmusic_cls,
            patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "cid", "GOOGLE_CLIENT_SECRET": "csec"}),
        ):
            mock_yt = MagicMock()
            mock_yt.get_history.return_value = MOCK_HISTORY
            mock_ytmusic_cls.return_value = mock_yt
            resp = client.get(f"/api/listens/callback/?code=authcode&state={admin_token}")

        assert resp.status_code == 302
        assert resp["Location"] == "/listens"
        assert ListenTrack.objects.count() == 2
        assert ListenTrack.objects.get(video_id="abc123").artist == "Test Artist"

    @patch("website.views.listen.urllib.request.urlopen")
    def test_callback_deduplicates(self, mock_urlopen, client, admin_token):
        ListenTrack.objects.create(video_id="abc123", title="Old", artist="Old", played_at=timezone.now())

        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"access_token":"fake","expires_in":3600}'
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        with (
            patch("website.views.listen.YTMusic") as mock_ytmusic_cls,
            patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "cid", "GOOGLE_CLIENT_SECRET": "csec"}),
        ):
            mock_yt = MagicMock()
            mock_yt.get_history.return_value = MOCK_HISTORY
            mock_ytmusic_cls.return_value = mock_yt
            client.get(f"/api/listens/callback/?code=authcode&state={admin_token}")

        assert ListenTrack.objects.count() == 2

    @patch("website.views.listen.urllib.request.urlopen")
    def test_callback_rate_limited(self, mock_urlopen, client, admin_token):
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"access_token":"fake","expires_in":3600}'
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        with (
            patch("website.views.listen.YTMusic") as mock_ytmusic_cls,
            patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "cid", "GOOGLE_CLIENT_SECRET": "csec"}),
        ):
            mock_yt = MagicMock()
            mock_yt.get_history.return_value = []
            mock_ytmusic_cls.return_value = mock_yt
            client.get(f"/api/listens/callback/?code=authcode&state={admin_token}")

        resp = client.get(f"/api/listens/callback/?code=authcode2&state={admin_token}")
        assert resp.status_code == 302
        assert "error=" in resp["Location"]


# ── Sync status ───────────────────────────────────────


@pytest.mark.django_db
class TestSyncStatus:
    def test_sync_available(self, client, auth_headers):
        data = client.get("/api/listens/sync-status/", **auth_headers).json()
        assert data["available"] is True
        assert data["cooldown_remaining"] == 0
