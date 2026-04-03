# Listens Page Redesign + Mini Music Player — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the `/listens` page into a full-width, public-facing magazine layout with route-based sub-pages, and add a site-wide admin-only mini music player.

**Architecture:** Backend adds 3 aggregation endpoints and makes existing endpoints public. Frontend restructures from a single page.tsx into a shared layout with 4 sub-routes. A PlayerContext in the root layout manages YouTube IFrame playback, with a floating mini player card rendered site-wide for admin users.

**Tech Stack:** Django ORM aggregation, Redis caching, Next.js App Router (nested layouts), React Context, YouTube IFrame Player API, inline styles (existing pattern).

---

## File Structure

### Backend (new/modified)

| File | Action | Responsibility |
|---|---|---|
| `website/views/listen.py` | Modify | Remove `@require_admin` from list/stats, add 3 new view functions |
| `website/urls.py` | Modify | Add 3 new URL routes |
| `website/tests/test_listen.py` | Modify | Update auth tests, add tests for new endpoints |

### Frontend (new/modified)

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/lib/api.ts` | Modify | Add new TypeScript interfaces for aggregation responses |
| `frontend/src/lib/player.tsx` | Create | PlayerContext provider + usePlayer hook |
| `frontend/src/app/layout.tsx` | Modify | Wrap children in PlayerProvider, add MiniPlayer |
| `frontend/src/components/MiniPlayer.tsx` | Create | Floating player card UI + YouTube IFrame |
| `frontend/src/app/listens/layout.tsx` | Create | Shared hero panel + tab bar for all /listens/* routes |
| `frontend/src/app/listens/page.tsx` | Rewrite | History feed (chronological, paginated) |
| `frontend/src/app/listens/tracks/page.tsx` | Create | Top tracks ranked by play count |
| `frontend/src/app/listens/artists/page.tsx` | Create | Top artists grid |
| `frontend/src/app/listens/albums/page.tsx` | Create | Top albums grid |

---

## Task 1: Backend — Make existing endpoints public + add top-tracks endpoint

**Files:**
- Modify: `website/views/listen.py`
- Modify: `website/urls.py`
- Modify: `website/tests/test_listen.py`

### Steps

- [ ] **Step 1: Update existing tests — list and stats become public**

In `website/tests/test_listen.py`, the existing tests assert that `listen_list` and `listen_stats` return 401 without auth. Update those tests to expect 200 instead, and remove the auth header from the non-auth tests. Add new tests for the top-tracks endpoint.

Add/replace the following test functions:

```python
# Replace the existing test_listen_list_requires_auth
def test_listen_list_is_public(client, _disable_ssl_redirect):
    """List endpoint is now public — no auth required."""
    resp = client.get("/api/listens/")
    assert resp.status_code == 200


# Replace the existing test_listen_stats_requires_auth
def test_listen_stats_is_public(client, _disable_ssl_redirect):
    """Stats endpoint is now public — no auth required."""
    resp = client.get("/api/listens/stats/")
    assert resp.status_code == 200


# --- New: top-tracks endpoint ---

@pytest.mark.django_db
def test_listen_top_tracks_empty(client, _disable_ssl_redirect):
    resp = client.get("/api/listens/tracks/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tracks"] == []
    assert data["total"] == 0


@pytest.mark.django_db
def test_listen_top_tracks_ranked(client, sample_tracks, _disable_ssl_redirect):
    """Tracks with more plays rank higher."""
    # sample_tracks has 5 unique tracks. Add a duplicate to boost one.
    from website.models import ListenTrack
    from django.utils import timezone

    ListenTrack.objects.create(
        video_id="vid_1",
        title="Track 1",
        artist="Artist 1",
        played_at=timezone.now(),
    )
    resp = client.get("/api/listens/tracks/")
    assert resp.status_code == 200
    data = resp.json()
    # vid_1 now has 2 plays, should be first
    assert data["tracks"][0]["video_id"] == "vid_1"
    assert data["tracks"][0]["play_count"] == 2


@pytest.mark.django_db
def test_listen_top_tracks_pagination(client, sample_tracks, _disable_ssl_redirect):
    resp = client.get("/api/listens/tracks/?limit=2&offset=0")
    data = resp.json()
    assert len(data["tracks"]) == 2
    assert data["total"] == 5
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_listen.py -v -x`
Expected: Failures on the public-access tests (still getting 401) and new endpoint tests (404).

- [ ] **Step 3: Remove `@require_admin` from list and stats views**

In `website/views/listen.py`, remove the `@require_admin` decorator from `listen_list` and `listen_stats`. Also remove the `token_dict` / token extraction code from `listen_list` since it no longer needs auth:

```python
# listen_list: remove @require_admin decorator and token handling
@require_GET
def listen_list(request):
    limit = min(int(request.GET.get("limit", 50)), 200)
    offset = int(request.GET.get("offset", 0))
    # ... rest stays the same, just remove the decorator line above @require_GET
```

```python
# listen_stats: remove @require_admin decorator
@require_GET
def listen_stats(_request):
    # ... body unchanged
```

- [ ] **Step 4: Add top-tracks view function**

In `website/views/listen.py`, add after the existing view functions:

```python
@require_GET
def listen_top_tracks(request):
    limit = min(int(request.GET.get("limit", 50)), 200)
    offset = int(request.GET.get("offset", 0))

    tracks = (
        ListenTrack.objects.values("video_id", "title", "artist", "album", "thumbnail_url")
        .annotate(play_count=Count("id"))
        .order_by("-play_count")
    )
    total = tracks.count()
    page = list(tracks[offset : offset + limit])

    return JsonResponse({"tracks": page, "total": total})
```

Add the import if not present: `from django.db.models import Count` (it's already imported for stats).

- [ ] **Step 5: Add URL route for top-tracks**

In `website/urls.py`, add below the existing listens routes:

```python
path("listens/tracks/", views.listen_top_tracks),
```

**Important:** This must come before `path("listens/", ...)` in the URL list, or use the existing ordering where more-specific paths come first. Check the existing pattern — watches uses `watches/channels/<id>/tier/` before `watches/`. Follow the same pattern: add the new specific routes above the generic `listens/` route.

- [ ] **Step 6: Export the new view**

In `website/views/__init__.py`, add `listen_top_tracks` to the imports from `.listen`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_listen.py -v`
Expected: All tests pass, including the new top-tracks tests and the updated public-access tests.

- [ ] **Step 8: Commit**

```bash
git add website/views/listen.py website/views/__init__.py website/urls.py website/tests/test_listen.py
git commit -m "feat(listens): make list/stats public, add top-tracks endpoint"
```

---

## Task 2: Backend — Add top-artists and top-albums endpoints

**Files:**
- Modify: `website/views/listen.py`
- Modify: `website/urls.py`
- Modify: `website/views/__init__.py`
- Modify: `website/tests/test_listen.py`

### Steps

- [ ] **Step 1: Write tests for top-artists and top-albums**

Append to `website/tests/test_listen.py`:

