# Listens Shuffle + Radio Unify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the `/listens` shuffle and radio sampling behind one damped-weighted-sample kernel and add a graph hub-diversity penalty so shuffle stops showing the same cluster every press.

**Architecture:** One shared pure function `damped_weighted_sample` replaces the two hand-rolled weighted picks in `music_graph.py`. A new `degree` field on `MusicNode` (populated during graph rebuild) feeds a shared `_hub_weight` helper that down-weights super-connected nodes in both `radio_next` scoring and `get_patch` neighborhood assembly.

**Tech Stack:** Python 3.12, Django 6, PostgreSQL, pytest + pytest-django. All backend; no frontend changes.

## Global Constraints

- Work in worktree `.claude/worktrees/listens-shuffle-unify` (branch `feat/listens-shuffle-unify`), never on main.
- Backend commands run from the worktree root with `uv run …`.
- Ruff line-length 120; a PostToolUse hook auto-formats `.py` on save.
- Django app uses split subdirs: models in `website/models/<name>.py`, exported via `models/__init__.py`. Never create flat `website/models.py`.
- Tests: `website/tests/test_<name>.py`, `@pytest.mark.django_db` for DB tests, run with `uv run pytest`.
- `math` and `random` are already imported at the top of `website/services/music_graph.py`.

---

### Task 1: Shared `damped_weighted_sample` kernel

**Files:**
- Modify: `website/services/music_graph.py` (add function near the other seedless-shuffle helpers, after `SEED_TYPE_WEIGHTS` ~line 356)
- Test: `website/tests/test_listen_graph.py` (append)

**Interfaces:**
- Produces: `damped_weighted_sample(items, scores, k=1, *, damping=math.sqrt, rng=random) -> list` — picks up to `k` distinct items by weighted-random over `damping(max(score, 0))`, without replacement. Returns a list of length `min(k, len(items))`. All-zero damped weights → uniform pick.

- [ ] **Step 1: Write the failing tests**

Append to `website/tests/test_listen_graph.py`:

```python
# --- Shared damped_weighted_sample kernel ---


def test_damped_weighted_sample_respects_k_and_no_replacement():
    import random as _random

    from website.services import music_graph

    items = ["a", "b", "c", "d"]
    picked = music_graph.damped_weighted_sample(items, [1, 1, 1, 1], k=3, rng=_random.Random(0))
    assert len(picked) == 3
    assert len(set(picked)) == 3  # no replacement
    assert set(picked) <= set(items)


def test_damped_weighted_sample_k_capped_to_len():
    import random as _random

    from website.services import music_graph

    picked = music_graph.damped_weighted_sample(["a", "b"], [1, 1], k=5, rng=_random.Random(0))
    assert len(picked) == 2


def test_damped_weighted_sample_all_zero_weights_uniform_fallback():
    import random as _random

    from website.services import music_graph

    picked = music_graph.damped_weighted_sample(["a", "b", "c"], [0, 0, 0], k=2, rng=_random.Random(0))
    assert len(picked) == 2
    assert len(set(picked)) == 2


def test_damped_weighted_sample_favors_higher_score():
    import random as _random

    from website.services import music_graph

    rng = _random.Random(123)
    firsts = [music_graph.damped_weighted_sample(["hi", "lo"], [100.0, 1.0], k=1, rng=rng)[0] for _ in range(200)]
    assert firsts.count("hi") > firsts.count("lo")


def test_damped_weighted_sample_empty():
    from website.services import music_graph

    assert music_graph.damped_weighted_sample([], [], k=3) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_listen_graph.py -k damped_weighted_sample -v`
Expected: FAIL with `AttributeError: module 'website.services.music_graph' has no attribute 'damped_weighted_sample'`

- [ ] **Step 3: Write minimal implementation**

In `website/services/music_graph.py`, add after the `SEED_TYPE_WEIGHTS` definition:

