import json
from unittest.mock import MagicMock, patch  # noqa: F401

import pytest

from website.models import WatchChannel, WatchVideo
from website.views import watch as watch_views
from website.views.watch import parse_iso8601_duration


class TestParseISO8601Duration:
    def test_minutes_and_seconds(self):
        assert parse_iso8601_duration("PT5M30S") == 330

    def test_hours_minutes_seconds(self):
        assert parse_iso8601_duration("PT1H2M3S") == 3723

    def test_minutes_only(self):
        assert parse_iso8601_duration("PT10M") == 600

    def test_seconds_only(self):
        assert parse_iso8601_duration("PT45S") == 45

    def test_hours_only(self):
        assert parse_iso8601_duration("PT2H") == 7200

    def test_empty_string(self):
        assert parse_iso8601_duration("") == 0

    def test_invalid_format(self):
        assert parse_iso8601_duration("not a duration") == 0

    def test_zero_duration(self):
        assert parse_iso8601_duration("PT0S") == 0


@pytest.mark.django_db
class TestWatchChannel:
    def test_create_channel(self):
        ch = WatchChannel.objects.create(
            youtube_channel_id="UC1234",
            name="Test Channel",
            description="A test channel",
            thumbnail_url="https://yt3.ggpht.com/test",
        )
        assert ch.tier == "hidden"
        assert ch.display_order == 0
        assert str(ch) == "Test Channel"

    def test_tier_weight(self):
        ch = WatchChannel(tier="never_miss")
        assert ch.tier_weight == 0
        ch.tier = "regular"
        assert ch.tier_weight == 1
        ch.tier = "check_out"
        assert ch.tier_weight == 2
        ch.tier = "hidden"
        assert ch.tier_weight == 3

    def test_unique_youtube_id(self):
        WatchChannel.objects.create(youtube_channel_id="UC1234", name="First")
        with pytest.raises(Exception):
            WatchChannel.objects.create(youtube_channel_id="UC1234", name="Duplicate")


@pytest.mark.django_db
class TestWatchVideo:
    def test_create_video(self):
        v = WatchVideo.objects.create(
            youtube_video_id="vid123",
            title="Test Video",
            thumbnail_url="https://i.ytimg.com/vi/vid123/hqdefault.jpg",
        )
        assert v.pinned is False
        assert v.visible is False
        assert v.channel is None
        assert str(v) == "Test Video"

    def test_video_linked_to_channel(self):
        ch = WatchChannel.objects.create(youtube_channel_id="UC1234", name="Ch")
        v = WatchVideo.objects.create(youtube_video_id="vid123", title="Vid", channel=ch)
        assert v.channel == ch
        assert ch.videos.count() == 1

    def test_channel_delete_nullifies_video(self):
        ch = WatchChannel.objects.create(youtube_channel_id="UC1234", name="Ch")
        v = WatchVideo.objects.create(youtube_video_id="vid123", title="Vid", channel=ch)
        ch.delete()
        v.refresh_from_db()
        assert v.channel is None

    def test_stats_fields_defaults(self):
        v = WatchVideo.objects.create(
            youtube_video_id="vid_stats",
            title="Stats Video",
        )
        assert v.view_count == 0
        assert v.like_count == 0
        assert v.comment_count == 0
        assert v.description == ""
        assert v.duration == ""
        assert v.stats_updated_at is None


@pytest.fixture()
def visible_channels(db):  # noqa: ARG001
    ch1 = WatchChannel.objects.create(
        youtube_channel_id="UC_never", name="Top Channel", tier="never_miss", display_order=0
    )
    ch2 = WatchChannel.objects.create(
        youtube_channel_id="UC_reg", name="Regular Channel", tier="regular", display_order=0
    )
    WatchChannel.objects.create(youtube_channel_id="UC_hidden", name="Hidden Channel", tier="hidden")
    WatchVideo.objects.create(
        youtube_video_id="vid_pinned",
        title="Great Video",
        thumbnail_url="https://i.ytimg.com/vi/vid_pinned/hqdefault.jpg",
        note="Must watch",
        pinned=True,
        visible=True,
        channel=ch1,
    )
    WatchVideo.objects.create(
        youtube_video_id="vid_hidden",
        title="Hidden Video",
        pinned=False,
        visible=False,
        channel=ch1,
    )
    return [ch1, ch2]


