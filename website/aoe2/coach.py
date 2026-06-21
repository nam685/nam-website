"""LLM coach for AoE2 1v1 matches — shells out to `claude -p`."""

import json
import logging
import subprocess

from django.conf import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Benchmark knowledge embedded in the prompt (no API roundtrip for this)
# ---------------------------------------------------------------------------

COACH_SYSTEM = """\
You are a concise, precise Age of Empires II: Definitive Edition 1v1 coaching assistant.
You analyse a mechanical game log (salient.log) and a numeric metrics summary to produce
a short, actionable coach report. The log contains only timestamped mechanical events
(age-ups, builds, eco techs, unit trains); no player names, no chat, no speculation.

AoE2 1v1 benchmark uptimes (ranked-ladder averages — compare against these):
  Scouts opening  : Feudal ~9:30–10:00 | Castle ~18:00–20:00
  Archers opening : Feudal ~9:00–9:45  | Castle ~18:30–21:00
  M@A → Archers  : Feudal ~8:45–9:30  | Castle ~19:00–21:30
  Drush           : Feudal ~8:30–9:15  | Castle ~18:00–20:30
  Fast Castle     : Feudal ~9:00–10:00 | Castle ~15:30–17:30
  Tower Rush      : Feudal ~8:30–9:30  | Castle ~18:00–21:00

Key metrics pros scrutinize:
  • Feudal uptime vs. benchmark (15–30 s slow = minor; >60 s = significant drop)
  • Castle uptime vs. benchmark
  • Villager production consistency (long gaps → TC idle time)
  • Eco tech timings (Loom before feudal = eco-safe; Wheelbarrow before mid-Castle)
  • Opening classification match vs. actual build (e.g. Scouts but built Archery Range)
  • Army composition and first military unit timing
  • APM (useful as context, not as a standalone metric)

Output format — plain text, 3–5 short paragraphs:
  1. Opening read: what opening was played and how it compares to the classified tag.
  2. Uptime analysis: actual vs. benchmark, any notable gaps.
  3. Eco / production: villager cadence, eco tech highlights or omissions.
  4. Key observation: the single most impactful thing you noticed.
  5. Improvement: one concrete, actionable change for the next game.

Keep it under 300 words. No bullet lists — prose only. No fluff, no praise padding.
Do NOT reference opponent data or speculate about game state beyond the log.
"""


def build_coach_prompt(salient_log: str, metrics: dict) -> str:
    """Build the -p prompt passed to `claude` for coaching a single match.

    salient_log is the pre-stripped mechanical event log (~5 KB).
    metrics is the dict from compute_metrics (feudal_uptime_s, opening, etc.).
    Player names and chat are never in either input.
    """
    metrics_summary_lines = []
    feudal = metrics.get("feudal_uptime_s")
    castle = metrics.get("castle_uptime_s")
    imperial = metrics.get("imperial_uptime_s")
    metrics_summary_lines.append(f"  feudal_uptime_s  : {feudal if feudal is not None else 'n/a'}")
    metrics_summary_lines.append(f"  castle_uptime_s  : {castle if castle is not None else 'n/a'}")
    metrics_summary_lines.append(f"  imperial_uptime_s: {imperial if imperial is not None else 'n/a'}")
    metrics_summary_lines.append(f"  apm              : {metrics.get('apm', 'n/a')}")
    metrics_summary_lines.append(f"  villager_count   : {metrics.get('villager_count', 'n/a')}")
    metrics_summary_lines.append(f"  opening_tag      : {metrics.get('opening', 'n/a')}")

    army = metrics.get("army", [])
    if army:
        army_str = ", ".join(f"{u['name']} x{u['amount']}" for u in army[:8])
        metrics_summary_lines.append(f"  army             : {army_str}")

    eco_timings = metrics.get("eco_tech_timings", [])
    if eco_timings:
        eco_str = ", ".join(f"{e['name']}@{e['t_s']}s" for e in eco_timings[:10])
        metrics_summary_lines.append(f"  eco_techs        : {eco_str}")

    metrics_block = "\n".join(metrics_summary_lines)

    return (
        f"{COACH_SYSTEM}\n\n"
        "=== METRICS SUMMARY ===\n"
        f"{metrics_block}\n\n"
        "=== SALIENT LOG ===\n"
        f"{salient_log}\n\n"
        "Now write the coach report."
    )


def run_claude_coach(prompt: str, timeout: int = 120) -> tuple[str, str]:
    """Run `claude -p <prompt> --output-format json` and return (result_text, model).

    Raises RuntimeError on non-zero exit or missing 'result' key so the caller
    can decide how to handle (graceful fallback expected in tasks.py).
    """
    claude_bin = getattr(settings, "AOE2_CLAUDE_BIN", "claude")
    result = subprocess.run(
        [claude_bin, "-p", prompt, "--output-format", "json"],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()[:500]
        raise RuntimeError(f"claude exited {result.returncode}: {stderr}")

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"claude returned non-JSON output: {exc}") from exc

    text = data.get("result", "")
    if not text:
        raise RuntimeError("claude JSON response missing 'result' field")

    model = data.get("model", "")
    return text, model
