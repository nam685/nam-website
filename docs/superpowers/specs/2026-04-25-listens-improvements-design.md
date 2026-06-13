# Listens Improvements Design

Three changes to the listens feature: liked tracks sync, soft-sorted tracks page, and automated daily sync with easy re-auth.

## 1. Liked Tracks Sync

### Model change
Add `is_liked` boolean field to `ListenTrack` (default `False`). Migration needed.

### Sync change
In `listen_sync`, after fetching `yt.get_history()`, also call `yt.get_liked_songs(limit=100)`. For each liked song:
- Create a `ListenTrack` with `is_liked=True` and `played_at=now` (liked songs don't have a play timestamp)
- Dedup: skip if a record with same `video_id` and `is_liked=True` already exists (liked tracks are idempotent — you either like a song or you don't)

The Celery daily task (feature 3) will also sync liked tracks.

## 2. Soft-Sorted Tracks Page

### Backend
Add `?sort=weighted` query param to `listen_top_tracks` view. When present:
- Fetch all unique tracks with their `play_count` via the existing aggregation query
- For each track, compute `score = play_count * random.random()`
- Sort by score descending
- Cache the full sorted list in Redis for 5 minutes (key: `listen_tracks_weighted`) so pagination across the same shuffle is consistent
- Return paginated slice from the cached list

Default sort (no param) remains the existing hard sort for backwards compat.

### Frontend (`tracks/page.tsx`)
- Fetch with `?sort=weighted` by default
- Remove the `{track.play_count}×` display (the rightmost column)
- Remove the top-3 accent styling on rank numbers — use uniform color for all ranks

## 3. Automated Daily Sync + Easy Re-Auth

### Celery Beat task
New task `sync_listens` in `website/tasks.py`:
- Reuses the sync logic from `listen_sync` view (extract into a shared helper `_do_sync()` in `website/views/listen.py` that both the view and task call)
- Handles auth errors gracefully — logs warning, does not raise (so Celery doesn't retry endlessly with expired cookies)

Add to `config/settings.py`:
```python
from celery.schedules import crontab
CELERY_BEAT_SCHEDULE = {
    "sync-listens-daily": {
        "task": "website.tasks.sync_listens",
        "schedule": crontab(hour=4, minute=0),  # 4am UTC daily
    },
}
```

### Re-auth endpoint
`POST /api/listens/reauth/` (admin-only):
- Accepts JSON body `{"headers": "<raw request headers text>"}`
- Parses the pasted headers (format: `Header-Name: value\n...`) into a JSON dict
- Computes the SAPISIDHASH authorization header from the cookie (same logic already in `listen_sync`)
- Writes to `browser.json` (path from `YTMUSIC_BROWSER_JSON` env var or default)
- Returns `{"ok": true}` or `{"error": "..."}` 
- Optionally does a quick validation by instantiating `YTMusic(headers)` and calling a lightweight method

### Frontend re-auth form
Add a re-auth UI in the listens admin section (visible when `isAdmin`). Simple form:
- Textarea for pasting raw request headers
- "Save" button that POSTs to `/api/listens/reauth/`
- Success/error feedback
- Instructions text: "Go to music.youtube.com → DevTools → Network → click a song → right-click the POST request → Copy request headers → paste here"

### URL routing
Add to `website/urls.py`:
```python
path("api/listens/reauth/", listen_views.listen_reauth, name="listen-reauth"),
```

## Files Changed

### Backend
- `website/models/listen.py` — add `is_liked` field
- `website/views/listen.py` — extract `_do_sync()`, add `?sort=weighted`, add `listen_reauth` view, update `listen_sync` to include liked tracks
- `website/views/__init__.py` — export `listen_reauth`
- `website/urls.py` — add reauth route
- `website/tasks.py` — add `sync_listens` task
- `config/settings.py` — add `CELERY_BEAT_SCHEDULE`
- New migration for `is_liked` field

### Frontend
- `frontend/src/app/listens/tracks/page.tsx` — remove play count, use weighted sort
- `frontend/src/app/listens/page.tsx` or layout — add re-auth form for admin

### Tests
- Backend: test weighted sort returns results, test reauth endpoint, test `_do_sync` helper
- Frontend: no new pure-function tests needed (UI-only changes)
