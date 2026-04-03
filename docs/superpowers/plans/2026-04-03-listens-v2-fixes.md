# Listens Page v2 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix layout/UX issues on the listens page, add a recommendation engine, clean up artist names, filter single-track albums, add Google Takeout import, and move the feedback button to bottom-left.

**Architecture:** Backend-first — add new endpoint + data migration, then update frontend components. Each task is independently testable. The recommendation endpoint is a new Django view using ORM aggregation. The Takeout import is a new admin-only file upload endpoint. Frontend changes are CSS/layout fixes in existing components.

**Tech Stack:** Django 6.0, PostgreSQL, Redis caching, Next.js 16, React 19, TypeScript, inline styles

---

## File Structure

**Backend — create:**
- `website/migrations/0015_clean_artist_view_counts.py` — data migration to strip view counts from artist names

**Backend — modify:**
- `website/views/listen.py` — add `listen_recommended` view, add `listen_import` view, fix artist parsing in `listen_sync`, add 2+ track filter to `listen_top_albums`
- `website/views/__init__.py` — export new views
- `website/urls.py` — add new URL routes
- `website/tests/test_listen.py` — add tests for new endpoints and fixes

**Frontend — modify:**
- `frontend/src/lib/api.ts` — add `ListenRecommended` type
- `frontend/src/app/listens/layout.tsx` — replace "Latest" with "Recommended", constrain "Top this month" carousel, reduce spacing
- `frontend/src/app/listens/page.tsx` — change page size to 20, add section transparency panel
- `frontend/src/app/listens/tracks/page.tsx` — add text truncation to artist line
- `frontend/src/app/listens/artists/page.tsx` — (already has truncation, no changes needed)
- `frontend/src/app/listens/albums/page.tsx` — (already has truncation, no changes needed)
- `frontend/src/components/FeedbackButton.tsx` — move from bottom-right to bottom-left

---

### Task 1: Fix artist name parsing in sync + data migration

**Files:**
- Modify: `website/views/listen.py:86-93`
- Create: `website/migrations/0015_clean_artist_view_counts.py`
- Modify: `website/tests/test_listen.py:34-51`

- [ ] **Step 1: Write failing test for artist name cleanup during sync**

Add to `website/tests/test_listen.py` — a new test inside `TestListenSync`:

```python
    @patch("os.path.isfile", return_value=True)
    @patch("ytmusicapi.YTMusic")
    def test_filters_view_counts_from_artist(self, mock_ytmusic_cls, _mock_isfile, client, auth_headers):
        mock_yt = MagicMock()
        mock_yt.get_history.return_value = [
            {
                "videoId": "grissini1",
                "title": "Some Song",
                "artists": [{"name": "Grissini Project"}, {"name": "89M views"}],
                "album": {"name": "Album"},
                "thumbnails": [{"url": "https://example.com/thumb.jpg", "width": 226}],
                "duration": "3:00",
            },
            {
                "videoId": "grissini2",
                "title": "Another Song",
                "artists": [{"name": "Grissini Project"}, {"name": "1.9M views"}],
                "album": None,
                "thumbnails": [],
                "duration": "4:00",
            },
        ]
        mock_ytmusic_cls.return_value = mock_yt

        resp = client.post("/api/listens/sync/", **auth_headers)
        assert resp.status_code == 200
        assert resp.json()["synced"] == 2
        assert ListenTrack.objects.get(video_id="grissini1").artist == "Grissini Project"
        assert ListenTrack.objects.get(video_id="grissini2").artist == "Grissini Project"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_listen.py::TestListenSync::test_filters_view_counts_from_artist -v`
Expected: FAIL — artist will be `"Grissini Project, 89M views"` instead of `"Grissini Project"`

- [ ] **Step 3: Implement artist name cleanup in sync**

In `website/views/listen.py`, add the regex import and constant at the top (after line 14):

```python
import re

VIEW_COUNT_RE = re.compile(r"^\d+\.?\d*\s*[MKBmkb]?\s*views?$", re.IGNORECASE)
```

Then replace the artist parsing block (lines 92-93):

