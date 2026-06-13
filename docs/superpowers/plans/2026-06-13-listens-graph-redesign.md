# Listens Graph Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four list-based `/listens` tabs with a single interactive force-directed graph of the user's music, where nodes (tracks/artists/albums) are connected by listening affinity and each visit reveals a recommendation-weighted "patch."

**Architecture:** A derived-cache graph (`MusicNode` + `MusicEdge`) is rebuilt from the raw `ListenTrack` play log plus YouTube-Music personalization and Last.fm similarity (collaborative-filtering-derived). Two public read endpoints (`graph/patch/`, `graph/search/`) serve neighborhoods to a `react-force-graph-2d` page that supports searching to a region and re-centering ("walking") on node click. Playback stays admin-only.

**Tech Stack:** Django 6 + PostgreSQL + Redis (backend), `httpx` (Last.fm client), `ytmusicapi` (personalization), Next.js 16 / React 19 + `react-force-graph-2d` (frontend), pytest + vitest (tests).

**Spec:** `docs/superpowers/specs/2026-06-13-listens-graph-redesign-design.md`

---

## File Structure

**Backend (new):**
- `website/models/music_node.py` — `MusicNode` model
- `website/models/music_edge.py` — `MusicEdge` model
- `website/models/lastfm_cache.py` — `LastfmCache` model
- `website/services/lastfm.py` — Last.fm HTTP client (similar artists/tracks)
- `website/services/music_graph.py` — graph build pipeline + patch/search query helpers
- `website/views/listen_graph.py` — `graph_patch`, `graph_search` views
- `website/management/commands/build_music_graph.py` — CLI entry to rebuild the graph
- `website/tests/test_music_graph.py` — service + command tests
- `website/tests/test_listen_graph.py` — API tests

**Backend (modified):**
- `website/models/__init__.py` — export new models
- `website/views/__init__.py` — export new views, remove dead ones
- `website/urls.py` — add graph routes, remove dead routes
- `website/views/listen.py` — remove `listen_top_tracks/artists/albums`, `listen_recommended`; call graph rebuild from `listen_sync`
- `website/tests/test_listen.py` — drop tests for removed endpoints
- `config/settings.py` — add `LASTFM_API_KEY`
- `.env.example` — document `LASTFM_API_KEY`

**Frontend (new):**
- `frontend/src/lib/graph.ts` — pure helpers (radius, edge style, patch→force transform)
- `frontend/src/lib/__tests__/graph.test.ts` — vitest

**Frontend (modified):**
- `frontend/src/lib/api.ts` — add graph types
- `frontend/src/app/listens/page.tsx` — replace history list with the graph
- `frontend/src/app/listens/layout.tsx` — strip the hero + tab bar down to a thin shell
- `frontend/package.json` — add `react-force-graph-2d`

**Frontend (deleted):**
- `frontend/src/app/listens/tracks/page.tsx`
- `frontend/src/app/listens/artists/page.tsx`
- `frontend/src/app/listens/albums/page.tsx`

**Docs (modified):**
- `docs/README.md`, `docs/QA-CHECKLIST.md`

---

## Task 1: Graph data models

**Files:**
- Create: `website/models/music_node.py`
- Create: `website/models/music_edge.py`
- Create: `website/models/lastfm_cache.py`
- Modify: `website/models/__init__.py`
- Test: `website/tests/test_music_graph.py`

- [ ] **Step 1: Write the failing test**

Create `website/tests/test_music_graph.py`:

```python
import pytest

from website.models import LastfmCache, MusicEdge, MusicNode


@pytest.mark.django_db
def test_music_node_unique_per_type_and_key():
    MusicNode.objects.create(node_type="artist", key="radiohead", title="Radiohead")
    # Same type+key must be rejected; same key under a different type is fine.
    with pytest.raises(Exception):
        MusicNode.objects.create(node_type="artist", key="radiohead", title="Radiohead")
    MusicNode.objects.create(node_type="track", key="radiohead", title="Self-titled?")
    assert MusicNode.objects.count() == 2


@pytest.mark.django_db
def test_music_edge_links_two_nodes():
    a = MusicNode.objects.create(node_type="artist", key="a", title="A")
    b = MusicNode.objects.create(node_type="artist", key="b", title="B")
    edge = MusicEdge.objects.create(source=a, target=b, edge_type="similar_artist", weight=0.8)
    assert edge.source_id == a.id and edge.target_id == b.id


@pytest.mark.django_db
def test_lastfm_cache_roundtrip():
    LastfmCache.objects.create(cache_key="artist.getsimilar::radiohead", payload=[{"name": "Muse"}])
    row = LastfmCache.objects.get(cache_key="artist.getsimilar::radiohead")
    assert row.payload[0]["name"] == "Muse"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_music_graph.py -v`
Expected: FAIL — `ImportError: cannot import name 'MusicNode'`.

- [ ] **Step 3: Create the model files**

`website/models/music_node.py`:

```python
from django.db import models


class MusicNode(models.Model):
    """A node in the listening graph: a track, artist, or album.

    Derived cache rebuilt from ListenTrack + YTM personalization on each sync.
    """

    NODE_TYPES = [("artist", "artist"), ("album", "album"), ("track", "track")]

    node_type = models.CharField(max_length=8, choices=NODE_TYPES)
    key = models.CharField(max_length=600)  # video_id | artist_lower | "artist::album"
    title = models.CharField(max_length=500)
    subtitle = models.CharField(max_length=500, blank=True, default="")
    thumbnail_url = models.URLField(max_length=1000, blank=True, default="")
    video_id = models.CharField(max_length=64, blank=True, default="")
    play_count = models.IntegerField(default=0)
    last_played = models.DateTimeField(null=True, blank=True)
    is_liked = models.BooleanField(default=False)
    is_subscribed = models.BooleanField(default=False)
    in_library = models.BooleanField(default=False)
    recommend_score = models.FloatField(default=0.0)

    class Meta:
        unique_together = [("node_type", "key")]
        indexes = [
            models.Index(fields=["node_type"]),
            models.Index(fields=["-recommend_score"]),
        ]

    def __str__(self):
        return f"{self.node_type}:{self.title}"
```

`website/models/music_edge.py`:

```python
from django.db import models


class MusicEdge(models.Model):
    """An undirected affinity/structural edge between two MusicNodes.

    Stored canonically with source_id < target_id (enforced by the build pipeline).
    """

    EDGE_TYPES = [
        ("similar_artist", "similar_artist"),
        ("similar_track", "similar_track"),
        ("colisten", "colisten"),
        ("structural", "structural"),
    ]

    source = models.ForeignKey("MusicNode", on_delete=models.CASCADE, related_name="edges_out")
    target = models.ForeignKey("MusicNode", on_delete=models.CASCADE, related_name="edges_in")
    edge_type = models.CharField(max_length=16, choices=EDGE_TYPES)
    weight = models.FloatField(default=1.0)

    class Meta:
        unique_together = [("source", "target", "edge_type")]
        indexes = [
            models.Index(fields=["source"]),
            models.Index(fields=["target"]),
        ]

    def __str__(self):
        return f"{self.source_id}-{self.target_id} ({self.edge_type})"
```

`website/models/lastfm_cache.py`:

```python
from django.db import models


class LastfmCache(models.Model):
    """Cached Last.fm API responses so repeated graph builds don't re-hit the API."""

    cache_key = models.CharField(max_length=600, unique=True)
    payload = models.JSONField(default=list)
    fetched_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.cache_key
```

- [ ] **Step 4: Register the models**

In `website/models/__init__.py`, add the imports (keep alphabetical grouping) and `__all__` entries:

```python
from .lastfm_cache import LastfmCache
from .music_edge import MusicEdge
from .music_node import MusicNode
```

Add `"LastfmCache"`, `"MusicEdge"`, `"MusicNode"` to `__all__`.

