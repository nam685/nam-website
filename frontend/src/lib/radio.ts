import type { ListenTrack } from "@/lib/api";

/** How many tracks may remain ahead before the radio tops up the queue. */
export const RADIO_TOPUP_THRESHOLD = 2;

/** Max number of recent video ids sent as the radio exclude list. */
export const RADIO_EXCLUDE_CAP = 40;

/**
 * Whether the radio should fetch more tracks: radio on, a track is selected, and
 * at most RADIO_TOPUP_THRESHOLD tracks remain after the current index.
 */
export function shouldTopUp(queueLen: number, currentIdx: number, radioOn: boolean): boolean {
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
