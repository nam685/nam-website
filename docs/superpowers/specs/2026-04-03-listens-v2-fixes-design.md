# Listens Page v2: Layout Fixes, Recommendation Engine, Data Cleanup

## Overview

Fix layout/UX issues on the `/listens` page and add a recommendation system, artist name cleanup, Google Takeout import, and album filtering. Moves feedback button to bottom-left to make room for miniplayer.

## Hero Redesign

### Remove "Latest" Section

The "LATEST" track display is redundant — the History tab already shows recent plays. Replace it with a **Recommended** track.

### Recommendation Engine ("Rediscovery")

A single recommended track displayed in the hero left panel where "Latest" used to be.

**Algorithm:**
1. Query all tracks grouped by `video_id`, annotate with `play_count` and `last_played` (max `played_at`)
2. Filter to top 25% by play count
3. Filter to tracks not played in the last 14 days
4. Compute weight: `play_count * days_since_last_play`
5. Weighted random selection — pick 1 track
6. Fallback: if no candidates qualify (new user, insufficient history), return the most-played track overall

**Endpoint:** `GET /api/listens/recommended/`
- Public
- Returns 1 track: `{ video_id, title, artist, album, thumbnail_url, play_count, last_played }`
- Cached for 1 hour (Redis, same pattern as stats)

**Display:** "RECOMMENDED" label, 72px square thumbnail, title (truncated), artist (truncated), play count badge.

### "Top This Month" Carousel — Constrained

- Max **6 cards** displayed (no horizontal scroll needed)
- Fixed **80x80** square thumbnails with `object-fit: cover`
- Title: single line, ellipsis at ~15 characters
- Artist: single line, ellipsis
- Play count small below artist

### Stats Panel (Right)

Unchanged: total plays, today/week counts, 30-day sparkline, top 3 artists.

### Spacing

Reduce vertical gap between hero bottom and tab bar from current value to `16px` (`gap-4`).

## Card System

### Universal Rules

All thumbnails use **1:1 square aspect ratio** with `object-fit: cover` and `aspect-ratio: 1/1` CSS.

Responsive thumbnail sizing — no fixed pixel values in the spec. Use Tailwind responsive utilities:
- Mobile: smaller thumbnails (natural for single-column)
- Desktop: larger thumbnails (more space available)

Text truncation on all title and artist fields: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`

Play buttons contained within card bounds (`overflow: hidden` on card container).

### History Tab

- **20 items** initially (10 rows x 2 columns on desktop, single column on mobile)
- "Load more" button fetches next 20
- Each card: square thumbnail, title (truncated), artist (truncated), relative timestamp

### Tracks Tab

- Ranked list with text truncation applied
- No other changes

### Artists Tab

- 3-col desktop, 2-col tablet, 1-col mobile
- Artist cards: circular avatar, name (truncated), play count, track count
- Top 3 tracks per artist

### Albums Tab

- Same responsive grid as artists
- **Filter: only albums with 2+ tracks** (hide single-track entries)
- Fixed square album art
- Album name + artist truncated

## Section Transparency

A single semi-transparent panel wrapping the entire content area below the tab bar:

```css
background: rgba(14, 14, 14, 0.5);
backdrop-filter: blur(12px);
border-radius: 12px;
```

The dark vortex page background remains visible through it.

## Feedback Button Relocation

Move the floating feedback button from **bottom-right** to **bottom-left**. The bottom-right position is reserved for the music miniplayer.

## Backend: Artist Name Cleanup

### Problem

YouTube Music API sometimes returns view counts as separate "artist" entries: `[{name: "Grissini Project"}, {name: "89M views"}]`. The sync joins these with commas, producing `"Grissini Project, 89M views"`.

### Fix — Sync Parser

In `listen_sync` (website/views/listen.py), filter artist entries before joining:

```python
import re

VIEW_COUNT_PATTERN = re.compile(r'^\d+\.?\d*\s*[MKBmkb]?\s*views?$', re.IGNORECASE)

artists = item.get("artists", [])
artist_names = [
    a.get("name", "")
    for a in artists
    if a.get("name") and not VIEW_COUNT_PATTERN.match(a.get("name", ""))
]
artist_name = ", ".join(artist_names) if artist_names else "Unknown"
```

### Fix — Data Migration

One-time Django data migration to clean existing records:

```python
from django.db import migrations
import re

VIEW_COUNT_PATTERN = re.compile(r',?\s*\d+\.?\d*\s*[MKBmkb]?\s*views?', re.IGNORECASE)

def clean_artist_names(apps, schema_editor):
    ListenTrack = apps.get_model('website', 'ListenTrack')
    tracks = ListenTrack.objects.filter(artist__regex=r'\d+\.?\d*\s*[MKBmkb]?\s*views?')
    for track in tracks:
        cleaned = VIEW_COUNT_PATTERN.sub('', track.artist).strip().strip(',').strip()
        if cleaned != track.artist:
            track.artist = cleaned
            track.save(update_fields=['artist'])
```

## Backend: Google Takeout Import

### Endpoint

`POST /api/listens/import/` — admin-only.

Accepts a multipart file upload of `watch-history.json` from Google Takeout (YouTube and YouTube Music → History).

### Takeout File Format

```json
[
  {
    "header": "YouTube Music",
    "title": "Watched Song Title",
    "titleUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
    "subtitles": [{ "name": "Artist Name", "url": "..." }],
    "time": "2024-01-15T14:30:00.000Z",
    "products": ["YouTube Music"]
  }
]
```

### Processing

1. Parse JSON array from uploaded file
2. Filter to entries where `products` contains `"YouTube Music"`
3. Extract: `video_id` from `titleUrl`, `title` (strip "Watched " prefix), `artist` from `subtitles[0].name`, `played_at` from `time`
4. Note: Takeout data lacks `album`, `thumbnail_url`, `duration` — store as empty strings
5. Deduplicate: skip entries where `(video_id, played_at)` already exists (use a 60-second tolerance window on `played_at`)
6. Bulk create in batches of 500
7. Return: `{ imported: count, skipped: count }`

### Thumbnail Backfill (Optional, Future)

Takeout entries won't have thumbnails. A future enhancement could batch-query the YouTube Data API to fill these in, but that's out of scope for this iteration.

## Backend: Albums 2+ Track Filter

In `listen_top_albums` view, add annotation filter:

```python
.annotate(track_count=Count("video_id", distinct=True))
.filter(track_count__gte=2)
```

This excludes single-track "albums" (effectively singles) from the albums view.

## API Changes Summary

| Endpoint | Change |
|---|---|
| `GET /api/listens/recommended/` | **New** — public, returns 1 recommended track |
| `POST /api/listens/import/` | **New** — admin-only, Google Takeout import |
| `GET /api/listens/albums/` | **Modified** — filter to 2+ tracks |
| `POST /api/listens/sync/` | **Modified** — artist name cleanup in parser |
| `GET /api/listens/` | **Unchanged** — frontend passes `limit=20` instead of 50 (backend API unchanged) |

## Out of Scope

- Thumbnail backfill for Takeout-imported tracks (future enhancement)
- Time period toggles on rankings
- Artist images
- Multiple recommendation strategies (just rediscovery for now)
