"""Backfill the opening tag on AoE2 matches whose coach left it blank.

The opening badge lives in `match.metrics["opening"]`, set from the LLM coach's `- Opening:` bullet.
Haiku volume runs frequently omit that bullet, so older matches show no opening tag. This command
derives the tag deterministically from each match's already-stored #3 classifier (top candidate
build_id → build-order `family`) — no replay re-parse, no LLM calls, fully idempotent. It only fills
BLANK openings, never overwriting a coach's verified read.

    uv run python manage.py aoe2_backfill_openings            # apply
    uv run python manage.py aoe2_backfill_openings --dry-run   # preview only
"""

from django.core.management.base import BaseCommand

from website.aoe2.opening import opening_from_classifier
from website.models import Aoe2Match


class Command(BaseCommand):
    help = "Backfill missing AoE2 opening tags from the stored classifier (deterministic, no LLM)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing to the database.",
        )

    def handle(self, *_args, **opts):
        dry_run = opts["dry_run"]
        updated = 0
        no_classifier = 0

        for match in Aoe2Match.objects.order_by("id").iterator():
            metrics = match.metrics or {}
            if (metrics.get("opening") or "").strip():
                continue  # already has a tag — leave the coach's verified read alone
            derived = opening_from_classifier(match.classifier or {})
            if not derived:
                no_classifier += 1
                continue
            prefix = "[dry-run] " if dry_run else ""
            self.stdout.write(f"{prefix}match {match.id}: opening -> {derived}")
            if not dry_run:
                metrics["opening"] = derived
                match.metrics = metrics
                match.save(update_fields=["metrics"])
            updated += 1

        verb = "would update" if dry_run else "updated"
        self.stdout.write(
            self.style.SUCCESS(
                f"aoe2_backfill_openings: {verb} {updated} matches; "
                f"{no_classifier} blank matches had no usable classifier."
            )
        )
