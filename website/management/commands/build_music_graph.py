import json
import os

from django.conf import settings
from django.core.management.base import BaseCommand

from website.services import music_graph

BROWSER_JSON_PATH = "browser.json"


class Command(BaseCommand):
    help = "Sync YTM history + liked tracks, then rebuild the listening graph (nodes + edges)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--no-sync",
            action="store_true",
            help="Skip the YTM history/liked fetch; just rebuild the graph from existing data.",
        )

    def handle(self, *_args, **options):
        def progress(msg):
            self.stdout.write(msg)
            self.stdout.flush()

        # Default: fetch fresh history + liked songs from YTM (so liked tracks become nodes),
        # which also rebuilds the graph. _do_sync is the same helper the daily Celery task uses.
        if not options["no_sync"]:
            from website.views.listen import _do_sync

            try:
                result = _do_sync(progress=progress)
                self.stdout.write(
                    f"Synced {result['synced_history']} plays + {result['synced_liked']} liked "
                    f"+ {result['synced_frequent']} frequent; graph rebuilt."
                )
                return
            except Exception as e:
                self.stderr.write(
                    f"YTM sync skipped ({e.__class__.__name__}: {e}); rebuilding graph from existing data. "
                    "Re-auth via the /listens AUTH button to ingest liked songs."
                )

        # Fallback (or --no-sync): rebuild from whatever is already in the DB.
        music_graph.build_graph(
            api_key=getattr(settings, "LASTFM_API_KEY", ""),
            ytm_headers=self._load_ytm_headers(),
            progress=progress,
        )
        self.stdout.write("Music graph rebuilt from existing data.")

    def _load_ytm_headers(self):
        from ytmusicapi.helpers import get_authorization, sapisid_from_cookie

        auth_path = os.environ.get("YTMUSIC_BROWSER_JSON", BROWSER_JSON_PATH)
        if not os.path.isfile(auth_path):
            self.stderr.write(f"YTM auth file not found ({auth_path}); skipping personalization")
            return None
        with open(auth_path) as f:
            headers = json.load(f)
        if "authorization" not in headers and "cookie" in headers:
            sapisid = sapisid_from_cookie(headers["cookie"])
            origin = headers.get("origin", "https://music.youtube.com")
            headers["authorization"] = get_authorization(sapisid + " " + origin)
        return headers
