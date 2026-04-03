from pathlib import Path

from django.core.management.base import BaseCommand
from django.core.serializers import serialize

from website.models import GitHubContributions, ListenTrack, WatchChannel, WatchVideo

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "fixtures"
SEED_FILE = FIXTURES_DIR / "seed.json"

SEEDED_MODELS = [
    ("ListenTrack", ListenTrack),
    ("WatchChannel", WatchChannel),
    ("WatchVideo", WatchVideo),
    ("GitHubContributions", GitHubContributions),
]


class Command(BaseCommand):
    help = "Export seeded models to fixtures/seed.json"

    def handle(self, *args, **options):
        all_objects = []
        for name, model in SEEDED_MODELS:
            qs = model.objects.all()
            count = qs.count()
            if count:
                all_objects.extend(qs)
                self.stdout.write(f"  {name}: {count} objects")

        if not all_objects:
            self.stdout.write("No data to export.")
            return

        SEED_FILE.parent.mkdir(parents=True, exist_ok=True)
        SEED_FILE.write_text(serialize("json", all_objects, indent=2))
        self.stdout.write(f"Exported {len(all_objects)} objects to {SEED_FILE}")
