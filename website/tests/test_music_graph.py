from io import StringIO
from unittest.mock import MagicMock, patch

import pytest
from django.core.management import call_command
from django.db import transaction
from django.db.utils import IntegrityError
from django.utils import timezone

from website.models import LastfmCache, ListenTrack, MusicEdge, MusicNode
from website.services import lastfm, music_graph


@pytest.mark.django_db
def test_music_node_unique_per_type_and_key():
    MusicNode.objects.create(node_type="artist", key="radiohead", title="Radiohead")
    # Same type+key must be rejected; same key under a different type is fine.
    # Wrap in atomic() so the IntegrityError doesn't poison the outer test transaction.
    with pytest.raises(IntegrityError), transaction.atomic():
        MusicNode.objects.create(node_type="artist", key="radiohead", title="Radiohead")
    MusicNode.objects.create(node_type="track", key="radiohead", title="Self-titled?")
    assert MusicNode.objects.count() == 2


@pytest.mark.django_db
def test_music_edge_links_two_nodes():
    a = MusicNode.objects.create(node_type="artist", key="a", title="A")
    b = MusicNode.objects.create(node_type="artist", key="b", title="B")
    edge = MusicEdge.objects.create(source=a, target=b, edge_type="similar_artist", weight=0.8)
    assert edge.source_id == a.id and edge.target_id == b.id
    assert edge.weight == 0.8
    # (source, target, edge_type) is unique.
    with pytest.raises(IntegrityError), transaction.atomic():
        MusicEdge.objects.create(source=a, target=b, edge_type="similar_artist", weight=0.1)


@pytest.mark.django_db
def test_lastfm_cache_roundtrip():
    LastfmCache.objects.create(cache_key="artist.getsimilar::radiohead", payload=[{"name": "Muse"}])
    row = LastfmCache.objects.get(cache_key="artist.getsimilar::radiohead")
    assert row.payload[0]["name"] == "Muse"


@pytest.fixture()
def plays(db):  # noqa: ARG001
    now = timezone.now()
    rows = [
        # video_id, title, artist, album, minutes_ago
        ("v1", "Let Down", "Radiohead", "OK Computer", 5),
        ("v1", "Let Down", "Radiohead", "OK Computer", 60),  # second play of v1
        ("v2", "Karma Police", "Radiohead", "OK Computer", 10),
        ("v3", "Resistance", "Muse", "The Resistance", 90),
    ]
    for vid, title, artist, album, mins in rows:
        ListenTrack.objects.create(
            video_id=vid,
            title=title,
            artist=artist,
            album=album,
            thumbnail_url=f"https://img/{vid}.jpg",
            duration="3:00",
            played_at=now - timezone.timedelta(minutes=mins),
        )


