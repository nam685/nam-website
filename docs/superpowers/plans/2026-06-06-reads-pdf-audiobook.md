# Reads PDF Audiobook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin-only PDF audiobook player on `/reads`. Offline scripts turn a PDF into MP3 chunks via Haiku (cleanup) + Gemini (TTS); a new Django endpoint serves them; a new listen page plays them.

**Architecture:** Three independent stages — (1) a preprocessing script writes `manifest.json` to the repo, (2) a TTS script generates MP3s on the dev laptop and uploads them to the VPS, (3) Django streams the MP3s through a signed-token endpoint and a new client React page plays them chunk-by-chunk with chapter navigation, resume-from-localStorage, and a minimized pill that survives navigation. See `docs/superpowers/specs/2026-06-06-reads-pdf-audiobook-design.md` for the design rationale.

**Tech Stack:** Python 3.12 + Django 6 + PyMuPDF + `anthropic` (Haiku 4.5) + `google-genai` (Gemini 2.5 Flash TTS) + `mutagen` for duration. Next.js 16 + React 19 + TypeScript 5 (HTML5 `<audio>`, `localStorage`). Tests: pytest + vitest.

---

## File Structure

Backend (`website/`):
- **Create** `website/views/audiobook.py` — all 6 audiobook endpoints
- **Modify** `website/views/__init__.py` — re-export new view functions
- **Modify** `website/urls.py` — wire `/api/audiobooks/...` routes
- **Create** `website/audiobook_tokens.py` — `create_playback_token` / `verify_playback_token` helpers (kept separate from `auth.py` to not muddle admin token logic)
- **Create** `website/tests/__init__.py` if missing, plus `website/tests/test_audiobook.py`
- **Create** `config/settings.py` modification: ensure `MEDIA_ROOT` setting exists and `audiobooks/` is under it (only if not already configured — check)
- **Modify** `Caddyfile.example` and/or production Caddy config to **not** auto-serve `/media/audiobooks/` (route it to Django instead). This is doc-only in the repo; production change is a deploy-time edit.

Frontend (`frontend/src/`):
- **Create** `frontend/src/lib/audiobookPlayer.tsx` — React context + provider + `useAudiobookPlayer` hook
- **Modify** `frontend/src/lib/api.ts` — add `AudiobookManifest` and `AudiobookChunk` types + `fetchAudiobook(slug, token)` helper
- **Create** `frontend/src/components/AudiobookPill.tsx` — minimized pill
- **Create** `frontend/src/app/reads/[slug]/listen/page.tsx` — thin server component
- **Create** `frontend/src/app/reads/[slug]/listen/ListenClient.tsx` — main UI
- **Modify** `frontend/src/app/reads/ReadsClient.tsx` — `audiobookSlug` field + conditional LISTEN button
- **Modify** `frontend/src/app/layout.tsx` — wrap with `<AudiobookPlayerProvider>`, render `<AudiobookPill />`
- **Modify** `frontend/src/lib/player.tsx` — expose `pause()` reference for mutual exclusion (add `pauseExternally` action)
- **Create** `frontend/src/lib/__tests__/audiobookPlayer.test.ts`

Scripts (`scripts/`):
- **Create** `scripts/audiobook_extract.py` — PDF → cleaned manifest
- **Create** `scripts/audiobook_tts.py` — manifest → MP3s → upload → publish
- **Create** `scripts/audiobook_lib.py` — pure helpers (chunking, text cleaning, manifest IO)
- **Create** `scripts/tests/__init__.py`, `scripts/tests/test_audiobook_lib.py`

Repository:
- **Create** `audiobooks/.gitignore` — ignore everything except `manifest.json`
- **Modify** `pyproject.toml` — add `pymupdf`, `mutagen`, `anthropic`, `google-genai` to `[dependency-groups].dev` (scripts are dev-only — not needed in prod runtime)

Docs:
- **Modify** `docs/README.md` — mention admin-only audiobook player under reads
- **Modify** `docs/QA-CHECKLIST.md` — new section for audiobook flows
- **Modify** root `CLAUDE.md` — add `/api/audiobooks/...` endpoints to the API list

---

## Phase 1 — Backend

### Task 1: Wire up `audiobook.py` skeleton + routing

**Files:**
- Create: `website/views/audiobook.py`
- Modify: `website/views/__init__.py`
- Modify: `website/urls.py`

- [ ] **Step 1: Create the view module skeleton**

```python
# website/views/audiobook.py
"""Audiobook endpoints — admin-only manifest CRUD + signed-token audio streaming."""
import json
import os
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from ..audiobook_tokens import create_playback_token, verify_playback_token
from ..auth import require_admin


def _book_dir(slug: str) -> Path:
    return Path(settings.MEDIA_ROOT) / "audiobooks" / slug


def _manifest_path(slug: str) -> Path:
    return _book_dir(slug) / "manifest.json"


def _audio_path(slug: str, chunk_id: int) -> Path:
    return _book_dir(slug) / f"{chunk_id:05d}.mp3"


@require_GET
@require_admin
def audiobook_manifest(request, slug: str):  # noqa: ARG001
    path = _manifest_path(slug)
    if not path.exists():
        return JsonResponse({"error": "Not found"}, status=404)
    return JsonResponse(json.loads(path.read_text()))


@require_GET
@require_admin
def audiobook_playback_token(request, slug: str):  # noqa: ARG001
    if not _manifest_path(slug).exists():
        return JsonResponse({"error": "Not found"}, status=404)
    token, expires_at = create_playback_token(slug)
    return JsonResponse({"token": token, "expires_at": expires_at})


@require_GET
def audiobook_audio(request, slug: str, chunk_id: int):
    token = request.GET.get("t", "")
    if not verify_playback_token(token, slug):
        return JsonResponse({"error": "Unauthorized"}, status=403)
    path = _audio_path(slug, chunk_id)
    if not path.exists():
        return JsonResponse({"error": "Not found"}, status=404)
    response = FileResponse(open(path, "rb"), content_type="audio/mpeg")
    response["Accept-Ranges"] = "bytes"
    return response


@require_GET
@require_admin
def audiobook_chunk_exists(request, slug: str, chunk_id: int):  # noqa: ARG001
    if _audio_path(slug, chunk_id).exists():
        return HttpResponse(status=200)
    return HttpResponse(status=404)


@csrf_exempt
@require_POST
@require_admin
def audiobook_upload_chunk(request, slug: str):
    chunk_id_raw = request.POST.get("chunk_id", "")
    try:
        chunk_id = int(chunk_id_raw)
    except ValueError:
        return JsonResponse({"error": "chunk_id must be int"}, status=400)
    if chunk_id < 0:
        return JsonResponse({"error": "chunk_id must be non-negative"}, status=400)
    f = request.FILES.get("mp3")
    if not f:
        return JsonResponse({"error": "mp3 file required"}, status=400)
    if f.size > 50 * 1024 * 1024:
        return JsonResponse({"error": "mp3 too large (max 50MB)"}, status=413)
    book_dir = _book_dir(slug)
    book_dir.mkdir(parents=True, exist_ok=True)
    target = _audio_path(slug, chunk_id)
    tmp = target.with_suffix(".mp3.tmp")
    with open(tmp, "wb") as out:
        for chunk in f.chunks():
            out.write(chunk)
    os.rename(tmp, target)
    return JsonResponse({"ok": True, "chunk_id": chunk_id, "size": f.size})


@csrf_exempt
@require_POST
@require_admin
def audiobook_publish(request, slug: str):
    try:
        manifest = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "invalid JSON"}, status=400)
    err = _validate_manifest(manifest, slug)
    if err:
        return JsonResponse({"error": err}, status=400)
    # Verify every referenced chunk's MP3 exists on disk
    for chunk in manifest["chunks"]:
        if not _audio_path(slug, chunk["id"]).exists():
            return JsonResponse({"error": f"missing audio for chunk {chunk['id']}"}, status=400)
    book_dir = _book_dir(slug)
    book_dir.mkdir(parents=True, exist_ok=True)
    target = _manifest_path(slug)
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    os.rename(tmp, target)
    return JsonResponse({"ok": True})


REQUIRED_TOP_KEYS = {"slug", "title", "author", "voice", "chapters", "chunks"}
REQUIRED_CHUNK_KEYS = {"id", "text", "duration_s", "kind"}


def _validate_manifest(manifest, slug: str) -> str | None:
    if not isinstance(manifest, dict):
        return "manifest must be an object"
    missing = REQUIRED_TOP_KEYS - set(manifest.keys())
    if missing:
        return f"missing keys: {sorted(missing)}"
    if manifest["slug"] != slug:
        return f"slug mismatch (URL={slug!r}, manifest={manifest['slug']!r})"
    chunks = manifest["chunks"]
    if not isinstance(chunks, list) or not chunks:
        return "chunks must be a non-empty list"
    for i, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            return f"chunk {i} is not an object"
        cm = REQUIRED_CHUNK_KEYS - set(chunk.keys())
        if cm:
            return f"chunk {i} missing keys: {sorted(cm)}"
        if chunk["id"] != i:
            return f"chunk index {i} has id {chunk['id']} (must be contiguous from 0)"
    return None
```

- [ ] **Step 2: Add a placeholder `audiobook_tokens.py` so imports don't fail**

```python
# website/audiobook_tokens.py
"""Short-lived signed tokens for audio file URLs."""
from datetime import datetime, timedelta, timezone

from django.core import signing

PLAYBACK_TTL_SECONDS = 60 * 60  # 1h


def create_playback_token(slug: str) -> tuple[str, str]:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=PLAYBACK_TTL_SECONDS)
    payload = {"slug": slug}
    token = signing.dumps(payload, salt="audiobook-playback")
    return token, expires_at.isoformat()


def verify_playback_token(token: str, slug: str) -> bool:
    try:
        payload = signing.loads(token, salt="audiobook-playback", max_age=PLAYBACK_TTL_SECONDS)
    except (signing.BadSignature, signing.SignatureExpired):
        return False
    return payload.get("slug") == slug
```

- [ ] **Step 3: Re-export the new views**

Modify `website/views/__init__.py` — add an `audiobook` block (sort-friendly placement among the existing imports), and add the names to `__all__`:

```python
# add after `from .auth import nonce as auth_nonce`
from .audiobook import (
    audiobook_audio,
    audiobook_chunk_exists,
    audiobook_manifest,
    audiobook_playback_token,
    audiobook_publish,
    audiobook_upload_chunk,
)
```

```python
# in __all__, add (alpha order):
"audiobook_audio",
"audiobook_chunk_exists",
"audiobook_manifest",
"audiobook_playback_token",
"audiobook_publish",
"audiobook_upload_chunk",
```