```python
def damped_weighted_sample(items, scores, k=1, *, damping=math.sqrt, rng=random):
    """Pick up to k distinct items by weighted-random over damping(max(score, 0)), no replacement.

    Shared sampling kernel for both the seedless shuffle seed pick and radio's next-track pick.
    `items`/`scores` are parallel sequences. An all-zero (or empty-weight) pool falls back to a
    uniform pick so a degenerate score set never raises.
    """
    items = list(items)
    scores = list(scores)
    idxs = list(range(len(items)))
    chosen = []
    for _ in range(min(k, len(items))):
        weights = [damping(max(scores[i], 0.0)) for i in idxs]
        total = sum(weights)
        if total <= 0:
            pos = rng.randrange(len(idxs))
        else:
            pos = rng.choices(range(len(idxs)), weights=weights, k=1)[0]
        chosen.append(items[idxs[pos]])
        idxs.pop(pos)
    return chosen
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_listen_graph.py -k damped_weighted_sample -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add website/services/music_graph.py website/tests/test_listen_graph.py
git commit -m "feat(listens): add shared damped_weighted_sample kernel"
```

---

### Task 2: `_hub_weight` helper

**Files:**
- Modify: `website/services/music_graph.py` (add helper next to `damped_weighted_sample`)
- Test: `website/tests/test_listen_graph.py` (append)

**Interfaces:**
- Produces: `_hub_weight(degree: int) -> float` — `1 / (1 + log1p(max(degree, 0)))`. Degree 0 → 1.0; strictly decreasing in degree; always in (0, 1].

- [ ] **Step 1: Write the failing tests**

Append to `website/tests/test_listen_graph.py`:

```python
# --- Hub-diversity penalty ---


def test_hub_weight_zero_degree_is_identity():
    from website.services import music_graph

    assert music_graph._hub_weight(0) == 1.0


def test_hub_weight_monotonic_decreasing():
    from website.services import music_graph

    w = [music_graph._hub_weight(d) for d in (0, 1, 5, 50, 500)]
    assert all(a > b for a, b in zip(w, w[1:]))
    assert all(0 < x <= 1.0 for x in w)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_listen_graph.py -k hub_weight -v`
Expected: FAIL with `AttributeError: … has no attribute '_hub_weight'`

- [ ] **Step 3: Write minimal implementation**

In `website/services/music_graph.py`, add next to `damped_weighted_sample`:

```python
def _hub_weight(degree: int) -> float:
    """Down-weight high-degree hub nodes so they don't saturate every patch / radio pick.

    Log-damped: hubs still surface sometimes (they *are* the most-played music), just not in
    the majority of patches. Degree 0 -> 1.0 (no penalty), degree 100 -> ~0.18.
    """
    return 1.0 / (1.0 + math.log1p(max(degree, 0)))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_listen_graph.py -k hub_weight -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add website/services/music_graph.py website/tests/test_listen_graph.py
git commit -m "feat(listens): add _hub_weight degree penalty helper"
```

---

### Task 3: `degree` field on MusicNode + `compute_node_degrees` in rebuild

**Files:**
- Modify: `website/models/music_node.py` (add field)
- Create: `website/migrations/XXXX_musicnode_degree.py` (via makemigrations)
- Modify: `website/services/music_graph.py` (add `compute_node_degrees`; call it in `build_graph` after edges built)
- Test: `website/tests/test_listen_graph.py` (append)

**Interfaces:**
- Consumes: `MusicEdge` (`source_id`, `target_id`), `MusicNode`.
- Produces: `MusicNode.degree` (PositiveIntegerField, default 0); `compute_node_degrees() -> None` sets each node's degree to its incident-edge count (both directions).

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_listen_graph.py`:

```python
# --- degree population ---


