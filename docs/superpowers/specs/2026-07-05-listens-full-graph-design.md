# Listens Full Graph + Fast Rendering + Merged Sync/Auth

**Date:** 2026-07-05
**Branch:** `feat/listens-full-graph`

## Problem

The `/listens` page renders a small (~40-node) "patch" of the music graph — a
seed node plus its neighborhood, used for shuffle/walk exploration. The full
graph on prod is ~3056 nodes / ~9090 edges. There is currently no way to view
the whole graph, and naively rendering it lags badly, especially when zoomed
out with many nodes visible.

Three related asks:

1. **Fast full-graph rendering** — a new full-graph view that renders the entire
   graph, with a minimal (cheap) draw path used when zoomed out so it stays
   smooth.
2. **Admin-gated navigation** — a button on `/listens` (admin only) linking to
   the full graph.
3. **Merged Sync/Auth button** — collapse the separate `SYNC` and `AUTH`
   buttons into one that syncs, and flips to auth only when the session is dead.

Plus a patch-view zoom refinement (see §5).

## Decisions (from brainstorming)

- Full graph **excludes `tag` nodes** — renders `track` + `artist` + `album`
  only (~2816 nodes), matching the node types the patch view already shows.
- Render-path switch is **automatic by zoom level** (no manual toggle).
- Merged Sync/Auth button is **reactive** — SYNC by default, flips to AUTH only
  after a sync returns `409 auth_expired`. No proactive login probe.
- Full-graph endpoint **replaces** the plain `/api/listens/graph/` path (not a
  new `/full/` sub-path).
- Full-graph cache is **warmed at the tail of the sync rebuild** (lazy fallback
  on cache miss), not TTL-based; no periodical job.
- Full-page node click **plays the track (admin only)** — no navigation.
- Lag fix ships as the **cheap render fix first**; hierarchical aggregation is
  explicitly deferred (see §6).

## 1. Backend — full graph endpoint

New view `graph_full` in `website/views/listen_graph.py`, wired at
`path("listens/graph/", views.graph_full)` in `website/urls.py` (alongside the
existing `graph/patch/` and `graph/search/`).

- Returns every non-`tag` node and every edge whose **both** endpoints are
  non-`tag` nodes.
- Response shape matches `graph_patch` minus `seed`: `{"nodes": [...], "edges":
  [...]}`, so the frontend's existing `toForceData` works unchanged.
- Reuses `music_graph._serialize_node`.
- **Public** (no auth). The data derives from public listens; only the *link*
  to the page is admin-gated.

### Caching (warm-on-rebuild + lazy fallback, no TTL)

Two costs must not be conflated:

- **Graph *rebuild*** (regenerating nodes/edges, incl. the ~6-min Last.fm
  similarity pass) already runs async in Celery via `_rebuild_graph()` on sync.
  Unchanged — it is the expensive part.
- **Full-graph *serialization*** (already-built nodes/edges → JSON payload) is
  **cheap**: a couple of DB queries + a JSON build. Not the rebuild.

Strategy — **warm on rebuild, lazy on miss** (no TTL, no periodical job, no new
endpoint):

- Store the serialized full-graph payload in Redis under a fixed key (e.g.
  `listens_graph_full`) with **no expiry**.
- **Warm:** at the *tail* of the rebuild path (end of `_rebuild_graph()`, after
  nodes/edges are regenerated), serialize + write the cache. The rebuild job
  already has the data loaded and just ran for minutes, so the extra serialize
  is negligible and **no visitor pays** the cost after a sync.
- **Lazy fallback:** if the key is missing on request (cold Redis / eviction),
  `get_full_graph()` recomputes and populates it on demand.
- Rationale for *not* using a periodical job: the graph only changes on sync, so
  a timer would recompute identical data most of the time.
- New helpers in `music_graph`: `get_full_graph()` (read cache, else recompute +
  store) and `warm_full_graph_cache()` (called from the rebuild tail). Cache
  logic lives beside the graph code, not in the view.

## 2. Frontend — shared `GraphCanvas` component

Extract the inline `ForceGraph2D` + `nodeCanvasObject` rendering from
`frontend/src/app/listens/page.tsx` into
`frontend/src/components/GraphCanvas.tsx`. Both the patch page and the new full
graph page use it, so the perf fix lives in one place.

### Props

- `graphData: { nodes: ForceNode[]; links: ForceLink[] }`
- `seedKey?: string | null` — the seed node to ring + center on (patch view; undefined on full)
- `isAdmin: boolean`
- `hovered: string | null`
- `onNodeHover(node | null)`
- `onNodeClick(node)`
- `alwaysLabel?: boolean` — patch view = `true` (only ~40 nodes); full = `false`
- `centerOnSeed?: boolean` — patch view centers+zooms on the seed after settle;
  full view uses zoom-to-fit once.
