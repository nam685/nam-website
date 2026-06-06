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
def test_manifest_get_404(client, media_root, auth_headers):  # noqa: ARG001
    res = client.get("/api/audiobooks/no-such-book/", **auth_headers)
    assert res.status_code == 404


@pytest.mark.django_db
def test_manifest_get_returns_json(client, media_root, auth_headers):
    manifest = _write_minimal_manifest(media_root, "ddia")
    res = client.get("/api/audiobooks/ddia/", **auth_headers)
    assert res.status_code == 200
    assert res.json() == manifest


@pytest.mark.django_db
def test_chunk_exists_returns_404_when_missing(client, media_root, auth_headers):  # noqa: ARG001
    res = client.get("/api/audiobooks/ddia/exists/0/", **auth_headers)
    assert res.status_code == 404


@pytest.mark.django_db
def test_chunk_exists_returns_200_when_present(client, media_root, auth_headers):
    book = media_root / "audiobooks" / "ddia"
    book.mkdir(parents=True)
    (book / "00000.mp3").write_bytes(b"\xff\xfb" + b"0" * 100)
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
def test_upload_chunk_rejects_bad_chunk_id(client, media_root, auth_headers):  # noqa: ARG001
    from django.core.files.uploadedfile import SimpleUploadedFile

    res = client.post(
        "/api/audiobooks/ddia/upload-chunk/",
        {"chunk_id": "abc", "mp3": SimpleUploadedFile("x.mp3", b"x", content_type="audio/mpeg")},
        **auth_headers,
    )
    assert res.status_code == 400


@pytest.mark.django_db
def test_upload_chunk_rejects_huge_file(client, media_root, auth_headers, settings):  # noqa: ARG001
    from django.core.files.uploadedfile import SimpleUploadedFile

    big = b"x" * (51 * 1024 * 1024)
    settings.DATA_UPLOAD_MAX_MEMORY_SIZE = 100 * 1024 * 1024
    settings.FILE_UPLOAD_MAX_MEMORY_SIZE = 100 * 1024 * 1024
    res = client.post(
        "/api/audiobooks/ddia/upload-chunk/",
        {"chunk_id": "1", "mp3": SimpleUploadedFile("x.mp3", big, content_type="audio/mpeg")},
        **auth_headers,
    )
    assert res.status_code == 413


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
def test_publish_rejects_slug_mismatch(client, media_root, auth_headers):  # noqa: ARG001
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
def test_publish_rejects_non_contiguous_chunks(client, media_root, auth_headers):  # noqa: ARG001
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
def test_publish_rejects_when_audio_missing(client, media_root, auth_headers):  # noqa: ARG001
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
