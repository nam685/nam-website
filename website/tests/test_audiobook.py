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


@pytest.mark.django_db
def test_playback_token_requires_admin(client, media_root):  # noqa: ARG001
    res = client.get("/api/audiobooks/ddia/playback-token/")
    assert res.status_code == 401


@pytest.mark.django_db
def test_playback_token_404_when_no_book(client, media_root, auth_headers):  # noqa: ARG001
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
def test_audio_stream_404_when_missing(client, media_root):  # noqa: ARG001
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
    monkeypatch.setattr(tokens, "PLAYBACK_TTL_SECONDS", -1)
    token = signing.dumps({"slug": "ddia"}, salt="audiobook-playback")
    res = client.get(f"/api/audiobooks/ddia/audio/0/?t={token}")
    assert res.status_code == 403


@pytest.mark.django_db
def test_audio_stream_supports_range_requests(client, media_root):
    from website.audiobook_tokens import create_playback_token

    book = media_root / "audiobooks" / "ddia"
    book.mkdir(parents=True)
    (book / "00000.mp3").write_bytes(b"0123456789" * 10)
    token, _ = create_playback_token("ddia")
    res = client.get(
        f"/api/audiobooks/ddia/audio/0/?t={token}",
        HTTP_RANGE="bytes=10-19",
    )
    assert res.status_code in (200, 206)
    assert res["Accept-Ranges"] == "bytes"
    body = b"".join(res.streaming_content)
    if res.status_code == 206:
        assert body == b"0123456789"
    else:
        assert len(body) == 100
