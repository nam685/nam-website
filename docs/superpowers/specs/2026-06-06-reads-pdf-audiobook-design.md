# Reads PDF Audiobook — Design

**Date:** 2026-06-06
**Branch:** `feat/pdf-audiobook`
**Status:** design — pending implementation plan

## Goal

Let Nam listen to PDF books from the `/reads` page as audiobooks, narrated with high-quality TTS, with proper chapter navigation and cross-session resume. First book: *Designing Data-Intensive Applications* (Martin Kleppmann).

Use case: long-form listening while doing other things (cooking, commuting, walking) where looking at a screen is not desirable.

## Non-goals

- Browser-side PDF parsing or TTS — we do all heavy work offline.
- Public access to the audio — the audiobook player is **admin-only**.
- Sync of listening position across devices — single-device, `localStorage`-only.
- Auto-generating audiobooks on demand — generation is a manual, offline pipeline.
- Other audio formats (Vorbis, AAC) — MP3 only.

## Copyright posture

The source PDFs in `READS[]` are publicly indexed but not necessarily licensed for redistribution. Hosting a TTS narration is a *derivative work* and creates real takedown exposure. Mitigation: the LISTEN button, the listen page, the manifest endpoint, and the audio files themselves are all gated behind admin auth (`adminToken`). Public visitors see no change from today — only the existing "READ PDF ↗" link on each card.

## Architecture

Three independent stages, run at different times and places:

```
[1] Preprocess (in repo)          [2] TTS (work laptop)            [3] Serve + play (VPS + browser)
─────────────────────────         ──────────────────────           ─────────────────────────────
scripts/audiobook_extract.py  →   scripts/audiobook_tts.py    →    POST /api/audiobooks/<slug>/upload-chunk/
download PDF                      reads manifest from repo         POST /api/audiobooks/<slug>/publish/
extract text + outline            Gemini TTS per chunk → .mp3      GET  /api/audiobooks/<slug>/         (admin)
Haiku 4.5 cleans per chapter      per-file upload to VPS           Caddy forward_auth gates /media/audiobooks/
chunk at paragraph boundaries     skip-if-exists for resume
write manifest.json                                                /reads/<slug>/listen page (admin)
git commit + push                                                  plays HTML5 <audio> chunk-by-chunk
                                                                   localStorage saves position
                                                                   minimized pill survives navigation
```

The frontend never sees a PDF, never runs TTS, never talks to Gemini or Haiku. It fetches a JSON manifest and plays `<audio>` elements one after another.

The preprocessing output (`manifest.json`) lives in the repo because it is small, auditable, and lets us regenerate audio if we change the voice or chunking later. The MP3s live on the VPS because they are too big for git (~1.8 GB for DDIA).

Backend is thin: 4 endpoints, no new database model. The manifest JSON file on disk is the source of truth for a book.

## Cost estimate (DDIA, one-time)

- Haiku 4.5 preprocessing: ~$3–5 (1.5M chars in, ~1.5M chars out)
- Gemini 2.5 Flash TTS: ~$0.30 (free via work API key)
- VPS storage: ~1.8 GB out of 40 GB available
- Subsequent listens (any user, any time): free

## Data model

One manifest per book, at `audiobooks/<slug>/manifest.json` (committed to repo). After publish, an identical copy lives at `media/audiobooks/<slug>/manifest.json` on the VPS.

```json
{
  "slug": "ddia",
  "title": "Designing Data-Intensive Applications",
  "author": "Martin Kleppmann",
  "source_pdf_url": "https://0-lucas.github.io/.../DDIA.pdf",
  "voice": "Charon",
  "preprocessor": {
    "model": "claude-haiku-4-5",
    "version": "2026-06-06"
  },
  "chapters": [
    { "id": "preface", "label": "Preface", "chunk_start": 0 },
    { "id": "ch01",    "label": "Ch 1 — Reliable, Scalable, Maintainable", "chunk_start": 24 }
  ],
  "chunks": [
    {
      "id": 0,
      "text": "Many applications today are data-intensive…",
      "page": 7,
      "duration_s": 41.2,
      "kind": "prose"
    },
    {
      "id": 138,
      "text": "Then the query selects the names of all users whose ID equals seven.",
      "page": 142,
      "duration_s": 6.1,
      "kind": "paraphrased_code",
      "original": "SELECT name FROM users WHERE id = 7;"
    },
    {
      "id": 139,
      "text": "A longer code listing follows on page 143; see the PDF.",
      "page": 143,
      "duration_s": 4.0,
      "kind": "code_bridge"
    }
  ]
}
```

