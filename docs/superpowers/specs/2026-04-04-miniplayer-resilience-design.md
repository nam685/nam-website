# Mini-Player Resilience: Error Boundaries + Session Restore Fix

## Problem

When CPU is under heavy load, Next.js RSC calls fail and trigger full page reloads. This destroys the YouTube IFrame player. The existing sessionStorage persistence saves state before unload and attempts to restore it, but fails silently because browsers block autoplay without a user gesture after a fresh page load. The MiniPlayer appears but audio is stuck/silent.

## Solution

Two complementary fixes: prevent the reload (error boundaries), and handle the remaining cases gracefully (pause-based restore).

## Part 1: Error Boundaries

### What

Add `error.tsx` files at route segments to catch RSC failures before they cascade into full page reloads.

### Where

- `frontend/src/app/error.tsx` — global catch-all
- `frontend/src/app/listens/error.tsx` — listens-specific

### Why This Works

The `PlayerProvider` and `MiniPlayer` live in the root layout (`app/layout.tsx`). Error boundaries only replace the `{children}` slot of the nearest layout — the root layout stays mounted. So the player continues playing uninterrupted while the error boundary shows a retry UI in the content area.

### Implementation

Both files are minimal client components with a retry button. Styled to match the dark theme (no imports needed beyond React). The retry button calls the `reset()` function provided by Next.js to re-attempt rendering the failed segment.

## Part 2: Session Restore — Pause Instead of Autoplay

### What

Change the session restore flow from "immediately auto-play" to "show paused MiniPlayer, let user tap play."

### Current Flow (Broken)

1. Page reloads (RSC failure or hard refresh)
2. `PlayerProvider` mounts, reads sessionStorage
3. If session was playing, immediately calls `createPlayerAndLoad(videoId)` with `autoplay: 1`
4. Browser blocks autoplay (no user gesture) → MiniPlayer shows but audio is silent

### New Flow

1. Page reloads
2. `PlayerProvider` mounts, reads sessionStorage
3. Restores all UI state (queue, index, progress, visible, minimized) but forces `playing: false`
4. Stores the pending video_id in `pendingResumeRef`
5. MiniPlayer shows in paused state with track info + progress bar at saved position
6. User taps play → `resume()` detects `pendingResumeRef` → creates player and loads video → `seekOnPlayRef` seeks to saved position
7. User gesture satisfies browser autoplay policy → audio plays

### Changes in `player.tsx`

1. **New ref**: `pendingResumeRef = useRef<string | null>(null)` — holds video_id from a restored session
2. **Session restore** (lines 227-252): Always set `playing: false`. Instead of calling `createPlayerAndLoad()`, store `track.video_id` in `pendingResumeRef`
3. **`resume()` callback**: Add check — if `playerRef.current` is null and `pendingResumeRef.current` is set, call `createPlayerAndLoad(pendingResumeRef.current)` and clear the ref. The existing `seekOnPlayRef` mechanism handles seeking to the saved position.

### No UI Changes Needed

The existing MiniPlayer already shows a play button when `playing: false`. The paused state with track info visible IS the "tap to resume" prompt — no additional UI required.

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/app/error.tsx` | New — global error boundary |
| `frontend/src/app/listens/error.tsx` | New — listens error boundary |
| `frontend/src/lib/player.tsx` | Modify session restore + resume logic |

## Testing

- Simulate RSC failure: throttle network in DevTools, navigate between listens tabs → error boundary should catch, player keeps playing
- Simulate reload during playback: hard refresh while playing → MiniPlayer shows paused with track info, tap play resumes from saved position
- Normal playback unaffected: play/pause/next/prev/seek all work as before
- Close player: closing still clears sessionStorage (existing behavior)
