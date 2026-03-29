import os
from pathlib import Path

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..auth import require_admin

UPLOAD_DIR = Path(settings.MEDIA_ROOT) / "debug"


def _file_list():
    if not UPLOAD_DIR.exists():
        return []
    files = sorted(UPLOAD_DIR.iterdir(), key=lambda f: f.stat().st_mtime, reverse=True)
    return [
        {
            "name": f.name,
            "url": f"{settings.MEDIA_URL}debug/{f.name}",
            "time": f.stat().st_mtime,
        }
        for f in files
        if f.is_file()
    ][:50]


@require_admin
def debug_uploads(request):  # noqa: ARG001
    return JsonResponse(_file_list(), safe=False)


@csrf_exempt
@require_admin
def debug_upload(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"error": "No file provided"}, status=400)

    if uploaded.size > 20 * 1024 * 1024:
        return JsonResponse({"error": "File too large (max 20MB)"}, status=400)

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    name = os.path.basename(uploaded.name)
    dest = UPLOAD_DIR / name
    counter = 1
    while dest.exists():
        stem, ext = os.path.splitext(name)
        dest = UPLOAD_DIR / f"{stem}_{counter}{ext}"
        counter += 1

    with open(dest, "wb") as f:
        for chunk in uploaded.chunks():
            f.write(chunk)

    return JsonResponse(
        {
            "name": dest.name,
            "url": f"{settings.MEDIA_URL}debug/{dest.name}",
            "time": dest.stat().st_mtime,
        },
        status=201,
    )