@pytest.mark.django_db
def test_compute_node_degrees_counts_incident_edges():
    from website.models import MusicEdge, MusicNode
    from website.services import music_graph

    hub = MusicNode.objects.create(node_type="track", key="hub", title="Hub", video_id="hub")
    leaves = [MusicNode.objects.create(node_type="track", key=f"l{i}", title=f"L{i}", video_id=f"l{i}") for i in range(3)]
    for leaf in leaves:
        src, tgt = (hub, leaf) if hub.id < leaf.id else (leaf, hub)
        MusicEdge.objects.create(source=src, target=tgt, edge_type="structural", weight=1.0)

    music_graph.compute_node_degrees()
    hub.refresh_from_db()
    leaves[0].refresh_from_db()
    assert hub.degree == 3
    assert leaves[0].degree == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_listen_graph.py -k compute_node_degrees -v`
Expected: FAIL — `AttributeError: … 'compute_node_degrees'` (and/or `FieldError` for `degree`).

- [ ] **Step 3: Add the model field**

In `website/models/music_node.py`, add after `recommend_score`:

```python
    recommend_score = models.FloatField(default=0.0)
    degree = models.PositiveIntegerField(default=0)  # incident-edge count; set during graph rebuild
```

- [ ] **Step 4: Generate the migration**

Run: `uv run python manage.py makemigrations website`
Expected: creates `website/migrations/XXXX_musicnode_degree.py` adding field `degree`.

- [ ] **Step 5: Write `compute_node_degrees` and wire into build_graph**

In `website/services/music_graph.py`, add near `compute_recommend_scores`:

```python
def compute_node_degrees():
    """Set each node.degree to its incident-edge count (both directions). Run after edges built."""
    from collections import Counter

    deg = Counter()
    for src_id, tgt_id in MusicEdge.objects.values_list("source_id", "target_id").iterator():
        deg[src_id] += 1
        deg[tgt_id] += 1
    to_update = []
    for node in MusicNode.objects.all().iterator():
        d = deg.get(node.id, 0)
        if node.degree != d:
            node.degree = d
            to_update.append(node)
    MusicNode.objects.bulk_update(to_update, ["degree"], batch_size=500)
```

(`MusicNode` and `MusicEdge` are already imported at the top of `music_graph.py`; `Counter` is not, hence the local import.)

In `build_graph`, add the degree pass right after `compute_recommend_scores()`:

```python
    _report(progress, "Computing recommendation scores…")
    compute_recommend_scores()
    _report(progress, "Computing node degrees…")
    compute_node_degrees()
    _report(progress, f"Done: {MusicNode.objects.count()} nodes, {MusicEdge.objects.count()} edges")
```

- [ ] **Step 6: Run test to verify it passes**

Run: `uv run pytest website/tests/test_listen_graph.py -k compute_node_degrees -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add website/models/music_node.py website/migrations/ website/services/music_graph.py website/tests/test_listen_graph.py
git commit -m "feat(listens): store node degree, populate on graph rebuild"
```

---

### Task 4: radio_next → shared kernel + hub penalty

**Files:**
- Modify: `website/services/music_graph.py` (`radio_next`, the pool→pick tail ~lines 555-567)
- Test: `website/tests/test_listen_graph.py` (append)

**Interfaces:**
- Consumes: `damped_weighted_sample`, `_hub_weight`, `MusicNode.degree`.
- Produces: `radio_next` unchanged signature, now damped-`sqrt` weighted with hub penalty.

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_listen_graph.py`:

```python
# --- radio_next de-hubbing ---


@pytest.mark.django_db
def test_radio_next_prefers_low_degree_over_hub_at_equal_affinity():
    import random as _random

    from website.models import MusicEdge, MusicNode
    from website.services import music_graph

    seed = MusicNode.objects.create(node_type="track", key="seed", title="Seed", video_id="seed")
    # Two candidates with an equal-weight similar_track edge to the seed:
    hub = MusicNode.objects.create(node_type="track", key="hub", title="Hub", video_id="hub", degree=40)
    quiet = MusicNode.objects.create(node_type="track", key="quiet", title="Quiet", video_id="quiet", degree=1)
    for cand in (hub, quiet):
        src, tgt = (seed, cand) if seed.id < cand.id else (cand, seed)
        MusicEdge.objects.create(source=src, target=tgt, edge_type="similar_track", weight=1.0)

    import website.services.music_graph as mg

    orig = mg.random
    mg.random = _random.Random(99)  # deterministic pick stream
    try:
        picks = []
        for _ in range(200):
            got = mg.radio_next("seed", limit=1)
            picks += [t["video_id"] for t in got]
    finally:
        mg.random = orig
    assert picks.count("quiet") > picks.count("hub"), f"hub not de-weighted: {picks.count('hub')} vs {picks.count('quiet')}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_listen_graph.py -k radio_next_prefers -v`
