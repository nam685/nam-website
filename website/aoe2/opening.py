"""Deterministic opening-family tag from a match's stored #3 classifier (no LLM).

The opening badge in the /plays Aoe2Tab comes from `match.metrics["opening"]`, which is set from
`parse_opening(coach_raw_text)` — it only fires when the LLM coach emits a `- Opening: <tag>` bullet.
Since volume matches coach on haiku (opus is reserved for ⭐ featured), that bullet is frequently
omitted/malformed, leaving the tag blank. The deterministic build-order classifier (#3) always runs
during preprocessing and stores its candidates on every match, so its top candidate's `family` is the
right fallback — and it speaks the exact slug vocabulary (scouts/archers/maa/drush/knights/fast_castle/
drush_fc/trash) the frontend already colors and labels.
"""

from aoe2coach.buildorders import load_one


def opening_from_classifier(classifier: dict) -> str:
    """Opening family from the classifier's top candidate, or "" when unusable.

    `classifier` is the stored dict shape {candidates: [{build_id, ...}], unknown, ...}. The top
    candidate's `build_id` is a build-order reference slug; its `family` is the canonical opening tag.
    """
    if not isinstance(classifier, dict):
        return ""
    candidates = classifier.get("candidates") or []
    if not candidates:
        return ""
    build_id = (candidates[0] or {}).get("build_id") or ""
    if not build_id:
        return ""
    try:
        return (load_one(build_id) or {}).get("family", "") or ""
    except (FileNotFoundError, ValueError):
        # Unknown/old slug or a guarded-against path-traversal id — no tag rather than a crash.
        return ""
