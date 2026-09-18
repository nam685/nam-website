"""Badminton swing analysis (/plays/badminton).

Flow: anyone uploads a practice video (chunked, so multi-GB uploads never hold a gunicorn worker past its
timeout) → it waits as `pending` until the admin watches it and approves → the PC worker
(`scripts/badminton_worker.py`, next to a GPU running `badminton-coach serve`) claims it, reports progress,
uploads the report assets and finishes it → the report is public.

The raw upload lives under MEDIA_ROOT/badminton/raw/<upload_key>/ and is reachable only through that
unguessable key, which is handed out to the admin and the worker only. It is deleted once the report is in.
Report assets live under MEDIA_ROOT/badminton/reports/<submission id>/ and are public.
"""

import datetime as dt
import shutil
from pathlib import Path, PurePosixPath

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from ..auth import require_admin, verify_token
from ..models import BadmintonPlayer, BadmintonSubmission
from ..utils import get_client_ip, parse_json_body

MAX_VIDEO_BYTES = 2 * 1024**3
MAX_CHUNK_BYTES = 16 * 1024**2
MAX_ASSET_BYTES = 200 * 1024**2
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
ASSET_EXTS = {".mp4", ".png", ".jpg", ".jpeg", ".webp", ".json", ".md"}

SUBMIT_WINDOW = dt.timedelta(hours=24)
SUBMIT_LIMIT_PER_IP = 5
SUBMIT_LIMIT_GLOBAL = 30
STALE_UPLOAD_AGE = dt.timedelta(hours=24)
UPLOAD_TOKEN_SALT = "badminton-upload"
WORKER_SEEN_KEY = "badminton:worker_seen"

S = BadmintonSubmission.Status


def _is_admin(request) -> bool:
    auth = request.headers.get("Authorization", "")
    return auth.startswith("Bearer ") and verify_token(auth[7:])


def _media_root() -> Path:
    return Path(settings.MEDIA_ROOT) / "badminton"


def _raw_dir(sub: BadmintonSubmission) -> Path:
    return _media_root() / "raw" / sub.upload_key


def _raw_path(sub: BadmintonSubmission) -> Path:
    return _raw_dir(sub) / f"video{Path(sub.filename).suffix.lower()}"


def _raw_url(sub: BadmintonSubmission) -> str:
    return f"{settings.MEDIA_URL}badminton/raw/{sub.upload_key}/video{Path(sub.filename).suffix.lower()}"


def _report_dir(sub_id: int) -> Path:
    return _media_root() / "reports" / str(sub_id)


def _delete_files(sub: BadmintonSubmission) -> None:
    shutil.rmtree(_raw_dir(sub), ignore_errors=True)
    shutil.rmtree(_report_dir(sub.id), ignore_errors=True)


def _delete_submission(sub: BadmintonSubmission) -> None:
    """Delete a submission, its files, and its player if that was the player's only submission."""
    player = sub.player
    _delete_files(sub)
    sub.delete()
    if not player.submissions.exists():
        player.delete()


def _rewrite_assets(value, base: str):
    """Turn report.json's relative `assets/...` paths into public URLs under `base`."""
    if isinstance(value, dict):
        return {k: _rewrite_assets(v, base) for k, v in value.items()}
    if isinstance(value, list):
        return [_rewrite_assets(v, base) for v in value]
    if isinstance(value, str) and value.startswith("assets/"):
        return base + value
    return value


def _asset_paths(value) -> set[str]:
    if isinstance(value, dict):
        return set().union(*(_asset_paths(v) for v in value.values())) if value else set()
    if isinstance(value, list):
        return set().union(*(_asset_paths(v) for v in value)) if value else set()
    if isinstance(value, str) and value.startswith("assets/"):
        return {value}
    return set()


def _safe_asset_path(raw: str) -> PurePosixPath | None:
    p = PurePosixPath(raw)
    if p.is_absolute() or ".." in p.parts or not p.parts or p.parts[0] != "assets" or len(p.parts) < 2:
        return None
    if p.suffix.lower() not in ASSET_EXTS:
        return None
    return p


def _queue_position(sub: BadmintonSubmission) -> int | None:
    if sub.status != S.APPROVED:
        return None
    ahead = BadmintonSubmission.objects.filter(
        Q(status=S.RUNNING) | Q(status=S.APPROVED, approved_at__lt=sub.approved_at)
    ).count()
    return ahead + 1


