import type { AudiobookChapter, AudiobookManifest } from "./api";
import { store, storeDel } from "./auth";

export function nextChunkId(
  manifest: AudiobookManifest,
  currentChunkId: number,
): number | null {
  const next = currentChunkId + 1;
  return next < manifest.chunks.length ? next : null;
}

export function chapterForChunk(
  manifest: AudiobookManifest,
  chunkId: number,
): AudiobookChapter | null {
  if (manifest.chapters.length === 0) return null;
  let found: AudiobookChapter | null = null;
  for (const ch of manifest.chapters) {
    if (ch.chunk_start <= chunkId) found = ch;
    else break;
  }
  return found;
}

const positionKey = (slug: string) => `audiobook-position-${slug}`;
const CURRENT_KEY = "audiobook-current";
const SPEED_KEY = "audiobook-speed";

export interface SavedPosition {
  chunkId: number;
  offsetS: number;
}

export function savePosition(slug: string, chunkId: number, offsetS: number) {
  store(positionKey(slug), JSON.stringify({ chunkId, offsetS }));
  store(CURRENT_KEY, JSON.stringify({ slug, chunkId, offsetS }));
}

export function loadPosition(slug: string): SavedPosition | null {
  const raw = store(positionKey(slug));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.chunkId === "number" && typeof parsed?.offsetS === "number") {
      return { chunkId: parsed.chunkId, offsetS: parsed.offsetS };
    }
    return null;
  } catch {
    return null;
  }
}

export function loadCurrentSlug(): { slug: string; chunkId: number; offsetS: number } | null {
  const raw = store(CURRENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.slug === "string" &&
      typeof parsed?.chunkId === "number" &&
      typeof parsed?.offsetS === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearCurrent() {
  storeDel(CURRENT_KEY);
}

export function saveSpeed(speed: number) {
  store(SPEED_KEY, String(speed));
}

export function loadSpeed(): number {
  const raw = store(SPEED_KEY);
  if (!raw) return 1.4;
  const n = parseFloat(raw);
  return isFinite(n) && n >= 0.5 && n <= 3 ? n : 1.4;
}
