import json
import logging
import os
import re
import subprocess

from aoe2coach import BENCHMARKS, build_timeline, coach, compute_metrics, parse_rec, render_dual_log
from django.conf import settings as dj_settings
from django.utils import timezone
from django.utils import timezone as dj_timezone

from config.celery import app
from website.aoe2.opening import opening_from_classifier
from website.aoe2.v2 import build_bundle
from website.models import Aoe2Match, Download, Turn
from website.slops_limits import MAX_FILES_PER_TURN, MAX_SINGLE_FILE, MAX_TOTAL_UPLOAD

logger = logging.getLogger(__name__)


def _run_coach(salient_log, metrics, result, bundle=None, model=None):
    """Prod wrapper: read settings, call the pure aoe2coach.coach(), own graceful degradation.

    `model` overrides the configured AOE2_COACH_MODEL for this run. Featured matches pass "opus";
    everything else uses the volume default (haiku) — the Max sub only sustains a handful of opus
    agentic runs per window before silently downgrading, so opus is reserved for hand-picked matches.

    Returns (coach_analysis, coach_model, opening, tier). On any failure returns ("", "", "", "")
    so analysis still completes and the rich data is saved.

    When `bundle` (the v2 preprocessing bundle from website.aoe2.v2.build_bundle) is supplied, the
    AGENTIC coach v2 path runs: coach() builds a per-match workspace from the Reconstruction,
    classifier candidates, mistakes, economy, and strategic-map PNGs, runs the read-only agent over
    it, and falls back to single-shot facts-only on any failure. Without a bundle the legacy v1
    embedded-benchmark path runs (back-compat).
    """
    try:
        model = model or getattr(dj_settings, "AOE2_COACH_MODEL", "haiku")
        claude_bin = getattr(dj_settings, "AOE2_CLAUDE_BIN", "claude")
        # Reasoning effort for the agentic coach. Default "high" (NOT xhigh): xhigh's huge per-run
        # thinking-token load makes the Max sub silently downgrade opus->haiku under rate limits.
        effort = getattr(dj_settings, "AOE2_COACH_EFFORT", "high")
        kwargs = {"effort": effort}
        if bundle is not None:
            kwargs.update(
                {
                    "reconstruction": bundle.get("recon_obj") or bundle.get("reconstruction"),
                    "candidates": bundle.get("candidates"),
                    "economy": bundle.get("economy"),
                    "mistakes": bundle.get("mistakes"),
                    "map_pngs": bundle.get("map_png_paths"),
                }
            )
        out = coach(
            metrics, salient_log, benchmarks=BENCHMARKS, result=result, model=model, claude_bin=claude_bin, **kwargs
        )
        # The LLM's `- Opening:` read is authoritative, but haiku volume runs often omit it. Fall
        # back to the deterministic #3 classifier so the opening tag is never blank for a coached match.
        opening = out.opening_tag or _classifier_opening(bundle)
        return out.raw_text, out.model_used, opening, getattr(out, "tier", "")
    except Exception:  # noqa: BLE001
        logger.warning("Coach stage failed — storing empty coach_analysis")
        # Coach blew up, but the deterministic classifier still gives us an opening tag.
        return "", "", _classifier_opening(bundle), ""


def _classifier_opening(bundle) -> str:
    """Opening family from a bundle's classifier, or "" when there's no bundle/candidate."""
    if bundle is None:
        return ""
    return opening_from_classifier(bundle.get("classifier", {}))


KLAUDE_USER = "klaude"
KLAUDE_BIN = "/home/klaude/.local/bin/klaude"
WORKSPACE_BASE = "/home/klaude/workspace"
TRACES_BASE = "/home/klaude/traces"


def _fmt_size(n):
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / (1024 * 1024):.1f} MB"


