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
def test_colisten_edges_link_tracks_within_window(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    music_graph.rebuild_colisten_edges(window_minutes=30)
    v1 = MusicNode.objects.get(node_type="track", key="v1")
    v2 = MusicNode.objects.get(node_type="track", key="v2")
    v3 = MusicNode.objects.get(node_type="track", key="v3")
    # v1 (5m ago) and v2 (10m ago) are within 30m -> linked.
    assert music_graph.edge_exists(v1, v2, "colisten")
    # v3 (90m ago) is far from everything -> no colisten edge.
    assert not music_graph.edge_exists(v2, v3, "colisten")


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
def test_similarity_edges_only_within_universe_and_cached(plays):  # noqa: ARG001
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
        music_graph.rebuild_similarity_edges(api_key="KEY")

    radiohead = MusicNode.objects.get(node_type="artist", key="radiohead")
    muse = MusicNode.objects.get(node_type="artist", key="muse")
    assert music_graph.edge_exists(radiohead, muse, "similar_artist")
    # Coldplay is not a node, so no edge was created to it.
    assert not MusicNode.objects.filter(node_type="artist", key="coldplay").exists()
    # Response was cached.
    assert LastfmCache.objects.filter(cache_key="artist.getsimilar::radiohead").exists()


@pytest.mark.django_db
def test_similarity_edges_noop_without_api_key(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    music_graph.rebuild_similarity_edges(api_key="")
    assert not MusicEdge.objects.filter(edge_type="similar_artist").exists()


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
def test_get_patch_seedless_picks_by_recommend_score(plays):  # noqa: ARG001
    music_graph.rebuild_nodes()
    music_graph.compute_recommend_scores()
    MusicNode.objects.filter(node_type="track", key="v3").update(recommend_score=10_000)
    MusicNode.objects.exclude(key="v3").update(recommend_score=0)
    patch = music_graph.get_patch(seed_key=None, seed_type=None, max_nodes=40)
    assert patch["seed"] == "v3"


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
    music_graph.rebuild_colisten_edges()

    r1 = MusicNode.objects.get(node_type="track", key="r1")
    r2 = MusicNode.objects.get(node_type="track", key="r2")
    s1 = MusicNode.objects.get(node_type="track", key="s1")
    s2 = MusicNode.objects.get(node_type="track", key="s2")
    assert music_graph.edge_exists(r1, r2, "colisten")  # real plays linked
    assert not music_graph.edge_exists(s1, s2, "colisten")  # sync plays excluded
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
