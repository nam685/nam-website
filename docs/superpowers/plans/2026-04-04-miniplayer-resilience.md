# Mini-Player Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent RSC failures from killing the mini-player, and fix session restore to show a paused "tap to resume" state instead of silently failing autoplay.

**Architecture:** Error boundaries at route segments catch RSC failures without unmounting the root layout (where PlayerProvider + MiniPlayer live). For hard reloads, session restore shows a paused MiniPlayer instead of attempting autoplay that browsers block.

**Tech Stack:** Next.js App Router (error.tsx convention), React context, YouTube IFrame API

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/app/error.tsx` | Create | Global error boundary — catches RSC failures across all routes |
| `frontend/src/app/listens/error.tsx` | Create | Listens-specific error boundary — same pattern, listens accent color |
| `frontend/src/lib/player.tsx` | Modify | Session restore: pause-based instead of autoplay. Resume: handle pending restore |

---

### Task 1: Global Error Boundary

**Files:**
- Create: `frontend/src/app/error.tsx`

- [ ] **Step 1: Create `frontend/src/app/error.tsx`**

This is a Next.js App Router error boundary. It must be a client component. It receives `error` and `reset` props from Next.js. Styled inline to match the dark theme. No imports beyond React.

```tsx
"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        gap: "1rem",
        fontFamily: "var(--font-body)",
      }}
    >
      <p style={{ color: "#888", fontSize: "0.85rem" }}>
        Something went wrong loading this page.
      </p>
      <button
        onClick={reset}
        style={{
          background: "none",
          border: "1px solid #333",
          color: "#ccc",
          padding: "0.4rem 1.2rem",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "0.8rem",
          fontFamily: "monospace",
          letterSpacing: "0.05em",
        }}
      >
        RETRY
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify no build errors**

Run: `cd frontend && pnpm build`
Expected: Build succeeds with no errors related to error.tsx.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/error.tsx
git commit -m "fix: add global error boundary to prevent RSC failures from reloading page"
```

---

### Task 2: Listens Error Boundary

**Files:**
- Create: `frontend/src/app/listens/error.tsx`

- [ ] **Step 1: Create `frontend/src/app/listens/error.tsx`**

Same pattern as the global boundary, but uses the listens accent color (`#f97316`) for the retry button border on hover. This boundary is more specific — Next.js uses the closest error boundary, so listens routes hit this one first, keeping the listens layout (hero, tabs) mounted.