def _summary(sub: BadmintonSubmission) -> dict:
    report = sub.report or {}
    verdict = report.get("verdict") or {}
    return {
        "id": sub.id,
        "recorded_on": sub.recorded_on.isoformat(),
        "recorded_at": report.get("recorded_at"),
        "attempts": len(report.get("attempts") or []),
        "findings": len(verdict.get("findings") or []),
    }


def _admin_row(sub: BadmintonSubmission) -> dict:
    return {
        **_summary(sub),
        "status": sub.status,
        "player": {"slug": sub.player.slug, "name": sub.player.name},
        "height_m": sub.height_m,
        "hand": sub.hand,
        "lang": sub.lang,
        "note": sub.note,
        "filename": sub.filename,
        "size_bytes": sub.size_bytes,
        "received_bytes": sub.received_bytes,
        "video_url": _raw_url(sub) if sub.status != S.UPLOADING else None,
        "step": sub.step,
        "stage": sub.stage,
        "error": sub.error,
        "created_at": sub.created_at.isoformat(),
        "approved_at": sub.approved_at.isoformat() if sub.approved_at else None,
        "started_at": sub.started_at.isoformat() if sub.started_at else None,
        "queue_position": _queue_position(sub),
    }


# ── Public reads ───────────────────────────────────────────────────────────


@require_GET
def badminton_players(_request):
    """GET /api/badminton/players/ — players with at least one finished report, each with dated submissions."""
    done = BadmintonSubmission.objects.filter(status=S.DONE).select_related("player")
    players: dict[int, dict] = {}
    for sub in done:
        p = sub.player
        entry = players.setdefault(
            p.id, {"slug": p.slug, "name": p.name, "hand": p.hand, "height_m": p.height_m, "submissions": []}
        )
        entry["submissions"].append(_summary(sub))
    for entry in players.values():  # newest first; same-day sessions by recording time
        entry["submissions"].sort(key=lambda s: (s["recorded_on"], s["recorded_at"] or ""), reverse=True)
    ordered = sorted(players.values(), key=lambda e: e["submissions"][0]["recorded_on"], reverse=True)
    return JsonResponse({"players": ordered})


@require_GET
def badminton_submission(request, sub_id: int):
    """GET /api/badminton/submissions/<id>/ — one finished report (admins may see any status)."""
    try:
        sub = BadmintonSubmission.objects.select_related("player").get(id=sub_id)
    except BadmintonSubmission.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)
    if sub.status != S.DONE and not _is_admin(request):
        return JsonResponse({"error": "Not found"}, status=404)
    base = f"{settings.MEDIA_URL}badminton/reports/{sub.id}/"
    return JsonResponse(
        {
            **_summary(sub),
            "player": {"slug": sub.player.slug, "name": sub.player.name, "hand": sub.player.hand},
            "report": _rewrite_assets(sub.report or {}, base),
        }
    )


@require_GET
def badminton_status(request, sub_id: int):
    """GET /api/badminton/submissions/<id>/status/ — what the uploader polls after uploading."""
    try:
        sub = BadmintonSubmission.objects.get(id=sub_id)
    except BadmintonSubmission.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)
    data = {
        "id": sub.id,
        "status": sub.status,
        "step": sub.step or None,
        "stage": sub.stage or None,
        "queue_position": _queue_position(sub),
    }
    if sub.status == S.FAILED and _is_admin(request):
        data["error"] = sub.error
    return JsonResponse(data)


# ── Public upload (chunked) ────────────────────────────────────────────────


def _parse_height(raw) -> tuple[float | None, str | None]:
    if raw in (None, ""):
        return None, None
    try:
        h = float(raw)
    except (TypeError, ValueError):
        return None, "Height must be a number of metres."
    if h > 3:  # typed in cm
        h = h / 100
    if not 1.0 <= h <= 2.5:
        return None, "Height must be between 1.00 and 2.50 m."
    return round(h, 2), None


def _resolve_player(body: dict) -> tuple[BadmintonPlayer | None, str | None]:
    name = str(body.get("name") or "").strip()
    slug = str(body.get("player") or "").strip()
    if slug:
        player = BadmintonPlayer.objects.filter(slug=slug).first()
        if not player:
            return None, "Unknown player."
        return player, None
    if not name:
        return None, "Tell us who you are."
    if len(name) > 40:
        return None, "Name too long (max 40 characters)."
    # slugify() drops letters with no ASCII decomposition; đ is common in Vietnamese names.
    slug = slugify(name.replace("đ", "d").replace("Đ", "D"))[:40].strip("-")
    if not slug:
        return None, "Name needs at least one latin letter or digit."
    player, _ = BadmintonPlayer.objects.get_or_create(slug=slug, defaults={"name": name})
    return player, None


