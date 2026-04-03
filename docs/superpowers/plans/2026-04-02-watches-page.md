# Watches Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/watches` page that displays a curated glow grid of YouTube channels and standout videos, backed by Django models and a YouTube Data API sync.

**Architecture:** Two Django models (WatchChannel, WatchVideo) with YouTube OAuth sync following the existing listens pattern. Public API returns visible channels with pinned videos; admin API manages staging, tiers, and sync. Frontend is a React glow grid with expand-in-place video reveals and admin controls.

**Tech Stack:** Django 6.0, PostgreSQL, Redis (cache), YouTube Data API v3, Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-04-02-watches-page-design.md`

---

## File Structure

### Backend (create)
- `website/models/watch.py` — WatchChannel + WatchVideo models
- `website/views/watch.py` — all watches endpoints (public list, staging, tier/pin/delete, OAuth, sync)
- `website/tests/test_watch.py` — tests for all endpoints

### Backend (modify)
- `website/models/__init__.py` — add WatchChannel, WatchVideo exports
- `website/views/__init__.py` — add watch view exports
- `website/urls.py` — add `/watches/` URL patterns

### Frontend (modify)
- `frontend/src/app/watches/page.tsx` — full page rewrite: glow grid + admin controls
- `frontend/src/lib/api.ts` — add WatchChannel, WatchVideo types

---

## Task 1: Django Models

**Files:**
- Create: `website/models/watch.py`
- Modify: `website/models/__init__.py`
- Create: `website/tests/test_watch.py`

- [ ] **Step 1: Write the model file**

Create `website/models/watch.py`:

```python
from django.db import models


class WatchChannel(models.Model):
    """A YouTube channel the admin watches."""

    class Tier(models.TextChoices):
        HIDDEN = "hidden", "Hidden"
        NEVER_MISS = "never_miss", "Never Miss"
        REGULAR = "regular", "Regular Rotation"
        CHECK_OUT = "check_out", "Worth Checking Out"

    TIER_WEIGHT = {"never_miss": 0, "regular": 1, "check_out": 2, "hidden": 3}

    youtube_channel_id = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    thumbnail_url = models.URLField(max_length=1000, blank=True, default="")
    tier = models.CharField(max_length=16, choices=Tier.choices, default=Tier.HIDDEN)
    display_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["display_order", "name"]

    def __str__(self):
        return self.name

    @property
    def tier_weight(self):
        return self.TIER_WEIGHT.get(self.tier, 3)


class WatchVideo(models.Model):
    """A YouTube video (from liked videos) that can be pinned to a channel."""

    youtube_video_id = models.CharField(max_length=64, unique=True)
    channel = models.ForeignKey(
        WatchChannel, on_delete=models.SET_NULL, null=True, blank=True, related_name="videos"
    )
    title = models.CharField(max_length=300)
    thumbnail_url = models.URLField(max_length=1000, blank=True, default="")
    note = models.CharField(max_length=200, blank=True, default="")
    pinned = models.BooleanField(default=False)
    visible = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title
```

- [ ] **Step 2: Export models**

Add to `website/models/__init__.py`:

```python
from .watch import WatchChannel, WatchVideo
```

Add `"WatchChannel"` and `"WatchVideo"` to the `__all__` list.

- [ ] **Step 3: Create and apply migrations**

```bash
uv run python manage.py makemigrations website
uv run python manage.py migrate
```

- [ ] **Step 4: Write model tests**

Create `website/tests/test_watch.py`:

```python
import pytest

from website.models import WatchChannel, WatchVideo


@pytest.mark.django_db
class TestWatchChannel:
    def test_create_channel(self):
        ch = WatchChannel.objects.create(
            youtube_channel_id="UC1234",
            name="Test Channel",
            description="A test channel",
            thumbnail_url="https://yt3.ggpht.com/test",
        )
        assert ch.tier == "hidden"
        assert ch.display_order == 0
        assert str(ch) == "Test Channel"

    def test_tier_weight(self):
        ch = WatchChannel(tier="never_miss")
        assert ch.tier_weight == 0
        ch.tier = "regular"
        assert ch.tier_weight == 1
        ch.tier = "check_out"
        assert ch.tier_weight == 2
        ch.tier = "hidden"
        assert ch.tier_weight == 3

    def test_unique_youtube_id(self):
        WatchChannel.objects.create(youtube_channel_id="UC1234", name="First")
        with pytest.raises(Exception):
            WatchChannel.objects.create(youtube_channel_id="UC1234", name="Duplicate")


@pytest.mark.django_db
class TestWatchVideo:
    def test_create_video(self):
        v = WatchVideo.objects.create(
            youtube_video_id="vid123",
            title="Test Video",
            thumbnail_url="https://i.ytimg.com/vi/vid123/hqdefault.jpg",
        )
        assert v.pinned is False
        assert v.visible is False
        assert v.channel is None
        assert str(v) == "Test Video"

    def test_video_linked_to_channel(self):
        ch = WatchChannel.objects.create(youtube_channel_id="UC1234", name="Ch")
        v = WatchVideo.objects.create(youtube_video_id="vid123", title="Vid", channel=ch)
        assert v.channel == ch
        assert ch.videos.count() == 1

    def test_channel_delete_nullifies_video(self):
        ch = WatchChannel.objects.create(youtube_channel_id="UC1234", name="Ch")
        v = WatchVideo.objects.create(youtube_video_id="vid123", title="Vid", channel=ch)
        ch.delete()
        v.refresh_from_db()
        assert v.channel is None
```

- [ ] **Step 5: Run tests**

```bash
uv run pytest website/tests/test_watch.py -v
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add website/models/watch.py website/models/__init__.py website/tests/test_watch.py website/migrations/
git commit -m "feat(watches): add WatchChannel and WatchVideo models"
```

---

## Task 2: Public API Endpoint

**Files:**
- Create: `website/views/watch.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`
- Modify: `website/tests/test_watch.py`

- [ ] **Step 1: Write failing tests for public list endpoint**

Append to `website/tests/test_watch.py`:

```python
@pytest.fixture()
def visible_channels(db):  # noqa: ARG001
    ch1 = WatchChannel.objects.create(
        youtube_channel_id="UC_never", name="Top Channel", tier="never_miss", display_order=0
    )
    ch2 = WatchChannel.objects.create(
        youtube_channel_id="UC_reg", name="Regular Channel", tier="regular", display_order=0
    )
    WatchChannel.objects.create(
        youtube_channel_id="UC_hidden", name="Hidden Channel", tier="hidden"
    )
    WatchVideo.objects.create(
        youtube_video_id="vid_pinned",
        title="Great Video",
        thumbnail_url="https://i.ytimg.com/vi/vid_pinned/hqdefault.jpg",
        note="Must watch",
        pinned=True,
        visible=True,
        channel=ch1,
    )
    WatchVideo.objects.create(
        youtube_video_id="vid_hidden",
        title="Hidden Video",
        pinned=False,
        visible=False,
        channel=ch1,
    )
    return [ch1, ch2]


