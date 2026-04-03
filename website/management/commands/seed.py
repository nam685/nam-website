import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.core.serializers import deserialize

from website.models import GitHubContributions, ListenTrack, WatchChannel, WatchVideo

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "fixtures"
SEED_FILE = FIXTURES_DIR / "seed.json"
EXAMPLE_FILE = FIXTURES_DIR / "seed.example.json"

SEEDED_MODELS = [
    ("ListenTrack", ListenTrack),
    ("WatchChannel", WatchChannel),
    ("WatchVideo", WatchVideo),
    ("GitHubContributions", GitHubContributions),
]


class Command(BaseCommand):
    help = "Load seed fixture data into empty tables"

    def handle(self, *_args, **_options):
        fixture_path = SEED_FILE if SEED_FILE.exists() else EXAMPLE_FILE
        if not fixture_path.exists():
            self.stdout.write("No seed fixture found. Skipping. (Run 'make dumpseed' to create one)")
            return

        # Determine which models need seeding
        empty_models = set()
        for name, model in SEEDED_MODELS:
            if model.objects.exists():
                self.stdout.write(f"  {name}: already has data, skipping")
            else:
                empty_models.add(f"website.{name.lower()}")

        if not empty_models:
            self.stdout.write("All tables already populated. Nothing to seed.")
            return

        # Load and filter fixture to only empty models
        data = json.loads(fixture_path.read_text())
        filtered = [obj for obj in data if obj["model"] in empty_models]

        if not filtered:
            self.stdout.write("No applicable seed data found in fixture.")
            return

        # Deserialize and save
        count = 0
        for obj in deserialize("json", json.dumps(filtered)):
            obj.save()
            count += 1

        source = "seed.json" if fixture_path == SEED_FILE else "seed.example.json"
        self.stdout.write(f"Seeded {count} objects from {source}")
