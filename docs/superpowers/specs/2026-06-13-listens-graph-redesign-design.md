# Listens Graph Redesign

Replace the four list-based `/listens` tabs (History, Tracks, Artists, Albums) with a single interactive **force-directed graph** of your music. Songs, albums, and artists are nodes; edges are listening affinity (collaborative-filtering similarity from Last.fm, plus your own co-listen habits). Each visit reveals a **patch** — a seed node and its neighborhood — chosen probabilistically by a recommendation score. You can search to jump to any region and walk the graph by re-centering on neighbors.

## Goals

- Reimagine `/listens` as a graph you explore, not a set of ranked tables.
- Edges reflect *listening affinity*, sourced from Last.fm similarity (CF-derived across all users) layered with your personal co-listen signal.
- Tailor the graph to your real library: liked songs, saved albums, subscribed artists, and frequent listens pulled from YouTube Music.
- Each refresh "recommends a new patch" — a different region surfaced with likelihood proportional to a recommendation score.
- Search jumps to a region; clicking a node walks the graph by re-centering.

## Non-Goals

- **No discovery / unheard music.** The graph stays inside your own universe — every node is something you've played, liked, saved, or subscribed to. No Last.fm "frontier" nodes for music you haven't heard.
- **No public playback.** Playback stays admin-only, exactly as the current pages behave.
- **No Spotify.** Spotify's related-artists and recommendations endpoints were deprecated (Nov 2024) with no replacement. Last.fm is the similarity source.

## Architecture Overview

```
ListenTrack (raw play log, unchanged)
        │
        ▼  build_music_graph (management command / sync task)
  ┌─────────────────────────────────────────────┐
  │ 1. Pull YTM personalization (liked/library/  │
  │    subscriptions) → flags                    │
  │ 2. Aggregate plays → MusicNode (track/       │
  │    artist/album) with counts                 │
  │ 3. Co-listen edges (session windows)         │
  │ 4. Last.fm similar artists/tracks → edges    │
  │    (cached), kept only within your universe  │
  │ 5. Structural edges (track→artist, →album)   │
  │ 6. recommend_score per node                  │
  └─────────────────────────────────────────────┘
        │
        ▼  MusicNode + MusicEdge (derived cache)
   /api/listens/graph/patch/  ──►  force graph (react-force-graph-2d)
   /api/listens/graph/search/ ──►  search-to-region
```

`MusicNode` / `MusicEdge` are a **derived cache** rebuilt on each sync — not a separate source of truth. `ListenTrack` remains the authoritative raw play log.

## Data Model

Both models live in `website/models/` (new files, exported via `models/__init__.py`).

### `MusicNode` (`website/models/music_node.py`)

| Field | Type | Notes |
|---|---|---|
| `node_type` | CharField | `artist` \| `album` \| `track` |
| `key` | CharField | Normalized identity. track → `video_id`; artist → lowercased trimmed name; album → `artist_lower::album_lower` |
| `title` | CharField | Display name (track title / artist name / album name) |
| `subtitle` | CharField | Artist name for track/album nodes; empty for artist nodes |
| `thumbnail_url` | URLField | blank ok |
| `video_id` | CharField | Playable track. For artist/album nodes = representative (top-played) track's video_id |
| `play_count` | IntegerField | Aggregated from `ListenTrack` (0 for liked/library items never played) |
| `last_played` | DateTimeField | nullable |
| `is_liked` | BooleanField | default False |
| `is_subscribed` | BooleanField | default False (artist nodes) |
| `in_library` | BooleanField | default False (saved album / library song) |
| `recommend_score` | FloatField | default 0.0 — cached seed weighting |

- `unique_together = (node_type, key)`
- Indexes on `node_type`, `recommend_score`.

### `MusicEdge` (`website/models/music_edge.py`)