def _build_prompt_with_attachments(turn):
    attachments = list(turn.attachments.all())
    if not attachments:
        return turn.prompt
    lines = [f"- uploads/{turn.session_id}/{turn.id}/{a.filename} ({_fmt_size(a.size)})" for a in attachments]
    prefix = "[attachments — read these first]\n" + "\n".join(lines) + "\n\n"
    return prefix + turn.prompt


def _sudo_read(path):
    """Read a file as the klaude user. Returns content string or None."""
    result = subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "cat", path],
        capture_output=True,
        text=True,
    )
    return result.stdout if result.returncode == 0 else None


def _sudo_ls_json(trace_dir):
    """List .json files in trace_dir as klaude user, sorted by mtime (newest last)."""
    result = subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "find", trace_dir, "-maxdepth", "1", "-name", "*.json", "-printf", "%T@ %p\n"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return []
    lines = sorted(result.stdout.strip().split("\n"))
    return [line.split(" ", 1)[1] for line in lines]


def _read_atif_trace(trace_dir):
    """Read newest ATIF JSON from trace_dir as klaude user."""
    files = _sudo_ls_json(trace_dir)
    if not files:
        return {}
    content = _sudo_read(files[-1])
    if not content:
        return {}
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {}


def _build_downloads_prefix(session, turn) -> str:
    """Prefix klaude sees telling it where to drop files for the user."""
    return (
        f"[downloads — you can share files with the user by writing them to "
        f"downloads/{session.id}/{turn.id}/. "
        f"Max {MAX_FILES_PER_TURN} files, {_fmt_size(MAX_SINGLE_FILE)} each, "
        f"{_fmt_size(MAX_TOTAL_UPLOAD)} total. "
        f"Files exceeding the per-file size will be shown to the user but "
        f"marked as too large to download.]\n\n"
    )


def sudo_write_file(path, content_bytes):
    """Write bytes to `path` as the klaude user. Raises CalledProcessError on failure.

    `path` must be absolute. Uses `tee` via sudo with stdin — no shell, so
    special characters in path are safe.
    """
    subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "tee", "--", path],
        input=content_bytes,
        check=True,
        stdout=subprocess.DEVNULL,
    )


def sudo_mkdir_p(path):
    """mkdir -p `path` as the klaude user."""
    subprocess.run(["sudo", "-u", KLAUDE_USER, "mkdir", "-p", path], check=True)


def sudo_rm_rf(path):
    """rm -rf `path` as the klaude user. Caller MUST validate `path` first."""
    subprocess.run(["sudo", "-u", KLAUDE_USER, "rm", "-rf", "--", path], check=True)


def sudo_read_bytes(path):
    """Read bytes from `path` as the klaude user. Returns bytes or None."""
    result = subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "cat", "--", path],
        capture_output=True,
    )
    return result.stdout if result.returncode == 0 else None


def _execute_klaude(turn, is_continuation):
    """Run klaude CLI as the klaude user. Returns result dict."""
    session = turn.session
    workspace_dir = os.path.join(WORKSPACE_BASE, session.workspace)
    trace_dir = session.trace_path

    # Create dirs as klaude user (Django runs as nam, can't write to /home/klaude/)
    subprocess.run(["sudo", "-u", KLAUDE_USER, "mkdir", "-p", trace_dir], check=True)
    subprocess.run(["sudo", "-u", KLAUDE_USER, "mkdir", "-p", workspace_dir], check=True)

    cmd = ["sudo", "-u", KLAUDE_USER, KLAUDE_BIN]
    if is_continuation:
        cmd.append("-c")
    effective_prompt = _build_downloads_prefix(session, turn) + _build_prompt_with_attachments(turn)
    cmd += [effective_prompt, "--auto-approve", "--session-dir", trace_dir]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=600,
        cwd=workspace_dir,
    )

    atif = _read_atif_trace(trace_dir)

    # Metrics from ATIF final_metrics
    fm = atif.get("final_metrics", {})
    token_count = fm.get("total_prompt_tokens", 0) + fm.get("total_completion_tokens", 0)
    tool_calls_count = sum(len(s.get("tool_calls", [])) for s in atif.get("steps", []) if s.get("source") == "agent")

    # Summary from last agent step with content
    summary = ""
    for step in reversed(atif.get("steps", [])):
        if step.get("source") == "agent" and step.get("message"):
            summary = step["message"][:500]
            break

    error = result.stderr if result.returncode != 0 else ""
    if not error and not atif:
        error = "klaude produced no trace output"

    return {
        "summary": summary,
        "token_count": token_count,
        "tool_calls": tool_calls_count,
        "error": error,
    }


