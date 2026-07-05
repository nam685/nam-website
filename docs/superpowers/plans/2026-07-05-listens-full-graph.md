# Listens Full Graph + Fast Rendering + Merged Sync/Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-graph view of the ~2816-node music graph that renders fast when zoomed out, reachable from an admin-gated button on `/listens`, and collapse the separate Sync/Auth buttons into one reactive button.

**Architecture:** A new public `GET /api/listens/graph/` endpoint serves the whole graph (excluding internal `tag` nodes) from a Redis cache warmed at the tail of the existing graph rebuild. The frontend extracts the current inline force-graph rendering into a shared `GraphCanvas` component whose per-node draw path auto-switches between a cheap flat-dot path (zoomed out) and the existing rich path (zoomed in). The `/listens` patch page and a new `/listens/graph` full-graph page both use it.

**Tech Stack:** Django 6 + PostgreSQL + Redis (`django.core.cache`) backend; Next.js 16 App Router + React 19 + `react-force-graph-2d` frontend; pytest (backend), vitest (frontend pure logic), Playwright (manual UI verification).

## Global Constraints

- **Worktree:** all work happens in `.claude/worktrees/listens-full-graph` (branch `feat/listens-full-graph`). Never edit the main checkout.
- **Backend layout:** split subdirs — views in `website/views/<name>.py` re-exported via `website/views/__init__.py`; never create flat `website/views.py`.
- **Python:** Ruff line-length 120; a PostToolUse hook auto-runs `ruff check --fix` + `ruff format` on `.py` saves.
- **Frontend:** Prettier (semi, double quotes, 2-space indent, trailing commas) + ESLint flat config. Only pure functions in `src/lib/` get vitest tests; components are verified via Playwright.
- **API calls:** client-side fetches use `${API}/api/<endpoint>/` (import `API` from `@/lib/api`); `API` is empty string in prod (Caddy proxies).
- **localStorage:** always via `store`/`storeDel` from `@/lib/auth`, never raw `localStorage`.
- **Accent:** listens accent is `#f97316`.
- **Run backend from repo root** with `uv run …`; frontend from `frontend/` with `pnpm …`.
- **Commits:** end messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `website/services/music_graph.py` — **modify**: add `FULL_GRAPH_CACHE_KEY`, `_serialize_full_graph()`, `get_full_graph()`, `warm_full_graph_cache()`; call `warm_full_graph_cache()` at the tail of `build_graph()`.
- `website/views/listen_graph.py` — **modify**: add `graph_full` view.
- `website/views/__init__.py` — **modify**: export `graph_full`.
- `website/urls.py` — **modify**: add `path("listens/graph/", views.graph_full)`.
- `website/tests/test_listen_graph.py` — **modify**: add full-graph + cache tests.
- `frontend/src/lib/graph.ts` — **modify**: add `shouldMinimal(scale, threshold)` pure predicate.
- `frontend/src/lib/__tests__/graph.test.ts` — **modify**: test `shouldMinimal`.
- `frontend/src/components/GraphCanvas.tsx` — **create**: shared force-graph renderer with auto-switching draw path.
- `frontend/src/app/listens/page.tsx` — **modify**: use `GraphCanvas`; center-on-seed + always-labels; merged Sync/Auth button; admin `FULL GRAPH` button.
- `frontend/src/app/listens/graph/page.tsx` — **create**: full-graph page.
- `docs/README.md`, `docs/QA-CHECKLIST.md` — **modify**: document the new view + QA items.

---

## Task 1: Backend — full-graph endpoint with warm-on-rebuild cache

**Files:**
- Modify: `website/services/music_graph.py`
- Modify: `website/views/listen_graph.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`
- Test: `website/tests/test_listen_graph.py`

**Interfaces:**
- Consumes: existing `music_graph._serialize_node(n) -> dict`, models `MusicNode`, `MusicEdge`.
- Produces:
  - `music_graph.FULL_GRAPH_CACHE_KEY: str`
  - `music_graph.get_full_graph() -> dict` — `{"nodes": [...], "edges": [...]}`, non-`tag` only; reads cache, else recomputes + stores.
  - `music_graph.warm_full_graph_cache() -> dict` — recompute + store, return payload.
  - view `graph_full(request) -> JsonResponse` at URL `listens/graph/`.

