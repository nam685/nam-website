import json
from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from website.models import BadmintonPlayer, BadmintonSubmission

MP4_HEAD = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 12  # 24 bytes, looks like an mp4


@pytest.fixture()
def media_root(tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)
    return tmp_path


def _submit(client, **overrides):
    body = {"name": "Nam", "filename": "clip.mp4", "size": len(MP4_HEAD), "recorded_on": "2026-09-17"}
    body.update(overrides)
    return client.post("/api/badminton/submit/", json.dumps(body), content_type="application/json")


def _upload(client, data=MP4_HEAD, **overrides):
    res = _submit(client, size=len(data), **overrides)
    assert res.status_code == 201, res.json()
    sub_id, token = res.json()["id"], res.json()["upload_token"]
    # The browser sends the token as a form field (no custom header → no CORS preflight).
    half = len(data) // 2
    for offset, part in ((0, data[:half]), (half, data[half:])):
        r = client.post(
            f"/api/badminton/submit/{sub_id}/chunk/",
            {"upload_token": token, "offset": offset, "chunk": SimpleUploadedFile("c", part)},
        )
        assert r.status_code == 200, r.json()
    r = client.post(f"/api/badminton/submit/{sub_id}/complete/", {"upload_token": token})
    assert r.status_code == 200, r.json()
    return sub_id, token


def _report(asset="assets/s1/attempt-01/annotated.mp4"):
    return {
        "id": "2026-09-17-x",
        "recorded_at": "2026-09-17T18:57:10+02:00",
        "verdict": {"strengths": ["good"], "findings": [{"title": "t"}]},
        "attempts": [{"number": 1, "annotated_clip": asset, "measurements": []}],
    }


@pytest.mark.django_db
def test_full_flow(client, media_root, auth_headers):
    sub_id, _ = _upload(client, height_m="171", hand="right")
    sub = BadmintonSubmission.objects.get(id=sub_id)
    assert sub.status == "pending"
    assert sub.height_m == 1.71  # cm normalised to m
    assert sub.player.slug == "nam"
    raw = media_root / "badminton" / "raw" / sub.upload_key / "video.mp4"
    assert raw.read_bytes() == MP4_HEAD

    # Not public until done.
    assert client.get("/api/badminton/players/").json()["players"] == []
    assert client.get(f"/api/badminton/submissions/{sub_id}/").status_code == 404

    # Worker idle before approval.
    assert client.post("/api/badminton/worker/claim/", **auth_headers).status_code == 204
    assert client.post(f"/api/badminton/submissions/{sub_id}/approve/", **auth_headers).status_code == 200
    assert client.get(f"/api/badminton/submissions/{sub_id}/status/").json()["queue_position"] == 1

    job = client.post("/api/badminton/worker/claim/", **auth_headers).json()
    assert job["player"] == "nam" and job["height_m"] == 1.71 and job["hand"] == "right"
    assert job["video_url"].endswith(f"/badminton/raw/{sub.upload_key}/video.mp4")

    r = client.post(
        f"/api/badminton/worker/{sub_id}/progress/",
        json.dumps({"step": "analyzing", "stage": "measure_racket"}),
        content_type="application/json",
        **auth_headers,
    )
    assert r.status_code == 200
    assert client.get(f"/api/badminton/submissions/{sub_id}/status/").json()["stage"] == "measure_racket"

    finish = {"submission": _report(), "handedness": "right", "height_m": 1.71}
    r = client.post(
        f"/api/badminton/worker/{sub_id}/finish/", json.dumps(finish), content_type="application/json", **auth_headers
    )
    assert r.status_code == 400 and r.json()["missing"] == ["assets/s1/attempt-01/annotated.mp4"]

    r = client.post(
        f"/api/badminton/worker/{sub_id}/asset/",
        {"path": "assets/s1/attempt-01/annotated.mp4", "file": SimpleUploadedFile("a.mp4", b"vid")},
        **auth_headers,
    )
    assert r.status_code == 200
    r = client.post(
        f"/api/badminton/worker/{sub_id}/finish/", json.dumps(finish), content_type="application/json", **auth_headers
    )
    assert r.status_code == 200
    assert not raw.exists()

    players = client.get("/api/badminton/players/").json()["players"]
    assert players[0]["slug"] == "nam"
    assert players[0]["submissions"][0] == {
        "id": sub_id,
        "recorded_on": "2026-09-17",
        "recorded_at": "2026-09-17T18:57:10+02:00",
        "attempts": 1,
        "findings": 1,
    }
    detail = client.get(f"/api/badminton/submissions/{sub_id}/").json()
    clip = detail["report"]["attempts"][0]["annotated_clip"]
    assert clip == f"/media/badminton/reports/{sub_id}/assets/s1/attempt-01/annotated.mp4"
    assert (media_root / clip.removeprefix("/media/")).read_bytes() == b"vid"

    # Delete removes the report files and the now-empty player.
    assert client.post(f"/api/badminton/submissions/{sub_id}/delete/", **auth_headers).status_code == 200
    assert not (media_root / "badminton" / "reports" / str(sub_id)).exists()
    assert not BadmintonPlayer.objects.exists()


@pytest.mark.django_db
def test_admin_endpoints_require_auth(client, media_root):  # noqa: ARG001
    sub_id, _ = _upload(client)
    assert client.get("/api/badminton/queue/").status_code == 401
    assert client.post(f"/api/badminton/submissions/{sub_id}/approve/").status_code == 401
    assert client.post(f"/api/badminton/submissions/{sub_id}/delete/").status_code == 401
    assert client.post("/api/badminton/worker/claim/").status_code == 401
    assert client.post(f"/api/badminton/worker/{sub_id}/finish/").status_code == 401