@app.task(max_retries=0)
def run_turn(turn_id):
    """Execute a klaude turn."""
    try:
        turn = Turn.objects.select_related("session").get(id=turn_id)
    except Turn.DoesNotExist:
        return

    if turn.status != "approved":
        return

    session = turn.session

    turn.status = "running"
    turn.started_at = timezone.now()
    turn.save()
    session.status = "running"
    session.save(update_fields=["status"])

    is_continuation = session.turns.filter(status="done").exclude(id=turn.id).exists()

    try:
        result = _execute_klaude(turn, is_continuation)
        turn.status = "done" if not result["error"] else "failed"
        turn.summary = result["summary"]
        turn.token_count = result["token_count"]
        turn.tool_calls = result["tool_calls"]
        turn.error = result["error"]
        if turn.status == "done":
            try:
                _register_downloads(turn)
            except Exception:
                # Registration failures must never surface as turn failure
                logger.exception("_register_downloads failed for turn %s", turn.id)
    except Exception as e:
        turn.status = "failed"
        turn.error = str(e)

    turn.completed_at = timezone.now()
    turn.save()

    session.status = turn.status
    session.save(update_fields=["status"])


_DOWNLOAD_REL_RE = re.compile(r"downloads/\d+/\d+")


def _register_downloads(turn):
    """After a turn completes, scan its downloads dir and create Download rows."""
    session = turn.session
    if not session.workspace:
        return
    rel_dir = f"downloads/{session.id}/{turn.id}"
    if not _DOWNLOAD_REL_RE.fullmatch(rel_dir):
        return  # defensive: should be unreachable
    abs_dir = os.path.join(WORKSPACE_BASE, session.workspace, rel_dir)

    result = subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "find", abs_dir, "-maxdepth", "1", "-type", "f", "-printf", "%f|%s\n"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return

    servable_total = 0
    created = 0
    for line in result.stdout.strip().split("\n"):
        try:
            name, size_str = line.rsplit("|", 1)
            size = int(size_str)
        except (ValueError, IndexError):
            continue
        if created >= MAX_FILES_PER_TURN:
            break
        oversize = size > MAX_SINGLE_FILE
        if not oversize and servable_total + size > MAX_TOTAL_UPLOAD:
            break
        Download.objects.create(turn=turn, filename=name, size=size, oversize=oversize)
        if not oversize:
            servable_total += size
        created += 1


@app.task(max_retries=0)
def sync_listens():
    """Daily sync of YouTube Music history + liked tracks (rebuilds the graph inline — no
    request timeout to worry about on the beat schedule)."""
    from website.views.listen import _do_sync

    try:
        result = _do_sync()
        logger.info(
            "Listens sync complete: %d history, %d liked, %d frequent",
            result["synced_history"],
            result["synced_liked"],
            result["synced_frequent"],
        )
    except Exception:
        logger.exception("Automated listens sync failed (likely expired browser auth)")


@app.task(max_retries=0)
def rebuild_listen_graph():
    """Rebuild the listening graph off the request path.

    The Last.fm similarity pass takes minutes; the web sync view dispatches this so it doesn't
    exceed gunicorn's request timeout. Non-fatal by construction (`_rebuild_graph` never raises).
    """
    from website.views.listen import _rebuild_graph

    _rebuild_graph()


