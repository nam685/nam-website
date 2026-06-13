import pytest
from django.db import transaction
from django.db.utils import IntegrityError
from django.utils import timezone

from website.models import LastfmCache, ListenTrack, MusicEdge, MusicNode
from website.services import music_graph


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
