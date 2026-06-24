"""Deterministic opening-family tag from a match's stored #3 classifier (no LLM).

The opening badge in the /plays Aoe2Tab comes from `match.metrics["opening"]`, which is set from
`parse_opening(coach_raw_text)` — it only fires when the LLM coach emits a `- Opening: <tag>` bullet.
Since volume matches coach on haiku (opus is reserved for ⭐ featured), that bullet is frequently
omitted/malformed, leaving the tag blank. The deterministic build-order classifier (#3) always runs
during preprocessing and stores its candidates on every match, so its top candidate's `family` is the
right fallback — and it speaks the exact slug vocabulary (scouts/archers/maa/drush/knights/fast_castle/
drush_fc/trash) the frontend already colors and labels.
"""

import re

from aoe2coach.buildorders import load_one

# The opening badge is a terse label ("Fast Castle", "Scouts into Knights"). The LLM coach
# (esp. haiku) sometimes writes a whole explanatory sentence into the `- Opening:` bullet, e.g.
# "dark age boom (never feudal) — you made only villagers...". Cut at the first explanation
# delimiter (dash / paren / colon / semicolon / comma) and keep only the leading words. Plain
# hyphens are NOT split on, so compound tags like "fast-castle" survive.
_OPENING_DELIM = re.compile(r"\s*(?:[—–]| - |[(:;,])")
MAX_OPENING_WORDS = 4


def cap_opening(text: str, max_words: int = MAX_OPENING_WORDS) -> str:
    """Trim an opening tag to a terse badge: cut at the first explanation delimiter and keep at
    most max_words words. Empty/blank in → "" out."""
    if not text:
        return ""
    head = _OPENING_DELIM.split(text.strip(), maxsplit=1)[0]
    capped = " ".join(head.split()[:max_words])
    return capped.rstrip(" ,.;:-—–")


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