@app.task(max_retries=0)
def enrich_ladder():
    """Daily task: fetch current ELO/rank from Relic and backfill per-match relic data.

    Steps:
    1. GET getPersonalStat → cache current ELO/rank in Redis under ``aoe2:ladder_stat``.
    2. GET getRecentMatchHistory → for each 1v1 RM match not yet enriched, try to match
       against a local Aoe2Match using played_at proximity + civ alignment.

    Matching approach
    -----------------
    For rows where played_at is set (extracted from the rec filename at upload), we use
    that for the ±2h window.  Rows without played_at fall back to created_at as a rough proxy.

    Match-to-local-row algorithm (best-effort):
    - For each relic match (with completiontime epoch) find unenriched Aoe2Match rows
      whose effective_time (played_at if set, else created_at) is within 2 hours.
    - Among those candidates, prefer the row whose my_civ matches the relic civ name.
    - If exactly one candidate passes, enrich it.  If multiple pass, take the closest.
    - If no match, log at DEBUG and skip (next daily run will retry once new recs arrive).

    The task is idempotent: rows with relic_match_id already set are skipped.
    """

    from datetime import datetime as dt
    from datetime import timedelta
    from datetime import timezone as dt_tz

    import django.db.models.functions as dbf
    from django.core.cache import cache
    from django.utils import timezone as tz

    from website.aoe2.relic import get_personal_stat, get_recent_1v1_matches

    profile_id = dj_settings.AOE2_PROFILE_ID

    # -- 1. Current ladder ELO/rank ------------------------------------------
    try:
        stat = get_personal_stat(profile_id)
        cache.set("aoe2:ladder_stat", stat, timeout=None)  # persisted until next run
        logger.info("enrich_ladder: current ELO=%s rank=%s", stat.get("rating"), stat.get("rank"))
    except Exception:
        logger.exception("enrich_ladder: failed to fetch personal stat")
        # Non-fatal: continue to backfill existing rows.

    # -- 2. Backfill per-match relic data ------------------------------------
    try:
        relic_matches = get_recent_1v1_matches(profile_id)
    except Exception:
        logger.exception("enrich_ladder: failed to fetch recent match history")
        return

    enriched = 0
    skipped = 0

    for rm in relic_matches:
        # Skip already-matched matches (idempotent by relic_match_id uniqueness check).
        if Aoe2Match.objects.filter(relic_match_id=rm["relic_match_id"]).exists():
            skipped += 1
            continue

        if not rm.get("completiontime"):
            logger.debug("enrich_ladder: relic match %s has no completiontime, skipping", rm["relic_match_id"])
            continue

        completion_dt = dt.fromtimestamp(rm["completiontime"], tz=dt_tz.utc)

        # Candidate rows: unenriched done matches within ±2 hours of completiontime.
        window = timedelta(hours=2)
        # Use played_at when set; fall back to created_at.
        candidates = (
            Aoe2Match.objects.filter(
                analysis_status=Aoe2Match.Status.DONE,
                relic_match_id__isnull=True,
            )
            .annotate(
                effective_time=dbf.Coalesce("played_at", "created_at"),
            )
            .filter(
                effective_time__gte=completion_dt - window,
                effective_time__lte=completion_dt + window,
            )
        )

        if not candidates.exists():
            logger.debug(
                "enrich_ladder: no candidate rows within ±2h of relic match %s (completion=%s)",
                rm["relic_match_id"],
                completion_dt,
            )
            continue

        # Take the row whose effective_time is closest to completiontime.
        # NOTE: Relic civ_id uses a different numeric scheme than our dat-based
        # civ names, so a civ equality check would silently reject valid matches.
        # We rely solely on the ±2h time window + closest-time tiebreak.
        best = None
        best_delta = None
        for row in candidates:
            eff = row.played_at or row.created_at
            if eff is None:
                continue
            delta = abs((eff - completion_dt).total_seconds())
            if best_delta is None or delta < best_delta:
                best = row
                best_delta = delta

        if best is None:
            continue

        best.relic_match_id = rm["relic_match_id"]
        best.relic_enriched_at = tz.now()
        if rm.get("my_new") is not None:
            best.my_elo = rm["my_new"]
        if rm.get("my_old") is not None and rm.get("my_new") is not None:
            best.my_rating_change = rm["my_new"] - rm["my_old"]
        if rm.get("opp_new") is not None:
            best.opponent_elo = rm["opp_new"]
        if rm.get("my_outcome") in ("win", "loss"):
            best.my_result = rm["my_outcome"]
        best.save(
            update_fields=[
                "relic_match_id",
                "relic_enriched_at",
                "my_elo",
                "my_rating_change",
                "opponent_elo",
                "my_result",
            ]
        )
        enriched += 1
        logger.info("enrich_ladder: enriched match id=%s relic_match_id=%s", best.id, rm["relic_match_id"])

    logger.info("enrich_ladder: done — enriched=%d skipped_already_done=%d", enriched, skipped)


