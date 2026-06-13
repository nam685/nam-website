# Merge `thinks` + `draws` into a unified `/thinks` feed

**Date:** 2026-06-13
**Status:** Approved — ready for implementation plan

## Summary

The `/thinks` (text thoughts, trunk timeline) and `/draws` (pencil/camera image
gallery) pages are merged into a single page at `/thinks`. A post can now carry
**optional text and/or an optional image**. The page keeps the thinks identity
(red `#FF1744` accent, ink-splatter background, vertical trunk timeline) with a
slightly brightened background. The pencil/camera distinction is removed.

## Goals

- One page where each entry can be text-only, image-only, or text + image.
- Keep the thinks look and the trunk-timeline reading experience.
- Better compose UX, with the typed text surviving a login redirect.
- Retire the separate drawings page, model, and endpoints without losing data.

## Non-goals

- Multiple images per post (one image per post; an image-heavy day = multiple posts).
- A new top-level page name or route (stays `/thinks`).
- Reworking the lightbox (reused as-is).

## Identity & navigation

- Merged page stays at `/thinks`, label `thinks`, accent `#FF1744`.
- Background: keep `/images/bg/thinks.jpg`, brightened slightly. Apply a
  `filter: brightness(...)` bump to the thinks background (tuned visually during
  implementation; start around `1.4` and adjust). Scope the filter to the thinks
  background only, not globally.
- Remove `draws` from:
  - `NAV_ITEMS` in `frontend/src/lib/navWheel.ts`
  - the accent `m` map in the inline `<script>` in `frontend/src/app/layout.tsx`
  - `BG_MAP` in `frontend/src/components/PageBackground.tsx`
- Add a redirect `/draws → /thinks` (Next.js `redirects()` in `next.config`, or a
  small redirecting route) so existing links and bookmarks still work.

## Data model

Extend `Thought` (`website/models/thought.py`):

- Add `image = models.ImageField(upload_to="thoughts/%Y/%m/", blank=True, null=True)`.
- Change `content` to `blank=True` (optional). Keep `created_at`, `is_published`.
- Model-level / validation rule: a published post must have **at least one of**
  `content` (non-empty after strip) or `image`. Enforced in the create view.
- One image per post.

Drop the `Drawing` model after data is migrated:

- Remove `website/models/drawing.py`, its entry in `website/models/__init__.py`
  and `__all__`.
- Remove `website/views/drawing*.py` and its imports in `website/views/__init__.py`.
- Remove the `/api/drawings/*` routes in `website/urls.py`.

### Migration plan (ordered)

1. **Schema migration:** add `image` to `Thought`, make `content` optional.
2. **Data migration** (same or following migration, using historical models):
   for each `Drawing`, create a `Thought` with:
   - `image` set to the drawing's existing stored path (reuse the file on disk —
     do **not** move or re-encode; assign the relative path string to the
     `ImageField`).
   - `content` = the drawing's `caption` (may be empty).
   - `is_published` = the drawing's `is_published`.
   - `created_at` preserved from the drawing (set explicitly after create, since
     `auto_now_add` ignores assignment at create time — use a queryset `.update()`
     keyed by the new row, or `bulk_create` then `.update()`).
3. **Schema migration:** delete the `Drawing` model.

Migrated drawings were previously cropped/padded to squares; they keep that shape
in the feed, which is acceptable. New uploads keep their natural aspect ratio.

## Backend API

### `POST /api/thoughts/create/` (auth required)

- Content type becomes `multipart/form-data`.
- Fields: `content` (optional text), `image` (optional file).
- Validation:
  - Reject if both `content` (stripped) is empty **and** no `image` →
    `400 {"error": "Need text or an image"}`.
  - `content` length ≤ 2000 → else `400`.
  - Image: max 10 MB; allowed formats `JPEG, PNG, GIF, WEBP, BMP` (validated via
    Pillow `img.format`) → else `400`.
- **Image processing (changed):** keep natural aspect ratio. No square crop/pad.
  Optionally downscale if a dimension exceeds a max (e.g. 2000 px) to bound file
  size; re-encode BMP → PNG as today. Otherwise store as uploaded.