`kind` values: `prose`, `paraphrased_code`, `code_bridge`, `figure_bridge`, `table_bridge`, `equation_bridge`. Frontend uses `text` for display only; it never re-synthesizes.

Audio files: `media/audiobooks/<slug>/<chunk_id>.mp3` with zero-padded ids (`00000.mp3`).

`READS[]` entries in `frontend/src/app/reads/ReadsClient.tsx` get one new optional field: `audiobookSlug?: string`. When present **and** the viewer is admin, the card renders both `READ PDF ↗` and `LISTEN ▶`.

## Stage 1: preprocessing script

`scripts/audiobook_extract.py <slug> <pdf_url_or_path>`

Runs anywhere. Requires `ANTHROPIC_API_KEY` for the Haiku step.

```
1. Download PDF (or use local path) → audiobooks/<slug>/source.pdf
2. PyMuPDF: extract text + outline, write audiobooks/<slug>/raw.txt + raw_outline.json
3. Haiku pass per chapter:
   - input:  raw chapter text + "rules" prompt
   - rules:  rejoin broken paragraphs; for each code block decide
             (a) short and meaningful → paraphrase in one sentence (kind=paraphrased_code)
             (b) long or structural → bridge sentence (kind=code_bridge)
             same for figures, tables, equations
   - output: structured JSON array of {text, kind, page, original?}
   - cache per-chapter responses in audiobooks/<slug>/.cache/ so reruns are free
4. Chunk paragraphs at sentence boundaries (target ~600 chars, hard max 1500)
5. Write audiobooks/<slug>/manifest.json (duration_s left as null until TTS step)
```

Output goes into the repo. `--resume` is the default — skip work that is already done.

## Stage 2: TTS + upload script

`scripts/audiobook_tts.py <slug>`

Runs on the work laptop. Requires `GEMINI_API_KEY` and `NAM_ADMIN_TOKEN` env vars and the repo cloned (reads `audiobooks/<slug>/manifest.json`).

Local layout under the repo root:

```
audiobooks/<slug>/
  source.pdf            # downloaded by extract.py, gitignored
  raw.txt               # extracted text, gitignored
  raw_outline.json      # PDF outline, gitignored
  .cache/               # Haiku response cache, gitignored
  manifest.json         # committed
  audio/                # mp3 output of tts.py, gitignored
    00000.mp3
    00001.mp3
    ...
```

`audiobooks/.gitignore` whitelists `manifest.json` and ignores everything else, so the only artifact in version control is the per-book manifest.

```
1. Read manifest.json
2. For each chunk where local audiobooks/<slug>/audio/<id>.mp3 doesn't exist:
   - Call Gemini TTS with chunk text + manifest.voice
   - Save mp3 locally
   - Measure duration with mutagen → write back into manifest.json
3. For each chunk where the server doesn't have it yet:
   - HEAD /api/audiobooks/<slug>/exists/<id>/
   - if 404: POST /api/audiobooks/<slug>/upload-chunk/ multipart {chunk_id, mp3}
4. After all chunks uploaded: POST /api/audiobooks/<slug>/publish/ with manifest.json body
```

Parallel uploads (4 workers), retry-on-fail. Fully resumable — interrupt at any time, rerun continues.

## Stage 3: backend

New Django app file: `website/views/audiobooks.py`, exported via `views/__init__.py`. Routes under `/api/audiobooks/` registered in `website/urls.py`.

Storage layout on VPS:

```
media/audiobooks/<slug>/
  manifest.json
  00000.mp3
  00001.mp3
  …
```

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET  /api/audiobooks/<slug>/`                  | admin Bearer  | Returns manifest.json (used by the listen page) |
| `GET  /api/audiobooks/<slug>/playback-token/`   | admin Bearer  | Returns `{"token": "...", "expires_at": "..."}` — short-lived signed token |
| `GET  /api/audiobooks/<slug>/audio/<id>/?t=...` | signed token  | Streams MP3 with `Range` support |
| `GET  /api/audiobooks/<slug>/exists/<id>/`      | admin Bearer  | 200 if MP3 present, 404 otherwise (used by upload script to skip) |
| `POST /api/audiobooks/<slug>/upload-chunk/`     | admin Bearer  | multipart `{chunk_id, mp3}`; atomic write via `.tmp` + `os.rename` |
| `POST /api/audiobooks/<slug>/publish/`          | admin Bearer  | JSON body = full manifest; validates schema; writes manifest.json atomically |

### Serving audio files (and the auth wrinkle)

The existing admin auth lives in `localStorage` (`adminToken`), read by `getAdminToken()` in `frontend/src/lib/auth.ts`. Two consequences for this feature:

- HTML5 `<audio>` cannot attach `Authorization` headers — the browser issues the request itself.
- Caddy can't see `localStorage`, so a `forward_auth`-against-Caddy-headers approach would require a cookie-auth refactor of `/sudo` that's out of scope for this feature.

Chosen approach: **Django streams the MP3s** through an authed endpoint with a short-lived signed token in the URL query string:

```
GET /api/audiobooks/<slug>/audio/<chunk_id>/?t=<token>
```

- `token` is a Django-signed payload (`{"sub": "admin", "exp": now+1h}`) issued by `GET /api/audiobooks/<slug>/playback-token/` (admin Bearer auth, returns `{"token": "..."}`).
- Client fetches a fresh token on entering the listen page and refreshes it transparently when it has < 5 min remaining.
- Endpoint validates the token, then streams the file with `Range` support (Django's `FileResponse` + `Accept-Ranges` header).
- Tradeoff: the token appears in URLs (and therefore in server logs / browser history). Acceptable for a personal single-admin feature with 1h token TTL; mitigated by the short expiry.

Files in `media/audiobooks/` are NOT served by Caddy's `/media/` `file_server` route — Caddy is configured to skip that subtree so they only reach the public via the Django endpoint. The manifest endpoint (`GET /api/audiobooks/<slug>/`) keeps using the standard Bearer-header admin auth since it's called from JS.

No new database model. Manifest JSON on disk is the source of truth. Tests use a temp `MEDIA_ROOT`.

## Stage 3: frontend

### Files

| File | Action |
|---|---|
| `frontend/src/lib/audiobookPlayer.tsx`               | create — context + hook (mirrors `player.tsx`) |
| `frontend/src/lib/api.ts`                            | modify — add `AudiobookManifest` type + `fetchAudiobook(slug)` helper |
| `frontend/src/components/AudiobookPill.tsx`          | create — minimized pill, rendered globally |
| `frontend/src/app/reads/[slug]/listen/page.tsx`      | create — server component, admin gate + manifest fetch |
| `frontend/src/app/reads/[slug]/listen/ListenClient.tsx` | create — full audiobook UI |
| `frontend/src/app/reads/ReadsClient.tsx`             | modify — `audiobookSlug` field, conditional LISTEN button |
| `frontend/src/app/layout.tsx`                        | modify — wrap `<AudiobookPlayerProvider>`, render `<AudiobookPill />` |

### Player context state

```ts
{
  slug: string | null;
  manifest: AudiobookManifest | null;
  currentChunkId: number;        // index into manifest.chunks
  playing: boolean;
  progressInChunk: number;       // seconds, 0..chunks[i].duration_s
  speed: number;                 // 0.7 .. 2.5, default 1.4
  visible: boolean;
  minimized: boolean;
}
```

Actions: `loadBook(slug)`, `play`, `pause`, `seekToChunk(id, offsetS)`, `skipBack(15)`, `skipForward(30)`, `setSpeed`, `close`, `toggleMinimize`.

Implementation notes:

- Single hidden `<audio>` element managed by the provider; `src` swaps to next chunk on `ended` event.
- `playbackRate` driven from `speed`.
- `timeupdate` throttled to 2 Hz; persists `audiobook-position-<slug>` and `audiobook-current` to localStorage every ~3s.
- `audiobook-speed` saved separately, sticks across books.
- On mount: read `audiobook-current` — if present, restore but do not autoplay (need user gesture).
- Mutual exclusion with music player: each provider's `play()` calls the other's `pause()` first.

### Listen page layout

`page.tsx` is a thin server component that renders `<ListenClient slug={params.slug} />`. The admin gate is **client-side** (the current auth lives in `localStorage`, not cookies):

```
ListenClient on mount:
  1. const token = getAdminToken();
     // getAdminToken() already redirects to /sudo if absent
  2. fetch /api/audiobooks/<slug>/ with Bearer token
     - 403 → router.push("/sudo?next=...") (defensive; should not happen)
     - 404 → render "audiobook not generated yet"
     - 200 → set manifest, fetch playback-token, mount <AudiobookPlayerProvider> if not already mounted