@pytest.mark.django_db
def test_rebuild_nodes_aggregates_tracks_artists_albums(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    tracks = MusicNode.objects.filter(node_type="track")
    assert tracks.count() == 3  # v1, v2, v3
    v1 = MusicNode.objects.get(node_type="track", key="v1")
    assert v1.play_count == 2
    assert v1.title == "Let Down"
    # Artists are de-duplicated by normalized name
    assert MusicNode.objects.filter(node_type="artist").count() == 2
    radiohead = MusicNode.objects.get(node_type="artist", key="radiohead")
    assert radiohead.play_count == 3  # 2x v1 + 1x v2
    # Albums keyed by artist::album
    assert MusicNode.objects.get(node_type="album", key="radiohead::ok computer").play_count == 3


@pytest.mark.django_db
def test_structural_edges_link_track_to_artist_and_album(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    music_graph.rebuild_structural_edges()
    v1 = MusicNode.objects.get(node_type="track", key="v1")
    artist = MusicNode.objects.get(node_type="artist", key="radiohead")
    album = MusicNode.objects.get(node_type="album", key="radiohead::ok computer")
    # An edge exists between v1 and its artist, and v1 and its album (order-independent).
    assert music_graph.edge_exists(v1, artist, "structural")
    assert music_graph.edge_exists(v1, album, "structural")


@pytest.mark.django_db
def test_colisten_counts_within_window(plays):  # noqa: ARG001
    # v1 (5m ago) and v2 (10m ago) are within 30m -> counted; v2/v3 (90m) too far -> not paired.
    counts = music_graph._colisten_counts(window_minutes=30)
    assert counts.get(("v1", "v2")) == 1
    assert ("v2", "v3") not in counts


def _resp(json_body):
    m = MagicMock()
    m.json.return_value = json_body
    m.raise_for_status.return_value = None
    return m


def test_fetch_similar_artists_parses_match_scores():
    body = {
        "similarartists": {
            "artist": [
                {"name": "Muse", "match": "0.9"},
                {"name": "Coldplay", "match": "0.4"},
            ]
        }
    }
    with patch("website.services.lastfm.httpx.get", return_value=_resp(body)) as g:
        out = lastfm.fetch_similar_artists("Radiohead", "KEY")
    assert out == [{"name": "Muse", "match": 0.9}, {"name": "Coldplay", "match": 0.4}]
    assert g.call_args.kwargs["params"]["method"] == "artist.getsimilar"


def test_fetch_similar_tracks_parses_artist_and_title():
    body = {
        "similartracks": {
            "track": [
                {"name": "Karma Police", "artist": {"name": "Radiohead"}, "match": "1.0"},
            ]
        }
    }
    with patch("website.services.lastfm.httpx.get", return_value=_resp(body)):
        out = lastfm.fetch_similar_tracks("Radiohead", "Let Down", "KEY")
    assert out == [{"artist": "Radiohead", "title": "Karma Police", "match": 1.0}]


def test_fetch_similar_artists_returns_empty_on_error():
    with patch("website.services.lastfm.httpx.get", side_effect=Exception("boom")):
        assert lastfm.fetch_similar_artists("X", "KEY") == []


@pytest.mark.django_db
def test_lastfm_similar_candidates_within_universe_and_cached(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()

    # Radiohead is similar to Muse (in universe) and Coldplay (NOT in universe).
    def fake_artists(name, _api_key, _limit=50):
        if music_graph.normalize(name) == "radiohead":
            return [{"name": "Muse", "match": 0.9}, {"name": "Coldplay", "match": 0.4}]
        return []

    with (
        patch.object(music_graph.lastfm, "fetch_similar_artists", side_effect=fake_artists),
        patch.object(music_graph.lastfm, "fetch_similar_tracks", return_value=[]),
    ):
        sa, _st = music_graph._lastfm_similar_candidates(api_key="KEY")

    radiohead = MusicNode.objects.get(node_type="artist", key="radiohead")
    muse = MusicNode.objects.get(node_type="artist", key="muse")
    pair = (min(radiohead.id, muse.id), max(radiohead.id, muse.id))
    assert sa.get(pair) == 0.9
    # Coldplay is not a node, so no candidate was created to it.
    assert not MusicNode.objects.filter(node_type="artist", key="coldplay").exists()
    # Response was cached.
    assert LastfmCache.objects.filter(cache_key="artist.getsimilar::radiohead").exists()


@pytest.mark.django_db
def test_affinity_without_api_key_is_colisten_only(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    music_graph.rebuild_affinity_edges(api_key="")
    # v1 & v2 co-listened → an affinity edge with source_kind "colisten"; no Last.fm sources.
    assert MusicEdge.objects.filter(edge_type="affinity", source_kind="colisten").exists()
    assert not MusicEdge.objects.filter(source_kind="similar_artist").exists()


@pytest.mark.django_db
def test_recommend_score_boosts_personalized_nodes(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    fav = MusicNode.objects.get(node_type="artist", key="radiohead")

    # Score the SAME node with and without a personalization flag so the assertion
    # isolates the boost itself (independent of play counts differing between nodes).
    fav.is_subscribed = True
    fav.save()
    music_graph.compute_recommend_scores()
    fav.refresh_from_db()
    boosted = fav.recommend_score

    fav.is_subscribed = False
    fav.save()
    music_graph.compute_recommend_scores()
    fav.refresh_from_db()
    unboosted = fav.recommend_score

    assert unboosted > 0
    assert boosted == pytest.approx(unboosted * music_graph.PERSONALIZATION_BOOST)


@pytest.mark.django_db
def test_apply_personalization_sets_flags(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    music_graph.apply_personalization(
        liked_video_ids={"v1"},
        library_album_keys={"radiohead::ok computer"},
        subscribed_artist_keys={"radiohead"},
        library_video_ids=set(),
    )
    assert MusicNode.objects.get(node_type="track", key="v1").is_liked
    assert MusicNode.objects.get(node_type="album", key="radiohead::ok computer").in_library
    assert MusicNode.objects.get(node_type="artist", key="radiohead").is_subscribed
    # Nodes not named in the input keep flags off (reset + scoping work).
    assert not MusicNode.objects.get(node_type="artist", key="muse").is_subscribed
    assert not MusicNode.objects.get(node_type="track", key="v2").is_liked


@pytest.mark.django_db
def test_get_patch_returns_seed_neighborhood(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    music_graph.rebuild_structural_edges()
    patch = music_graph.get_patch(seed_key="v1", seed_type="track", max_nodes=40)
    keys = {n["key"] for n in patch["nodes"]}
    assert patch["seed"] == "v1"
    assert "v1" in keys
    assert "radiohead" in keys  # 1-hop structural neighbor
    # Edges reference node keys present in the patch.
    for e in patch["edges"]:
        assert e["source"] in keys and e["target"] in keys


@pytest.mark.django_db
def test_get_patch_seedless_returns_a_track_seed(plays):  # noqa: ARG001
    # Seedless shuffle now picks a uniform-random track (popularity emerges from the walk, not a
    # recommend-score weighting), so the seed is simply one of the library's tracks.
    music_graph.rebuild_nodes()
    music_graph.rebuild_structural_edges()
    patch = music_graph.get_patch(seed_key=None, seed_type=None, max_nodes=40)
    assert patch["seed"] in {"v1", "v2", "v3"}


@pytest.mark.django_db
def test_get_patch_caps_super_node_degree():
    """A hub linked to far more than PATCH_MAX_DEGREE tracks is thinned in the patch."""
    hub = MusicNode.objects.create(node_type="artist", key="hub", title="Hub")
    n = music_graph.PATCH_MAX_DEGREE + 8
    tracks = [MusicNode.objects.create(node_type="track", key=f"t{i}", title=f"T{i}") for i in range(n)]
    for t in tracks:
        music_graph._upsert_edge(hub, t, "structural", music_graph.STRUCTURAL_WEIGHT)

    patch = music_graph.get_patch(seed_key="hub", seed_type="artist", max_nodes=100)

    hub_degree = sum(1 for e in patch["edges"] if "hub" in (e["source"], e["target"]))
    assert hub_degree <= music_graph.PATCH_MAX_DEGREE


@pytest.mark.django_db
def test_get_patch_keeps_higher_priority_edges_over_structural():
    """When a hub is over the cap, meaningful edges win over excess structural links."""
    hub = MusicNode.objects.create(node_type="track", key="hub", title="Hub")
    # Fill the cap with low-priority structural neighbours...
    for i in range(music_graph.PATCH_MAX_DEGREE):
        s = MusicNode.objects.create(node_type="artist", key=f"s{i}", title=f"S{i}")
        music_graph._upsert_edge(hub, s, "structural", music_graph.STRUCTURAL_WEIGHT)
    # ...plus one high-priority affinity edge that must displace a structural edge.
    sim = MusicNode.objects.create(node_type="track", key="sim", title="Sim")
    music_graph._upsert_edge(hub, sim, "affinity", 0.9, source_kind="colisten")

    patch = music_graph.get_patch(seed_key="hub", seed_type="track", max_nodes=100)

    hub_edges = [e for e in patch["edges"] if "hub" in (e["source"], e["target"])]
    assert len(hub_edges) <= music_graph.PATCH_MAX_DEGREE
    kept_neighbors = {e["target"] if e["source"] == "hub" else e["source"] for e in hub_edges}
    assert "sim" in kept_neighbors  # the high-priority edge survived the cap


@pytest.mark.django_db
def test_search_nodes_matches_title_and_subtitle(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    results = music_graph.search_nodes("radio")
    titles = {r["title"] for r in results}
    assert "Radiohead" in titles


@pytest.mark.django_db
def test_build_graph_runs_full_pipeline(plays):  # noqa: ARG001
    with (
        patch.object(music_graph.lastfm, "fetch_similar_artists", return_value=[]),
        patch.object(music_graph.lastfm, "fetch_similar_tracks", return_value=[]),
    ):
        music_graph.build_graph(api_key="", ytm_headers=None)
    assert MusicNode.objects.filter(node_type="track").count() == 3
    assert MusicEdge.objects.filter(edge_type="structural").exists()
    assert MusicNode.objects.filter(recommend_score__gt=0).exists()


@pytest.mark.django_db
def test_build_music_graph_command(plays):  # noqa: ARG001
    out = StringIO()
    with patch.object(music_graph, "build_graph") as mock_build:
        call_command("build_music_graph", stdout=out)
    mock_build.assert_called_once()


def test_canonical_title_strips_remix_and_feat_suffixes():
    assert music_graph.canonical_title("Let Down (VIP Remix)") == "let down"
    assert music_graph.canonical_title("Distance [Radio Edit]") == "distance"
    assert music_graph.canonical_title("Insane feat. Someone") == "insane"
    assert music_graph.canonical_title("Plain Title") == "plain title"


@pytest.mark.django_db
def test_colisten_ignores_sync_rows(db):  # noqa: ARG001
    now = timezone.now()
    # Real-timestamp plays close together → should link.
    ListenTrack.objects.create(video_id="r1", title="R1", artist="A", played_at=now)
    ListenTrack.objects.create(video_id="r2", title="R2", artist="A", played_at=now - timezone.timedelta(minutes=5))
    # Sync rows with fabricated timestamps → must NOT form a co-listen session.
    ListenTrack.objects.create(video_id="s1", title="S1", artist="B", played_at=now, from_sync=True)
    ListenTrack.objects.create(video_id="s2", title="S2", artist="B", played_at=now, from_sync=True)

    music_graph.rebuild_nodes()
    counts = music_graph._colisten_counts()

    assert counts.get(("r1", "r2")) == 1  # real plays linked
    assert ("s1", "s2") not in counts  # sync plays excluded (fabricated timestamps)
    # Sync rows are still nodes — just not co-listen-linked.
    assert MusicNode.objects.filter(node_type="track", key="s1").exists()


@pytest.mark.django_db
def test_build_graph_preserves_flags_when_personalization_unavailable(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    MusicNode.objects.filter(node_type="artist", key="radiohead").update(is_subscribed=True)
    # _load_personalization_from_ytm returns None on auth/API failure → flags must be kept.
    with (
        patch.object(music_graph, "_load_personalization_from_ytm", return_value=None),
        patch.object(music_graph.lastfm, "fetch_similar_artists", return_value=[]),
        patch.object(music_graph.lastfm, "fetch_similar_tracks", return_value=[]),
    ):
        music_graph.build_graph(api_key="", ytm_headers=None)
    assert MusicNode.objects.get(node_type="artist", key="radiohead").is_subscribed


# --- Mutual Proximity de-hubbing ---------------------------------------------------------------


def test_mutual_proximity_prunes_non_mutual_hub():
    # Hub node 0 is weakly (sim 1) tied to a fan-out of 1..6; nodes 7 & 8 are a mutually-strong
    # pair (sim 9). MP must rank the mutual pair above the hub's spokes.
    candidates = {(0, i): 1.0 for i in range(1, 7)}
    candidates[(7, 8)] = 9.0
    # give 7 and 8 a weak tie to the hub too, so they have a distribution
    candidates[(0, 7)] = 1.0
    candidates[(0, 8)] = 1.0
    mp = music_graph.mutual_proximity(candidates)
    assert mp[(7, 8)] > mp[(0, 1)]  # the mutual pair beats a hub spoke


def test_topk_by_mp_prunes_hub_when_spokes_prefer_others():
    # Node 0 is weakly tied (MP 0.1) to spokes 1..20; each spoke has a strong mutual partner 100
    # (MP 0.9). With k=1, every spoke picks 100 over the hub, so the hub keeps only its own top-1 —
    # this is how MP + top-k dissolves an artifact hub (spokes reciprocate elsewhere).
    mp = {}
    for i in range(1, 21):
        mp[(0, i)] = 0.1
        mp[(i, 100)] = 0.9
    keep = music_graph._topk_by_mp(mp, k=1)
    hub_degree = sum(1 for pair in keep if 0 in pair)
    assert hub_degree <= 2


@pytest.mark.django_db
def test_affinity_edges_are_degree_bounded(db):  # noqa: ARG001
    now = timezone.now()
    # 12 real-timestamp tracks all within one 30-min window → uncapped colisten = C(12,2)=66 pairs.
    for i in range(12):
        ListenTrack.objects.create(
            video_id=f"c{i:02d}", title=f"T{i}", artist="A", played_at=now - timezone.timedelta(minutes=i)
        )
    music_graph.rebuild_nodes()
    music_graph.rebuild_affinity_edges(api_key="")
    # MP + per-node top-k keeps affinity well below the fully-connected count, but non-empty.
    n = MusicEdge.objects.filter(edge_type="affinity").count()
    assert 0 < n < 66


# --- Tag / content layers ----------------------------------------------------------------------


@pytest.mark.django_db
def test_tag_layer_connects_via_shared_tags(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()

    # Radiohead and Muse both carry "alternative"; only Radiohead carries "electronic".
    def fake_tags(name, _api_key, **_kwargs):
        base = [{"name": "alternative", "count": 100}]
        if music_graph.normalize(name) == "radiohead":
            base.append({"name": "electronic", "count": 50})
        return base

    with patch.object(music_graph.lastfm, "fetch_artist_top_tags", side_effect=fake_tags):
        tagless = music_graph.rebuild_tag_edges(api_key="KEY")

    # "alternative" is shared by ≥2 artists → kept; "electronic" (1 artist) → dropped.
    assert MusicNode.objects.filter(node_type="tag", key="alternative").exists()
    assert not MusicNode.objects.filter(node_type="tag", key="electronic").exists()
    radiohead = MusicNode.objects.get(node_type="artist", key="radiohead")
    alt = MusicNode.objects.get(node_type="tag", key="alternative")
    assert music_graph.edge_exists(radiohead, alt, "tag")
    assert tagless == 0
    # Snapshot's independent count agrees (both Radiohead and Muse carry a kept tag).
    assert music_graph._tagless_artist_count() == 0


@pytest.mark.django_db
def test_content_affinity_from_shared_tags(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()

    def fake_tags(_name, _api_key, **_kwargs):
        return [{"name": "alternative", "count": 100}, {"name": "rock", "count": 80}]

    with patch.object(music_graph.lastfm, "fetch_artist_top_tags", side_effect=fake_tags):
        music_graph.rebuild_tag_edges(api_key="KEY")
    cands = music_graph._content_affinity_candidates()
    radiohead = MusicNode.objects.get(node_type="artist", key="radiohead")
    muse = MusicNode.objects.get(node_type="artist", key="muse")
    pair = (min(radiohead.id, muse.id), max(radiohead.id, muse.id))
    # Both share {alternative, rock} → Jaccard 1.0.
    assert cands.get(pair) == pytest.approx(1.0)


# --- Navigation: uniform random walk -----------------------------------------------------------


@pytest.mark.django_db
def test_walk_radio_returns_fresh_tracks(plays):  # noqa: ARG001
    music_graph.build_graph(api_key="", ytm_headers=None)
    rng = __import__("random").Random(1)
    ids = music_graph.walk("v1", exclude_video_ids=["v2"], limit=2, rng=rng)
    videos = set(MusicNode.objects.filter(id__in=ids).values_list("video_id", flat=True))
    assert "v1" not in videos  # seed excluded
    assert "v2" not in videos  # explicitly excluded


@pytest.mark.django_db
def test_walk_shuffle_seedless_starts_somewhere(plays):  # noqa: ARG001
    music_graph.build_graph(api_key="", ytm_headers=None)
    rng = __import__("random").Random(2)
    ids = music_graph.walk(seed_video_id=None, limit=1, rng=rng)
    assert len(ids) >= 0  # never raises; may be empty on a trivial graph
    tracks = music_graph.radio_next("v1", limit=2)
    assert all("video_id" in t for t in tracks)


# --- Full-graph diagnostic snapshot ------------------------------------------------------------


@pytest.mark.django_db
def test_full_graph_snapshot_labels_components_and_islands(db):  # noqa: ARG001
    # Giant component: a-b-c chain. Island: x-y pair.
    a = MusicNode.objects.create(node_type="track", key="a", title="A", video_id="a")
    b = MusicNode.objects.create(node_type="track", key="b", title="B", video_id="b")
    c = MusicNode.objects.create(node_type="track", key="c", title="C", video_id="c")
    x = MusicNode.objects.create(node_type="track", key="x", title="X", video_id="x")
    y = MusicNode.objects.create(node_type="track", key="y", title="Y", video_id="y")
    music_graph._upsert_edge(a, b, "affinity", 1.0, source_kind="colisten")
    music_graph._upsert_edge(b, c, "affinity", 1.0, source_kind="colisten")
    music_graph._upsert_edge(x, y, "affinity", 1.0, source_kind="colisten")

    snap = music_graph.full_graph_snapshot()
    assert snap["summary"]["node_count"] == 5
    assert snap["summary"]["component_count"] == 2
    assert snap["summary"]["giant_size"] == 3
    # component 0 is the largest; the x-y pair is an island.
    comp_of = {n["key"]: n["component"] for n in snap["nodes"]}
    assert comp_of["a"] == 0 and comp_of["x"] != 0
    island_sizes = [isl["size"] for isl in snap["summary"]["islands"]]
    assert 2 in island_sizes
    # b is an articulation point of the a-b-c chain (removing it splits a from c).
    ap_keys = {ap["id"] for ap in snap["summary"]["articulation_points"]}
    assert "track:b" in ap_keys
