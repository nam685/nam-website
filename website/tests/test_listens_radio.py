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
    assert vids == {"rel1", "rel2"}  # related, not `far`, not the seed itself


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
    assert vids == {"rel2"}


@pytest.mark.django_db
def test_radio_next_unknown_seed_returns_empty(graph):  # noqa: ARG001
    assert music_graph.radio_next("nope", exclude_video_ids=[], limit=5) == []


@pytest.mark.django_db
def test_radio_next_isolated_node_returns_empty(graph):  # noqa: ARG001
    assert music_graph.radio_next("far", exclude_video_ids=[], limit=5) == []