- `minimalThreshold?: number` — zoom `scale` below which the minimal path is
  used (default ~1.5).

### Two draw paths inside `nodeCanvasObject`, chosen by `scale`

- **Minimal** (`scale < minimalThreshold`, i.e. zoomed out): a single flat
  `ctx.arc` fill per node. **No `ctx.save`/`restore`, no `shadowBlur`, no ring
  strokes, no labels.** `shadowBlur` run 2816×/frame is the dominant cost;
  dropping it is the main win.
- **Detailed** (zoomed in, or `alwaysLabel`): the current rich rendering — glow
  (`shadowBlur`), seed ring, liked ring, subscribed dashed ring, and labels.
  With auto-switch this only runs at high zoom, where far fewer nodes are on
  screen.

Edges are the other cost (~9k line draws). Use `linkVisibility` (or a low
`globalScale` gate) so edges are hidden when zoomed out below the threshold.

Interaction/behavior parity with today's patch page (seed ring, liked/subscribed
rings, hover grow, pointer hit-area) is preserved in the detailed path.

## 3. Full graph page — `/listens/graph`

New route `frontend/src/app/listens/graph/page.tsx` (client component):

- Fetches `GET /api/listens/graph/` once on mount.
- Renders via `GraphCanvas` with `alwaysLabel={false}`, no `seedKey`,
  `centerOnSeed={false}` (zoom-to-fit once on settle).
- No search box, no shuffle button — it's the whole graph.
- Node click = play the track for admins (reuse the patch page's `playNode`
  logic); non-admins get hover labels only. No navigation.
- Uses reduced `cooldownTicks` so the 2816-node simulation settles and stops
  reasonably quickly (draw cost after settle is the interaction cost the minimal
  path fixes).
- Reachable by URL; discovery is admin-only via the button in §4.

## 4. Admin button on `/listens`

Add an admin-only button next to `SHUFFLE` in the patch page's control row,
styled like the existing controls, linking to `/listens/graph` (e.g.
`⊹ FULL GRAPH`). Gated behind the existing `isAdmin` check.

## 5. Patch-view zoom: center on seed, labels legible

Currently, on each patch settle the view calls `zoomToFit` to frame the whole
patch, and labels only render at `scale > 1.6`. Change so that when
shuffle/autoplay reloads the patch:

- Center on the **seed** node (`centerAt(seedX, seedY, ms)`) and `zoom()` to a
  fixed comfortable level — do **not** zoom out to frame the entire patch.
- Because the patch is only ~40 nodes, the patch view uses `alwaysLabel={true}`
  so every node title is legible at that zoom (drop the `scale > 1.6` gate for
  patch mode). It's fine if outer nodes fall off-screen.

Requires exposing `centerAt` and `zoom` on the `fgRef` type (react-force-graph
provides both). Seed x/y are read from `graphData` in `onEngineStop` after the
sim assigns coordinates.

## 6. Deferred: hierarchical aggregation

The graph has a natural hierarchy (**tag → artist → album → track**), so a
level-of-detail scheme (show ~240 tag / ~745 artist super-nodes when zoomed out,
expand into members on zoom-in) is applicable and would additionally cut
*simulation* cost — a more permanent fix. It is **out of scope** for this pass:
much larger build (cluster assignment, aggregate edges, dynamic node sets,
expand/collapse UX, stable positions) with real bug surface, and react-force-graph
has no native LOD. Ship the cheap render fix, measure on the real 2816-node
graph, and revisit aggregation only if still not smooth.

## Testing

- **Backend (pytest):** `graph_full` returns only non-`tag` nodes and only edges
  between non-`tag` nodes; response matches the patch shape (minus `seed`);
  cache is populated on first call and served on second; rebuild invalidates the
  cache.
- **Frontend (vitest):** pure helpers only (per repo convention) — if any new
  pure function is introduced (e.g. a "should use minimal path" predicate given
  a zoom scale + threshold), unit-test it in `frontend/src/lib/__tests__/`.
- **Manual (Playwright):** full graph loads and renders; zooming out uses flat
  dots / hides edges and stays smooth; zooming in restores glow + labels;
  patch reload centers on the seed with legible labels; merged button syncs and
  flips to AUTH on a simulated `409 auth_expired`; admin-only button visible
  only when logged in.

## Docs to update

- `docs/README.md` — describe the new full-graph view.
- `docs/QA-CHECKLIST.md` — add items: full graph loads/renders; zoom auto-switch;
  patch centers on seed with labels; merged Sync/Auth button flips on expiry;
  admin-only full-graph button visibility.
