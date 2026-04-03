import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from PIL import Image as PILImage  # noqa: I001

from ..auth import require_admin
from ..models import Drawing

ALLOWED_FORMATS = {"JPEG", "PNG", "GIF", "WEBP", "BMP"}
MIN_RATIO = 0.8
MAX_RATIO = 1.2


def _normalize_image(img):
    """Crop to aspect ratio [0.8, 1.2], then pad to square."""
    w, h = img.size
    ratio = w / h

    # Crop center if aspect ratio is too extreme
    if ratio < MIN_RATIO:
        new_h = int(w / MIN_RATIO)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))
    elif ratio > MAX_RATIO:
        new_w = int(h * MAX_RATIO)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))

    # Pad to square
    w, h = img.size
    if w != h:
        size = max(w, h)
        fill = (18, 10, 28, 255) if img.mode == "RGBA" else (18, 10, 28)
        padded = PILImage.new(img.mode, (size, size), fill)
        padded.paste(img, ((size - w) // 2, (size - h) // 2))
        img = padded

    return img


def drawing_list(request):  # noqa: ARG001
    drawings = Drawing.objects.filter(is_published=True)[:200]
    data = [
        {
            "id": d.id,
            "image": d.image.url,
            "category": d.category,
            "caption": d.caption,
            "created_at": d.created_at.isoformat(),
        }
        for d in drawings
    ]
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_POST
@require_admin
def drawing_upload(request):
    image = request.FILES.get("image")
    if not image:
        return JsonResponse({"error": "No image provided"}, status=400)

    if image.size > 10 * 1024 * 1024:
        return JsonResponse({"error": "Image too large (max 10MB)"}, status=400)

    try:
        img = PILImage.open(image)
        fmt = img.format
    except Exception:
        return JsonResponse({"error": "Invalid or corrupted image file"}, status=400)
    finally:
        image.seek(0)

    if fmt not in ALLOWED_FORMATS:
        return JsonResponse({"error": f"Unsupported format. Allowed: {', '.join(sorted(ALLOWED_FORMATS))}"}, status=400)

    category = request.POST.get("category", "")
    if category not in ("pencil", "camera"):
        return JsonResponse({"error": "Category must be 'pencil' or 'camera'"}, status=400)

    caption = request.POST.get("caption", "").strip()[:200]

    # Normalize: crop extreme aspect ratios, pad to square

    img = _normalize_image(img)
    buf = io.BytesIO()
    save_fmt = fmt if fmt != "BMP" else "PNG"
    img.save(buf, format=save_fmt)
    ext = save_fmt.lower()
    if ext == "jpeg":
        ext = "jpg"
    processed = SimpleUploadedFile(f"drawing.{ext}", buf.getvalue(), content_type=f"image/{save_fmt.lower()}")

    drawing = Drawing.objects.create(image=processed, category=category, caption=caption)
    return JsonResponse(
        {
            "id": drawing.id,
            "image": drawing.image.url,
            "category": drawing.category,
            "caption": drawing.caption,
            "created_at": drawing.created_at.isoformat(),
        },
        status=201,
    )


@csrf_exempt
@require_admin
@require_POST
def drawing_delete(request, drawing_id):  # noqa: ARG001
    try:
        drawing = Drawing.objects.get(id=drawing_id)
    except Drawing.DoesNotExist:
        return JsonResponse({"error": "Drawing not found"}, status=404)

    drawing.image.delete(save=False)
    drawing.delete()
    return JsonResponse({"ok": True})
