import pytest
from django.db import transaction
from django.db.utils import IntegrityError

from website.models import LastfmCache, MusicEdge, MusicNode


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