```python
        # Old:
        # artists = item.get("artists", [])
        # artist_name = ", ".join(a.get("name", "") for a in artists) if artists else "Unknown"

        # New:
        artists = item.get("artists", [])
        artist_names = [
            a.get("name", "")
            for a in artists
            if a.get("name") and not VIEW_COUNT_RE.match(a.get("name", ""))
        ]
        artist_name = ", ".join(artist_names) if artist_names else "Unknown"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_listen.py::TestListenSync::test_filters_view_counts_from_artist -v`
Expected: PASS

- [ ] **Step 5: Update existing sync test assertion**

The existing `test_syncs_tracks` test has `MOCK_HISTORY` that doesn't contain view counts, so it should still pass. Verify:

Run: `uv run pytest website/tests/test_listen.py::TestListenSync -v`
Expected: All tests PASS

- [ ] **Step 6: Write the data migration**

Create `website/migrations/0015_clean_artist_view_counts.py`:

```python
import re

from django.db import migrations

VIEW_COUNT_RE = re.compile(r",?\s*\d+\.?\d*\s*[MKBmkb]?\s*views?", re.IGNORECASE)


def clean_artist_names(apps, schema_editor):
    ListenTrack = apps.get_model("website", "ListenTrack")
    tracks = ListenTrack.objects.filter(artist__iregex=r"\d+\.?\d*\s*[MKBmkb]?\s*views?")
    updated = []
    for track in tracks:
        cleaned = VIEW_COUNT_RE.sub("", track.artist).strip().strip(",").strip()
        if cleaned and cleaned != track.artist:
            track.artist = cleaned
            updated.append(track)
    if updated:
        ListenTrack.objects.bulk_update(updated, ["artist"], batch_size=500)


class Migration(migrations.Migration):
    dependencies = [
        ("website", "0014_lichesstoken"),
    ]

    operations = [
        migrations.RunPython(clean_artist_names, migrations.RunPython.noop),
    ]
```

- [ ] **Step 7: Test the migration runs**

Run: `uv run python manage.py migrate --run-syncdb`
Expected: Migration 0015 applies successfully

- [ ] **Step 8: Commit**

```bash
git add website/views/listen.py website/migrations/0015_clean_artist_view_counts.py website/tests/test_listen.py
git commit -m "fix: strip view count strings from artist names during sync

Filters out YouTube Music API artifacts like '89M views' from artist
arrays before joining. Includes data migration to clean existing records."
```

---

### Task 2: Add recommendation endpoint

**Files:**
- Modify: `website/views/listen.py`
- Modify: `website/views/__init__.py:10-18`
- Modify: `website/urls.py:25-31`
- Modify: `website/tests/test_listen.py`

- [ ] **Step 1: Write failing tests for recommendation endpoint**

Add to `website/tests/test_listen.py`:

```python
@pytest.mark.django_db
class TestListenRecommended:
    def test_empty_db(self, client):
        resp = client.get("/api/listens/recommended/")
        assert resp.status_code == 200
        assert resp.json()["track"] is None

    def test_returns_rediscovery_track(self, client, db):
        """Tracks played often but not recently should be recommended."""
        now = timezone.now()
        # Track played 10 times, last play 20 days ago — good candidate
        for i in range(10):
            ListenTrack.objects.create(
                video_id="rediscover",
                title="Old Favorite",
                artist="Artist A",
                album="Album A",
                thumbnail_url="https://example.com/thumb.jpg",
                played_at=now - timezone.timedelta(days=20 + i),
            )
        # Track played 2 times, last play 1 day ago — too recent
        for i in range(2):
            ListenTrack.objects.create(
                video_id="recent",
                title="Recent Song",
                artist="Artist B",
                played_at=now - timezone.timedelta(days=i),
            )
        resp = client.get("/api/listens/recommended/")
        data = resp.json()
        assert data["track"] is not None
        assert data["track"]["video_id"] == "rediscover"

    def test_fallback_to_most_played(self, client, db):
        """When no tracks qualify for rediscovery, return most played."""
        now = timezone.now()
        # All tracks are recent — none qualify for 14-day rediscovery
        for i in range(5):
            ListenTrack.objects.create(
                video_id="popular",
                title="Popular Song",
                artist="Artist",
                played_at=now - timezone.timedelta(hours=i),
            )
        ListenTrack.objects.create(
            video_id="less_popular",
            title="Less Popular",
            artist="Artist",
            played_at=now - timezone.timedelta(hours=10),
        )
        resp = client.get("/api/listens/recommended/")
        data = resp.json()
        assert data["track"] is not None
        assert data["track"]["video_id"] == "popular"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_listen.py::TestListenRecommended -v`