Expected: FAIL — counts roughly equal (no hub penalty yet), assertion fails.

- [ ] **Step 3: Replace the pool→pick tail of `radio_next`**

In `website/services/music_graph.py`, replace the current tail:

```python
    candidates.sort(key=lambda c: c[1], reverse=True)
    pool = candidates[:RADIO_CANDIDATE_POOL]

    chosen: list[MusicNode] = []
    available = list(pool)
    for _ in range(min(limit, len(pool))):
        nodes = [c[0] for c in available]
        weights = [c[1] for c in available]
        pick = random.choices(nodes, weights=weights, k=1)[0]
        chosen.append(pick)
        available = [c for c in available if c[0].id != pick.id]

    return [_node_to_track(n) for n in chosen]
```

with:

```python
    candidates.sort(key=lambda c: c[1], reverse=True)
    pool = candidates[:RADIO_CANDIDATE_POOL]
    nodes = [c[0] for c in pool]
    # Damped (sqrt) weighting via the shared kernel, with the hub penalty applied to each score so
    # super-connected tracks stop being served as "next" every time.
    eff_scores = [c[1] * _hub_weight(c[0].degree) for c in pool]
    chosen = damped_weighted_sample(nodes, eff_scores, k=limit, rng=random)
    return [_node_to_track(n) for n in chosen]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_listen_graph.py -k "radio_next_prefers" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add website/services/music_graph.py website/tests/test_listen_graph.py
git commit -m "feat(listens): radio_next uses shared kernel + hub penalty"
```

---

### Task 5: get_patch → shared kernel seed pick + de-hubbed neighborhood

**Files:**
- Modify: `website/services/music_graph.py` (`_pick_recommended_seed` ~lines 358-380; `get_patch` BFS ~lines 396-412)
- Test: `website/tests/test_listen_graph.py` (append)

**Interfaces:**
- Consumes: `damped_weighted_sample`, `_hub_weight`, `MusicNode.degree`.
- Produces: `_pick_recommended_seed` and `get_patch` unchanged signatures. Seedless neighborhood assembly de-hubs when it exceeds `max_nodes`.

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_listen_graph.py`:

```python
# --- get_patch neighborhood de-hubbing ---


@pytest.fixture()
def hub_graph(db):  # noqa: ARG001
    """A seed connected to one high-degree hub and many low-degree leaves, all equal edge weight."""
    from website.models import MusicEdge, MusicNode

    seed = MusicNode.objects.create(node_type="track", key="s", title="Seed", video_id="s", recommend_score=10.0)
    hub = MusicNode.objects.create(node_type="track", key="hub", title="Hub", video_id="hub", degree=200)
    leaves = [
        MusicNode.objects.create(node_type="track", key=f"n{i}", title=f"N{i}", video_id=f"n{i}", degree=1)
        for i in range(60)
    ]

    def link(a, b):
        src, tgt = (a, b) if a.id < b.id else (b, a)
        MusicEdge.objects.create(source=src, target=tgt, edge_type="colisten", weight=1.0)

    for node in [hub, *leaves]:
        link(seed, node)
    return seed


