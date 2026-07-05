# Listens Graph Redesign + Admin Diagnostic Visualization

**Date:** 2026-07-05
**Status:** Approved (design)
**Branch:** `feat/listens-graph-viz`

## 1. Motivation

The `/listens` music graph drives shuffle and radio. In practice it fragments into
disconnected clusters ("clusters = bad" — a well-connected graph would let navigation
flow) and recurs on a handful of super-nodes. Both are visible in the current patch view:
small islands floating in space, and the same few tracks reappearing.

### Diagnosis (measured on prod, 2026-07-05)

Full graph: **2,816 nodes** (1,275 track · 796 album · 745 artist), **8,504 edges**
(4,233 colisten · 2,524 structural · 1,615 similar_artist · 132 similar_track).

Three confirmed pathologies:

1. **Degree-8 plateau (algorithm artifact).** 526 track nodes sit at *exactly* degree 8;
   488 have the identical composition `{colisten: 6, structural: 2}`. That is
   `COLISTEN_TOP_K = 6` co-listen edges + 2 structural edges (track→artist, track→album).
   An ordinary track cannot exceed ~8 connections *by construction*.

2. **Mega-hubs via selection asymmetry.** `COLISTEN_TOP_K` bounds how many partners a node
   *picks*, but an edge survives if *either* endpoint picks it. 678 nodes have colisten-degree
   exactly 6; a long tail runs up to **395**. These hubs have *low* play counts (7, 5, 4) —
   they are not favorites, they are tracks that happened to sit inside many different 30-min
   Takeout windows, so hundreds of tracks ranked them top-6. This is textbook **hubness**.

3. **Fragmentation.** 1 giant component (2,630 nodes) + **65 islands** (27 of size 2, 32 of
   size 3). Each island is a track + its artist + album that never co-listened with another
   real-timestamp track and whose artist got no Last.fm similar match already in the library.

These are the two coupled failure modes of a naïve nearest-neighbor graph. We rebuild the
graph definition from the ground up to fix both, reusing only the pieces that carry their
weight.

## 2. Prior art

The two problems are named, studied, and coupled in the music-IR literature:

- **Hubness** (Flexer, Schnitzer, Schedl, Widmer — OFAI; ISMIR'12 best paper). In any
  nearest-neighbor similarity space, a few items become the neighbor of far too many others
  as a *geometric artifact*, not a popularity signal. Exactly our low-play-count 395-edge
  tracks. Asymmetric top-K selection is a canonical hubness generator.
- **Naïve mutual-kNN backfires.** Keeping an edge only if *both* endpoints pick each other
  kills hubs but can disconnect up to ~89% of the data — it would *worsen* fragmentation.
- **Mutual Proximity (MP)** — Flexer & Stevens, *"Mutual proximity graphs for improved
  reachability in music recommendation"* (J. New Music Research, 2017;
  https://pmc.ncbi.nlm.nih.gov/articles/PMC5750815/). Rescale each affinity to the
  *probability that x and y are mutually near* using the empirical distribution. Reported:
  hubs **291 → 2** (99% down) while keeping **91.6% reachability** — no spanning tree needed.
  This threads the needle naïve mutual-kNN cannot. Hubness also afflicts collaborative
  filtering (Knees, Schnitzer, Flexer, *"Improving neighborhood-based collaborative filtering
  by reducing hubness"*, ICMR'14), so MP applies to Last.fm CF edges too.
- **Multipartite connectivity via a shared low-cardinality layer.** A heterogeneous graph
  where every item attaches to a small shared attribute layer is connected *by construction*
  (cf. arxiv 2404.15208, a symbolic-score network where every chord attaches to the same 12
  pitch-class nodes — different domain, transferable structural idea). Our analog: a **tag /
  genre layer**. Few tags, widely shared, connect the whole graph including islands.
- **Hybrid CF + content-based** is the standard music-recsys recipe: CF for dense/popular
  items, content for sparse/niche/cold-start. **Last.fm `artist.getsimilar` / `track.getsimilar`
  *is* collaborative filtering** — crowd co-listening from Last.fm's global user base. Combined
  with our *personal* item-item co-occurrence (co-listen) and *content* (tags), we cover all
  three signals.
- **Uniform random-walk navigation.** A random walk *without restart* has a stationary
  distribution **proportional to node degree** — popular/central songs are visited more *for
  free*, with no explicit popularity term. This is only meaningful if degree reflects genuine
  centrality, which is precisely what MP de-hubbing restores. Random-walk-with-restart is a
  standard recommender navigation primitive (e.g. arxiv 1708.09088, 1711.04101).

## 3. Goals / non-goals

**Goals**
- One connected graph (target: a single component; islands eliminated).
- Degree reflects genuine centrality — no artifact plateau, no low-play-count mega-hubs.
- Navigation is a *uniform random walk*; shuffle and radio unify into one primitive.
- An admin-gated visualization that makes connectivity health visible and serves as the
  **acceptance instrument** (old-vs-new metrics).

**Non-goals**
- Multi-user collaborative filtering infrastructure (we have one user; Last.fm is our CF).
- Audio-content embeddings / ML models. Tags are our content signal.
- Changing the public `/listens` UX beyond what the new navigator returns.

## 4. Rethought graph definition

**Principle:** build a graph good enough that navigation is *just a uniform random walk*.
That demands the graph be **connected** (no islands strand the walk) and **de-hubbed**
(degree = genuine centrality, so degree-proportional visitation is honest).

### 4.1 Nodes (heterogeneous)

`track` (video_id) · `artist` · `album` · **`tag`** (new — Last.fm genre/mood).

`MusicNode.NodeType` gains `TAG = "tag"`. Tag `key` = normalized tag name; `title` = display
name. Tag nodes carry no play_count/personalization.

### 4.2 Edges (undirected, weighted)

`MusicEdge.EdgeType` becomes: `structural`, `tag`, `affinity`. (`colisten`,
`similar_artist`, `similar_track` collapse into the single MP-rescaled `affinity` type; the
raw source is retained on the edge via a new `source_kind` field for the viz's edge-type
filter — see §7.)

1. **structural** — track↔artist, track↔album, album↔artist. Local backbone; every track is
   attached to its own metadata cluster. *(reuse `rebuild_structural_edges`, add album↔artist)*
2. **tag** — artist↔tag from `artist.getTopTags`. Few tags, widely shared ⇒ connects the whole
   graph, eliminates islands. Weight = tag rank/count from Last.fm. *(new)*
3. **affinity** — the recommendation edges. Built in two stages:
   - **Collect raw affinity** from two CF signals into a common similarity in [0, 1]:
     - *personal co-listen*: item-item co-occurrence in 30-min sessions (single-user CF),
       normalized per-node.
     - *global CF*: Last.fm `similar_artist` (artist↔artist) + `similar_track` (track↔track)
       match scores (already in [0, 1]).
   - **Mutual-Proximity rescale + symmetric keep** (§5). This replaces the asymmetric
     `COLISTEN_TOP_K` cap entirely.

### 4.3 Connectivity guarantee (belt-and-suspenders)

The tag layer *guarantees* a single connected component even if MP prunes affinity edges
aggressively: every artist with ≥1 known tag is reachable via its tag nodes, and every track
reaches its artist structurally. Artists with no Last.fm tags at all are the only residual
island risk; these are logged and reported in the viz, and fall back to their structural
cluster (still attached to the giant component if the artist shares *any* tag or affinity).

## 5. Mutual Proximity (affinity de-hubbing)

For a similarity `s(x, y)` over each node's candidate affinity partners, define the empirical
CDF per node:

```
CDF_x(s) = |{ z : s(x, z) < s }| / N_x        # N_x = # of x's affinity candidates
MP(x, y) = CDF_x(s(x, y)) · CDF_y(s(y, x))     # symmetric by construction, in [0, 1]
```

`MP(x, y)` is high only when y ranks among x's strongest affinities **and** x ranks among y's.
A low-play-count hub `h` co-listened once with 300 tracks has a uniformly weak affinity
distribution, so `CDF_h` is low for all of them → every one of those edges gets low MP →
pruned. This de-hubs exactly the artifact hubs while leaving genuinely mutual pairs intact.

**Construction:**
1. Gather raw affinity candidate pairs (co-listen counts + Last.fm matches), normalized to
   [0, 1] per source.
2. Per node, compute the empirical CDF over its candidate similarities.
3. `weight = MP(x, y)`; keep edges with `MP ≥ MP_THRESHOLD` (tunable; start ~0.0 keep-all-
   positive and tighten using the viz).
4. Store as `affinity` edges with `source_kind ∈ {colisten, similar_artist, similar_track}`
   recorded for the viz filter.

Parameters (module constants, tunable and verified via the viz): `MP_THRESHOLD`,
per-source normalization. `COLISTEN_TOP_K`, `RADIO_EDGE_PRIORITY`, `STRUCTURAL_WEIGHT`
selection role, `SEED_TYPE_WEIGHTS`, and `recommend_score` seed-picking are **deleted**.

## 6. Navigation — uniform random walk (unifies shuffle + radio)

One primitive replaces `radio_next`, seedless-shuffle seed-picking, and `get_patch` scoring.

```
walk(seed=None, recent=set(), n) -> list[track]:
    if seed is None: start at a uniformly random track node
    else:            start at seed  (radio: small restart prob p back to seed each step)
    step: from current node, choose a neighbor uniformly at random over incident
          affinity + structural edges; traverse tag/artist/album nodes but do NOT emit them;
          emit a track node the first time it is reached if not in `recent`
    stop when n distinct fresh tracks emitted or walk budget exhausted
```

- **Shuffle** = walk with `seed=None`, no restart. Stationary distribution ∝ degree ⇒
  popular/central tracks surface naturally; no explicit popularity term.
- **Radio** = walk with `seed=<video_id>`, small restart probability toward the seed to keep
  results topically near it.
- `recent` reuses the existing recent-seeds exclusion (`_RECENT_SEEDS_KEY`).
- Tag nodes are bridge-only (traversed for reachability, never emitted).

Because the graph is now connected, the walk never strands; because it is de-hubbed, it does
not over-visit artifact hubs.

## 7. Admin-gated visualization — `/listens/graph`

The **acceptance instrument**: proves the rebuilt graph is connected, de-hubbed, and that
random-walk visitation ∝ degree, side-by-side against a snapshot of the old graph.

### 7.1 Backend — `GET /api/listens/graph/full/` (admin-gated)

New view `graph_full` in `website/views/listen_graph.py`, `@require_admin`, wired in
`urls.py` + `views/__init__.py`. Returns the whole graph in one payload (~few-hundred-KB
JSON, acceptable for an admin tool):

- **nodes**: `key, node_type, title, subtitle, video_id, play_count, is_liked/is_subscribed/
  in_library`, plus computed **`degree`** and **`component`** id.
- **edges**: `source, target, edge_type, source_kind, weight`.
- **summary**: component count + size histogram, degree histogram (deg-8 plateau flagged),
  edge-type/source-kind counts, top-N hubs (by degree), island list (components ≤ size N),
  and **articulation points + bridge edges within the giant component** (nodes/edges whose
  removal fragments it — surfaces internal fragility, not just true islands).

A new pure, testable function `full_graph_snapshot()` in `services/music_graph.py` computes
components (union-find), degree, articulation points/bridges (Tarjan), and the summary. Single
source of truth, unit-testable on a fixture graph.

### 7.2 Frontend — `frontend/src/app/listens/graph/page.tsx` (admin-gated)

`getAdminToken()` → redirect `/sudo` if missing. Renders with **react-force-graph-2d** (same
lib as the patch view). Encodings:

- **Color by component** — giant component in page orange; each island a distinct hue so
  orphans pop. Bridge edges / articulation points highlighted.
- **Size by degree** (log-scaled) — mega-hubs tower over the plateau (before), flat after.
- **Edge-type filter** — toggle structural / tag / affinity (and affinity `source_kind`:
  colisten / similar_artist / similar_track) to see each layer's contribution.
- **Stats + hub/island panel** — live component count, size + degree histograms, top-hub list,
  island list, articulation/bridge list; each clickable to focus/zoom the node.

New pure helpers (component color map, degree→radius, filter predicate) added to
`frontend/src/lib/graph.ts` with vitest coverage.

## 8. Data model changes

- `MusicNode.NodeType`: add `TAG = "tag"`.
- `MusicEdge.EdgeType`: `structural`, `tag`, `affinity` (migrate old rows on rebuild — the
  graph is a derived cache, so a full rebuild repopulates it).
- `MusicEdge`: add `source_kind = CharField(blank, default="")` (raw provenance for the viz).
- `MusicNode.recommend_score`: retained on the model for now but no longer used by navigation
  (removed from the pipeline); dropped in a later cleanup migration to avoid churn here.
- One Django migration (`makemigrations`) for the enum widening + `source_kind`.

## 9. Reuse / delete audit ("reuse only if useful")

**Keep:** `ListenTrack` log (source of truth); `MusicNode`/`MusicEdge` schema (extended);
Last.fm service + `LastfmCache`; session-windowing in `rebuild_colisten_edges`;
`rebuild_structural_edges` (extended with album↔artist).

**Add:** `lastfm.fetch_artist_top_tags` (`artist.gettoptags`); tag nodes/edges;
`mutual_proximity` rescale; `full_graph_snapshot`; `walk` navigator.

**Delete:** `COLISTEN_TOP_K` asymmetric cap; `RADIO_EDGE_PRIORITY`; `RADIO_CANDIDATE_POOL`;
`SEED_POOL_SIZE`/`SEED_TYPE_WEIGHTS`; `_pick_recommended_seed`; `compute_recommend_scores`
from the pipeline; `radio_next` weighted scoring (replaced by `walk`).

## 10. Testing

**Backend (pytest):**
- `mutual_proximity`: on a hand-built affinity set, a synthetic hub is pruned while a mutual
  pair survives; MP symmetric; values in [0, 1].
- `full_graph_snapshot`: components, degree, articulation points/bridges correct on a fixture
  graph with a known island + known bridge.
- Tag layer: islands with a shared tag land in one component after rebuild (fixture).
- `walk`: never emits tags/dupes; respects `recent`; terminates; seedless vs seeded behavior.
- `graph_full` endpoint: 401 without token; correct shape with token.

**Frontend (vitest):** component color map, degree→radius scale, edge-type filter predicate.

**Acceptance (measured in the viz, old vs new):**
- Component count: 66 → **1** (or islands only for tag-less artists, logged).
- Max node degree: 395 → bounded, no low-play-count mega-hub; degree-8 plateau gone.
- Reachability (fraction of track pairs connected) up; giant-component fraction → ~1.0.
- Random-walk visitation frequency correlates with degree (sanity check on emergent popularity).

## 11. Rollout

- Graph is a derived cache: rebuild via existing `build_music_graph` (extended) — no data
  migration risk. Run the Celery `rebuild_listen_graph` task after deploy (rebuild ~minutes;
  must stay off the request path per the sync-timeout constraint).
- Ship viz + rebuilt pipeline together; the viz validates the rebuild on prod before we trust
  shuffle/radio to it. Keep old shuffle/radio reachable behind the same endpoints until the
  viz confirms metrics, then the new `walk` backs them.

## 12. Risks / open questions

- **Tag coverage.** Artists with no Last.fm tags stay island-prone. Mitigation: report them in
  the viz; consider track-title-based fallback tags later. Out of scope now.
- **MP over sparse candidate sets.** Our affinity candidates are already sparse (only computed
  pairs), so per-node CDFs are over that sparse set, not a full distance matrix. This is a
  reasonable empirical MP; the viz verifies de-hubbing actually lands. `MP_THRESHOLD` starts
  permissive and tightens against measured hub degree.
- **Last.fm call volume.** Tag fetch adds ~745 `artist.gettoptags` calls (cached in
  `LastfmCache`, ~4 req/s). One-time cost per artist; acceptable.
- **Walk determinism in tests.** Inject `rng` (as `get_patch` already does).

## 13. Docs

Update `docs/README.md` (new admin graph tool + reworked shuffle/radio) and
`docs/QA-CHECKLIST.md` (graph connectivity, admin viz gating, shuffle/radio via walk).