Expected: FAIL — URL not found (404)

- [ ] **Step 3: Implement the recommendation view**

Add to `website/views/listen.py` (after `listen_stats` function, around line 163):

```python
import random


@require_GET
def listen_recommended(_request):
    """Return a single recommended track using rediscovery algorithm."""
    cached = redis_cache.get("listen_recommended")
    if cached:
        return JsonResponse(cached)

    total_tracks = (
        ListenTrack.objects.values("video_id")
        .annotate(play_count=Count("id"))
        .count()
    )
    if total_tracks == 0:
        result = {"track": None}
        redis_cache.set("listen_recommended", result, 3600)
        return JsonResponse(result)

    # Find tracks in top 25% by play count not played in last 14 days
    cutoff = timezone.now() - timezone.timedelta(days=14)
    from django.db.models import Max

    candidates = (
        ListenTrack.objects.values("video_id", "title", "artist", "album", "thumbnail_url")
        .annotate(
            play_count=Count("id"),
            last_played=Max("played_at"),
        )
        .filter(last_played__lt=cutoff)
        .order_by("-play_count")
    )

    # Determine top-25% threshold
    all_play_counts = list(
        ListenTrack.objects.values("video_id")
        .annotate(play_count=Count("id"))
        .order_by("-play_count")
        .values_list("play_count", flat=True)
    )
    if all_play_counts:
        threshold_idx = max(0, len(all_play_counts) // 4 - 1)
        threshold = all_play_counts[threshold_idx]
        candidates = candidates.filter(play_count__gte=threshold)

    candidates = list(candidates[:50])

    if candidates:
        # Weighted random: play_count * days_since_last_play
        now = timezone.now()
        weights = []
        for c in candidates:
            days_since = (now - c["last_played"]).days
            weights.append(c["play_count"] * max(days_since, 1))
        pick = random.choices(candidates, weights=weights, k=1)[0]
    else:
        # Fallback: most played track overall
        pick = (
            ListenTrack.objects.values("video_id", "title", "artist", "album", "thumbnail_url")
            .annotate(play_count=Count("id"), last_played=Max("played_at"))
            .order_by("-play_count")
            .first()
        )

    if pick:
        track = {
            "video_id": pick["video_id"],
            "title": pick["title"],
            "artist": pick["artist"],
            "album": pick["album"],
            "thumbnail_url": pick["thumbnail_url"],
            "play_count": pick["play_count"],
            "last_played": pick["last_played"].isoformat() if pick["last_played"] else None,
        }
    else:
        track = None

    result = {"track": track}
    redis_cache.set("listen_recommended", result, 3600)
    return JsonResponse(result)
```

- [ ] **Step 4: Register the URL and export**

In `website/urls.py`, add before the `listens/` catch-all (before line 28):

```python
    path("listens/recommended/", views.listen_recommended),
```

In `website/views/__init__.py`, add `listen_recommended` to the import from `.listen` and to `__all__`:

```python
from .listen import (
    listen_list,
    listen_recommended,
    listen_stats,
    listen_sync,
    listen_sync_status,
    listen_top_albums,
    listen_top_artists,
    listen_top_tracks,
)
```

