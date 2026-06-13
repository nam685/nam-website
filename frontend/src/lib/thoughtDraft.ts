import { type Thought } from "./api";
import { store, storeDel } from "./auth";

const DRAFT_KEY = "thoughtDraft";

/** Persist the in-progress compose text (text only — images are not persisted). */
export function saveDraft(text: string): void {
  if (text.trim()) store(DRAFT_KEY, text);
  else storeDel(DRAFT_KEY);
}

export function loadDraft(): string {
  return store(DRAFT_KEY) ?? "";
}

export function clearDraft(): void {
  storeDel(DRAFT_KEY);
}

/** Posts that carry an image, in feed order — the set the lightbox navigates. */
export function withImages(thoughts: Thought[]): Thought[] {
  return thoughts.filter((t) => t.image);
}
