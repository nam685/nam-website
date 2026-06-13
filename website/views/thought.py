import io
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.paginator import Paginator
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from PIL import Image as PILImage  # noqa: I001

from ..auth import require_admin
from ..models import Thought

COOLDOWN = timedelta(hours=18)
ALLOWED_FORMATS = {"JPEG", "PNG", "GIF", "WEBP", "BMP"}
MAX_DIM = 2000


def _process_image(image_file):
    """Validate + lightly process an uploaded image, keeping natural aspect ratio.

    Returns (SimpleUploadedFile, None) on success or (None, JsonResponse) on error.
    """
    if image_file.size > 10 * 1024 * 1024:
        return None, JsonResponse({"error": "Image too large (max 10MB)"}, status=400)
    try:
        img = PILImage.open(image_file)
        fmt = img.format
        img.load()
    except Exception:
        return None, JsonResponse({"error": "Invalid or corrupted image file"}, status=400)

    if fmt not in ALLOWED_FORMATS:
        return None, JsonResponse(
            {"error": f"Unsupported format. Allowed: {', '.join(sorted(ALLOWED_FORMATS))}"}, status=400
        )

    # Downscale only if very large; never upscale, never change aspect ratio.
    if max(img.size) > MAX_DIM:
        img.thumbnail((MAX_DIM, MAX_DIM))

    save_fmt = fmt if fmt != "BMP" else "PNG"
    buf = io.BytesIO()
    img.save(buf, format=save_fmt)
    ext = save_fmt.lower()
    if ext == "jpeg":
        ext = "jpg"
    return SimpleUploadedFile(f"thought.{ext}", buf.getvalue(), content_type=f"image/{save_fmt.lower()}"), None


def thought_list(request):
    thoughts = Thought.objects.filter(is_published=True)
    paginator = Paginator(thoughts, 10)
    page_number = request.GET.get("page", 1)
    page = paginator.get_page(page_number)
    data = {
        "thoughts": [
            {
                "id": t.id,
                "content": t.content,
                "image": t.image.url if t.image else None,
                "created_at": t.created_at.isoformat(),
            }
            for t in page
        ],
        "has_next": page.has_next(),
        "page": page.number,
    }
    return JsonResponse(data)


@csrf_exempt
@require_admin
def thought_create(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    # Cooldown: 18h since last post (text or image).
    latest = Thought.objects.filter(is_published=True).order_by("-created_at").first()
    if latest and timezone.now() - latest.created_at < COOLDOWN:
        return JsonResponse({"error": "Chill. Too much thinking for today."}, status=429)

    # content is optional in the model (image-only posts); enforce "text or image" here for API creates.
    content = (request.POST.get("content") or "").strip()
    image_file = request.FILES.get("image")

    if not content and not image_file:
        return JsonResponse({"error": "Need text or an image"}, status=400)
    if len(content) > 2000:
        return JsonResponse({"error": "Too long (max 2000 chars)"}, status=400)

    processed = None
    if image_file:
        processed, err = _process_image(image_file)
        if err:
            return err

    thought = Thought.objects.create(content=content, image=processed)
    return JsonResponse(
        {
            "id": thought.id,
            "content": thought.content,
            "image": thought.image.url if thought.image else None,
            "created_at": thought.created_at.isoformat(),
        },
        status=201,
    )


@csrf_exempt
@require_admin
@require_POST
def thought_delete(request, thought_id):  # noqa: ARG001
    try:
        thought = Thought.objects.get(id=thought_id)
    except Thought.DoesNotExist:
        return JsonResponse({"error": "Thought not found"}, status=404)
    if thought.image:
        thought.image.delete(save=False)
    thought.delete()
    return JsonResponse({"ok": True})