Add `"listen_recommended"` to `__all__` list (alphabetically after `"listen_list"`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_listen.py::TestListenRecommended -v`
Expected: All PASS

- [ ] **Step 6: Run full test suite**

Run: `uv run pytest website/tests/test_listen.py -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add website/views/listen.py website/views/__init__.py website/urls.py website/tests/test_listen.py
git commit -m "feat: add rediscovery recommendation endpoint

GET /api/listens/recommended/ returns a single track that was played
often in the past but not recently. Weighted random selection based
on play count and days since last play. Cached for 1 hour."
```

---

### Task 3: Add albums 2+ track filter

**Files:**
- Modify: `website/views/listen.py:220-232`
- Modify: `website/tests/test_listen.py`

- [ ] **Step 1: Write failing test for 2+ track filter**

Add to `TestListenTopAlbums` in `website/tests/test_listen.py`:

```python
    def test_excludes_single_track_albums(self, client, db):
        """Albums with only 1 unique track should be excluded."""
        now = timezone.now()
        # Album with 2 tracks — should be included
        ListenTrack.objects.create(
            video_id="multi1", title="Song 1", artist="Band", album="Multi Album",
            played_at=now,
        )
        ListenTrack.objects.create(
            video_id="multi2", title="Song 2", artist="Band", album="Multi Album",
            played_at=now - timezone.timedelta(hours=1),
        )
        # Album with 1 track — should be excluded
        ListenTrack.objects.create(
            video_id="single1", title="Only Song", artist="Solo", album="Single Album",
            played_at=now - timezone.timedelta(hours=2),
        )
        resp = client.get("/api/listens/albums/")
        data = resp.json()
        album_names = [a["name"] for a in data["albums"]]
        assert "Multi Album" in album_names
        assert "Single Album" not in album_names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest website/tests/test_listen.py::TestListenTopAlbums::test_excludes_single_track_albums -v`
Expected: FAIL — "Single Album" will be in the results

- [ ] **Step 3: Add filter to listen_top_albums view**

In `website/views/listen.py`, modify `listen_top_albums` (around line 228). After the `.annotate(...)` call, add `.filter(track_count__gte=2)`:

```python
    albums = (
        ListenTrack.objects.exclude(album="")
        .values("album", "artist")
        .annotate(
            play_count=Count("id"),
            track_count=Count("video_id", distinct=True),
        )
        .filter(track_count__gte=2)
        .order_by("-play_count")
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest website/tests/test_listen.py::TestListenTopAlbums::test_excludes_single_track_albums -v`
Expected: PASS

- [ ] **Step 5: Fix the existing `test_ranked` test**

The existing `test_ranked` test creates albums — `sample_tracks` creates 5 tracks each with a unique album (`Album 0` through `Album 4`) — all with 1 track each. Then it adds 2 tracks for "Album One" (2 tracks) and 1 for "Album Two" (1 track). With the new filter, only "Album One" will show (plus `sample_tracks` albums are now filtered out). Update the assertion:

The existing test creates:
- `sample_tracks`: 5 albums each with 1 track (filtered out by new rule)
- `Album One` by `Band X`: 2 tracks (included)
- `Album Two` by `Band Y`: 1 track (filtered out)

So we need to fix the test to add a second track to `Album Two` so it's included, or just assert `Album One` is first and total reflects the filter. Simplest fix — update the test:

```python
    def test_ranked(self, client, sample_tracks):  # noqa: ARG002
        ListenTrack.objects.create(
            video_id="alb1",
            title="Song A",
            artist="Band X",
            album="Album One",
            played_at=timezone.now(),
        )
        ListenTrack.objects.create(
            video_id="alb2",
            title="Song B",
            artist="Band X",
            album="Album One",
            played_at=timezone.now(),
        )
        ListenTrack.objects.create(
            video_id="alb3",
            title="Song C",
            artist="Band Y",
            album="Album Two",
            played_at=timezone.now(),
        )
        ListenTrack.objects.create(
            video_id="alb4",
            title="Song D",
            artist="Band Y",
            album="Album Two",
            played_at=timezone.now(),
        )
        resp = client.get("/api/listens/albums/")
        data = resp.json()
        assert data["albums"][0]["name"] == "Album One"
        assert data["albums"][0]["play_count"] == 2
        assert data["albums"][0]["artist"] == "Band X"
```

- [ ] **Step 6: Run all album tests**

Run: `uv run pytest website/tests/test_listen.py::TestListenTopAlbums -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add website/views/listen.py website/tests/test_listen.py
git commit -m "fix: filter out single-track albums from albums view

Albums with only 1 unique track are effectively singles. Filter
them out so the albums page shows only real albums (2+ tracks)."
```

---

### Task 4: Add Google Takeout import endpoint

**Files:**
- Modify: `website/views/listen.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`
- Modify: `website/tests/test_listen.py`

- [ ] **Step 1: Write failing tests for import endpoint**

Add to `website/tests/test_listen.py`:

```python
import json
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile


TAKEOUT_SAMPLE = [
    {
        "header": "YouTube Music",
        "title": "Watched Cool Song",
        "titleUrl": "https://www.youtube.com/watch?v=takeout1",
        "subtitles": [{"name": "Cool Artist", "url": "https://youtube.com/channel/123"}],
        "time": "2024-06-15T10:30:00.000Z",
        "products": ["YouTube Music"],
    },
    {
        "header": "YouTube Music",
        "title": "Watched Another Track",
        "titleUrl": "https://www.youtube.com/watch?v=takeout2",
        "subtitles": [{"name": "Another Artist"}],
        "time": "2024-06-14T08:00:00.000Z",
        "products": ["YouTube Music"],
    },
    {
        "header": "YouTube",
        "title": "Watched Some Video",
        "titleUrl": "https://www.youtube.com/watch?v=nomusic",
        "subtitles": [{"name": "Youtuber"}],
        "time": "2024-06-13T12:00:00.000Z",
        "products": ["YouTube"],
    },
]


@pytest.mark.django_db
class TestListenImport:
    def test_requires_auth(self, client):
        resp = client.post("/api/listens/import/")
        assert resp.status_code == 401

    def test_imports_takeout(self, client, auth_headers):
        data = json.dumps(TAKEOUT_SAMPLE).encode()
        file = SimpleUploadedFile("watch-history.json", data, content_type="application/json")
        resp = client.post("/api/listens/import/", {"file": file}, **auth_headers)
        assert resp.status_code == 200
        result = resp.json()
        assert result["imported"] == 2  # only YouTube Music entries
        assert result["skipped"] == 0
        assert ListenTrack.objects.count() == 2
        t = ListenTrack.objects.get(video_id="takeout1")
        assert t.title == "Cool Song"
        assert t.artist == "Cool Artist"
        assert "nomusic" not in ListenTrack.objects.values_list("video_id", flat=True)

    def test_deduplicates(self, client, auth_headers):
        # Pre-existing track
        from django.utils.dateparse import parse_datetime
        ListenTrack.objects.create(
            video_id="takeout1",
            title="Cool Song",
            artist="Cool Artist",
            played_at=parse_datetime("2024-06-15T10:30:00+00:00"),
        )
        data = json.dumps(TAKEOUT_SAMPLE).encode()
        file = SimpleUploadedFile("watch-history.json", data, content_type="application/json")
        resp = client.post("/api/listens/import/", {"file": file}, **auth_headers)
        result = resp.json()
        assert result["imported"] == 1
        assert result["skipped"] == 1
        assert ListenTrack.objects.count() == 2

    def test_no_file(self, client, auth_headers):
        resp = client.post("/api/listens/import/", **auth_headers)
        assert resp.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_listen.py::TestListenImport -v`
Expected: FAIL — URL not found (404)

- [ ] **Step 3: Implement the import view**

Add to `website/views/listen.py`:

```python
import json as json_lib
from datetime import timedelta as td
from django.utils.dateparse import parse_datetime


@csrf_exempt
@require_admin
def listen_import(request):
    """Import listening history from Google Takeout watch-history.json."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"error": "No file uploaded. Send as multipart with field name 'file'."}, status=400)

    try:
        raw = json_lib.loads(uploaded.read().decode("utf-8"))
    except (json_lib.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON file"}, status=400)

    if not isinstance(raw, list):
        return JsonResponse({"error": "Expected a JSON array"}, status=400)

    # Filter to YouTube Music entries only
    entries = [e for e in raw if "YouTube Music" in (e.get("products") or [])]

    imported = 0
    skipped = 0
    batch = []

    for entry in entries:
        title_url = entry.get("titleUrl", "")
        if "watch?v=" not in title_url:
            skipped += 1
            continue

        video_id = title_url.split("watch?v=")[-1].split("&")[0]
        title = entry.get("title", "")
        if title.startswith("Watched "):
            title = title[8:]

        subtitles = entry.get("subtitles") or []
        artist = subtitles[0].get("name", "Unknown") if subtitles else "Unknown"

        time_str = entry.get("time", "")
        played_at = parse_datetime(time_str)
        if not played_at or not video_id:
            skipped += 1
            continue

        # Dedup: check if (video_id, played_at) exists within 60s tolerance
        exists = ListenTrack.objects.filter(
            video_id=video_id,
            played_at__gte=played_at - td(seconds=60),
            played_at__lte=played_at + td(seconds=60),
        ).exists()

        if exists:
            skipped += 1
            continue

        batch.append(
            ListenTrack(
                video_id=video_id,
                title=title,
                artist=artist,
                album="",
                thumbnail_url="",
                duration="",
                played_at=played_at,
            )
        )

        if len(batch) >= 500:
            ListenTrack.objects.bulk_create(batch)
            imported += len(batch)
            batch = []

    if batch:
        ListenTrack.objects.bulk_create(batch)
        imported += len(batch)

    return JsonResponse({"imported": imported, "skipped": skipped})
```

- [ ] **Step 4: Register URL and export**

In `website/urls.py`, add before the `listens/` catch-all:

```python
    path("listens/import/", views.listen_import),
```

In `website/views/__init__.py`, add `listen_import` to the import from `.listen` and to `__all__`:

```python
from .listen import (
    listen_import,
    listen_list,
    listen_recommended,
    listen_stats,
    listen_sync,
    listen_sync_status,
    listen_top_albums,
    listen_top_artists,
    listen_top_tracks,
)
```

Add `"listen_import"` to `__all__` list.

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_listen.py::TestListenImport -v`
Expected: All PASS

- [ ] **Step 6: Run full backend test suite**

Run: `uv run pytest -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add website/views/listen.py website/views/__init__.py website/urls.py website/tests/test_listen.py
git commit -m "feat: add Google Takeout import endpoint for listening history

POST /api/listens/import/ accepts a watch-history.json file from
Google Takeout. Filters to YouTube Music entries, strips 'Watched '
prefix, deduplicates within 60s tolerance. Admin-only."
```

---

### Task 5: Move feedback button to bottom-left

**Files:**
- Modify: `frontend/src/components/FeedbackButton.tsx:116-119`

- [ ] **Step 1: Change position from right to left**

In `frontend/src/components/FeedbackButton.tsx`, change the wrapper positioning (line 118):

Old:
```tsx
          right: "1.5rem",
```

New:
```tsx
          left: "1.5rem",
```

- [ ] **Step 2: Verify visually**

Run: `pnpm dev` (in frontend/) and check the feedback button appears at bottom-left on any page.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FeedbackButton.tsx
git commit -m "fix: move feedback button to bottom-left

Makes room for the music miniplayer at bottom-right."
```

---

### Task 6: Frontend — add ListenRecommended type

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the TypeScript interface**

In `frontend/src/lib/api.ts`, after the `ListenTopAlbum` interface (after line 87):

```typescript
export interface ListenRecommended {
  video_id: string;
  title: string;
  artist: string;
  album: string;
  thumbnail_url: string;
  play_count: number;
  last_played: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add ListenRecommended TypeScript interface"
```

---

### Task 7: Frontend — hero redesign (replace Latest with Recommended, constrain carousel)

**Files:**
- Modify: `frontend/src/app/listens/layout.tsx`

- [ ] **Step 1: Update imports and state**

In `frontend/src/app/listens/layout.tsx`, update the import line (line 6):

```tsx
import { API, type ListenTrack, type ListenStats, type ListenRecommended } from "@/lib/api";
```

Replace the `tracks` state (line 27) with a recommended state:

Old:
```tsx
  const [tracks, setTracks] = useState<ListenTrack[]>([]);
```
New:
```tsx
  const [recommended, setRecommended] = useState<ListenRecommended | null>(null);
```

- [ ] **Step 2: Update the useEffect data fetch**

Replace the useEffect (lines 31-39):

```tsx
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/listens/recommended/`).then((r) => r.json()),
      fetch(`${API}/api/listens/stats/`).then((r) => r.json()),
    ]).then(([recData, statsData]) => {
      setRecommended(recData.track || null);
      setStats(statsData);
    });
  }, []);
```

Remove the `latest` variable (line 41): `const latest = tracks[0];`

- [ ] **Step 3: Replace the "LATEST" section with "RECOMMENDED"**

Replace the entire "Latest" block (lines 101-194) with:

```tsx
          {/* Recommended */}
          <div
            style={{
              color: ACCENT,
              fontSize: 10,
              letterSpacing: 2,
              fontFamily: "monospace",
              marginBottom: 12,
            }}
          >
            RECOMMENDED
          </div>
          {recommended ? (
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "center",
                marginBottom: 24,
              }}
            >
              {recommended.thumbnail_url ? (
                <img
                  src={recommended.thumbnail_url}
                  alt=""
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 6,
                    objectFit: "cover",
                    aspectRatio: "1/1",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 6,
                    background: ACCENT,
                    opacity: 0.4,
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    color: "#eee",
                    fontSize: 18,
                    fontFamily: "var(--font-headline)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {recommended.title}
                </div>
                <div
                  style={{
                    color: "#999",
                    fontSize: 13,
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {recommended.artist}
                  {recommended.album ? ` — ${recommended.album}` : ""}
                </div>
                <div
                  style={{
                    color: "#555",
                    fontSize: 11,
                    marginTop: 4,
                    fontFamily: "monospace",
                  }}
                >
                  {recommended.play_count}× played
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() =>
                    player.play({
                      id: 0,
                      video_id: recommended.video_id,
                      title: recommended.title,
                      artist: recommended.artist,
                      album: recommended.album,
                      thumbnail_url: recommended.thumbnail_url,
                      duration: "",
                      played_at: "",
                    })
                  }
                  style={{
                    background: "none",
                    border: `1px solid ${ACCENT}`,
                    color: ACCENT,
                    borderRadius: 4,
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  ▶
                </button>
              )}
            </div>
          ) : (
            <div style={{ color: "#555", marginBottom: 24 }}>
              Not enough data for recommendations yet.
            </div>
          )}
```

- [ ] **Step 4: Constrain "Top This Month" carousel**

Replace the top tracks carousel section (lines 197-284). The key changes:
- Limit to 6 cards with `.slice(0, 6)`
- Fixed 80x80 thumbnails
- Add `flexWrap: "wrap"` instead of `overflowX: "auto"` so no scrollbar needed
- Add text truncation to artist line

```tsx
          {/* Top This Month */}
          {topTracks.length > 0 && (
            <>
              <div
                style={{
                  color: ACCENT,
                  fontSize: 10,
                  letterSpacing: 1,
                  fontFamily: "monospace",
                  marginBottom: 10,
                }}
              >
                TOP THIS MONTH
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                {topTracks.slice(0, 6).map((t, i) => (
                  <div
                    key={t.video_id}
                    style={{
                      flex: "0 0 auto",
                      width: 96,
                      background: "rgba(20,20,20,0.6)",
                      borderRadius: 6,
                      padding: 8,
                      border: "1px solid rgba(255,255,255,0.05)",
                      cursor: isAdmin ? "pointer" : "default",
                      overflow: "hidden",
                    }}
                    onClick={() => {
                      if (!isAdmin) return;
                      const queue: ListenTrack[] = topTracks.slice(0, 6).map((tt) => ({
                        id: 0,
                        video_id: tt.video_id,
                        title: tt.title,
                        artist: tt.artist,
                        album: "",
                        thumbnail_url: tt.thumbnail_url,
                        duration: "",
                        played_at: "",
                      }));
                      player.play(queue[i], queue);
                    }}
                  >
                    {t.thumbnail_url ? (
                      <img
                        src={t.thumbnail_url}
                        alt=""
                        style={{
                          width: 80,
                          height: 80,
                          borderRadius: 4,
                          objectFit: "cover",
                          aspectRatio: "1/1",
                          marginBottom: 6,
                          display: "block",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 80,
                          height: 80,
                          borderRadius: 4,
                          background: "#1a1a1a",
                          marginBottom: 6,
                        }}
                      />
                    )}
                    <div
                      style={{
                        color: "#ccc",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.title}
                    </div>
                    <div
                      style={{
                        color: "#666",
                        fontSize: 9,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.artist} · {t.play_count}×
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
```

- [ ] **Step 5: Reduce spacing between hero and tab content**

Change the `marginTop` on the tab bar (line 531) and the sub-route content container (line 568).

Tab bar — already `marginTop: 1`, that's fine.

The gap is actually the hero's `marginBottom`. Change the hero grid container (line 90):

Old: `marginBottom: 0,`
This is already 0, so the gap must be from padding. Check: the sub-route content div (line 568) has `marginTop: 1` — that's fine.

Actually the visual gap comes from the hero's internal padding and the content below. The key fix: make the tab bar and content visually attached to the hero by removing any gap. Current code already has `marginTop: 1` (1px) for the tab bar — that's correct. The `marginBottom: 0` on the hero grid is correct too.

The real issue from the screenshots is the padding at the top of the page container. Change the container padding (line 49):

Old: `padding: "1rem 1.5rem 2rem",`
New: `padding: "0.5rem 1.5rem 2rem",`

This brings the hero closer to the nav bar, reducing perceived vertical spacing.

- [ ] **Step 6: Verify visually**

Run: `pnpm dev` and check:
- "RECOMMENDED" shows instead of "LATEST"
- Top this month carousel is constrained to max 6 small cards
- Spacing is tighter between hero and content

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/listens/layout.tsx
git commit -m "feat: replace Latest with Recommended in hero, constrain carousel

Hero now shows a recommended rediscovery track instead of the last
played track. Top this month carousel limited to 6 cards with fixed
80x80 thumbnails. Reduced top padding."
```

---

### Task 8: Frontend — history page fixes (page size, transparency)

**Files:**
- Modify: `frontend/src/app/listens/page.tsx`

- [ ] **Step 1: Change page size and add artist truncation**

In `frontend/src/app/listens/page.tsx`:

Change `PAGE_SIZE` (line 13):
```tsx
const PAGE_SIZE = 20;
```

Add text truncation to the artist line inside the track card (line 106). Change:

Old:
```tsx
              <div style={{ color: "#666", fontSize: 10 }}>{track.artist}</div>
```
New:
```tsx
              <div style={{ color: "#666", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.artist}</div>
```

- [ ] **Step 2: Verify visually**

Run: `pnpm dev` and check:
- History loads 20 items initially
- "Load more" fetches next 20
- Artist names are truncated with ellipsis
- The panel background is already applied (line 71 already has `PANEL_BG` and `backdropFilter`)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/listens/page.tsx
git commit -m "fix: reduce history page size to 20, truncate artist names"
```

---

### Task 9: Frontend — tracks page artist truncation

**Files:**
- Modify: `frontend/src/app/listens/tracks/page.tsx:122`

- [ ] **Step 1: Add ellipsis truncation to artist line**

In `frontend/src/app/listens/tracks/page.tsx`, change the artist div (line 122):

Old:
```tsx
              <div style={{ color: "#666", fontSize: 10 }}>{track.artist}</div>
```
New:
```tsx
              <div style={{ color: "#666", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.artist}</div>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/listens/tracks/page.tsx
git commit -m "fix: truncate artist names on tracks page"
```

---

### Task 10: Update CLAUDE.md, docs, and QA checklist

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/README.md`
- Modify: `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Add new endpoints to CLAUDE.md**

In `CLAUDE.md`, add to the API Endpoints section under the listens block:

```
GET  /api/listens/recommended/  recommended track (rediscovery algorithm)
POST /api/listens/import/       auth required, Google Takeout file upload
```

- [ ] **Step 2: Update docs/README.md**

Add mention of the recommendation feature and Takeout import to the Listens section description.

- [ ] **Step 3: Add QA items to docs/QA-CHECKLIST.md**

Add checklist items:
- Verify recommendation displays in hero
- Verify artist names don't contain view counts
- Verify albums page only shows 2+ track albums
- Verify history page loads 20 items with Load More
- Verify feedback button is at bottom-left
- Verify Top This Month carousel is constrained to 6 items

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs: update API endpoints, README, and QA checklist for listens v2"
```

---

### Task 11: Final integration test

- [ ] **Step 1: Run full backend test suite**

Run: `uv run pytest -v`
Expected: All tests PASS

- [ ] **Step 2: Run frontend lint and tests**

Run: `cd frontend && pnpm lint && pnpm test`
Expected: No errors

- [ ] **Step 3: Run frontend build**

Run: `cd frontend && pnpm build`
Expected: Build succeeds with no type errors

- [ ] **Step 4: Visual verification**

Run `pnpm dev` and verify:
1. Hero shows "RECOMMENDED" instead of "LATEST"
2. Top This Month carousel has max 6 cards with 80x80 thumbnails
3. History loads 20 items, "Load More" works
4. All text truncated with ellipsis (no overflow)
5. Feedback button is at bottom-left
6. Content area has semi-transparent background
7. Albums page shows only multi-track albums

Take a Playwright screenshot for verification.
