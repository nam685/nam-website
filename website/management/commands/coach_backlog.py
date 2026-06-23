"""Gentle drip-coacher for the preprocessed-but-uncoached AoE2 backlog.

Preprocessing (reconstruction/economy/maps) is unlimited, but the LLM coach runs on Nam's Claude Max
subscription, which only sustains a handful of agentic runs per 5h window before it rate-limits. So
this command coaches a SMALL batch per run and STOPS at the first empty result (the rate-limit / 429
signal) — it makes progress whenever there's headroom and never keeps hammering an exhausted window.
Run it on a cron (e.g. every few hours); the backlog fills over a few days.

Featured (⭐) matches coach on opus, everything else on haiku (handled inside coach_match).
"""

from django.core.management.base import BaseCommand

from website.models import Aoe2Match
from website.tasks import coach_match


class Command(BaseCommand):
    help = "Coach a small batch of preprocessed-but-uncoached AoE2 matches (gentle, rate-limit-aware drip)."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=3, help="Max matches to coach this run (default 3).")

    def handle(self, *_args, **opts):
        limit = opts["limit"]
        # Newest games first — those are the ones Nam most likely wants coached.
        coachless = [
            m.id
            for m in Aoe2Match.objects.filter(analysis_status="done").order_by("-played_at", "-id")
            if not (m.coach_analysis or "").strip()
        ]
        if not coachless:
            self.stdout.write("coach_backlog: nothing to coach")
            return

        coached = 0
        for mid in coachless[:limit]:
            coach_match(mid)  # synchronous; saves only on a non-empty result
            m = Aoe2Match.objects.get(id=mid)
            if (m.coach_analysis or "").strip():
                coached += 1
                self.stdout.write(f"coach_backlog: coached {mid} ({m.coach_model})")
            else:
                # Empty result = rate-limited / downgrade-to-empty → window is spent. Stop; retry next run.
                self.stdout.write(f"coach_backlog: {mid} came back empty (rate-limited?) — stopping for this window")
                break
        self.stdout.write(
            f"coach_backlog: done — coached {coached} this run, {len(coachless) - coached} still uncoached"
        )
