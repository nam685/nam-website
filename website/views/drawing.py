from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from PIL import Image as PILImage  # noqa: I001

from ..auth import require_admin
from ..models import Drawing

ALLOWED_FORMATS = {"JPEG", "PNG", "GIF", "WEBP", "BMP"}


def drawing_list(request):  # noqa: ARG001
    drawings = Drawing.objects.filter(is_published=True)
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
@require_admin
def drawing_upload(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    image = request.FILES.get("image")
    if not image:
        return JsonResponse({"error": "No image provided"}, status=400)

    if image.size > 10 * 1024 * 1024:
        return JsonResponse({"error": "Image too large (max 10MB)"}, status=400)

    try:
        img = PILImage.open(image)
        img.verify()
        image.seek(0)
    except Exception:
        return JsonResponse({"error": "Invalid or corrupted image file"}, status=400)

    if img.format not in ALLOWED_FORMATS:
        return JsonResponse({"error": f"Unsupported format. Allowed: {', '.join(sorted(ALLOWED_FORMATS))}"}, status=400)

    category = request.POST.get("category", "")
    if category not in ("pencil", "camera"):
        return JsonResponse({"error": "Category must be 'pencil' or 'camera'"}, status=400)

    caption = request.POST.get("caption", "").strip()[:200]

    drawing = Drawing.objects.create(image=image, category=category, caption=caption)
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
