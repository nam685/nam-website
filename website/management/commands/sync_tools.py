"""Weekly sync of the best-of-Agent-Harnesses feed into the slops tool radar.

CELERY_BEAT_SCHEDULE has a "sync-tools-weekly" entry, but this deployment has no Celery Beat
process running (periodic tasks here run via cron calling management commands directly, same
as sync_listens/coach_backlog). This command is the actual trigger — run it on a cron.
"""

from django.core.management.base import BaseCommand

from website.views.tools import _do_sync


class Command(BaseCommand):
    help = "Sync the best-of-Agent-Harnesses feed into the slops tool radar."

    def handle(self, *_args, **_options):
        result = _do_sync()
        self.stdout.write(
            f"sync_tools: fetched {result['fetched']}, created {result['created']}, updated {result['updated']}"
        )
