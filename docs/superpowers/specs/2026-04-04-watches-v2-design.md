# Watches V2: Card Standardization, Scrollable Grid, and Staging Pin-from-Channel

## Context

The watches page was recently redesigned (#130) with a two-column layout: sticky hero player (left 50%) and channel grid (right 50%). This iteration addresses card sizing inconsistency, scrollability, and a critical staging workflow gap — there's no way to pin videos per channel without scrolling through a flat list of liked videos.

## Changes

### 1. Public Page — Standardize Channel Cards

**Problem:** Cards use `auto-fill minmax(...)` which produces variable widths depending on container size. Some cards are wider than others.

**Fix:** Switch grid to fixed column count per breakpoint with uniform card dimensions:
- Desktop (>=1024px): 5 columns, cards fill equally
- Tablet (768-1023px): 3 columns
- Mobile (<768px): 2 columns (smaller cards)

Card height is standardized by setting a fixed height on the card container. Channel name already has `text-overflow: ellipsis` and `white-space: nowrap` — no change needed there. The fixed card height ensures consistent grid appearance regardless of name length.

### 2. Public Page — Scrollable Grid Container

**Problem:** The channel grid currently extends the full page height, pushing content below the fold with no containment.

**Fix:** The grid container gets a fixed height of `calc(100vh - 100px)` (viewport minus top spacing for navbar), `overflow-y: auto`, and hidden scrollbar.

**Scroll indicator:** A gradient fade overlay at the bottom of the grid container (transparent → page background color). The fade disappears when the user has scrolled to the bottom. Implemented with a pseudo-element or an absolutely-positioned div that tracks scroll position via `onScroll`.

**Scrollbar hiding:**
```css
scrollbar-width: none;           /* Firefox */
&::-webkit-scrollbar { display: none; }  /* Chrome/Safari */
```

### 3. Public Page — Tagline Repositioned

**Current:** The tagline "at least i don't doom scroll facebook et al." sits inside the HeroPanel component, below admin controls.

**Change:** Move to a fixed-position element at the bottom-left of the viewport, outside the hero panel. Styled as:
- `position: fixed`
- `bottom: 1.5rem`
- `left: 1.5rem`
- `z-index: 10`
- Same italic, muted style (`color: #444`, `fontSize: 0.8rem`)

On mobile, stays fixed bottom-left but with smaller padding (`bottom: 1rem`, `left: 1rem`).

### 4. Public Page — Remove Tier Buttons from Expanded Block

The `ExpandedBlock` component currently shows tier selector buttons when admin is logged in. Remove this — tier management moves exclusively to the staging page. The expanded block on the public page should only show channel info and pinned video thumbnails.

### 5. Staging Page — Show All Channels

**Current:** `watch_staging()` only returns channels with `tier="hidden"`.

**Change:** Return ALL channels, grouped by tier. The backend returns them sorted by tier weight (never_miss first, hidden last), then by display_order within each tier.

**Frontend:** Display channels grouped under section headers: "NEVER MISS", "ROTATION", "CHECK OUT", "HIDDEN". Each channel row shows its current tier buttons (with the active one highlighted brighter) + a "Pin video" button.

### 6. Staging Page — Brighter Button Styling

**Current:** Button text uses `${ACCENT}80` (muted blue) for inactive, `ACCENT` for active.

**Change:**
- Inactive buttons: text color `${ACCENT}aa` (brighter), border `${ACCENT}50`
- Active/selected tier button: text `#e5e2e1` (near-white), background `${ACCENT}35`, border `ACCENT`
- Delete buttons: same treatment — `${RED}bb` inactive, `RED` on hover

### 7. Staging Page — Pin Video from Channel Popup

**Trigger:** "Pin video" button on each channel row (only shown for promoted channels, i.e. non-hidden).

**Popup behavior:**
1. Click "Pin video" → popup overlay appears
2. Popup fetches `GET /api/watches/channels/<id>/uploads/` which calls YouTube `playlistItems.list`
3. Shows a grid of recent video thumbnails (up to 20) with titles
4. Each video is selectable (toggle selection with click, visual highlight on selected)
5. "Pin selected" button at the bottom → `POST` to create/pin each selected video
6. On success, popup closes, channel row updates to show pinned count

**Popup layout:**
- Modal overlay with dark semi-transparent backdrop
- Max-width 600px, centered
- Channel name as header
- 2-column grid of video thumbnails (each ~240px wide with title below)
- Loading spinner while fetching
- "Pin selected (N)" button, disabled when nothing selected

### 8. Backend — Channel Uploads Endpoint

**New endpoint:** `GET /api/watches/channels/<id>/uploads/`

**Auth:** Admin required.

**Logic:**
1. Look up the `WatchChannel` by id
2. Derive the uploads playlist ID: replace `UC` prefix with `UU` in `youtube_channel_id` (standard YouTube channel convention; if the ID doesn't start with `UC`, return an empty list)
3. Call YouTube API `playlistItems.list` with `playlistId=<uploads_playlist_id>`, `part=snippet`, `maxResults=20`
4. Return array of `{ youtube_video_id, title, thumbnail_url }` for each item
5. Exclude videos that are already in the database (already synced/pinned)

**Quota cost:** 1 unit per call. Well within the 10,000/day free tier.

**Error handling:** If the channel has no uploads playlist or the API call fails, return an empty list with a message field.

### 9. Backend — Pin Multiple Videos Endpoint

**New endpoint:** `POST /api/watches/channels/<id>/pin-videos/`

**Auth:** Admin required.

**Body:** `{ "videos": [{ "youtube_video_id": "...", "title": "...", "thumbnail_url": "..." }, ...] }`

**Logic:** For each video in the array:
1. `get_or_create` a `WatchVideo` with the given `youtube_video_id`
2. Set `channel` to the given `WatchChannel`, `title`, `thumbnail_url`, `pinned=True`, `visible=True`
3. Save

Returns `{ "pinned": N }` with count of videos pinned.

### 10. Backend — Update Staging Endpoint

Modify `watch_staging()` to return all channels instead of just hidden ones. Sort by tier weight then display_order. Include a `pinned_count` field per channel (count of pinned videos for that channel).

## Files Changed

### Backend
- `website/views/watch.py` — new `watch_channel_uploads()`, `watch_channel_pin_videos()` endpoints; modify `watch_staging()` to return all channels
- `website/urls.py` — add routes for new endpoints

### Frontend
- `frontend/src/app/watches/page.tsx` — scrollable grid container with scroll indicator, fixed tagline, remove tier buttons from expanded block, standardize card sizing
- `frontend/src/app/watches/staging/page.tsx` — grouped channel display, pin video popup, brighter buttons
- `frontend/src/lib/api.ts` — add types for uploads response and pin-videos request

## Out of Scope
- Changing the hero player behavior
- Changing the sync logic (subscriptions + liked videos)
- Mobile layout changes beyond what's described (responsive breakpoints stay the same)
- Video notes or other staging video management
