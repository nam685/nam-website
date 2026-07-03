# Listens shuffle + radio: shared sampling kernel + hub-diversity penalty

**Date:** 2026-07-03
**Branch:** `feat/listens-shuffle-unify`
**Status:** Design — awaiting review

## Problem

The `/listens` **shuffle button** (`loadPatch()` → seedless `music_graph.get_patch`) feels
low-entropy — every press looks like the same cluster of songs. Empirical sampling against the
prod DB (2026-07-03) isolated the cause to a layer *below* the one #277 fixed:

- **Seed selection is already high-entropy.** 500 seedless picks → 158 distinct seeds, 6.96 bits
  (95% of the theoretical max), top seed only 2.4%. The #277 song-forward picker works.
- **The patch the user sees is hub-dominated.** Over 200 shuffle presses: three *mikuta* tracks
  each appeared in ~80% of all patches; the top-20 hub nodes accounted for 33% of every node ever
  shown. The seed key changes (~53% unique per press) but the surrounding BFS neighborhood does
  not, because a handful of super-connected nodes are neighbors of almost everything.

Separately, the two recommendation features are **two independent implementations** of the same
idea (score candidates → damped weighted-random over a top-K pool → avoid recents), with
independently-tuned constants:

| | Shuffle (`get_patch` / `_pick_recommended_seed`) | Radio (`radio_next`) |
|---|---|---|
| Candidates | global, by `recommend_score` | seed-local BFS depth-2 |
| Damping | `sqrt(score)` | **linear** |
| Pool size | 60 | 12 |
| Anti-repeat | Redis ring of last 8 seed keys | frontend list of last 40 `video_id`s |

Because they don't share code, #277's `sqrt` damping never reached radio. nam asked that the two
features "share algo as much as possible."

## Goal

1. **Unify** the shared sampling step behind one function so tuning stops diverging.
2. **Fix** the felt repetition with a hub-diversity penalty that lives in the shared layer, so
   both features benefit at once.

Non-goals: changing candidate *generation* (global-by-score vs. seed-local-BFS is inherent to what
each feature does); redesigning the graph model beyond one added field; frontend changes.

## Design

### Component 1 — Shared sampling kernel

New pure function in `website/services/music_graph.py`:

```python
def damped_weighted_sample(items, scores, k=1, *, damping=math.sqrt, rng=random):
    """Pick up to k distinct items by weighted-random over damping(score), without replacement.

    items/scores are parallel sequences. Returns a list (len <= k, <= len(items)).
    Non-positive damped weights are treated as 0; an all-zero pool falls back to uniform.
    """
```

Callers change to route through it:

- **`_pick_recommended_seed`** — currently `rng.choices(pool, weights=[sqrt(score)...], k=1)`.
  Becomes `damped_weighted_sample(pool, [n.recommend_score or 1.0 for n in pool], k=1)[0]`.
  Behavior preserved (still `sqrt`, still k=1).
- **`radio_next`** — currently a hand-rolled without-replacement loop over linear weights.
  Becomes `damped_weighted_sample(nodes, raw_scores, k=limit)`. This intentionally **upgrades
  radio from linear → `sqrt`**, giving it the same variety tuning shuffle already has.

Anti-repeat exclusion stays in each caller: the *sources* differ (Redis key-ring vs. frontend
`video_id` list), and each caller already filters its candidate list before scoring. Only the
sampling math is shared — the right seam.

### Component 2 — Hub-diversity penalty

Add node degree to the graph and down-weight high-degree nodes in the shared layer.

- **Model:** add `degree = models.PositiveIntegerField(default=0)` to `MusicNode` (migration).
- **Population:** during the graph rebuild (where edges are (re)written), set each node's `degree`
  to its edge count in one pass. Degree is only meaningful post-rebuild; default 0 is safe (see
  helper below).
- **Helper:** `_hub_weight(degree) -> float = 1.0 / (1.0 + math.log1p(degree))`. Degree 0 → 1.0
  (no penalty), degree 100 → ~0.18. Log-damped: hubs still surface sometimes (they *are* nam's
  most-played music) but stop saturating every patch.

Applied in two places:

1. **`radio_next` candidate scoring** — multiply each candidate's BFS score by
   `_hub_weight(node.degree)` before sampling. Radio stops always serving the same hub tracks.
2. **`get_patch` neighborhood assembly** — today BFS collects neighbors first-come until the
   40-node cap. Change: gather all reachable neighbor ids with their accumulated edge score, then
   fill the patch (after the seed) by `damped_weighted_sample` over `score * _hub_weight(degree)`
   down to the cap — so the same three mikuta hubs no longer fill 80% of patches. Seed node is
   always included; connectivity for rendered edges is preserved by only including nodes actually
   reached via BFS.

### Data flow (unchanged shape)

`graph_patch` view → `get_patch(seed_key=None, exclude_keys=<redis ring>)` → `_pick_recommended_seed`
(→ kernel) picks seed → BFS neighborhood assembled with hub penalty (→ kernel) → JSON patch.

`fetchAndAppendRadio` (frontend) → `radio_next(seed, exclude=<last 40>)` → BFS candidates scored
with hub penalty → kernel picks `limit` next tracks.

## Testing & verification

**Unit (pytest):**
- `damped_weighted_sample`: respects k, no replacement, all-zero-weight uniform fallback, honors
  `damping`, deterministic under a seeded `rng`.
- `_hub_weight`: monotonic decreasing, degree 0 → 1.0.
- Synthetic hub-heavy graph: a degree-50 hub node is picked markedly less often than a degree-2
  node of equal raw score, in both `radio_next` and `get_patch`.
- Regression: existing #277 tests still pass (song-forward >50% tracks, ≥8 distinct in 100 draws,
  exclusions respected).

**Real-data verification (prod DB):** re-run the three saved sampling scripts
(`shuffle_sample.py`, `patch_sample.py`, `radio_sample.py`) against prod after the change.
Acceptance targets:
- No single node appears in >40% of patches (down from ~80%).
- Top-20 hubs account for <25% of node appearances (down from 33%).
- Radio distinct-tracks-per-session and global library reach increase; seed entropy stays ≥6.9 bits.

Prod validation runs the new `music_graph.py` against the live DB via the sampling scripts before
merge (copy the branch's service module to a scratch path on the server and import it, or run after
deploy and revert if targets miss).

## Tuning knobs (defaults chosen, easily changed)

- Damping: `sqrt` everywhere.
- `_hub_weight`: `1/(1+log1p(degree))` (moderate). Steeper (`1/(1+degree**0.7)`) if variety still
  feels low after re-sampling; gentler if favorites get buried.
- Pool sizes unchanged (60 shuffle / 12 radio).