```

`ListenClient.tsx` shape, using reads accent `#94a3b8`:

```
┌─────────────────────────────────────────────────────────┐
│  ← back to reads                                  [×]   │
│                                                         │
│  DESIGNING DATA-INTENSIVE APPLICATIONS                  │
│  Martin Kleppmann · narrated by Charon                  │
│                                                         │
│  ┌─── chapters ────────┐  ┌─── now playing ─────────┐   │
│  │ ▸ Preface           │  │  Chunk 138 of 1483      │   │
│  │ • Ch 1 Reliable…    │  │  Ch 5 — Replication     │   │
│  │ • Ch 2 Data Models  │  │                         │   │
│  │ • Ch 3 Storage…     │  │  "Then the query        │   │
│  │ • Ch 4 Encoding…    │  │   selects the names…"   │   │
│  │ ▸ Ch 5 Replication  │  │                         │   │
│  │ • Ch 6 Partitioning │  │  ──●──────────  6:42/7:30 │
│  │ …                   │  │  speed: ────●──── 1.4×  │   │
│  └─────────────────────┘  │  ⏮ -15s  ⏸  +30s ⏭     │   │
│                           └─────────────────────────┘   │
│  CyberGrid background, font-headline                    │
└─────────────────────────────────────────────────────────┘
```

Chapter click → `seekToChunk(chapter.chunk_start, 0)`. The "now playing" snippet uses `manifest.chunks[currentChunkId].text`. Big progress bar shows position within current chunk. Thin overall bar below shows progress across the whole book (computed from sum of `duration_s`).

### Pill

Mirrors the minimized music MiniPlayer with a 📖 glyph and the book title (truncated). Tapping routes to `/reads/<slug>/listen`. Rendered globally from `layout.tsx`. Visible only when `audiobookPlayer.visible && audiobookPlayer.minimized`.

### Admin gating (three layers)

1. **LISTEN button** on `ReadCard`: renders only if `getAdminToken()` returns truthy (client-side; visitors never see it).
2. **`/reads/<slug>/listen` page**: client component calls `getAdminToken()` on mount; missing token → redirect to `/sudo?next=/reads/<slug>/listen`.
3. **Backend endpoints**: manifest + management endpoints use existing `require_admin` Bearer auth; audio streaming uses a short-lived signed token issued via `playback-token` endpoint (admin Bearer required to issue).

The only new auth primitive is the playback-token signer/verifier — a thin wrapper around Django's `signing.dumps`/`signing.loads` with a 1h TTL. Everything else reuses existing helpers (`require_admin`, `store("adminToken")`, `getAdminToken()`).

## Error handling

### Scripts

| Failure | Behavior |
|---|---|
| PDF download fails | Print URL, exit 1; rerun is idempotent |
| PyMuPDF cannot open (encrypted) | Print path + suggest unlocking, exit 1 |
| Haiku rate-limit / 5xx | Retry 3× with backoff; on final failure save partial cache and exit 1 |
| Haiku returns malformed JSON | Log raw response to `.cache/`; skip that chapter, continue (chunk it as plain prose) |
| Gemini TTS rate-limit | Retry 3× with backoff; rerun skips existing `.mp3` |
| Gemini TTS content-policy reject | Log chunk id + text; fall back to 5s of silence so playback does not break |
| Upload 401 (admin token expired) | Print "refresh `NAM_ADMIN_TOKEN`" + exit 1 |
| Upload 5xx | Retry 3× per chunk; on final failure log and exit 1 |
| Network drop mid-upload | Per-chunk uploads lose at most one chunk; rerun resumes |

### Backend