@app.task(max_retries=0)
def analyze_match(match_id, run_coach=True):
    """Parse a stored rec into metrics + the v2 preprocessing bundle.

    Gates:
    - ranked 1v1 only: non-ranked or non-1v1 → analysis_status="skipped" (not shown publicly).
    - ranked detection: header["de"]["rated"] boolean, verified reliable across all DE recs.

    `run_coach` (default True): when False, run ONLY the deterministic preprocessing (reconstruction,
    economy, classifier, mistakes, strategic map) and skip the LLM coach — the "preprocess now, coach
    lazy" path for bulk backfills (the opus coach is the slow / session-limited stage). Run the coach
    later with `coach_match`. Failures → status="error" with error_detail stored.
    """
    try:
        match = Aoe2Match.objects.get(id=match_id)
    except Aoe2Match.DoesNotExist:
        return

    match.analysis_status = Aoe2Match.Status.PARSING
    match.save(update_fields=["analysis_status"])

    try:
        rec = parse_rec(match.rec_file.path, dj_settings.AOE2_PROFILE_ID)

        # Gate: ranked 1v1 only. Non-ranked or non-1v1 games are silently skipped.
        if not rec.is_ranked or not rec.is_1v1 or rec.me is None or rec.opponent is None:
            match.analysis_status = Aoe2Match.Status.SKIPPED
            match.save(update_fields=["analysis_status"])
            return

        timeline = build_timeline(rec.ops, rec.me["number"])
        metrics = compute_metrics(timeline, rec.duration_ms)
        timeline_payload = {k: v for k, v in timeline.items()}
        # Dual log (ME full + OPP key) for the coach; legacy single-player log preserved too.
        dual_log = render_dual_log(rec.ops, rec.me["number"], rec.opponent["number"], timeline["action_count"])
        timeline_payload["salient_log"] = dual_log

        # Stage 2: aoe2coach v2 preprocessing bundle — reconstruct → classify → detect_mistakes →
        # estimate_economy → render strategic-map PNGs. Each producer is internally guarded; a total
        # failure here degrades to the empty bundle (legacy v1 coach path) rather than blocking save.
        bundle = None
        try:
            bundle = build_bundle(rec, dj_settings.MEDIA_ROOT, match.id)
        except Exception:  # noqa: BLE001
            logger.exception("aoe2coach v2 bundle failed for %s — falling back to v1 coach", match_id)

        # Stage 4: LLM coach — graceful; failure must not block the rich data being saved.
        # With a bundle, the agentic opus coach v2 runs over the per-match workspace. Skipped entirely
        # when run_coach is False (preprocess-now / coach-lazy) — coach it later with coach_match. When
        # skipped we leave the EXISTING coach fields untouched (a re-preprocess never wipes a prior
        # analysis); a brand-new match simply keeps its empty defaults.

        match.map_name = rec.map_name
        match.duration_seconds = rec.duration_ms // 1000
        match.game_version = rec.version
        match.my_civ = rec.me["civ_name"]
        match.opponent_civ = rec.opponent["civ_name"]
        match.my_result = rec.my_result
        match.timeline = timeline_payload
        if bundle is not None:
            match.reconstruction = bundle.get("reconstruction", {})
            match.map_geometry = bundle.get("map_geometry", {})
            match.classifier = bundle.get("classifier", {})
            match.mistakes = bundle.get("mistakes", [])
            match.economy = bundle.get("economy", {})
            match.map_images = bundle.get("map_images", [])
            # Deterministic opening baseline (no LLM) — a coached run overrides it below with the
            # LLM's read when present. Ensures preprocess-only matches still carry an opening tag.
            metrics["opening"] = _classifier_opening(bundle)
        if run_coach:
            # Featured (⭐) matches get opus; everything else the volume default (haiku).
            coach_model_choice = "opus" if match.featured else None
            coach_analysis, coach_model, opening, coach_tier = _run_coach(
                dual_log, metrics, rec.my_result, bundle=bundle, model=coach_model_choice
            )
            metrics["opening"] = opening
            match.coach_analysis = coach_analysis
            match.coach_model = coach_model
            match.coach_tier = coach_tier
        match.metrics = metrics
        match.analyzed_at = dj_timezone.now()
        match.analysis_status = Aoe2Match.Status.DONE
        match.save()
    except Exception as exc:  # noqa: BLE001 — fail loud, store the reason
        logger.exception("analyze_match failed for %s", match_id)
        match.analysis_status = Aoe2Match.Status.ERROR
        match.error_detail = str(exc)[:2000]
        match.save(update_fields=["analysis_status", "error_detail"])


