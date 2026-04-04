# Watches Page V2 — Design Spec

## Overview

Redesign the watches page from a simple channel grid into a curated taste showcase with a two-column layout: a sticky hero panel with an embedded video player on the left, and a scrollable channel grid on the right. The page should feel like a personal editorial recommendation — "here's what I watch and why it's good."

## Page Layout

### Desktop (≥1024px)

50/50 horizontal split:

- **Left panel (50%):** Sticky (`position: sticky; top: 0; height: 100vh`). Houses the hero video player, video metadata, stats, description, and tagline.
- **Right panel (50%):** Scrollable. Contains a 5-column CSS grid of channel cards, all tiers mixed and randomized.

### Tablet (768–1023px)

Same 50/50 split, right panel drops to 3-column grid.

### Mobile (<768px)

Stacked vertically:
- Hero section on top (not sticky)
- 2-column grid below
- All tiers mixed, glow is the only tier differentiator

## Hero Panel (Left Side)

Top to bottom:

1. **Video area** — 16:9 aspect ratio container. Initially shows the recommended video's thumbnail with a centered play button overlay. Clicking replaces the thumbnail with a YouTube iframe embed (`youtube.com/embed/<id>?autoplay=1`). When a video is clicked anywhere on the page (recommended video or pinned video in an expanded channel card), it loads into this same player area.
2. **Video title** — prominent, white, `font-size: ~1rem`.
3. **Channel name + duration** — muted, smaller text.
4. **Stats row** — inline flex: likes, comments, views. Small, muted icons or emoji prefixes. (YouTube API does not expose share counts.)
5. **Description** — muted text, `max-height` with overflow hidden (expandable on click/tap). Sourced from YouTube video description stored during sync.
6. **Spacer** — `flex: 1` pushes tagline to bottom.
7. **Tagline** — bottom-left: "at least i don't doom scroll facebook et al." Italic, very muted (`color: ~#444`), with a faint top border separator.

### Recommended Video Selection

Server-side weighted random from pinned videos across all visible channels:
- `never_miss` channel videos: weight 3
- `regular` channel videos: weight 2
- `check_out` channel videos: weight 1

Returned via a dedicated endpoint `GET /api/watches/recommended/`. Includes video stats and description.

### Hero as Universal Player

The hero panel is the single video player for the entire page. Clicking any video anywhere on the page (the recommended video, or a pinned video in an expanded channel card) loads that video into the hero embed. The hero metadata (title, channel, stats, description) updates to reflect the playing video. On mobile, clicking a video in the grid scrolls back up to the hero and loads the embed.

## Channel Grid (Right Side)

### Card Layout

5-column CSS grid (`grid-template-columns: repeat(5, 1fr)`), `gap: ~0.5rem`.

Each card contains:
- Circular channel avatar (centered)
- Channel name below avatar (single line, truncated with ellipsis)

No tier labels. No "Rotation" or "Check Out" text.

### Tier Visual Differentiation

All tiers are mixed together in the grid. Differentiation is visual weight only:

| Tier | Border | Shadow | Opacity |
|------|--------|--------|---------|
| `never_miss` | `#1e40af60` | `0 0 12px #1e40af20` | 1.0 |
| `regular` | `#1e40af25` | none | 0.85 |
| `check_out` | `#1e40af10` | none | 0.65 |

### Randomized Order

On each page load, shuffle the channel array client-side before rendering. No alphabetical or tier-based grouping. Each visit feels different.

### Card Hover

Medium-intensity interactive hover (transition: 0.2s ease):
- Border opacity increases (e.g., `never_miss` 60→90, `regular` 25→50, `check_out` 10→30)
- Background shifts to visible blue tint (`#1e40af08` → `#1e40af15`)
- Scale up: `transform: scale(1.03)`
- Cursor: pointer

## Channel Expansion

### Trigger

Click a channel card to expand. Click again to collapse. Clicking a different card collapses the current one and expands the new one.

### Grid Reflow Logic

When a card at grid position N is clicked:
1. Cards at positions 1 through N stay in place.
2. Cards after position N in the same row shift forward to fill the remaining spots in that row.
3. The expanded block appears as a full-width element spanning all 5 columns on the next grid row.
4. Remaining cards continue in the normal 5-column flow below the expanded block.

This avoids empty gaps in the row above the expanded card.

Implementation: render the card list as a flat array. Insert the expanded block element into the array after the last card of the row containing the clicked card. The expanded block uses `grid-column: 1 / -1`.

### Expanded Card Content

