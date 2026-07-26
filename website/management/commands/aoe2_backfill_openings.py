"""Backfill / tidy the opening tag on AoE2 matches.

The opening badge lives in `match.metrics["opening"]`, set from the LLM coach's `- Opening:` bullet.
Two problems this command fixes, deterministically and with no LLM calls (idempotent):

1. BLANK openings — haiku volume runs frequently omit the bullet, leaving older matches untagged.
   Derive the tag from each match's already-stored #3 classifier (top candidate build_id →
   build-order `family`).
2. OVER-LONG openings — haiku sometimes writes a whole sentence into the bullet, e.g.
   "dark age boom (never feudal) — you made only villagers...". Re-cap it to a terse badge with
   `cap_opening` (a blank/short read is left untouched).

    uv run python manage.py aoe2_backfill_openings            # apply
    uv run python manage.py aoe2_backfill_openings --dry-run   # preview only
"""

from django.core.management.base import BaseCommand

from website.aoe2.opening import cap_opening, opening_from_classifier
from website.models import Aoe2Match


class Command(BaseCommand):
    help = "Backfill blank AoE2 opening tags from the classifier and re-cap over-long ones (no LLM)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing to the database.",
        )

    def handle(self, *_args, **opts):
        dry_run = opts["dry_run"]
        prefix = "[dry-run] " if dry_run else ""
        filled = 0
        recapped = 0
        no_classifier = 0

        for match in Aoe2Match.objects.order_by("id").iterator():
            metrics = match.metrics or {}
            current = (metrics.get("opening") or "").strip()

            if current:
                # Has a tag: only touch it if it's longer than a terse badge.
                capped = cap_opening(current)
                if capped and capped != current:
                    self.stdout.write(f"{prefix}match {match.id}: recap {current!r} -> {capped!r}")
                    new_value = capped
                    recapped += 1
                else:
                    continue
            else:
                # Blank: derive from the deterministic classifier.
                derived = opening_from_classifier(match.classifier or {})
                if not derived:
                    no_classifier += 1
                    continue
                self.stdout.write(f"{prefix}match {match.id}: fill -> {derived}")
                new_value = derived
                filled += 1

            if not dry_run:
                metrics["opening"] = new_value
                match.metrics = metrics
                match.save(update_fields=["metrics"])

        verb = "would change" if dry_run else "changed"
        self.stdout.write(
            self.style.SUCCESS(
                f"aoe2_backfill_openings: {verb} {filled + recapped} matches "
                f"({filled} filled, {recapped} re-capped); {no_classifier} blank matches had no classifier."
            )
        )