```python
@pytest.mark.django_db
def test_listen_top_artists_empty(client, _disable_ssl_redirect):
    resp = client.get("/api/listens/artists/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["artists"] == []
    assert data["total"] == 0


@pytest.mark.django_db
def test_listen_top_artists_ranked(client, sample_tracks, _disable_ssl_redirect):
    """Artists with more plays rank higher. Each sample track has a unique artist."""
    from website.models import ListenTrack
    from django.utils import timezone

    # Give Artist 1 an extra play
    ListenTrack.objects.create(
        video_id="vid_extra", title="Bonus Track", artist="Artist 1",
        played_at=timezone.now(),
    )
    resp = client.get("/api/listens/artists/")
    data = resp.json()
    assert data["artists"][0]["name"] == "Artist 1"
    assert data["artists"][0]["play_count"] == 2
    assert data["artists"][0]["track_count"] == 2
    assert len(data["artists"][0]["top_tracks"]) <= 3


@pytest.mark.django_db
def test_listen_top_artists_pagination(client, sample_tracks, _disable_ssl_redirect):
    resp = client.get("/api/listens/artists/?limit=2&offset=0")
    data = resp.json()
    assert len(data["artists"]) == 2
    assert data["total"] == 5


@pytest.mark.django_db
def test_listen_top_albums_empty(client, _disable_ssl_redirect):
    resp = client.get("/api/listens/albums/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["albums"] == []
    assert data["total"] == 0


@pytest.mark.django_db
def test_listen_top_albums_ranked(client, sample_tracks, _disable_ssl_redirect):
    from website.models import ListenTrack
    from django.utils import timezone

    # sample_tracks have album="" by default. Create tracks with albums.
    ListenTrack.objects.create(
        video_id="alb1", title="Song A", artist="Band X", album="Album One",
        played_at=timezone.now(),
    )
    ListenTrack.objects.create(
        video_id="alb2", title="Song B", artist="Band X", album="Album One",
        played_at=timezone.now(),
    )
    ListenTrack.objects.create(
        video_id="alb3", title="Song C", artist="Band Y", album="Album Two",
        played_at=timezone.now(),
    )
    resp = client.get("/api/listens/albums/")
    data = resp.json()
    # Album One has 2 plays, should be first
    assert data["albums"][0]["name"] == "Album One"
    assert data["albums"][0]["play_count"] == 2
    assert data["albums"][0]["artist"] == "Band X"


@pytest.mark.django_db
def test_listen_top_albums_excludes_empty(client, sample_tracks, _disable_ssl_redirect):
    """Tracks with empty album field are excluded from albums listing."""
    resp = client.get("/api/listens/albums/")
    data = resp.json()
    # sample_tracks all have album="" so should be excluded
    assert data["total"] == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest website/tests/test_listen.py -v -x -k "artist or album"`
