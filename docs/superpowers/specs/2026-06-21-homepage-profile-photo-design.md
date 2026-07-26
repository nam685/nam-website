# Homepage Rotating Profile Photo — Design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Branch:** `feat/homepage-profile-photo`

## Goal

Replace the homepage orbit-center content (the random greeting / thought quote /
drawing) with a single circular profile photo, randomly picked per page load from
a pool of 5. The photo's rim and outer-edge pixels are tinted live with the same
hue the background ambient glow uses, driven by mouse position via the existing
dot-color math.

## Decisions (from brainstorming)

- **Center content:** Always a photo. The random greeting/thought/drawing system is
  removed from the homepage center.
- **Cycling:** Random per page load (`Math.floor(Math.random()*5)`), no auto-rotate.
- **Edge tint:** CSS edge blend (live, compositor-driven), not per-pixel canvas work.
- **Asset delivery:** Photos are **not** committed to git. They live on the server
  under the media root and are served at `/media/profile/`.

## 1. Asset pipeline (one-time, local + upload)

Source images in `C:\Users\lehai\Downloads` (WSL path `/mnt/c/Users/lehai/Downloads/`):
- `20260621_132121.jpg`, `20260621_132132.jpg`, `20260621_132202.jpg`,
  `20260621_132318.jpg` (JPEG, ~3392×2544)
- `20260621_134722.heic` (HEIC — decodes via ImageMagick libheif delegate, confirmed)

Conversion (ImageMagick `convert`, available; `vips`/`heif-convert`/pillow_heif are not):

```
convert "<src>" -auto-orient \
  -gravity center -resize 700x700^ -extent 700x700 \
  -quality 82 "media/profile/profile-<n>.webp"
```

- `-auto-orient` applies EXIF rotation (phone photos).
- `-resize 700x700^ -extent 700x700` center-crops to a 700×700 square (retina-safe
  for the ~315 px display circle).
- Output `profile-1.webp` … `profile-5.webp`, ~50–100 KB each.

Delivery:
- `scp media/profile/*.webp hetzner:/home/nam/nam-website-deploy/media/profile/`
  (create the `profile/` dir first; `ssh hetzner` resolves to `nam@46.224.162.194`).
- Served at `https://nam685.de/media/profile/profile-<n>.webp` (Caddy
  `handle /media/*` → `root /home/nam/nam-website-deploy` → `file_server`).
- Local copies stay in the repo's gitignored `media/profile/` for verification only.

No build script is committed — conversion + upload is a documented one-off run; the
exact commands live in this spec and the implementation plan.

## 2. Homepage center (`frontend/src/app/page.tsx`)

- Remove the `content` state, the `fetchRandomContent` effect, and the three
  conditional content blocks (`thought` / `drawing` / `greeting`).
- Pick a photo index once on mount: `const [n] = useState(() => 1 + Math.floor(Math.random()*5))`.
- Render a circular photo wrapper as the center content:
  - `width/height: 75%` of the orbit container — i.e. 75% of the center→dot distance
    (dots sit at the container edge, at radius = half the container width). Scales
    responsively with the existing `min(75vw, 75vh, 420px)` orbit sizing.
  - `src={`${API}/media/profile/profile-${n}.webp`}` (import `API` from `@/lib/api`).
  - `alt="Nam"`, `fadeIn` animation reused from the old content.
- Keep dots, ring, ambient glow, pills, and all existing styles intact.

## 3. Live edge tint (CSS edge blend)

The photo wrapper is driven by a `--hue` CSS custom property (an `rgb(...)` string).

Three stacked layers inside the circular wrapper (`position: relative`, `border-radius: 50%`,
`overflow: hidden` where appropriate):

1. **Image** — `<img>` `width/height: 100%`, `object-fit: cover`, `border-radius: 50%`.
2. **Edge tint overlay** — absolutely positioned, `inset: 0`, `border-radius: 50%`,
   `background: radial-gradient(circle, transparent 58%, var(--hue) 100%)`,
   `mix-blend-mode: overlay`, `pointer-events: none`. This recolors the photo's outer
   ring of pixels toward the hue (the "post-processed content" effect, done by the
   compositor — instant, no per-pixel JS).
3. **Rim** — `box-shadow: 0 0 24px var(--hue)` plus a `1px`/`2px` `border` in
   `var(--hue)` for a glowing tinted edge. A `transition` on box-shadow/border keeps
   hue changes smooth.

Driving `--hue`:
- The existing `onMove` handler already computes `const [r,g,b] = lerpDotColor(angle)`
  for the ambient glow. Extend it to also set
  `wrapper.style.setProperty("--hue", `rgb(${r},${g},${b})`)` via a new `photoRef`.
- **Default hue** (before first mouse move): set `--hue` to the color at angle 0
  (`lerpDotColor(0)` → orange, matching the `listens` dot at top) so the rim is tinted
  on first paint.
- Wrap the whole effect in `@media (prefers-reduced-motion: reduce)` only for the
  transition (the tint itself is fine; just avoid animating).

## 4. Cleanup of dead code

`frontend/src/lib/homepageContent.ts`:
- Remove `GREETINGS`, `ContentItem`, `fetchRandomContent` (no other consumers — verified
  by grep; only `page.tsx` imported `fetchRandomContent`).
- Keep `Dot`, `DOTS`, `angleFromCenter`, `lerpDotColor` (still used by `page.tsx`).
- Remove the now-unused `Thought`/`API` import if it becomes dead.

`frontend/src/lib/__tests__/homepageContent.test.ts`:
- Drop tests covering removed exports; keep tests for `angleFromCenter` / `lerpDotColor`
  / `DOTS`.

## 5. Verification

- `media/profile/` populated locally; run Django (`uv run python manage.py runserver`,
  serves `/media/` in DEBUG) + `pnpm dev` with `NEXT_PUBLIC_API_URL=http://localhost:8000`.
- Playwright screenshots: default load (rim orange), mouse near a couple of different
  dots (rim hue tracks toward those dots' colors), mobile width (85vw orbit).
- Confirm circle diameter ≈ 75% of center→dot distance.
- `pnpm lint`, `pnpm test`, `uvx ruff check .` (no backend change expected).
- Upload to server, confirm `https://nam685.de/media/profile/profile-1.webp` 200s.

## Out of scope

- Auto-rotation / crossfade between photos.
- Canvas per-pixel tinting.
- Any admin UI to manage the photo pool (it's a fixed set of 5 files on the server).
- Docs/README + QA-CHECKLIST updates are minor; the homepage section gets a one-line
  edit noting the profile photo (handled in the implementation plan).
