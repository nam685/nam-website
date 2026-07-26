import pytest
from django.test import Client
from django.utils import timezone

from website.models import ListenTrack, MusicEdge, MusicNode
from website.services import music_graph


@pytest.fixture()
def built_graph(db):  # noqa: ARG001
    now = timezone.now()
    for i, (vid, title, artist) in enumerate([("v1", "Let Down", "Radiohead"), ("v2", "Karma Police", "Radiohead")]):
        ListenTrack.objects.create(
            video_id=vid,
            title=title,
            artist=artist,
            album="OK Computer",
            thumbnail_url="",
            duration="",
            played_at=now - timezone.timedelta(minutes=i * 5),
        )
    music_graph.rebuild_nodes()
    music_graph.rebuild_structural_edges()
    music_graph.rebuild_affinity_edges(api_key="")
    music_graph.compute_recommend_scores()
    music_graph.compute_node_degrees()


@pytest.mark.django_db
def test_patch_endpoint_returns_seeded_neighborhood(built_graph):  # noqa: ARG001
    resp = Client().get("/api/listens/graph/patch/?seed=v1&type=track")
    assert resp.status_code == 200
    data = resp.json()
    assert data["seed"] == "v1"
    assert any(n["key"] == "v1" for n in data["nodes"])


@pytest.mark.django_db
def test_patch_endpoint_seedless_returns_a_node(built_graph):  # noqa: ARG001
    data = Client().get("/api/listens/graph/patch/").json()
    assert data["seed"] is not None
    assert len(data["nodes"]) >= 1


@pytest.mark.django_db
def test_search_endpoint(built_graph):  # noqa: ARG001
    data = Client().get("/api/listens/graph/search/?q=radio").json()
    assert any(r["title"] == "Radiohead" for r in data["results"])


@pytest.mark.django_db
def test_search_endpoint_empty_query_returns_empty(built_graph):  # noqa: ARG001
    data = Client().get("/api/listens/graph/search/?q=").json()
    assert data["results"] == []


# --- Song-forward shuffle: seedless get_patch should favor tracks + have entropy ---


@pytest.fixture()
def mixed_graph(db):  # noqa: ARG001
    """Many tracks (modest scores) + one artist and one album with huge aggregated scores.

    Mirrors production, where artist/album nodes aggregate all their tracks' plays and thus
    dominate a linear recommend_score weighting.
    """

    for i in range(20):
        MusicNode.objects.create(
            node_type="track", key=f"t{i}", title=f"Track {i}", video_id=f"t{i}", play_count=3, recommend_score=30.0
        )
    MusicNode.objects.create(node_type="artist", key="art", title="Big Artist", play_count=999, recommend_score=9999.0)
    MusicNode.objects.create(node_type="album", key="alb", title="Big Album", play_count=500, recommend_score=5000.0)


def _seed_type(patch):
    """get_patch returns the seed as a key string; look up its node_type in the node list."""
    return next(n["node_type"] for n in patch["nodes"] if n["key"] == patch["seed"])


@pytest.mark.django_db
def test_seedless_is_song_forward(mixed_graph):  # noqa: ARG001
    import random as _random

    from website.services import music_graph

    rng = _random.Random(1234)
    types = []
    for _ in range(200):
        patch = music_graph.get_patch(seed_key=None, seed_type=None, rng=rng)
        types.append(_seed_type(patch))
    track_share = types.count("track") / len(types)
    assert track_share > 0.5, f"expected song-forward, got track share {track_share}"
    assert "track" in types  # songs actually appear (regression: 'never a song')


@pytest.mark.django_db
def test_seedless_has_entropy(mixed_graph):  # noqa: ARG001
    import random as _random

    from website.services import music_graph

    rng = _random.Random(42)
    seeds = {music_graph.get_patch(seed_key=None, seed_type=None, rng=rng)["seed"] for _ in range(100)}
    assert len(seeds) >= 8, f"low entropy: only {len(seeds)} distinct seeds in 100 draws"


@pytest.mark.django_db
def test_seedless_excludes_recent(mixed_graph):  # noqa: ARG001
    import random as _random

    from website.services import music_graph

    rng = _random.Random(7)
    # Exclude the two aggregate nodes; the seed must come from the remaining tracks.
    patch = music_graph.get_patch(seed_key=None, seed_type=None, exclude_keys={"art", "alb"}, rng=rng)
    assert patch["seed"] not in {"art", "alb"}


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


# --- Hub-diversity penalty ---


def test_hub_weight_zero_degree_is_identity():
    from website.services import music_graph

    assert music_graph._hub_weight(0) == 1.0


def test_hub_weight_monotonic_decreasing():
    from website.services import music_graph

    w = [music_graph._hub_weight(d) for d in (0, 1, 5, 50, 500)]
    assert all(a > b for a, b in zip(w, w[1:]))
    assert all(0 < x <= 1.0 for x in w)


# --- degree population ---