@pytest.mark.django_db
def test_get_patch_dehubs_oversized_neighborhood(hub_graph):  # noqa: ARG001
    import random as _random

    from website.services import music_graph

    # max_nodes small enough that the neighborhood must be sub-sampled.
    appeared = 0
    trials = 60
    for i in range(trials):
        patch = music_graph.get_patch(seed_key="s", seed_type="track", max_nodes=10, rng=_random.Random(i))
        keys = {n["key"] for n in patch["nodes"]}
        assert "s" in keys  # seed always present
        if "hub" in keys:
            appeared += 1
    # With a degree-200 hub vs degree-1 leaves at equal weight, the hub should be down-weighted well
    # below always-present.
    assert appeared < trials * 0.6, f"hub still saturates patches: {appeared}/{trials}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_listen_graph.py -k dehubs -v`
Expected: FAIL — with first-come BFS the hub appears in ~all patches (`appeared` ≈ 60).

- [ ] **Step 3: Route `_pick_recommended_seed` through the kernel**

In `_pick_recommended_seed`, replace:

```python
        if pool:
            weights = [math.sqrt(n.recommend_score or 1.0) for n in pool]
            return rng.choices(pool, weights=weights, k=1)[0]
```

with:

```python
        if pool:
            scores = [n.recommend_score or 1.0 for n in pool]
            return damped_weighted_sample(pool, scores, k=1, rng=rng)[0]
```

(Behavior preserved — still `sqrt`, still k=1. No hub penalty on seed selection: seed entropy is already high; the fix targets the neighborhood.)

- [ ] **Step 4: Replace the `get_patch` BFS collection with scored, de-hubbed selection**

In `get_patch`, replace the BFS block:

```python
    # BFS to depth 2 collecting node ids.
    frontier = {seed_node.id}
    collected = {seed_node.id}
    for _ in range(2):
        edges = _neighbors(frontier)
        next_frontier = set()
        for e in edges:
            for nid in (e.source_id, e.target_id):
                if nid not in collected and len(collected) < max_nodes:
                    collected.add(nid)
                    next_frontier.add(nid)
        frontier = next_frontier
        if not frontier:
            break
```

with:

```python
    # BFS to depth 2, accumulating a reach score per neighbor (edge weight decayed by hop depth).
    neighbor_score: dict[int, float] = {}
    frontier = {seed_node.id}
    seen = {seed_node.id}
    for depth in range(2):
        edges = _neighbors(frontier)
        next_frontier: set[int] = set()
        for e in edges:
            for a, b in ((e.source_id, e.target_id), (e.target_id, e.source_id)):
                if a in frontier and b != seed_node.id:
                    neighbor_score[b] = neighbor_score.get(b, 0.0) + e.weight / (depth + 1)
                    if b not in seen:
                        seen.add(b)
                        next_frontier.add(b)
        frontier = next_frontier
        if not frontier:
            break

    # Fill the patch (seed always included). When the neighborhood exceeds the cap, choose which
    # nodes to keep by damped-weighted sampling over reach-score x hub penalty, so a few super-hubs
    # no longer dominate every patch. Under the cap, keep everything (behavior unchanged).
    neighbor_ids = list(neighbor_score)
    room = max_nodes - 1
    if len(neighbor_ids) > room:
        degrees = dict(MusicNode.objects.filter(id__in=neighbor_ids).values_list("id", "degree"))
        eff = [neighbor_score[i] * _hub_weight(degrees.get(i, 0)) for i in neighbor_ids]
        kept = damped_weighted_sample(neighbor_ids, eff, k=room, rng=rng)
        collected = {seed_node.id, *kept}
    else:
        collected = {seed_node.id, *neighbor_ids}
```

- [ ] **Step 5: Run the de-hub test + the #277 regression tests**

Run: `uv run pytest website/tests/test_listen_graph.py -k "dehubs or seedless" -v`
Expected: PASS — de-hub test passes; `test_seedless_is_song_forward`, `test_seedless_has_entropy`, `test_seedless_excludes_recent` still pass.

- [ ] **Step 6: Full graph + listen suite regression**

