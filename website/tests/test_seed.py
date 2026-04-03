import json
from pathlib import Path
from unittest.mock import patch

import pytest
from django.core.management import call_command

from website.models import GitHubContributions, ListenTrack, WatchChannel, WatchVideo

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "fixtures"

EXAMPLE_FIXTURE = [
    {
        "model": "website.listentrack",
        "pk": 1,
        "fields": {
            "video_id": "abc123",
            "title": "Test Song",
            "artist": "Test Artist",
            "album": "Test Album",
            "thumbnail_url": "",
            "duration": "3:45",
            "played_at": "2026-01-01T12:00:00Z",
        },
    },
    {
        "model": "website.watchchannel",
        "pk": 1,
        "fields": {
            "youtube_channel_id": "UC_test",
            "name": "Test Channel",
            "description": "",
            "thumbnail_url": "",
            "tier": "regular",
            "display_order": 0,
            "created_at": "2026-01-01T12:00:00Z",
            "synced_at": "2026-01-01T12:00:00Z",
        },
    },
    {
        "model": "website.watchvideo",
        "pk": 1,
        "fields": {
            "youtube_video_id": "vid_test",
            "channel": 1,
            "title": "Test Video",
            "thumbnail_url": "",
            "note": "",
            "pinned": False,
            "visible": True,
            "created_at": "2026-01-01T12:00:00Z",
            "synced_at": "2026-01-01T12:00:00Z",
        },
    },
    {
        "model": "website.githubcontributions",
        "pk": 1,
        "fields": {
            "data": {"totalContributions": 42, "weeks": []},
            "updated_at": "2026-01-01T12:00:00Z",
        },
    },
]


@pytest.mark.django_db
class TestSeedCommand:
    def test_seed_loads_fixture_into_empty_tables(self, tmp_path):
        fixture_file = tmp_path / "seed.json"
        fixture_file.write_text(json.dumps(EXAMPLE_FIXTURE))

        with patch("website.management.commands.seed.SEED_FILE", fixture_file):
            call_command("seed")

        assert ListenTrack.objects.count() == 1
        assert WatchChannel.objects.count() == 1
        assert WatchVideo.objects.count() == 1
        assert GitHubContributions.objects.count() == 1

    def test_seed_skips_populated_tables(self, tmp_path):
        ListenTrack.objects.create(
            video_id="existing",
            title="Existing",
            artist="Artist",
            played_at="2026-01-01T00:00:00Z",
        )

        fixture_file = tmp_path / "seed.json"
        fixture_file.write_text(json.dumps(EXAMPLE_FIXTURE))

        with patch("website.management.commands.seed.SEED_FILE", fixture_file):
            call_command("seed")

        # ListenTrack should NOT be seeded (already has data)
        assert ListenTrack.objects.count() == 1
        assert ListenTrack.objects.first().video_id == "existing"
        # Other models should still be seeded
        assert WatchChannel.objects.count() == 1

    def test_seed_falls_back_to_example(self, tmp_path):
        seed_file = tmp_path / "seed.json"  # does not exist
        example_file = tmp_path / "seed.example.json"
        example_file.write_text(json.dumps(EXAMPLE_FIXTURE))

        with (
            patch("website.management.commands.seed.SEED_FILE", seed_file),
            patch("website.management.commands.seed.EXAMPLE_FILE", example_file),
        ):
            call_command("seed")

        assert ListenTrack.objects.count() == 1

    def test_seed_warns_when_no_fixture_exists(self, tmp_path, capsys):
        seed_file = tmp_path / "seed.json"
        example_file = tmp_path / "seed.example.json"

        with (
            patch("website.management.commands.seed.SEED_FILE", seed_file),
            patch("website.management.commands.seed.EXAMPLE_FILE", example_file),
        ):
            call_command("seed")

        output = capsys.readouterr().out
        assert "No seed fixture found" in output
        assert ListenTrack.objects.count() == 0