@pytest.mark.django_db
def test_compute_node_degrees_counts_incident_edges():
    from website.services import music_graph

    hub = MusicNode.objects.create(node_type="track", key="hub", title="Hub", video_id="hub")
    leaves = [
        MusicNode.objects.create(node_type="track", key=f"l{i}", title=f"L{i}", video_id=f"l{i}") for i in range(3)
    ]
    for leaf in leaves:
        src, tgt = (hub, leaf) if hub.id < leaf.id else (leaf, hub)
        MusicEdge.objects.create(source=src, target=tgt, edge_type="structural", weight=1.0)

    music_graph.compute_node_degrees()
    hub.refresh_from_db()
    leaves[0].refresh_from_db()
    assert hub.degree == 3
    assert leaves[0].degree == 1


# --- graph_full admin endpoint ---


@pytest.mark.django_db
def test_graph_full_requires_admin(built_graph):  # noqa: ARG001
    # No token → 401 (admin-gated diagnostic).
    resp = Client().get("/api/listens/graph/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_graph_full_returns_snapshot(built_graph, auth_headers):  # noqa: ARG001
    from django.core.cache import cache

    cache.delete(music_graph.FULL_GRAPH_CACHE_KEY)
    resp = Client().get("/api/listens/graph/", **auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert {"nodes", "edges", "summary"} <= data.keys()
    assert data["summary"]["node_count"] == len(data["nodes"])
    # Node ids are namespaced "<type>:<key>"; every edge endpoint resolves to a node.
    node_ids = {n["id"] for n in data["nodes"]}
    for e in data["edges"]:
        assert e["source"] in node_ids and e["target"] in node_ids


# --- get_patch neighborhood de-hubbing ---


@pytest.fixture()
def hub_graph(db):  # noqa: ARG001
    """A seed connected to one high-degree hub and many low-degree leaves, all equal edge weight."""

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

    # max_nodes small enough that the neighborhood (1 hub + 60 leaves) must be sub-sampled.
    sets = []
    appeared = 0
    trials = 40
    for i in range(trials):
        patch = music_graph.get_patch(seed_key="s", seed_type="track", max_nodes=10, rng=_random.Random(i))
        keys = frozenset(n["key"] for n in patch["nodes"])
        assert "s" in keys  # seed always present
        sets.append(keys)
        if "hub" in keys:
            appeared += 1
    # New behavior samples the over-cap neighborhood with rng, so the kept node set varies across
    # seeds. Old first-come BFS ignored rng and returned an identical set every call — this is the
    # assertion that actually discriminates the fix.
    assert len(set(sets)) > 1, "neighborhood selection does not vary with rng — de-hub sampling not applied"
    # And the degree-200 hub, at equal edge weight to degree-1 leaves, is demoted well below
    # always-present.
    assert appeared < trials * 0.6, f"hub still saturates patches: {appeared}/{trials}"


@pytest.fixture()
def depth2_graph(db):  # noqa: ARG001
    """Seed -> 3 depth-1 hubs -> 60 depth-2 leaves (each leaf hangs off exactly one hub).

    Over-cap sampling can keep a leaf while dropping its only connector (its hub), which would
    leave the leaf edgeless in the patch.
    """

    seed = MusicNode.objects.create(node_type="track", key="s", title="Seed", video_id="s", recommend_score=10.0)
    hubs = [MusicNode.objects.create(node_type="track", key=f"h{i}", title=f"H{i}", video_id=f"h{i}") for i in range(3)]

    def link(a, b):
        src, tgt = (a, b) if a.id < b.id else (b, a)
        MusicEdge.objects.create(source=src, target=tgt, edge_type="colisten", weight=1.0)

    for h in hubs:
        link(seed, h)
    for i in range(60):
        leaf = MusicNode.objects.create(node_type="track", key=f"l{i}", title=f"L{i}", video_id=f"l{i}")
        link(hubs[i % 3], leaf)
    return seed


@pytest.mark.django_db
def test_get_patch_never_returns_floating_nodes(depth2_graph):  # noqa: ARG001
    import random as _random

    from website.services import music_graph

    for i in range(40):
        patch = music_graph.get_patch(seed_key="s", seed_type="track", max_nodes=10, rng=_random.Random(i))
        edge_keys = set()
        for e in patch["edges"]:
            edge_keys.add(e["source"])
            edge_keys.add(e["target"])
        for n in patch["nodes"]:
            if n["key"] == "s":
                continue  # seed may stand alone if it has no neighbours
            assert n["key"] in edge_keys, f"floating node {n['key']} in patch (seed {i})"


# --- Full graph cache (admin diagnostic snapshot) ---


@pytest.fixture()
def graph_with_tag(db):  # noqa: ARG001
    # The Redis/locmem cache is NOT rolled back by @pytest.mark.django_db, so clear
    # the full-graph key so each test computes against its own fixture data.
    from django.core.cache import cache

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
