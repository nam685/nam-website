import os

from celery import Celery
from celery.signals import worker_ready

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
app = Celery("nam_website")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@worker_ready.connect
def recover_stale_turns(**kwargs):
    """Mark any turns stuck in 'running' as failed on worker startup.

    This handles the case where a deploy restarts the Celery worker while
    a klaude subprocess is mid-execution — the turn would be stuck in
    'running' forever otherwise.
    """
    from django.utils import timezone

    from website.models import Session, Turn

    stale = Turn.objects.filter(status="running")
    count = stale.count()
    if count:
        stale.update(status="failed", error="Worker restarted during execution", completed_at=timezone.now())
        Session.objects.filter(status="running").exclude(turns__status="running").update(status="failed")
        print(f"[celery] recovered {count} stale running turn(s)")
