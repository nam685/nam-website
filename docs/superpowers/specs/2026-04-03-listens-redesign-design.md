# Listens Page Redesign + Mini Music Player

## Overview

Redesign the `/listens` page from a narrow single-column admin-only view into a full-width, public-facing magazine-style layout with route-based sub-pages. Add a site-wide mini music player (admin-only) that persists across all pages.

## Page Layout

Magazine-style two-panel hero at the top, with route-based tab navigation below.

### Panel Styling

All panels use semi-transparent backgrounds (`rgba(14, 14, 14, 0.5)` with backdrop-filter blur) so the page background bleeds through. No solid opaque blocks.

### Routes

```
/listens            → Overview: hero + chronological history feed
/listens/tracks     → Top tracks ranked by play count
/listens/artists    → Top artists ranked by plays
/listens/albums     → Top albums ranked by plays
```

Next.js layout nesting: `/listens/layout.tsx` renders the hero panel + tab bar. Each sub-route renders content below the tabs. The hero is visible on all tabs.

### Visibility

- All four routes are public (visitors can browse listen history, stats, top tracks/artists/albums)
- Sync button: admin-only
- Play buttons: admin-only
- Sync status endpoint: admin-only

## Hero Panel

Rendered by the shared listens layout, visible on all sub-routes.

### Left Panel (2fr)

- **Latest track**: "LATEST" label, thumbnail (72px), title, artist, album, time-ago
- **Top This Month**: horizontal-scroll row of album art cards (thumbnail, title, artist, play count). ~5 visible on desktop, 3 on mobile. Horizontally scrollable.

### Right Panel (1fr)

- **Total plays**: large number, prominent
- **Today / This Week**: counts below total
- **30-day sparkline**: bar chart of daily listen counts
- **Top 3 Artists**: compact list (styled initial/monogram — no avatar images available from YouTube Music), name, play count

### Responsive Collapse

- **Desktop (1024+)**: Two-panel grid (2fr / 1fr)
- **Tablet (768-1023)**: Latest + stats side-by-side in one row, top tracks row below
- **Mobile (<768)**: Stats as compact horizontal bar at top, latest below, top tracks horizontal scroll, top artists below that

## Tab Sub-pages

Tab bar between hero and content. Active tab: orange underline + text. Inactive: muted gray. Horizontal scroll on mobile.

### `/listens` — History

- Chronological feed of all plays, newest first
- Two-column grid on desktop/tablet, single column on mobile
- Each row: thumbnail (36px), title, artist, time-ago
- Paginated with "Load More" button (offset-based)
- Admin sees play button on hover; visitors don't

### `/listens/tracks` — Top Tracks

- Ranked list of tracks by total play count (all-time)
- Numbered rows: rank, thumbnail, title, artist, play count
- Paginated
- Admin sees play button on each row

### `/listens/artists` — Top Artists

- Artist cards in a grid (3-col desktop, 2-col tablet, 1-col mobile)
- Each card: styled initial/monogram (no artist images available), artist name, total plays, unique track count, top 3 tracks listed small
- Paginated
- Admin sees "play all" button per artist card

### `/listens/albums` — Top Albums

- Album cards in a grid (same responsive pattern as artists)
- Each card: album art thumbnail (from any track on that album), album name, artist, play count, track count
- Grouped by `(album, artist)` pair from existing `ListenTrack` data (avoids collisions between albums with the same name by different artists)
- Paginated
- Admin sees "play all" button per album card

## Mini Music Player

Site-wide floating player in the root layout. Admin-only — never rendered for visitors.

### Architecture

- **Playback engine**: Hidden YouTube IFrame embed (off-screen) using the IFrame Player API. Works for both video and audio-only "Art Track" uploads.
- **State management**: React context (`PlayerContext`) in root layout. Holds: current track, queue, playing/paused, progress/duration, shuffle mode, repeat mode.
- **Integration**: All play buttons across the site dispatch actions to `PlayerContext`.