```tsx
"use client";

export default function ListensError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "30vh",
        gap: "1rem",
        fontFamily: "var(--font-body)",
      }}
    >
      <p style={{ color: "#888", fontSize: "0.85rem" }}>
        Failed to load this section.
      </p>
      <button
        onClick={reset}
        style={{
          background: "none",
          border: "1px solid rgba(249, 115, 22, 0.3)",
          color: "#f97316",
          padding: "0.4rem 1.2rem",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "0.8rem",
          fontFamily: "monospace",
          letterSpacing: "0.05em",
        }}
      >
        RETRY
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify no build errors**

Run: `cd frontend && pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/listens/error.tsx
git commit -m "fix: add listens error boundary to catch RSC failures within listens routes"
```

---

### Task 3: Pause-Based Session Restore + Resume Handling

**Files:**
- Modify: `frontend/src/lib/player.tsx:169-179` (add ref), `frontend/src/lib/player.tsx:227-252` (session restore), `frontend/src/lib/player.tsx:492-497` (resume callback)

This is the core fix. Three small changes in `player.tsx`:

- [ ] **Step 1: Add `pendingResumeRef`**

In the refs section (after line 179, `seekOnPlayRef`), add:

```tsx
// Video ID to load when user taps play after a session restore
const pendingResumeRef = useRef<string | null>(null);
```

- [ ] **Step 2: Change session restore to pause-based**

Replace the session restore effect (lines 227-252) with this version. The key change: instead of calling `createPlayerAndLoad()` when the saved session was playing, we store the video_id in `pendingResumeRef` and keep `playing: false`. The MiniPlayer shows paused with track info and progress bar at the saved position.

Find this block:
```tsx
  /* ── Restore session after full page reload ─────────────── */

  useEffect(() => {
    const saved = loadSession();
    if (!saved || !saved.visible || saved.queue.length === 0) return;

    setQueue(saved.queue);
    setCurrentIndex(saved.currentIndex);
    setShuffle(saved.shuffle);
    setRepeat(saved.repeat);
    setVisible(true);
    setMinimized(saved.minimized);
    setProgress(saved.progress);

    if (saved.playing) {
      const track = saved.queue[saved.currentIndex];
      if (track) {
        seekOnPlayRef.current = saved.progress > 0 ? saved.progress : null;
        userRequestedPauseRef.current = false;
        if (ytReadyRef.current) {
          createPlayerAndLoad(track.video_id);
        } else {
          pendingVideoRef.current = track.video_id;
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Replace with:
```tsx
  /* ── Restore session after full page reload ─────────────── */

  useEffect(() => {
    const saved = loadSession();
    if (!saved || !saved.visible || saved.queue.length === 0) return;

    setQueue(saved.queue);
    setCurrentIndex(saved.currentIndex);
    setShuffle(saved.shuffle);
    setRepeat(saved.repeat);
    setVisible(true);
    setMinimized(saved.minimized);
    setProgress(saved.progress);

    // Don't auto-play — browsers block autoplay without a user gesture.
    // Show paused MiniPlayer; user taps play to resume (handled in resume()).
    if (saved.playing) {
      const track = saved.queue[saved.currentIndex];
      if (track) {
        seekOnPlayRef.current = saved.progress > 0 ? saved.progress : null;
        pendingResumeRef.current = track.video_id;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: Update `resume()` to handle pending restore**

Find the `resume` callback (currently lines 492-497):
```tsx
  const resume = useCallback(() => {
    userRequestedPauseRef.current = false;
    resumeAttemptRef.current = 0;
    playerRef.current?.playVideo();
    setPlaying(true);
  }, []);
```

Replace with:
```tsx
  const resume = useCallback(() => {
    userRequestedPauseRef.current = false;
    resumeAttemptRef.current = 0;

    // After a session restore, the YT player doesn't exist yet.
    // The user's tap is the gesture that allows autoplay.
    if (!playerRef.current && pendingResumeRef.current) {
      const videoId = pendingResumeRef.current;
      pendingResumeRef.current = null;
      if (ytReadyRef.current) {
        createPlayerAndLoad(videoId);
      } else {
        pendingVideoRef.current = videoId;
      }
      setPlaying(true);
      return;
    }

    playerRef.current?.playVideo();
    setPlaying(true);
  }, [createPlayerAndLoad]);
```

Note: `createPlayerAndLoad` is added to the dependency array since it's now referenced.

- [ ] **Step 4: Verify build**

Run: `cd frontend && pnpm build`
Expected: Build succeeds with no errors or warnings related to player.tsx.

- [ ] **Step 5: Verify lint**

Run: `cd frontend && pnpm lint`
Expected: No lint errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/player.tsx
git commit -m "fix: restore mini-player in paused state instead of failing autoplay after reload"
```

---

### Task 4: Manual Verification

- [ ] **Step 1: Test error boundary — navigate while playing**

1. Run `cd frontend && pnpm dev`
2. Open browser to `http://localhost:3001/listens`
3. Start playing a track (requires admin token)
4. Open DevTools → Network → set throttling to "Offline"
5. Click a different listens tab (e.g., Tracks)
6. Verify: error boundary shows "Failed to load this section." + RETRY button
7. Verify: MiniPlayer at bottom continues playing (audio uninterrupted)
8. Restore network → click RETRY → content loads

- [ ] **Step 2: Test session restore — hard refresh during playback**

1. Start playing a track on `/listens`
2. Let it play ~10 seconds so progress is non-zero
3. Hard refresh the page (Ctrl+Shift+R)
4. Verify: MiniPlayer shows in paused state with the track info and progress bar at the saved position
5. Click the play button
6. Verify: audio resumes from the saved position (not from the beginning)

- [ ] **Step 3: Test normal playback unaffected**

1. Play a track, verify play/pause/next/prev/seek all work as before
2. Close the player, verify sessionStorage is cleared (DevTools → Application → Session Storage)

- [ ] **Step 4: Take screenshot for PR**

Use Playwright or manual screenshot of the paused restore state for the PR description.
