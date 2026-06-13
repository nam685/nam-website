import pytest
from django.test import Client
from django.utils import timezone

from website.models import ListenTrack
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
    music_graph.rebuild_colisten_edges()
    music_graph.compute_recommend_scores()


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
