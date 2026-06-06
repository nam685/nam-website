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
    return JsonResponse(json.loads(path.read_text(encoding="utf-8")))


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
    response = FileResponse(path.open("rb"), content_type="audio/mpeg")
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
    try:
        with open(tmp, "wb") as out:
            for chunk in f.chunks():
                out.write(chunk)
        os.replace(tmp, target)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise
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
    for chunk in manifest["chunks"]:
        if not _audio_path(slug, chunk["id"]).exists():
            return JsonResponse({"error": f"missing audio for chunk {chunk['id']}"}, status=400)
    book_dir = _book_dir(slug)
    book_dir.mkdir(parents=True, exist_ok=True)
    target = _manifest_path(slug)
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, target)
    return JsonResponse({"ok": True})


REQUIRED_TOP_KEYS = {"slug", "title", "author", "voice", "chapters", "chunks"}
REQUIRED_CHUNK_KEYS = {"id", "text", "duration_s", "kind"}
REQUIRED_CHAPTER_KEYS = {"id", "label", "chunk_start"}


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
    chapters = manifest["chapters"]
    if not isinstance(chapters, list):
        return "chapters must be a list"
    for i, chapter in enumerate(chapters):
        if not isinstance(chapter, dict):
            return f"chapter {i} is not an object"
        cm = REQUIRED_CHAPTER_KEYS - set(chapter.keys())
        if cm:
            return f"chapter {i} missing keys: {sorted(cm)}"
        cs = chapter["chunk_start"]
        if not isinstance(cs, int) or cs < 0 or cs >= len(chunks):
            return f"chapter {i} has invalid chunk_start {cs!r}"
    return None