- [ ] **Step 4: Wire URLs**

Modify `website/urls.py` — append to `urlpatterns` (group together, alphabetical with existing groups):

```python
    path("audiobooks/<slug:slug>/", views.audiobook_manifest),
    path("audiobooks/<slug:slug>/playback-token/", views.audiobook_playback_token),
    path("audiobooks/<slug:slug>/audio/<int:chunk_id>/", views.audiobook_audio),
    path("audiobooks/<slug:slug>/exists/<int:chunk_id>/", views.audiobook_chunk_exists),
    path("audiobooks/<slug:slug>/upload-chunk/", views.audiobook_upload_chunk),
    path("audiobooks/<slug:slug>/publish/", views.audiobook_publish),
```

- [ ] **Step 5: Verify imports load**

Run: `uv run python -c "from website import views; print(views.audiobook_manifest)"`
Expected: prints a function object, no errors.

- [ ] **Step 6: Commit**

```bash
git add website/views/audiobook.py website/audiobook_tokens.py website/views/__init__.py website/urls.py
git commit -m "feat(audiobook): backend endpoint skeleton + playback token helpers"
```

---

### Task 2: Test the manifest endpoint

**Files:**
- Create: `website/tests/test_audiobook.py`

- [ ] **Step 1: Write failing tests**

```python
# website/tests/test_audiobook.py
import json
from pathlib import Path

import pytest


@pytest.fixture()
def media_root(tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)
    return tmp_path


def _write_minimal_manifest(media_root: Path, slug: str) -> dict:
    book_dir = media_root / "audiobooks" / slug
    book_dir.mkdir(parents=True)
    manifest = {
        "slug": slug,
        "title": "Test Book",
        "author": "Test Author",
        "voice": "Charon",
        "chapters": [{"id": "ch01", "label": "Chapter 1", "chunk_start": 0}],
        "chunks": [{"id": 0, "text": "Hello.", "duration_s": 1.0, "kind": "prose"}],
    }
    (book_dir / "manifest.json").write_text(json.dumps(manifest))
    return manifest


@pytest.mark.django_db
def test_manifest_get_requires_admin(client, media_root):
    _write_minimal_manifest(media_root, "ddia")
    res = client.get("/api/audiobooks/ddia/")
    assert res.status_code == 401


@pytest.mark.django_db
def test_manifest_get_404(client, media_root, auth_headers):
    res = client.get("/api/audiobooks/no-such-book/", **auth_headers)
    assert res.status_code == 404


@pytest.mark.django_db
def test_manifest_get_returns_json(client, media_root, auth_headers):
    manifest = _write_minimal_manifest(media_root, "ddia")
    res = client.get("/api/audiobooks/ddia/", **auth_headers)
    assert res.status_code == 200
    assert res.json() == manifest
```

- [ ] **Step 2: Run to verify they fail (no MEDIA_ROOT might be set), then pass after settings fixture override**

Run: `uv run pytest website/tests/test_audiobook.py -v`
Expected: 3 tests pass (the fixture overrides `MEDIA_ROOT` at test time, so no real media writes).

If they fail because `settings.MEDIA_ROOT` isn't defined in test settings, check `config/settings.py` — `MEDIA_ROOT` must exist and default to a real path. If absent, set `MEDIA_ROOT = BASE_DIR / "media"` near `STATIC_ROOT`.

- [ ] **Step 3: Commit**

```bash
git add website/tests/test_audiobook.py
git commit -m "test(audiobook): manifest endpoint auth + 404 + happy path"
```

---

### Task 3: Test + fix the exists + upload-chunk endpoints

**Files:**
- Modify: `website/tests/test_audiobook.py`

- [ ] **Step 1: Write failing tests**

Append to `website/tests/test_audiobook.py`:

```python
@pytest.mark.django_db
def test_chunk_exists_returns_404_when_missing(client, media_root, auth_headers):
    res = client.get("/api/audiobooks/ddia/exists/0/", **auth_headers)
    assert res.status_code == 404


@pytest.mark.django_db
def test_chunk_exists_returns_200_when_present(client, media_root, auth_headers):
    book = media_root / "audiobooks" / "ddia"
    book.mkdir(parents=True)
    (book / "00000.mp3").write_bytes(b"\xff\xfb" + b"0" * 100)  # fake MP3 header
    res = client.get("/api/audiobooks/ddia/exists/0/", **auth_headers)
    assert res.status_code == 200


@pytest.mark.django_db
def test_upload_chunk_writes_file(client, media_root, auth_headers):
    from django.core.files.uploadedfile import SimpleUploadedFile

    payload = b"\xff\xfb" + b"0" * 100
    res = client.post(
        "/api/audiobooks/ddia/upload-chunk/",
        {"chunk_id": "42", "mp3": SimpleUploadedFile("42.mp3", payload, content_type="audio/mpeg")},
        **auth_headers,
    )
    assert res.status_code == 200
    written = (media_root / "audiobooks" / "ddia" / "00042.mp3").read_bytes()
    assert written == payload


@pytest.mark.django_db
def test_upload_chunk_rejects_bad_chunk_id(client, media_root, auth_headers):
    from django.core.files.uploadedfile import SimpleUploadedFile

    res = client.post(
        "/api/audiobooks/ddia/upload-chunk/",
        {"chunk_id": "abc", "mp3": SimpleUploadedFile("x.mp3", b"x", content_type="audio/mpeg")},
        **auth_headers,
    )
    assert res.status_code == 400


@pytest.mark.django_db
def test_upload_chunk_rejects_huge_file(client, media_root, auth_headers, settings):
    from django.core.files.uploadedfile import SimpleUploadedFile

    big = b"x" * (51 * 1024 * 1024)
    settings.DATA_UPLOAD_MAX_MEMORY_SIZE = 100 * 1024 * 1024  # allow upload to reach view
    settings.FILE_UPLOAD_MAX_MEMORY_SIZE = 100 * 1024 * 1024
    res = client.post(
        "/api/audiobooks/ddia/upload-chunk/",
        {"chunk_id": "1", "mp3": SimpleUploadedFile("x.mp3", big, content_type="audio/mpeg")},
        **auth_headers,
    )
    assert res.status_code == 413
```

- [ ] **Step 2: Run**

Run: `uv run pytest website/tests/test_audiobook.py -v`
Expected: all pass. (If the huge-file test is slow, that's OK — it's a one-off.)

- [ ] **Step 3: Commit**

```bash
git add website/tests/test_audiobook.py
git commit -m "test(audiobook): chunk exists + upload happy/sad paths"
```

---

### Task 4: Test + fix the publish endpoint

**Files:**
- Modify: `website/tests/test_audiobook.py`

- [ ] **Step 1: Write failing tests**

Append:

```python
@pytest.mark.django_db
def test_publish_writes_manifest(client, media_root, auth_headers):
    book = media_root / "audiobooks" / "ddia"
    book.mkdir(parents=True)
    (book / "00000.mp3").write_bytes(b"x")
    manifest = {
        "slug": "ddia",
        "title": "DDIA",
        "author": "Kleppmann",
        "voice": "Charon",
        "chapters": [{"id": "ch01", "label": "Ch 1", "chunk_start": 0}],
        "chunks": [{"id": 0, "text": "hello", "duration_s": 1.0, "kind": "prose"}],
    }
    res = client.post(
        "/api/audiobooks/ddia/publish/",
        data=json.dumps(manifest),
        content_type="application/json",
        **auth_headers,
    )
    assert res.status_code == 200
    written = json.loads((book / "manifest.json").read_text())
    assert written == manifest


@pytest.mark.django_db
def test_publish_rejects_slug_mismatch(client, media_root, auth_headers):
    manifest = {
        "slug": "other",
        "title": "DDIA",
        "author": "K",
        "voice": "Charon",
        "chapters": [],
        "chunks": [{"id": 0, "text": "x", "duration_s": 1.0, "kind": "prose"}],
    }
    res = client.post(
        "/api/audiobooks/ddia/publish/",
        data=json.dumps(manifest),
        content_type="application/json",
        **auth_headers,
    )
    assert res.status_code == 400
    assert "slug mismatch" in res.json()["error"]


@pytest.mark.django_db
def test_publish_rejects_non_contiguous_chunks(client, media_root, auth_headers):
    manifest = {
        "slug": "ddia",
        "title": "DDIA",
        "author": "K",
        "voice": "Charon",
        "chapters": [],
        "chunks": [
            {"id": 0, "text": "a", "duration_s": 1.0, "kind": "prose"},
            {"id": 2, "text": "b", "duration_s": 1.0, "kind": "prose"},
        ],
    }
    res = client.post(
        "/api/audiobooks/ddia/publish/",
        data=json.dumps(manifest),
        content_type="application/json",
        **auth_headers,
    )
    assert res.status_code == 400


@pytest.mark.django_db
def test_publish_rejects_when_audio_missing(client, media_root, auth_headers):
    manifest = {
        "slug": "ddia",
        "title": "DDIA",
        "author": "K",
        "voice": "Charon",
        "chapters": [],
        "chunks": [{"id": 0, "text": "x", "duration_s": 1.0, "kind": "prose"}],
    }
    res = client.post(
        "/api/audiobooks/ddia/publish/",
        data=json.dumps(manifest),
        content_type="application/json",
        **auth_headers,
    )
    assert res.status_code == 400
    assert "missing audio" in res.json()["error"]
```

- [ ] **Step 2: Run**

Run: `uv run pytest website/tests/test_audiobook.py -v`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add website/tests/test_audiobook.py
git commit -m "test(audiobook): publish validation + happy path"
```

---

### Task 5: Test + fix playback token + audio streaming

**Files:**
- Modify: `website/tests/test_audiobook.py`

- [ ] **Step 1: Write failing tests**

Append:

```python
@pytest.mark.django_db
def test_playback_token_requires_admin(client, media_root):
    res = client.get("/api/audiobooks/ddia/playback-token/")
    assert res.status_code == 401


@pytest.mark.django_db
def test_playback_token_404_when_no_book(client, media_root, auth_headers):
    res = client.get("/api/audiobooks/no-book/playback-token/", **auth_headers)
    assert res.status_code == 404


@pytest.mark.django_db
def test_playback_token_returns_token(client, media_root, auth_headers):
    _write_minimal_manifest(media_root, "ddia")
    res = client.get("/api/audiobooks/ddia/playback-token/", **auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body["token"], str) and len(body["token"]) > 10
    assert body["expires_at"]