@csrf_exempt
@require_POST
def badminton_submit(request):
    """POST /api/badminton/submit/ — start an upload. Body: {player|name, height_m?, hand?, lang?,
    recorded_on, filename, size, note?}. Returns {id, upload_token, chunk_size}."""
    body, err = parse_json_body(request)
    if err:
        return err

    now = timezone.now()
    # Lazy cleanup of abandoned uploads.
    for stale in BadmintonSubmission.objects.filter(status=S.UPLOADING, created_at__lt=now - STALE_UPLOAD_AGE):
        _delete_submission(stale)

    ip = get_client_ip(request)
    if not _is_admin(request):
        recent = BadmintonSubmission.objects.filter(created_at__gte=now - SUBMIT_WINDOW)
        if recent.filter(submitter_ip=ip).count() >= SUBMIT_LIMIT_PER_IP:
            return JsonResponse({"error": "You've uploaded a lot today. Try again tomorrow."}, status=429)
        if recent.count() >= SUBMIT_LIMIT_GLOBAL:
            return JsonResponse({"error": "Too many uploads today. Try again tomorrow."}, status=429)

    filename = Path(str(body.get("filename") or "")).name[:200]
    if Path(filename).suffix.lower() not in VIDEO_EXTS:
        return JsonResponse({"error": "Upload a video file (.mp4, .mov, .m4v, .webm or .mkv)."}, status=415)
    try:
        size = int(body.get("size"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "size required"}, status=400)
    if size <= 0:
        return JsonResponse({"error": "Empty file."}, status=400)
    if size > MAX_VIDEO_BYTES:
        return JsonResponse({"error": "Video too large (max 2 GB)."}, status=413)

    height, err_msg = _parse_height(body.get("height_m"))
    if err_msg:
        return JsonResponse({"error": err_msg}, status=400)
    hand = str(body.get("hand") or "")
    if hand not in ("", "left", "right"):
        return JsonResponse({"error": "Hand must be left or right."}, status=400)
    lang = str(body.get("lang") or "en")
    if lang not in BadmintonSubmission.Lang.values:
        return JsonResponse({"error": "Unsupported language."}, status=400)
    try:
        recorded_on = dt.date.fromisoformat(str(body.get("recorded_on") or now.date().isoformat()))
    except ValueError:
        return JsonResponse({"error": "Invalid recording date."}, status=400)
    if recorded_on > now.date() + dt.timedelta(days=1):
        return JsonResponse({"error": "Recording date is in the future."}, status=400)
    note = str(body.get("note") or "")[:500]

    player, err_msg = _resolve_player(body)
    if err_msg:
        return JsonResponse({"error": err_msg}, status=400)

    sub = BadmintonSubmission.objects.create(
        player=player,
        recorded_on=recorded_on,
        height_m=height,
        hand=hand,
        lang=lang,
        note=note,
        filename=filename,
        size_bytes=size,
        submitter_ip=ip or None,
    )
    _raw_dir(sub).mkdir(parents=True, exist_ok=True)
    _raw_path(sub).touch()
    return JsonResponse(
        {
            "id": sub.id,
            "upload_token": signing.dumps(sub.id, salt=UPLOAD_TOKEN_SALT),
            "chunk_size": MAX_CHUNK_BYTES // 2,
        },
        status=201,
    )


def _uploading_sub(request, sub_id: int) -> tuple[BadmintonSubmission | None, JsonResponse | None]:
    try:
        token_id = signing.loads(
            # Form field (no custom header → no CORS preflight in local dev); header kept for scripts.
            request.POST.get("upload_token") or request.headers.get("X-Upload-Token", ""),
            salt=UPLOAD_TOKEN_SALT,
            max_age=STALE_UPLOAD_AGE,
        )
    except signing.BadSignature:
        return None, JsonResponse({"error": "Upload expired — start again."}, status=403)
    if token_id != sub_id:
        return None, JsonResponse({"error": "Upload expired — start again."}, status=403)
    sub = BadmintonSubmission.objects.filter(id=sub_id, status=S.UPLOADING).first()
    if not sub:
        return None, JsonResponse({"error": "Upload not found."}, status=404)
    return sub, None