- [ ] **Step 5: Make and apply the migration**

Run: `uv run python manage.py makemigrations website && uv run python manage.py migrate`
Expected: a new `0020_*.py` migration creating the three tables; migrate succeeds.

- [ ] **Step 6: Run test to verify it passes**

Run: `uv run pytest website/tests/test_music_graph.py -v`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add website/models/ website/migrations/ website/tests/test_music_graph.py
git commit -m "feat: add MusicNode, MusicEdge, LastfmCache models"
```

---

## Task 2: Node aggregation from ListenTrack

**Files:**
- Create: `website/services/music_graph.py`
- Test: `website/tests/test_music_graph.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_music_graph.py`:

```python
from django.utils import timezone

from website.models import ListenTrack
from website.services import music_graph


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
            video_id=vid, title=title, artist=artist, album=album,
            thumbnail_url=f"https://img/{vid}.jpg", duration="3:00",
            played_at=now - timezone.timedelta(minutes=mins),
        )


@pytest.mark.django_db
def test_rebuild_nodes_aggregates_tracks_artists_albums(plays):
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_music_graph.py::test_rebuild_nodes_aggregates_tracks_artists_albums -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'website.services.music_graph'`.

- [ ] **Step 3: Write the implementation**

Create `website/services/music_graph.py`:

```python
import logging

from django.db.models import Count, Max
from django.utils import timezone

from website.models import ListenTrack, MusicNode

logger = logging.getLogger(__name__)


def normalize(name: str) -> str:
    """Canonical identity key for artist/album names."""
    return name.strip().lower()


def split_artists(field: str) -> list[str]:
    """Split a stored 'A, B' artist field into individual names."""
    return [n.strip() for n in field.split(",") if n.strip()]


def _upsert_node(node_type, key, *, title, subtitle="", thumbnail_url="", video_id="",
                 play_count=0, last_played=None):
    MusicNode.objects.update_or_create(
        node_type=node_type,
        key=key,
        defaults={
            "title": title,
            "subtitle": subtitle,
            "thumbnail_url": thumbnail_url,
            "video_id": video_id,
            "play_count": play_count,
            "last_played": last_played,
        },
    )


