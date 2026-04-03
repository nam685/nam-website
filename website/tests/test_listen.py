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

        resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.json()["synced"] == 1
        assert ListenTrack.objects.count() == 2

    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_rate_limited(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        mock_yt = MagicMock()
        mock_yt.get_history.return_value = []
        mock_ytmusic_cls.return_value = mock_yt

        client.post("/api/listens/sync/", **auth_headers)
        resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 429
        assert "Rate limited" in resp.json()["error"]

    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_ytmusic_error(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        mock_ytmusic_cls.side_effect = Exception("Auth failed")
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


# ── Top tracks endpoint ──────────────────────────────


@pytest.mark.django_db
class TestListenTopTracks:
    def test_empty(self, client):
        resp = client.get("/api/listens/tracks/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["tracks"] == []
        assert data["total"] == 0

    def test_ranked(self, client, sample_tracks):  # noqa: ARG002
        """Tracks with more plays rank higher."""
        # Duplicate vid_1 with matching metadata so .values() groups them
        ListenTrack.objects.create(
            video_id="vid_1",
            title="Track 1",
            artist="Artist 1",
            album="Album 1",
            thumbnail_url="https://img.youtube.com/vi/vid_1/0.jpg",
            played_at=timezone.now(),
        )
        resp = client.get("/api/listens/tracks/")
        assert resp.status_code == 200
        data = resp.json()
        # vid_1 now has 2 plays, should be first
        assert data["tracks"][0]["video_id"] == "vid_1"
        assert data["tracks"][0]["play_count"] == 2

    def test_pagination(self, client, sample_tracks):  # noqa: ARG002
        resp = client.get("/api/listens/tracks/?limit=2&offset=0")
        data = resp.json()
        assert len(data["tracks"]) == 2
        assert data["total"] == 5


@pytest.mark.django_db
class TestListenTopArtists:
    def test_empty(self, client):
        resp = client.get("/api/listens/artists/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["artists"] == []
        assert data["total"] == 0

    def test_ranked(self, client, sample_tracks):  # noqa: ARG002
        """Artists with more plays rank higher."""
        # Give Artist 1 an extra play
        ListenTrack.objects.create(
            video_id="vid_extra",
            title="Bonus Track",
            artist="Artist 1",
            played_at=timezone.now(),
        )
        resp = client.get("/api/listens/artists/")
        data = resp.json()
        assert data["artists"][0]["name"] == "Artist 1"
        assert data["artists"][0]["play_count"] == 2
        assert data["artists"][0]["track_count"] == 2
        assert len(data["artists"][0]["top_tracks"]) <= 3

    def test_pagination(self, client, sample_tracks):  # noqa: ARG002
        resp = client.get("/api/listens/artists/?limit=2&offset=0")
        data = resp.json()
        assert len(data["artists"]) == 2
        assert data["total"] == 5


@pytest.mark.django_db
class TestListenTopAlbums:
    def test_empty(self, client):
        resp = client.get("/api/listens/albums/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["albums"] == []
        assert data["total"] == 0

    def test_ranked(self, client, sample_tracks):  # noqa: ARG002
        ListenTrack.objects.create(
            video_id="alb1",
            title="Song A",
            artist="Band X",
            album="Album One",
            played_at=timezone.now(),
        )
        ListenTrack.objects.create(
            video_id="alb2",
            title="Song B",
            artist="Band X",
            album="Album One",
            played_at=timezone.now(),
        )
        ListenTrack.objects.create(
            video_id="alb3",
            title="Song C",
            artist="Band Y",
            album="Album Two",
            played_at=timezone.now(),
        )
        ListenTrack.objects.create(
            video_id="alb4",
            title="Song D",
            artist="Band Y",
            album="Album Two",
            played_at=timezone.now(),
        )
        resp = client.get("/api/listens/albums/")
        data = resp.json()
        assert data["albums"][0]["name"] == "Album One"
        assert data["albums"][0]["play_count"] == 2
        assert data["albums"][0]["artist"] == "Band X"

    def test_excludes_single_track_albums(self, client, db):
        """Albums with only 1 unique track should be excluded."""
        now = timezone.now()
        # Album with 2 tracks — should be included
        ListenTrack.objects.create(
            video_id="multi1", title="Song 1", artist="Band", album="Multi Album",
            played_at=now,
        )
        ListenTrack.objects.create(
            video_id="multi2", title="Song 2", artist="Band", album="Multi Album",
            played_at=now - timezone.timedelta(hours=1),
        )
        # Album with 1 track — should be excluded
        ListenTrack.objects.create(
            video_id="single1", title="Only Song", artist="Solo", album="Single Album",
            played_at=now - timezone.timedelta(hours=2),
        )
        resp = client.get("/api/listens/albums/")
        data = resp.json()
        album_names = [a["name"] for a in data["albums"]]
        assert "Multi Album" in album_names
        assert "Single Album" not in album_names

    def test_excludes_empty_album(self, client, sample_tracks):  # noqa: ARG002
        """Tracks with empty album field are excluded."""
        # sample_tracks have album="Album N" so let's check they're included
        # but create one with empty album to verify exclusion
        ListenTrack.objects.create(
            video_id="no_album",
            title="No Album",
            artist="X",
            album="",
            played_at=timezone.now(),
        )
        resp = client.get("/api/listens/albums/")
        data = resp.json()
        for album in data["albums"]:
            assert album["name"] != ""


@pytest.mark.django_db
class TestListenRecommended:
    def test_empty_db(self, client):
        resp = client.get("/api/listens/recommended/")
        assert resp.status_code == 200
        assert resp.json()["track"] is None

    def test_returns_rediscovery_track(self, client, db):
        """Tracks played often but not recently should be recommended."""
        now = timezone.now()
        # Track played 10 times, last play 20 days ago — good candidate
        for i in range(10):
            ListenTrack.objects.create(
                video_id="rediscover",
                title="Old Favorite",
                artist="Artist A",
                album="Album A",
                thumbnail_url="https://example.com/thumb.jpg",
                played_at=now - timezone.timedelta(days=20 + i),
            )
        # Track played 2 times, last play 1 day ago — too recent
        for i in range(2):
            ListenTrack.objects.create(
                video_id="recent",
                title="Recent Song",
                artist="Artist B",
                played_at=now - timezone.timedelta(days=i),
            )
        resp = client.get("/api/listens/recommended/")
        data = resp.json()
        assert data["track"] is not None
        assert data["track"]["video_id"] == "rediscover"

    def test_fallback_to_most_played(self, client, db):
        """When no tracks qualify for rediscovery, return most played."""
        now = timezone.now()
        # All tracks are recent — none qualify for 14-day rediscovery
        for i in range(5):
            ListenTrack.objects.create(
                video_id="popular",
                title="Popular Song",
                artist="Artist",
                played_at=now - timezone.timedelta(hours=i),
            )
        ListenTrack.objects.create(
            video_id="less_popular",
            title="Less Popular",
            artist="Artist",
            played_at=now - timezone.timedelta(hours=10),
        )
        resp = client.get("/api/listens/recommended/")
        data = resp.json()
        assert data["track"] is not None
        assert data["track"]["video_id"] == "popular"
