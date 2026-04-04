import os
import re

from django.core.management.base import BaseCommand
from django.utils import timezone

from website.models import ListenTrack

BROWSER_JSON_PATH = "browser.json"
VIEW_COUNT_RE = re.compile(r"^[\d,.]+\s+views?$", re.IGNORECASE)


class Command(BaseCommand):
    help = "Sync YouTube Music listening history via ytmusicapi"

    def handle(self, *_args, **_options):
        from ytmusicapi import YTMusic

        auth_path = os.environ.get("YTMUSIC_BROWSER_JSON", BROWSER_JSON_PATH)
        if not os.path.isfile(auth_path):
            self.stderr.write(f"Auth file not found: {auth_path}")
            self.stderr.write("Run: ytmusicapi browser")
            return

        yt = YTMusic(auth_path)
        history = yt.get_history()
        self.stdout.write(f"Fetched {len(history)} tracks from YTM")

        # Deduplicate against last 24h
        cutoff = timezone.now() - timezone.timedelta(hours=24)
        recent_ids = set(ListenTrack.objects.filter(played_at__gte=cutoff).values_list("video_id", flat=True))

        new_tracks = []
        sync_time = timezone.now()
        for i, item in enumerate(history):
            video_id = item.get("videoId", "")
            if not video_id or video_id in recent_ids:
                continue

            artists = item.get("artists", [])
            artist_names = [
                a.get("name", "") for a in artists if a.get("name") and not VIEW_COUNT_RE.match(a.get("name", ""))
            ]
            artist_name = ", ".join(artist_names) if artist_names else "Unknown"

            album_info = item.get("album")
            album_name = album_info.get("name", "") if album_info else ""

            thumbnails = item.get("thumbnails", [])
            thumb_url = thumbnails[-1].get("url", "") if thumbnails else ""

            duration = item.get("duration", "")
            played_at = sync_time - timezone.timedelta(seconds=i)

            new_tracks.append(
                ListenTrack(
                    video_id=video_id,
                    title=item.get("title", "Unknown"),
                    artist=artist_name,
                    album=album_name,
                    thumbnail_url=thumb_url,
                    duration=duration,
                    played_at=played_at,
                )
            )

        if new_tracks:
            ListenTrack.objects.bulk_create(new_tracks)

        self.stdout.write(f"Synced {len(new_tracks)} new tracks")
