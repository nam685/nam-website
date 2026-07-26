# Design: Video support for nam thinks

**Date:** 2026-06-21
**Status:** Approved
**Branch:** `feat/thinks-video`

## Goal

Allow a "thinks" post to carry a short video clip (in addition to the existing
text-and/or-image posts). Immediate driver: post a 48s pull-up clip with the
caption "yay 10 pull ups".

## Constraints / decisions

- **Single uploader.** Only the admin (the site owner) can create thoughts, so
  the upload path does not need to be hardened against arbitrary user video.
- **No server-side transcoding.** The VPS does not have ffmpeg in the deploy
  path and we don't want to add a heavy dependency. Video is compressed
  **locally** before upload; the backend only validates and stores the file.
- **One media item per thought.** A thought is text and/or a single image
  **or** a single video — not both an image and a video.

## Compression (local, pre-upload)

Re-encode the source clip with ffmpeg before posting:

- H.264 video, 720p (scale down, never up), target ~2 Mbps (CRF ~23).
- AAC audio.
- `-movflags +faststart` so the moov atom is at the front for web streaming.

Expected output: ~10–15 MB for a 48s clip (down from 360 MB).

## Backend

`website/models/thought.py`
- Add `video = models.FileField(upload_to="thoughts/videos/%Y/%m/", blank=True, null=True)`.
- Migration `00xx_thought_video`.

`website/views/thought.py`
- `_validate_video(video_file)`: cap size at 50 MB; allow extensions `.mp4`,
  `.webm`; reject otherwise. Returns `(file, None)` or `(None, JsonResponse)`.
- `thought_create`: read `request.FILES.get("video")`. A post needs text,
  image, **or** video. Reject if both image and video are present. Store video
  as-is (no processing).
- `thought_list` + create response: serialize `"video": t.video.url if t.video else None`.

No infra change — Caddy already serves `/media/*` via file_server, and videos
land under `MEDIA_ROOT/thoughts/videos/`.

## Frontend (`frontend/src/app/thinks/page.tsx`)

- `Thought` type gains `video: string | null`.
- File input `accept` includes `video/*`; on attach, branch on `file.type`:
  image → existing image preview; video → `<video>` preview. Only one media
  item attached at a time.
- Compose form sends `video` in the multipart body when a video is attached.
- Feed card: if `thought.video`, render
  `<video controls playsInline preload="metadata" src={...}>` instead of `<img>`.
- Lightbox: handle video entries the same way (a thought with video opens a
  `<video controls>` instead of `<img>`).

## Docs

- `docs/README.md`: note that thinks posts can include a short video.
- `docs/QA-CHECKLIST.md`: add items for posting/playing a video thought.

## Testing

- Backend: pytest cases in `website/tests/test_thoughts.py` — create with valid
  video (201, `video` URL returned), oversized video (400), bad extension (400),
  image+video together (400), list serializes `video`.
- Frontend: `pnpm build` + existing vitest; no new pure-function logic to unit
  test beyond the type change. Live-browser verification not possible in this
  env (servers get SIGTERM'd) — user eyeballs locally / on prod.

## Deploy + post

1. Worktree → PR → CI green → merge to `main` → auto-deploy (runs migration +
   frontend rebuild on the server).
2. Compress the clip locally.
3. Post to production via `POST /api/thoughts/create/` (multipart: `content`
   = "yay 10 pull ups", `video` = compressed file), authenticating with a token
   from `POST /api/auth/login/` using `ADMIN_SECRET` read from the server `.env`
   over ssh.
4. Note: 18h cooldown applies to the API create path — must be the only post in
   the window.
