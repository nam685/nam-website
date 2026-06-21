import json
from unittest.mock import MagicMock, mock_open, patch

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

    return mock_open(read_data=FAKE_BROWSER_JSON)


@pytest.mark.django_db
class TestListenSync:
    @pytest.fixture(autouse=True)
    def _assume_logged_in(self):
        # Default the YTM login probe to "logged in" so sync tests exercise the happy path
        # without a real network call, and stub the async graph-rebuild dispatch so tests don't
        # touch the broker or run the (slow, networked) rebuild. Tests override these as needed.
        with (
            patch("website.views.listen._is_logged_in", return_value=True),
            patch("website.tasks.rebuild_listen_graph.delay") as mock_delay,
        ):
            self.mock_delay = mock_delay
            yield

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

    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_logged_out_session_fails_loud(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        # A stale cookie constructs a valid client but is logged out — sync must surface a clear
        # 409 + auth_expired flag (not a silent 0-synced or an opaque 502) and write nothing.
        mock_ytmusic_cls.return_value = MagicMock()
        with (
            patch("builtins.open", _mock_open_browser()),
            patch("website.views.listen._is_logged_in", return_value=False),
        ):
            resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 409
        body = resp.json()
        assert body["auth_expired"] is True
        assert "logged out" in body["error"].lower()
        assert ListenTrack.objects.count() == 0

    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_graph_rebuild_dispatched_async_not_inline(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        # The slow Last.fm graph rebuild must run off the request path (Celery), not inline —
        # otherwise it blows gunicorn's timeout and a real success looks like a 502.
        mock_yt = MagicMock()
        mock_yt.get_history.return_value = MOCK_HISTORY
        mock_ytmusic_cls.return_value = mock_yt

        with patch("builtins.open", _mock_open_browser()), patch("website.views.listen._rebuild_graph") as inline:
            resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 200
        assert resp.json()["graph_rebuilding"] is True
        self.mock_delay.assert_called_once()  # queued for Celery
        inline.assert_not_called()  # never run synchronously in the request

    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_graph_rebuild_falls_back_inline_if_broker_down(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        # If the broker is unreachable, degrade to the old inline rebuild rather than skip it.
        mock_yt = MagicMock()
        mock_yt.get_history.return_value = MOCK_HISTORY
        mock_ytmusic_cls.return_value = mock_yt
        self.mock_delay.side_effect = OSError("broker down")

        with patch("builtins.open", _mock_open_browser()), patch("website.views.listen._rebuild_graph") as inline:
            resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 200
        assert resp.json()["graph_rebuilding"] is False
        inline.assert_called_once()


# ── Reauth ────────────────────────────────────────────


@pytest.mark.django_db
class TestListenReauth:
    RAW = "Cookie: SAPISID=abc; __Secure-3PSID=xyz\nOrigin: https://music.youtube.com\nUser-Agent: TestUA"

    def _post(self, client, headers_text, auth_headers):
        return client.post(
            "/api/listens/reauth/",
            data=json.dumps({"headers": headers_text}),
            content_type="application/json",
            **auth_headers,
        )

    def test_requires_auth(self, client):
        resp = client.post(
            "/api/listens/reauth/", data=json.dumps({"headers": self.RAW}), content_type="application/json"
        )
        assert resp.status_code == 401

    def test_missing_cookie_rejected(self, client, auth_headers):
        resp = self._post(client, "Origin: https://music.youtube.com", auth_headers)
        assert resp.status_code == 400
        assert "cookie" in resp.json()["error"].lower()

    @patch("ytmusicapi.YTMusic")
    def test_rejects_logged_out_session(self, _mock_yt, client, auth_headers):
        # The whole point: logged-out cookies pass YTMusic() construction but must NOT be saved.
        m = mock_open()
        with patch("website.views.listen._is_logged_in", return_value=False), patch("builtins.open", m):
            resp = self._post(client, self.RAW, auth_headers)
        assert resp.status_code == 400
        assert "logged-in" in resp.json()["error"].lower()
        m().write.assert_not_called()

    @patch("ytmusicapi.YTMusic")
    def test_accepts_logged_in_and_strips_authorization(self, _mock_yt, client, auth_headers):
        m = mock_open()
        with patch("website.views.listen._is_logged_in", return_value=True), patch("builtins.open", m):
            resp = self._post(client, self.RAW, auth_headers)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        written = "".join(call.args[0] for call in m().write.call_args_list)
        saved = json.loads(written)
        assert "cookie" in saved
        # The SAPISIDHASH expires in hours; persisting it would re-break sync. Must not be stored.
        assert "authorization" not in saved


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


class TestFrequentFromHome:
    """_fetch_frequent_from_home pulls songs only from history-derived home rows."""

    def test_extracts_songs_from_history_rows_only(self):
        class FakeYT:
            def get_home(self, limit=8):  # noqa: ARG002
                return [
                    {
                        "title": "Listen again",
                        "contents": [
                            {
                                "videoId": "freq1",
                                "title": "Song A",
                                "artists": [{"name": "Artist A"}],
                                "album": {"name": "Album A"},
                                "thumbnails": [{"url": "https://img/a.jpg"}],
                            }
                        ],
                    },
                    {
                        "title": "Quick picks",  # recommendations — must be skipped
                        "contents": [{"videoId": "rec1", "title": "Rec", "artists": [{"name": "X"}]}],
                    },
                ]

        out = listen._fetch_frequent_from_home(FakeYT())
        ids = {t["video_id"] for t in out}
        assert "freq1" in ids
        assert "rec1" not in ids

    def test_handles_non_list_response(self):
        class FakeYT:
            def get_home(self, limit=8):  # noqa: ARG002
                return None

        assert listen._fetch_frequent_from_home(FakeYT()) == []