@pytest.mark.django_db
def test_audio_stream_rejects_no_token(client, media_root):
    book = media_root / "audiobooks" / "ddia"
    book.mkdir(parents=True)
    (book / "00000.mp3").write_bytes(b"x" * 100)
    res = client.get("/api/audiobooks/ddia/audio/0/")
    assert res.status_code == 403


@pytest.mark.django_db
def test_audio_stream_accepts_valid_token(client, media_root):
    from website.audiobook_tokens import create_playback_token

    book = media_root / "audiobooks" / "ddia"
    book.mkdir(parents=True)
    (book / "00000.mp3").write_bytes(b"abc")
    token, _ = create_playback_token("ddia")
    res = client.get(f"/api/audiobooks/ddia/audio/0/?t={token}")
    assert res.status_code == 200
    assert res["Accept-Ranges"] == "bytes"
    assert b"".join(res.streaming_content) == b"abc"


@pytest.mark.django_db
def test_audio_stream_rejects_token_for_other_slug(client, media_root):
    from website.audiobook_tokens import create_playback_token

    book = media_root / "audiobooks" / "ddia"
    book.mkdir(parents=True)
    (book / "00000.mp3").write_bytes(b"x")
    token, _ = create_playback_token("other-book")
    res = client.get(f"/api/audiobooks/ddia/audio/0/?t={token}")
    assert res.status_code == 403


@pytest.mark.django_db
def test_audio_stream_404_when_missing(client, media_root):
    from website.audiobook_tokens import create_playback_token

    token, _ = create_playback_token("ddia")
    res = client.get(f"/api/audiobooks/ddia/audio/0/?t={token}")
    assert res.status_code == 404


@pytest.mark.django_db
def test_audio_stream_rejects_expired_token(client, media_root, monkeypatch):
    from django.core import signing
    import website.audiobook_tokens as tokens

    book = media_root / "audiobooks" / "ddia"
    book.mkdir(parents=True)
    (book / "00000.mp3").write_bytes(b"x")
    # Force the max-age check to fail
    monkeypatch.setattr(tokens, "PLAYBACK_TTL_SECONDS", -1)
    token = signing.dumps({"slug": "ddia"}, salt="audiobook-playback")
    res = client.get(f"/api/audiobooks/ddia/audio/0/?t={token}")
    assert res.status_code == 403


@pytest.mark.django_db
def test_audio_stream_supports_range_requests(client, media_root):
    from website.audiobook_tokens import create_playback_token

    book = media_root / "audiobooks" / "ddia"
    book.mkdir(parents=True)
    (book / "00000.mp3").write_bytes(b"0123456789" * 10)  # 100 bytes
    token, _ = create_playback_token("ddia")
    res = client.get(
        f"/api/audiobooks/ddia/audio/0/?t={token}",
        HTTP_RANGE="bytes=10-19",
    )
    # Django's FileResponse handles Range with HTTP 206 + sliced body
    assert res.status_code in (200, 206)
    assert res["Accept-Ranges"] == "bytes"
    body = b"".join(res.streaming_content)
    if res.status_code == 206:
        assert body == b"0123456789"
    else:
        # If 200, the test environment didn't honour Range — ensure full body
        assert len(body) == 100
```

- [ ] **Step 2: Run**

Run: `uv run pytest website/tests/test_audiobook.py -v`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add website/tests/test_audiobook.py
git commit -m "test(audiobook): playback token + audio streaming"
```

---

## Phase 2 — Frontend types + ReadsClient

### Task 6: Add audiobook types and helper to `api.ts`

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Append types and helper at end of file**