@pytest.mark.django_db
class TestWatchList:
    def test_empty(self, client):
        data = client.get("/api/watches/").json()
        assert data["channels"] == []
        assert data["total"] == 0

    def test_returns_visible_channels_only(self, client, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/").json()
        names = [c["name"] for c in data["channels"]]
        assert "Top Channel" in names
        assert "Regular Channel" in names
        assert "Hidden Channel" not in names

    def test_includes_pinned_visible_videos(self, client, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/").json()
        top = next(c for c in data["channels"] if c["name"] == "Top Channel")
        assert len(top["videos"]) == 1
        assert top["videos"][0]["title"] == "Great Video"
        assert top["videos"][0]["note"] == "Must watch"

    def test_excludes_hidden_videos(self, client, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/").json()
        top = next(c for c in data["channels"] if c["name"] == "Top Channel")
        video_titles = [v["title"] for v in top["videos"]]
        assert "Hidden Video" not in video_titles

    def test_sorted_by_tier_weight(self, client, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/").json()
        tiers = [c["tier"] for c in data["channels"]]
        assert tiers == ["never_miss", "regular"]

    def test_video_includes_stats_fields(self, client, visible_channels):  # noqa: ARG002
        # Update the pinned video with stats data
        v = WatchVideo.objects.get(youtube_video_id="vid_pinned")
        v.view_count = 1500000
        v.like_count = 50000
        v.comment_count = 3000
        v.description = "A great video about testing"
        v.duration = "PT15M30S"
        v.save()

        data = client.get("/api/watches/").json()
        top = next(c for c in data["channels"] if c["name"] == "Top Channel")
        video = top["videos"][0]
        assert video["view_count"] == 1500000
        assert video["like_count"] == 50000
        assert video["comment_count"] == 3000
        assert video["description"] == "A great video about testing"
        assert video["duration"] == "PT15M30S"

    def test_pagination(self, client, db):  # noqa: ARG002
        for i in range(35):
            WatchChannel.objects.create(youtube_channel_id=f"UC_{i}", name=f"Channel {i}", tier="regular")
        data = client.get("/api/watches/?limit=10&offset=0").json()
        assert len(data["channels"]) == 10
        assert data["total"] == 35
        data2 = client.get("/api/watches/?limit=10&offset=30").json()
        assert len(data2["channels"]) == 5


@pytest.mark.django_db
class TestWatchStaging:
    def test_requires_auth(self, client):
        assert client.get("/api/watches/staging/").status_code == 401

    def test_returns_hidden_channels_and_videos(self, client, auth_headers, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/staging/", **auth_headers).json()
        channel_names = [c["name"] for c in data["channels"]]
        assert "Hidden Channel" in channel_names
        assert "Top Channel" not in channel_names
        assert any(v["title"] == "Hidden Video" for v in data["videos"])


@pytest.mark.django_db
class TestWatchTier:
    def test_requires_auth(self, client):
        assert client.post("/api/watches/channels/1/tier/").status_code == 401

    def test_set_tier(self, client, auth_headers, db):  # noqa: ARG002
        ch = WatchChannel.objects.create(youtube_channel_id="UC1", name="Ch", tier="hidden")
        resp = client.post(
            f"/api/watches/channels/{ch.id}/tier/",
            data=json.dumps({"tier": "never_miss"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 200
        ch.refresh_from_db()
        assert ch.tier == "never_miss"

    def test_invalid_tier(self, client, auth_headers, db):  # noqa: ARG002
        ch = WatchChannel.objects.create(youtube_channel_id="UC1", name="Ch")
        resp = client.post(
            f"/api/watches/channels/{ch.id}/tier/",
            data=json.dumps({"tier": "invalid"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 400

    def test_not_found(self, client, auth_headers):
        resp = client.post(
            "/api/watches/channels/9999/tier/",
            data=json.dumps({"tier": "regular"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 404


@pytest.mark.django_db
class TestWatchOrder:
    def test_set_order(self, client, auth_headers, db):  # noqa: ARG002
        ch = WatchChannel.objects.create(youtube_channel_id="UC1", name="Ch")
        resp = client.post(
            f"/api/watches/channels/{ch.id}/order/",
            data=json.dumps({"display_order": 5}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 200
        ch.refresh_from_db()
        assert ch.display_order == 5


@pytest.mark.django_db
class TestWatchChannelDelete:
    def test_delete_channel_nullifies_videos(self, client, auth_headers, db):  # noqa: ARG002
        ch = WatchChannel.objects.create(youtube_channel_id="UC1", name="Ch")
        WatchVideo.objects.create(youtube_video_id="v1", title="V", channel=ch)
        resp = client.post(f"/api/watches/channels/{ch.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        assert WatchChannel.objects.count() == 0
        assert WatchVideo.objects.count() == 1
        assert WatchVideo.objects.first().channel is None


@pytest.mark.django_db
class TestWatchVideoPin:
    def test_toggle_pin(self, client, auth_headers, db):  # noqa: ARG002
        v = WatchVideo.objects.create(youtube_video_id="v1", title="V", pinned=False, visible=False)
        resp = client.post(f"/api/watches/videos/{v.id}/pin/", **auth_headers)
        assert resp.status_code == 200
        v.refresh_from_db()
        assert v.pinned is True
        assert v.visible is True
        resp = client.post(f"/api/watches/videos/{v.id}/pin/", **auth_headers)
        v.refresh_from_db()
        assert v.pinned is False


@pytest.mark.django_db
class TestWatchVideoNote:
    def test_set_note(self, client, auth_headers, db):  # noqa: ARG002
        v = WatchVideo.objects.create(youtube_video_id="v1", title="V")
        resp = client.post(
            f"/api/watches/videos/{v.id}/note/",
            data=json.dumps({"note": "Great video"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 200
        v.refresh_from_db()
        assert v.note == "Great video"


@pytest.mark.django_db
class TestWatchVideoDelete:
    def test_delete_video(self, client, auth_headers, db):  # noqa: ARG002
        v = WatchVideo.objects.create(youtube_video_id="v1", title="V")
        resp = client.post(f"/api/watches/videos/{v.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        assert WatchVideo.objects.count() == 0


@pytest.mark.django_db
class TestWatchRecommended:
    def test_empty_when_no_pinned_videos(self, client):
        data = client.get("/api/watches/recommended/").json()
        assert data["video"] is None

    def test_returns_pinned_video_from_visible_channel(self, client, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/recommended/").json()
        video = data["video"]
        assert video is not None
        assert video["youtube_video_id"] == "vid_pinned"
        assert video["title"] == "Great Video"
        assert video["channel_name"] == "Top Channel"
        assert video["channel_thumbnail_url"] is not None
        assert "view_count" in video
        assert "like_count" in video
        assert "comment_count" in video
        assert "description" in video
        assert "duration" in video

    def test_excludes_videos_from_hidden_channels(self, client, db):  # noqa: ARG002
        hidden_ch = WatchChannel.objects.create(youtube_channel_id="UC_hidden_rec", name="Hidden", tier="hidden")
        WatchVideo.objects.create(
            youtube_video_id="vid_hidden_rec",
            title="Hidden Vid",
            pinned=True,
            visible=True,
            channel=hidden_ch,
        )
        data = client.get("/api/watches/recommended/").json()
        assert data["video"] is None


@pytest.fixture(autouse=True)
def _reset_watch_rate_limit():
    watch_views._last_sync = 0
    yield
    watch_views._last_sync = 0


@pytest.mark.django_db
class TestWatchAuth:
    def test_no_google_client_id(self, client, admin_token):
        with patch.dict("os.environ", {"GOOGLE_CLIENT_ID": ""}, clear=False):
            resp = client.get(f"/api/watches/auth/?token={admin_token}")
            assert resp.status_code == 500

    @patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "test-client-id"})
    def test_redirects_to_google(self, client, admin_token):
        resp = client.get(f"/api/watches/auth/?token={admin_token}")
        assert resp.status_code == 302
        assert "accounts.google.com" in resp["Location"]
        assert "test-client-id" in resp["Location"]
        assert "youtube.readonly" in resp["Location"]

    def test_requires_token(self, client):
        with patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "test-id"}):
            assert client.get("/api/watches/auth/").status_code == 401


@pytest.mark.django_db
class TestWatchCallback:
    def test_missing_code(self, client):
        resp = client.get("/api/watches/callback/")
        assert resp.status_code == 400

    def test_bad_state(self, client):
        resp = client.get("/api/watches/callback/?code=test&state=bad")
        assert resp.status_code == 401

    def test_error_redirects(self, client):
        resp = client.get("/api/watches/callback/?error=access_denied")
        assert resp.status_code == 302
        assert "/watches?error=" in resp["Location"]


@pytest.mark.django_db
class TestWatchSync:
    def test_requires_auth(self, client):
        assert client.post("/api/watches/sync/").status_code == 401

    def test_no_refresh_token(self, client, auth_headers):
        resp = client.post("/api/watches/sync/", **auth_headers)
        assert resp.status_code == 400
        assert "not connected" in resp.json()["error"].lower()

    @patch("website.views.watch._youtube_api_get")
    def test_sync_creates_channels_and_videos(self, mock_api_get, client, auth_headers):
        from django.core.cache import cache

        cache.set("watches_google_refresh_token", "fake-refresh")
        cache.set("watches_google_access_token", "fake-access")

        mock_api_get.side_effect = [
            # subscriptions call
            {
                "items": [
                    {
                        "snippet": {
                            "resourceId": {"channelId": "UC_test"},
                            "title": "Test Channel",
                            "description": "Desc",
                            "thumbnails": {"default": {"url": "https://thumb.jpg"}},
                        }
                    }
                ],
            },
            # liked videos call
            {
                "items": [
                    {
                        "id": "vid_test",
                        "snippet": {
                            "title": "Test Video",
                            "channelId": "UC_test",
                            "thumbnails": {"high": {"url": "https://vthumb.jpg"}},
                        },
                    }
                ],
            },
            # stats batch call for video IDs
            {
                "items": [
                    {
                        "id": "vid_test",
                        "statistics": {
                            "viewCount": "1000000",
                            "likeCount": "50000",
                            "commentCount": "1200",
                        },
                        "contentDetails": {"duration": "PT10M5S"},
                        "snippet": {"description": "A cool video"},
                    }
                ],
            },
        ]

        resp = client.post("/api/watches/sync/", **auth_headers)
        assert resp.status_code == 200

        assert WatchChannel.objects.filter(youtube_channel_id="UC_test").exists()
        ch = WatchChannel.objects.get(youtube_channel_id="UC_test")
        assert ch.name == "Test Channel"
        assert ch.tier == "hidden"

        assert WatchVideo.objects.filter(youtube_video_id="vid_test").exists()
        v = WatchVideo.objects.get(youtube_video_id="vid_test")
        assert v.channel == ch
        assert v.visible is False
        assert v.view_count == 1000000
        assert v.like_count == 50000
        assert v.comment_count == 1200
        assert v.description == "A cool video"
        assert v.duration == "PT10M5S"
        assert v.stats_updated_at is not None

    @patch("website.views.watch._youtube_api_get")
    def test_sync_rate_limited(self, mock_api_get, client, auth_headers):
        from django.core.cache import cache

        cache.set("watches_google_refresh_token", "fake-refresh")
        cache.set("watches_google_access_token", "fake-access")
        # First sync: subscriptions + liked videos (no videos synced, so no stats call)
        mock_api_get.side_effect = [
            {"items": []},  # subscriptions
            {"items": []},  # liked videos
        ]

        client.post("/api/watches/sync/", **auth_headers)
        resp = client.post("/api/watches/sync/", **auth_headers)
        assert resp.status_code == 429


@pytest.mark.django_db
class TestWatchSyncStatus:
    def test_requires_auth(self, client):
        assert client.get("/api/watches/sync-status/").status_code == 401

    def test_returns_status(self, client, auth_headers):
        data = client.get("/api/watches/sync-status/", **auth_headers).json()
        assert data["available"] is True
        assert data["cooldown_remaining"] == 0
        assert data["connected"] is False


@pytest.mark.django_db
class TestWatchBackfillStats:
    def test_requires_auth(self, client):
        assert client.post("/api/watches/backfill-stats/").status_code == 401

    @patch("website.views.watch._youtube_api_get")
    def test_backfills_stale_videos(self, mock_api_get, client, auth_headers, db):  # noqa: ARG002
        from django.core.cache import cache

        cache.set("watches_google_refresh_token", "fake-refresh")
        cache.set("watches_google_access_token", "fake-access")

        v = WatchVideo.objects.create(
            youtube_video_id="vid_stale",
            title="Stale Video",
            pinned=True,
            visible=True,
        )
        assert v.stats_updated_at is None

        mock_api_get.return_value = {
            "items": [
                {
                    "id": "vid_stale",
                    "statistics": {
                        "viewCount": "5000000",
                        "likeCount": "100000",
                        "commentCount": "2000",
                    },
                    "contentDetails": {"duration": "PT12M30S"},
                    "snippet": {"description": "Video description here"},
                }
            ]
        }

        resp = client.post("/api/watches/backfill-stats/", **auth_headers)
        assert resp.status_code == 200
        assert resp.json()["updated"] == 1

        v.refresh_from_db()
        assert v.view_count == 5000000
        assert v.like_count == 100000
        assert v.comment_count == 2000
        assert v.description == "Video description here"
        assert v.duration == "PT12M30S"
        assert v.stats_updated_at is not None

    def test_no_youtube_connection(self, client, auth_headers):
        resp = client.post("/api/watches/backfill-stats/", **auth_headers)
        assert resp.status_code == 400
        assert "not connected" in resp.json()["error"].lower()