@pytest.mark.django_db
class TestWatchList:
    def test_empty(self, client):
        data = client.get("/api/watches/").json()
        assert data["channels"] == []
        assert data["total"] == 0

    def test_returns_visible_channels_only(self, client, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/").json()
        names = [c["name"] for c in data["channels"]]
        assert "Top Channel" in names
        assert "Regular Channel" in names
        assert "Hidden Channel" not in names

    def test_includes_pinned_visible_videos(self, client, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/").json()
        top = next(c for c in data["channels"] if c["name"] == "Top Channel")
        assert len(top["videos"]) == 1
        assert top["videos"][0]["title"] == "Great Video"
        assert top["videos"][0]["note"] == "Must watch"

    def test_excludes_hidden_videos(self, client, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/").json()
        top = next(c for c in data["channels"] if c["name"] == "Top Channel")
        video_titles = [v["title"] for v in top["videos"]]
        assert "Hidden Video" not in video_titles

    def test_sorted_by_tier_weight(self, client, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/").json()
        tiers = [c["tier"] for c in data["channels"]]
        assert tiers == ["never_miss", "regular"]

    def test_pagination(self, client, db):  # noqa: ARG001
        for i in range(35):
            WatchChannel.objects.create(
                youtube_channel_id=f"UC_{i}", name=f"Channel {i}", tier="regular"
            )
        data = client.get("/api/watches/?limit=10&offset=0").json()
        assert len(data["channels"]) == 10
        assert data["total"] == 35

        data2 = client.get("/api/watches/?limit=10&offset=30").json()
        assert len(data2["channels"]) == 5
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest website/tests/test_watch.py::TestWatchList -v
```

Expected: FAIL (URL not found / 404).

- [ ] **Step 3: Implement the public list view**

Create `website/views/watch.py`:

```python
import json
import logging
import os
import time
import urllib.parse
import urllib.request

from django.core.cache import cache as redis_cache
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import timezone

from ..auth import require_admin, verify_token
from ..models import WatchChannel, WatchVideo
from ..utils import parse_json_body

logger = logging.getLogger(__name__)

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"

_last_sync: float = 0
SYNC_COOLDOWN = 300


def watch_list(request):
    """Public: return visible channels with their pinned videos, sorted by tier weight."""
    try:
        limit = min(max(int(request.GET.get("limit", "30")), 1), 100)
        offset = max(int(request.GET.get("offset", "0")), 0)
    except (ValueError, TypeError):
        return JsonResponse({"error": "Invalid pagination parameters"}, status=400)

    visible_tiers = [WatchChannel.Tier.NEVER_MISS, WatchChannel.Tier.REGULAR, WatchChannel.Tier.CHECK_OUT]
    qs = WatchChannel.objects.filter(tier__in=visible_tiers)

    # Sort by tier weight, then display_order, then name
    tier_order = {WatchChannel.Tier.NEVER_MISS: 0, WatchChannel.Tier.REGULAR: 1, WatchChannel.Tier.CHECK_OUT: 2}
    all_channels = sorted(qs, key=lambda c: (tier_order.get(c.tier, 9), c.display_order, c.name))

    total = len(all_channels)
    page = all_channels[offset : offset + limit]

    # Prefetch pinned+visible videos for this page
    channel_ids = [c.id for c in page]
    pinned_videos = (
        WatchVideo.objects.filter(channel_id__in=channel_ids, pinned=True, visible=True)
        .select_related("channel")
    )
    videos_by_channel = {}
    for v in pinned_videos:
        videos_by_channel.setdefault(v.channel_id, []).append(v)

    data = []
    for ch in page:
        ch_videos = videos_by_channel.get(ch.id, [])
        data.append({
            "id": ch.id,
            "youtube_channel_id": ch.youtube_channel_id,
            "name": ch.name,
            "description": ch.description,
            "thumbnail_url": ch.thumbnail_url,
            "tier": ch.tier,
            "display_order": ch.display_order,
            "videos": [
                {
                    "id": v.id,
                    "youtube_video_id": v.youtube_video_id,
                    "title": v.title,
                    "thumbnail_url": v.thumbnail_url,
                    "note": v.note,
                }
                for v in ch_videos
            ],
        })

    return JsonResponse({"channels": data, "total": total, "limit": limit, "offset": offset})
```

- [ ] **Step 4: Wire up URL and exports**

Add to `website/views/__init__.py`:

```python
from .watch import watch_list
```

Add `"watch_list"` to the `__all__` list.

Add to `website/urls.py`:

```python
path("watches/", views.watch_list),
```

- [ ] **Step 5: Run tests**

```bash
uv run pytest website/tests/test_watch.py::TestWatchList -v
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add website/views/watch.py website/views/__init__.py website/urls.py website/tests/test_watch.py
git commit -m "feat(watches): add public channel list API with pagination"
```

---

## Task 3: Admin API — Staging, Tier, Pin, Delete

**Files:**
- Modify: `website/views/watch.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`
- Modify: `website/tests/test_watch.py`

- [ ] **Step 1: Write failing tests for admin endpoints**

Append to `website/tests/test_watch.py`:

```python
@pytest.mark.django_db
class TestWatchStaging:
    def test_requires_auth(self, client):
        assert client.get("/api/watches/staging/").status_code == 401

    def test_returns_hidden_channels_and_videos(self, client, auth_headers, visible_channels):  # noqa: ARG002
        data = client.get("/api/watches/staging/", **auth_headers).json()
        channel_names = [c["name"] for c in data["channels"]]
        assert "Hidden Channel" in channel_names
        assert "Top Channel" not in channel_names
        # Non-visible videos across all channels
        assert any(v["title"] == "Hidden Video" for v in data["videos"])


@pytest.mark.django_db
class TestWatchTier:
    def test_requires_auth(self, client):
        assert client.post("/api/watches/channels/1/tier/").status_code == 401

    def test_set_tier(self, client, auth_headers, db):  # noqa: ARG001
        ch = WatchChannel.objects.create(youtube_channel_id="UC1", name="Ch", tier="hidden")
        resp = client.post(
            f"/api/watches/channels/{ch.id}/tier/",
            data=json.dumps({"tier": "never_miss"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 200
        ch.refresh_from_db()
        assert ch.tier == "never_miss"

    def test_invalid_tier(self, client, auth_headers, db):  # noqa: ARG001
        ch = WatchChannel.objects.create(youtube_channel_id="UC1", name="Ch")
        resp = client.post(
            f"/api/watches/channels/{ch.id}/tier/",
            data=json.dumps({"tier": "invalid"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 400

    def test_not_found(self, client, auth_headers):
        resp = client.post(
            "/api/watches/channels/9999/tier/",
            data=json.dumps({"tier": "regular"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 404


@pytest.mark.django_db
class TestWatchOrder:
    def test_set_order(self, client, auth_headers, db):  # noqa: ARG001
        ch = WatchChannel.objects.create(youtube_channel_id="UC1", name="Ch")
        resp = client.post(
            f"/api/watches/channels/{ch.id}/order/",
            data=json.dumps({"display_order": 5}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 200
        ch.refresh_from_db()
        assert ch.display_order == 5


@pytest.mark.django_db
class TestWatchChannelDelete:
    def test_delete_channel_cascades_videos(self, client, auth_headers, db):  # noqa: ARG001
        ch = WatchChannel.objects.create(youtube_channel_id="UC1", name="Ch")
        WatchVideo.objects.create(youtube_video_id="v1", title="V", channel=ch)
        resp = client.post(f"/api/watches/channels/{ch.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        assert WatchChannel.objects.count() == 0
        # Video still exists but channel is nullified (SET_NULL)
        assert WatchVideo.objects.count() == 1
        assert WatchVideo.objects.first().channel is None


@pytest.mark.django_db
class TestWatchVideoPin:
    def test_toggle_pin(self, client, auth_headers, db):  # noqa: ARG001
        v = WatchVideo.objects.create(youtube_video_id="v1", title="V", pinned=False, visible=False)
        resp = client.post(f"/api/watches/videos/{v.id}/pin/", **auth_headers)
        assert resp.status_code == 200
        v.refresh_from_db()
        assert v.pinned is True
        assert v.visible is True

        # Toggle off
        resp = client.post(f"/api/watches/videos/{v.id}/pin/", **auth_headers)
        v.refresh_from_db()
        assert v.pinned is False


@pytest.mark.django_db
class TestWatchVideoNote:
    def test_set_note(self, client, auth_headers, db):  # noqa: ARG001
        v = WatchVideo.objects.create(youtube_video_id="v1", title="V")
        resp = client.post(
            f"/api/watches/videos/{v.id}/note/",
            data=json.dumps({"note": "Great video"}),
            content_type="application/json",
            **auth_headers,
        )
        assert resp.status_code == 200
        v.refresh_from_db()
        assert v.note == "Great video"


@pytest.mark.django_db
class TestWatchVideoDelete:
    def test_delete_video(self, client, auth_headers, db):  # noqa: ARG001
        v = WatchVideo.objects.create(youtube_video_id="v1", title="V")
        resp = client.post(f"/api/watches/videos/{v.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        assert WatchVideo.objects.count() == 0
```

Add `import json` at the top of the test file if not already present.

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest website/tests/test_watch.py -k "Staging or Tier or Order or ChannelDelete or VideoPin or VideoNote or VideoDelete" -v
```

Expected: FAIL (views not found / 404).

- [ ] **Step 3: Implement admin views**

Append to `website/views/watch.py`:

```python
@require_admin
def watch_staging(request):
    """Admin: return hidden channels and non-visible videos for review."""
    hidden_channels = WatchChannel.objects.filter(tier=WatchChannel.Tier.HIDDEN)
    hidden_videos = WatchVideo.objects.filter(visible=False)

    return JsonResponse({
        "channels": [
            {
                "id": ch.id,
                "youtube_channel_id": ch.youtube_channel_id,
                "name": ch.name,
                "description": ch.description,
                "thumbnail_url": ch.thumbnail_url,
                "tier": ch.tier,
            }
            for ch in hidden_channels
        ],
        "videos": [
            {
                "id": v.id,
                "youtube_video_id": v.youtube_video_id,
                "title": v.title,
                "thumbnail_url": v.thumbnail_url,
                "channel_name": v.channel.name if v.channel else None,
                "pinned": v.pinned,
            }
            for v in hidden_videos
        ],
    })


@require_admin
def watch_channel_tier(request, channel_id):
    """Admin: set tier for a channel."""
    try:
        ch = WatchChannel.objects.get(id=channel_id)
    except WatchChannel.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    body, err = parse_json_body(request)
    if err:
        return err

    tier = body.get("tier", "")
    valid_tiers = [t.value for t in WatchChannel.Tier]
    if tier not in valid_tiers:
        return JsonResponse({"error": f"Invalid tier. Must be one of: {valid_tiers}"}, status=400)

    ch.tier = tier
    ch.save(update_fields=["tier"])
    return JsonResponse({"ok": True, "tier": ch.tier})


@require_admin
def watch_channel_order(request, channel_id):
    """Admin: set display_order for a channel."""
    try:
        ch = WatchChannel.objects.get(id=channel_id)
    except WatchChannel.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    body, err = parse_json_body(request)
    if err:
        return err

    order = body.get("display_order", 0)
    ch.display_order = int(order)
    ch.save(update_fields=["display_order"])
    return JsonResponse({"ok": True, "display_order": ch.display_order})


@require_admin
def watch_channel_delete(request, channel_id):
    """Admin: hard delete a channel (videos get channel nullified via SET_NULL)."""
    try:
        ch = WatchChannel.objects.get(id=channel_id)
    except WatchChannel.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    ch.delete()
    return JsonResponse({"ok": True})


@require_admin
def watch_video_pin(request, video_id):
    """Admin: toggle pinned on a video. Pinning also sets visible=True."""
    try:
        v = WatchVideo.objects.get(id=video_id)
    except WatchVideo.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    v.pinned = not v.pinned
    if v.pinned:
        v.visible = True
    v.save(update_fields=["pinned", "visible"])
    return JsonResponse({"ok": True, "pinned": v.pinned, "visible": v.visible})


@require_admin
def watch_video_note(request, video_id):
    """Admin: set note on a video."""
    try:
        v = WatchVideo.objects.get(id=video_id)
    except WatchVideo.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    body, err = parse_json_body(request)
    if err:
        return err

    v.note = body.get("note", "")[:200]
    v.save(update_fields=["note"])
    return JsonResponse({"ok": True, "note": v.note})


@require_admin
def watch_video_delete(request, video_id):
    """Admin: hard delete a video."""
    try:
        v = WatchVideo.objects.get(id=video_id)
    except WatchVideo.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    v.delete()
    return JsonResponse({"ok": True})
```

- [ ] **Step 4: Wire up URLs and exports**

Add all new views to `website/views/__init__.py`:

```python
from .watch import (
    watch_channel_delete,
    watch_channel_order,
    watch_channel_tier,
    watch_list,
    watch_staging,
    watch_video_delete,
    watch_video_note,
    watch_video_pin,
)
```

Add all names to `__all__`.

Add to `website/urls.py`:

```python
path("watches/staging/", views.watch_staging),
path("watches/channels/<int:channel_id>/tier/", views.watch_channel_tier),
path("watches/channels/<int:channel_id>/order/", views.watch_channel_order),
path("watches/channels/<int:channel_id>/delete/", views.watch_channel_delete),
path("watches/videos/<int:video_id>/pin/", views.watch_video_pin),
path("watches/videos/<int:video_id>/note/", views.watch_video_note),
path("watches/videos/<int:video_id>/delete/", views.watch_video_delete),
```

- [ ] **Step 5: Run all tests**

```bash
uv run pytest website/tests/test_watch.py -v
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add website/views/watch.py website/views/__init__.py website/urls.py website/tests/test_watch.py
git commit -m "feat(watches): add admin API — staging, tier, pin, note, delete"
```

---

## Task 4: YouTube OAuth + Sync

**Files:**
- Modify: `website/views/watch.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`
- Modify: `website/tests/test_watch.py`

- [ ] **Step 1: Write failing tests for OAuth and sync**

Append to `website/tests/test_watch.py`:

```python
from unittest.mock import MagicMock, patch

from website.views import watch as watch_views


@pytest.fixture(autouse=True)
def _reset_watch_rate_limit():
    watch_views._last_sync = 0
    yield
    watch_views._last_sync = 0


@pytest.mark.django_db
class TestWatchAuth:
    def test_no_google_client_id(self, client, admin_token):
        with patch.dict("os.environ", {"GOOGLE_CLIENT_ID": ""}, clear=False):
            resp = client.get(f"/api/watches/auth/?token={admin_token}")
            assert resp.status_code == 500

    @patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "test-client-id"})
    def test_redirects_to_google(self, client, admin_token):
        resp = client.get(f"/api/watches/auth/?token={admin_token}")
        assert resp.status_code == 302
        assert "accounts.google.com" in resp["Location"]
        assert "test-client-id" in resp["Location"]
        assert "youtube.readonly" in resp["Location"]

    def test_requires_token(self, client):
        with patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "test-id"}):
            assert client.get("/api/watches/auth/").status_code == 401


@pytest.mark.django_db
class TestWatchCallback:
    def test_missing_code(self, client):
        resp = client.get("/api/watches/callback/")
        assert resp.status_code == 400

    def test_bad_state(self, client):
        resp = client.get("/api/watches/callback/?code=test&state=bad")
        assert resp.status_code == 401

    def test_error_redirects(self, client):
        resp = client.get("/api/watches/callback/?error=access_denied")
        assert resp.status_code == 302
        assert "/watches?error=" in resp["Location"]


@pytest.mark.django_db
class TestWatchSync:
    def test_requires_auth(self, client):
        assert client.post("/api/watches/sync/").status_code == 401

    def test_no_refresh_token(self, client, auth_headers):
        resp = client.post("/api/watches/sync/", **auth_headers)
        assert resp.status_code == 400
        assert "not connected" in resp.json()["error"].lower()

    @patch("website.views.watch._youtube_api_get")
    def test_sync_creates_channels_and_videos(self, mock_api_get, client, auth_headers):
        from django.core.cache import cache

        cache.set("watches_google_refresh_token", "fake-refresh")
        cache.set("watches_google_access_token", "fake-access")

        # Mock: first call = subscriptions page 1, second = liked videos page 1
        mock_api_get.side_effect = [
            {
                "items": [
                    {
                        "snippet": {
                            "resourceId": {"channelId": "UC_test"},
                            "title": "Test Channel",
                            "description": "Desc",
                            "thumbnails": {"default": {"url": "https://thumb.jpg"}},
                        }
                    }
                ],
            },
            {
                "items": [
                    {
                        "id": "vid_test",
                        "snippet": {
                            "title": "Test Video",
                            "channelId": "UC_test",
                            "thumbnails": {"high": {"url": "https://vthumb.jpg"}},
                        },
                    }
                ],
            },
        ]

        resp = client.post("/api/watches/sync/", **auth_headers)
        assert resp.status_code == 200

        assert WatchChannel.objects.filter(youtube_channel_id="UC_test").exists()
        ch = WatchChannel.objects.get(youtube_channel_id="UC_test")
        assert ch.name == "Test Channel"
        assert ch.tier == "hidden"

        assert WatchVideo.objects.filter(youtube_video_id="vid_test").exists()
        v = WatchVideo.objects.get(youtube_video_id="vid_test")
        assert v.channel == ch
        assert v.visible is False

    @patch("website.views.watch._youtube_api_get")
    def test_sync_rate_limited(self, mock_api_get, client, auth_headers):
        from django.core.cache import cache

        cache.set("watches_google_refresh_token", "fake-refresh")
        cache.set("watches_google_access_token", "fake-access")
        mock_api_get.return_value = {"items": []}

        client.post("/api/watches/sync/", **auth_headers)
        resp = client.post("/api/watches/sync/", **auth_headers)
        assert resp.status_code == 429


@pytest.mark.django_db
class TestWatchSyncStatus:
    def test_requires_auth(self, client):
        assert client.get("/api/watches/sync-status/").status_code == 401

    def test_returns_status(self, client, auth_headers):
        data = client.get("/api/watches/sync-status/", **auth_headers).json()
        assert data["available"] is True
        assert data["cooldown_remaining"] == 0
        assert data["connected"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest website/tests/test_watch.py -k "Auth or Callback or Sync" -v
```

Expected: FAIL.

- [ ] **Step 3: Implement OAuth + sync views**

Append to `website/views/watch.py`:

```python
def _youtube_api_get(endpoint, access_token, params=None):
    """Make a GET request to the YouTube Data API v3."""
    url = f"{YOUTUBE_API_BASE}/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _refresh_access_token():
    """Refresh the Google access token using the stored refresh token. Returns access_token or None."""
    refresh_token = redis_cache.get("watches_google_refresh_token")
    if not refresh_token:
        return None

    # Check if we have a still-valid access token
    cached_access = redis_cache.get("watches_google_access_token")
    if cached_access:
        return cached_access

    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return None

    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(
        GOOGLE_TOKEN_URL, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            token_resp = json.loads(resp.read())
        access_token = token_resp.get("access_token")
        expires_in = token_resp.get("expires_in", 3600)
        if access_token:
            redis_cache.set("watches_google_access_token", access_token, expires_in - 60)
        return access_token
    except Exception:
        logger.exception("Failed to refresh Google access token for watches")
        return None


def _sync_subscriptions(access_token, max_pages=10):
    """Sync YouTube subscriptions into WatchChannel. Returns count of new channels."""
    new_count = 0
    page_token = None

    for _ in range(max_pages):
        params = {"mine": "true", "part": "snippet", "maxResults": "50"}
        if page_token:
            params["pageToken"] = page_token

        data = _youtube_api_get("subscriptions", access_token, params)
        items = data.get("items", [])

        for item in items:
            snippet = item.get("snippet", {})
            channel_id = snippet.get("resourceId", {}).get("channelId", "")
            if not channel_id:
                continue

            thumbnails = snippet.get("thumbnails", {})
            thumb_url = thumbnails.get("default", {}).get("url", "")

            _, created = WatchChannel.objects.update_or_create(
                youtube_channel_id=channel_id,
                defaults={
                    "name": snippet.get("title", "")[:200],
                    "description": snippet.get("description", ""),
                    "thumbnail_url": thumb_url,
                },
            )
            if created:
                new_count += 1

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return new_count


def _sync_liked_videos(access_token, max_pages=4):
    """Sync YouTube liked videos into WatchVideo. Returns count of new videos."""
    new_count = 0
    page_token = None

    for _ in range(max_pages):
        params = {"myRating": "like", "part": "snippet", "maxResults": "50"}
        if page_token:
            params["pageToken"] = page_token

        data = _youtube_api_get("videos", access_token, params)
        items = data.get("items", [])

        for item in items:
            video_id = item.get("id", "")
            if not video_id:
                continue

            snippet = item.get("snippet", {})
            thumbnails = snippet.get("thumbnails", {})
            thumb_url = thumbnails.get("high", thumbnails.get("default", {})).get("url", "")

            # Link to channel if we have it
            yt_channel_id = snippet.get("channelId", "")
            channel = None
            if yt_channel_id:
                channel = WatchChannel.objects.filter(youtube_channel_id=yt_channel_id).first()

            _, created = WatchVideo.objects.update_or_create(
                youtube_video_id=video_id,
                defaults={
                    "title": snippet.get("title", "")[:300],
                    "thumbnail_url": thumb_url,
                    "channel": channel,
                },
            )
            if created:
                new_count += 1

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return new_count


def watch_auth(request):
    """Redirect to Google OAuth. Requires admin token as ?token= param."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        return JsonResponse({"error": "Google OAuth not configured"}, status=500)

    admin_token = request.GET.get("token", "")
    if not admin_token or not verify_token(admin_token):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    redirect_uri = f"{scheme}://{host}/api/watches/callback/"

    params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/youtube.readonly",
        "access_type": "offline",
        "prompt": "consent",
        "state": admin_token,
    })
    return HttpResponseRedirect(f"{GOOGLE_AUTHORIZE_URL}?{params}")


def watch_callback(request):
    """Google OAuth callback: exchange code, store refresh token, redirect."""
    code = request.GET.get("code", "")
    state = request.GET.get("state", "")
    error = request.GET.get("error", "")

    if error:
        return HttpResponseRedirect(f"/watches?error={urllib.parse.quote(error)}")

    if not code:
        return JsonResponse({"error": "Missing code"}, status=400)

    if not state or not verify_token(state):
        return JsonResponse({"error": "Unauthorized"}, status=401)

    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")

    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    redirect_uri = f"{scheme}://{host}/api/watches/callback/"

    token_data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }).encode()

    token_req = urllib.request.Request(
        GOOGLE_TOKEN_URL, data=token_data, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )

    try:
        with urllib.request.urlopen(token_req, timeout=10) as resp:
            token_resp = json.loads(resp.read())
    except Exception:
        logger.exception("Failed to exchange Google OAuth code for watches")
        return HttpResponseRedirect(f"/watches?error={urllib.parse.quote('Failed to exchange OAuth code')}")

    access_token = token_resp.get("access_token")
    refresh_token = token_resp.get("refresh_token")

    if not access_token:
        return HttpResponseRedirect(f"/watches?error={urllib.parse.quote('No access token received')}")

    # Store refresh token for future syncs (never expires in cache)
    if refresh_token:
        redis_cache.set("watches_google_refresh_token", refresh_token, None)

    # Cache access token until it expires
    expires_in = token_resp.get("expires_in", 3600)
    redis_cache.set("watches_google_access_token", access_token, expires_in - 60)

    return HttpResponseRedirect("/watches")


@require_admin
def watch_sync(request):
    """Admin: trigger a YouTube sync using the stored refresh token."""
    global _last_sync

    access_token = _refresh_access_token()
    if not access_token:
        return JsonResponse({"error": "YouTube not connected. Please authorize first."}, status=400)

    now = time.time()
    if now - _last_sync < SYNC_COOLDOWN:
        remaining = int(SYNC_COOLDOWN - (now - _last_sync))
        return JsonResponse({"error": f"Rate limited. Try again in {remaining}s"}, status=429)

    try:
        new_channels = _sync_subscriptions(access_token)
        new_videos = _sync_liked_videos(access_token)
    except Exception:
        logger.exception("YouTube sync failed")
        return JsonResponse({"error": "Sync failed"}, status=500)

    _last_sync = time.time()
    redis_cache.set("watches_last_synced", timezone.now().isoformat(), None)

    return JsonResponse({"ok": True, "new_channels": new_channels, "new_videos": new_videos})


@require_admin
def watch_sync_status(request):
    """Admin: check sync availability and connection status."""
    global _last_sync
    now = time.time()
    elapsed = now - _last_sync
    available = elapsed >= SYNC_COOLDOWN
    remaining = max(0, int(SYNC_COOLDOWN - elapsed)) if not available else 0

    connected = redis_cache.get("watches_google_refresh_token") is not None
    last_synced = redis_cache.get("watches_last_synced")

    return JsonResponse({
        "available": available,
        "cooldown_remaining": remaining,
        "connected": connected,
        "last_synced": last_synced,
    })
```

- [ ] **Step 4: Wire up URLs and exports**

Add to `website/views/__init__.py` imports:

```python
from .watch import (
    watch_auth,
    watch_callback,
    watch_channel_delete,
    watch_channel_order,
    watch_channel_tier,
    watch_list,
    watch_staging,
    watch_sync,
    watch_sync_status,
    watch_video_delete,
    watch_video_note,
    watch_video_pin,
)
```

Update `__all__` to include `"watch_auth"`, `"watch_callback"`, `"watch_sync"`, `"watch_sync_status"`.

Add to `website/urls.py`:

```python
path("watches/auth/", views.watch_auth),
path("watches/callback/", views.watch_callback),
path("watches/sync/", views.watch_sync),
path("watches/sync-status/", views.watch_sync_status),
```

- [ ] **Step 5: Run all tests**

```bash
uv run pytest website/tests/test_watch.py -v
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add website/views/watch.py website/views/__init__.py website/urls.py website/tests/test_watch.py
git commit -m "feat(watches): add YouTube OAuth, sync, and sync status endpoints"
```

---

## Task 5: Frontend Types + API

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add TypeScript types**

Append to `frontend/src/lib/api.ts`:

```typescript
export interface WatchVideo {
  id: number;
  youtube_video_id: string;
  title: string;
  thumbnail_url: string;
  note: string;
}

export interface WatchChannel {
  id: number;
  youtube_channel_id: string;
  name: string;
  description: string;
  thumbnail_url: string;
  tier: "never_miss" | "regular" | "check_out";
  display_order: number;
  videos: WatchVideo[];
}

export interface WatchListResponse {
  channels: WatchChannel[];
  total: number;
  limit: number;
  offset: number;
}

export interface StagingChannel {
  id: number;
  youtube_channel_id: string;
  name: string;
  description: string;
  thumbnail_url: string;
  tier: string;
}

export interface StagingVideo {
  id: number;
  youtube_video_id: string;
  title: string;
  thumbnail_url: string;
  channel_name: string | null;
  pinned: boolean;
}

export interface WatchStagingResponse {
  channels: StagingChannel[];
  videos: StagingVideo[];
}

export interface WatchSyncStatus {
  available: boolean;
  cooldown_remaining: number;
  connected: boolean;
  last_synced: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(watches): add frontend TypeScript types for watches API"
```

---

## Task 6: Frontend — Public Glow Grid

**Files:**
- Modify: `frontend/src/app/watches/page.tsx`

- [ ] **Step 1: Implement the glow grid page**

Rewrite `frontend/src/app/watches/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

import {
  API,
  type WatchChannel,
  type WatchListResponse,
  type WatchSyncStatus,
} from "@/lib/api";
import { getAdminToken, store } from "@/lib/auth";

const ACCENT = "#1e40af";
const PAGE_SIZE = 30;

/* ── Tier visual config ───────────────────────────────── */
const TIER_STYLE = {
  never_miss: {
    border: `1px solid ${ACCENT}60`,
    boxShadow: `0 0 15px ${ACCENT}30`,
    avatarSize: 48,
    opacity: 1,
    label: "NEVER MISS",
    labelColor: ACCENT,
  },
  regular: {
    border: `1px solid ${ACCENT}30`,
    boxShadow: "none",
    avatarSize: 40,
    opacity: 0.85,
    label: "ROTATION",
    labelColor: `${ACCENT}99`,
  },
  check_out: {
    border: `1px solid ${ACCENT}15`,
    boxShadow: "none",
    avatarSize: 36,
    opacity: 0.65,
    label: "CHECK OUT",
    labelColor: `${ACCENT}66`,
  },
} as const;

/* ── Channel Card ─────────────────────────────────────── */
function ChannelCard({
  channel,
  expanded,
  onClick,
}: {
  channel: WatchChannel;
  expanded: boolean;
  onClick: () => void;
}) {
  const style = TIER_STYLE[channel.tier];

  return (
    <div
      onClick={onClick}
      className="watches-card"
      style={{
        background: "#0d0d0d",
        border: style.border,
        borderRadius: "8px",
        padding: expanded ? "1rem" : "0.75rem",
        cursor: "pointer",
        opacity: style.opacity,
        boxShadow: style.boxShadow,
        gridColumn: expanded ? "span 2" : "span 1",
        transition: "all 0.3s ease",
      }}
    >
      {/* Channel info */}
      <div
        style={{
          display: "flex",
          flexDirection: expanded ? "row" : "column",
          alignItems: expanded ? "center" : "center",
          gap: expanded ? "0.75rem" : "0.5rem",
          textAlign: expanded ? "left" : "center",
        }}
      >
        <a
          href={`https://www.youtube.com/channel/${channel.youtube_channel_id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={channel.thumbnail_url}
            alt={channel.name}
            style={{
              width: style.avatarSize,
              height: style.avatarSize,
              borderRadius: "50%",
              objectFit: "cover",
              border: `1px solid ${ACCENT}30`,
              flexShrink: 0,
            }}
          />
        </a>
        <div>
          <div
            style={{
              color: "#e5e2e1",
              fontSize: "0.85rem",
              fontWeight: 600,
              marginBottom: "0.15rem",
            }}
          >
            {channel.name}
          </div>
          <div
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.55rem",
              color: style.labelColor,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {style.label}
          </div>
        </div>
      </div>

      {/* Expanded: pinned videos */}
      {expanded && channel.videos.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            marginTop: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          {channel.videos.map((v) => (
            <a
              key={v.id}
              href={`https://www.youtube.com/watch?v=${v.youtube_video_id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "block",
                background: `${ACCENT}08`,
                border: `1px solid ${ACCENT}20`,
                borderRadius: "4px",
                overflow: "hidden",
                width: "140px",
                textDecoration: "none",
                transition: "border-color 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = `${ACCENT}50`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = `${ACCENT}20`;
              }}
            >
              <img
                src={v.thumbnail_url}
                alt={v.title}
                style={{
                  width: "100%",
                  height: "79px",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              <div style={{ padding: "0.35rem 0.4rem" }}>
                <div
                  style={{
                    color: "#bbb",
                    fontSize: "0.65rem",
                    lineHeight: 1.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {v.title}
                </div>
                {v.note && (
                  <div
                    style={{
                      color: `${ACCENT}99`,
                      fontSize: "0.55rem",
                      fontStyle: "italic",
                      marginTop: "0.15rem",
                    }}
                  >
                    {v.note}
                  </div>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────── */
export default function WatchesPage() {
  const [channels, setChannels] = useState<WatchChannel[]>([]);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [syncStatus, setSyncStatus] = useState<WatchSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchChannels = useCallback(async (offset = 0, append = false) => {
    try {
      const res = await fetch(
        `${API}/api/watches/?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      if (res.ok) {
        const data: WatchListResponse = await res.json();
        setChannels((prev) => (append ? [...prev, ...data.channels] : data.channels));
        setTotal(data.total);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    setIsAdmin(!!store("adminToken"));
  }, [fetchChannels]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch(`${API}/api/watches/sync-status/`, {
      headers: { Authorization: `Bearer ${store("adminToken")}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSyncStatus(d))
      .catch(() => {});
  }, [isAdmin]);

  async function handleSync() {
    const token = getAdminToken();
    if (!token) return;
    setSyncing(true);
    try {
      const res = await fetch(`${API}/api/watches/sync/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await fetchChannels();
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error ?? "Sync failed");
      }
    } catch {
      alert("Sync failed — check your connection");
    } finally {
      setSyncing(false);
    }
  }

  function handleConnect() {
    const token = store("adminToken");
    if (token) {
      window.location.href = `${API}/api/watches/auth/?token=${token}`;
    }
  }

  return (
    <>
      <title>Nam watches</title>

      <style>{`
        .watches-card {
          transition: border-color 0.2s, box-shadow 0.2s, opacity 0.2s;
        }
        .watches-card:hover {
          border-color: ${ACCENT}50 !important;
          box-shadow: 0 0 20px ${ACCENT}20 !important;
        }
      `}</style>

      <div
        style={{
          maxWidth: "64rem",
          margin: "0 auto",
          padding: "2rem 1.5rem 6rem",
        }}
      >
        {/* Header */}
        <div
          style={{
            textAlign: "center",
            marginBottom: "2.5rem",
          }}
        >
          <p
            style={{
              fontStyle: "italic",
              color: "#666",
              fontSize: "0.9rem",
              letterSpacing: "0.04em",
            }}
          >
            my youtube taste map
          </p>

          {/* Admin controls */}
          {isAdmin && (
            <div
              style={{
                marginTop: "1rem",
                display: "flex",
                justifyContent: "center",
                gap: "0.5rem",
              }}
            >
              {syncStatus?.connected ? (
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing || !syncStatus?.available}
                  style={{
                    background: "none",
                    border: `1px solid ${ACCENT}40`,
                    borderRadius: "4px",
                    color: ACCENT,
                    fontSize: "0.75rem",
                    padding: "0.25rem 0.75rem",
                    cursor:
                      syncing || !syncStatus?.available ? "wait" : "pointer",
                    transition: "border-color 0.2s",
                  }}
                >
                  {syncing
                    ? "syncing..."
                    : syncStatus?.available
                      ? "sync"
                      : `cooldown ${syncStatus?.cooldown_remaining}s`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConnect}
                  style={{
                    background: "none",
                    border: `1px solid ${ACCENT}40`,
                    borderRadius: "4px",
                    color: ACCENT,
                    fontSize: "0.75rem",
                    padding: "0.25rem 0.75rem",
                    cursor: "pointer",
                  }}
                >
                  connect youtube
                </button>
              )}
              <a
                href="/watches/staging"
                style={{
                  border: `1px solid ${ACCENT}20`,
                  borderRadius: "4px",
                  color: `${ACCENT}99`,
                  fontSize: "0.75rem",
                  padding: "0.25rem 0.75rem",
                  textDecoration: "none",
                  transition: "border-color 0.2s",
                }}
              >
                staging
              </a>
            </div>
          )}
        </div>

        {/* Glow Grid */}
        {loading ? (
          <p style={{ color: "#555", textAlign: "center", fontStyle: "italic" }}>
            loading...
          </p>
        ) : channels.length === 0 ? (
          <p style={{ color: "#555", textAlign: "center", fontStyle: "italic" }}>
            nothing here yet
          </p>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {channels.map((ch) => (
                <ChannelCard
                  key={ch.id}
                  channel={ch}
                  expanded={expandedId === ch.id}
                  onClick={() =>
                    setExpandedId(expandedId === ch.id ? null : ch.id)
                  }
                />
              ))}
            </div>

            {/* Show more */}
            {channels.length < total && (
              <div style={{ textAlign: "center", marginTop: "2rem" }}>
                <button
                  type="button"
                  onClick={() => fetchChannels(channels.length, true)}
                  style={{
                    background: "none",
                    border: `1px solid ${ACCENT}30`,
                    borderRadius: "4px",
                    color: `${ACCENT}99`,
                    fontSize: "0.75rem",
                    padding: "0.35rem 1rem",
                    cursor: "pointer",
                    letterSpacing: "0.05em",
                  }}
                >
                  show more ({total - channels.length} remaining)
                </button>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            marginTop: "3rem",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.65rem",
              color: "#333",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            curated not algorithmic
          </span>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Run frontend lint**

```bash
cd frontend && pnpm lint && pnpm format
```

- [ ] **Step 3: Visual verify with Playwright**

Start the dev servers (`make dev` or `pnpm dev` + `uv run python manage.py runserver`), then use Playwright to take a screenshot of `/watches` and verify it renders without errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/watches/page.tsx
git commit -m "feat(watches): implement glow grid public page with expand-in-place videos"
```

---

## Task 7: Frontend — Staging Page (Admin)

**Files:**
- Create: `frontend/src/app/watches/staging/page.tsx`

- [ ] **Step 1: Create the staging page**

Create `frontend/src/app/watches/staging/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

import {
  API,
  type StagingChannel,
  type StagingVideo,
  type WatchStagingResponse,
} from "@/lib/api";
import { getAdminToken } from "@/lib/auth";

const ACCENT = "#1e40af";
const TIERS = ["never_miss", "regular", "check_out"] as const;

export default function WatchesStagingPage() {
  const [channels, setChannels] = useState<StagingChannel[]>([]);
  const [videos, setVideos] = useState<StagingVideo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStaging = useCallback(async () => {
    const token = getAdminToken();
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/watches/staging/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: WatchStagingResponse = await res.json();
        setChannels(data.channels);
        setVideos(data.videos);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaging();
  }, [fetchStaging]);

  async function apiPost(url: string, body?: object) {
    const token = getAdminToken();
    if (!token) return false;
    const res = await fetch(`${API}${url}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return res.ok;
  }

  async function setTier(id: number, tier: string) {
    if (await apiPost(`/api/watches/channels/${id}/tier/`, { tier })) {
      setChannels((prev) => prev.filter((c) => c.id !== id));
    }
  }

  async function deleteChannel(id: number) {
    if (confirm("Delete this channel?")) {
      if (await apiPost(`/api/watches/channels/${id}/delete/`)) {
        setChannels((prev) => prev.filter((c) => c.id !== id));
      }
    }
  }

  async function pinVideo(id: number) {
    if (await apiPost(`/api/watches/videos/${id}/pin/`)) {
      setVideos((prev) => prev.filter((v) => v.id !== id));
    }
  }

  async function deleteVideo(id: number) {
    if (confirm("Delete this video?")) {
      if (await apiPost(`/api/watches/videos/${id}/delete/`)) {
        setVideos((prev) => prev.filter((v) => v.id !== id));
      }
    }
  }

  const btnStyle = (color: string) => ({
    background: "none",
    border: `1px solid ${color}40`,
    borderRadius: "3px",
    color,
    fontSize: "0.65rem",
    padding: "0.15rem 0.5rem",
    cursor: "pointer" as const,
    letterSpacing: "0.05em",
  });

  return (
    <>
      <title>watches staging</title>
      <div
        style={{
          maxWidth: "48rem",
          margin: "0 auto",
          padding: "2rem 1.5rem 6rem",
        }}
      >
        <div style={{ marginBottom: "2rem" }}>
          <a
            href="/watches"
            style={{ color: `${ACCENT}99`, fontSize: "0.75rem", textDecoration: "none" }}
          >
            &larr; back to watches
          </a>
        </div>

        <h2
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "1rem",
            color: ACCENT,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: "1.5rem",
          }}
        >
          Staging
        </h2>

        {loading ? (
          <p style={{ color: "#555", fontStyle: "italic" }}>loading...</p>
        ) : (
          <>
            {/* Hidden channels */}
            <h3
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "0.75rem",
                color: "#888",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: "0.75rem",
              }}
            >
              Channels ({channels.length})
            </h3>

            {channels.length === 0 ? (
              <p style={{ color: "#555", fontStyle: "italic", fontSize: "0.8rem", marginBottom: "2rem" }}>
                no hidden channels
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "2rem" }}>
                {channels.map((ch) => (
                  <div
                    key={ch.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.5rem 0.75rem",
                      background: "#0d0d0d",
                      border: `1px solid ${ACCENT}15`,
                      borderRadius: "6px",
                    }}
                  >
                    <img
                      src={ch.thumbnail_url}
                      alt={ch.name}
                      style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#ccc", fontSize: "0.8rem", fontWeight: 600 }}>{ch.name}</div>
                    </div>
                    <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                      {TIERS.map((t) => (
                        <button key={t} type="button" onClick={() => setTier(ch.id, t)} style={btnStyle(ACCENT)}>
                          {t.replace("_", " ")}
                        </button>
                      ))}
                      <button type="button" onClick={() => deleteChannel(ch.id)} style={btnStyle("#f87171")}>
                        delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Hidden videos */}
            <h3
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "0.75rem",
                color: "#888",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: "0.75rem",
              }}
            >
              Videos ({videos.length})
            </h3>

            {videos.length === 0 ? (
              <p style={{ color: "#555", fontStyle: "italic", fontSize: "0.8rem" }}>
                no hidden videos
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {videos.map((v) => (
                  <div
                    key={v.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.5rem 0.75rem",
                      background: "#0d0d0d",
                      border: `1px solid ${ACCENT}15`,
                      borderRadius: "6px",
                    }}
                  >
                    <img
                      src={v.thumbnail_url}
                      alt={v.title}
                      style={{ width: 64, height: 36, borderRadius: "3px", objectFit: "cover" }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#ccc", fontSize: "0.8rem" }}>{v.title}</div>
                      {v.channel_name && (
                        <div style={{ color: "#666", fontSize: "0.7rem" }}>{v.channel_name}</div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "0.3rem" }}>
                      <button type="button" onClick={() => pinVideo(v.id)} style={btnStyle(ACCENT)}>
                        pin
                      </button>
                      <button type="button" onClick={() => deleteVideo(v.id)} style={btnStyle("#f87171")}>
                        delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Run frontend lint**

```bash
cd frontend && pnpm lint && pnpm format
```

- [ ] **Step 3: Visual verify with Playwright**

Take a screenshot of `/watches/staging` (with admin token set) to verify it renders correctly.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/watches/staging/page.tsx
git commit -m "feat(watches): add staging page for admin curation"
```

---

## Task 8: Update Docs + QA Checklist

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/QA-CHECKLIST.md`
- Modify: `CLAUDE.md` (API endpoints section)

- [ ] **Step 1: Update docs/README.md**

Add a section describing the `/watches` page. Read the file first to find the right insertion point (look for similar page descriptions).

- [ ] **Step 2: Update docs/QA-CHECKLIST.md**

Add QA items for watches:

```markdown
## /watches
- [ ] Page loads and shows glow grid of channels (if any exist)
- [ ] Channels are sorted by tier (never_miss first, then regular, then check_out)
- [ ] Tier visual intensity differs (glow, border, opacity, avatar size)
- [ ] Clicking a channel expands it in-place showing pinned videos
- [ ] Clicking again or another channel collapses the expanded one
- [ ] Video thumbnails link to YouTube in a new tab
- [ ] Channel avatars link to YouTube channel in a new tab
- [ ] "Show more" button appears when total > page size
- [ ] Show more loads additional channels without duplicates
- [ ] Mobile: grid collapses to 2 columns, expanded cards span full width
- [ ] Admin: "connect youtube" button visible when logged in and not connected
- [ ] Admin: "sync" button visible when connected
- [ ] Admin: sync rate limiting shows cooldown timer
- [ ] Admin: staging link navigates to /watches/staging
- [ ] Staging: hidden channels shown with tier promote buttons
- [ ] Staging: hidden videos shown with pin and delete buttons
- [ ] Staging: promoting a channel removes it from staging
- [ ] Staging: pinning a video removes it from staging
- [ ] Staging: requires auth (redirects to /sudo if not logged in)
```

- [ ] **Step 3: Update CLAUDE.md API endpoints**

Add the watches API endpoints to the API Endpoints section in `CLAUDE.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/README.md docs/QA-CHECKLIST.md CLAUDE.md
git commit -m "docs: add watches page to README, QA checklist, and API docs"
```

---

## Task 9: End-to-End Verification

- [ ] **Step 1: Run all backend tests**

```bash
uv run pytest -v
```

Expected: All pass, including all `test_watch.py` tests.

- [ ] **Step 2: Run frontend lint + build**

```bash
cd frontend && pnpm lint && pnpm build
```

Expected: No errors.

- [ ] **Step 3: Visual verification with Playwright**

With dev servers running:

1. Navigate to `/watches` — verify empty state ("nothing here yet")
2. Log in via `/sudo`, verify admin controls appear ("connect youtube" button + "staging" link)
3. Navigate to `/watches/staging` — verify it loads (empty state)
4. Take screenshots of both pages for review

- [ ] **Step 4: Run the full test suite one more time**

```bash
uv run pytest -v && cd frontend && pnpm test
```

Expected: All pass.