- [ ] **Step 1: Write the failing tests**

Add to `website/tests/test_listen_graph.py` (top-level imports already include `Client`, `music_graph`, `ListenTrack`, `timezone`; add `MusicNode`, `MusicEdge` to the model import if missing):

```python
# --- Full graph endpoint (whole graph, excludes internal tag nodes) ---


@pytest.fixture()
def graph_with_tag(db):  # noqa: ARG001
    # The Redis/locmem cache is NOT rolled back by @pytest.mark.django_db, so clear
    # the full-graph key so each test computes against its own fixture data.
    from django.core.cache import cache

    from website.models import MusicEdge, MusicNode

    cache.delete(music_graph.FULL_GRAPH_CACHE_KEY)
    # NOTE: "tag" is intentionally not in NodeType.choices, but Django choices are not
    # DB-enforced, so create(node_type="tag") works — this mirrors prod (240 tag nodes).
    track = MusicNode.objects.create(node_type="track", key="v1", title="Let Down", video_id="v1", play_count=3)
    artist = MusicNode.objects.create(node_type="artist", key="radiohead", title="Radiohead")
    tag = MusicNode.objects.create(node_type="tag", key="rock", title="rock")
    MusicEdge.objects.create(source=track, target=artist, edge_type="structural", weight=1.0)
    MusicEdge.objects.create(source=artist, target=tag, edge_type="structural", weight=1.0)
    return {"track": track, "artist": artist, "tag": tag}


@pytest.mark.django_db
def test_full_graph_excludes_tag_nodes(graph_with_tag):  # noqa: ARG001
    data = Client().get("/api/listens/graph/").json()
    keys = {n["key"] for n in data["nodes"]}
    assert "v1" in keys
    assert "radiohead" in keys
    assert "rock" not in keys  # tag layer excluded
    assert all(n["node_type"] != "tag" for n in data["nodes"])


@pytest.mark.django_db
def test_full_graph_excludes_edges_touching_tags(graph_with_tag):  # noqa: ARG001
    data = Client().get("/api/listens/graph/").json()
    node_keys = {n["key"] for n in data["nodes"]}
    # every edge endpoint must be a surviving (non-tag) node
    for e in data["edges"]:
        assert e["source"] in node_keys
        assert e["target"] in node_keys
    # the artist->tag edge must be gone; the track->artist edge must survive
    pairs = {(e["source"], e["target"]) for e in data["edges"]}
    assert ("v1", "radiohead") in pairs
    assert ("radiohead", "rock") not in pairs


@pytest.mark.django_db
def test_full_graph_served_from_cache_after_warm(graph_with_tag):  # noqa: ARG001
    from django.core.cache import cache

    cache.delete(music_graph.FULL_GRAPH_CACHE_KEY)
    payload = music_graph.warm_full_graph_cache()
    assert cache.get(music_graph.FULL_GRAPH_CACHE_KEY) == payload
    # get_full_graph returns the cached object without recomputing
    assert music_graph.get_full_graph() == payload


@pytest.mark.django_db
def test_full_graph_lazy_recompute_on_miss(graph_with_tag):  # noqa: ARG001
    from django.core.cache import cache

    cache.delete(music_graph.FULL_GRAPH_CACHE_KEY)
    data = music_graph.get_full_graph()  # cache empty -> recompute + store
    assert cache.get(music_graph.FULL_GRAPH_CACHE_KEY) == data
    assert any(n["key"] == "v1" for n in data["nodes"])
```

