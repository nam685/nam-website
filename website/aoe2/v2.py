"""Assemble the aoe2coach v2 preprocessing bundle for one match.

`analyze_match` (website/tasks.py) stays thin: parse the rec, then call `build_bundle(rec)` here to
produce the full v2 payload (reconstruction → classify → detect_mistakes → estimate_economy → render
strategic-map PNGs). The agentic opus coach runs separately in tasks._run_coach over the same data.

Everything in this module is pure-ish over a ParsedRec + a MEDIA dir; the only side effect is writing
the strategic-map PNGs (sub-project #7). No DB, no network, no LLM here.

HONESTY (program-wide): we surface the producers' tier labels verbatim. `*_produced` counts stay
labeled "produced"; the economy block carries `estimate: true` and may self-suppress `collected`
(None) → the frontend shows qualitative-only. We never fabricate a number a producer didn't emit.
"""

import logging
import os

import aoe2coach as a
from aoe2coach.mapviz import render
from aoe2coach.mistakes import load_one

logger = logging.getLogger(__name__)


def _slim_map_geometry(recon: dict) -> dict:
    """The slice the frontend minimap (#5 V1) needs to draw the schematic, in GAME coords.

    The frontend auto-fits a viewBox over these raw spatial coords (it does not consume the
    Pillow-projected layout — that is for the rendered PNG only). Degrades gracefully on absent
    spatial data: missing keys simply produce empty lists / None.
    """
    meta = recon.get("meta", {}) or {}
    sp = recon.get("spatial", {}) or {}
    me = sp.get("me", {}) or {}
    opp = sp.get("opp", {}) or {}
    engagements = (recon.get("combat", {}) or {}).get("me", {}).get("engagements", []) or []
    return {
        "map_name": meta.get("map") or "",
        "map_dim": meta.get("map_dim"),
        "duration_s": meta.get("duration_s"),
        "me": {
            "base_centroid": me.get("base_centroid"),
            "buildings": me.get("buildings", []) or [],
            "forward": me.get("forward", []) or [],
            "walls": me.get("walls", []) or [],
        },
        "opp": {
            "base_centroid": opp.get("base_centroid"),
            "buildings": opp.get("buildings", []) or [],
            "walls": opp.get("walls", []) or [],
        },
        "engagements": engagements,
    }


def _enrich_mistakes(flagged_dicts: list[dict]) -> list[dict]:
    """Attach each flagged mistake's user-facing rubric fields (#6) so the frontend can deep-link.

    `detect_mistakes` returns rows carrying only `reference_path`; the study URL/title, explanation,
    and fix live in the rubric YAML. We load each flagged rubric once and merge in the fields the
    `source.study` deep-link + the mistakes list need. Best-effort: a missing rubric leaves the row
    as-is rather than dropping the honest flag.
    """
    out = []
    for f in flagged_dicts:
        row = dict(f)
        mid = row.get("id")
        try:
            rubric = load_one(mid) if mid else {}
        except FileNotFoundError:
            rubric = {}
        if rubric:
            src = rubric.get("source", {}) or {}
            row["explanation"] = rubric.get("explanation", "")
            row["fix"] = rubric.get("fix", "")
            row["source"] = {
                "ref": src.get("ref", ""),
                "detail": src.get("detail", ""),
                "study": src.get("study", {}) or {},
            }
        out.append(row)
    return out


def build_bundle(rec, media_root, match_id):
    """Run the full v2 producer chain over a ParsedRec. Returns a dict of persistable fields.

    Args:
      rec: a ParsedRec (from aoe2coach.parse_rec); must be a ranked 1v1 with me/opponent set
           (already owner-resolved against AOE2_PROFILE_ID by parse_rec).
      media_root: MEDIA_ROOT; strategic-map PNGs are written under <media_root>/aoe2/maps/<match_id>/.
      match_id: used to namespace the rendered map PNGs.

    Returns a dict with keys: reconstruction, map_geometry, classifier, mistakes, economy,
    map_images (relative-to-MEDIA paths), map_png_paths (absolute, for the coach workspace),
    candidates (the #3 ClassificationResult, for the coach), recon_obj (the Reconstruction object).
    Each producer is independently guarded — a failure in one stage degrades that field to its empty
    default rather than failing the whole analysis.
    """
    recon_obj = a.reconstruct(rec)
    recon = recon_obj.to_dict()

    # --- #3 classifier (deterministic, no LLM) ---
    try:
        classification = a.classify(recon_obj)
        classifier_dict = classification.to_dict()
    except Exception:  # noqa: BLE001 — degrade this field only
        logger.exception("classify failed for match %s", match_id)
        classification = None
        classifier_dict = {}

    # --- #6 mistakes (deterministic; [] = honest "no mistakes") ---
    try:
        flagged = a.detect_mistakes(recon_obj)
        mistakes_dicts = _enrich_mistakes([f.to_dict() for f in flagged])
    except Exception:  # noqa: BLE001
        logger.exception("detect_mistakes failed for match %s", match_id)
        flagged = []
        mistakes_dicts = []

    # --- #2 economy ESTIMATE (Tier-B; may self-suppress) ---
    try:
        economy = a.estimate_economy(
            rec.ops,
            player=rec.me["number"],
            gaia_list=rec.gaia_objects,
            recon=recon_obj,
        )
    except Exception:  # noqa: BLE001
        logger.exception("estimate_economy failed for match %s", match_id)
        economy = {}

    # --- #7 strategic-map PNGs (overall + per-engagement) ---
    map_images = []
    map_png_paths = []
    try:
        out_dir = os.path.join(media_root, "aoe2", "maps", str(match_id))
        map_png_paths = render.render_maps(recon_obj, out_dir, prefix="map")
        # Store paths relative to MEDIA_ROOT so the frontend can request them under /media/.
        map_images = [os.path.relpath(p, media_root) for p in map_png_paths]
    except Exception:  # noqa: BLE001
        logger.exception("render_maps failed for match %s", match_id)

    return {
        "reconstruction": recon,
        "map_geometry": _slim_map_geometry(recon),
        "classifier": classifier_dict,
        "mistakes": mistakes_dicts,
        "economy": economy,
        "map_images": map_images,
        "map_png_paths": map_png_paths,
        "candidates": classification,
        "recon_obj": recon_obj,
    }