### UI — Floating Card (Bottom-Right)

- Positioned above the existing feedback button
- Shows: album art (40px), title (ellipsized), artist, progress bar, controls
- Controls: shuffle, previous, play/pause, next, repeat
- Semi-transparent background matching page panel style
- Collapsible: minimize button shrinks to album art + play/pause only

### Queue Management

- **Single track**: queue = [that track]
- **Playing a list** (e.g. "Top This Month", an artist's tracks, an album): queue = all tracks in that list, starting from clicked position
- Next/prev navigate the queue
- Shuffle randomizes queue order
- Repeat: loop entire queue or loop single track
- Auto-advance to next track when current ends

### Mobile Behavior

- Floating card becomes full-width bottom bar
- Same content (art, title, controls), stretched layout
- Sits above mobile nav if present

### State

- Queue and playback state in React state only (no localStorage persistence)
- Player hidden by default, appears on first play action
- Navigating between pages preserves player state (root layout doesn't unmount)

## Backend Changes

### New Endpoints

```
GET /api/listens/tracks/    → top tracks by play count
GET /api/listens/artists/   → top artists by play count
GET /api/listens/albums/    → top albums by play count
```

All public, paginated with `?limit=N&offset=N`.

### Response Shapes

**`/api/listens/tracks/`**
```json
{
  "tracks": [
    {
      "video_id": "...",
      "title": "...",
      "artist": "...",
      "album": "...",
      "thumbnail_url": "...",
      "play_count": 23
    }
  ],
  "total": 150
}
```

**`/api/listens/artists/`**
```json
{
  "artists": [
    {
      "name": "...",
      "play_count": 45,
      "track_count": 12,
      "top_tracks": [
        { "video_id": "...", "title": "...", "thumbnail_url": "..." }
      ]
    }
  ],
  "total": 30
}
```

**`/api/listens/albums/`**
```json
{
  "albums": [
    {
      "name": "...",
      "artist": "...",
      "thumbnail_url": "...",
      "play_count": 18,
      "track_count": 5
    }
  ],
  "total": 25
}
```

### Auth Changes

| Endpoint | Before | After |
|---|---|---|
| `GET /api/listens/` | admin-only | public |
| `GET /api/listens/stats/` | admin-only | public |
| `GET /api/listens/tracks/` | — (new) | public |
| `GET /api/listens/artists/` | — (new) | public |
| `GET /api/listens/albums/` | — (new) | public |
| `GET /api/listens/auth/` | admin-only | admin-only (unchanged) |
| `GET /api/listens/callback/` | unauthenticated | unauthenticated (unchanged) |
| `GET /api/listens/sync-status/` | admin-only | admin-only (unchanged) |

### Caching

All aggregation endpoints cached in Redis with 5-minute TTL (same pattern as existing stats endpoint). Cache invalidated when sync completes.

### No New Models

All data derived from existing `ListenTrack` model via Django ORM aggregation (`annotate`, `values`, `Count`). No migrations needed.

## Data Flow

```
Sync: Admin clicks Sync → OAuth → ytmusicapi fetches history → bulk create ListenTrack rows → redirect back

Page load (public):
  /listens         → GET /api/listens/ + GET /api/listens/stats/
  /listens/tracks  → GET /api/listens/tracks/ + GET /api/listens/stats/
  /listens/artists → GET /api/listens/artists/ + GET /api/listens/stats/
  /listens/albums  → GET /api/listens/albums/ + GET /api/listens/stats/

Playback (admin):
  Click play → PlayerContext.play(track, queue?) → YouTube IFrame loads video_id → audio plays
  Track ends → PlayerContext auto-advances to next in queue
```

## Out of Scope

- Manual favorites / curation (all derived from play data)
- Manual playlists (auto-generated only)
- Persistent player state across page refreshes
- Artist images (YouTube Music doesn't provide them via ytmusicapi)
- Time period toggles on rankings (start with all-time, can add later)