| Endpoint | Failure mode |
|---|---|
| `GET /api/audiobooks/<slug>/`         | 404 if no manifest.json on disk; 403 if not admin |
| `GET .../exists/<id>/`                | 200 / 404 only |
| `POST .../upload-chunk/`              | 413 if file > 50 MB; 400 if `chunk_id` not int; atomic write |
| `POST .../publish/`                   | 400 on schema mismatch; rejects if any referenced chunk MP3 missing |
| Caddy `forward_auth` → Django down    | Fail-closed (403); listen page also fails, so user-visible behaviour stays consistent |

### Frontend

| Failure | Behavior |
|---|---|
| Missing admin token on listen page mount | Client-side redirect to `/sudo?next=/reads/<slug>/listen` |
| Manifest fetch 403 | Defensive: same redirect as above (should not happen if step above ran) |
| Manifest fetch 404 | Show "audiobook not generated yet" on the listen page |
| Playback token fetch fails | Show inline error "audio unavailable — log in again at /sudo", with retry button |
| Playback token nearing expiry (< 5 min) | Background refresh; if refresh fails, surface the same inline error |
| `<audio>` `error` event on a chunk | Inline error in now-playing card ("chunk N unavailable — skip"), button to skip to chunk N+1; position persisted so reload retries |
| Admin token expires entirely mid-listen | Next playback-token refresh returns 403 → inline error + log-in hint |
| localStorage disabled / SSR | All localStorage reads go through `store()`/`storeDel()` in `lib/auth.ts` — already null-safe |
| Music + audiobook conflict | Mutual `pause()` calls before `play()` — no overlap |

## Testing

### Backend (`website/tests/test_audiobooks.py`)

- `test_manifest_get_requires_admin`
- `test_manifest_get_404`
- `test_exists_endpoint`
- `test_upload_chunk_writes_file_atomic`
- `test_upload_chunk_rejects_huge_file`
- `test_publish_validates_schema`
- `test_publish_rejects_when_audio_missing`
- `test_publish_writes_manifest_atomically`
- `test_playback_token_requires_admin`
- `test_audio_stream_accepts_valid_token`
- `test_audio_stream_rejects_expired_token`
- `test_audio_stream_rejects_token_for_other_slug`
- `test_audio_stream_supports_range_requests`

All use a tmp `MEDIA_ROOT` fixture.

### Frontend (`frontend/src/lib/__tests__/audiobookPlayer.test.ts`)

Pure logic, vitest node env:

- `test_nextChunk_advances`
- `test_nextChunk_at_end_stops`
- `test_chapterForChunk`
- `test_persistPosition_roundtrip`
- `test_resumePosition_returns_null_when_empty`

### Scripts (`scripts/tests/`)

- `test_chunk_paragraphs_respects_max_len`
- `test_clean_pdf_text_dehyphenates`

(Skip live Gemini/Haiku integration tests — too flaky for CI.)

### Manual verification

1. Run `audiobook_extract.py ddia <url>` against the DDIA PDF. Diff `manifest.json` by hand for ~10 chunks across different sections (prose, SQL-heavy, equation-heavy). Confirm code paraphrasing is sensible.
2. Run `audiobook_tts.py ddia` end-to-end against local Django (`make up`). Confirm ~2000 `.mp3` files land in `media/audiobooks/ddia/`. Listen to chunks 0, 138, 700, 1900.
3. Visit `/reads/ddia/listen` as admin: chapter list renders, play works, scrub works, speed works, pill survives navigation to `/listens` and back, mutual exclusion with music MiniPlayer holds.
4. Visit `/reads` not logged in: no LISTEN button. Visit `/reads/ddia/listen` not logged in: redirected to `/sudo`. `curl /media/audiobooks/ddia/00000.mp3` without admin cookie returns 403.
5. After deploy, run the same flow on production with a small (2-chunk) test book.

### Documentation updates

- `docs/README.md` — mention "audiobook player (admin-only)" under reads.
- `docs/QA-CHECKLIST.md` — new section mirroring step (3)–(4) above.

## Out of scope

- Public access to the audio.
- Cross-device sync of listening position.
- Auto-generation on demand.
- Other audio formats.
- Browser-side PDF or TTS.
- Voice cloning / custom voices beyond Gemini's named set.
- Bookmarks, notes, or highlights inside the audiobook.

## Open questions

None blocking. The first book (DDIA) defines the pipeline; subsequent books reuse it with just `audiobook_extract.py <slug> <url>` + `audiobook_tts.py <slug>` + adding `audiobookSlug` to the `READS[]` entry.
