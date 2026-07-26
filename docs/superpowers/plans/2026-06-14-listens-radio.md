# Listens Radio (Auto Play) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an endless "radio" mode to the global music player so playback never dead-ends — when the queue nears its end it auto-fetches tracks related to the current song (via the existing music graph) and appends them.

**Architecture:** A new backend service function `radio_next` walks the existing `MusicNode`/`MusicEdge` graph from the current track to score related track nodes and returns `ListenTrack`-shaped dicts, exposed at `GET /api/listens/radio/`. The frontend player gains a persisted `radio` boolean; a proactive effect tops up the queue when ≤2 tracks remain, and a pending-advance fallback covers the rare case where the queue runs dry mid-fetch. A toggle button is added to `MiniPlayer`.

**Tech Stack:** Django 6 + pytest (backend), Next.js/React 19 + TypeScript + vitest (frontend). All playback is YouTube IFrame API backed (existing).

**Worktree:** Work happens in `.claude/worktrees/listens-radio` on branch `feat/listens-radio` (already created).

---

## File Structure

**Backend:**
- Modify `website/services/music_graph.py` — add `radio_next()` + `_node_to_track()` helpers + scoring constants.
- Modify `website/views/listen.py` — add `listen_radio` view.
- Modify `website/views/__init__.py` — export `listen_radio`.
- Modify `website/urls.py` — route `listens/radio/`.
- Create `website/tests/test_listens_radio.py` — service + endpoint tests.

**Frontend:**
- Create `frontend/src/lib/radio.ts` — pure helpers (`shouldTopUp`, `buildExcludeList`, constants).
- Create `frontend/src/lib/__tests__/radio.test.ts` — vitest for the pure helpers.
- Modify `frontend/src/lib/api.ts` — add `fetchRadioTracks()`.
- Modify `frontend/src/lib/player.tsx` — add `radio` state, persistence, top-up logic, `toggleRadio`.
- Modify `frontend/src/components/MiniPlayer.tsx` — add radio toggle button.

**Docs:**
- Modify `CLAUDE.md`, `docs/README.md`, `docs/QA-CHECKLIST.md`.

---

## Task 1: Backend `radio_next` service function

**Files:**
- Modify: `website/services/music_graph.py`
- Test: `website/tests/test_listens_radio.py`

- [ ] **Step 1: Write the failing test**

Create `website/tests/test_listens_radio.py`:

```python
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
            video_id=vid, title=title, artist=artist, album=album,
            thumbnail_url=f"https://img/{vid}.jpg", duration="3:00", played_at=now,
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest website/tests/test_listens_radio.py -v`
Expected: FAIL — `AttributeError: module 'website.services.music_graph' has no attribute 'radio_next'`.

- [ ] **Step 3: Implement `radio_next` + `_node_to_track`**

In `website/services/music_graph.py`, add these constants near the other module constants (e.g. just after `STRUCTURAL_WEIGHT = 0.5` around line 150):

```python
# --- Radio (endless auto-play) selection ---
RADIO_EDGE_PRIORITY = {
    "similar_track": 3.0,
    "colisten": 2.5,
    "similar_artist": 1.5,
    "structural": 1.0,
}
RADIO_CANDIDATE_POOL = 12  # weighted-random pick from this many top-scored candidates
```

Add these functions at the end of the file (after `build_graph`):