| Field | Type | Notes |
|---|---|---|
| `source` | FK → MusicNode | Stored canonically: `source_id < target_id` |
| `target` | FK → MusicNode | |
| `edge_type` | CharField | `similar_artist` \| `similar_track` \| `colisten` \| `structural` |
| `weight` | FloatField | similarity score / co-occurrence count / fixed for structural |

- `unique_together = (source, target, edge_type)`
- Index on `source`, `target`.

### `LastfmCache` (`website/models/lastfm_cache.py`)

Caches Last.fm responses so repeated builds don't re-hit the API.

| Field | Type | Notes |
|---|---|---|
| `cache_key` | CharField, unique | e.g. `artist.getSimilar::radiohead` |
| `payload` | JSONField | raw similar list |
| `fetched_at` | DateTimeField | for TTL (refresh if older than ~30 days) |

## Build Pipeline

New management command `website/management/commands/build_music_graph.py`, with the core logic in a shared helper (`website/services/music_graph.py`) callable from both the command and the existing sync flow.

1. **Personalization pull** (YTM, via existing `browser.json` auth — reuse the SAPISIDHASH logic already in `listen_sync`):
   - `get_liked_songs(limit=...)` → `is_liked`
   - `get_library_albums(limit=...)` → album nodes, `in_library`
   - `get_library_subscriptions(limit=...)` → artist nodes, `is_subscribed`
   - `get_library_songs(limit=...)` → `in_library`
   - Failures log a warning and skip personalization (don't abort the build).
2. **Aggregate** `ListenTrack` → track/artist/album `MusicNode`s with `play_count` and `last_played`. Artist field is comma-split (same as the current `listen_top_artists` logic).
3. **Co-listen edges**: walk `ListenTrack` ordered by `played_at`; tracks played within a ~30-minute window of each other get a `colisten` edge, `weight` = co-occurrence count.
4. **Last.fm enrichment**: for each artist node call `artist.getSimilar`; for top-N track nodes call `track.getSimilar`. Cache via `LastfmCache`. Create `similar_artist` / `similar_track` edges **only when the other endpoint already exists as a node in your universe**; `weight` = Last.fm match score. Respect Last.fm rate limits (~5 req/s) with a small sleep between uncached calls.
5. **Structural edges**: `track → its artist`, `track → its album`, fixed low weight.
6. **`recommend_score`**: reuse the existing rediscovery weighting (`play_count × days_since_last_played`, favoring the top quartile not played recently — absorbed from `listen_recommended`), multiplied by a personalization boost (liked / subscribed / in_library raise the score).

The build is idempotent: it upserts nodes, recomputes flags/scores, and rebuilds edges each run.

## API

New routes under `api/listens/graph/` (`website/views/listen_graph.py`, exported via `views/__init__.py`, added to `urls.py`):

- **`GET api/listens/graph/patch/?seed=<key>&type=<node_type>`**
  Returns `{ "nodes": [...], "edges": [...], "seed": <key> }` for the seed node plus its BFS-depth-2 neighborhood, capped at ~40 nodes (highest-weight neighbors win the cap). Each node carries `key, node_type, title, subtitle, thumbnail_url, video_id, play_count, is_liked, is_subscribed, in_library`. Edges carry `source, target, edge_type, weight`.
  **No `seed`** → pick a seed by weighted-random over `recommend_score` (the "↻ new patch" behavior). Cached briefly per seed.
- **`GET api/listens/graph/search/?q=<query>`**
  Case-insensitive match on `title` / `subtitle`, returns up to ~10 matching nodes (key, type, title, subtitle, thumbnail) to re-seed from. Public.

Both endpoints are public (read-only). Playback remains gated client-side by admin token, as today.

## Removal Scope (full replacement)

**Backend** — remove views, routes, exports, and tests for:
- `listen_top_tracks`, `listen_top_artists`, `listen_top_albums`
- `listen_recommended` (its weighting logic is absorbed into `recommend_score`; the old endpoint goes away)

**Kept**: `ListenTrack` model, `listen_list` (history — *see note*), `listen_sync`, `listen_import`, `listen_stats`, `listen_sync_status`.

> **Note on history:** `listen_stats` feeds a lightweight stat strip on the graph page (total plays / today). `listen_list` (raw history) is no longer surfaced in the UI; leave the endpoint in place (harmless, low-cost) but remove its frontend page.

**Frontend** — remove:
- `frontend/src/app/listens/tracks/page.tsx`
- `frontend/src/app/listens/artists/page.tsx`
- `frontend/src/app/listens/albums/page.tsx`
- The tab bar + hero in `frontend/src/app/listens/layout.tsx` (layout shrinks to a thin shell, or the graph page absorbs it).
- `frontend/src/app/listens/page.tsx` (history list) → replaced by the graph.

## Frontend

**New `/listens` page** (`frontend/src/app/listens/page.tsx`), client component:

- Full-bleed graph via **`react-force-graph-2d`** (new dep). Dark background, listens accent `#f97316`.
- **Top bar**: search input (debounced → `graph/search/`) and a "↻ NEW PATCH" button (refetch `graph/patch/` with no seed).
- **Stat strip**: total plays / today (from `listen_stats`) + a "walking near · `<seed title>`" breadcrumb.
- **Nodes**: album-art image (fallback colored circle); **radius ∝ play_count**; **yellow ring = liked**; **dashed orange ring = subscribed**; representative thumbnail for artist/album nodes.
- **Edges**: bold orange for `similar_*`, faint/dashed for `structural` / `colisten`.
- **Click a node** → re-center: fetch `graph/patch/?seed=<key>` and animate to the new neighborhood (the "walk").
- **Admin node card** (on selection, `store("adminToken")` present): thumbnail + **▶ PLAY** (track → play via `usePlayer`; artist/album → queue its top tracks) and **⊙ CENTER**. Non-admins see info only, no play.
- A small **legend** strip at the bottom.

**Pure helpers** in `frontend/src/lib/` (per the testing convention): patch→graph-shape transform, node radius scaling, edge styling selector. These get vitest coverage.

**Accent system**: `/listens` already has its accent registered (`#f97316`) in `navWheel.ts` and `layout.tsx`'s inline script — no nav change needed since the route stays `/listens`.

## Environment

- New backend env var **`LASTFM_API_KEY`** — added to `.env.example`. The build pipeline skips Last.fm enrichment (with a logged warning) if unset, so co-listen + structural edges still produce a usable graph in dev.

## Testing

**Backend** (`website/tests/`):
- `build_music_graph` produces expected nodes/edges from a fixture of `ListenTrack`s (co-listen windowing, structural edges, aggregation).
- Last.fm enrichment respects the universe filter (no edge to a non-existent node) and uses `LastfmCache` (mock the API).
- `graph/patch/` returns a bounded neighborhood; seedless call picks a node weighted by `recommend_score`.
- `graph/search/` matches title/subtitle.
- `recommend_score` personalization boost (liked/subscribed score higher than an equivalent un-flagged node).
- Removed endpoints return 404.

**Frontend** (`frontend/src/lib/__tests__/`):
- patch→graph transform, node radius scaling, edge style selector.

## Documentation

- Update `docs/README.md`: replace the four-tab Listens description with the graph.
- Update `docs/QA-CHECKLIST.md`: graph loads, new-patch reshuffles, search re-seeds, node click re-centers, admin play works, liked/subscribed rings render.

## Open Questions / Future Work

- **Celery beat** automated graph rebuild (daily) — out of scope here; the existing manual sync triggers the build. Ties into backlog ticket 045.
- **Re-auth UX** for expired YTM cookies (spec `2026-04-25-listens-improvements-design.md`) — independent, not blocked by this.
- Edge sparsity for niche artists is mitigated by co-listen + structural edges; revisit if patches feel thin in practice.
