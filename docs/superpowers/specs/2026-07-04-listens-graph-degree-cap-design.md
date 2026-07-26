# Listens graph: cap super-node degree

## Problem

On `/listens`, the force-graph shows a seed node plus its BFS depth-2 neighborhood
(`get_patch`, capped at `PATCH_MAX_NODES = 40`). Some nodes render as "super nodes" —
too many links radiating out — which collapses the patch into a hairball.

Co-listen edges are already degree-capped at build time (`COLISTEN_TOP_K = 6`). The
super-nodes come from the **uncapped** edge types:

- **structural** (`rebuild_structural_edges`): one edge per distinct track for an
  artist/album, so a prolific artist links to every one of its tracks.
- **similar_artist** (`rebuild_similarity_edges`): one edge per Last.fm match.

`get_patch` caps the number of *nodes* but emits *every* edge among them, so a single
hub inside the 40-node patch still draws all its links.

## Approach

Add a **per-node degree cap applied at patch time** in `get_patch` — visual only. The
underlying `MusicEdge` rows are untouched, so `radio_next` / shuffle keep scoring over
the full edge set. Reversible, testable, and isolated to the one function that feeds the
visualization.

Rejected alternatives:
- *Cap at build time* — permanently deletes edges the radio algorithm scores over.
- *Cap in the frontend `toForceData`* — pushes graph logic into a pure styling helper and
  ships all the edges over the wire anyway.

## Design

New in `website/services/music_graph.py`:

- `PATCH_MAX_DEGREE = 8` — max edges any single node may keep within a patch.
- `_cap_edges_by_degree(edges, max_degree=PATCH_MAX_DEGREE)` — greedy degree-bounded
  subgraph:
  1. Rank all edges by `(RADIO_EDGE_PRIORITY[edge_type], weight)` descending, so the
     most meaningful relationships (`similar_track > colisten > similar_artist >
     structural`) survive and excess structural hub links are the first dropped.
  2. Walk the ranked list; keep an edge only if **both** endpoints are still below
     `max_degree`; increment both endpoints' degree on keep.
  3. Return the kept edges.

  Guarantee: no node exceeds `max_degree` links. A node may end with fewer if its edges
  were claimed by higher-priority neighbors — acceptable and desirable (less clumping).

`get_patch` calls `_cap_edges_by_degree(list(edges))` before serializing, replacing the
"emit every edge among collected nodes" step.

No frontend change: `toForceData` already drops edges whose endpoints aren't in the
node set, and the patch now simply carries fewer edges.

## Testing

`website/tests/test_music_graph.py`:
- A hub node structurally linked to > `PATCH_MAX_DEGREE` tracks → `get_patch` returns
  the hub with at most `PATCH_MAX_DEGREE` incident edges.
- When a hub has both low-priority structural edges and higher-priority
  colisten/similar edges beyond the cap, the higher-priority ones are kept.
- Existing `get_patch` tests (seed neighborhood, seedless pick) still pass.
