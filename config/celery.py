import os

from celery import Celery
from celery.signals import worker_ready

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
app = Celery("nam_website")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@worker_ready.connect
def recover_stale_turns(**kwargs):
    """Re-queue any turns stuck in 'running' on worker startup.

    When a deploy restarts the Celery worker mid-execution, the turn
    stays 'running' forever. Reset to 'approved' and re-queue so the
    already-approved work gets retried automatically.
    """
    from website.models import Turn

    stale = list(Turn.objects.filter(status="running").values_list("id", flat=True))
    if not stale:
        return

    Turn.objects.filter(id__in=stale).update(status="approved", started_at=None)
    for turn_id in stale:
        run_turn.delay(turn_id)
    print(f"[celery] re-queued {len(stale)} stale running turn(s)")