@csrf_exempt
@require_POST
def badminton_upload_chunk(request, sub_id: int):
    """POST /api/badminton/submit/<id>/chunk/ — multipart {offset, chunk}. Idempotent per offset, so the
    client can retry a chunk whose response it never saw."""
    sub, err = _uploading_sub(request, sub_id)
    if err:
        return err
    chunk = request.FILES.get("chunk")
    try:
        offset = int(request.POST.get("offset", ""))
    except ValueError:
        return JsonResponse({"error": "offset required"}, status=400)
    if not chunk:
        return JsonResponse({"error": "chunk required"}, status=400)
    if chunk.size > MAX_CHUNK_BYTES:
        return JsonResponse({"error": "chunk too large"}, status=413)

    path = _raw_path(sub)
    current = path.stat().st_size if path.exists() else 0
    if offset + chunk.size <= current:  # already have it (retried chunk)
        return JsonResponse({"received": current})
    if offset != current:
        return JsonResponse({"error": "offset mismatch", "received": current}, status=409)
    if current + chunk.size > sub.size_bytes:
        return JsonResponse({"error": "more data than announced"}, status=400)
    with open(path, "ab") as out:
        for piece in chunk.chunks():
            out.write(piece)
    sub.received_bytes = current + chunk.size
    sub.save(update_fields=["received_bytes"])
    return JsonResponse({"received": sub.received_bytes})


def _looks_like_video(path: Path) -> bool:
    with open(path, "rb") as f:
        head = f.read(12)
    # ISO BMFF (mp4/mov/m4v): box size + "ftyp"; some QuickTime files start with a wide/mdat/moov box.
    if head[4:8] in (b"ftyp", b"wide", b"mdat", b"moov", b"free", b"skip"):
        return True
    return head[:4] == b"\x1a\x45\xdf\xa3"  # EBML (webm/mkv)


@csrf_exempt
@require_POST
def badminton_upload_complete(request, sub_id: int):
    """POST /api/badminton/submit/<id>/complete/ — all bytes in; the submission now awaits approval."""
    sub, err = _uploading_sub(request, sub_id)
    if err:
        return err
    path = _raw_path(sub)
    size = path.stat().st_size if path.exists() else 0
    if size != sub.size_bytes:
        return JsonResponse({"error": "Upload incomplete.", "received": size}, status=409)
    if not _looks_like_video(path):
        _delete_submission(sub)
        return JsonResponse({"error": "That file doesn't look like a video."}, status=415)
    sub.status = S.PENDING
    sub.save(update_fields=["status"])
    return JsonResponse({"id": sub.id, "status": sub.status})


# ── Admin ──────────────────────────────────────────────────────────────────


@require_GET
@require_admin
def badminton_queue(_request):
    """GET /api/badminton/queue/ — every unfinished submission, plus when the PC worker last checked in."""
    subs = BadmintonSubmission.objects.exclude(status=S.DONE).select_related("player").order_by("created_at")
    return JsonResponse({"submissions": [_admin_row(s) for s in subs], "worker_seen_at": cache.get(WORKER_SEEN_KEY)})


@csrf_exempt
@require_POST
@require_admin
def badminton_approve(_request, sub_id: int):
    """POST /api/badminton/submissions/<id>/approve/ — queue for the PC worker (also re-queues failed or
    stuck-running ones)."""
    sub = BadmintonSubmission.objects.filter(id=sub_id).first()
    if not sub:
        return JsonResponse({"error": "Not found"}, status=404)
    if sub.status not in (S.PENDING, S.FAILED, S.RUNNING):
        return JsonResponse({"error": f"Can't approve a submission that is {sub.status}"}, status=409)
    if not _raw_path(sub).exists():
        return JsonResponse({"error": "The raw video is gone; ask for a re-upload."}, status=409)
    sub.status = S.APPROVED
    sub.approved_at = timezone.now()
    sub.step = sub.stage = sub.error = ""
    sub.save(update_fields=["status", "approved_at", "step", "stage", "error"])
    return JsonResponse(_admin_row(sub))


@csrf_exempt
@require_POST
@require_admin
def badminton_delete(_request, sub_id: int):
    """POST /api/badminton/submissions/<id>/delete/ — reject a pending upload or remove a report + its files."""
    sub = BadmintonSubmission.objects.filter(id=sub_id).select_related("player").first()
    if not sub:
        return JsonResponse({"error": "Not found"}, status=404)
    _delete_submission(sub)
    return JsonResponse({"ok": True})


# ── PC worker (admin token) ────────────────────────────────────────────────


