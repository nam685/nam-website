# Watches Page Design

**Date:** 2026-04-02
**Page:** `/watches`
**Accent:** `#1e40af`

## Overview

A curated "taste map" of YouTube channels and standout videos. Content is auto-synced from YouTube (subscriptions → channels, liked videos → videos) but hidden by default. The admin reviews a staging area via /sudo and promotes items to one of three tiers. Public visitors see a glow grid where tier is expressed through visual intensity, not section headers.

## Data Model

### WatchChannel

| Field | Type | Notes |
|---|---|---|
| `youtube_channel_id` | `CharField(64, unique)` | YouTube's channel ID |
| `name` | `CharField(200)` | Channel name |
| `description` | `TextField(blank)` | Channel description |
| `thumbnail_url` | `URLField(blank)` | Channel avatar |
| `tier` | `CharField` choices: `hidden`, `never_miss`, `regular`, `check_out` | Default: `hidden` |
| `display_order` | `IntegerField(default=0)` | Manual sort within tier |
| `created_at` | `DateTimeField(auto_now_add)` | |
| `synced_at` | `DateTimeField` | Last time this channel was refreshed from YouTube |

Ordering: `tier` weight (never_miss=0, regular=1, check_out=2), then `display_order`, then `name`.

### WatchVideo

| Field | Type | Notes |
|---|---|---|
| `youtube_video_id` | `CharField(64, unique)` | YouTube's video ID |
| `channel` | `ForeignKey(WatchChannel, null, blank, SET_NULL)` | Linked by channel ID on sync |
| `title` | `CharField(300)` | Video title |
| `thumbnail_url` | `URLField(blank)` | Video thumbnail |
| `note` | `CharField(200, blank)` | Optional personal annotation (e.g. "the one that got me hooked") |
| `pinned` | `BooleanField(default=False)` | Show as standout under its channel |
| `visible` | `BooleanField(default=False)` | Default False — hidden until approved |
| `created_at` | `DateTimeField(auto_now_add)` | |
| `synced_at` | `DateTimeField` | Last refreshed from YouTube |

## YouTube Sync

### OAuth

Same pattern as `/listens` — Google OAuth with `youtube.readonly` scope. Reuses existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars (the scope already covers both YTM history and YouTube Data API).

Flow:
1. Admin clicks "Connect YouTube" on `/watches` (or `/sudo`)
2. `GET /api/watches/auth/?token=<admin_token>` → redirects to Google OAuth
3. Google redirects to `/api/watches/callback/?code=...&state=<admin_token>`
4. Callback exchanges code for access token
5. **Proactive sync** — immediately syncs subscriptions + liked videos on successful OAuth
6. Redirects to `/watches`

### Sync Logic

Triggered by: OAuth callback (proactive), or manual trigger via `/api/watches/sync/`. Cron/scheduled sync deferred to a future iteration.

**Subscriptions sync:**
- YouTube Data API: `GET /youtube/v3/subscriptions?mine=true&part=snippet&maxResults=50`
- Paginate using `nextPageToken` — process one page at a time, cap at 500 channels total
- For each subscription: `update_or_create` on `youtube_channel_id`, update name/description/thumbnail/synced_at
- New channels get `tier=hidden`

**Liked videos sync:**
- YouTube Data API: `GET /youtube/v3/videos?myRating=liked&part=snippet&maxResults=50`
- Paginate with `nextPageToken`, cap at 200 videos total
- For each video: `update_or_create` on `youtube_video_id`, update title/thumbnail/synced_at
- Link to WatchChannel by matching `snippet.channelId` → `WatchChannel.youtube_channel_id`
- New videos get `visible=False`, `pinned=False`

**Rate limiting:** 5-minute cooldown between syncs (same pattern as listens).

**Token handling:** Access token is used immediately and discarded. Store the refresh token in Django cache (Redis) keyed by a fixed key (`watches_google_refresh_token`) so future manual/cron syncs can refresh without re-auth. The refresh token is never exposed via API.

## API Endpoints

All under `/api/watches/`.

### Public

```
GET /api/watches/
```
Returns visible channels (tier != hidden) with their pinned+visible videos. Paginated.

Response:
```json
{
  "channels": [
    {
      "id": 1,
      "youtube_channel_id": "UC...",
      "name": "3Blue1Brown",
      "description": "...",
      "thumbnail_url": "...",
      "tier": "never_miss",
      "videos": [
        {
          "id": 5,
          "youtube_video_id": "fNk_zzaMoSs",
          "title": "Essence of Linear Algebra",
          "thumbnail_url": "...",
          "note": "The one that got me hooked"
        }
      ]
    }
  ],
  "total": 45,
  "limit": 30,
  "offset": 0
}
```

Default `limit=30`, max `limit=100`. Only includes videos where `pinned=True AND visible=True`.

### Admin (auth required)

```
GET  /api/watches/staging/               — hidden channels + non-visible videos
POST /api/watches/channels/<id>/tier/    — body: {"tier": "never_miss"|"regular"|"check_out"|"hidden"}
POST /api/watches/channels/<id>/order/   — body: {"display_order": 5}
POST /api/watches/channels/<id>/delete/  — hard delete channel + its videos
POST /api/watches/videos/<id>/pin/       — toggle pinned + set visible=True
POST /api/watches/videos/<id>/note/      — body: {"note": "..."}
POST /api/watches/videos/<id>/delete/    — hard delete video
GET  /api/watches/auth/                  — initiate Google OAuth (token as query param)
GET  /api/watches/callback/              — Google OAuth callback, triggers proactive sync
POST /api/watches/sync/                  — manual sync trigger
GET  /api/watches/sync-status/           — cooldown + last sync time
```

## Frontend — Public View

### Layout: Glow Grid

Responsive CSS grid of channel cards. All tiers mixed together, sorted by tier weight then display_order.

**Tier visual treatment:**

| Property | Never Miss | Regular Rotation | Check Out |
|---|---|---|---|
| Border | `1px solid #1e40af60` | `1px solid #1e40af30` | `1px solid #1e40af15` |
| Box shadow | `0 0 15px #1e40af30` | none | none |
| Avatar size | 48px | 40px | 36px |
| Opacity | 1.0 | 0.85 | 0.65 |
| Tier label | `NEVER MISS` in accent | `ROTATION` in accent/dim | `CHECK OUT` in accent/very dim |

**Channel card contents:**
- Circular avatar (thumbnail_url)
- Channel name
- Tier label (small, uppercase, monospace)

**Expand in-place:** Click a channel card → it expands within the grid (spanning extra columns via CSS) to reveal pinned videos as small thumbnail cards. Each video thumbnail links to YouTube. Shows the video note if present. Click again or click elsewhere to collapse.

**Pagination:** Initial load fetches 30 channels. "Show more" button at the bottom loads the next page. No infinite scroll — explicit user action.

**Mobile:** Grid collapses to 2 columns. Expanded cards span full width.

### Admin View

When admin token is present in localStorage:
- "Connect YouTube" / "Sync" button in page header
- Staging area (separate section or toggle) showing hidden channels and non-visible videos
- Each item has: promote (set tier), pin (for videos), delete buttons
- Sync status indicator (last synced, cooldown timer)

## Page Background

Use the existing `#1e40af` accent. No custom background image for v1 — match the minimal style of other placeholder pages. Can be enhanced later.

## Scope Exclusions

- No YouTube embed/playback on-site — always link out to YouTube
- No watch history tracking — only subscriptions and liked videos
- No automatic tier assignment — all curation is manual
- No comments or social features on videos
- No background/cron sync in v1 — manual trigger only (cron can be added later)
