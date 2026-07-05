import pytest
from django.utils import timezone

from website.models import ListenTrack, MusicEdge, MusicNode
from website.services import music_graph


def _track_node(vid, title, artist, *, play_count=1):
    return MusicNode.objects.create(
        node_type="track",
        key=vid,
        title=title,
        subtitle=artist,
        thumbnail_url=f"https://img/{vid}.jpg",
        video_id=vid,
        play_count=play_count,
    )


@pytest.fixture()
def graph(db):  # noqa: ARG001
    """Seed track + two related tracks (one direct similar_track, one artist-hop)."""
    now = timezone.now()
    for vid, title, artist, album in [
        ("seed", "Let Down", "Radiohead", "OK Computer"),
        ("rel1", "Karma Police", "Radiohead", "OK Computer"),
        ("rel2", "Paranoid Android", "Radiohead", "OK Computer"),
        ("far", "Resistance", "Muse", "The Resistance"),
    ]:
        ListenTrack.objects.create(
            video_id=vid,
            title=title,
            artist=artist,
            album=album,
            thumbnail_url=f"https://img/{vid}.jpg",
            duration="3:00",
            played_at=now,
        )
    seed = _track_node("seed", "Let Down", "Radiohead")
    rel1 = _track_node("rel1", "Karma Police", "Radiohead")
    rel2 = _track_node("rel2", "Paranoid Android", "Radiohead")
    far = _track_node("far", "Resistance", "Muse")
    # Direct track edge seed<->rel1, co-listen seed<->rel2. `far` is unconnected.
    MusicEdge.objects.create(source=seed, target=rel1, edge_type="similar_track", weight=0.9)
    MusicEdge.objects.create(source=seed, target=rel2, edge_type="colisten", weight=2.0)
    return {"seed": seed, "rel1": rel1, "rel2": rel2, "far": far}


@pytest.mark.django_db
def test_radio_next_returns_related_tracks(graph):  # noqa: ARG001
    tracks = music_graph.radio_next("seed", exclude_video_ids=[], limit=5)
    vids = {t["video_id"] for t in tracks}
    # Related tracks reliably surface via the walk; `far` may appear via the ε-teleport (rare jump).
    assert {"rel1", "rel2"} <= vids
    assert vids <= {"rel1", "rel2", "far"}  # only tracks that exist, never the seed itself


@pytest.mark.django_db
def test_radio_next_track_shape(graph):  # noqa: ARG001
    tracks = music_graph.radio_next("seed", exclude_video_ids=[], limit=5)
    t = next(t for t in tracks if t["video_id"] == "rel1")
    assert set(t) == {"id", "video_id", "title", "artist", "album", "thumbnail_url", "duration", "played_at"}
    assert t["title"] == "Karma Police"
    assert t["artist"] == "Radiohead"
    assert t["album"] == "OK Computer"
    assert t["duration"] == "3:00"


@pytest.mark.django_db
def test_radio_next_respects_exclude(graph):  # noqa: ARG001
    tracks = music_graph.radio_next("seed", exclude_video_ids=["rel1"], limit=5)
    vids = {t["video_id"] for t in tracks}
    assert "rel1" not in vids  # excluded video never emitted (even via teleport)
    assert "rel2" in vids
    assert vids <= {"rel2", "far"}


@pytest.mark.django_db
def test_radio_next_unknown_seed_returns_empty(graph):  # noqa: ARG001
    assert music_graph.radio_next("nope", exclude_video_ids=[], limit=5) == []


@pytest.mark.django_db
def test_walk_isolated_seed_dead_ends_without_teleport(graph):  # noqa: ARG001
    # 'far' is disconnected: a pure neighbourhood walk (teleport off) dead-ends → empty.
    assert music_graph.walk("far", exclude_video_ids=[], limit=5, teleport_prob=0.0) == []


@pytest.mark.django_db
def test_walk_teleport_surfaces_isolated_seed(graph):  # noqa: ARG001
    import random as _random

    # With ε-teleport, radio from an isolated seed still surfaces songs (jumps to the giant),
    # so a stray lone song never leaves the queue empty.
    got = music_graph.walk("far", exclude_video_ids=[], limit=3, teleport_prob=0.5, rng=_random.Random(0))
    assert len(got) > 0


@pytest.mark.django_db
def test_radio_next_skips_zero_weight_only_neighbours():
    """A neighbour reachable only via a zero-weight edge is not a candidate."""
    now = timezone.now()
    for vid in ("z_seed", "z_rel"):
        ListenTrack.objects.create(
            video_id=vid,
            title=vid,
            artist="A",
            album="Alb",
            thumbnail_url=f"https://img/{vid}.jpg",
            duration="3:00",
            played_at=now,
        )
    seed = _track_node("z_seed", "Seed", "A")
    rel = _track_node("z_rel", "Rel", "A")
    MusicEdge.objects.create(source=seed, target=rel, edge_type="similar_track", weight=0.0)
    # The zero-weight edge is not walkable, so with teleport off there are no candidates (no crash).
    assert music_graph.walk("z_seed", exclude_video_ids=[], limit=5, teleport_prob=0.0) == []


@pytest.mark.django_db
def test_radio_next_caps_to_limit():
    """With many positive-weight neighbours, returns at most `limit` distinct tracks."""
    now = timezone.now()
    ListenTrack.objects.create(
        video_id="c_seed",
        title="Seed",
        artist="A",
        album="Alb",
        thumbnail_url="https://img/c_seed.jpg",
        duration="3:00",
        played_at=now,
    )
    seed = _track_node("c_seed", "Seed", "A")
    rels = []
    for i in range(8):
        vid = f"c_rel{i}"
        ListenTrack.objects.create(
            video_id=vid,
            title=vid,
            artist="A",
            album="Alb",
            thumbnail_url=f"https://img/{vid}.jpg",
            duration="3:00",
            played_at=now,
        )
        node = _track_node(vid, vid, "A")
        MusicEdge.objects.create(source=seed, target=node, edge_type="similar_track", weight=0.5 + i)
        rels.append(vid)
    result = music_graph.radio_next("c_seed", exclude_video_ids=[], limit=3)
    vids = [t["video_id"] for t in result]
    assert len(vids) == 3
    assert len(set(vids)) == 3  # distinct, no repeats
    assert "c_seed" not in vids
    assert all(v in rels for v in vids)


@pytest.mark.django_db
def test_radio_endpoint_returns_tracks(client, graph):  # noqa: ARG001
    resp = client.get("/api/listens/radio/", {"seed": "seed"})
    assert resp.status_code == 200
    vids = {t["video_id"] for t in resp.json()["tracks"]}
    assert {"rel1", "rel2"} <= vids <= {"rel1", "rel2", "far"}  # `far` may appear via ε-teleport


@pytest.mark.django_db
def test_radio_endpoint_honours_exclude(client, graph):  # noqa: ARG001
    resp = client.get("/api/listens/radio/", {"seed": "seed", "exclude": "rel1"})
    assert resp.status_code == 200
    vids = {t["video_id"] for t in resp.json()["tracks"]}
    assert "rel1" not in vids and "rel2" in vids and vids <= {"rel2", "far"}


@pytest.mark.django_db
def test_radio_endpoint_requires_seed(client, graph):  # noqa: ARG001
    resp = client.get("/api/listens/radio/")
    assert resp.status_code == 400