Expected: 404 errors (endpoints don't exist yet).

- [ ] **Step 3: Add top-artists view function**

In `website/views/listen.py`:

```python
@require_GET
def listen_top_artists(request):
    limit = min(int(request.GET.get("limit", 50)), 200)
    offset = int(request.GET.get("offset", 0))

    artists = (
        ListenTrack.objects.values("artist")
        .annotate(
            play_count=Count("id"),
            track_count=Count("video_id", distinct=True),
        )
        .order_by("-play_count")
    )
    total = artists.count()
    page = list(artists[offset : offset + limit])

    # Attach top 3 tracks per artist
    for entry in page:
        top = (
            ListenTrack.objects.filter(artist=entry["artist"])
            .values("video_id", "title", "thumbnail_url")
            .annotate(pc=Count("id"))
            .order_by("-pc")[:3]
        )
        entry["name"] = entry.pop("artist")
        entry["top_tracks"] = [
            {"video_id": t["video_id"], "title": t["title"], "thumbnail_url": t["thumbnail_url"]}
            for t in top
        ]

    return JsonResponse({"artists": page, "total": total})
```

- [ ] **Step 4: Add top-albums view function**

In `website/views/listen.py`:

```python
@require_GET
def listen_top_albums(request):
    limit = min(int(request.GET.get("limit", 50)), 200)
    offset = int(request.GET.get("offset", 0))

    albums = (
        ListenTrack.objects.exclude(album="")
        .values("album", "artist")
        .annotate(
            play_count=Count("id"),
            track_count=Count("video_id", distinct=True),
        )
        .order_by("-play_count")
    )
    total = albums.count()
    page = list(albums[offset : offset + limit])

    # Attach a thumbnail from any track on this album
    for entry in page:
        track = (
            ListenTrack.objects.filter(album=entry["album"], artist=entry["artist"])
            .exclude(thumbnail_url="")
            .values_list("thumbnail_url", flat=True)
            .first()
        )
        entry["name"] = entry.pop("album")
        entry["thumbnail_url"] = track or ""

    return JsonResponse({"albums": page, "total": total})
```

- [ ] **Step 5: Add URL routes and exports**

In `website/urls.py`, add above the generic `listens/` route:

```python
path("listens/artists/", views.listen_top_artists),
path("listens/albums/", views.listen_top_albums),
```

In `website/views/__init__.py`, add `listen_top_artists` and `listen_top_albums` to the imports from `.listen`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest website/tests/test_listen.py -v`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add website/views/listen.py website/views/__init__.py website/urls.py website/tests/test_listen.py
git commit -m "feat(listens): add top-artists and top-albums endpoints"
```

---

## Task 3: Frontend — Add TypeScript types for new API responses

**Files:**
- Modify: `frontend/src/lib/api.ts`

### Steps

- [ ] **Step 1: Add new interfaces**

In `frontend/src/lib/api.ts`, add after the existing `ListenStats` interface:

```typescript
export interface ListenTopTrack {
  video_id: string;
  title: string;
  artist: string;
  album: string;
  thumbnail_url: string;
  play_count: number;
}

export interface ListenTopArtist {
  name: string;
  play_count: number;
  track_count: number;
  top_tracks: { video_id: string; title: string; thumbnail_url: string }[];
}

export interface ListenTopAlbum {
  name: string;
  artist: string;
  thumbnail_url: string;
  play_count: number;
  track_count: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(listens): add TypeScript types for aggregation endpoints"
```

---

## Task 4: Frontend — PlayerContext and usePlayer hook

**Files:**
- Create: `frontend/src/lib/player.tsx`

This is the core state management for the mini player. It manages the queue, current track, playback state, and communicates with the YouTube IFrame API. No UI — just the context provider and hook.

### Steps

- [ ] **Step 1: Create PlayerContext**

Create `frontend/src/lib/player.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ListenTrack } from "./api";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  queue: ListenTrack[];
  currentIndex: number;
  playing: boolean;
  progress: number; // seconds
  duration: number; // seconds
  shuffle: boolean;
  repeat: RepeatMode;
  visible: boolean; // player card shown?
  minimized: boolean; // collapsed to tiny view?
}

interface PlayerActions {
  play: (track: ListenTrack, queue?: ListenTrack[]) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleMinimize: () => void;
  close: () => void;
}

type PlayerContextValue = PlayerState & PlayerActions;

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlayerState>({
    queue: [],
    currentIndex: 0,
    playing: false,
    progress: 0,
    duration: 0,
    shuffle: false,
    repeat: "off",
    visible: false,
    minimized: false,
  });

  const playerRef = useRef<YT.Player | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const apiReady = useRef(false);
  const pendingVideoId = useRef<string | null>(null);

  /* ---------- YouTube IFrame API loader ---------- */

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.YT && window.YT.Player) {
      apiReady.current = true;
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      apiReady.current = true;
      prev?.();
      if (pendingVideoId.current) {
        initPlayer(pendingVideoId.current);
        pendingVideoId.current = null;
      }
    };
    if (!document.getElementById("yt-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "yt-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Progress polling ---------- */

  useEffect(() => {
    if (state.playing) {
      intervalRef.current = setInterval(() => {
        const p = playerRef.current;
        if (p && typeof p.getCurrentTime === "function") {
          setState((s) => ({
            ...s,
            progress: p.getCurrentTime(),
            duration: p.getDuration() || s.duration,
          }));
        }
      }, 500);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state.playing]);

  /* ---------- Player init / load ---------- */

  function initPlayer(videoId: string) {
    if (playerRef.current) {
      playerRef.current.loadVideoById(videoId);
      return;
    }
    // Create a hidden container if it doesn't exist
    let container = document.getElementById("yt-player-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "yt-player-container";
      container.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden;";
      document.body.appendChild(container);
    }
    const div = document.createElement("div");
    div.id = "yt-player";
    container.appendChild(div);

    playerRef.current = new window.YT.Player("yt-player", {
      videoId,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1 },
      events: {
        onReady: (e: YT.PlayerEvent) => {
          e.target.playVideo();
          setState((s) => ({ ...s, duration: e.target.getDuration() || 0 }));
        },
        onStateChange: (e: YT.OnStateChangeEvent) => {
          if (e.data === window.YT.PlayerState.ENDED) {
            handleTrackEnd();
          }
          if (e.data === window.YT.PlayerState.PLAYING) {
            setState((s) => ({ ...s, playing: true }));
          }
          if (e.data === window.YT.PlayerState.PAUSED) {
            setState((s) => ({ ...s, playing: false }));
          }
        },
      },
    });
  }

  /* ---------- Track end handler ---------- */

  function handleTrackEnd() {
    setState((prev) => {
      if (prev.repeat === "one") {
        playerRef.current?.seekTo(0, true);
        playerRef.current?.playVideo();
        return { ...prev, progress: 0, playing: true };
      }
      let nextIndex = prev.currentIndex + 1;
      if (prev.shuffle) {
        nextIndex = Math.floor(Math.random() * prev.queue.length);
      }
      if (nextIndex >= prev.queue.length) {
        if (prev.repeat === "all") {
          nextIndex = 0;
        } else {
          return { ...prev, playing: false, progress: 0 };
        }
      }
      const nextTrack = prev.queue[nextIndex];
      if (nextTrack) {
        playerRef.current?.loadVideoById(nextTrack.video_id);
      }
      return { ...prev, currentIndex: nextIndex, progress: 0, playing: true };
    });
  }

  /* ---------- Actions ---------- */

  const play = useCallback((track: ListenTrack, queue?: ListenTrack[]) => {
    const q = queue || [track];
    const idx = q.findIndex((t) => t.video_id === track.video_id);
    setState((s) => ({
      ...s,
      queue: q,
      currentIndex: idx >= 0 ? idx : 0,
      playing: true,
      progress: 0,
      duration: 0,
      visible: true,
    }));
    if (apiReady.current) {
      initPlayer(track.video_id);
    } else {
      pendingVideoId.current = track.video_id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo();
  }, []);

  const resume = useCallback(() => {
    playerRef.current?.playVideo();
  }, []);

  const next = useCallback(() => {
    setState((prev) => {
      let nextIndex = prev.currentIndex + 1;
      if (prev.shuffle) {
        nextIndex = Math.floor(Math.random() * prev.queue.length);
      }
      if (nextIndex >= prev.queue.length) {
        nextIndex = prev.repeat === "all" ? 0 : prev.currentIndex;
      }
      const nextTrack = prev.queue[nextIndex];
      if (nextTrack && nextIndex !== prev.currentIndex) {
        playerRef.current?.loadVideoById(nextTrack.video_id);
      }
      return { ...prev, currentIndex: nextIndex, progress: 0 };
    });
  }, []);

  const prev = useCallback(() => {
    setState((p) => {
      // If more than 3s in, restart current track
      if (p.progress > 3) {
        playerRef.current?.seekTo(0, true);
        return { ...p, progress: 0 };
      }
      let prevIndex = p.currentIndex - 1;
      if (prevIndex < 0) prevIndex = p.repeat === "all" ? p.queue.length - 1 : 0;
      const prevTrack = p.queue[prevIndex];
      if (prevTrack && prevIndex !== p.currentIndex) {
        playerRef.current?.loadVideoById(prevTrack.video_id);
      }
      return { ...p, currentIndex: prevIndex, progress: 0 };
    });
  }, []);

  const seek = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
    setState((s) => ({ ...s, progress: seconds }));
  }, []);

  const toggleShuffle = useCallback(() => {
    setState((s) => ({ ...s, shuffle: !s.shuffle }));
  }, []);

  const cycleRepeat = useCallback(() => {
    setState((s) => {
      const modes: RepeatMode[] = ["off", "all", "one"];
      const next = modes[(modes.indexOf(s.repeat) + 1) % 3];
      return { ...s, repeat: next };
    });
  }, []);

  const toggleMinimize = useCallback(() => {
    setState((s) => ({ ...s, minimized: !s.minimized }));
  }, []);

  const close = useCallback(() => {
    playerRef.current?.stopVideo();
    setState((s) => ({
      ...s,
      visible: false,
      playing: false,
      queue: [],
      currentIndex: 0,
      progress: 0,
      duration: 0,
    }));
  }, []);

  const currentTrack = state.queue[state.currentIndex] || null;

  return (
    <PlayerContext.Provider
      value={{
        ...state,
        play,
        pause,
        resume,
        next,
        prev,
        seek,
        toggleShuffle,
        cycleRepeat,
        toggleMinimize,
        close,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export { PlayerContext };
export type { PlayerState, PlayerActions, RepeatMode };
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/player.tsx
git commit -m "feat: add PlayerContext with YouTube IFrame playback engine"
```

---

## Task 5: Frontend — MiniPlayer component

**Files:**
- Create: `frontend/src/components/MiniPlayer.tsx`

### Steps

- [ ] **Step 1: Create MiniPlayer component**

Create `frontend/src/components/MiniPlayer.tsx`:

```tsx
"use client";

import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";

function formatTime(s: number): string {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function MiniPlayer() {
  const p = usePlayer();
  const track = p.queue[p.currentIndex];

  if (!p.visible || !track) return null;

  const pct = p.duration > 0 ? (p.progress / p.duration) * 100 : 0;

  /* ---------- Minimized view ---------- */
  if (p.minimized) {
    return (
      <div
        style={{
          position: "fixed",
          bottom: "5rem",
          right: "1.5rem",
          zIndex: 140,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(14, 14, 14, 0.85)",
          backdropFilter: "blur(12px)",
          border: "1px solid #2a2a2a",
          borderRadius: 24,
          padding: "6px 14px 6px 6px",
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        }}
        onClick={p.toggleMinimize}
      >
        {track.thumbnail_url ? (
          <img
            src={track.thumbnail_url}
            alt=""
            style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: ACCENT,
              opacity: 0.6,
            }}
          />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            p.playing ? p.pause() : p.resume();
          }}
          style={{
            background: "none",
            border: "none",
            color: ACCENT,
            fontSize: 16,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {p.playing ? "❚❚" : "▶"}
        </button>
      </div>
    );
  }

  /* ---------- Full view ---------- */
  return (
    <div
      style={{
        position: "fixed",
        bottom: "5rem",
        right: "1.5rem",
        zIndex: 140,
        width: 280,
        background: "rgba(14, 14, 14, 0.85)",
        backdropFilter: "blur(12px)",
        border: "1px solid #2a2a2a",
        borderRadius: 12,
        padding: 12,
        boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
        fontFamily: "var(--font-body), sans-serif",
      }}
    >
      {/* Track info */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {track.thumbnail_url ? (
          <img
            src={track.thumbnail_url}
            alt=""
            style={{ width: 44, height: 44, borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 4,
              background: ACCENT,
              opacity: 0.5,
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: "#eee",
              fontSize: 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.title}
          </div>
          <div style={{ color: "#888", fontSize: 10 }}>{track.artist}</div>
        </div>
        {/* Minimize / Close */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={p.toggleMinimize}
            style={{ background: "none", border: "none", color: "#666", fontSize: 11, cursor: "pointer", padding: 2 }}
            title="Minimize"
          >
            ─
          </button>
          <button
            onClick={p.close}
            style={{ background: "none", border: "none", color: "#666", fontSize: 11, cursor: "pointer", padding: 2 }}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ margin: "8px 0 2px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#555", fontSize: 9, fontFamily: "monospace", minWidth: 28 }}>
          {formatTime(p.progress)}
        </span>
        <div
          style={{
            flex: 1,
            height: 3,
            background: "#333",
            borderRadius: 2,
            cursor: "pointer",
            position: "relative",
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            p.seek(ratio * p.duration);
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: ACCENT,
              borderRadius: 2,
              transition: "width 0.3s linear",
            }}
          />
        </div>
        <span style={{ color: "#555", fontSize: 9, fontFamily: "monospace", minWidth: 28, textAlign: "right" }}>
          {formatTime(p.duration)}
        </span>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 14, marginTop: 4 }}>
        <button
          onClick={p.toggleShuffle}
          style={{
            background: "none",
            border: "none",
            color: p.shuffle ? ACCENT : "#555",
            fontSize: 11,
            cursor: "pointer",
            padding: 2,
          }}
          title="Shuffle"
        >
          ⇌
        </button>
        <button
          onClick={p.prev}
          style={{ background: "none", border: "none", color: "#999", fontSize: 12, cursor: "pointer", padding: 2 }}
          title="Previous"
        >
          ⏮
        </button>
        <button
          onClick={() => (p.playing ? p.pause() : p.resume())}
          style={{
            background: "none",
            border: "none",
            color: ACCENT,
            fontSize: 18,
            cursor: "pointer",
            padding: "2px 6px",
          }}
          title={p.playing ? "Pause" : "Play"}
        >
          {p.playing ? "❚❚" : "▶"}
        </button>
        <button
          onClick={p.next}
          style={{ background: "none", border: "none", color: "#999", fontSize: 12, cursor: "pointer", padding: 2 }}
          title="Next"
        >
          ⏭
        </button>
        <button
          onClick={p.cycleRepeat}
          style={{
            background: "none",
            border: "none",
            color: p.repeat !== "off" ? ACCENT : "#555",
            fontSize: 11,
            cursor: "pointer",
            padding: 2,
            position: "relative",
          }}
          title={`Repeat: ${p.repeat}`}
        >
          ⟳
          {p.repeat === "one" && (
            <span style={{ position: "absolute", top: -2, right: -4, fontSize: 7, color: ACCENT }}>1</span>
          )}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/MiniPlayer.tsx
git commit -m "feat: add MiniPlayer floating card component"
```

---

## Task 6: Frontend — Wire PlayerProvider + MiniPlayer into root layout

**Files:**
- Modify: `frontend/src/app/layout.tsx`

### Steps

- [ ] **Step 1: Add PlayerProvider and MiniPlayer to root layout**

In `frontend/src/app/layout.tsx`, add imports at the top:

```tsx
import { PlayerProvider } from "@/lib/player";
import MiniPlayer from "@/components/MiniPlayer";
```

Then wrap the body content in `<PlayerProvider>` and add `<MiniPlayer />` alongside `<FeedbackButton />`:

```tsx
<body>
  <PlayerProvider>
    <div className="fixed inset-0 scanline z-[200] opacity-15 pointer-events-none" />
    <PageBackground />
    <Navbar />
    {children}
    <MiniPlayer />
    <FeedbackButton />
  </PlayerProvider>
</body>
```

Note: The root layout needs `"use client"` if it doesn't already have it — but since it currently uses server components (no "use client" directive), and PlayerProvider is a client component, we need to keep the layout as a server component and instead create a small client wrapper. Alternative approach: since the layout already imports `<FeedbackButton />` which is a client component, the `<PlayerProvider>` can also be used directly — Next.js supports client components within server component layouts as long as they're imported as components.

Actually, looking at the current layout: it imports `Navbar` and `FeedbackButton` (both client components) and renders them directly. This works because they're leaf client components. `PlayerProvider` wraps `{children}` so it needs to be a client component that accepts children — this is the standard pattern and works fine in a server layout.

- [ ] **Step 2: Verify dev server runs without errors**

Run: `cd frontend && pnpm dev` — check that the page loads without hydration errors. The mini player should be hidden (no tracks playing).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/layout.tsx
git commit -m "feat: wire PlayerProvider and MiniPlayer into root layout"
```

---

## Task 7: Frontend — Listens shared layout (hero + tabs)

**Files:**
- Create: `frontend/src/app/listens/layout.tsx`

This is the shared layout for all `/listens/*` routes. It renders the hero panel (latest track, top this month, stats, sparkline, top artists) and the tab bar. Sub-route content renders below via `{children}`.

### Steps

- [ ] **Step 1: Create the listens layout**

Create `frontend/src/app/listens/layout.tsx`:

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { API, type ListenTrack, type ListenStats } from "@/lib/api";
import { store } from "@/lib/auth";
import { timeAgo } from "@/lib/date";
import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";
const PANEL_BG = "rgba(14, 14, 14, 0.5)";

const TABS = [
  { label: "History", href: "/listens" },
  { label: "Tracks", href: "/listens/tracks" },
  { label: "Artists", href: "/listens/artists" },
  { label: "Albums", href: "/listens/albums" },
] as const;

export default function ListensLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const player = usePlayer();
  const [tracks, setTracks] = useState<ListenTrack[]>([]);
  const [stats, setStats] = useState<ListenStats | null>(null);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/listens/?limit=1`).then((r) => r.json()),
      fetch(`${API}/api/listens/stats/`).then((r) => r.json()),
    ]).then(([listData, statsData]) => {
      setTracks(listData.tracks || []);
      setStats(statsData);
    });
  }, []);

  const latest = tracks[0];
  const topTracks = stats?.top_tracks || [];
  const daily = stats?.daily || [];

  const maxDaily = Math.max(...daily.map((d) => d.count), 1);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1rem 1.5rem 2rem" }}>
      {/* ---- Hero ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 1,
          borderRadius: 8,
          overflow: "hidden",
          marginBottom: 0,
        }}
      >
        {/* Left panel */}
        <div
          style={{
            background: PANEL_BG,
            backdropFilter: "blur(12px)",
            padding: "24px",
          }}
        >
          {/* Latest */}
          <div style={{ color: ACCENT, fontSize: 10, letterSpacing: 2, fontFamily: "monospace", marginBottom: 12 }}>
            LATEST
          </div>
          {latest ? (
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 24 }}>
              {latest.thumbnail_url ? (
                <img
                  src={latest.thumbnail_url}
                  alt=""
                  style={{ width: 72, height: 72, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
                />
              ) : (
                <div style={{ width: 72, height: 72, borderRadius: 6, background: ACCENT, opacity: 0.4, flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#eee", fontSize: 18, fontFamily: "var(--font-headline)" }}>{latest.title}</div>
                <div style={{ color: "#999", fontSize: 13, marginTop: 2 }}>
                  {latest.artist}
                  {latest.album ? ` — ${latest.album}` : ""}
                </div>
                <div style={{ color: "#555", fontSize: 11, marginTop: 4, fontFamily: "monospace" }}>
                  {timeAgo(latest.played_at)}
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => player.play(latest)}
                  style={{
                    marginLeft: "auto",
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
            <div style={{ color: "#555", marginBottom: 24 }}>No listening data yet.</div>
          )}

          {/* Top This Month */}
          {topTracks.length > 0 && (
            <>
              <div style={{ color: ACCENT, fontSize: 10, letterSpacing: 1, fontFamily: "monospace", marginBottom: 10 }}>
                TOP THIS MONTH
              </div>
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                {topTracks.map((t, i) => (
                  <div
                    key={t.video_id}
                    style={{
                      flex: "0 0 100px",
                      background: "rgba(20,20,20,0.6)",
                      borderRadius: 6,
                      padding: 8,
                      border: "1px solid rgba(255,255,255,0.05)",
                      cursor: isAdmin ? "pointer" : "default",
                    }}
                    onClick={() => {
                      if (!isAdmin) return;
                      // Build queue of top tracks as ListenTrack objects
                      const queue: ListenTrack[] = topTracks.map((tt) => ({
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
                        style={{ width: 84, height: 84, borderRadius: 4, objectFit: "cover", marginBottom: 6 }}
                      />
                    ) : (
                      <div style={{ width: 84, height: 84, borderRadius: 4, background: "#1a1a1a", marginBottom: 6 }} />
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
                    <div style={{ color: "#666", fontSize: 9 }}>
                      {t.artist} · {t.play_count}×
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right panel */}
        <div
          style={{
            background: PANEL_BG,
            backdropFilter: "blur(12px)",
            padding: "24px",
            borderLeft: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {stats && (
            <>
              <div style={{ color: ACCENT, fontSize: 32, fontWeight: "bold", fontFamily: "var(--font-headline)" }}>
                {stats.total.toLocaleString()}
              </div>
              <div style={{ color: "#555", fontSize: 10, letterSpacing: 2, fontFamily: "monospace", marginBottom: 20 }}>
                TOTAL PLAYS
              </div>
              <div style={{ display: "flex", gap: 24, marginBottom: 20 }}>
                <div>
                  <div style={{ color: ACCENT, fontSize: 20, fontFamily: "var(--font-headline)" }}>{stats.today}</div>
                  <div style={{ color: "#555", fontSize: 9, letterSpacing: 1, fontFamily: "monospace" }}>TODAY</div>
                </div>
                <div>
                  <div style={{ color: ACCENT, fontSize: 20, fontFamily: "var(--font-headline)" }}>{stats.week}</div>
                  <div style={{ color: "#555", fontSize: 9, letterSpacing: 1, fontFamily: "monospace" }}>THIS WEEK</div>
                </div>
              </div>

              {/* Sparkline */}
              {daily.length > 0 && (
                <>
                  <div style={{ color: "#555", fontSize: 9, letterSpacing: 1, fontFamily: "monospace", marginBottom: 8 }}>
                    LAST 30 DAYS
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 50, marginBottom: 20 }}>
                    {daily.map((d) => (
                      <div
                        key={d.date}
                        style={{
                          flex: 1,
                          background: ACCENT,
                          opacity: 0.15 + (d.count / maxDaily) * 0.7,
                          height: `${Math.max(4, (d.count / maxDaily) * 100)}%`,
                          borderRadius: 1,
                        }}
                        title={`${d.date}: ${d.count}`}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Top Artists */}
              {stats.top_tracks.length > 0 && (
                <>
                  <div
                    style={{ color: "#555", fontSize: 9, letterSpacing: 1, fontFamily: "monospace", marginBottom: 8 }}
                  >
                    TOP ARTISTS
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Derive top artists from top_tracks */}
                    {(() => {
                      const artistMap = new Map<string, number>();
                      for (const t of stats.top_tracks) {
                        artistMap.set(t.artist, (artistMap.get(t.artist) || 0) + t.play_count);
                      }
                      return [...artistMap.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([name, count]) => (
                          <div key={name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                background: `color-mix(in srgb, ${ACCENT} 30%, #222)`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 10,
                                color: ACCENT,
                                fontWeight: "bold",
                                flexShrink: 0,
                              }}
                            >
                              {name.charAt(0).toUpperCase()}
                            </div>
                            <div style={{ color: "#ccc", fontSize: 11, flex: 1 }}>{name}</div>
                            <div style={{ color: "#555", fontSize: 10, fontFamily: "monospace" }}>{count}×</div>
                          </div>
                        ));
                    })()}
                  </div>
                </>
              )}

              {/* Sync button (admin only) */}
              {isAdmin && (
                <button
                  onClick={() => {
                    const token = store("adminToken");
                    if (token) window.location.href = `${API}/api/listens/auth/?token=${token}`;
                  }}
                  style={{
                    marginTop: 20,
                    background: "none",
                    border: `1px solid rgba(249,115,22,0.3)`,
                    color: ACCENT,
                    padding: "6px 14px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "monospace",
                    letterSpacing: 1,
                    width: "100%",
                  }}
                >
                  SYNC
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---- Tab bar ---- */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          marginTop: 1,
          background: PANEL_BG,
          backdropFilter: "blur(12px)",
          overflowX: "auto",
        }}
      >
        {TABS.map((tab) => {
          const active = tab.href === "/listens" ? pathname === "/listens" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                padding: "10px 20px",
                color: active ? ACCENT : "#555",
                fontSize: 11,
                letterSpacing: 1,
                fontFamily: "monospace",
                textDecoration: "none",
                borderBottom: active ? `2px solid ${ACCENT}` : "2px solid transparent",
                whiteSpace: "nowrap",
                transition: "color 0.15s",
              }}
            >
              {tab.label.toUpperCase()}
            </Link>
          );
        })}
      </div>

      {/* ---- Sub-route content ---- */}
      <div style={{ marginTop: 1 }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the layout renders**

Run: `cd frontend && pnpm dev` — navigate to `/listens`. The hero and tab bar should render (content area will be whatever the existing page.tsx renders).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/listens/layout.tsx
git commit -m "feat(listens): add shared layout with hero panel and tab bar"
```

---

## Task 8: Frontend — History sub-page (rewrite page.tsx)

**Files:**
- Rewrite: `frontend/src/app/listens/page.tsx`

The current page.tsx is a 607-line monolith. Replace it entirely with just the history feed — the hero/stats/tabs are now in `layout.tsx`.

### Steps

- [ ] **Step 1: Rewrite page.tsx as the history feed**

Replace the entire content of `frontend/src/app/listens/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { API, type ListenTrack } from "@/lib/api";
import { store } from "@/lib/auth";
import { timeAgo } from "@/lib/date";
import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";
const PANEL_BG = "rgba(14, 14, 14, 0.5)";
const PAGE_SIZE = 50;

export default function ListensHistoryPage() {
  const player = usePlayer();
  const [tracks, setTracks] = useState<ListenTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  const fetchTracks = useCallback(async (offset: number) => {
    const resp = await fetch(`${API}/api/listens/?limit=${PAGE_SIZE}&offset=${offset}`);
    return resp.json();
  }, []);

  useEffect(() => {
    fetchTracks(0).then((data) => {
      setTracks(data.tracks || []);
      setTotal(data.total || 0);
      setLoading(false);
    });
  }, [fetchTracks]);

  const loadMore = async () => {
    setLoadingMore(true);
    const data = await fetchTracks(tracks.length);
    setTracks((prev) => [...prev, ...(data.tracks || [])]);
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        Loading...
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        No listening history yet.
      </div>
    );
  }

  return (
    <div style={{ background: PANEL_BG, backdropFilter: "blur(12px)", borderRadius: "0 0 8px 8px", padding: 20 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "4px 24px",
        }}
      >
        {tracks.map((track, i) => (
          <div
            key={`${track.id}-${i}`}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              padding: "8px 4px",
              borderBottom: "1px solid rgba(255,255,255,0.03)",
              transition: "background 0.15s",
              borderRadius: 4,
              cursor: isAdmin ? "pointer" : "default",
            }}
            onClick={() => {
              if (isAdmin) player.play(track, tracks);
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "transparent";
            }}
          >
            {track.thumbnail_url ? (
              <img
                src={track.thumbnail_url}
                alt=""
                style={{ width: 36, height: 36, borderRadius: 3, objectFit: "cover", flexShrink: 0 }}
              />
            ) : (
              <div
                style={{ width: 36, height: 36, borderRadius: 3, background: "#1a1a1a", flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: "#ddd",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {track.title}
              </div>
              <div style={{ color: "#666", fontSize: 10 }}>{track.artist}</div>
            </div>
            <div style={{ color: "#444", fontSize: 10, fontFamily: "monospace", flexShrink: 0 }}>
              {timeAgo(track.played_at)}
            </div>
          </div>
        ))}
      </div>

      {/* Load More */}
      {tracks.length < total && (
        <div style={{ textAlign: "center", padding: "16px 0 4px" }}>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              background: "none",
              border: "none",
              color: loadingMore ? "#444" : ACCENT,
              fontSize: 10,
              letterSpacing: 1,
              fontFamily: "monospace",
              cursor: loadingMore ? "default" : "pointer",
              padding: "8px 16px",
            }}
          >
            {loadingMore ? "LOADING..." : "LOAD MORE"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Handle error query param from OAuth callback**

The OAuth callback redirects to `/listens?error=...`. Add error display to the history page. Insert at the top of the component, after the state declarations:

```tsx
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const err = params.get("error");
  if (err) {
    setError(err);
    window.history.replaceState({}, "", "/listens");
  }
}, []);
```

And render it above the grid:

```tsx
{error && (
  <div
    style={{
      padding: "10px 14px",
      marginBottom: 16,
      background: "rgba(239,68,68,0.1)",
      border: "1px solid rgba(239,68,68,0.3)",
      borderRadius: 6,
      color: "#f87171",
      fontSize: 12,
    }}
  >
    {error}
  </div>
)}
```

- [ ] **Step 3: Test in browser**

Run: `cd frontend && pnpm dev` — navigate to `/listens`. Verify:
- Hero panel + tabs render from layout
- History feed renders below with two-column grid
- Clicking tabs navigates between routes (other routes won't have content yet — that's ok)
- Admin play button works (if logged in)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/listens/page.tsx
git commit -m "feat(listens): rewrite history page as sub-route of shared layout"
```

---

## Task 9: Frontend — Top Tracks sub-page

**Files:**
- Create: `frontend/src/app/listens/tracks/page.tsx`

### Steps

- [ ] **Step 1: Create the tracks page**

Create `frontend/src/app/listens/tracks/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { API, type ListenTopTrack, type ListenTrack } from "@/lib/api";
import { store } from "@/lib/auth";
import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";
const PANEL_BG = "rgba(14, 14, 14, 0.5)";
const PAGE_SIZE = 50;

function topTrackToListenTrack(t: ListenTopTrack): ListenTrack {
  return {
    id: 0,
    video_id: t.video_id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    thumbnail_url: t.thumbnail_url,
    duration: "",
    played_at: "",
  };
}

export default function ListensTracksPage() {
  const player = usePlayer();
  const [tracks, setTracks] = useState<ListenTopTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  const fetchTracks = useCallback(async (offset: number) => {
    const resp = await fetch(`${API}/api/listens/tracks/?limit=${PAGE_SIZE}&offset=${offset}`);
    return resp.json();
  }, []);

  useEffect(() => {
    fetchTracks(0).then((data) => {
      setTracks(data.tracks || []);
      setTotal(data.total || 0);
      setLoading(false);
    });
  }, [fetchTracks]);

  const loadMore = async () => {
    setLoadingMore(true);
    const data = await fetchTracks(tracks.length);
    setTracks((prev) => [...prev, ...(data.tracks || [])]);
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        Loading...
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        No tracks yet.
      </div>
    );
  }

  const allAsListenTracks = tracks.map(topTrackToListenTrack);

  return (
    <div style={{ background: PANEL_BG, backdropFilter: "blur(12px)", borderRadius: "0 0 8px 8px", padding: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {tracks.map((track, i) => (
          <div
            key={track.video_id}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "8px 6px",
              borderBottom: "1px solid rgba(255,255,255,0.03)",
              borderRadius: 4,
              cursor: isAdmin ? "pointer" : "default",
              transition: "background 0.15s",
            }}
            onClick={() => {
              if (isAdmin) player.play(allAsListenTracks[i], allAsListenTracks);
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "transparent";
            }}
          >
            {/* Rank */}
            <div
              style={{
                width: 28,
                textAlign: "right",
                color: i < 3 ? ACCENT : "#555",
                fontSize: 13,
                fontFamily: "monospace",
                fontWeight: i < 3 ? "bold" : "normal",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            {/* Thumbnail */}
            {track.thumbnail_url ? (
              <img
                src={track.thumbnail_url}
                alt=""
                style={{ width: 40, height: 40, borderRadius: 3, objectFit: "cover", flexShrink: 0 }}
              />
            ) : (
              <div style={{ width: 40, height: 40, borderRadius: 3, background: "#1a1a1a", flexShrink: 0 }} />
            )}
            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: "#ddd",
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {track.title}
              </div>
              <div style={{ color: "#666", fontSize: 10 }}>{track.artist}</div>
            </div>
            {/* Play count */}
            <div style={{ color: ACCENT, fontSize: 12, fontFamily: "monospace", flexShrink: 0 }}>
              {track.play_count}×
            </div>
          </div>
        ))}
      </div>

      {tracks.length < total && (
        <div style={{ textAlign: "center", padding: "16px 0 4px" }}>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              background: "none",
              border: "none",
              color: loadingMore ? "#444" : ACCENT,
              fontSize: 10,
              letterSpacing: 1,
              fontFamily: "monospace",
              cursor: loadingMore ? "default" : "pointer",
              padding: "8px 16px",
            }}
          >
            {loadingMore ? "LOADING..." : "LOAD MORE"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `/listens/tracks`. Should show ranked list of tracks by play count.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/listens/tracks/page.tsx
git commit -m "feat(listens): add top tracks sub-page"
```

---

## Task 10: Frontend — Top Artists sub-page

**Files:**
- Create: `frontend/src/app/listens/artists/page.tsx`

### Steps

- [ ] **Step 1: Create the artists page**

Create `frontend/src/app/listens/artists/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { API, type ListenTopArtist, type ListenTrack } from "@/lib/api";
import { store } from "@/lib/auth";
import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";
const PANEL_BG = "rgba(14, 14, 14, 0.5)";
const PAGE_SIZE = 30;

export default function ListensArtistsPage() {
  const player = usePlayer();
  const [artists, setArtists] = useState<ListenTopArtist[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  const fetchArtists = useCallback(async (offset: number) => {
    const resp = await fetch(`${API}/api/listens/artists/?limit=${PAGE_SIZE}&offset=${offset}`);
    return resp.json();
  }, []);

  useEffect(() => {
    fetchArtists(0).then((data) => {
      setArtists(data.artists || []);
      setTotal(data.total || 0);
      setLoading(false);
    });
  }, [fetchArtists]);

  const loadMore = async () => {
    setLoadingMore(true);
    const data = await fetchArtists(artists.length);
    setArtists((prev) => [...prev, ...(data.artists || [])]);
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        Loading...
      </div>
    );
  }

  if (artists.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        No artists yet.
      </div>
    );
  }

  return (
    <div style={{ background: PANEL_BG, backdropFilter: "blur(12px)", borderRadius: "0 0 8px 8px", padding: 20 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        {artists.map((artist) => (
          <div
            key={artist.name}
            style={{
              background: "rgba(20, 20, 20, 0.6)",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 8,
              padding: 16,
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = `rgba(249,115,22,0.2)`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.05)";
            }}
          >
            {/* Monogram + Name */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: `color-mix(in srgb, ${ACCENT} 25%, #1a1a1a)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  color: ACCENT,
                  fontWeight: "bold",
                  fontFamily: "var(--font-headline)",
                  flexShrink: 0,
                }}
              >
                {artist.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: "#eee",
                    fontSize: 14,
                    fontFamily: "var(--font-headline)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {artist.name}
                </div>
                <div style={{ color: "#666", fontSize: 10, fontFamily: "monospace" }}>
                  {artist.play_count}× · {artist.track_count} tracks
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => {
                    const queue: ListenTrack[] = artist.top_tracks.map((t) => ({
                      id: 0,
                      video_id: t.video_id,
                      title: t.title,
                      artist: artist.name,
                      album: "",
                      thumbnail_url: t.thumbnail_url,
                      duration: "",
                      played_at: "",
                    }));
                    if (queue.length) player.play(queue[0], queue);
                  }}
                  style={{
                    background: "none",
                    border: `1px solid rgba(249,115,22,0.3)`,
                    color: ACCENT,
                    borderRadius: 4,
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontSize: 10,
                    flexShrink: 0,
                  }}
                >
                  ▶ ALL
                </button>
              )}
            </div>

            {/* Top tracks */}
            {artist.top_tracks.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {artist.top_tracks.map((t) => (
                  <div
                    key={t.video_id}
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    {t.thumbnail_url ? (
                      <img
                        src={t.thumbnail_url}
                        alt=""
                        style={{ width: 20, height: 20, borderRadius: 2, objectFit: "cover", flexShrink: 0 }}
                      />
                    ) : (
                      <div style={{ width: 20, height: 20, borderRadius: 2, background: "#222", flexShrink: 0 }} />
                    )}
                    <div
                      style={{
                        color: "#aaa",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.title}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {artists.length < total && (
        <div style={{ textAlign: "center", padding: "16px 0 4px" }}>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              background: "none",
              border: "none",
              color: loadingMore ? "#444" : ACCENT,
              fontSize: 10,
              letterSpacing: 1,
              fontFamily: "monospace",
              cursor: loadingMore ? "default" : "pointer",
              padding: "8px 16px",
            }}
          >
            {loadingMore ? "LOADING..." : "LOAD MORE"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `/listens/artists`. Should show artist cards in a 3-column grid.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/listens/artists/page.tsx
git commit -m "feat(listens): add top artists sub-page"
```

---

## Task 11: Frontend — Top Albums sub-page

**Files:**
- Create: `frontend/src/app/listens/albums/page.tsx`

### Steps

- [ ] **Step 1: Create the albums page**

Create `frontend/src/app/listens/albums/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { API, type ListenTopAlbum, type ListenTrack } from "@/lib/api";
import { store } from "@/lib/auth";
import { usePlayer } from "@/lib/player";

const ACCENT = "#f97316";
const PANEL_BG = "rgba(14, 14, 14, 0.5)";
const PAGE_SIZE = 30;

export default function ListensAlbumsPage() {
  const player = usePlayer();
  const [albums, setAlbums] = useState<ListenTopAlbum[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  const fetchAlbums = useCallback(async (offset: number) => {
    const resp = await fetch(`${API}/api/listens/albums/?limit=${PAGE_SIZE}&offset=${offset}`);
    return resp.json();
  }, []);

  useEffect(() => {
    fetchAlbums(0).then((data) => {
      setAlbums(data.albums || []);
      setTotal(data.total || 0);
      setLoading(false);
    });
  }, [fetchAlbums]);

  const loadMore = async () => {
    setLoadingMore(true);
    const data = await fetchAlbums(albums.length);
    setAlbums((prev) => [...prev, ...(data.albums || [])]);
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        Loading...
      </div>
    );
  }

  if (albums.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        No albums yet.
      </div>
    );
  }

  return (
    <div style={{ background: PANEL_BG, backdropFilter: "blur(12px)", borderRadius: "0 0 8px 8px", padding: 20 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        {albums.map((album) => (
          <div
            key={`${album.name}-${album.artist}`}
            style={{
              background: "rgba(20, 20, 20, 0.6)",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 8,
              overflow: "hidden",
              transition: "border-color 0.15s",
              cursor: isAdmin ? "pointer" : "default",
            }}
            onClick={async () => {
              if (!isAdmin) return;
              // Fetch album's tracks from the history endpoint filtered by album+artist
              // and build a queue from the deduplicated results
              const resp = await fetch(
                `${API}/api/listens/?limit=200&offset=0`
              );
              const data = await resp.json();
              const seen = new Set<string>();
              const queue: ListenTrack[] = [];
              for (const t of data.tracks as ListenTrack[]) {
                if (t.album === album.name && t.artist === album.artist && !seen.has(t.video_id)) {
                  seen.add(t.video_id);
                  queue.push(t);
                }
              }
              if (queue.length) player.play(queue[0], queue);
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(249,115,22,0.2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.05)";
            }}
          >
            {/* Album art */}
            {album.thumbnail_url ? (
              <img
                src={album.thumbnail_url}
                alt=""
                style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  aspectRatio: "1",
                  background: `color-mix(in srgb, ${ACCENT} 15%, #111)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                  color: ACCENT,
                  fontWeight: "bold",
                }}
              >
                {album.name.charAt(0).toUpperCase()}
              </div>
            )}
            {/* Info */}
            <div style={{ padding: "10px 12px" }}>
              <div
                style={{
                  color: "#eee",
                  fontSize: 13,
                  fontFamily: "var(--font-headline)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  marginBottom: 2,
                }}
              >
                {album.name}
              </div>
              <div style={{ color: "#888", fontSize: 10, marginBottom: 4 }}>{album.artist}</div>
              <div style={{ color: "#555", fontSize: 10, fontFamily: "monospace" }}>
                {album.play_count}× · {album.track_count} tracks
              </div>
            </div>
          </div>
        ))}
      </div>

      {albums.length < total && (
        <div style={{ textAlign: "center", padding: "16px 0 4px" }}>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              background: "none",
              border: "none",
              color: loadingMore ? "#444" : ACCENT,
              fontSize: 10,
              letterSpacing: 1,
              fontFamily: "monospace",
              cursor: loadingMore ? "default" : "pointer",
              padding: "8px 16px",
            }}
          >
            {loadingMore ? "LOADING..." : "LOAD MORE"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `/listens/albums`. Should show album cards in a 3-column grid with album art.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/listens/albums/page.tsx
git commit -m "feat(listens): add top albums sub-page"
```

---

## Task 12: Responsive styles + mobile mini player

**Files:**
- Modify: `frontend/src/app/listens/layout.tsx`
- Modify: `frontend/src/app/listens/page.tsx`
- Modify: `frontend/src/app/listens/artists/page.tsx`
- Modify: `frontend/src/app/listens/albums/page.tsx`
- Modify: `frontend/src/components/MiniPlayer.tsx`

CSS media queries can't be used in inline styles. Use a `useMediaQuery` approach or add a `<style>` tag. The simplest approach matching the existing codebase pattern: use a custom hook that returns the breakpoint, then conditionally set styles.

### Steps

- [ ] **Step 1: Create a useBreakpoint hook**

Create `frontend/src/lib/useBreakpoint.ts`:

```tsx
"use client";

import { useEffect, useState } from "react";

type Breakpoint = "mobile" | "tablet" | "desktop";

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>("desktop");

  useEffect(() => {
    function update() {
      const w = window.innerWidth;
      setBp(w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop");
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return bp;
}
```

- [ ] **Step 2: Apply responsive styles to listens layout**

In `frontend/src/app/listens/layout.tsx`, import and use the hook:

```tsx
import { useBreakpoint } from "@/lib/useBreakpoint";
```

Inside the component:

```tsx
const bp = useBreakpoint();
const isMobile = bp === "mobile";
const isTablet = bp === "tablet";
```

Update the hero grid:

```tsx
// Change gridTemplateColumns based on breakpoint
gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr",
```

On mobile, the right panel stats should render as a compact horizontal row at the top (before the left panel content). This requires reordering the panels — use CSS `order` property or conditionally render in different order.

For mobile layout, render stats as a horizontal bar first, then the left panel content below it:

```tsx
// On mobile, swap order: stats bar on top
{isMobile && stats && (
  <div style={{ display: "flex", justifyContent: "space-around", padding: 14, background: PANEL_BG, backdropFilter: "blur(12px)" }}>
    <div style={{ textAlign: "center" }}>
      <div style={{ color: ACCENT, fontSize: 16, fontWeight: "bold" }}>{stats.today}</div>
      <div style={{ color: "#555", fontSize: 8, letterSpacing: 1, fontFamily: "monospace" }}>TODAY</div>
    </div>
    <div style={{ textAlign: "center" }}>
      <div style={{ color: ACCENT, fontSize: 16, fontWeight: "bold" }}>{stats.week}</div>
      <div style={{ color: "#555", fontSize: 8, letterSpacing: 1, fontFamily: "monospace" }}>WEEK</div>
    </div>
    <div style={{ textAlign: "center" }}>
      <div style={{ color: ACCENT, fontSize: 16, fontWeight: "bold" }}>{stats.total.toLocaleString()}</div>
      <div style={{ color: "#555", fontSize: 8, letterSpacing: 1, fontFamily: "monospace" }}>TOTAL</div>
    </div>
  </div>
)}
```

Hide the right panel entirely on mobile (it's replaced by the compact bar above).

- [ ] **Step 3: Apply responsive styles to history page**

In `frontend/src/app/listens/page.tsx`:

```tsx
import { useBreakpoint } from "@/lib/useBreakpoint";
// ...
const bp = useBreakpoint();
// ...
gridTemplateColumns: bp === "mobile" ? "1fr" : "1fr 1fr",
```

- [ ] **Step 4: Apply responsive styles to artists and albums pages**

In both `artists/page.tsx` and `albums/page.tsx`:

```tsx
import { useBreakpoint } from "@/lib/useBreakpoint";
// ...
const bp = useBreakpoint();
// ...
gridTemplateColumns: bp === "mobile" ? "1fr" : bp === "tablet" ? "repeat(2, 1fr)" : "repeat(3, 1fr)",
```

- [ ] **Step 5: Mobile mini player — full-width bottom bar**

In `frontend/src/components/MiniPlayer.tsx`, import the hook and adjust positioning:

```tsx
import { useBreakpoint } from "@/lib/useBreakpoint";
// ...
const bp = useBreakpoint();
const isMobile = bp === "mobile";
```

For the full view on mobile, change the container styles:

```tsx
// Mobile: full-width bottom bar
position: "fixed",
bottom: isMobile ? 0 : "5rem",
right: isMobile ? 0 : "1.5rem",
left: isMobile ? 0 : "auto",
width: isMobile ? "100%" : 280,
borderRadius: isMobile ? 0 : 12,
```

- [ ] **Step 6: Verify responsive behavior in browser**

Test at different viewport widths (375px, 768px, 1200px). Verify:
- Mobile: stats bar, single column, bottom bar player
- Tablet: two-column grids, floating player
- Desktop: full magazine layout, floating player

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/useBreakpoint.ts frontend/src/app/listens/layout.tsx frontend/src/app/listens/page.tsx frontend/src/app/listens/tracks/page.tsx frontend/src/app/listens/artists/page.tsx frontend/src/app/listens/albums/page.tsx frontend/src/components/MiniPlayer.tsx
git commit -m "feat(listens): add responsive styles and mobile mini player"
```

---

## Task 13: Update CLAUDE.md, docs, and QA checklist

**Files:**
- Modify: `CLAUDE.md` (update API endpoints section)
- Modify: `docs/README.md` (update listens description)
- Modify: `docs/QA-CHECKLIST.md` (add listens QA items)

### Steps

- [ ] **Step 1: Update CLAUDE.md API endpoints**

Add the 3 new endpoints to the API Endpoints section:

```
GET  /api/listens/tracks/     top tracks by play count
GET  /api/listens/artists/    top artists by play count
GET  /api/listens/albums/     top albums by play count
```

Also update the `GET /api/listens/` line to remove any mention of auth being required (it's now public).

- [ ] **Step 2: Update docs/README.md**

Add/update the Listens section to describe the redesigned page: magazine layout, sub-pages (history, tracks, artists, albums), and the mini music player.

- [ ] **Step 3: Update docs/QA-CHECKLIST.md**

Add QA items for:
- Listens page loads publicly (no auth required)
- Hero panel shows latest track, top this month, stats, sparkline
- Tab navigation works between History / Tracks / Artists / Albums
- Each sub-page loads and paginates correctly
- Admin can sync via OAuth flow
- Admin can play tracks (mini player appears)
- Mini player: play/pause, next/prev, shuffle, repeat, seek, minimize, close
- Mini player persists when navigating to other pages
- Responsive: mobile, tablet, desktop layouts
- Error state: OAuth callback error displays correctly

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs: update docs for listens redesign and mini player"
```

---

## Task 14: Final verification

### Steps

- [ ] **Step 1: Run all backend tests**

Run: `uv run pytest -v`
Expected: All tests pass.

- [ ] **Step 2: Run frontend lint and type check**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: No lint errors, build succeeds.

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend && pnpm test`
Expected: All existing tests pass.

- [ ] **Step 4: Visual verification with dev servers**

Run both dev servers and manually verify:
1. `/listens` — hero + history feed
2. `/listens/tracks` — ranked tracks
3. `/listens/artists` — artist grid
4. `/listens/albums` — album grid
5. Mini player — play a track, verify controls, navigate to another page (e.g. `/watches`), verify player persists
6. Mobile viewport — verify responsive collapse
7. Logged out — verify no play buttons or sync button visible

- [ ] **Step 5: Take Playwright screenshots for visual record**

Use Playwright MCP to screenshot `/listens`, `/listens/tracks`, `/listens/artists`, `/listens/albums` at both desktop and mobile widths.