```python
def _node_to_track(node: MusicNode) -> dict:
    """Shape a track MusicNode as a frontend ListenTrack dict.

    Graph nodes store title/subtitle(artist)/thumbnail/video_id only; id, album,
    duration and played_at come from the latest ListenTrack row for the video_id.
    """
    lt = ListenTrack.objects.filter(video_id=node.video_id).order_by("-played_at").first()
    return {
        "id": lt.id if lt else 0,
        "video_id": node.video_id,
        "title": node.title,
        "artist": node.subtitle,
        "album": lt.album if lt else "",
        "thumbnail_url": node.thumbnail_url,
        "duration": lt.duration if lt else "",
        "played_at": lt.played_at.isoformat() if lt else "",
    }


def radio_next(seed_video_id, exclude_video_ids=None, limit=5) -> list[dict]:
    """Pick the next radio tracks related to `seed_video_id` via the music graph.

    Pure graph-based: BFS (depth 2) from the seed track node over
    similar_track / colisten / similar_artist / structural edges, scoring candidate
    track nodes by edge weight x edge-type priority (decayed by hop depth). Returns up
    to `limit` ListenTrack-shaped dicts chosen by weighted-random sampling (for variety).
    Returns [] when the seed is unknown or yields no fresh, playable track neighbours.
    """
    exclude = set(exclude_video_ids or ())
    exclude.add(seed_video_id)

    seed = MusicNode.objects.filter(node_type="track", key=seed_video_id).first()
    if seed is None:
        return []

    scores: dict[int, float] = {}
    frontier = {seed.id}
    visited = {seed.id}
    for depth in range(2):
        edges = _neighbors(frontier)
        next_frontier: set[int] = set()
        for e in edges:
            for a, b in ((e.source_id, e.target_id), (e.target_id, e.source_id)):
                if a in frontier and b not in visited:
                    next_frontier.add(b)
                    prio = RADIO_EDGE_PRIORITY.get(e.edge_type, 1.0)
                    scores[b] = scores.get(b, 0.0) + e.weight * prio / (depth + 1)
        visited |= next_frontier
        frontier = next_frontier
        if not frontier:
            break

    if not scores:
        return []

    candidate_nodes = MusicNode.objects.filter(id__in=scores.keys(), node_type="track")
    candidates = [(n, scores[n.id]) for n in candidate_nodes if n.video_id and n.video_id not in exclude]
    if not candidates:
        return []

    candidates.sort(key=lambda c: c[1], reverse=True)
    pool = candidates[:RADIO_CANDIDATE_POOL]

    chosen: list[MusicNode] = []
    available = list(pool)
    for _ in range(min(limit, len(pool))):
        nodes = [c[0] for c in available]
        weights = [c[1] for c in available]
        pick = random.choices(nodes, weights=weights, k=1)[0]
        chosen.append(pick)
        available = [c for c in available if c[0].id != pick.id]

    return [_node_to_track(n) for n in chosen]
```