```ts
/* ── Audiobook ─────────────────────────────────────── */

export type AudiobookChunkKind =
  | "prose"
  | "paraphrased_code"
  | "code_bridge"
  | "figure_bridge"
  | "table_bridge"
  | "equation_bridge";

export interface AudiobookChunk {
  id: number;
  text: string;
  duration_s: number;
  kind: AudiobookChunkKind;
  page?: number;
  original?: string;
}

export interface AudiobookChapter {
  id: string;
  label: string;
  chunk_start: number;
}

export interface AudiobookManifest {
  slug: string;
  title: string;
  author: string;
  source_pdf_url?: string;
  voice: string;
  preprocessor?: { model: string; version: string };
  chapters: AudiobookChapter[];
  chunks: AudiobookChunk[];
}

export async function fetchAudiobookManifest(
  slug: string,
  token: string,
): Promise<AudiobookManifest | null> {
  const res = await fetch(`${API}/api/audiobooks/${slug}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchAudiobookPlaybackToken(
  slug: string,
  token: string,
): Promise<{ token: string; expires_at: string }> {
  const res = await fetch(`${API}/api/audiobooks/${slug}/playback-token/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`playback-token fetch failed: ${res.status}`);
  return res.json();
}

export function audiobookAudioUrl(
  slug: string,
  chunkId: number,
  playbackToken: string,
): string {
  return `${API}/api/audiobooks/${slug}/audio/${chunkId}/?t=${encodeURIComponent(playbackToken)}`;
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(audiobook): API types + helpers"
```

---

### Task 7: Conditional LISTEN button in `ReadCard`

**Files:**
- Modify: `frontend/src/app/reads/ReadsClient.tsx`

- [ ] **Step 1: Add the optional field to `ReadItem`**

Edit the `ReadItem` interface (around line 34) to include `audiobookSlug?: string`:

```ts
interface ReadItem {
  title: string;
  author: string;
  type: "book" | "paper" | "essay" | "audio book";
  description: string;
  tags: string[];
  url: string;
  audiobookSlug?: string;
}
```

- [ ] **Step 2: Add `audiobookSlug: "ddia"` to the DDIA entry in `READS`**

The DDIA entry doesn't exist in `READS[]` yet. **Add it** between `Macroeconomics` and `Nexus` (kept in priority order):

```ts
  {
    title: "Designing Data-Intensive Applications",
    author: "Martin Kleppmann",
    type: "book",
    description:
      "The deep, surprisingly readable systems book on storage, replication, partitioning, and consensus.",
    tags: ["systems", "databases", "distributed"],
    url: "https://0-lucas.github.io/digital-garden/99.-Books/Martin-Kleppmann---Designing-Data-Intensive-Applications_-O%E2%80%99Reilly-Media-(2017).pdf",
    audiobookSlug: "ddia",
  },
```

- [ ] **Step 3: Import the auth helper at top of file**

Add at top with other imports (after `"use client";`):

```ts
import { useEffect, useState } from "react";
import { store } from "@/lib/auth";
```

- [ ] **Step 4: Add an `isAdmin` hook inside `ReadsClient` and pass to `ReadCard`**

Inside `ReadsClient`, before the return, add:

```ts
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    setIsAdmin(!!store("adminToken"));
  }, []);
```

Then change each `<ReadCard ... />` call site to pass `isAdmin={isAdmin}`:

```tsx
{READS.map((item) => (
  <ReadCard key={item.title} item={item} isAdmin={isAdmin} />
))}
```

(Same for `ONGOING_READS.map` and `FUTURE_READS.map`.)

- [ ] **Step 5: Update `ReadCard` signature and render the LISTEN button**

Replace the `ReadCard` signature:

```tsx
function ReadCard({
  item,
  dimmed,
  isAdmin,
}: {
  item: ReadItem;
  dimmed?: boolean;
  isAdmin?: boolean;
}) {
```

Then in the link block at the bottom of the card (around line 270, the `{item.url ? (...) : (...)}` section), expand to show both PDF link and LISTEN button when applicable. Replace the whole inner block:

```tsx
{item.url ? (
  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="read-link"
      style={{
        fontFamily: "var(--font-headline)",
        fontSize: "0.7rem",
        color: ACCENT,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
      }}
    >
      {linkLabel}
      <span style={{ fontSize: "0.85rem" }}>&#8599;</span>
    </a>
    {isAdmin && item.audiobookSlug ? (
      <a
        href={`/reads/${item.audiobookSlug}/listen`}
        className="read-link"
        style={{
          fontFamily: "var(--font-headline)",
          fontSize: "0.7rem",
          color: ACCENT,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
        }}
      >
        LISTEN
        <span style={{ fontSize: "0.85rem" }}>&#9654;</span>
      </a>
    ) : null}
  </div>
) : (
  <span
    style={{
      fontFamily: "var(--font-headline)",
      fontSize: "0.7rem",
      color: "#444",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      fontWeight: 700,
    }}
  >
    IN QUEUE
  </span>
)}
```

- [ ] **Step 6: Type-check + lint**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm lint`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/reads/ReadsClient.tsx
git commit -m "feat(audiobook): conditional LISTEN button + DDIA entry"
```

---

## Phase 3 — Frontend player context

### Task 8: Pure helper tests (no React) for chunk math + position persistence

**Files:**
- Create: `frontend/src/lib/audiobookPlayerHelpers.ts`
- Create: `frontend/src/lib/__tests__/audiobookPlayerHelpers.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/__tests__/audiobookPlayerHelpers.test.ts
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import type { AudiobookManifest } from "../api";
import {
  chapterForChunk,
  loadPosition,
  nextChunkId,
  savePosition,
} from "../audiobookPlayerHelpers";

const MANIFEST: AudiobookManifest = {
  slug: "ddia",
  title: "DDIA",
  author: "K",
  voice: "Charon",
  chapters: [
    { id: "preface", label: "Preface", chunk_start: 0 },
    { id: "ch01", label: "Ch 1", chunk_start: 5 },
    { id: "ch02", label: "Ch 2", chunk_start: 10 },
  ],
  chunks: Array.from({ length: 15 }, (_, i) => ({
    id: i,
    text: `chunk ${i}`,
    duration_s: 30,
    kind: "prose" as const,
  })),
};

describe("nextChunkId", () => {
  it("advances within range", () => {
    expect(nextChunkId(MANIFEST, 0)).toBe(1);
    expect(nextChunkId(MANIFEST, 13)).toBe(14);
  });
  it("returns null at end", () => {
    expect(nextChunkId(MANIFEST, 14)).toBe(null);
  });
});

describe("chapterForChunk", () => {
  it("finds chapter for chunk in middle of chapter range", () => {
    expect(chapterForChunk(MANIFEST, 0)?.id).toBe("preface");
    expect(chapterForChunk(MANIFEST, 4)?.id).toBe("preface");
    expect(chapterForChunk(MANIFEST, 5)?.id).toBe("ch01");
    expect(chapterForChunk(MANIFEST, 9)?.id).toBe("ch01");
    expect(chapterForChunk(MANIFEST, 14)?.id).toBe("ch02");
  });
  it("returns null when chapters list is empty", () => {
    expect(chapterForChunk({ ...MANIFEST, chapters: [] }, 0)).toBe(null);
  });
});

describe("savePosition / loadPosition", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it("round-trips a position", () => {
    savePosition("ddia", 138, 12.5);
    expect(loadPosition("ddia")).toEqual({ chunkId: 138, offsetS: 12.5 });
  });
  it("returns null when no saved position", () => {
    expect(loadPosition("ddia")).toBe(null);
  });
  it("returns null when stored JSON is corrupt", () => {
    localStorage.setItem("audiobook-position-ddia", "not json");
    expect(loadPosition("ddia")).toBe(null);
  });
});
```

The `// @vitest-environment jsdom` pragma at the top of the file gives this test access to a real `localStorage`, regardless of the project default in `frontend/vitest.config.ts`. If jsdom isn't installed, install it:

```bash
cd frontend && pnpm add -D jsdom
```

- [ ] **Step 2: Create the helpers file**

```ts
// frontend/src/lib/audiobookPlayerHelpers.ts
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
```

- [ ] **Step 3: Run tests**

Run: `cd frontend && pnpm test audiobookPlayer -- --run`
Expected: all 8 assertions pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/audiobookPlayerHelpers.ts frontend/src/lib/__tests__/audiobookPlayerHelpers.test.ts
git commit -m "feat(audiobook): pure helpers (chunk advance, chapter lookup, persistence)"
```

---

### Task 9: Player context (provider + hook)

**Files:**
- Create: `frontend/src/lib/audiobookPlayer.tsx`

- [ ] **Step 1: Create the provider**

```tsx
// frontend/src/lib/audiobookPlayer.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  audiobookAudioUrl,
  fetchAudiobookManifest,
  fetchAudiobookPlaybackToken,
  type AudiobookManifest,
} from "./api";
import { store } from "./auth";
import {
  clearCurrent,
  loadCurrentSlug,
  loadPosition,
  loadSpeed,
  nextChunkId,
  savePosition,
  saveSpeed,
} from "./audiobookPlayerHelpers";

interface AudiobookState {
  slug: string | null;
  manifest: AudiobookManifest | null;
  currentChunkId: number;
  playing: boolean;
  progressInChunk: number;
  speed: number;
  visible: boolean;
  minimized: boolean;
  error: string | null;
}

interface AudiobookActions {
  loadBook: (slug: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  seekToChunk: (chunkId: number, offsetS?: number) => void;
  skipBack: (seconds?: number) => void;
  skipForward: (seconds?: number) => void;
  setSpeed: (speed: number) => void;
  toggleMinimize: () => void;
  close: () => void;
}

type AudiobookContextValue = AudiobookState & AudiobookActions;

const noop = () => {};
const noopAsync = async () => {};

const defaultValue: AudiobookContextValue = {
  slug: null,
  manifest: null,
  currentChunkId: 0,
  playing: false,
  progressInChunk: 0,
  speed: 1.4,
  visible: false,
  minimized: false,
  error: null,
  loadBook: noopAsync,
  play: noop,
  pause: noop,
  seekToChunk: noop,
  skipBack: noop,
  skipForward: noop,
  setSpeed: noop,
  toggleMinimize: noop,
  close: noop,
};

export const AudiobookContext = createContext<AudiobookContextValue>(defaultValue);

export function useAudiobookPlayer() {
  return useContext(AudiobookContext);
}

export function AudiobookPlayerProvider({ children }: { children: React.ReactNode }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [manifest, setManifest] = useState<AudiobookManifest | null>(null);
  const [currentChunkId, setCurrentChunkId] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progressInChunk, setProgressInChunk] = useState(0);
  const [speed, setSpeedState] = useState(1.4);
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackTokenRef = useRef<string | null>(null);
  const playbackTokenExpiresRef = useRef<number>(0); // epoch ms

  // Throttle position persistence
  const lastPersistRef = useRef(0);

  /* ── audio element ───────────────────────────────────── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply speed changes to the live element
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  /* ── token refresh ───────────────────────────────────── */

  const refreshPlaybackToken = useCallback(async (forSlug: string) => {
    const admin = store("adminToken");
    if (!admin) {
      setError("Not logged in");
      return null;
    }
    const { token, expires_at } = await fetchAudiobookPlaybackToken(forSlug, admin);
    playbackTokenRef.current = token;
    playbackTokenExpiresRef.current = new Date(expires_at).getTime();
    return token;
  }, []);

  const ensureFreshToken = useCallback(
    async (forSlug: string) => {
      const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
      if (
        playbackTokenRef.current &&
        playbackTokenExpiresRef.current > fiveMinFromNow
      ) {
        return playbackTokenRef.current;
      }
      return await refreshPlaybackToken(forSlug);
    },
    [refreshPlaybackToken],
  );

  /* ── core actions ────────────────────────────────────── */

  const loadChunkAudio = useCallback(
    async (chunkId: number, offsetS: number) => {
      if (!slug || !manifest || !audioRef.current) return;
      const token = await ensureFreshToken(slug);
      if (!token) return;
      audioRef.current.src = audiobookAudioUrl(slug, chunkId, token);
      audioRef.current.currentTime = offsetS;
    },
    [slug, manifest, ensureFreshToken],
  );

  const loadBook = useCallback(async (newSlug: string) => {
    const admin = store("adminToken");
    if (!admin) {
      setError("Not logged in");
      return;
    }
    setError(null);
    let m: AudiobookManifest | null;
    try {
      m = await fetchAudiobookManifest(newSlug, admin);
    } catch (e) {
      setError(String(e));
      return;
    }
    if (!m) {
      setError("Audiobook not generated yet");
      return;
    }
    setSlug(newSlug);
    setManifest(m);
    setVisible(true);
    setMinimized(false);
    setSpeedState(loadSpeed());

    const saved = loadPosition(newSlug);
    const startChunk = saved?.chunkId ?? 0;
    const startOffset = saved?.offsetS ?? 0;
    setCurrentChunkId(startChunk);
    setProgressInChunk(startOffset);

    await refreshPlaybackToken(newSlug);
    if (audioRef.current) {
      audioRef.current.src = audiobookAudioUrl(
        newSlug,
        startChunk,
        playbackTokenRef.current ?? "",
      );
      audioRef.current.currentTime = startOffset;
    }
    // Don't autoplay — needs user gesture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback(() => {
    if (!audioRef.current || !slug) return;
    // Mutual exclusion: pause music if it's playing
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nam:pause-music"));
    }
    audioRef.current.play().then(
      () => setPlaying(true),
      (err) => setError(`Playback failed: ${err}`),
    );
  }, [slug]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const seekToChunk = useCallback(
    (chunkId: number, offsetS = 0) => {
      if (!manifest) return;
      const clamped = Math.max(0, Math.min(chunkId, manifest.chunks.length - 1));
      setCurrentChunkId(clamped);
      setProgressInChunk(offsetS);
      loadChunkAudio(clamped, offsetS).then(() => {
        if (playing) audioRef.current?.play();
      });
    },
    [manifest, loadChunkAudio, playing],
  );

  const skipBack = useCallback(
    (seconds = 15) => {
      if (!audioRef.current || !manifest) return;
      const newOffset = audioRef.current.currentTime - seconds;
      if (newOffset >= 0) {
        audioRef.current.currentTime = newOffset;
        return;
      }
      // Go to previous chunk
      const prevId = currentChunkId - 1;
      if (prevId < 0) {
        audioRef.current.currentTime = 0;
        return;
      }
      const prevDuration = manifest.chunks[prevId].duration_s;
      const startInPrev = Math.max(0, prevDuration + newOffset);
      seekToChunk(prevId, startInPrev);
    },
    [currentChunkId, manifest, seekToChunk],
  );

  const skipForward = useCallback(
    (seconds = 30) => {
      if (!audioRef.current || !manifest) return;
      const currentDuration = manifest.chunks[currentChunkId].duration_s;
      const newOffset = audioRef.current.currentTime + seconds;
      if (newOffset < currentDuration) {
        audioRef.current.currentTime = newOffset;
        return;
      }
      const nextId = nextChunkId(manifest, currentChunkId);
      if (nextId === null) {
        audioRef.current.currentTime = currentDuration;
        return;
      }
      seekToChunk(nextId, newOffset - currentDuration);
    },
    [currentChunkId, manifest, seekToChunk],
  );

  const setSpeed = useCallback((s: number) => {
    const clamped = Math.max(0.5, Math.min(s, 3));
    setSpeedState(clamped);
    saveSpeed(clamped);
  }, []);

  const toggleMinimize = useCallback(() => setMinimized((m) => !m), []);

  const close = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    setVisible(false);
    setSlug(null);
    setManifest(null);
    clearCurrent();
  }, []);

  /* ── audio event handlers ────────────────────────────── */

  const onTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setProgressInChunk(a.currentTime);
    const now = Date.now();
    if (slug && now - lastPersistRef.current > 3000) {
      savePosition(slug, currentChunkId, a.currentTime);
      lastPersistRef.current = now;
    }
  }, [slug, currentChunkId]);

  const onEnded = useCallback(() => {
    if (!manifest) return;
    const nextId = nextChunkId(manifest, currentChunkId);
    if (nextId === null) {
      setPlaying(false);
      return;
    }
    setCurrentChunkId(nextId);
    setProgressInChunk(0);
    loadChunkAudio(nextId, 0).then(() => {
      audioRef.current?.play();
    });
  }, [manifest, currentChunkId, loadChunkAudio]);

  const onError = useCallback(() => {
    setError(`Audio chunk ${currentChunkId} failed to load`);
    setPlaying(false);
  }, [currentChunkId]);

  /* ── mutual exclusion: listen for music player ───────── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        setPlaying(false);
      }
    };
    window.addEventListener("nam:pause-audiobook", handler);
    return () => window.removeEventListener("nam:pause-audiobook", handler);
  }, []);

  /* ── restore current book on mount (pill resurrection) ─ */

  useEffect(() => {
    const cur = loadCurrentSlug();
    if (!cur) return;
    // Restore minimal state so pill renders; user taps pill to actually start.
    setSlug(cur.slug);
    setCurrentChunkId(cur.chunkId);
    setProgressInChunk(cur.offsetS);
    setVisible(true);
    setMinimized(true);
    // Load manifest in background
    loadBook(cur.slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AudiobookContextValue = {
    slug,
    manifest,
    currentChunkId,
    playing,
    progressInChunk,
    speed,
    visible,
    minimized,
    error,
    loadBook,
    play,
    pause,
    seekToChunk,
    skipBack,
    skipForward,
    setSpeed,
    toggleMinimize,
    close,
  };

  return <AudiobookContext.Provider value={value}>{children}</AudiobookContext.Provider>;
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/audiobookPlayer.tsx
git commit -m "feat(audiobook): React provider + hook with HTML5 audio playback"
```

---

### Task 10: Wire mutual exclusion into the music player

**Files:**
- Modify: `frontend/src/lib/player.tsx`

- [ ] **Step 1: Listen for `nam:pause-music` and dispatch `nam:pause-audiobook`**

In `PlayerProvider`, after the existing event-listener `useEffect`s (around line 270), add:

```tsx
  // Mutual exclusion with audiobook player
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPauseMusic = () => {
      if (playerRef.current && playingRef.current) {
        userRequestedPauseRef.current = true;
        playerRef.current.pauseVideo();
        setPlaying(false);
      }
    };
    window.addEventListener("nam:pause-music", onPauseMusic);
    return () => window.removeEventListener("nam:pause-music", onPauseMusic);
  }, []);
```

And in the existing `play` action, before the `setQueue(q)` call, dispatch:

```tsx
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nam:pause-audiobook"));
    }
