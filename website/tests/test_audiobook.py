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