def rebuild_nodes():
    """(Re)build track/artist/album nodes from the ListenTrack play log.

    Personalization flags (is_liked/in_library/is_subscribed) are NOT touched here
    so a play-only rebuild preserves them; they are set by sync_personalization().
    """
    # --- Track nodes (keyed by video_id) ---
    track_rows = (
        ListenTrack.objects.values("video_id")
        .annotate(play_count=Count("id"), last_played=Max("played_at"))
    )
    for row in track_rows:
        latest = (
            ListenTrack.objects.filter(video_id=row["video_id"]).order_by("-played_at").first()
        )
        _upsert_node(
            "track", row["video_id"],
            title=latest.title, subtitle=latest.artist, thumbnail_url=latest.thumbnail_url,
            video_id=row["video_id"], play_count=row["play_count"], last_played=row["last_played"],
        )

    # --- Artist + album aggregates (need per-name splitting) ---
    artist_counts: dict[str, dict] = {}
    album_counts: dict[str, dict] = {}
    for t in ListenTrack.objects.all().iterator():
        names = split_artists(t.artist)
        for name in names:
            a = artist_counts.setdefault(
                normalize(name),
                {"title": name, "play_count": 0, "last_played": t.played_at,
                 "thumbnail_url": t.thumbnail_url, "video_id": t.video_id},
            )
            a["play_count"] += 1
            if t.played_at > a["last_played"]:
                a["last_played"] = t.played_at
                a["video_id"] = t.video_id
                a["thumbnail_url"] = t.thumbnail_url or a["thumbnail_url"]
        if t.album and names:
            primary = names[0]
            key = f"{normalize(primary)}::{normalize(t.album)}"
            al = album_counts.setdefault(
                key,
                {"title": t.album, "subtitle": primary, "play_count": 0,
                 "last_played": t.played_at, "thumbnail_url": t.thumbnail_url, "video_id": t.video_id},
            )
            al["play_count"] += 1
            if t.played_at > al["last_played"]:
                al["last_played"] = t.played_at
                al["thumbnail_url"] = t.thumbnail_url or al["thumbnail_url"]

    for key, a in artist_counts.items():
        _upsert_node("artist", key, title=a["title"], thumbnail_url=a["thumbnail_url"],
                     video_id=a["video_id"], play_count=a["play_count"], last_played=a["last_played"])
    for key, al in album_counts.items():
        _upsert_node("album", key, title=al["title"], subtitle=al["subtitle"],
                     thumbnail_url=al["thumbnail_url"], video_id=al["video_id"],
                     play_count=al["play_count"], last_played=al["last_played"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_music_graph.py::test_rebuild_nodes_aggregates_tracks_artists_albums -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/services/music_graph.py website/tests/test_music_graph.py
git commit -m "feat: aggregate ListenTrack into graph nodes"
```

---

## Task 3: Structural and co-listen edges

**Files:**
- Modify: `website/services/music_graph.py`
- Test: `website/tests/test_music_graph.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_music_graph.py`:

```python
from website.models import MusicEdge


@pytest.mark.django_db
def test_structural_edges_link_track_to_artist_and_album(plays):
    music_graph.rebuild_nodes()
    music_graph.rebuild_structural_edges()
    v1 = MusicNode.objects.get(node_type="track", key="v1")
    artist = MusicNode.objects.get(node_type="artist", key="radiohead")
    album = MusicNode.objects.get(node_type="album", key="radiohead::ok computer")
    # An edge exists between v1 and its artist, and v1 and its album (order-independent).
    assert music_graph.edge_exists(v1, artist, "structural")
    assert music_graph.edge_exists(v1, album, "structural")


@pytest.mark.django_db
def test_colisten_edges_link_tracks_within_window(plays):
    music_graph.rebuild_nodes()
    music_graph.rebuild_colisten_edges(window_minutes=30)
    v1 = MusicNode.objects.get(node_type="track", key="v1")
    v2 = MusicNode.objects.get(node_type="track", key="v2")
    v3 = MusicNode.objects.get(node_type="track", key="v3")
    # v1 (5m ago) and v2 (10m ago) are within 30m -> linked.
    assert music_graph.edge_exists(v1, v2, "colisten")
    # v3 (90m ago) is far from everything -> no colisten edge.
    assert not music_graph.edge_exists(v2, v3, "colisten")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_music_graph.py -k "structural_edges or colisten_edges" -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'rebuild_structural_edges'`.

- [ ] **Step 3: Write the implementation**

Add to `website/services/music_graph.py`:

```python
COLISTEN_WINDOW_MINUTES = 30
STRUCTURAL_WEIGHT = 0.5


def _canonical(a: MusicNode, b: MusicNode):
    """Return (source, target) ordered so source_id < target_id."""
    return (a, b) if a.id < b.id else (b, a)


def edge_exists(a: MusicNode, b: MusicNode, edge_type: str) -> bool:
    src, tgt = _canonical(a, b)
    return MusicEdge.objects.filter(source=src, target=tgt, edge_type=edge_type).exists()


def _upsert_edge(a: MusicNode, b: MusicNode, edge_type: str, weight: float):
    if a.id == b.id:
        return
    src, tgt = _canonical(a, b)
    MusicEdge.objects.update_or_create(
        source=src, target=tgt, edge_type=edge_type, defaults={"weight": weight}
    )


def rebuild_structural_edges():
    """track -> its artist(s) and album. Thin connective tissue between node types."""
    MusicEdge.objects.filter(edge_type="structural").delete()
    artists = {n.key: n for n in MusicNode.objects.filter(node_type="artist")}
    albums = {n.key: n for n in MusicNode.objects.filter(node_type="album")}
    tracks = {n.key: n for n in MusicNode.objects.filter(node_type="track")}

    for t in ListenTrack.objects.all().iterator():
        track_node = tracks.get(t.video_id)
        if not track_node:
            continue
        names = split_artists(t.artist)
        for name in names:
            artist_node = artists.get(normalize(name))
            if artist_node:
                _upsert_edge(track_node, artist_node, "structural", STRUCTURAL_WEIGHT)
        if t.album and names:
            album_node = albums.get(f"{normalize(names[0])}::{normalize(t.album)}")
            if album_node:
                _upsert_edge(track_node, album_node, "structural", STRUCTURAL_WEIGHT)


def rebuild_colisten_edges(window_minutes: int = COLISTEN_WINDOW_MINUTES):
    """Link tracks played within `window_minutes` of each other. Weight = co-occurrence count."""
    MusicEdge.objects.filter(edge_type="colisten").delete()
    tracks = {n.key: n for n in MusicNode.objects.filter(node_type="track")}
    window = timezone.timedelta(minutes=window_minutes)

    ordered = list(ListenTrack.objects.order_by("played_at").values("video_id", "played_at"))
    counts: dict[tuple[str, str], int] = {}
    for i, cur in enumerate(ordered):
        for nxt in ordered[i + 1:]:
            if nxt["played_at"] - cur["played_at"] > window:
                break
            if nxt["video_id"] == cur["video_id"]:
                continue
            pair = tuple(sorted((cur["video_id"], nxt["video_id"])))
            counts[pair] = counts.get(pair, 0) + 1

    for (a_key, b_key), count in counts.items():
        a, b = tracks.get(a_key), tracks.get(b_key)
        if a and b:
            _upsert_edge(a, b, "colisten", float(count))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_music_graph.py -k "structural_edges or colisten_edges" -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add website/services/music_graph.py website/tests/test_music_graph.py
git commit -m "feat: structural and co-listen graph edges"
```

---

## Task 4: Last.fm similarity client

**Files:**
- Create: `website/services/lastfm.py`
- Test: `website/tests/test_music_graph.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_music_graph.py`:

```python
from unittest.mock import MagicMock, patch

from website.services import lastfm


def _resp(json_body):
    m = MagicMock()
    m.json.return_value = json_body
    m.raise_for_status.return_value = None
    return m


def test_fetch_similar_artists_parses_match_scores():
    body = {"similarartists": {"artist": [
        {"name": "Muse", "match": "0.9"},
        {"name": "Coldplay", "match": "0.4"},
    ]}}
    with patch("website.services.lastfm.httpx.get", return_value=_resp(body)) as g:
        out = lastfm.fetch_similar_artists("Radiohead", "KEY")
    assert out == [{"name": "Muse", "match": 0.9}, {"name": "Coldplay", "match": 0.4}]
    assert g.call_args.kwargs["params"]["method"] == "artist.getsimilar"


def test_fetch_similar_tracks_parses_artist_and_title():
    body = {"similartracks": {"track": [
        {"name": "Karma Police", "artist": {"name": "Radiohead"}, "match": "1.0"},
    ]}}
    with patch("website.services.lastfm.httpx.get", return_value=_resp(body)):
        out = lastfm.fetch_similar_tracks("Radiohead", "Let Down", "KEY")
    assert out == [{"artist": "Radiohead", "title": "Karma Police", "match": 1.0}]


def test_fetch_similar_artists_returns_empty_on_error():
    with patch("website.services.lastfm.httpx.get", side_effect=Exception("boom")):
        assert lastfm.fetch_similar_artists("X", "KEY") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_music_graph.py -k "fetch_similar" -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'website.services.lastfm'`.

- [ ] **Step 3: Write the implementation**

Create `website/services/lastfm.py`:

```python
import logging

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://ws.audioscrobbler.com/2.0/"


def fetch_similar_artists(name: str, api_key: str, limit: int = 50) -> list[dict]:
    """Return [{'name': str, 'match': float}] for artists similar to `name` (CF-derived)."""
    try:
        resp = httpx.get(
            BASE_URL,
            params={"method": "artist.getsimilar", "artist": name, "api_key": api_key,
                    "format": "json", "limit": limit},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logger.warning("Last.fm artist.getsimilar failed for %r", name)
        return []
    out = []
    for a in data.get("similarartists", {}).get("artist", []):
        try:
            out.append({"name": a["name"], "match": float(a.get("match", 0))})
        except (KeyError, ValueError, TypeError):
            continue
    return out


def fetch_similar_tracks(artist: str, title: str, api_key: str, limit: int = 50) -> list[dict]:
    """Return [{'artist': str, 'title': str, 'match': float}] for similar tracks (CF-derived)."""
    try:
        resp = httpx.get(
            BASE_URL,
            params={"method": "track.getsimilar", "artist": artist, "track": title,
                    "api_key": api_key, "format": "json", "limit": limit},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logger.warning("Last.fm track.getsimilar failed for %r - %r", artist, title)
        return []
    out = []
    for t in data.get("similartracks", {}).get("track", []):
        try:
            out.append({"artist": t["artist"]["name"], "title": t["name"],
                        "match": float(t.get("match", 0))})
        except (KeyError, ValueError, TypeError):
            continue
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_music_graph.py -k "fetch_similar" -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add website/services/lastfm.py website/tests/test_music_graph.py
git commit -m "feat: Last.fm similarity client"
```

---

## Task 5: Similarity edges (cached, universe-filtered)

**Files:**
- Modify: `website/services/music_graph.py`
- Test: `website/tests/test_music_graph.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_music_graph.py`:

```python
@pytest.mark.django_db
def test_similarity_edges_only_within_universe_and_cached(plays):
    music_graph.rebuild_nodes()

    # Radiohead is similar to Muse (in universe) and Coldplay (NOT in universe).
    def fake_artists(name, api_key, limit=50):
        if music_graph.normalize(name) == "radiohead":
            return [{"name": "Muse", "match": 0.9}, {"name": "Coldplay", "match": 0.4}]
        return []

    with patch.object(music_graph.lastfm, "fetch_similar_artists", side_effect=fake_artists), \
         patch.object(music_graph.lastfm, "fetch_similar_tracks", return_value=[]):
        music_graph.rebuild_similarity_edges(api_key="KEY")

    radiohead = MusicNode.objects.get(node_type="artist", key="radiohead")
    muse = MusicNode.objects.get(node_type="artist", key="muse")
    assert music_graph.edge_exists(radiohead, muse, "similar_artist")
    # Coldplay is not a node, so no edge was created to it.
    assert not MusicNode.objects.filter(node_type="artist", key="coldplay").exists()
    # Response was cached.
    assert LastfmCache.objects.filter(cache_key="artist.getsimilar::radiohead").exists()


@pytest.mark.django_db
def test_similarity_edges_noop_without_api_key(plays):
    music_graph.rebuild_nodes()
    music_graph.rebuild_similarity_edges(api_key="")
    assert not MusicEdge.objects.filter(edge_type="similar_artist").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_music_graph.py -k "similarity_edges" -v`
Expected: FAIL — `AttributeError: ... 'rebuild_similarity_edges'`.

- [ ] **Step 3: Write the implementation**

Add to `website/services/music_graph.py` (add `import time` at the top, and import the cache + lastfm):

```python
import time

from website.models import LastfmCache
from website.services import lastfm

LASTFM_REQUEST_DELAY = 0.25  # ~4 req/s, polite
SIMILAR_TRACK_NODE_LIMIT = 200  # cap track.getSimilar calls to the most-played tracks


def _cached_lastfm(cache_key: str, fetch):
    row = LastfmCache.objects.filter(cache_key=cache_key).first()
    if row is not None:
        return row.payload
    payload = fetch()
    LastfmCache.objects.update_or_create(cache_key=cache_key, defaults={"payload": payload})
    time.sleep(LASTFM_REQUEST_DELAY)
    return payload


def rebuild_similarity_edges(api_key: str):
    """Create similar_artist / similar_track edges between nodes already in the universe.

    Last.fm responses are cached in LastfmCache. With no api_key, this is a no-op so the
    graph still builds from co-listen + structural edges (useful in dev).
    """
    if not api_key:
        logger.info("LASTFM_API_KEY unset; skipping similarity enrichment")
        return

    MusicEdge.objects.filter(edge_type__in=["similar_artist", "similar_track"]).delete()

    artists = {n.key: n for n in MusicNode.objects.filter(node_type="artist")}
    # Track lookup by (artist_norm, title_norm) so Last.fm name-based results map back to nodes.
    tracks_by_name: dict[tuple[str, str], MusicNode] = {}
    for n in MusicNode.objects.filter(node_type="track"):
        tracks_by_name[(normalize(n.subtitle.split(",")[0]), normalize(n.title))] = n

    # --- similar artists ---
    for key, node in artists.items():
        payload = _cached_lastfm(
            f"artist.getsimilar::{key}",
            lambda node=node: lastfm.fetch_similar_artists(node.title, api_key),
        )
        for sim in payload:
            target = artists.get(normalize(sim["name"]))
            if target:
                _upsert_edge(node, target, "similar_artist", float(sim["match"]))

    # --- similar tracks (only for the most-played tracks, to bound API calls) ---
    top_tracks = (
        MusicNode.objects.filter(node_type="track").order_by("-play_count")[:SIMILAR_TRACK_NODE_LIMIT]
    )
    for node in top_tracks:
        artist_primary = node.subtitle.split(",")[0].strip()
        payload = _cached_lastfm(
            f"track.getsimilar::{normalize(artist_primary)}::{normalize(node.title)}",
            lambda node=node, a=artist_primary: lastfm.fetch_similar_tracks(a, node.title, api_key),
        )
        for sim in payload:
            target = tracks_by_name.get((normalize(sim["artist"]), normalize(sim["title"])))
            if target:
                _upsert_edge(node, target, "similar_track", float(sim["match"]))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_music_graph.py -k "similarity_edges" -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add website/services/music_graph.py website/tests/test_music_graph.py
git commit -m "feat: cached Last.fm similarity edges within universe"
```

---

## Task 6: Recommendation scores + personalization flags

**Files:**
- Modify: `website/services/music_graph.py`
- Test: `website/tests/test_music_graph.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_music_graph.py`:

```python
@pytest.mark.django_db
def test_recommend_score_boosts_personalized_nodes(plays):
    music_graph.rebuild_nodes()
    # Two artists with identical play history; one is subscribed.
    plain = MusicNode.objects.get(node_type="artist", key="muse")
    fav = MusicNode.objects.get(node_type="artist", key="radiohead")
    fav.is_subscribed = True
    fav.save()
    music_graph.compute_recommend_scores()
    fav.refresh_from_db()
    plain.refresh_from_db()
    # Personalized node scores strictly higher than its play-weight alone would give.
    assert fav.recommend_score > plain.recommend_score


@pytest.mark.django_db
def test_apply_personalization_sets_flags(plays):
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_music_graph.py -k "recommend_score or apply_personalization" -v`
Expected: FAIL — `AttributeError: ... 'compute_recommend_scores'`.

- [ ] **Step 3: Write the implementation**

Add to `website/services/music_graph.py`:

```python
PERSONALIZATION_BOOST = 1.5  # multiplier per active flag (liked/subscribed/in_library)


def compute_recommend_scores():
    """Rediscovery weighting (play_count x days_since_last_play) boosted by personalization."""
    now = timezone.now()
    for node in MusicNode.objects.all().iterator():
        days_since = (now - node.last_played).days if node.last_played else 30
        base = max(node.play_count, 1) * max(days_since, 1)
        boost = 1.0
        for flag in (node.is_liked, node.is_subscribed, node.in_library):
            if flag:
                boost *= PERSONALIZATION_BOOST
        node.recommend_score = base * boost
        node.save(update_fields=["recommend_score"])


def apply_personalization(*, liked_video_ids, library_album_keys, subscribed_artist_keys,
                          library_video_ids):
    """Set personalization flags on existing nodes from YTM library data (idempotent)."""
    MusicNode.objects.filter(node_type="track").update(is_liked=False, in_library=False)
    MusicNode.objects.filter(node_type="album").update(in_library=False)
    MusicNode.objects.filter(node_type="artist").update(is_subscribed=False)

    if liked_video_ids:
        MusicNode.objects.filter(node_type="track", key__in=liked_video_ids).update(is_liked=True)
    if library_video_ids:
        MusicNode.objects.filter(node_type="track", key__in=library_video_ids).update(in_library=True)
    if library_album_keys:
        MusicNode.objects.filter(node_type="album", key__in=library_album_keys).update(in_library=True)
    if subscribed_artist_keys:
        MusicNode.objects.filter(node_type="artist", key__in=subscribed_artist_keys).update(
            is_subscribed=True
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_music_graph.py -k "recommend_score or apply_personalization" -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add website/services/music_graph.py website/tests/test_music_graph.py
git commit -m "feat: recommend scores and personalization flags"
```

---

## Task 7: Patch + search query helpers

**Files:**
- Modify: `website/services/music_graph.py`
- Test: `website/tests/test_music_graph.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_music_graph.py`:

```python
@pytest.mark.django_db
def test_get_patch_returns_seed_neighborhood(plays):
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
def test_get_patch_seedless_picks_by_recommend_score(plays):
    music_graph.rebuild_nodes()
    music_graph.compute_recommend_scores()
    MusicNode.objects.filter(node_type="track", key="v3").update(recommend_score=10_000)
    MusicNode.objects.exclude(key="v3").update(recommend_score=0)
    patch = music_graph.get_patch(seed_key=None, seed_type=None, max_nodes=40)
    assert patch["seed"] == "v3"


@pytest.mark.django_db
def test_search_nodes_matches_title_and_subtitle(plays):
    music_graph.rebuild_nodes()
    results = music_graph.search_nodes("radio")
    titles = {r["title"] for r in results}
    assert "Radiohead" in titles
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_music_graph.py -k "get_patch or search_nodes" -v`
Expected: FAIL — `AttributeError: ... 'get_patch'`.

- [ ] **Step 3: Write the implementation**

Add to `website/services/music_graph.py` (add `import random` at top):

```python
import random

PATCH_MAX_NODES = 40


def _serialize_node(n: MusicNode) -> dict:
    return {
        "key": n.key, "node_type": n.node_type, "title": n.title, "subtitle": n.subtitle,
        "thumbnail_url": n.thumbnail_url, "video_id": n.video_id, "play_count": n.play_count,
        "is_liked": n.is_liked, "is_subscribed": n.is_subscribed, "in_library": n.in_library,
    }


def _neighbors(node_ids: set[int]):
    """All edges with at least one endpoint in node_ids, plus the touched node ids."""
    edges = MusicEdge.objects.filter(source_id__in=node_ids).union(
        MusicEdge.objects.filter(target_id__in=node_ids)
    )
    return list(edges)


def get_patch(seed_key, seed_type, max_nodes: int = PATCH_MAX_NODES) -> dict:
    """Return {seed, nodes, edges} for the seed node + BFS depth-2 neighborhood, capped."""
    if seed_key is None:
        seed = (
            MusicNode.objects.filter(recommend_score__gt=0).order_by("-recommend_score")[:50]
        )
        seed = list(seed) or list(MusicNode.objects.all()[:50])
        if not seed:
            return {"seed": None, "nodes": [], "edges": []}
        weights = [n.recommend_score or 1.0 for n in seed]
        seed_node = random.choices(seed, weights=weights, k=1)[0]
    else:
        seed_node = MusicNode.objects.filter(key=seed_key, node_type=seed_type).first()
        if seed_node is None:
            seed_node = MusicNode.objects.filter(key=seed_key).first()
        if seed_node is None:
            return {"seed": None, "nodes": [], "edges": []}

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

    nodes = list(MusicNode.objects.filter(id__in=collected))
    id_to_key = {n.id: n.key for n in nodes}
    edges = MusicEdge.objects.filter(source_id__in=collected, target_id__in=collected)
    return {
        "seed": seed_node.key,
        "nodes": [_serialize_node(n) for n in nodes],
        "edges": [
            {"source": id_to_key[e.source_id], "target": id_to_key[e.target_id],
             "edge_type": e.edge_type, "weight": e.weight}
            for e in edges
        ],
    }


def search_nodes(query: str, limit: int = 10) -> list[dict]:
    from django.db.models import Q

    if not query.strip():
        return []
    qs = (
        MusicNode.objects.filter(Q(title__icontains=query) | Q(subtitle__icontains=query))
        .order_by("-recommend_score")[:limit]
    )
    return [
        {"key": n.key, "node_type": n.node_type, "title": n.title,
         "subtitle": n.subtitle, "thumbnail_url": n.thumbnail_url}
        for n in qs
    ]
```

> **Note:** the `max_nodes` cap during BFS keeps the densest-first ordering approximate; that is acceptable for ~40-node patches. Do not over-engineer a weighted cap here.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_music_graph.py -k "get_patch or search_nodes" -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add website/services/music_graph.py website/tests/test_music_graph.py
git commit -m "feat: patch neighborhood and node search helpers"
```

---

## Task 8: build_graph orchestrator + management command

**Files:**
- Modify: `website/services/music_graph.py`
- Create: `website/management/commands/build_music_graph.py`
- Test: `website/tests/test_music_graph.py`

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_music_graph.py`:

```python
from io import StringIO

from django.core.management import call_command


@pytest.mark.django_db
def test_build_graph_runs_full_pipeline(plays):
    with patch.object(music_graph.lastfm, "fetch_similar_artists", return_value=[]), \
         patch.object(music_graph.lastfm, "fetch_similar_tracks", return_value=[]):
        music_graph.build_graph(api_key="", ytm_headers=None)
    assert MusicNode.objects.filter(node_type="track").count() == 3
    assert MusicEdge.objects.filter(edge_type="structural").exists()
    assert MusicNode.objects.filter(recommend_score__gt=0).exists()


@pytest.mark.django_db
def test_build_music_graph_command(plays):
    out = StringIO()
    with patch.object(music_graph, "build_graph") as mock_build:
        call_command("build_music_graph", stdout=out)
    mock_build.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_music_graph.py -k "build_graph or build_music_graph_command" -v`
Expected: FAIL — `AttributeError: ... 'build_graph'`.

- [ ] **Step 3: Write the orchestrator**

Add to `website/services/music_graph.py`:

```python
def _load_personalization_from_ytm(ytm_headers):
    """Pull liked/library/subscriptions from YTM. Returns kwargs for apply_personalization.

    Any failure logs a warning and returns empty sets so the build still completes.
    """
    empty = {"liked_video_ids": set(), "library_album_keys": set(),
             "subscribed_artist_keys": set(), "library_video_ids": set()}
    if not ytm_headers:
        return empty
    try:
        from ytmusicapi import YTMusic

        yt = YTMusic(ytm_headers)
        liked = {s.get("videoId") for s in yt.get_liked_songs(limit=500).get("tracks", [])
                 if s.get("videoId")}
        lib_songs = {s.get("videoId") for s in yt.get_library_songs(limit=1000) if s.get("videoId")}
        album_keys = set()
        for al in yt.get_library_albums(limit=500):
            name = al.get("title", "")
            artist = (al.get("artists") or [{}])[0].get("name", "")
            if name and artist:
                album_keys.add(f"{normalize(artist)}::{normalize(name)}")
        subs = {normalize(a.get("artist", "")) for a in yt.get_library_subscriptions(limit=1000)
                if a.get("artist")}
        return {"liked_video_ids": liked, "library_album_keys": album_keys,
                "subscribed_artist_keys": subs, "library_video_ids": lib_songs}
    except Exception:
        logger.warning("YTM personalization pull failed; building graph without flags")
        return empty


def build_graph(api_key: str, ytm_headers=None):
    """Full idempotent rebuild of the music graph from ListenTrack + YTM + Last.fm."""
    rebuild_nodes()
    apply_personalization(**_load_personalization_from_ytm(ytm_headers))
    rebuild_structural_edges()
    rebuild_colisten_edges()
    rebuild_similarity_edges(api_key=api_key)
    compute_recommend_scores()
    logger.info("Graph rebuilt: %d nodes, %d edges", MusicNode.objects.count(),
                MusicEdge.objects.count())
```

- [ ] **Step 4: Write the management command**

Create `website/management/commands/build_music_graph.py`:

```python
import json
import os

from django.conf import settings
from django.core.management.base import BaseCommand

from website.services import music_graph

BROWSER_JSON_PATH = "browser.json"


class Command(BaseCommand):
    help = "Rebuild the listening graph (nodes + edges) from ListenTrack, YTM, and Last.fm"

    def handle(self, *_args, **_options):
        ytm_headers = self._load_ytm_headers()
        music_graph.build_graph(
            api_key=getattr(settings, "LASTFM_API_KEY", ""),
            ytm_headers=ytm_headers,
        )
        self.stdout.write("Music graph rebuilt.")

    def _load_ytm_headers(self):
        from ytmusicapi.helpers import get_authorization, sapisid_from_cookie

        auth_path = os.environ.get("YTMUSIC_BROWSER_JSON", BROWSER_JSON_PATH)
        if not os.path.isfile(auth_path):
            self.stderr.write(f"YTM auth file not found ({auth_path}); skipping personalization")
            return None
        with open(auth_path) as f:
            headers = json.load(f)
        if "authorization" not in headers and "cookie" in headers:
            sapisid = sapisid_from_cookie(headers["cookie"])
            origin = headers.get("origin", "https://music.youtube.com")
            headers["authorization"] = get_authorization(sapisid + " " + origin)
        return headers
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_music_graph.py -v`
Expected: PASS (all music_graph tests).

- [ ] **Step 6: Commit**

```bash
git add website/services/music_graph.py website/management/commands/build_music_graph.py website/tests/test_music_graph.py
git commit -m "feat: build_graph orchestrator and management command"
```

---

## Task 9: Graph API endpoints

**Files:**
- Create: `website/views/listen_graph.py`
- Modify: `website/views/__init__.py`, `website/urls.py`
- Test: `website/tests/test_listen_graph.py`

- [ ] **Step 1: Write the failing test**

Create `website/tests/test_listen_graph.py`:

```python
import pytest
from django.test import Client
from django.utils import timezone

from website.models import ListenTrack
from website.services import music_graph


@pytest.fixture()
def built_graph(db):  # noqa: ARG001
    now = timezone.now()
    for i, (vid, title, artist) in enumerate(
        [("v1", "Let Down", "Radiohead"), ("v2", "Karma Police", "Radiohead")]
    ):
        ListenTrack.objects.create(
            video_id=vid, title=title, artist=artist, album="OK Computer",
            thumbnail_url="", duration="", played_at=now - timezone.timedelta(minutes=i * 5),
        )
    music_graph.rebuild_nodes()
    music_graph.rebuild_structural_edges()
    music_graph.rebuild_colisten_edges()
    music_graph.compute_recommend_scores()


@pytest.mark.django_db
def test_patch_endpoint_returns_seeded_neighborhood(built_graph):
    resp = Client().get("/api/listens/graph/patch/?seed=v1&type=track")
    assert resp.status_code == 200
    data = resp.json()
    assert data["seed"] == "v1"
    assert any(n["key"] == "v1" for n in data["nodes"])


@pytest.mark.django_db
def test_patch_endpoint_seedless_returns_a_node(built_graph):
    data = Client().get("/api/listens/graph/patch/").json()
    assert data["seed"] is not None
    assert len(data["nodes"]) >= 1


@pytest.mark.django_db
def test_search_endpoint(built_graph):
    data = Client().get("/api/listens/graph/search/?q=radio").json()
    assert any(r["title"] == "Radiohead" for r in data["results"])


@pytest.mark.django_db
def test_search_endpoint_empty_query_returns_empty(built_graph):
    data = Client().get("/api/listens/graph/search/?q=").json()
    assert data["results"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_listen_graph.py -v`
Expected: FAIL — 404s (routes not registered).

- [ ] **Step 3: Write the views**

Create `website/views/listen_graph.py`:

```python
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from ..services import music_graph


@require_GET
def graph_patch(request):
    """Return a patch (seed + neighborhood). No seed -> recommendation-weighted random."""
    seed = request.GET.get("seed") or None
    seed_type = request.GET.get("type") or None
    patch = music_graph.get_patch(seed_key=seed, seed_type=seed_type)
    return JsonResponse(patch)


@require_GET
def graph_search(request):
    """Search nodes by title/subtitle to re-seed the graph."""
    query = request.GET.get("q", "")
    return JsonResponse({"results": music_graph.search_nodes(query)})
```

- [ ] **Step 4: Register views and routes**

In `website/views/__init__.py` add to the imports:

```python
from .listen_graph import graph_patch, graph_search
```

and add `"graph_patch"`, `"graph_search"` to `__all__`.

In `website/urls.py`, add **above** the `path("listens/", views.listen_list)` line:

```python
    path("listens/graph/patch/", views.graph_patch),
    path("listens/graph/search/", views.graph_search),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest website/tests/test_listen_graph.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add website/views/listen_graph.py website/views/__init__.py website/urls.py website/tests/test_listen_graph.py
git commit -m "feat: graph patch and search API endpoints"
```

---

## Task 10: Wire graph rebuild into sync + settings + remove dead endpoints

**Files:**
- Modify: `config/settings.py`, `.env.example`
- Modify: `website/views/listen.py`, `website/views/__init__.py`, `website/urls.py`
- Modify: `website/tests/test_listen.py`

- [ ] **Step 1: Add the setting**

In `config/settings.py`, near the other secrets (after the `ADMIN_SECRET = env("ADMIN_SECRET")` line ~83):

```python
LASTFM_API_KEY = env("LASTFM_API_KEY", default="")
```

In `.env.example`, add:

```
# Last.fm API key for music-graph similarity edges (optional; graph still builds without it)
LASTFM_API_KEY=
```

- [ ] **Step 2: Trigger graph rebuild after a successful sync**

In `website/views/listen.py`, inside `listen_sync`, locate the block that runs after `bulk_create`:

```python
    if new_tracks:
        ListenTrack.objects.bulk_create(new_tracks)
        redis_cache.delete("listen_stats")
        redis_cache.delete("listen_total_count")
```

Replace it with:

```python
    if new_tracks:
        ListenTrack.objects.bulk_create(new_tracks)
        redis_cache.delete("listen_stats")
        redis_cache.delete("listen_total_count")
        try:
            from django.conf import settings

            from ..services import music_graph

            music_graph.build_graph(api_key=settings.LASTFM_API_KEY, ytm_headers=headers)
        except Exception:
            logger.exception("Graph rebuild after sync failed")
```

(`headers` is the dict already built earlier in `listen_sync` for the YTM client.)

- [ ] **Step 3: Remove the dead list endpoints**

In `website/views/listen.py`, delete the functions `listen_top_tracks`, `listen_top_artists`, `listen_top_albums`, and `listen_recommended` (their ranking/rediscovery logic is now superseded by the graph and `recommend_score`).

In `website/views/__init__.py`, remove the imports and `__all__` entries for `listen_top_tracks`, `listen_top_artists`, `listen_top_albums`, `listen_recommended`.

In `website/urls.py`, delete these lines:

```python
    path("listens/artists/", views.listen_top_artists),
    path("listens/albums/", views.listen_top_albums),
    path("listens/tracks/", views.listen_top_tracks),
    path("listens/recommended/", views.listen_recommended),
```

- [ ] **Step 4: Drop tests for the removed endpoints**

Find them: `grep -n "top_tracks\|top_artists\|top_albums\|recommended" website/tests/test_listen.py`

Delete each test function that exercises `/api/listens/tracks/`, `/artists/`, `/albums/`, or `/recommended/` (and any now-unused fixtures/imports they alone relied on). Leave tests for `listen_list`, `listen_sync`, `listen_import`, `listen_stats`, `listen_sync_status` intact.

- [ ] **Step 5: Verify nothing references the removed names**

Run: `grep -rn "listen_top_tracks\|listen_top_artists\|listen_top_albums\|listen_recommended" website/ ; echo "done"`
Expected: only matches (if any) inside deleted-test diffs already removed — output should be just `done`.

- [ ] **Step 6: Run the backend suite**

Run: `uv run pytest website/tests/test_listen.py website/tests/test_listen_graph.py website/tests/test_music_graph.py -v`
Expected: PASS (no import errors, removed-endpoint tests gone).

- [ ] **Step 7: Commit**

```bash
git add config/settings.py .env.example website/views/ website/urls.py website/tests/test_listen.py
git commit -m "feat: rebuild graph on sync, add LASTFM_API_KEY, remove list endpoints"
```

---

## Task 11: Frontend dependency + API types

**Files:**
- Modify: `frontend/package.json` (via pnpm), `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the graph rendering dependency**

Run: `cd frontend && pnpm add react-force-graph-2d && cd ..`
Expected: `react-force-graph-2d` added to `dependencies` in `frontend/package.json`.

- [ ] **Step 2: Add graph types to `api.ts`**

In `frontend/src/lib/api.ts`, after the `ListenRecommended` interface, add:

```ts
/* ── Listens graph ─────────────────────────────────────── */

export type GraphNodeType = "artist" | "album" | "track";
export type GraphEdgeType = "similar_artist" | "similar_track" | "colisten" | "structural";

export interface GraphNode {
  key: string;
  node_type: GraphNodeType;
  title: string;
  subtitle: string;
  thumbnail_url: string;
  video_id: string;
  play_count: number;
  is_liked: boolean;
  is_subscribed: boolean;
  in_library: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  edge_type: GraphEdgeType;
  weight: number;
}

export interface GraphPatch {
  seed: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphSearchResult {
  key: string;
  node_type: GraphNodeType;
  title: string;
  subtitle: string;
  thumbnail_url: string;
}
```

> **Note:** You may delete the now-unused `ListenTopTrack`, `ListenTopArtist`, `ListenTopAlbum`, `ListenRecommended` interfaces once Task 13 removes their consumers. If unsure, leave them — they're harmless.

- [ ] **Step 3: Verify the build still type-checks**

Run: `cd frontend && pnpm lint && cd ..`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/lib/api.ts
git commit -m "feat: add react-force-graph-2d and graph API types"
```

---

## Task 12: Pure graph helpers (with tests)

**Files:**
- Create: `frontend/src/lib/graph.ts`, `frontend/src/lib/__tests__/graph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/__tests__/graph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { edgeColor, edgeDashed, nodeRadius, toForceData } from "../graph";
import type { GraphPatch } from "../api";

describe("nodeRadius", () => {
  it("grows with play count and is capped", () => {
    expect(nodeRadius(0)).toBeGreaterThan(0);
    expect(nodeRadius(100)).toBeGreaterThan(nodeRadius(1));
    expect(nodeRadius(1_000_000)).toBeLessThanOrEqual(26);
  });
});

describe("edge styling", () => {
  it("colors similarity edges accent, structural faint", () => {
    expect(edgeColor("similar_artist")).toContain("249,115,22");
    expect(edgeColor("structural")).toContain("255,255,255");
  });
  it("dashes structural and colisten edges only", () => {
    expect(edgeDashed("structural")).toBe(true);
    expect(edgeDashed("colisten")).toBe(true);
    expect(edgeDashed("similar_track")).toBe(false);
  });
});

describe("toForceData", () => {
  const patch: GraphPatch = {
    seed: "v1",
    nodes: [
      { key: "v1", node_type: "track", title: "A", subtitle: "", thumbnail_url: "",
        video_id: "v1", play_count: 3, is_liked: false, is_subscribed: false, in_library: false },
      { key: "radiohead", node_type: "artist", title: "Radiohead", subtitle: "", thumbnail_url: "",
        video_id: "", play_count: 3, is_liked: false, is_subscribed: false, in_library: false },
    ],
    edges: [
      { source: "v1", target: "radiohead", edge_type: "structural", weight: 0.5 },
      { source: "v1", target: "ghost", edge_type: "similar_track", weight: 0.9 }, // dangling
    ],
  };
  it("maps keys to ids and drops edges to missing nodes", () => {
    const data = toForceData(patch);
    expect(data.nodes.map((n) => n.id)).toEqual(["v1", "radiohead"]);
    expect(data.links).toHaveLength(1);
    expect(data.links[0].source).toBe("v1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test -- graph.test.ts; cd ..`
Expected: FAIL — cannot resolve `../graph`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/graph.ts`:

```ts
import type { GraphEdgeType, GraphNode, GraphPatch } from "./api";

/** Node circle radius in px, scaled by play count and capped. */
export function nodeRadius(playCount: number): number {
  return Math.min(6 + Math.sqrt(Math.max(playCount, 0)) * 2, 26);
}

/** Accent for similarity edges, faint white for structural/co-listen. */
export function edgeColor(edgeType: GraphEdgeType): string {
  return edgeType === "similar_artist" || edgeType === "similar_track"
    ? "rgba(249,115,22,0.45)"
    : "rgba(255,255,255,0.12)";
}

/** Structural and co-listen edges render dashed; similarity edges solid. */
export function edgeDashed(edgeType: GraphEdgeType): boolean {
  return edgeType === "structural" || edgeType === "colisten";
}

export interface ForceNode extends GraphNode {
  id: string;
}

export interface ForceLink {
  source: string;
  target: string;
  edge_type: GraphEdgeType;
  weight: number;
}

/** Convert an API patch into react-force-graph's {nodes, links} shape. Drops dangling edges. */
export function toForceData(patch: GraphPatch): { nodes: ForceNode[]; links: ForceLink[] } {
  const keys = new Set(patch.nodes.map((n) => n.key));
  return {
    nodes: patch.nodes.map((n) => ({ ...n, id: n.key })),
    links: patch.edges
      .filter((e) => keys.has(e.source) && keys.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        edge_type: e.edge_type,
        weight: e.weight,
      })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && pnpm test -- graph.test.ts; cd ..`
Expected: PASS (3 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/graph.ts frontend/src/lib/__tests__/graph.test.ts
git commit -m "feat: pure graph helpers for node radius, edge style, force transform"
```

---

## Task 13: Graph page + layout shell + remove old pages

**Files:**
- Modify: `frontend/src/app/listens/page.tsx` (full rewrite)
- Modify: `frontend/src/app/listens/layout.tsx` (strip to thin shell)
- Delete: `frontend/src/app/listens/tracks/page.tsx`, `artists/page.tsx`, `albums/page.tsx`

- [ ] **Step 1: Delete the old list pages**

Run:
```bash
git rm frontend/src/app/listens/tracks/page.tsx \
       frontend/src/app/listens/artists/page.tsx \
       frontend/src/app/listens/albums/page.tsx
```

- [ ] **Step 2: Replace the layout with a thin shell**

Overwrite `frontend/src/app/listens/layout.tsx`:

```tsx
import type { ReactNode } from "react";

export default function ListensLayout({ children }: { children: ReactNode }) {
  return <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0.5rem 1rem 2rem" }}>{children}</div>;
}
```

- [ ] **Step 3: Write the graph page**

Overwrite `frontend/src/app/listens/page.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  API,
  type GraphPatch,
  type GraphSearchResult,
  type ListenStats,
  type ListenTrack,
} from "@/lib/api";
import { store } from "@/lib/auth";
import { edgeColor, edgeDashed, nodeRadius, toForceData, type ForceNode } from "@/lib/graph";
import { usePlayer } from "@/lib/player";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const ACCENT = "#f97316";

export default function ListensGraphPage() {
  const player = usePlayer();
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");
  const [patch, setPatch] = useState<GraphPatch | null>(null);
  const [stats, setStats] = useState<ListenStats | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GraphSearchResult[]>([]);
  const [selected, setSelected] = useState<ForceNode | null>(null);
  const fgRef = useRef<{ centerAt?: (x: number, y: number, ms: number) => void } | null>(null);

  const loadPatch = useCallback(async (seed?: string, type?: string) => {
    const qs = seed ? `?seed=${encodeURIComponent(seed)}&type=${type ?? ""}` : "";
    const data: GraphPatch = await fetch(`${API}/api/listens/graph/patch/${qs}`).then((r) => r.json());
    setPatch(data);
    setSelected(null);
  }, []);

  useEffect(() => {
    loadPatch();
    fetch(`${API}/api/listens/stats/`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, [loadPatch]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`${API}/api/listens/graph/search/?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.results || []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const playNode = (node: ForceNode) => {
    if (!isAdmin || !node.video_id) return;
    const track: ListenTrack = {
      id: 0,
      video_id: node.video_id,
      title: node.title,
      artist: node.subtitle || node.title,
      album: "",
      thumbnail_url: node.thumbnail_url,
      duration: "",
      played_at: "",
    };
    player.play(track, [track]);
  };

  const data = patch ? toForceData(patch) : { nodes: [], links: [] };

  return (
    <div style={{ position: "relative" }}>
      {/* Top bar: search + new patch */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 4px" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="⌕ jump to artist / track / album…"
            style={{
              width: "100%", background: "#161616", border: `1px solid rgba(249,115,22,0.3)`,
              borderRadius: 6, padding: "8px 12px", color: "#ddd", fontSize: 13,
              fontFamily: "monospace", outline: "none",
            }}
          />
          {results.length > 0 && (
            <div
              style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, marginTop: 4,
                background: "#141414", border: "1px solid rgba(249,115,22,0.3)", borderRadius: 6,
                overflow: "hidden",
              }}
            >
              {results.map((r) => (
                <div
                  key={`${r.node_type}:${r.key}`}
                  onClick={() => {
                    setQuery("");
                    setResults([]);
                    loadPatch(r.key, r.node_type);
                  }}
                  style={{ padding: "8px 12px", cursor: "pointer", color: "#ddd", fontSize: 12 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(249,115,22,0.1)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ color: ACCENT, fontSize: 9, fontFamily: "monospace" }}>
                    {r.node_type.toUpperCase()}
                  </span>{" "}
                  {r.title}
                  {r.subtitle ? <span style={{ color: "#666" }}> · {r.subtitle}</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => loadPatch()}
          style={{
            background: "rgba(249,115,22,0.12)", border: `1px solid ${ACCENT}`, borderRadius: 6,
            padding: "8px 14px", color: ACCENT, fontSize: 10, fontFamily: "monospace",
            letterSpacing: 1, cursor: "pointer",
          }}
        >
          ↻ NEW PATCH
        </button>
      </div>

      {/* Stat strip */}
      {stats && (
        <div style={{ display: "flex", gap: 22, padding: "4px 4px 10px", fontFamily: "monospace" }}>
          <span style={{ color: ACCENT, fontSize: 13 }}>
            {stats.total.toLocaleString()}
            <span style={{ color: "#666", fontSize: 8, letterSpacing: 1, marginLeft: 5 }}>TOTAL PLAYS</span>
          </span>
          <span style={{ color: ACCENT, fontSize: 13 }}>
            {stats.today}
            <span style={{ color: "#666", fontSize: 8, letterSpacing: 1, marginLeft: 5 }}>TODAY</span>
          </span>
          {patch?.seed && (
            <span style={{ color: "#888", fontSize: 11, marginLeft: "auto" }}>
              walking near · <span style={{ color: "#ccc" }}>{patch.seed}</span>
            </span>
          )}
        </div>
      )}

      {/* Graph canvas */}
      <div style={{ height: 540, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, overflow: "hidden", background: "#0a0a0a" }}>
        <ForceGraph2D
          ref={fgRef as never}
          graphData={data}
          backgroundColor="#0a0a0a"
          nodeRelSize={1}
          linkColor={(l: { edge_type: string }) => edgeColor(l.edge_type as never)}
          linkLineDash={(l: { edge_type: string }) => (edgeDashed(l.edge_type as never) ? [3, 3] : null)}
          linkWidth={(l: { edge_type: string; weight: number }) =>
            l.edge_type.startsWith("similar") ? 1 + l.weight * 1.5 : 0.8
          }
          onNodeClick={(node: ForceNode) => {
            setSelected(node);
          }}
          nodeCanvasObject={(node: ForceNode & { x: number; y: number }, ctx, scale) => {
            const r = nodeRadius(node.play_count);
            const isSeed = patch?.seed === node.key;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = isSeed ? ACCENT : "#a8480a";
            ctx.fill();
            if (node.is_liked) {
              ctx.strokeStyle = "#ffd400";
              ctx.lineWidth = 2 / scale;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI);
              ctx.stroke();
            }
            if (node.is_subscribed) {
              ctx.strokeStyle = ACCENT;
              ctx.setLineDash([2, 2]);
              ctx.lineWidth = 1.5 / scale;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI);
              ctx.stroke();
              ctx.setLineDash([]);
            }
            const label = node.title.length > 18 ? node.title.slice(0, 17) + "…" : node.title;
            ctx.font = `${10 / scale}px monospace`;
            ctx.fillStyle = "#ccc";
            ctx.textAlign = "center";
            ctx.fillText(label, node.x, node.y + r + 9 / scale);
          }}
        />
      </div>

      {/* Node detail / play card */}
      {selected && (
        <div
          style={{
            position: "absolute", right: 14, bottom: 14, width: 200, background: "#141414",
            border: `1px solid rgba(249,115,22,0.3)`, borderRadius: 8, padding: 10,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {selected.thumbnail_url ? (
              <img src={selected.thumbnail_url} alt="" style={{ width: 40, height: 40, borderRadius: 4, objectFit: "cover" }} />
            ) : (
              <div style={{ width: 40, height: 40, borderRadius: 4, background: "#c2540a" }} />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#eee", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {selected.title}
              </div>
              <div style={{ color: "#888", fontSize: 9 }}>
                {selected.subtitle || selected.node_type} · {selected.play_count}×
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
            {isAdmin && selected.video_id && (
              <button
                onClick={() => playNode(selected)}
                style={{
                  flex: 1, background: "rgba(249,115,22,0.15)", border: `1px solid ${ACCENT}`,
                  borderRadius: 5, padding: 5, color: ACCENT, fontSize: 9, fontFamily: "monospace",
                  letterSpacing: 1, cursor: "pointer",
                }}
              >
                ▶ PLAY
              </button>
            )}
            <button
              onClick={() => loadPatch(selected.key, selected.node_type)}
              style={{
                flex: 1, background: "#1d1d1d", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 5, padding: 5, color: "#aaa", fontSize: 9, fontFamily: "monospace",
                letterSpacing: 1, cursor: "pointer",
              }}
            >
              ⊙ CENTER
            </button>
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ padding: "10px 4px", color: "#666", fontSize: 9, fontFamily: "monospace" }}>
        ⬤ size = play count · <span style={{ color: "#ffd400" }}>◯</span> liked ·{" "}
        <span style={{ color: ACCENT }}>◌</span> subscribed · ▬ similar (Last.fm) · ┄ structural / co-listen
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Lint and type-check**

Run: `cd frontend && pnpm lint && cd ..`
Expected: no errors. If `react-force-graph-2d` lacks bundled types and ESLint flags `any`, narrow the prop callbacks as written (they already use minimal inline types) or add a one-line `// @ts-expect-error` only on the `ref` assignment if needed.

- [ ] **Step 5: Visual verification with Playwright**

Start dev servers (`make dev` or `cd frontend && pnpm dev`), seed some `ListenTrack` data + run `uv run python manage.py build_music_graph`, then load `http://localhost:3001/listens`. Take a Playwright screenshot. Verify: graph renders, "NEW PATCH" reshuffles, search dropdown appears and re-seeds, clicking a node shows the card, and (logged in as admin) PLAY works.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/listens/
git commit -m "feat: graph-based /listens page, remove list tab pages"
```

---

## Task 14: Documentation

**Files:**
- Modify: `docs/README.md`, `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Update README**

In `docs/README.md`, replace the Listens section's four-tab description with: the graph concept (nodes = tracks/artists/albums, edges = Last.fm similarity + your co-listen habits), recommendation-weighted "new patch" on refresh, search-to-region, click-to-walk, and admin playback.

- [ ] **Step 2: Update QA checklist**

In `docs/QA-CHECKLIST.md`, replace the old Listens list-tab items with:
- `/listens` graph renders with nodes and edges
- "NEW PATCH" loads a different neighborhood
- Search shows matches and selecting one re-seeds the graph
- Clicking a node opens the detail card; "CENTER" re-centers the walk
- Liked nodes show a yellow ring, subscribed artists a dashed ring
- Admin: "PLAY" on a track node plays via the miniplayer; logged-out users see no PLAY button

- [ ] **Step 3: Commit**

```bash
git add docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs: listens graph redesign README + QA checklist"
```

---

## Final Verification

- [ ] Run the full backend suite: `uv run pytest`
- [ ] Run the frontend suite: `cd frontend && pnpm test && pnpm lint && pnpm build; cd ..`
- [ ] Manual: with real `browser.json` + `LASTFM_API_KEY` set, run `uv run python manage.py build_music_graph` and confirm nodes/edges populate, then exercise the page per the QA checklist.

---

## Self-Review Notes (verified during planning)

- **Spec coverage:** affinity-primary + structural edges (Tasks 3, 5); Last.fm CF similarity (Tasks 4–5); co-listen personal layer (Task 3); YTM personalization tailoring (Tasks 6, 8); recommendation-weighted patch reveal (Tasks 6–7); search-to-region (Tasks 7, 9, 13); re-center walk + admin play (Task 13); full removal of list tabs (Tasks 10, 13); `LASTFM_API_KEY` (Task 10); tests + docs (throughout, Task 14). All spec sections map to tasks.
- **Type consistency:** `MusicNode`/`MusicEdge`/`LastfmCache` fields and the `build_graph`/`get_patch`/`search_nodes`/`apply_personalization` signatures are used identically across backend tasks; the API JSON shape (`{seed, nodes, edges}` / `{results}`) matches the frontend `GraphPatch`/`GraphSearchResult` types and `toForceData`.
- **No placeholders:** every code step contains complete, runnable code.
- **Deferred (explicitly out of scope, per spec):** Celery-beat automated rebuild and YTM re-auth UX remain future work; the manual sync path triggers the rebuild today.