Delete the stray `music_graph.invalidate_or_ignore = None` line from the first test before committing — it was a copy artifact. (Written here only so the reviewer notices; the real first test body is the two asserts on `keys`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_listen_graph.py -k full_graph -v`
Expected: FAIL — URL `/api/listens/graph/` resolves to something else or 404, and `music_graph.FULL_GRAPH_CACHE_KEY` / `get_full_graph` / `warm_full_graph_cache` do not exist (AttributeError).

- [ ] **Step 3: Add cache helpers to `music_graph.py`**

At the top of `website/services/music_graph.py`, add the cache import beside the existing Django imports:

```python
from django.core.cache import cache as redis_cache
```

Add near the other module constants (e.g. just above `def _serialize_node`):

```python
# Whole-graph payload for the full-graph page. No TTL: warmed at the tail of
# build_graph() (invalidate-on-rebuild), lazily recomputed on cache miss.
FULL_GRAPH_CACHE_KEY = "listens_graph_full"
```

Add these functions just below `get_patch` (they reuse `_serialize_node`):

```python
def _serialize_full_graph() -> dict:
    """Serialize the entire graph MINUS the internal `tag` layer.

    Tags exist only to shape the shuffle walk; they are not shown to users. We
    return every non-tag node and only edges whose BOTH endpoints are non-tag.
    """
    nodes = list(MusicNode.objects.exclude(node_type="tag"))
    id_to_key = {n.id: n.key for n in nodes}
    keep_ids = set(id_to_key)
    edges = MusicEdge.objects.filter(source_id__in=keep_ids, target_id__in=keep_ids)
    return {
        "nodes": [_serialize_node(n) for n in nodes],
        "edges": [
            {
                "source": id_to_key[e.source_id],
                "target": id_to_key[e.target_id],
                "edge_type": e.edge_type,
                "weight": e.weight,
            }
            for e in edges
        ],
    }


def warm_full_graph_cache() -> dict:
    """Recompute the full-graph payload and store it (no expiry). Returns it."""
    payload = _serialize_full_graph()
    redis_cache.set(FULL_GRAPH_CACHE_KEY, payload, None)
    return payload


def get_full_graph() -> dict:
    """Return the cached full-graph payload, recomputing on a cache miss."""
    cached = redis_cache.get(FULL_GRAPH_CACHE_KEY)
    if cached is not None:
        return cached
    return warm_full_graph_cache()
```

- [ ] **Step 4: Warm the cache at the tail of `build_graph`**

In `website/services/music_graph.py`, `build_graph()` ends with a `_report(...)` line. Add a warm call right after it:

```python
    _report(progress, f"Done: {MusicNode.objects.count()} nodes, {MusicEdge.objects.count()} edges")
    warm_full_graph_cache()
```

- [ ] **Step 5: Add the `graph_full` view**

In `website/views/listen_graph.py`, add below `graph_patch`:

```python
@require_GET
def graph_full(request):
    """Return the entire graph (non-tag nodes + edges between them), cached."""
    return JsonResponse(music_graph.get_full_graph())
```

- [ ] **Step 6: Export the view and wire the URL**

In `website/views/__init__.py`, change the import:

```python
from .listen_graph import graph_full, graph_patch, graph_search
```

and add `"graph_full",` to `__all__` beside `"graph_patch"`.

In `website/urls.py`, add above the existing `listens/graph/patch/` line (order doesn't matter — Django matches exact paths):

```python
    path("listens/graph/", views.graph_full),
```

- [ ] **Step 7: Run the full-graph tests**

Run: `uv run pytest website/tests/test_listen_graph.py -k full_graph -v`
Expected: PASS (4 tests).

- [ ] **Step 8: Run the full listen-graph suite to confirm no regression**

Run: `uv run pytest website/tests/test_listen_graph.py -v`
Expected: PASS (existing patch/search/shuffle tests + 4 new).

- [ ] **Step 9: Commit**

```bash
git add website/services/music_graph.py website/views/listen_graph.py website/views/__init__.py website/urls.py website/tests/test_listen_graph.py
git commit -m "feat(listens): full-graph endpoint /api/listens/graph/ with warm-on-rebuild cache

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Frontend — `shouldMinimal` render-path predicate

**Files:**
- Modify: `frontend/src/lib/graph.ts`
- Test: `frontend/src/lib/__tests__/graph.test.ts`

**Interfaces:**
- Produces: `shouldMinimal(scale: number, threshold: number): boolean` — true when the view is zoomed out far enough to use the cheap draw path. A `threshold` of `0` disables minimal mode entirely (used by the patch view).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/__tests__/graph.test.ts`:

```ts
import { shouldMinimal } from "../graph";

describe("shouldMinimal", () => {
  it("uses minimal path when zoomed out below the threshold", () => {
    expect(shouldMinimal(0.5, 1.5)).toBe(true);
    expect(shouldMinimal(1.49, 1.5)).toBe(true);
  });
  it("uses the detailed path at or above the threshold", () => {
    expect(shouldMinimal(1.5, 1.5)).toBe(false);
    expect(shouldMinimal(3, 1.5)).toBe(false);
  });
  it("threshold 0 never selects minimal (patch view is always detailed)", () => {
    expect(shouldMinimal(0.01, 0)).toBe(false);
    expect(shouldMinimal(5, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test -- graph`
Expected: FAIL — `shouldMinimal` is not exported.

- [ ] **Step 3: Implement `shouldMinimal`**

Add to `frontend/src/lib/graph.ts` (e.g. below `nodeRadius`):

```ts
/** True when zoomed out far enough to use the cheap flat-dot draw path.
 * `threshold` of 0 disables minimal mode (small patch views are always detailed). */
export function shouldMinimal(scale: number, threshold: number): boolean {
  return scale < threshold;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && pnpm test -- graph`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/graph.ts frontend/src/lib/__tests__/graph.test.ts
git commit -m "feat(listens): shouldMinimal predicate for zoom-based render switch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend — shared `GraphCanvas` component + patch-page refactor

Extract the inline `ForceGraph2D` render from the patch page into a reusable component with the minimal/detailed auto-switch, edge-culling, always-label, and center-on-seed behaviors. Wire `/listens` to it. Verified via Playwright (component logic is not unit-tested per repo convention).

**Files:**
- Create: `frontend/src/components/GraphCanvas.tsx`
- Modify: `frontend/src/app/listens/page.tsx`

**Interfaces:**
- Consumes: `shouldMinimal` (Task 2); `edgeColor`, `nodeColor`, `nodeRadius`, `ForceNode`, `ForceLink` from `@/lib/graph`.
- Produces: `GraphCanvas` default export with props:
  ```ts
  interface GraphCanvasProps {
    data: { nodes: ForceNode[]; links: ForceLink[] };
    seedKey?: string | null;
    isAdmin: boolean;
    hovered: string | null;
    onNodeHover: (node: ForceNode | null) => void;
    onNodeClick: (node: ForceNode) => void;
    alwaysLabel?: boolean;      // default false
    centerOnSeed?: boolean;     // default false
    minimalThreshold?: number;  // default 1.5; 0 = never minimal
  }
  ```

- [ ] **Step 1: Create `GraphCanvas.tsx`**

Create `frontend/src/components/GraphCanvas.tsx` with the full component below. It reproduces the patch page's current rendering in the *detailed* path and adds the *minimal* path + edge culling + center-on-seed:

```tsx
"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useRef, useState } from "react";
import { edgeColor, nodeColor, nodeRadius, shouldMinimal, type ForceLink, type ForceNode } from "@/lib/graph";

// Cast at the import boundary: react-force-graph-2d's callback prop types expect
// its own NodeObject/LinkObject generics, incompatible with our ForceNode/ForceLink.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as React.ComponentType<Record<string, unknown>>;

const ACCENT = "#f97316";
// Zoom level to settle at when centering on a patch seed — tuned so a ~40-node
// patch's labels are legible without framing the whole (possibly sprawling) patch.
const PATCH_SEED_ZOOM = 2.5;

type FgRef = {
  zoomToFit?: (ms: number, px: number) => void;
  centerAt?: (x: number, y: number, ms: number) => void;
  zoom?: (z?: number, ms?: number) => number;
  d3Force?: (name: string) => { strength?: (n: number) => void; distance?: (n: number) => void } | undefined;
} | null;

export interface GraphCanvasProps {
  data: { nodes: ForceNode[]; links: ForceLink[] };
  seedKey?: string | null;
  isAdmin: boolean;
  hovered: string | null;
  onNodeHover: (node: ForceNode | null) => void;
  onNodeClick: (node: ForceNode) => void;
  alwaysLabel?: boolean;
  centerOnSeed?: boolean;
  minimalThreshold?: number;
}

export default function GraphCanvas({
  data,
  seedKey = null,
  isAdmin, // eslint-disable-line @typescript-eslint/no-unused-vars
  hovered,
  onNodeHover,
  onNodeClick,
  alwaysLabel = false,
  centerOnSeed = false,
  minimalThreshold = 1.5,
}: GraphCanvasProps) {
  const fgRef = useRef<FgRef>(null);
  // Auto-fit/recenter only once per data set (on first settle) — not on every
  // engine stop, or dragging a node (which reheats the sim) would yank the view.
  const fittedRef = useRef(false);
  // Track live zoom so linkVisibility can cull edges without reading fgRef each call.
  const zoomRef = useRef(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 1000, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setDims({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // On each new data set: allow one auto-fit, and spread nodes apart so a dense
  // set sprawls to fill the canvas instead of collapsing into a tight ball.
  useEffect(() => {
    fittedRef.current = false;
    fgRef.current?.d3Force?.("charge")?.strength?.(-320);
    fgRef.current?.d3Force?.("link")?.distance?.(70);
  }, [data]);

  return (
    <div
      ref={containerRef}
      style={{
        // Full-bleed: break out of the centered max-width layout to span page width.
        width: "100vw",
        marginLeft: "calc(50% - 50vw)",
        height: "calc(100vh - 200px)",
        minHeight: 480,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
        background: "radial-gradient(circle at 50% 42%, rgba(249,115,22,0.07) 0%, #0a0a0a 68%)",
      }}
    >
      <ForceGraph2D
        ref={fgRef as never}
        width={dims.width}
        height={dims.height}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={1}
        cooldownTicks={120}
        onZoom={(t: { k: number }) => {
          zoomRef.current = t.k;
        }}
        onEngineStop={() => {
          if (fittedRef.current) return;
          fittedRef.current = true;
          if (centerOnSeed && seedKey) {
            const seed = data.nodes.find((n) => n.key === seedKey) as
              | (ForceNode & { x?: number; y?: number })
              | undefined;
            if (seed && seed.x != null && seed.y != null) {
              fgRef.current?.centerAt?.(seed.x, seed.y, 400);
              fgRef.current?.zoom?.(PATCH_SEED_ZOOM, 400);
              return;
            }
          }
          fgRef.current?.zoomToFit?.(400, 80);
        }}
        linkColor={(l: ForceLink) => edgeColor(l.edge_type, l.weight)}
        linkWidth={0.5}
        // Cull edges when zoomed out into minimal mode — ~thousands of line draws
        // are the other big cost alongside per-node shadowBlur.
        linkVisibility={() => !shouldMinimal(zoomRef.current, minimalThreshold)}
        onNodeClick={(node: ForceNode) => onNodeClick(node)}
        onNodeHover={(node: ForceNode | null) => onNodeHover(node)}
        nodePointerAreaPaint={(
          node: ForceNode & { x: number; y: number },
          color: string,
          ctx: CanvasRenderingContext2D,
          scale: number,
        ) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, (nodeRadius(node.play_count) + 2) / scale, 0, 2 * Math.PI);
          ctx.fill();
        }}
        nodeCanvasObject={(node: ForceNode & { x: number; y: number }, ctx: CanvasRenderingContext2D, scale: number) => {
          const fill = nodeColor(node.node_type);
          // MINIMAL PATH: zoomed out — one flat filled dot, no save/restore, no
          // shadowBlur, no rings, no labels. shadowBlur run per-node/frame is the
          // dominant cost; dropping it is the whole point.
          if (shouldMinimal(scale, minimalThreshold)) {
            const r = nodeRadius(node.play_count) / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = fill;
            ctx.fill();
            return;
          }
          // DETAILED PATH: the existing rich rendering (glow + rings + labels).
          const isSeed = seedKey === node.key;
          const isHovered = hovered === node.key;
          const r = (nodeRadius(node.play_count) * (isHovered ? 1.6 : 1)) / scale;
          ctx.save();
          ctx.shadowColor = fill;
          ctx.shadowBlur = r * (isSeed || isHovered ? 2.4 : 1.5);
          ctx.globalAlpha = isHovered ? 1 : 0.92;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.restore();
          if (isSeed) {
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = 1.5 / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 3 / scale, 0, 2 * Math.PI);
            ctx.stroke();
          }
          if (node.is_liked) {
            ctx.strokeStyle = "#ffd400";
            ctx.lineWidth = 2 / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 2 / scale, 0, 2 * Math.PI);
            ctx.stroke();
          }
          if (node.is_subscribed) {
            ctx.strokeStyle = ACCENT;
            ctx.setLineDash([2, 2]);
            ctx.lineWidth = 1.5 / scale;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 4 / scale, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (alwaysLabel || isSeed || isHovered || scale > 1.6) {
            const label = node.title.length > 18 ? node.title.slice(0, 17) + "…" : node.title;
            ctx.font = `${10 / scale}px monospace`;
            ctx.fillStyle = "#ccc";
            ctx.textAlign = "center";
            ctx.fillText(label, node.x, node.y + r + 9 / scale);
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Refactor `/listens/page.tsx` to use `GraphCanvas`**

In `frontend/src/app/listens/page.tsx`:

1. Remove the inline `ForceGraph2D` dynamic import and the `fgRef`/`fittedRef`/`containerRef`/`dims`/ResizeObserver `useEffect` (all moved into `GraphCanvas`). Also remove the `d3Force` spread `useEffect` on `[patch]` (moved into the component keyed on `data`) — but keep the `fittedRef.current = false` reset behavior which now lives in the component.
2. Replace the `import { edgeColor, nodeColor, nodeRadius, toForceData, type ForceNode }` line with:
   ```tsx
   import { toForceData, type ForceNode } from "@/lib/graph";
   import GraphCanvas from "@/components/GraphCanvas";
   ```
3. Keep `player`, `isAdmin`, `patch`, `stats`, `query`, `results`, `hovered`, sync/reauth state, `loadPatch`, `playNode`, `doSync`, `saveReauth`, `data` (the `toForceData` memo).
4. Replace the entire `<div ref={containerRef} …><ForceGraph2D … /></div>` block (currently the last child) with:

   ```tsx
   <GraphCanvas
     data={data}
     seedKey={patch?.seed ?? null}
     isAdmin={isAdmin}
     hovered={hovered}
     onNodeHover={(node) => setHovered(node ? node.key : null)}
     onNodeClick={(node) => {
       // Click = walk the graph: play (admin) and re-center on this node.
       if (isAdmin) playNode(node);
       loadPatch(node.key, node.node_type);
     }}
     alwaysLabel
     centerOnSeed
     minimalThreshold={0}
   />
   ```

   (`minimalThreshold={0}` = the ~40-node patch never uses minimal mode; `alwaysLabel` + `centerOnSeed` give the "center on seed, every title legible" behavior.)

- [ ] **Step 3: Typecheck + lint**

Run: `cd frontend && pnpm lint`
Expected: no errors. Fix any unused-import warnings from the removed inline render.

- [ ] **Step 4: Verify the patch page visually (Playwright)**

Run: `cd frontend && pnpm dev` (Turbopack, port 3001). With backend running (`uv run python manage.py runserver` from repo root + `make db-seed` if the graph is empty), open `http://localhost:3001/listens`.

Screenshot and confirm: graph renders; SHUFFLE reloads a new patch and the view **centers on the seed** (the white-ringed node) at a zoom where node **titles are readable** (not zoomed out to frame everything). Dragging a node does not snap the view back.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/GraphCanvas.tsx frontend/src/app/listens/page.tsx
git commit -m "refactor(listens): extract GraphCanvas with zoom-switched render + center-on-seed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend — merged reactive Sync/Auth button + admin FULL GRAPH button

**Files:**
- Modify: `frontend/src/app/listens/page.tsx`

**Interfaces:**
- Consumes: existing `doSync`, `showReauth`/`setShowReauth`, `syncStatus`, `getAdminToken`, `isAdmin`, `reauthStatus`.
- Produces: no new exports; UI change only.

- [ ] **Step 1: Add `authNeeded` state**

Near the other `useState` hooks in `ListensGraphPage`, add:

```tsx
const [authNeeded, setAuthNeeded] = useState(false);
```

- [ ] **Step 2: Flip to auth mode on `auth_expired`, and back on successful reauth**

In `doSync`, in the `409 && data.auth_expired` branch, set `authNeeded`:

```tsx
      if (res.status === 409 && data.auth_expired) {
        setSyncStatus("error");
        setSyncMessage("YouTube Music session expired — re-authenticate below, then sync again.");
        setAuthNeeded(true);
        setShowReauth(true);
        return; // leave the message + panel up; don't auto-clear
      }
```

In `saveReauth`, in the success branch (where `setReauthStatus("done")` is set), clear it so the button reverts to SYNC:

```tsx
      } else {
        setReauthStatus("done");
        setAuthNeeded(false);
        setTimeout(() => {
          setShowReauth(false);
          setReauthHeaders("");
          setReauthStatus("idle");
        }, 1500);
      }
```

- [ ] **Step 3: Replace the two buttons (SYNC + AUTH) with one merged button**

In the `{isAdmin && (<> … </>)}` block of the JSX, replace **both** the `SYNC` `<button>` and the `AUTH` `<button>` with this single button:

```tsx
            <button
              onClick={() => {
                if (authNeeded) {
                  if (!getAdminToken()) return;
                  setShowReauth((v) => !v);
                } else {
                  doSync();
                }
              }}
              disabled={syncStatus === "syncing"}
              style={{
                background: authNeeded || showReauth ? "rgba(249,115,22,0.15)" : "none",
                border: `1px solid rgba(249,115,22,0.3)`,
                borderRadius: 6,
                padding: "8px 14px",
                color: ACCENT,
                fontSize: 10,
                fontFamily: "monospace",
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              {authNeeded
                ? "AUTH"
                : syncStatus === "syncing"
                  ? "SYNCING..."
                  : syncStatus === "done"
                    ? "SYNCED!"
                    : syncStatus === "error"
                      ? "FAILED"
                      : "SYNC"}
            </button>
```

- [ ] **Step 4: Add the admin `FULL GRAPH` button**

Import `Link` at the top of the file:

```tsx
import Link from "next/link";
```

Immediately after the `↻ SHUFFLE` `<button>` (which is outside the `isAdmin` block), add an admin-gated link styled like SHUFFLE:

```tsx
        {isAdmin && (
          <Link
            href="/listens/graph"
            style={{
              background: "rgba(249,115,22,0.12)",
              border: `1px solid ${ACCENT}`,
              borderRadius: 6,
              padding: "8px 14px",
              color: ACCENT,
              fontSize: 10,
              fontFamily: "monospace",
              letterSpacing: 1,
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            ⊹ FULL GRAPH
          </Link>
        )}
```

- [ ] **Step 5: Lint**

Run: `cd frontend && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Verify (Playwright)**

With dev servers running, log in via `/sudo` (so `adminToken` is set), open `/listens`:
- Confirm only **one** SYNC button (no separate AUTH) and a `⊹ FULL GRAPH` button appear (admin only — in a fresh/incognito session without a token they are absent).
- To exercise the flip without a dead cookie, temporarily stub the sync fetch in devtools OR trust the logic: on a real `409 auth_expired`, the button reads `AUTH` and clicking it toggles the reauth panel. Screenshot the admin control row.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/listens/page.tsx
git commit -m "feat(listens): merge Sync/Auth into one reactive button + admin FULL GRAPH link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — `/listens/graph` full-graph page

**Files:**
- Create: `frontend/src/app/listens/graph/page.tsx`

**Interfaces:**
- Consumes: `GraphCanvas` (Task 3); `API`, `type GraphPatch`, `type ListenTrack` from `@/lib/api`; `store` from `@/lib/auth`; `toForceData` from `@/lib/graph`; `usePlayer` from `@/lib/player`.
- Produces: default-exported page component at route `/listens/graph`.

- [ ] **Step 1: Create the page**

Create `frontend/src/app/listens/graph/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { API, type GraphPatch, type ListenTrack } from "@/lib/api";
import { store } from "@/lib/auth";
import GraphCanvas from "@/components/GraphCanvas";
import { toForceData, type ForceNode } from "@/lib/graph";
import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";

export default function ListensFullGraphPage() {
  const player = usePlayer();
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");
  // The full-graph endpoint returns {nodes, edges} (no seed) — GraphPatch shape with seed:null.
  const [graph, setGraph] = useState<GraphPatch | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/listens/graph/`)
      .then((r) => r.json())
      .then((d) => setGraph({ seed: null, nodes: d.nodes ?? [], edges: d.edges ?? [] }))
      .catch(() => setGraph({ seed: null, nodes: [], edges: [] }));
  }, []);

  const data = useMemo(
    () => (graph ? toForceData(graph) : { nodes: [], links: [] }),
    [graph],
  );

  const playNode = (node: ForceNode) => {
    if (!isAdmin || !node.video_id) return;
    const track: ListenTrack = {
      id: 0,
      video_id: node.video_id,
      title: node.title,
      artist: node.subtitle || node.title,
      album: "",
      thumbnail_url: node.thumbnail_url,
      duration: "",
      played_at: "",
    };
    player.play(track, [track]);
  };

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 4px" }}>
        <Link
          href="/listens"
          style={{
            background: "none",
            border: `1px solid rgba(249,115,22,0.3)`,
            borderRadius: 6,
            padding: "8px 14px",
            color: ACCENT,
            fontSize: 10,
            fontFamily: "monospace",
            letterSpacing: 1,
            textDecoration: "none",
          }}
        >
          ← BACK
        </Link>
        <span style={{ color: "#666", fontSize: 11, fontFamily: "monospace", letterSpacing: 1 }}>
          FULL GRAPH · {data.nodes.length.toLocaleString()} NODES
        </span>
      </div>
      <GraphCanvas
        data={data}
        isAdmin={isAdmin}
        hovered={hovered}
        onNodeHover={(node) => setHovered(node ? node.key : null)}
        onNodeClick={(node) => playNode(node)}
        minimalThreshold={1.5}
      />
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `cd frontend && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Verify (Playwright)**

With dev servers running and a non-trivial graph seeded (or against a DB with real data), open `http://localhost:3001/listens/graph`.
- Confirm: the node-count label shows and the graph renders.
- **Zoom out**: dots become flat (no glow), edges disappear, and pan/zoom stays smooth. **Zoom in** past the threshold: glow + rings + labels reappear.
- (If the local seed graph is tiny, verify the switch by scrolling to a very low zoom so `scale < 1.5`.) Screenshot both zoom states.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/listens/graph/page.tsx
git commit -m "feat(listens): full-graph page at /listens/graph with fast zoomed-out render

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Docs

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/QA-CHECKLIST.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Update `docs/README.md`**

Find the section describing the Listens page. Add a sentence describing the full-graph view, e.g.:

> **Full graph** — admins can open a full-graph view (`/listens/graph`, linked from the Listens controls) showing the entire music graph. Zoomed out it renders as fast flat dots; zooming in reveals track/artist/album detail, likes, and labels.

- [ ] **Step 2: Update `docs/QA-CHECKLIST.md`**

Add Listens items:

```markdown
- [ ] `/listens`: SHUFFLE re-centers on the seed node with node titles legible (not zoomed all the way out).
- [ ] `/listens`: a single Sync button shows (no separate Auth); after a YTM `auth_expired` it reads AUTH and opens the re-auth panel.
- [ ] `/listens`: the `⊹ FULL GRAPH` button appears only when logged in as admin.
- [ ] `/listens/graph`: full graph loads; zoomed out = flat dots + hidden edges + smooth; zoomed in = glow, rings, labels.
```

- [ ] **Step 3: Commit**

```bash
git add docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs(listens): document full-graph view + QA items

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Backend: `uv run pytest website/tests/test_listen_graph.py -v` → all pass.
- [ ] Frontend: `cd frontend && pnpm test` → all pass; `pnpm lint` → clean.
- [ ] Manual: walk the QA items added in Task 6 with dev servers running.
- [ ] Then use the `ship` skill (update TODO/dev log, push, CI, PR) when ready.