(Note: `random`, `MusicNode`, `MusicEdge`, `ListenTrack`, and `_neighbors` are already imported/defined in this module.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest website/tests/test_listens_radio.py -v`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add website/services/music_graph.py website/tests/test_listens_radio.py
git commit -m "feat(listens): radio_next graph-based track selection"
```

---

## Task 2: Backend radio endpoint

**Files:**
- Modify: `website/views/listen.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`
- Test: `website/tests/test_listens_radio.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `website/tests/test_listens_radio.py`:

```python
@pytest.mark.django_db
def test_radio_endpoint_returns_tracks(client, graph):  # noqa: ARG001
    resp = client.get("/api/listens/radio/", {"seed": "seed"})
    assert resp.status_code == 200
    vids = {t["video_id"] for t in resp.json()["tracks"]}
    assert vids == {"rel1", "rel2"}


@pytest.mark.django_db
def test_radio_endpoint_honours_exclude(client, graph):  # noqa: ARG001
    resp = client.get("/api/listens/radio/", {"seed": "seed", "exclude": "rel1"})
    assert resp.status_code == 200
    assert {t["video_id"] for t in resp.json()["tracks"]} == {"rel2"}


@pytest.mark.django_db
def test_radio_endpoint_requires_seed(client, graph):  # noqa: ARG001
    resp = client.get("/api/listens/radio/")
    assert resp.status_code == 400
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest website/tests/test_listens_radio.py -k endpoint -v`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Add the view**

In `website/views/listen.py`, add to the imports at the top (after `from django.views.decorators.csrf import csrf_exempt`):

```python
from django.views.decorators.http import require_GET
```

And add (after the existing `from ..models import ListenTrack` line):

```python
from ..services import music_graph
```

Add this constant near the other module constants (after `_SYNC_KEY = "listens_last_sync_ts"`):

```python
RADIO_EXCLUDE_CAP = 40  # cap exclude list size to keep the URL sane
```

Add the view (place it just after `listen_list`):

```python
@require_GET
def listen_radio(request):
    """Return tracks related to a seed video for endless radio (public)."""
    seed = request.GET.get("seed", "").strip()
    if not seed:
        return JsonResponse({"error": "seed required"}, status=400)
    exclude_raw = request.GET.get("exclude", "")
    exclude = [v for v in (s.strip() for s in exclude_raw.split(",")) if v][:RADIO_EXCLUDE_CAP]
    tracks = music_graph.radio_next(seed, exclude_video_ids=exclude)
    return JsonResponse({"tracks": tracks})
```

- [ ] **Step 4: Export and route it**

In `website/views/__init__.py`, add `listen_radio` to the `from .listen import (...)` block (alphabetical-ish, e.g. after `listen_list,`):

```python
    listen_radio,
```

and add `"listen_radio",` to the `__all__` list (after `"listen_list",`).

In `website/urls.py`, add after the `path("listens/", views.listen_list),` line:

```python
    path("listens/radio/", views.listen_radio),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `uv run pytest website/tests/test_listens_radio.py -v`
Expected: all tests PASS (8 total).

- [ ] **Step 6: Commit**

```bash
git add website/views/listen.py website/views/__init__.py website/urls.py website/tests/test_listens_radio.py
git commit -m "feat(listens): GET /api/listens/radio/ endpoint"
```

---

## Task 3: Frontend pure radio helpers

**Files:**
- Create: `frontend/src/lib/radio.ts`
- Test: `frontend/src/lib/__tests__/radio.test.ts`

All `pnpm` commands run from `frontend/`. (Per the dev-env note, `pnpm` may need a full path — use the same invocation the repo's other commands use.)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/__tests__/radio.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildExcludeList, RADIO_EXCLUDE_CAP, shouldTopUp } from "@/lib/radio";
import type { ListenTrack } from "@/lib/api";

function track(video_id: string): ListenTrack {
  return {
    id: 0,
    video_id,
    title: video_id,
    artist: "",
    album: "",
    thumbnail_url: "",
    duration: "",
    played_at: "",
  };
}

describe("shouldTopUp", () => {
  it("is false when radio is off", () => {
    expect(shouldTopUp(1, 0, false)).toBe(false);
  });
  it("is false when no track is selected", () => {
    expect(shouldTopUp(5, -1, true)).toBe(false);
  });
  it("is true when 2 or fewer tracks remain ahead", () => {
    expect(shouldTopUp(3, 0, true)).toBe(true); // 2 remaining
    expect(shouldTopUp(1, 0, true)).toBe(true); // 0 remaining
  });
  it("is false when more than 2 tracks remain ahead", () => {
    expect(shouldTopUp(5, 0, true)).toBe(false); // 4 remaining
  });
});

describe("buildExcludeList", () => {
  it("returns most-recent video ids first, deduped", () => {
    const q = [track("a"), track("b"), track("a"), track("c")];
    expect(buildExcludeList(q)).toEqual(["c", "a", "b"]);
  });
  it("caps the list length", () => {
    const q = Array.from({ length: RADIO_EXCLUDE_CAP + 10 }, (_, i) => track(`v${i}`));
    expect(buildExcludeList(q)).toHaveLength(RADIO_EXCLUDE_CAP);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `pnpm test radio`
Expected: FAIL — cannot resolve `@/lib/radio`.

- [ ] **Step 3: Implement the helpers**

Create `frontend/src/lib/radio.ts`:

```ts
import type { ListenTrack } from "@/lib/api";

/** How many tracks may remain ahead before the radio tops up the queue. */
export const RADIO_TOPUP_THRESHOLD = 2;

/** Max number of recent video ids sent as the radio exclude list. */
export const RADIO_EXCLUDE_CAP = 40;

/**
 * Whether the radio should fetch more tracks: radio on, a track is selected, and
 * at most RADIO_TOPUP_THRESHOLD tracks remain after the current index.
 */
export function shouldTopUp(
  queueLen: number,
  currentIdx: number,
  radioOn: boolean,
): boolean {
  if (!radioOn || currentIdx < 0) return false;
  const remaining = queueLen - 1 - currentIdx;
  return remaining <= RADIO_TOPUP_THRESHOLD;
}

/**
 * Build the exclude list (most-recent video ids first, deduped, capped) so the
 * radio doesn't immediately repeat tracks already in the queue.
 */
export function buildExcludeList(queue: ListenTrack[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let i = queue.length - 1; i >= 0 && ids.length < RADIO_EXCLUDE_CAP; i--) {
    const vid = queue[i]?.video_id;
    if (vid && !seen.has(vid)) {
      seen.add(vid);
      ids.push(vid);
    }
  }
  return ids;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `frontend/`): `pnpm test radio`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/radio.ts frontend/src/lib/__tests__/radio.test.ts
git commit -m "feat(listens): pure radio queue helpers"
```

---

## Task 4: Frontend radio fetch helper

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the fetch helper**

In `frontend/src/lib/api.ts`, add this function (place it near the other listens-related exports; it depends on the existing `API` constant and `ListenTrack` type, both already in this file):

```ts
export async function fetchRadioTracks(
  seed: string,
  exclude: string[],
): Promise<ListenTrack[]> {
  const params = new URLSearchParams({ seed });
  if (exclude.length) params.set("exclude", exclude.join(","));
  try {
    const res = await fetch(`${API}/api/listens/radio/?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.tracks ?? []) as ListenTrack[];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Verify it compiles / lints**

Run (from `frontend/`): `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(listens): fetchRadioTracks API helper"
```

---

## Task 5: Player radio state + top-up logic

**Files:**
- Modify: `frontend/src/lib/player.tsx`

This task wires radio into the existing player. Follow each edit precisely; line numbers refer to the current file.

- [ ] **Step 1: Import the helpers**

At the top of `frontend/src/lib/player.tsx`, change the api import (currently `import type { ListenTrack } from "@/lib/api";`) to also pull the fetch helper, and import the radio helpers:

```ts
import type { ListenTrack } from "@/lib/api";
import { fetchRadioTracks } from "@/lib/api";
import { buildExcludeList, shouldTopUp } from "@/lib/radio";
```

- [ ] **Step 2: Add `radio` to the persisted + context types**

In `interface PersistedPlayerState` (around line 65) add after `repeat: RepeatMode;`:

```ts
  radio: boolean;
```

In `interface PlayerState` (around line 99) add after `repeat: RepeatMode;`:

```ts
  radio: boolean;
```

In `interface PlayerActions` (around line 111) add after `cycleRepeat: () => void;`:

```ts
  toggleRadio: () => void;
```

In `defaultState` (around line 128) add `radio: false,` after `repeat: "off",` and `toggleRadio: noop,` after `cycleRepeat: noop,`.

- [ ] **Step 3: Add state, refs, and fetch guard**

After `const [repeat, setRepeat] = useState<RepeatMode>("off");` (around line 165) add:

```ts
  const [radio, setRadio] = useState(false);
```

After `const repeatRef = useRef(repeat);` (around line 188) add:

```ts
  const radioRef = useRef(radio);
```

After `repeatRef.current = repeat;` (around line 196) add:

```ts
  radioRef.current = radio;
```

With the other refs (e.g. after `const resumeAttemptRef = useRef(0);` around line 176) add:

```ts
  // Guards a radio top-up fetch in flight; pending flag advances once tracks land.
  const radioFetchingRef = useRef(false);
  const radioPendingAdvanceRef = useRef(false);
```

- [ ] **Step 4: Restore + persist `radio`**

In the restore effect (around line 237) add after `setRepeat(saved.repeat);`:

```ts
    setRadio(saved.radio ?? false);
```

In the persist effect `saveSession({ ... })` (around line 257) add `radio,` after `repeat,`, and add `radio` to the dependency array on line 267 (after `repeat`). In the `beforeunload` handler's `saveSession({ ... })` (around line 278) add `radio: radioRef.current,` after `repeat: repeatRef.current,`.

- [ ] **Step 5: Add the top-up fetch function**

Add this `useCallback` near the other actions, immediately before `const play = useCallback(` (around line 473). It is declared before `loadTrackAtIndex` is referenced only inside async callbacks, so ordering is fine:

```ts
  /* ── Radio: fetch related tracks and append to the queue ── */

  const fetchAndAppendRadio = useCallback(async (): Promise<ListenTrack[]> => {
    if (radioFetchingRef.current) return [];
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    const seed = q[idx];
    if (!seed) return [];
    radioFetchingRef.current = true;
    try {
      const more = await fetchRadioTracks(seed.video_id, buildExcludeList(q));
      if (more.length) {
        setQueue((prev) => [...prev, ...more]);
      } else if (radioPendingAdvanceRef.current) {
        // Genuinely no related tracks — stop gracefully.
        radioPendingAdvanceRef.current = false;
        userRequestedPauseRef.current = true;
        setPlaying(false);
      }
      return more;
    } finally {
      radioFetchingRef.current = false;
    }
  }, []);
```

- [ ] **Step 6: Extend `handleTrackEnd` to feed the radio**

In `handleTrackEnd` (around line 416), replace the final `else` branch (the queue-exhausted stop, currently lines 447-450):

```ts
    } else {
      userRequestedPauseRef.current = true; // queue exhausted — don't auto-resume
      setPlaying(false);
    }
```

with:

```ts
    } else if (radioRef.current) {
      // Radio: queue ran dry — fetch more, then advance when they arrive
      // (handled by the queue-growth effect). No-op if a top-up is already in flight.
      radioPendingAdvanceRef.current = true;
      void fetchAndAppendRadio();
    } else {
      userRequestedPauseRef.current = true; // queue exhausted — don't auto-resume
      setPlaying(false);
    }
```

- [ ] **Step 7: Add proactive top-up + pending-advance effects**

Add these two effects after the mutual-exclusion effect (after its closing `}, []);` around line 299):

```ts
  /* ── Radio: proactively top up the queue as it nears the end ── */

  useEffect(() => {
    if (!radio) return;
    if (shouldTopUp(queue.length, currentIndex, true)) {
      void fetchAndAppendRadio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, radio, queue.length]);

  /* ── Radio: advance once freshly-fetched tracks land in the queue ── */

  useEffect(() => {
    if (!radioPendingAdvanceRef.current) return;
    const idx = currentIndexRef.current;
    if (idx + 1 < queue.length) {
      radioPendingAdvanceRef.current = false;
      const nextIdx = idx + 1;
      setCurrentIndex(nextIdx);
      loadTrackAtIndex(nextIdx, queue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);
```

(These reference `fetchAndAppendRadio` and `loadTrackAtIndex`, both defined later in the component body; that is fine because the effect bodies run after mount, by which point the `useCallback`s exist. The eslint-disable matches the file's existing convention for these refs.)

- [ ] **Step 8: Add `toggleRadio` and expose it**

After `cycleRepeat` (around line 602) add:

```ts
  const toggleRadio = useCallback(() => {
    setRadio((r) => !r);
  }, []);
```

In the `value: PlayerContextValue` object (around line 625) add `radio,` after `repeat,` and `toggleRadio,` after `cycleRepeat,`.

- [ ] **Step 9: Lint + typecheck**

Run (from `frontend/`): `pnpm lint`
Expected: no errors. (If the build is quick, also run `pnpm build` to catch type errors.)

- [ ] **Step 10: Run frontend tests**

Run (from `frontend/`): `pnpm test`
Expected: all tests PASS (existing + radio helpers).

- [ ] **Step 11: Commit**

```bash
git add frontend/src/lib/player.tsx
git commit -m "feat(listens): endless radio mode in player"
```

---

## Task 6: MiniPlayer radio toggle button

**Files:**
- Modify: `frontend/src/components/MiniPlayer.tsx`

- [ ] **Step 1: Destructure the new context values**

In the `const { ... } = usePlayer();` block (around lines 15-34), add `radio,` after `repeat,` and `toggleRadio,` after `cycleRepeat,`.

- [ ] **Step 2: Add the radio button**

In the controls row, immediately before the Shuffle button (before the `{/* Shuffle */}` comment around line 277), add:

```tsx
        {/* Radio (endless auto-play) */}
        <button
          onClick={toggleRadio}
          title={radio ? "Radio on — auto-plays related tracks" : "Radio off"}
          style={{
            background: "none",
            border: "none",
            color: radio ? "#f97316" : "#666",
            fontSize: "15px",
            cursor: "pointer",
            padding: "4px",
            lineHeight: 1,
            transition: "color 0.15s",
          }}
        >
          ∞
        </button>
```

- [ ] **Step 3: Lint**

Run (from `frontend/`): `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/MiniPlayer.tsx
git commit -m "feat(listens): radio toggle button in MiniPlayer"
```

---

## Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/README.md`
- Modify: `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Add the endpoint to CLAUDE.md**

In `CLAUDE.md`, in the listens block of the API Endpoints section, add after the `GET  /api/listens/recommended/` line (or after the last `listens` GET line):

```
GET  /api/listens/radio/?seed=<video_id>&exclude=<csv>   tracks related to seed for endless auto-play
```

- [ ] **Step 2: Update docs/README.md**

In `docs/README.md`, find the listens section and add a sentence describing radio mode, e.g.:

> The player supports an endless **radio** mode (∞ toggle): when enabled, it keeps the queue full by auto-playing tracks related to the current song, drawn from the listening graph.

- [ ] **Step 3: Update docs/QA-CHECKLIST.md**

In `docs/QA-CHECKLIST.md`, in the listens section, add:

```markdown
- [ ] Listens: the ∞ (radio) toggle in the player turns orange when enabled
- [ ] Listens: with radio on, playing a single track keeps auto-playing related tracks (queue never ends)
- [ ] Listens: with radio off, playback stops at the end of the queue
- [ ] Listens: radio state survives a page reload (persisted in session)
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs(listens): document radio auto-play mode"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run (from repo root): `uv run pytest`
Expected: all tests PASS. (If the collation error from the dev-env note appears, apply the documented Postgres collation refresh, then re-run.)

- [ ] **Step 2: Run the full frontend suite + lint**

Run (from `frontend/`): `pnpm test && pnpm lint`
Expected: all PASS, no lint errors.

- [ ] **Step 3: Manual verification with dev server + Playwright**

Start the dev servers (`make dev` from repo root, or backend + `pnpm dev` in `frontend/`). Then, using Playwright against `http://localhost:3001/listens`:
- Click a track node to start playback; open the player.
- Toggle the ∞ button on — confirm it turns orange.
- Confirm the queue grows (the player keeps playing past the single clicked track). Verify a `GET /api/listens/radio/?seed=...` request fires in the network panel.
- Toggle ∞ off and confirm playback stops at the end of the current queue.
- Take a screenshot of the player with radio enabled for the record.

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill (or the project `ship` skill) to push `feat/listens-radio` and open a PR. Confirm CI is green.

---

## Notes / Edge Cases

- **In-flight top-up at exhaustion:** With `RADIO_TOPUP_THRESHOLD = 2`, the proactive effect normally appends well before the queue empties. The `radioPendingAdvanceRef` + queue-growth effect covers the rare case where the queue empties while a fetch is still in flight — playback resumes the instant tracks land.
- **Isolated track:** If `radio_next` returns `[]` (no graph neighbours), `fetchAndAppendRadio` clears the pending flag and stops playback gracefully. This is why building the graph (sync) matters for radio quality.
- **repeat: one** still wins over radio (handled first in `handleTrackEnd`).
- **Shuffle** continues to operate within the growing queue; radio only controls whether the queue is extended.
