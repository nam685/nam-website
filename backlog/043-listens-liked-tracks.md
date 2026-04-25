---
status: done
priority: medium
labels: [listens, feature]
---

# Sync liked tracks from YouTube Music

Currently `listen_sync` only calls `yt.get_history()` which returns recently played tracks. It should also fetch the user's liked/saved tracks via `yt.get_liked_songs()` (or equivalent ytmusicapi method) and store them.

## Acceptance criteria
- Sync pulls liked/saved tracks in addition to play history
- Liked tracks are deduplicated against existing records
- Optionally flag tracks as `liked=True` in the model (new boolean field) so the frontend can distinguish them