Run: `uv run pytest website/tests/test_listen_graph.py website/tests/test_listen.py -v`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add website/services/music_graph.py website/tests/test_listen_graph.py
git commit -m "feat(listens): shared kernel seed pick + de-hubbed patch neighborhood"
```

---

### Task 6: Docs + full-suite verification

**Files:**
- Modify: `docs/README.md` (listens/shuffle description if it mentions the shuffle behavior)
- Modify: `docs/QA-CHECKLIST.md` (add a shuffle-variety check)

- [ ] **Step 1: Update docs**

In `docs/QA-CHECKLIST.md`, add under the listens section:

```markdown
- [ ] `/listens` shuffle button: pressing it repeatedly surfaces visibly different clusters (not the same few hub tracks every time).
```

If `docs/README.md` describes the listens graph/shuffle, add one sentence noting shuffle favors variety via a hub-diversity penalty. (Skip if README has no shuffle-specific copy.)

- [ ] **Step 2: Full backend suite + lint**

Run: `uv run pytest && uvx ruff check .`
Expected: all pass (≥ the pre-change count + new tests), ruff clean.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs(listens): note shuffle hub-diversity in QA checklist"
```

---

### Task 7: Real-data verification against prod (manual, no code)

**Goal:** Confirm the fix actually moves the numbers on real data before merging.

- [ ] **Step 1: Populate degrees on prod (no full rebuild needed)**

The `degree` field is 0 on existing prod rows until a rebuild. Deploy is not required for a read
check — copy the branch's `music_graph.py` to a scratch path is not viable (imports); instead run
the degree pass against prod once the migration is applied there, OR run the sampling with degrees
computed in-process. Simplest: after the branch is deployed (migration applied), run on prod:

```bash
ssh hetzner 'cd ~/nam-website-deploy && ~/.local/bin/uv run python manage.py shell -c "from website.services import music_graph; music_graph.compute_node_degrees(); print(\"degrees set\")"'
```

- [ ] **Step 2: Re-run the three saved sampling scripts against prod**

Scripts live in the session scratchpad (`shuffle_sample.py`, `patch_sample.py`, `radio_sample.py`).
Copy each to prod and run via `manage.py shell`, e.g.:

```bash
scp <scratchpad>/patch_sample.py hetzner:/tmp/patch_sample.py
ssh hetzner 'cd ~/nam-website-deploy && ~/.local/bin/uv run python manage.py shell < /tmp/patch_sample.py'
```

- [ ] **Step 3: Check acceptance targets**

Compare against the pre-fix baseline (hub in ~80% of patches, top-20 hubs = 33% of appearances):
- No single node appears in > 40% of patches.
- Top-20 hubs account for < 25% of node appearances.
- Radio distinct-tracks-per-session / library reach increases.
- Seed entropy stays ≥ 6.9 bits (unchanged — we didn't touch seed selection).

If targets are missed, tune `_hub_weight` (steeper, e.g. `1/(1+degree**0.7)`) and re-run. If overshoot
(favorites buried), make it gentler. Record the final numbers in the PR description.

---

## Self-Review

**Spec coverage:**
- Shared kernel → Task 1 (kernel) + Tasks 4, 5 (both callers route through it). ✓
- Radio linear→sqrt upgrade → Task 4 (kernel default `sqrt`). ✓
- Hub penalty helper + degree field/population → Tasks 2, 3. ✓
- Hub penalty in radio scoring → Task 4. ✓
- Hub penalty in patch neighborhood assembly → Task 5. ✓
- Anti-repeat stays caller-side → unchanged (redis ring in view, exclude list in `radio_next`); no task needed. ✓
- Unit tests (kernel, hub_weight, synthetic hub graph, #277 regression) → Tasks 1–5. ✓
- Real-data verification with acceptance targets → Task 7. ✓
- Tuning knobs → Task 7 step 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Task 6 README edit is conditional but explicit about the condition. ✓

**Type consistency:** `damped_weighted_sample(items, scores, k, *, damping, rng)` used identically in Tasks 1, 4, 5. `_hub_weight(degree)` used in Tasks 2, 4, 5. `compute_node_degrees()` defined Task 3, invoked in `build_graph` (Task 3) and prod verification (Task 7). `MusicNode.degree` defined Task 3, read in Tasks 4, 5. ✓