@pytest.mark.django_db
def test_queue_exposes_raw_url_to_admin(client, media_root, auth_headers):  # noqa: ARG001
    sub_id, _ = _upload(client)
    data = client.get("/api/badminton/queue/", **auth_headers).json()
    row = data["submissions"][0]
    assert row["id"] == sub_id and row["status"] == "pending"
    assert "/badminton/raw/" in row["video_url"]
    # Public status never leaks the raw URL.
    assert "video_url" not in client.get(f"/api/badminton/submissions/{sub_id}/status/").json()


@pytest.mark.django_db
def test_chunk_needs_matching_token(client, media_root):  # noqa: ARG001
    a = _submit(client).json()
    b = _submit(client, name="Friend").json()
    r = client.post(
        f"/api/badminton/submit/{a['id']}/chunk/",
        {"offset": 0, "chunk": SimpleUploadedFile("c", MP4_HEAD)},
        HTTP_X_UPLOAD_TOKEN=b["upload_token"],
    )
    assert r.status_code == 403


@pytest.mark.django_db
def test_chunk_retry_is_idempotent_and_gaps_rejected(client, media_root):  # noqa: ARG001
    res = _submit(client).json()
    hdr = {"HTTP_X_UPLOAD_TOKEN": res["upload_token"]}
    url = f"/api/badminton/submit/{res['id']}/chunk/"
    assert client.post(url, {"offset": 0, "chunk": SimpleUploadedFile("c", MP4_HEAD[:10])}, **hdr).status_code == 200
    r = client.post(url, {"offset": 0, "chunk": SimpleUploadedFile("c", MP4_HEAD[:10])}, **hdr)
    assert r.status_code == 200 and r.json()["received"] == 10
    r = client.post(url, {"offset": 15, "chunk": SimpleUploadedFile("c", MP4_HEAD[15:])}, **hdr)
    assert r.status_code == 409 and r.json()["received"] == 10
    r = client.post(f"/api/badminton/submit/{res['id']}/complete/", **hdr)
    assert r.status_code == 409


@pytest.mark.django_db
def test_non_video_rejected_on_complete(client, media_root):  # noqa: ARG001
    data = b"#!/bin/sh\necho hi there friend\n"
    res = _submit(client, size=len(data)).json()
    hdr = {"HTTP_X_UPLOAD_TOKEN": res["upload_token"]}
    client.post(
        f"/api/badminton/submit/{res['id']}/chunk/", {"offset": 0, "chunk": SimpleUploadedFile("c", data)}, **hdr
    )
    assert client.post(f"/api/badminton/submit/{res['id']}/complete/", **hdr).status_code == 415
    assert not BadmintonSubmission.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("overrides", "status"),
    [
        ({"filename": "evil.exe"}, 415),
        ({"size": 3 * 1024**3}, 413),
        ({"height_m": "0.5"}, 400),
        ({"hand": "both"}, 400),
        ({"lang": "fr"}, 400),
        ({"name": ""}, 400),
        ({"name": "", "player": "nobody"}, 400),
        ({"recorded_on": "2999-01-01"}, 400),
    ],
)
def test_submit_validation(client, media_root, overrides, status):  # noqa: ARG001
    assert _submit(client, **overrides).status_code == status


@pytest.mark.django_db
def test_submit_rate_limited_per_ip(client, media_root):  # noqa: ARG001
    for _ in range(5):
        assert _submit(client).status_code == 201
    assert _submit(client).status_code == 429


@pytest.mark.django_db
def test_existing_player_reused(client, media_root):  # noqa: ARG001
    _submit(client, name="Nam")
    _submit(client, player="nam")
    _submit(client, name="nam")
    assert BadmintonPlayer.objects.count() == 1
    assert BadmintonSubmission.objects.count() == 3


@pytest.mark.django_db
def test_asset_path_traversal_rejected(client, media_root, auth_headers):
    sub_id, _ = _upload(client)
    client.post(f"/api/badminton/submissions/{sub_id}/approve/", **auth_headers)
    client.post("/api/badminton/worker/claim/", **auth_headers)
    for bad in ("../../etc/x.png", "/abs/x.png", "assets/../../x.png", "other/x.png", "assets/x.sh"):
        r = client.post(
            f"/api/badminton/worker/{sub_id}/asset/",
            {"path": bad, "file": SimpleUploadedFile("a", b"x")},
            **auth_headers,
        )
        assert r.status_code == 400, bad
    assert not (Path(media_root) / "x.png").exists()


@pytest.mark.django_db
def test_fail_then_retry(client, media_root, auth_headers):  # noqa: ARG001
    sub_id, _ = _upload(client)
    client.post(f"/api/badminton/submissions/{sub_id}/approve/", **auth_headers)
    client.post("/api/badminton/worker/claim/", **auth_headers)
    r = client.post(
        f"/api/badminton/worker/{sub_id}/fail/",
        json.dumps({"error": "rate limited by provider XYZ"}),
        content_type="application/json",
        **auth_headers,
    )
    assert r.status_code == 200
    public = client.get(f"/api/badminton/submissions/{sub_id}/status/").json()
    assert public["status"] == "failed" and "error" not in public
    admin = client.get(f"/api/badminton/submissions/{sub_id}/status/", **auth_headers).json()
    assert "XYZ" in admin["error"]
    assert client.post(f"/api/badminton/submissions/{sub_id}/approve/", **auth_headers).status_code == 200
    assert client.post("/api/badminton/worker/claim/", **auth_headers).json()["id"] == sub_id


@pytest.mark.django_db
def test_vietnamese_name_slug(client, media_root):  # noqa: ARG001
    _submit(client, name="Minh Đức")
    assert BadmintonPlayer.objects.get().slug == "minh-duc"