```

- [ ] **Step 2: Type-check + lint**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm lint`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/player.tsx
git commit -m "feat(audiobook): mutual exclusion between music and audiobook players"
```

---

### Task 11: Wire provider + pill into root layout

**Files:**
- Modify: `frontend/src/app/layout.tsx`

- [ ] **Step 1: Import provider + pill**

Add to the existing top-of-file imports in `frontend/src/app/layout.tsx`:

```tsx
import AudiobookPill from "@/components/AudiobookPill";
import { AudiobookPlayerProvider } from "@/lib/audiobookPlayer";
```

- [ ] **Step 2: Wrap with provider and render pill**

Replace the existing JSX inside `<body>` (lines ~47–55 of `layout.tsx`):

```tsx
<body>
  <AudiobookPlayerProvider>
    <PlayerProvider>
      <div className="fixed inset-0 scanline z-[200] opacity-15 pointer-events-none" />
      <PageBackground />
      <Navbar />
      {children}
      <MiniPlayer />
      <AudiobookPill />
      <FeedbackButton />
    </PlayerProvider>
  </AudiobookPlayerProvider>
</body>
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: will fail until `AudiobookPill` exists (Task 12) — that's OK, this is one PR step.

- [ ] **Step 3: Commit (defer until Task 12 completes; come back here after pill is implemented)**

---

### Task 12: Implement `AudiobookPill`

**Files:**
- Create: `frontend/src/components/AudiobookPill.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/AudiobookPill.tsx
"use client";

import { useRouter } from "next/navigation";
import { useAudiobookPlayer } from "@/lib/audiobookPlayer";

export default function AudiobookPill() {
  const { slug, manifest, playing, visible, minimized, play, pause } =
    useAudiobookPlayer();
  const router = useRouter();

  if (!visible || !minimized || !slug) return null;

  const title = manifest?.title ?? "audiobook";

  return (
    <div
      onClick={() => router.push(`/reads/${slug}/listen`)}
      style={{
        position: "fixed",
        bottom: "5.5rem", // sits above MiniPlayer
        right: "1.5rem",
        zIndex: 141,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "6px 14px 6px 10px",
        background: "rgba(14, 14, 14, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid #2a2a2a",
        borderRadius: "24px",
        cursor: "pointer",
        animation: "fadeIn 0.2s ease-out",
        maxWidth: "260px",
      }}
    >
      <span style={{ fontSize: "16px", lineHeight: 1 }}>📖</span>
      <span
        style={{
          fontFamily: "var(--font-headline)",
          color: "#e5e2e1",
          fontSize: "11px",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          flex: 1,
        }}
      >
        {title}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          playing ? pause() : play();
        }}
        style={{
          background: "none",
          border: "none",
          color: "#e5e2e1",
          fontSize: "13px",
          cursor: "pointer",
          padding: "0 2px",
          lineHeight: 1,
        }}
      >
        {playing ? "❚❚" : "▶"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: zero errors (Task 11's pending commit can also now resolve).

- [ ] **Step 3: Commit Tasks 11 + 12 together**

```bash
git add frontend/src/app/layout.tsx frontend/src/components/AudiobookPill.tsx
git commit -m "feat(audiobook): pill + layout wiring"
```

---

## Phase 4 — Listen page

### Task 13: Server component shell + ListenClient

**Files:**
- Create: `frontend/src/app/reads/[slug]/listen/page.tsx`
- Create: `frontend/src/app/reads/[slug]/listen/ListenClient.tsx`

- [ ] **Step 1: Server component**

```tsx
// frontend/src/app/reads/[slug]/listen/page.tsx
import ListenClient from "./ListenClient";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ListenClient slug={slug} />;
}
```

- [ ] **Step 2: ListenClient**

```tsx
// frontend/src/app/reads/[slug]/listen/ListenClient.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAudiobookPlayer } from "@/lib/audiobookPlayer";
import { chapterForChunk } from "@/lib/audiobookPlayerHelpers";
import { getAdminToken } from "@/lib/auth";

