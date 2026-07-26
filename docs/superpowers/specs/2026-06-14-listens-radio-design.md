# Auto Play (Radio) for Nam Listens — Design

**Date:** 2026-06-14
**Status:** Approved

## Overview

Add an **endless radio mode** to the global music player. When enabled, the queue
never dead-ends: as the current queue nears its end, the player fetches more tracks
**related to what's playing** (via the existing music graph) and appends them, so
playback continues indefinitely.

Today the player auto-advances *within* a finite queue and stops when it runs out.
Clicking a node on `/listens` plays a one-track queue (`player.play(track, [track])`),
so it stops after a single song. Radio mode turns any playback into a continuous station.

## Backend

### Service: `radio_next` in `website/services/music_graph.py`

```
radio_next(seed_video_id, exclude_video_ids, limit=5) -> list[dict]
```

Pure graph-based selection:

1. Find the seed `track` node by `video_id`. If none, return `[]`.
2. Collect candidate **track** nodes reachable from the seed:
   - Direct track neighbors via `similar_track` and `colisten` edges (highest priority).
   - Tracks one hop further through `structural` / `similar_artist` edges (same artist,
     similar artists) — broader reach so radio doesn't dead-end on a thin neighborhood.
3. Score each candidate by `edge_weight × edge_type_priority`
   (similar_track / colisten > artist-hop).
4. Drop anything in `exclude_video_ids` (and the seed itself).
5. **Weighted-random pick** among the top candidates for variety → up to `limit` tracks.
6. Shape each returned track like the frontend `ListenTrack`
   (`id, video_id, title, artist, album, thumbnail_url, duration`). Graph nodes store
   `title`/`subtitle(artist)`/`thumbnail_url`/`video_id` only; `album`/`duration`/`id`
   are filled from the latest `ListenTrack` row for that `video_id` (batched query).
7. If the neighborhood is genuinely empty, return `[]` → radio stops gracefully.

### Endpoint

```
GET /api/listens/radio/?seed=<video_id>&exclude=<comma-separated video_ids>
    -> {"tracks": [ListenTrack, ...]}
```

- Public (matches the other listens GET endpoints).
- `exclude` capped to the most recent ~40 ids server-side to keep URLs sane.
- Wired in `website/views/listen.py` + `website/urls.py`.
- Added to the endpoint list in `CLAUDE.md`.

## Frontend

### Player — `frontend/src/lib/player.tsx`

- Add `radio: boolean` to state + a `toggleRadio()` action, persisted to sessionStorage
  alongside `shuffle`/`repeat`.
- **Proactive top-up:** when auto-advancing or on `next()`, if radio is on and the
  remaining queue ≤ 2 tracks, fetch a radio batch (seeded by the current track,
  excluding queued + recently played ids) and append. Avoids a silent gap at track end.
- In `handleTrackEnd`: when radio is on, never hit the "queue exhausted → stop" branch —
  extend instead.
- Interaction rules:
  - `repeat: one` still wins (replays current track).
  - Radio overrides "stop at end" and end-of-queue looping.
  - Shuffle still works within the (growing) queue.

### MiniPlayer — `frontend/src/components/MiniPlayer.tsx`

- Add a **radio toggle button** next to shuffle/repeat, lit orange (`#f97316`) when active.

### Pure helpers (testable) — `frontend/src/lib/`

- `shouldTopUp(queueLen, currentIdx, radioOn)` — top-up decision.
- An exclude-list builder that takes the queue + recent history and returns the capped
  list of video ids to exclude.

## Defaults / Decisions

- Radio is **off by default**; the user opts in via the toggle.
- Clicking a single node on `/listens` does **not** auto-enable radio (manual toggle only).
  Single-click stations can be a follow-up.

## Testing

- **Backend (pytest):** `website/tests/test_listens_radio.py`
  - `radio_next` returns related tracks for a seeded graph.
  - Respects `exclude_video_ids` and excludes the seed.
  - Returns `[]` for an isolated node.
  - Endpoint returns the correct `{"tracks": [...]}` shape and track fields.
- **Frontend (vitest):** unit-test the pure helpers (`shouldTopUp`, exclude builder).
- **Manual (Playwright):** verify the toggle, continuous playback, and end-of-track
  top-up in a running dev server.

## Docs

- Update `docs/README.md` (listens section) — describe radio mode.
- Update `docs/QA-CHECKLIST.md` — add radio toggle + continuous-playback checks.