Approximately 3 rows tall. Contains:
- **Channel avatar** (large, ~56px)
- **Channel name** (prominent, ~14px, bold)
- **Channel description** + subscriber count (muted)
- **Pinned videos** — flex-wrapped row of video thumbnails (130×73px, 16:9). Clicking a pinned video loads it into the hero player (not a YouTube redirect). Title below each thumbnail, single line, truncated.
- **YouTube channel link** — small external link icon/button
- **Admin tier selector** (visible only when authenticated) — row of buttons: `never_miss` | `regular` | `check_out`. Active tier highlighted with accent color background.

### Mobile Expansion

Full-width below the tapped card. Same content, single-column layout. Video clicks scroll to hero and load the embed.

## Data Model Changes

### WatchVideo — New Fields

Add to the existing `WatchVideo` model:

```python
view_count = models.BigIntegerField(default=0)
like_count = models.BigIntegerField(default=0)
comment_count = models.BigIntegerField(default=0)
description = models.TextField(blank=True, default="")
duration = models.CharField(max_length=20, blank=True, default="")  # ISO 8601 duration, e.g. "PT28M41S"
stats_updated_at = models.DateTimeField(null=True, blank=True)
```

### Sync Changes

During the existing YouTube liked-videos sync:
- After creating/updating videos, make a batch call to YouTube Data API v3 `videos.list` (part: `statistics,contentDetails,snippet`) for the video IDs.
- Populate `view_count`, `like_count`, `comment_count`, `description`, `duration`, and set `stats_updated_at`.
- The API allows up to 50 video IDs per request, so batch accordingly.

### Backfill Endpoint

`POST /api/watches/backfill-stats/` (auth required):
- Finds all `WatchVideo` records where `stats_updated_at` is null or older than a configurable threshold (default: 7 days).
- Fetches fresh stats from YouTube Data API v3 in batches of 50.
- Updates records. Returns count of updated videos.
- Subject to the same sync cooldown as the regular sync (5-minute global cooldown).

### Recommended Video Endpoint

`GET /api/watches/recommended/`:
- Selects a random pinned+visible video using weighted random based on channel tier.
- Returns full video data including stats and description.
- Weights: `never_miss`=3, `regular`=2, `check_out`=1.

## API Response Changes

### `/api/watches/` Response

The `WatchVideo` objects in the channel response should now include:

```json
{
  "id": 1,
  "youtube_video_id": "abc123",
  "title": "Video Title",
  "thumbnail_url": "https://...",
  "note": "",
  "view_count": 15000000,
  "like_count": 1200000,
  "comment_count": 24000,
  "description": "Video description text...",
  "duration": "PT28M41S"
}
```

### `/api/watches/recommended/` Response

```json
{
  "video": {
    "id": 1,
    "youtube_video_id": "abc123",
    "title": "Why Democracy Is Mathematically Impossible",
    "thumbnail_url": "https://...",
    "view_count": 15000000,
    "like_count": 1200000,
    "comment_count": 24000,
    "description": "Full video description...",
    "duration": "PT28M41S",
    "channel_name": "Veritasium",
    "channel_thumbnail_url": "https://..."
  }
}
```

## Admin Features

### Tier Selector

Inside the expanded channel card, visible only when authenticated:
- Three buttons in a row: `never_miss` | `regular` | `check_out`
- Active tier has accent-colored background (`#1e40af15`) and border (`#1e40af40`)
- Clicking a different tier calls `POST /api/watches/channels/<id>/tier/` and updates the card's visual weight in place.

### Sync/Staging Controls

Small controls in the hero panel (below the tagline or as a floating element), only visible when authenticated:
- Sync button (with cooldown indicator)
- Link to `/watches/staging`

## Styling Notes

- Accent color: `#1e40af` (unchanged)
- All styling via inline React style objects (consistent with current approach)
- Card border-radius: 5-6px
- Expanded card border-radius: 8px
- Font sizes: card names ~8-9px (compact), expanded card title ~14px, hero title ~1rem
- Background: `#0a0a0a` page, `#111` for never_miss cards, `#0e0e0e` for regular, `#0a0a0a` for check_out

## Removed

- Tier text labels on cards ("Rotation", "Check Out")
- "Watches" title at top
- "my youtube taste map" tagline
- "Recommended" label in hero
- Separate tier sections/groupings
- YouTube redirect for pinned videos (all videos play in hero)

## Out of Scope

- Custom video player (must use YouTube iframe embed for TOS compliance)
- Video search or filtering
- Channel categories/tags
- Staging page redesign (keep as-is)
