import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image as PILImage
from pillow_heif import register_heif_opener

from website.models import Drawing

register_heif_opener()


def _make_image(fmt="JPEG", size=(100, 100)):
    """Create a valid in-memory image file."""
    buf = io.BytesIO()
    img = PILImage.new("RGB", size, color="red")
    img.save(buf, format=fmt)
    buf.seek(0)
    ext = {"JPEG": "jpg", "PNG": "png", "GIF": "gif", "WEBP": "webp", "HEIF": "heic"}.get(fmt, "bin")
    content_type = "image/heic" if fmt == "HEIF" else f"image/{ext}"
    return SimpleUploadedFile(f"test.{ext}", buf.read(), content_type=content_type)


@pytest.mark.django_db
class TestDrawingList:
    def test_empty_list(self, client):
        resp = client.get("/api/drawings/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_published_only(self, client):
        Drawing.objects.create(image="drawings/a.jpg", category="pencil", is_published=True)
        Drawing.objects.create(image="drawings/b.jpg", category="camera", is_published=False)
        resp = client.get("/api/drawings/")
        data = resp.json()
        assert len(data) == 1
        assert data[0]["category"] == "pencil"


@pytest.mark.django_db
class TestDrawingUpload:
    def test_requires_auth(self, client):
        resp = client.post("/api/drawings/upload/")
        assert resp.status_code == 401

    def test_upload_valid_image(self, client, auth_headers):
        image = _make_image("JPEG")
        resp = client.post(
            "/api/drawings/upload/",
            {"image": image, "category": "pencil"},
            **auth_headers,
        )
        assert resp.status_code == 201
        assert Drawing.objects.count() == 1

    def test_upload_no_image(self, client, auth_headers):
        resp = client.post(
            "/api/drawings/upload/",
            {"category": "pencil"},
            **auth_headers,
        )
        assert resp.status_code == 400

    def test_upload_bad_category(self, client, auth_headers):
        image = _make_image("PNG")
        resp = client.post(
            "/api/drawings/upload/",
            {"image": image, "category": "invalid"},
            **auth_headers,
        )
        assert resp.status_code == 400

    def test_upload_heic_converted_to_jpeg(self, client, auth_headers):
        image = _make_image("HEIF")
        resp = client.post(
            "/api/drawings/upload/",
            {"image": image, "category": "camera"},
            **auth_headers,
        )
        assert resp.status_code == 201, resp.content
        drawing = Drawing.objects.get(id=resp.json()["id"])
        assert drawing.image.name.endswith(".jpg")

    def test_upload_corrupt_file_rejected(self, client, auth_headers):
        bogus = SimpleUploadedFile("not-an-image.jpg", b"not an image at all", content_type="image/jpeg")
        resp = client.post(
            "/api/drawings/upload/",
            {"image": bogus, "category": "pencil"},
            **auth_headers,
        )
        assert resp.status_code == 400
        assert "Invalid" in resp.json()["error"]

    def test_upload_too_large(self, client, auth_headers):
        # Create a file that claims to be >10MB
        big_file = SimpleUploadedFile("big.jpg", b"x" * (10 * 1024 * 1024 + 1), content_type="image/jpeg")
        resp = client.post(
            "/api/drawings/upload/",
            {"image": big_file, "category": "pencil"},
            **auth_headers,
        )
        assert resp.status_code == 400


@pytest.mark.django_db
class TestDrawingDelete:
    def test_requires_auth(self, client):
        resp = client.post("/api/drawings/1/delete/")
        assert resp.status_code == 401

    def test_delete_not_found(self, client, auth_headers):
        resp = client.post("/api/drawings/9999/delete/", **auth_headers)
        assert resp.status_code == 404

    def test_delete_success(self, client, auth_headers):
        image = _make_image("JPEG")
        upload_resp = client.post(
            "/api/drawings/upload/",
            {"image": image, "category": "pencil"},
            **auth_headers,
        )
        drawing_id = upload_resp.json()["id"]
        resp = client.post(f"/api/drawings/{drawing_id}/delete/", **auth_headers)
        assert resp.status_code == 200
        assert Drawing.objects.count() == 0