@app.task(max_retries=0)
def coach_match(match_id):
    """Run ONLY the LLM coach for an already-preprocessed match (the lazy half of preprocess-now).

    Rebuilds the v2 bundle (re-parse + build_bundle is deterministic and cheap — it gives the coach
    the reconstruction object, classifier candidates, and freshly-rendered map PNGs it needs) and runs
    `_run_coach` over it, reusing the stored salient log + metrics. Saves the coach fields ONLY ON
    SUCCESS, so a session-limited / failed run never wipes an existing coach analysis. No-op for
    matches that aren't done or aren't ranked-1v1.
    """
    try:
        match = Aoe2Match.objects.get(id=match_id)
    except Aoe2Match.DoesNotExist:
        return
    try:
        rec = parse_rec(match.rec_file.path, dj_settings.AOE2_PROFILE_ID)
        if not rec.is_ranked or not rec.is_1v1 or rec.me is None or rec.opponent is None:
            return
        bundle = None
        try:
            bundle = build_bundle(rec, dj_settings.MEDIA_ROOT, match.id)
        except Exception:  # noqa: BLE001
            logger.exception("coach_match bundle rebuild failed for %s — coaching facts-only", match_id)
        dual_log = (match.timeline or {}).get("salient_log", "")
        metrics = match.metrics or {}
        # Featured (⭐) matches get opus; everything else the volume default (haiku).
        coach_model_choice = "opus" if match.featured else None
        coach_analysis, coach_model, opening, coach_tier = _run_coach(
            dual_log, metrics, rec.my_result, bundle=bundle, model=coach_model_choice
        )
        if not coach_analysis:
            logger.warning("coach_match got empty coach for %s (rate-limited?) — leaving existing untouched", match_id)
            return
        metrics["opening"] = opening
        match.coach_analysis = coach_analysis
        match.coach_model = coach_model
        match.coach_tier = coach_tier
        match.metrics = metrics
        match.save(update_fields=["coach_analysis", "coach_model", "coach_tier", "metrics"])
    except Exception:  # noqa: BLE001 — never crash the worker; the deterministic data is already saved
        logger.exception("coach_match failed for %s", match_id)