@csrf_exempt
@require_POST
@require_admin
def badminton_worker_claim(_request):
    """POST /api/badminton/worker/claim/ — take the oldest approved submission (→ running). 204 when idle."""
    cache.set(WORKER_SEEN_KEY, timezone.now().isoformat(), None)
    with transaction.atomic():
        sub = (
            BadmintonSubmission.objects.select_for_update(skip_locked=True)
            .filter(status=S.APPROVED)
            .order_by("approved_at")
            .first()
        )
        if not sub:
            return HttpResponse(status=204)
        sub.status = S.RUNNING
        sub.started_at = timezone.now()
        sub.step = sub.stage = sub.error = ""
        sub.save(update_fields=["status", "started_at", "step", "stage", "error"])
    player = sub.player
    return JsonResponse(
        {
            "id": sub.id,
            "player": player.slug,
            "height_m": sub.height_m or player.height_m,
            "hand": sub.hand or player.hand or None,
            "lang": sub.lang,
            "filename": sub.filename,
            "size_bytes": sub.size_bytes,
            "video_url": _raw_url(sub),
        }
    )


def _running_sub(sub_id: int) -> tuple[BadmintonSubmission | None, JsonResponse | None]:
    sub = BadmintonSubmission.objects.filter(id=sub_id).select_related("player").first()
    if not sub:
        return None, JsonResponse({"error": "Not found"}, status=404)
    if sub.status != S.RUNNING:
        return None, JsonResponse({"error": f"Submission is {sub.status}, not running"}, status=409)
    return sub, None


@csrf_exempt
@require_POST
@require_admin
def badminton_worker_progress(request, sub_id: int):
    """POST /api/badminton/worker/<id>/progress/ — {step, stage} from badminton-coach's job."""
    cache.set(WORKER_SEEN_KEY, timezone.now().isoformat(), None)
    sub, err = _running_sub(sub_id)
    if err:
        return err
    body, err = parse_json_body(request)
    if err:
        return err
    sub.step = str(body.get("step") or "")[:20]
    sub.stage = str(body.get("stage") or "")[:40]
    sub.save(update_fields=["step", "stage"])
    return JsonResponse({"ok": True})


@csrf_exempt
@require_POST
@require_admin
def badminton_worker_fail(request, sub_id: int):
    """POST /api/badminton/worker/<id>/fail/ — {error}. The raw video stays so the admin can retry."""
    sub, err = _running_sub(sub_id)
    if err:
        return err
    body, err = parse_json_body(request)
    if err:
        return err
    sub.status = S.FAILED
    sub.error = str(body.get("error") or "unknown error")[:5000]
    sub.finished_at = timezone.now()
    sub.save(update_fields=["status", "error", "finished_at"])
    return JsonResponse({"ok": True})


@csrf_exempt
@require_POST
@require_admin
def badminton_worker_asset(request, sub_id: int):
    """POST /api/badminton/worker/<id>/asset/ — multipart {path: "assets/…", file}."""
    sub, err = _running_sub(sub_id)
    if err:
        return err
    rel = _safe_asset_path(request.POST.get("path", ""))
    if rel is None:
        return JsonResponse({"error": "invalid asset path"}, status=400)
    f = request.FILES.get("file")
    if not f:
        return JsonResponse({"error": "file required"}, status=400)
    if f.size > MAX_ASSET_BYTES:
        return JsonResponse({"error": "asset too large"}, status=413)
    target = _report_dir(sub.id) / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    with open(tmp, "wb") as out:
        for piece in f.chunks():
            out.write(piece)
    tmp.replace(target)
    return JsonResponse({"ok": True, "path": str(rel)})


@csrf_exempt
@require_POST
@require_admin
def badminton_worker_finish(request, sub_id: int):
    """POST /api/badminton/worker/<id>/finish/ — {submission: <report.json submission>, handedness?,
    height_m?}. Every asset the submission references must have been uploaded first."""
    sub, err = _running_sub(sub_id)
    if err:
        return err
    body, err = parse_json_body(request)
    if err:
        return err
    report = body.get("submission")
    if not isinstance(report, dict) or not isinstance(report.get("attempts"), list):
        return JsonResponse({"error": "submission with an attempts list required"}, status=400)
    missing = sorted(p for p in _asset_paths(report) if not (_report_dir(sub.id) / p).exists())
    if missing:
        return JsonResponse({"error": "missing assets", "missing": missing[:20]}, status=400)

    sub.report = report
    sub.status = S.DONE
    sub.step = sub.stage = sub.error = ""
    sub.finished_at = timezone.now()
    sub.save(update_fields=["report", "status", "step", "stage", "error", "finished_at"])

    player = sub.player
    handedness = body.get("handedness")
    if handedness in ("left", "right"):
        player.hand = handedness
    height, _ = _parse_height(body.get("height_m"))
    if height or sub.height_m:
        player.height_m = height or sub.height_m
    player.save(update_fields=["hand", "height_m"])

    shutil.rmtree(_raw_dir(sub), ignore_errors=True)
    return JsonResponse({"ok": True, "id": sub.id})
