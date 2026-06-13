import json
import os

from django.conf import settings
from django.core.management.base import BaseCommand

from website.services import music_graph

BROWSER_JSON_PATH = "browser.json"


class Command(BaseCommand):
    help = "Rebuild the listening graph (nodes + edges) from ListenTrack, YTM, and Last.fm"

    def handle(self, *_args, **_options):
        ytm_headers = self._load_ytm_headers()
        music_graph.build_graph(
            api_key=getattr(settings, "LASTFM_API_KEY", ""),
            ytm_headers=ytm_headers,
        )
        self.stdout.write("Music graph rebuilt.")

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