- 18h cooldown stays and applies to **all** posts (text or image): if the latest
  published thought is < 18h old → `429`.
- Response `201` includes `id`, `content`, `image` (URL or `null`), `created_at`.

### `GET /api/thoughts/?page=N`

- Each item gains `image`: the image URL, or `null` for text-only posts.
- Pagination unchanged (10/page, `has_next`, `page`).

### Removed endpoints

- `GET /api/drawings/`, `POST /api/drawings/upload/`, `POST /api/drawings/<id>/delete/`.

### Delete

- Image posts are deletable by admin from the lightbox. Reuse a thought-delete
  path: add `POST /api/thoughts/<id>/delete/` (auth required) that deletes the
  row and its image file. (Replaces the old drawing-delete affordance.)

## Frontend — feed layout (approved variant A)

Single-column trunk timeline (current thinks structure), one entry per post:

- Red trunk line, glowing node, branch line, date — unchanged.
- **Text:** full content width (remove the previous `max-width` cap), rendered
  when `content` is present.
- **Image:** rendered when `image` is present, **centered**, filling the content
  column width when larger (scaled down to fit), shown at natural size when
  smaller — never upscaled or stretched. `border-radius` as in mock.
- Click an image → existing lightbox: full-screen, `←/→` navigate across **all
  images in the feed** (text-only posts are skipped in nav), `esc` to close,
  admin-only delete. `content` shows as the lightbox caption when present.
- The old desktop split-view and mobile side-switcher from `/draws` are removed;
  the single-column timeline is already responsive.

## Frontend — compose (approved variant A)

Inline card that expands in place at the top of the trunk (evolves the current
`ComposeSprite`):

- Collapsed: the existing sprite button.
- Expanded: a card containing
  - auto-growing textarea (placeholder "what's on your mind…"),
  - an attach affordance supporting **drag-and-drop, paste, and click-to-select**
    a single image,
  - a live preview thumbnail with a ✕ remove control,
  - a POST button (enabled when there is text or an image).
- Submission posts `multipart/form-data` to `/api/thoughts/create/`. On success,
  prepend the new post to the feed (with its image) and reset the card.
- Cooldown and error messaging behavior preserved (e.g. 429 → "Chill…").

### Draft survival across login

- The compose card persists its **typed text** to `localStorage` (e.g. key
  `thoughtDraft`) as it changes.
- If a post attempt finds no admin token and redirects to `/sudo` (via
  `getAdminToken()`), the draft text remains in `localStorage`.
- On returning to `/thinks`, the compose card restores the draft text (and can
  auto-open). The draft is cleared on successful post or explicit discard.
- Image is **not** persisted (text-only draft, per decision); the user re-attaches
  after logging back in.

## Testing

**Backend (pytest):**
- Create: text-only succeeds; image-only succeeds; text+image succeeds;
  empty+no-image → 400; over-length content → 400; bad/oversized image → 400.
- Cooldown returns 429 within 18h for any post type.
- `thought_list` includes `image` (URL for image posts, `null` for text-only).
- Thought delete removes row and image file; auth required.
- Data migration: a `Drawing` becomes a `Thought` with image path, caption→content,
  and preserved `created_at`.

**Frontend (vitest):**
- Any new pure helpers in `src/lib/` (e.g. lightbox image-index filtering that
  skips text-only posts, draft load/save helpers) get unit tests.

**Manual / Playwright:** verify feed rendering (text-only, image-only, both),
centered/natural-size image behavior, lightbox nav skipping text posts, compose
drag/paste/click + preview/remove, and draft restoration after a `/sudo` round-trip.

## Docs to update

- `docs/README.md` — describe the merged thinks page; remove the draws section.
- `docs/QA-CHECKLIST.md` — replace draws items with merged-feed + compose +
  draft-restore checks.
- `CLAUDE.md` API list — update `/api/thoughts/*`, remove `/api/drawings/*`
  (done as part of implementation).

## Rollout notes

- Existing media files under `media/drawings/...` stay in place; migrated thoughts
  reference them by path. Do not delete `media/drawings/` after migration.