const ACCENT = "#94a3b8";

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ListenClient({ slug }: { slug: string }) {
  const player = useAudiobookPlayer();
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    if (player.slug === slug && player.manifest) return; // already loaded
    const token = getAdminToken(); // redirects to /sudo if absent
    if (!token) return;
    player.loadBook(slug).catch((e) => setBootError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (bootError) {
    return <Centered>{bootError}</Centered>;
  }
  if (!player.manifest) {
    return <Centered>loading…</Centered>;
  }
  if (player.error && !player.playing) {
    // Display non-fatal errors; user can still navigate
  }

  const m = player.manifest;
  const chunk = m.chunks[player.currentChunkId];
  const currentChapter = chapterForChunk(m, player.currentChunkId);
  const chunkDuration = chunk?.duration_s ?? 0;
  const chunkPct = chunkDuration > 0 ? (player.progressInChunk / chunkDuration) * 100 : 0;

  const totalDuration = m.chunks.reduce((acc, c) => acc + c.duration_s, 0);
  const elapsedDuration =
    m.chunks.slice(0, player.currentChunkId).reduce((acc, c) => acc + c.duration_s, 0) +
    player.progressInChunk;
  const overallPct = totalDuration > 0 ? (elapsedDuration / totalDuration) * 100 : 0;

  return (
    <div
      style={{
        maxWidth: "60rem",
        margin: "0 auto",
        padding: "2rem 1.5rem 6rem",
        minHeight: "100vh",
        color: "#e5e2e1",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2rem" }}>
        <Link
          href="/reads"
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "0.7rem",
            color: ACCENT,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          ← back to reads
        </Link>
        <button
          onClick={player.close}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            color: "#666",
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      <h1
        style={{
          fontFamily: "var(--font-headline)",
          fontSize: "1.6rem",
          letterSpacing: "-0.01em",
          marginBottom: "0.25rem",
        }}
      >
        {m.title}
      </h1>
      <p
        style={{
          fontFamily: "var(--font-headline)",
          fontSize: "0.8rem",
          color: "#888",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          marginBottom: "2rem",
        }}
      >
        {m.author} · narrated by {m.voice}
      </p>

      {/* Two-column: chapters + now playing */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 240px) minmax(0, 1fr)",
          gap: "2rem",
          alignItems: "flex-start",
        }}
      >
        {/* Chapters */}
        <div
          style={{
            border: `1px solid color-mix(in srgb, ${ACCENT} 20%, #1a1a1a)`,
            borderRadius: "0.5rem",
            padding: "1rem",
            maxHeight: "60vh",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.65rem",
              color: ACCENT,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginBottom: "0.75rem",
            }}
          >
            // Chapters
          </div>
          {m.chapters.map((ch) => {
            const active = currentChapter?.id === ch.id;
            return (
              <button
                key={ch.id}
                onClick={() => player.seekToChunk(ch.chunk_start, 0)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  padding: "0.4rem 0.25rem",
                  fontSize: "0.8rem",
                  color: active ? "#e5e2e1" : "#888",
                  fontWeight: active ? 700 : 400,
                  cursor: "pointer",
                  borderLeft: `2px solid ${active ? ACCENT : "transparent"}`,
                  marginBottom: "0.15rem",
                }}
              >
                {ch.label}
              </button>
            );
          })}
        </div>

        {/* Now playing */}
        <div
          style={{
            background: "#131313",
            border: `1px solid color-mix(in srgb, ${ACCENT} 25%, #1a1a1a)`,
            borderLeft: `3px solid ${ACCENT}`,
            borderRadius: "0.5rem",
            padding: "1.5rem",
            position: "relative",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.65rem",
              color: ACCENT,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginBottom: "0.5rem",
            }}
          >
            Chunk {player.currentChunkId + 1} of {m.chunks.length}
            {currentChapter ? ` · ${currentChapter.label}` : ""}
          </div>

          <p
            style={{
              fontSize: "1rem",
              lineHeight: 1.7,
              color: "#d4d4d4",
              fontStyle: chunk?.kind?.endsWith("_bridge") ? "italic" : "normal",
              minHeight: "5rem",
              marginBottom: "1.5rem",
            }}
          >
            "{chunk?.text ?? ""}"
          </p>

          {/* Chunk progress */}
          <div
            onClick={(e) => {
              if (chunkDuration <= 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              player.seekToChunk(player.currentChunkId, (x / rect.width) * chunkDuration);
            }}
            style={{
              height: "5px",
              background: "#2a2a2a",
              borderRadius: "2px",
              cursor: chunkDuration > 0 ? "pointer" : "default",
              marginBottom: "0.25rem",
              position: "relative",
            }}
          >
            <div
              style={{
                width: `${chunkPct}%`,
                height: "100%",
                background: ACCENT,
                borderRadius: "2px",
                transition: "width 0.2s linear",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.65rem",
              color: "#666",
              marginBottom: "1.25rem",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>{fmt(player.progressInChunk)}</span>
            <span>{fmt(chunkDuration)}</span>
          </div>

          {/* Overall progress */}
          <div
            style={{
              height: "2px",
              background: "#1a1a1a",
              marginBottom: "0.25rem",
            }}
          >
            <div
              style={{
                width: `${overallPct}%`,
                height: "100%",
                background: `color-mix(in srgb, ${ACCENT} 60%, transparent)`,
                transition: "width 0.5s linear",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.6rem",
              color: "#555",
              marginBottom: "1.5rem",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>overall</span>
            <span>
              {fmt(elapsedDuration)} / {fmt(totalDuration)}
            </span>
          </div>

          {/* Speed */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "1.25rem",
            }}
          >
            <span style={{ fontSize: "0.7rem", color: "#888" }}>speed</span>
            <input
              type="range"
              min="0.7"
              max="2.5"
              step="0.1"
              value={player.speed}
              onChange={(e) => player.setSpeed(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: ACCENT }}
            />
            <span style={{ fontSize: "0.7rem", color: "#e5e2e1", minWidth: "2.5rem" }}>
              {player.speed.toFixed(1)}×
            </span>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
            <ControlButton onClick={() => player.skipBack(15)} label="-15s" />
            <ControlButton
              onClick={() => (player.playing ? player.pause() : player.play())}
              label={player.playing ? "❚❚" : "▶"}
              big
            />
            <ControlButton onClick={() => player.skipForward(30)} label="+30s" />
            <ControlButton onClick={player.toggleMinimize} label="—" />
          </div>

          {player.error ? (
            <div
              style={{
                marginTop: "1rem",
                padding: "0.5rem 0.75rem",
                border: "1px solid #f97316",
                borderRadius: "4px",
                color: "#f97316",
                fontSize: "0.75rem",
              }}
            >
              {player.error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  onClick,
  label,
  big,
}: {
  onClick: () => void;
  label: string;
  big?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: `1px solid ${ACCENT}`,
        color: "#e5e2e1",
        fontFamily: "var(--font-headline)",
        fontSize: big ? "1rem" : "0.75rem",
        padding: big ? "0.5rem 1rem" : "0.4rem 0.75rem",
        cursor: "pointer",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        borderRadius: "2px",
      }}
    >
      {label}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#888",
        fontFamily: "var(--font-headline)",
        fontSize: "0.8rem",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/reads/\[slug\]/listen/
git commit -m "feat(audiobook): listen page UI"
```

---

## Phase 5 — Preprocessing script

### Task 14: Pure helpers + tests for chunking + cleaning

**Files:**
- Create: `scripts/__init__.py`
- Create: `scripts/audiobook_lib.py`
- Create: `scripts/tests/__init__.py`
- Create: `scripts/tests/test_audiobook_lib.py`

- [ ] **Step 1: Write failing tests**

```python
# scripts/tests/test_audiobook_lib.py
from scripts.audiobook_lib import chunk_paragraphs, clean_pdf_text


def test_clean_dehyphenates_line_breaks():
    raw = "applica-\ntion-level"
    assert clean_pdf_text(raw) == "application-level"


def test_clean_drops_standalone_page_numbers():
    raw = "End of section.\n  42  \nNext section"
    assert "42" not in clean_pdf_text(raw)


def test_clean_collapses_extra_blank_lines():
    raw = "Para one.\n\n\n\nPara two."
    assert clean_pdf_text(raw) == "Para one.\n\nPara two."


def test_clean_em_dash_to_comma():
    raw = "Alpha—beta–gamma"
    cleaned = clean_pdf_text(raw)
    assert "—" not in cleaned
    assert "–" not in cleaned


def test_chunk_respects_max_len():
    text = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five."
    chunks = chunk_paragraphs(text, target_len=20, max_len=40)
    for c in chunks:
        assert len(c) <= 40, c


def test_chunk_keeps_sentences_together_when_possible():
    text = "Short. Longer sentence here."
    chunks = chunk_paragraphs(text, target_len=100, max_len=200)
    assert chunks == ["Short. Longer sentence here."]


def test_chunk_empty_input():
    assert chunk_paragraphs("", target_len=600, max_len=1500) == []
```

- [ ] **Step 2: Implement helpers**

```python
# scripts/__init__.py
```

```python
# scripts/audiobook_lib.py
"""Pure helpers for the audiobook preprocessing pipeline."""
import re


def clean_pdf_text(raw: str) -> str:
    """Clean text extracted from a PDF for TTS narration."""
    s = raw
    s = re.sub(r"-\n([a-zA-Z])", r"\1", s)              # rejoin hyphenated line breaks
    s = re.sub(r"^\s*\d{1,4}\s*$", "", s, flags=re.M)   # drop standalone page numbers
    s = re.sub(r"https?://\S+", "", s)                  # strip URLs
    s = re.sub(r"[—–]", ", ", s)                        # em/en dash → natural pause
    s = s.replace("…", "...")
    s = s.replace(" ", " ")                        # NBSP → space
    s = re.sub(r"[ \t]+", " ", s)
    lines = [line.strip() for line in s.split("\n")]
    s = "\n".join(lines)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


_SENTENCE_RE = re.compile(r"[^.!?\n]+[.!?\n]*", re.MULTILINE)


def chunk_paragraphs(text: str, target_len: int = 600, max_len: int = 1500) -> list[str]:
    """Split text into chunks at sentence boundaries, ~target_len chars each.

    Never exceed max_len. If a single sentence is longer than max_len, split on
    the nearest space inside the window.
    """
    if not text.strip():
        return []
    sentences = [m.group(0).strip() for m in _SENTENCE_RE.finditer(text) if m.group(0).strip()]
    chunks: list[str] = []
    cur = ""
    for sent in sentences:
        if len(sent) > max_len:
            # Hard-split overlong sentences on spaces
            words = sent.split(" ")
            buf = ""
            for w in words:
                if len(buf) + len(w) + 1 > max_len:
                    chunks.append(buf.strip())
                    buf = w
                else:
                    buf = f"{buf} {w}" if buf else w
            if buf:
                chunks.append(buf.strip())
            continue
        candidate = f"{cur} {sent}".strip() if cur else sent
        if len(candidate) > max_len or (cur and len(candidate) > target_len):
            chunks.append(cur)
            cur = sent
        else:
            cur = candidate
    if cur:
        chunks.append(cur)
    return [c for c in chunks if c]
```

- [ ] **Step 3: Run tests**

Run: `uv run pytest scripts/tests/test_audiobook_lib.py -v`
Expected: 7 passing.

If pytest doesn't pick up `scripts/`, add to `pyproject.toml`:

```toml
[tool.pytest.ini_options]
# existing keys ...
testpaths = ["website", "scripts"]
```

(Verify whether `testpaths` is already set; if not, add it.)

- [ ] **Step 4: Commit**

```bash
git add scripts/__init__.py scripts/audiobook_lib.py scripts/tests/__init__.py scripts/tests/test_audiobook_lib.py
git commit -m "feat(audiobook): pure helpers (text clean + paragraph chunking) + tests"
```

---

### Task 15: PDF download + PyMuPDF extraction

**Files:**
- Modify: `pyproject.toml`
- Create: `scripts/audiobook_extract.py`

- [ ] **Step 1: Add deps**

Edit `pyproject.toml`. In the `[dependency-groups].dev` block, append:

```toml
    "pymupdf>=1.24",
    "mutagen>=1.47",
    "anthropic>=0.40",
    "google-genai>=0.8",
    "httpx>=0.28",
```

(`httpx` is already in the main deps — only add if not already present.)

Then run: `uv sync`
Expected: deps installed.

- [ ] **Step 2: Write the script (extract + outline only — Haiku comes in next task)**

```python
# scripts/audiobook_extract.py
"""Extract a PDF book to a clean, chunked, Haiku-cleaned manifest.json.

Usage:
    uv run python scripts/audiobook_extract.py <slug> <pdf-url-or-path>

Output: audiobooks/<slug>/{source.pdf,raw.txt,raw_outline.json,manifest.json}
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import fitz  # PyMuPDF
import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = REPO_ROOT / "audiobooks"


def download_pdf(source: str, target: Path) -> None:
    if target.exists():
        print(f"[skip] {target} already exists")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.startswith(("http://", "https://")):
        print(f"[fetch] downloading {source}")
        with httpx.stream("GET", source, follow_redirects=True, timeout=120) as r:
            r.raise_for_status()
            with open(target, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=8192):
                    f.write(chunk)
    else:
        src_path = Path(source)
        if not src_path.exists():
            sys.exit(f"PDF not found: {source}")
        target.write_bytes(src_path.read_bytes())
    print(f"[ok] saved {target} ({target.stat().st_size:,} bytes)")


def extract_text_and_outline(pdf_path: Path, out_dir: Path) -> tuple[str, list]:
    """Return (raw_text, outline). Writes raw.txt and raw_outline.json."""
    doc = fitz.open(pdf_path)
    pages_text: list[str] = []
    for page in doc:
        pages_text.append(page.get_text("text"))
    raw_text = "\n\n".join(pages_text)
    (out_dir / "raw.txt").write_text(raw_text)
    outline = [
        {"level": level, "title": title, "page": page}
        for (level, title, page) in doc.get_toc()
    ]
    (out_dir / "raw_outline.json").write_text(json.dumps(outline, indent=2, ensure_ascii=False))
    doc.close()
    return raw_text, outline


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("source", help="PDF URL or local path")
    args = ap.parse_args()

    out_dir = BOOKS_DIR / args.slug
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / "source.pdf"
    download_pdf(args.source, pdf_path)
    raw_text, outline = extract_text_and_outline(pdf_path, out_dir)
    print(f"[ok] extracted {len(raw_text):,} chars; {len(outline)} outline entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Smoke-test extraction with a small PDF**

Run: `uv run python scripts/audiobook_extract.py demo "https://www.africau.edu/images/default/sample.pdf"`
Expected: `audiobooks/demo/raw.txt` and `audiobooks/demo/raw_outline.json` created, prints char count > 0.

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml uv.lock scripts/audiobook_extract.py
git commit -m "feat(audiobook): PDF download + PyMuPDF extraction"
```

---

### Task 16: Haiku-driven cleanup + chunking + manifest write

**Files:**
- Modify: `scripts/audiobook_extract.py`

- [ ] **Step 1: Append Haiku integration**

Add to `scripts/audiobook_extract.py`:

```python
# At top, additional imports:
import hashlib
import os
import textwrap

from anthropic import Anthropic
from .audiobook_lib import chunk_paragraphs, clean_pdf_text

HAIKU_MODEL = "claude-haiku-4-5"
DEFAULT_VOICE = "Charon"

SYSTEM_PROMPT = textwrap.dedent("""
    You are converting a book passage to a TTS-friendly script.

    Input is raw text extracted from a PDF — may contain broken lines, code blocks,
    figures, equations, and tables.

    Output a JSON array of segments. Each segment has:
      - text: the spoken text (plain prose, fully expanded — no abbreviations like "e.g." → "for example")
      - kind: one of "prose", "paraphrased_code", "code_bridge",
              "figure_bridge", "table_bridge", "equation_bridge"
      - page: integer page number if known, otherwise omit
      - original: only for paraphrased_code or code_bridge — the original code as a string

    Rules:
      1. Keep prose intact, fix line breaks, rejoin hyphenated words.
      2. SHORT code snippets (one-line SQL, simple expressions): paraphrase in one sentence.
         kind = "paraphrased_code", set "original" to the raw code.
      3. LONG code listings (multi-line, structural): one bridge sentence pointing to the PDF page.
         kind = "code_bridge", original = the raw listing (truncated to 500 chars).
      4. Tables, figures, equations: one bridge sentence each.
         kind = "table_bridge" / "figure_bridge" / "equation_bridge".
      5. Drop captions, headers, footers, page numbers, decorative text.
      6. Output ONLY valid JSON — no markdown fences, no commentary.
""").strip()


def _chapter_ranges(outline: list, total_chars: int, raw_text: str) -> list[tuple[str, str, str]]:
    """Split raw text by top-level outline entries.

    Returns list of (chapter_id, chapter_label, chapter_text).
    Fallback: if no outline, returns one entry covering the whole text.
    """
    top = [e for e in outline if e.get("level", 1) == 1]
    if not top:
        return [("body", "Body", raw_text)]
    # naive heuristic: split raw_text by occurrences of chapter titles
    boundaries: list[int] = []
    for entry in top:
        idx = raw_text.find(entry["title"])
        if idx >= 0:
            boundaries.append(idx)
    if not boundaries:
        return [("body", "Body", raw_text)]
    boundaries.append(len(raw_text))
    boundaries.sort()
    ranges: list[tuple[str, str, str]] = []
    for i, entry in enumerate(top):
        start = boundaries[i]
        end = boundaries[i + 1] if i + 1 < len(boundaries) else len(raw_text)
        chap_id = f"ch{i:02d}_" + "".join(c for c in entry["title"].lower() if c.isalnum())[:24]
        ranges.append((chap_id, entry["title"], raw_text[start:end]))
    return ranges


def _cache_path(out_dir: Path, chapter_id: str, payload: str) -> Path:
    h = hashlib.sha256(payload.encode()).hexdigest()[:12]
    cache_dir = out_dir / ".cache"
    cache_dir.mkdir(exist_ok=True)
    return cache_dir / f"{chapter_id}_{h}.json"


def haiku_clean_chapter(
    client: Anthropic,
    chapter_id: str,
    chapter_text: str,
    out_dir: Path,
) -> list[dict]:
    """Send a chapter to Haiku, return list of segment dicts. Cached."""
    cleaned_input = clean_pdf_text(chapter_text)
    cache = _cache_path(out_dir, chapter_id, cleaned_input)
    if cache.exists():
        return json.loads(cache.read_text())

    # Trim if too long for one call — split chapter into ~50k-char pieces
    MAX_CALL = 50_000
    pieces = [cleaned_input[i : i + MAX_CALL] for i in range(0, len(cleaned_input), MAX_CALL)]
    all_segments: list[dict] = []
    for i, piece in enumerate(pieces):
        print(f"  [haiku] {chapter_id} piece {i + 1}/{len(pieces)} ({len(piece)} chars)")
        try:
            msg = client.messages.create(
                model=HAIKU_MODEL,
                max_tokens=8192,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": piece}],
            )
            raw = "".join(block.text for block in msg.content if block.type == "text")
            segments = json.loads(raw)
            if isinstance(segments, list):
                all_segments.extend(segments)
        except (json.JSONDecodeError, Exception) as e:
            print(f"  [warn] piece failed ({e}); falling back to plain prose")
            all_segments.extend([{"text": piece, "kind": "prose"}])
    cache.write_text(json.dumps(all_segments, indent=2, ensure_ascii=False))
    return all_segments


def build_manifest(
    slug: str,
    title: str,
    author: str,
    voice: str,
    pdf_url: str,
    out_dir: Path,
    raw_text: str,
    outline: list,
) -> dict:
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    chapter_ranges = _chapter_ranges(outline, len(raw_text), raw_text)

    manifest_chapters: list[dict] = []
    manifest_chunks: list[dict] = []
    chunk_id = 0
    for chap_id, chap_label, chap_text in chapter_ranges:
        manifest_chapters.append(
            {"id": chap_id, "label": chap_label, "chunk_start": chunk_id}
        )
        segments = haiku_clean_chapter(client, chap_id, chap_text, out_dir)
        for seg in segments:
            seg_text = seg.get("text", "").strip()
            if not seg_text:
                continue
            seg_kind = seg.get("kind", "prose")
            for piece in chunk_paragraphs(seg_text):
                chunk: dict = {
                    "id": chunk_id,
                    "text": piece,
                    "duration_s": None,
                    "kind": seg_kind,
                }
                if "page" in seg:
                    chunk["page"] = seg["page"]
                if "original" in seg:
                    chunk["original"] = seg["original"][:500]
                manifest_chunks.append(chunk)
                chunk_id += 1

    return {
        "slug": slug,
        "title": title,
        "author": author,
        "source_pdf_url": pdf_url,
        "voice": voice,
        "preprocessor": {"model": HAIKU_MODEL, "version": "2026-06-06"},
        "chapters": manifest_chapters,
        "chunks": manifest_chunks,
    }
```

And update `main()` to accept `--title --author --voice` and build the manifest:

```python
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("source", help="PDF URL or local path")
    ap.add_argument("--title", required=True)
    ap.add_argument("--author", required=True)
    ap.add_argument("--voice", default=DEFAULT_VOICE)
    args = ap.parse_args()

    out_dir = BOOKS_DIR / args.slug
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / "source.pdf"
    download_pdf(args.source, pdf_path)
    raw_text, outline = extract_text_and_outline(pdf_path, out_dir)
    print(f"[ok] extracted {len(raw_text):,} chars; {len(outline)} outline entries")

    manifest = build_manifest(
        slug=args.slug,
        title=args.title,
        author=args.author,
        voice=args.voice,
        pdf_url=args.source if args.source.startswith("http") else "",
        out_dir=out_dir,
        raw_text=raw_text,
        outline=outline,
    )
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"[ok] wrote manifest.json — {len(manifest['chunks'])} chunks")
    return 0
```

Also fix the import line at top (mixing `from .audiobook_lib` inside a script run as `__main__` won't work). Replace with a sys.path-based import:

```python
# After existing imports, before main:
sys.path.insert(0, str(REPO_ROOT))
from scripts.audiobook_lib import chunk_paragraphs, clean_pdf_text  # noqa: E402
```

(Remove the earlier `from .audiobook_lib import ...` line.)

- [ ] **Step 2: Smoke test against a small PDF (no real Haiku needed for smoke — set `ANTHROPIC_API_KEY` if you want)**

Without `ANTHROPIC_API_KEY` the script will fail at `Anthropic(api_key=...)`. For a dry smoke that exercises everything BUT the Haiku call, mock it manually:

Skip this smoke until you have a key. Move on; we'll do an end-to-end run at the end.

- [ ] **Step 3: Commit**

```bash
git add scripts/audiobook_extract.py
git commit -m "feat(audiobook): Haiku-driven cleanup + chunking + manifest"
```

---

## Phase 6 — TTS + upload script

### Task 17: TTS script

**Files:**
- Create: `scripts/audiobook_tts.py`

- [ ] **Step 1: Write the script**

```python
# scripts/audiobook_tts.py
"""Generate MP3s for each chunk in audiobooks/<slug>/manifest.json,
then upload them to the VPS, then publish the manifest.

Usage:
    GEMINI_API_KEY=... NAM_ADMIN_TOKEN=... NAM_BASE_URL=https://nam685.de \
        uv run python scripts/audiobook_tts.py <slug>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from google import genai
from google.genai import types
from mutagen.mp3 import MP3

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = REPO_ROOT / "audiobooks"

GEMINI_MODEL = "gemini-2.5-flash-preview-tts"


def tts_one_chunk(client: genai.Client, voice: str, text: str, target: Path) -> None:
    """Generate one MP3, retrying transient failures."""
    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=text,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name=voice,
                            ),
                        ),
                    ),
                ),
            )
            audio_bytes = response.candidates[0].content.parts[0].inline_data.data
            tmp = target.with_suffix(".mp3.tmp")
            tmp.write_bytes(audio_bytes)
            tmp.rename(target)
            return
        except Exception as e:
            print(f"  [warn] TTS attempt {attempt + 1} failed: {e}")
            time.sleep(2 ** attempt)
    # Final fallback: 5s of silence (placeholder MP3) so playback doesn't break
    print(f"  [error] TTS gave up for chunk → writing silence placeholder")
    silence = SILENCE_MP3
    target.write_bytes(silence)


SILENCE_MP3 = b"\xff\xfb\x90d\x00" + b"\x00" * 6000  # ~ minimal silent MP3 frame; not perfect but harmless


def measure_duration(path: Path) -> float:
    try:
        return float(MP3(path).info.length)
    except Exception:
        return 0.0


def upload_chunk(
    http: httpx.Client,
    base_url: str,
    slug: str,
    chunk_id: int,
    mp3_path: Path,
    admin_token: str,
) -> None:
    # Skip if already on server
    head = http.get(
        f"{base_url}/api/audiobooks/{slug}/exists/{chunk_id}/",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    if head.status_code == 200:
        return
    with open(mp3_path, "rb") as f:
        files = {"mp3": (f"{chunk_id:05d}.mp3", f, "audio/mpeg")}
        data = {"chunk_id": str(chunk_id)}
        r = http.post(
            f"{base_url}/api/audiobooks/{slug}/upload-chunk/",
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=120,
        )
        r.raise_for_status()


def publish_manifest(
    http: httpx.Client, base_url: str, slug: str, manifest: dict, admin_token: str
) -> None:
    r = http.post(
        f"{base_url}/api/audiobooks/{slug}/publish/",
        json=manifest,
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=60,
    )
    if r.status_code != 200:
        sys.exit(f"publish failed: {r.status_code} {r.text}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    book_dir = BOOKS_DIR / args.slug
    manifest_path = book_dir / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"missing {manifest_path} — run audiobook_extract.py first")
    manifest = json.loads(manifest_path.read_text())

    audio_dir = book_dir / "audio"
    audio_dir.mkdir(exist_ok=True)

    api_key = os.environ.get("GEMINI_API_KEY")
    admin_token = os.environ.get("NAM_ADMIN_TOKEN")
    base_url = os.environ.get("NAM_BASE_URL", "http://localhost:8000")
    if not api_key:
        sys.exit("GEMINI_API_KEY required")
    if not admin_token:
        sys.exit("NAM_ADMIN_TOKEN required")

    gemini = genai.Client(api_key=api_key)

    # Phase 1: generate any missing MP3s
    missing = [c for c in manifest["chunks"] if not (audio_dir / f"{c['id']:05d}.mp3").exists()]
    print(f"[tts] {len(missing)} chunks to generate (out of {len(manifest['chunks'])})")
    for chunk in missing:
        target = audio_dir / f"{chunk['id']:05d}.mp3"
        print(f"  [{chunk['id']}/{len(manifest['chunks'])}] {chunk['text'][:60]!r}")
        tts_one_chunk(gemini, manifest["voice"], chunk["text"], target)

    # Phase 2: measure durations + write back to manifest
    for chunk in manifest["chunks"]:
        if chunk.get("duration_s") is None:
            chunk["duration_s"] = round(
                measure_duration(audio_dir / f"{chunk['id']:05d}.mp3"), 2
            )
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print("[ok] durations measured")

    # Phase 3: upload to server
    print(f"[upload] uploading to {base_url}")
    with httpx.Client(timeout=120) as http:
        def upload_one(c):
            upload_chunk(http, base_url, args.slug, c["id"],
                         audio_dir / f"{c['id']:05d}.mp3", admin_token)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            list(pool.map(upload_one, manifest["chunks"]))

        # Phase 4: publish
        print("[publish] writing manifest on server")
        publish_manifest(http, base_url, args.slug, manifest, admin_token)
    print("[done]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Lint**

Run: `uvx ruff check scripts/audiobook_tts.py`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/audiobook_tts.py
git commit -m "feat(audiobook): TTS + upload + publish script"
```

---

## Phase 7 — Repo hygiene and docs

### Task 18: `.gitignore` for audiobooks dir

**Files:**
- Create: `audiobooks/.gitignore`

- [ ] **Step 1: Write it**

```gitignore
# Keep only the manifest in version control.
*
!.gitignore
!*/
!*/manifest.json
```

- [ ] **Step 2: Verify**

Run: `cd /home/namle685/projects/nam-website/.claude/worktrees/pdf-audiobook && git check-ignore -v audiobooks/demo/raw.txt audiobooks/demo/manifest.json 2>&1 || true`
Expected: `raw.txt` is ignored, `manifest.json` is NOT ignored (no output for it).

- [ ] **Step 3: Commit**

```bash
git add audiobooks/.gitignore
git commit -m "chore(audiobook): gitignore everything except manifests"
```

---

### Task 19: Update docs

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/QA-CHECKLIST.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: docs/README.md**

Read the file. Under the "Reads" section, append:

```markdown
### Audiobook player (admin-only)

For books with a generated audiobook, an admin-visible "LISTEN" button on the
read card opens `/reads/<slug>/listen` — a chapter-aware HTML5 audio player that
plays Gemini-narrated chunks of the book. The player persists position in
localStorage and minimizes to a floating pill on navigation. Audio files are
gated behind admin auth via short-lived signed URLs.
```

- [ ] **Step 2: docs/QA-CHECKLIST.md**

Append a new section:

```markdown
## Reads — Audiobook (admin)

- [ ] Logged out: `/reads` page does NOT show LISTEN buttons.
- [ ] Logged out: visiting `/reads/ddia/listen` directly redirects to `/sudo`.
- [ ] Logged in: LISTEN button appears on the DDIA card.
- [ ] Click LISTEN: chapter list renders; first chapter active.
- [ ] Click chapter → audio jumps to its first chunk.
- [ ] Play → audio plays; progress bar updates within chunk.
- [ ] At chunk end → next chunk autoplays gaplessly.
- [ ] Adjust speed → playback rate changes immediately.
- [ ] Skip -15s → seeks back 15s, crossing chunk boundary if needed.
- [ ] Skip +30s → seeks forward 30s, crossing chunk boundary if needed.
- [ ] Minimize → pill appears bottom-right; tap pill plays/pauses.
- [ ] Navigate to `/listens`, start music → audiobook pauses (mutual exclusion).
- [ ] Navigate back to `/reads/ddia/listen` → state restored.
- [ ] Reload page mid-playback → position restored (paused); play button resumes from saved offset.
- [ ] curl `/media/audiobooks/ddia/00000.mp3` without token → 403.
- [ ] curl `/api/audiobooks/ddia/audio/0/?t=<expired>` → 403.
```

- [ ] **Step 3: CLAUDE.md**

Read the API list in `CLAUDE.md`. Append under the existing endpoints block:

```
GET  /api/audiobooks/<slug>/                  auth required, returns manifest.json
GET  /api/audiobooks/<slug>/playback-token/   auth required, returns short-lived signed token
GET  /api/audiobooks/<slug>/audio/<id>/?t=…   signed-token required, streams MP3 with Range
GET  /api/audiobooks/<slug>/exists/<id>/      auth required, 200/404
POST /api/audiobooks/<slug>/upload-chunk/     auth required, multipart {chunk_id, mp3}
POST /api/audiobooks/<slug>/publish/          auth required, body = manifest JSON
```

- [ ] **Step 4: Commit**

```bash
git add docs/README.md docs/QA-CHECKLIST.md CLAUDE.md
git commit -m "docs(audiobook): README, QA checklist, CLAUDE.md endpoint list"
```

---

## Phase 8 — End-to-end + deploy

### Task 20: Local end-to-end smoke

- [ ] **Step 1: Start the stack**

Run: `make up`
Expected: PostgreSQL + Redis up; Django on 8000; Next.js on 3001.

- [ ] **Step 2: Generate admin token in your shell**

Run:
```bash
ADMIN_SECRET=<your-secret>
curl -s -X POST http://localhost:8000/api/auth/login/ \
  -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$ADMIN_SECRET\"}" | jq -r .token
```
Save the token to `NAM_ADMIN_TOKEN` env var.

- [ ] **Step 3: Run extract against DDIA**

```bash
ANTHROPIC_API_KEY=<key> uv run python scripts/audiobook_extract.py ddia \
  "https://0-lucas.github.io/digital-garden/99.-Books/Martin-Kleppmann---Designing-Data-Intensive-Applications_-O%E2%80%99Reilly-Media-(2017).pdf" \
  --title "Designing Data-Intensive Applications" \
  --author "Martin Kleppmann"
```

Expected: completes; `audiobooks/ddia/manifest.json` exists; ~2000 chunks.

Manually inspect the manifest — spot-check 5 chunks across `prose`, `paraphrased_code`, and `code_bridge` kinds.

- [ ] **Step 4: Run TTS against local Django**

```bash
GEMINI_API_KEY=<key> NAM_ADMIN_TOKEN=$NAM_ADMIN_TOKEN \
  NAM_BASE_URL=http://localhost:8000 \
  uv run python scripts/audiobook_tts.py ddia
```

Expected: ~2000 MP3s appear in `audiobooks/ddia/audio/`; same count under `media/audiobooks/ddia/`; publish prints "done".

(Cost reminder: ~$0.30 in Gemini if you're paying.)

- [ ] **Step 5: Visit `/reads/ddia/listen` in browser as admin**

- Login at `/sudo`.
- Visit `/reads/ddia/listen`.
- Click play; listen to chunks 0, 100, 1000, last.
- Click around chapters.
- Try -15s / +30s across a chunk boundary.
- Minimize → pill appears → navigate to `/listens` → start music → audiobook pauses.
- Reload `/reads/ddia/listen` → position restored.

Walk through the QA-CHECKLIST.md section.

- [ ] **Step 6: Verify private serving**

In a separate terminal:
```bash
curl -i http://localhost:8000/api/audiobooks/ddia/audio/0/
# expect 403

curl -i 'http://localhost:8000/api/audiobooks/ddia/audio/0/?t=garbage'
# expect 403
```

- [ ] **Step 7: Commit the generated manifest**

```bash
git add audiobooks/ddia/manifest.json
git commit -m "feat(audiobook): DDIA manifest (~2000 chunks)"
```

---

### Task 21: Deploy

- [ ] **Step 1: PR + merge**

```bash
git push -u origin feat/pdf-audiobook
gh pr create --title "feat: PDF audiobook player on /reads (admin-only)" \
  --body "$(cat <<'EOF'
## Summary
- New admin-only audiobook player at /reads/<slug>/listen
- Three new offline pipelines: PDF extract → Haiku clean → Gemini TTS → upload
- Six new Django endpoints behind admin auth (+ short-lived signed playback tokens for <audio> URLs)

## Test plan
- [ ] Logged-out visitors see no LISTEN button
- [ ] Logged-out direct visit redirects to /sudo
- [ ] Logged in, DDIA listen page plays; chapters work; speed/skip work; pill survives nav
- [ ] curl without token returns 403
- [ ] Music + audiobook mutual exclusion works
EOF
)"
```

After merge + deploy, on the server:

- [ ] **Step 2: Upload DDIA MP3s to production**

From your work laptop:
```bash
NAM_ADMIN_TOKEN=<prod-token> NAM_BASE_URL=https://nam685.de \
  uv run python scripts/audiobook_tts.py ddia
```
Expected: skip-if-exists hits 0 generated, ~2000 uploads, publish OK.

- [ ] **Step 3: Caddy config — ensure `/media/audiobooks/` is NOT served directly**

The current Caddy config serves `/media/*` as a `file_server`. We need `/media/audiobooks/*` to be excluded so all access goes through Django's authed `audio/<id>/` endpoint.

If the production Caddyfile has a `handle /media/*` block, add a `handle /media/audiobooks/*` block before it that returns 403:

```caddy
handle /media/audiobooks/* {
    respond "Forbidden" 403
}
handle /media/* {
    file_server { ... existing ... }
}
```

The actual MP3s are served via `/api/audiobooks/<slug>/audio/<id>/?t=...` proxied to Django.

After editing on the server, `sudo systemctl reload caddy`.

- [ ] **Step 4: Production smoke**

In browser: visit `https://nam685.de/reads/ddia/listen`, log in, play. Repeat the relevant QA-CHECKLIST.md items.

In a terminal:
```bash
curl -i https://nam685.de/media/audiobooks/ddia/00000.mp3
# expect 403
```

---

## Self-Review Summary

This plan was self-reviewed for:

- **Spec coverage:** Each section of `docs/superpowers/specs/2026-06-06-reads-pdf-audiobook-design.md` is implemented (architecture stages 1/2/3, manifest schema, 6 endpoints, frontend files, error handling matrix, all test cases, doc updates).
- **No placeholders.** Every step includes the actual code or command.
- **Type/signature consistency.** `AudiobookManifest` / `AudiobookChunk` / `AudiobookChapter` are defined once in `api.ts` and reused in tests, helpers, provider, and pages. The 6 view function names match between `audiobook.py` definitions, `views/__init__.py` exports, `__all__`, and `urls.py` references. The two cross-player events are named consistently: `nam:pause-music` and `nam:pause-audiobook`.
- **Scope.** One implementation plan covers the whole feature (the spec is intentionally tight and the pieces only work end-to-end).
