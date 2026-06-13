---
status: done
priority: medium
labels: [listens, frontend, ux]
---

# Soft-sorted tracks page (weighted shuffle, no play count)

`/listens/tracks` currently shows a hard-sorted list ranked by play count with the count displayed. Two changes:

1. **Remove play count display** — don't show the number of listens per track on the public tracks page.
2. **Weighted shuffle instead of strict sort** — instead of deterministic descending order, use a soft sort: randomly shuffled but weighted so more-listened tracks tend to appear higher. This makes the page feel less static and more like a living playlist.

## Implementation ideas
- Backend: add a query param like `?sort=weighted` to `/api/listens/tracks/` that returns a weighted-random ordering (e.g., assign each track a score of `play_count * random()` and sort by that). Cache for ~5 min so it doesn't reshuffle on every page load.
- Frontend: use the new sort mode by default on the tracks page. Remove the play count column/badge.
