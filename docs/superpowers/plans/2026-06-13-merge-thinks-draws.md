# Merge thinks + draws into a unified feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the `/thinks` (text) and `/draws` (image) pages into a single `/thinks` feed where each post has optional text and/or an optional image.

**Architecture:** Backend extends the `Thought` model with an optional image, makes content optional, migrates existing `Drawing` rows into `Thought`s, then retires the `Drawing` model and its endpoints. The create endpoint becomes multipart. Frontend rewrites the thinks page into a single-column trunk timeline that renders text and/or images, ports the draws lightbox, and replaces the compose sprite with an inline card that attaches an image and saves a text draft across the login redirect. Nav/background entries for `/draws` are removed and `/draws` redirects to `/thinks`.

**Tech Stack:** Django 6 + Pillow + pytest (backend); Next.js 16 / React 19 / TypeScript + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-06-13-merge-thinks-draws-design.md`

---

## File Structure

**Backend (modify/create):**
- `website/models/thought.py` — add `image`, make `content` optional.
- `website/models/__init__.py` — remove `Drawing` export.
- `website/migrations/0020_thought_image.py` — schema: add image, alter content (create).
- `website/migrations/0021_migrate_drawings_to_thoughts.py` — data migration (create).
- `website/migrations/0022_delete_drawing.py` — schema: delete Drawing model (create).
- `website/views/thought.py` — multipart create + image processing + list image url + delete view.
- `website/views/__init__.py` — remove drawing exports, add `thought_delete`.
- `website/views/drawing.py` — delete file.
- `website/models/drawing.py` — delete file.
- `website/urls.py` — remove drawings routes, add `thoughts/<id>/delete/`.
- `website/tests/test_thought.py` — update for multipart + image + delete.
- `website/tests/test_drawing.py` — delete file.
- `website/tests/test_migrate_drawings.py` — migration test (create).

**Frontend (modify/create):**
- `frontend/src/lib/api.ts` — `Thought` gains `image`; remove `Drawing`.
- `frontend/src/lib/thoughtDraft.ts` — draft + image-filter helpers (create).
- `frontend/src/lib/__tests__/thoughtDraft.test.ts` — unit tests (create).
- `frontend/src/app/thinks/page.tsx` — full rewrite (compose card, image entries, lightbox).
- `frontend/src/app/draws/page.tsx` — delete file.
- `frontend/src/lib/navWheel.ts` — remove draws entry.
- `frontend/src/app/layout.tsx` — remove draws from accent map.
- `frontend/src/components/PageBackground.tsx` — remove draws bg, brighten thinks bg.
- `frontend/next.config.ts` — redirect `/draws` → `/thinks`.

**Docs:**
- `docs/README.md`, `docs/QA-CHECKLIST.md`, `CLAUDE.md`.

---

## Task 1: Add image to Thought, make content optional

**Files:**
- Modify: `website/models/thought.py`
- Create: `website/migrations/0020_thought_image.py`

- [ ] **Step 1: Edit the model**

Replace the body of `website/models/thought.py` with:

```python
from django.db import models


class Thought(models.Model):
    content = models.TextField(blank=True)
    image = models.ImageField(upload_to="thoughts/%Y/%m/", blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    is_published = models.BooleanField(default=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.content[:80] or (self.image.name if self.image else f"thought {self.pk}")
```

- [ ] **Step 2: Generate the migration**

Run: `uv run python manage.py makemigrations website --name thought_image`
Expected: creates `website/migrations/0020_thought_image.py` adding `image` and altering `content`.

- [ ] **Step 3: Apply and verify**

Run: `uv run python manage.py migrate website`
Expected: applies cleanly, `OK`.

- [ ] **Step 4: Commit**

```bash
git add website/models/thought.py website/migrations/0020_thought_image.py
git commit -m "feat: add optional image to Thought, make content optional"
```

---

## Task 2: Data migration — import drawings as thoughts

**Files:**
- Create: `website/migrations/0021_migrate_drawings_to_thoughts.py`
- Create: `website/tests/test_migrate_drawings.py`

- [ ] **Step 1: Write the migration**

Create `website/migrations/0021_migrate_drawings_to_thoughts.py`:

```python
from django.db import migrations


def migrate_drawings(apps, schema_editor):
    Drawing = apps.get_model("website", "Drawing")
    Thought = apps.get_model("website", "Thought")
    for d in Drawing.objects.all().iterator():
        t = Thought.objects.create(content=d.caption or "", is_published=d.is_published)
        # Reuse the existing file path and preserve the original timestamp.
        Thought.objects.filter(pk=t.pk).update(image=d.image.name, created_at=d.created_at)


def noop(apps, schema_editor):
    # Irreversible by design — migrated rows are indistinguishable from native thoughts.
    pass


class Migration(migrations.Migration):
    dependencies = [("website", "0020_thought_image")]
    operations = [migrations.RunPython(migrate_drawings, noop)]
```

- [ ] **Step 2: Write the migration test**

Create `website/tests/test_migrate_drawings.py`:

```python
import pytest
from django.utils import timezone

from website.models import Thought


@pytest.mark.django_db
def test_drawing_data_migration_logic():
    """The same create+update logic the data migration uses preserves caption,
    image path, publish flag, and timestamp."""
    ts = timezone.now() - timezone.timedelta(days=30)
    t = Thought.objects.create(content="my caption", is_published=False)
    Thought.objects.filter(pk=t.pk).update(image="drawings/2025/01/x.jpg", created_at=ts)

    t.refresh_from_db()
    assert t.content == "my caption"
    assert t.image.name == "drawings/2025/01/x.jpg"
    assert t.is_published is False
    assert abs((t.created_at - ts).total_seconds()) < 1
```

- [ ] **Step 3: Run the test**

Run: `uv run pytest website/tests/test_migrate_drawings.py -v`
Expected: PASS.

- [ ] **Step 4: Apply the migration**

Run: `uv run python manage.py migrate website`
Expected: `Applying website.0021_migrate_drawings_to_thoughts... OK`.

- [ ] **Step 5: Commit**

```bash
git add website/migrations/0021_migrate_drawings_to_thoughts.py website/tests/test_migrate_drawings.py
git commit -m "feat: migrate existing drawings into thoughts"
```

---

## Task 3: Retire the Drawing model, views, routes, and tests

**Files:**
- Delete: `website/models/drawing.py`, `website/views/drawing.py`, `website/tests/test_drawing.py`
- Modify: `website/models/__init__.py`, `website/views/__init__.py`, `website/urls.py`
- Create: `website/migrations/0022_delete_drawing.py`

- [ ] **Step 1: Remove model export**

In `website/models/__init__.py`, delete the line `from .drawing import Drawing` and remove `"Drawing",` from `__all__`.

- [ ] **Step 2: Remove view exports**

In `website/views/__init__.py`, delete the line `from .drawing import drawing_delete, drawing_list, drawing_upload` and remove `"drawing_delete"`, `"drawing_list"`, `"drawing_upload"` from `__all__`.

- [ ] **Step 3: Remove routes**

In `website/urls.py`, delete these three lines:

```python
    path("drawings/", views.drawing_list),
    path("drawings/upload/", views.drawing_upload),
    path("drawings/<int:drawing_id>/delete/", views.drawing_delete),
```

- [ ] **Step 4: Delete files**

```bash
git rm website/models/drawing.py website/views/drawing.py website/tests/test_drawing.py
```

- [ ] **Step 5: Generate the delete migration**

Run: `uv run python manage.py makemigrations website --name delete_drawing`
Expected: creates `website/migrations/0022_delete_drawing.py` with `DeleteModel(name="Drawing")` and dependency on `0021`.

- [ ] **Step 6: Apply and verify the app boots**

Run: `uv run python manage.py migrate website && uv run python manage.py check`
Expected: migrate `OK`, check reports no issues.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: remove Drawing model, views, routes, and tests"
```

---

## Task 4: Multipart create endpoint, image processing, list image, delete view

**Files:**
- Modify: `website/views/thought.py`
- Modify: `website/views/__init__.py`, `website/urls.py`
- Modify: `website/tests/test_thought.py`

- [ ] **Step 1: Rewrite the thought view**

Replace the entire contents of `website/views/thought.py` with:

```python
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
```

- [ ] **Step 2: Export and route the delete view**

In `website/views/__init__.py`, change the thought import line to:

```python
from .thought import thought_create, thought_delete, thought_list
```

and add `"thought_delete",` to `__all__` (next to the other thought entries).

In `website/urls.py`, add below the `thoughts/create/` line:

```python
    path("thoughts/<int:thought_id>/delete/", views.thought_delete),
```

- [ ] **Step 3: Rewrite the create/list tests for multipart + image + delete**

Replace the entire contents of `website/tests/test_thought.py` with:

```python
import io
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image as PILImage

from website.models import Thought


@pytest.fixture(autouse=True)
def _clear_seeded_thoughts():
    Thought.objects.all().delete()


def _png(size=(10, 10)):
    buf = io.BytesIO()
    PILImage.new("RGB", size, (200, 30, 60)).save(buf, "PNG")
    return SimpleUploadedFile("x.png", buf.getvalue(), content_type="image/png")


@pytest.mark.django_db
class TestThoughtList:
    def test_empty_list(self, client):
        resp = client.get("/api/thoughts/")
        assert resp.status_code == 200
        assert resp.json()["thoughts"] == []

    def test_returns_published_only(self, client):
        Thought.objects.create(content="visible", is_published=True)
        Thought.objects.create(content="hidden", is_published=False)
        data = client.get("/api/thoughts/").json()
        assert len(data["thoughts"]) == 1
        assert data["thoughts"][0]["content"] == "visible"
        assert data["thoughts"][0]["image"] is None

    def test_includes_image_url(self, client):
        Thought.objects.create(content="", image=_png())
        item = client.get("/api/thoughts/").json()["thoughts"][0]
        assert item["image"] is not None
        assert item["image"].endswith(".png")

    def test_pagination(self, client):
        for i in range(15):
            Thought.objects.create(content=f"thought {i}")
        data = client.get("/api/thoughts/?page=1").json()
        assert len(data["thoughts"]) == 10
        assert data["has_next"] is True


@pytest.mark.django_db
class TestThoughtCreate:
    def test_requires_auth(self, client):
        resp = client.post("/api/thoughts/create/", {"content": "hello"})
        assert resp.status_code == 401

    def test_create_text_only(self, client, auth_headers):
        resp = client.post("/api/thoughts/create/", {"content": "A new thought"}, **auth_headers)
        assert resp.status_code == 201
        assert resp.json()["image"] is None
        assert Thought.objects.count() == 1

    def test_create_image_only(self, client, auth_headers):
        resp = client.post("/api/thoughts/create/", {"image": _png()}, **auth_headers)
        assert resp.status_code == 201
        assert resp.json()["image"] is not None
        assert Thought.objects.get().content == ""

    def test_create_text_and_image(self, client, auth_headers):
        resp = client.post("/api/thoughts/create/", {"content": "look", "image": _png()}, **auth_headers)
        assert resp.status_code == 201
        body = resp.json()
        assert body["content"] == "look"
        assert body["image"] is not None

    def test_empty_post_rejected(self, client, auth_headers):
        resp = client.post("/api/thoughts/create/", {"content": "   "}, **auth_headers)
        assert resp.status_code == 400

    def test_too_long(self, client, auth_headers):
        resp = client.post("/api/thoughts/create/", {"content": "x" * 2001}, **auth_headers)
        assert resp.status_code == 400

    def test_bad_image_rejected(self, client, auth_headers):
        bad = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
        resp = client.post("/api/thoughts/create/", {"image": bad}, **auth_headers)
        assert resp.status_code == 400

    def test_cooldown_enforced(self, client, auth_headers):
        Thought.objects.create(content="recent", created_at=timezone.now())
        resp = client.post("/api/thoughts/create/", {"content": "too soon"}, **auth_headers)
        assert resp.status_code == 429

    def test_cooldown_expired(self, client, auth_headers):
        t = Thought.objects.create(content="old")
        Thought.objects.filter(pk=t.pk).update(created_at=timezone.now() - timedelta(hours=19))
        resp = client.post("/api/thoughts/create/", {"content": "after cooldown"}, **auth_headers)
        assert resp.status_code == 201


@pytest.mark.django_db
class TestThoughtDelete:
    def test_requires_auth(self, client):
        t = Thought.objects.create(content="x")
        resp = client.post(f"/api/thoughts/{t.id}/delete/")
        assert resp.status_code == 401

    def test_delete_removes_row(self, client, auth_headers):
        t = Thought.objects.create(content="bye", image=_png())
        resp = client.post(f"/api/thoughts/{t.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        assert Thought.objects.count() == 0

    def test_delete_missing(self, client, auth_headers):
        resp = client.post("/api/thoughts/9999/delete/", **auth_headers)
        assert resp.status_code == 404
```

- [ ] **Step 4: Run the backend tests**

Run: `uv run pytest website/tests/test_thought.py -v`
Expected: all PASS.

- [ ] **Step 5: Run the full backend suite + lint**

Run: `uv run pytest && uvx ruff check website/`
Expected: green; no lint errors in changed files.

- [ ] **Step 6: Commit**

```bash
git add website/views/thought.py website/views/__init__.py website/urls.py website/tests/test_thought.py
git commit -m "feat: thoughts create accepts multipart image, add delete endpoint"
```

---

## Task 5: Frontend API types + draft/image helpers

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/thoughtDraft.ts`
- Create: `frontend/src/lib/__tests__/thoughtDraft.test.ts`

- [ ] **Step 1: Update API types**

In `frontend/src/lib/api.ts`, replace the `Thought` interface and delete the `Drawing` interface:

```typescript
export interface Thought {
  id: number;
  content: string;
  image: string | null;
  created_at: string;
}
```

(Delete the entire `export interface Drawing { ... }` block.)

- [ ] **Step 2: Write the failing helper test**

Create `frontend/src/lib/__tests__/thoughtDraft.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";

import { type Thought } from "../api";
import { withImages } from "../thoughtDraft";

const mk = (id: number, image: string | null): Thought => ({
  id,
  content: "",
  image,
  created_at: "2026-01-01T00:00:00Z",
});

describe("withImages", () => {
  it("keeps only posts that have an image, preserving order", () => {
    const all = [mk(1, "/a.png"), mk(2, null), mk(3, "/c.png")];
    expect(withImages(all).map((t) => t.id)).toEqual([1, 3]);
  });

  it("returns empty when nothing has an image", () => {
    expect(withImages([mk(1, null)])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd frontend && pnpm test thoughtDraft`
Expected: FAIL — cannot find module `../thoughtDraft`.

- [ ] **Step 4: Implement the helpers**

Create `frontend/src/lib/thoughtDraft.ts`:

```typescript
import { type Thought } from "./api";
import { store, storeDel } from "./auth";

const DRAFT_KEY = "thoughtDraft";

/** Persist the in-progress compose text (text only — images are not persisted). */
export function saveDraft(text: string): void {
  if (text.trim()) store(DRAFT_KEY, text);
  else storeDel(DRAFT_KEY);
}

export function loadDraft(): string {
  return store(DRAFT_KEY) ?? "";
}

export function clearDraft(): void {
  storeDel(DRAFT_KEY);
}

/** Posts that carry an image, in feed order — the set the lightbox navigates. */
export function withImages(thoughts: Thought[]): Thought[] {
  return thoughts.filter((t) => t.image);
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd frontend && pnpm test thoughtDraft`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/thoughtDraft.ts frontend/src/lib/__tests__/thoughtDraft.test.ts
git commit -m "feat: thought image type + draft/withImages helpers"
```

---

## Task 6: Rewrite the thinks page — feed with images, lightbox, compose card

**Files:**
- Modify: `frontend/src/app/thinks/page.tsx` (full rewrite)

This task is large; implement it as one rewrite, then verify in the browser.

- [ ] **Step 1: Replace the page with the merged feed**

Overwrite `frontend/src/app/thinks/page.tsx` with the following. It keeps the trunk/scroll-to-top/tagline structure, swaps `ComposeSprite` for `ComposeCard` (image attach + draft), renders optional image per entry, and adds a red-themed `Lightbox` ported from the old draws page.

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type Thought, API } from "@/lib/api";
import { store, storeDel, getAdminToken } from "@/lib/auth";
import { formatDate } from "@/lib/date";
import { clearDraft, loadDraft, saveDraft, withImages } from "@/lib/thoughtDraft";

const COOLDOWN_MS = 18 * 60 * 60 * 1000; // 18h

const FALLBACK: Thought[] = [
  {
    id: 0,
    content: "This is my public diary. Certified 100% human generated.",
    image: null,
    created_at: "2026-03-28T00:00:00Z",
  },
];

/* Trunk geometry */
const TRUNK = "1.25rem";
const NODE_SIZE = 10;
const HALF_NODE = NODE_SIZE / 2;

/* ── Compose card ───────────────────────────────────── */
function ComposeCard({ onPost }: { onPost: (t: Thought) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Restore a saved draft on mount; auto-open if there is one.
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setText(draft);
      setOpen(true);
    }
  }, []);

  // Persist text as a draft whenever it changes.
  useEffect(() => {
    saveDraft(text);
  }, [text]);

  // Revoke object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function attach(f: File | undefined | null) {
    if (!f || !f.type.startsWith("image/")) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function removeImage() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function isCoolingDown() {
    const last = store("lastThoughtTime");
    if (!last) return false;
    return Date.now() - Number(last) < COOLDOWN_MS;
  }

  function handleOpen() {
    if (isCoolingDown()) {
      setError("Chill. Too much thinking for today.");
      setTimeout(() => setError(""), 3000);
      return;
    }
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 120);
  }

  function onPaste(e: React.ClipboardEvent) {
    const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      attach(img);
    }
  }

  async function handleSubmit() {
    const content = text.trim();
    if ((!content && !file) || posting) return;

    const token = getAdminToken();
    if (!token) return; // redirected to /sudo — draft text already persisted

    setPosting(true);
    setError("");
    try {
      const form = new FormData();
      if (content) form.append("content", content);
      if (file) form.append("image", file);
      const res = await fetch(`${API}/api/thoughts/create/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (res.status === 401) {
        storeDel("adminToken");
        setError("Bad token — cleared, try again");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed");
        return;
      }
      const thought: Thought = await res.json();
      store("lastThoughtTime", String(Date.now()));
      onPost(thought);
      setText("");
      clearDraft();
      removeImage();
      setOpen(false);
    } catch {
      setError("Network error");
    } finally {
      setPosting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") setOpen(false); // text/image stay cached
  }

  const canPost = (text.trim() || file) && !posting;

  if (!open) {
    return (
      <div ref={wrapperRef} style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.5rem" }}>
        {error && (
          <span style={{ fontSize: "0.7rem", color: "var(--accent)", fontFamily: "var(--font-headline)", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
            {error}
          </span>
        )}
        <button
          onClick={handleOpen}
          aria-label="New post"
          title={isCoolingDown() ? "Chill. Too much thinking for today." : text || file ? "Continue editing..." : "New post"}
          style={{
            width: "2rem",
            height: "2rem",
            background: "#1a1a1a",
            border: `1px solid ${text || file ? "color-mix(in srgb, var(--accent) 50%, #2a2a2a)" : "#2a2a2a"}`,
            borderRadius: "50%",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "3px",
            padding: 0,
            transition: "border-color 0.2s, box-shadow 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.boxShadow = "0 0 8px color-mix(in srgb, var(--accent) 30%, transparent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = text || file ? "color-mix(in srgb, var(--accent) 50%, #2a2a2a)" : "#2a2a2a";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--accent)", opacity: text || file ? 1 : 0.7, animation: text || file ? "none" : `pulse 1.4s ${i * 0.2}s ease-in-out infinite` }} />
          ))}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        attach(e.dataTransfer.files?.[0]);
      }}
      style={{
        width: "100%",
        maxWidth: "32rem",
        marginLeft: "auto",
        background: "#1a1a1a",
        border: `1px solid ${dragOver ? "var(--accent)" : "color-mix(in srgb, var(--accent) 40%, #2a2a2a)"}`,
        borderRadius: "1rem",
        padding: "0.85rem",
        transition: "border-color 0.2s",
      }}
    >
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
        }}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        placeholder="what's on your mind..."
        rows={2}
        maxLength={2000}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          color: "#e5e2e1",
          fontSize: "0.9rem",
          fontFamily: "var(--font-body)",
          resize: "none",
          lineHeight: 1.5,
          maxHeight: "10rem",
          overflowY: "auto",
        }}
      />

      {preview && (
        <div style={{ position: "relative", width: "9rem", marginTop: "0.6rem" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="preview" style={{ width: "100%", borderRadius: "6px", display: "block" }} />
          <button
            onClick={removeImage}
            aria-label="Remove image"
            style={{ position: "absolute", top: "-0.5rem", right: "-0.5rem", width: "1.4rem", height: "1.4rem", borderRadius: "50%", background: "#0e0e0e", border: "1px solid #f87171", color: "#f87171", cursor: "pointer", fontSize: "0.7rem", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.75rem" }}>
        <button
          onClick={() => fileRef.current?.click()}
          aria-label="Attach image"
          title="Attach image"
          style={{ width: "1.9rem", height: "1.9rem", borderRadius: "50%", background: "none", border: "1px solid color-mix(in srgb, var(--accent) 45%, #2a2a2a)", color: "var(--accent)", cursor: "pointer", fontSize: "0.95rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
        >
          ▦
        </button>
        <span style={{ color: "#555", fontSize: "0.68rem" }}>drag, paste, or click to attach</span>
        {error && <span style={{ fontSize: "0.68rem", color: "var(--accent)", marginLeft: "0.25rem" }}>{error}</span>}
        <button
          onClick={handleSubmit}
          disabled={!canPost}
          aria-label="Post"
          style={{ marginLeft: "auto", background: "none", border: "none", color: canPost ? "var(--accent)" : "#333", cursor: canPost ? "pointer" : "default", fontFamily: "var(--font-headline)", fontWeight: 700, letterSpacing: "0.1em", fontSize: "0.8rem" }}
        >
          {posting ? "..." : "POST ↵"}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={(e) => attach(e.target.files?.[0])}
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", opacity: 0 }}
      />

      <style>{`
        @keyframes pulse { 0%,80%,100% { opacity:0.3; transform:scale(0.8);} 40% { opacity:1; transform:scale(1.2);} }
      `}</style>
    </div>
  );
}

/* ── Lightbox (ported from draws, red-themed) ───────── */
function Lightbox({
  images,
  index,
  onClose,
  onNav,
  onDelete,
}: {
  images: Thought[];
  index: number;
  onClose: () => void;
  onNav: (dir: -1 | 1) => void;
  onDelete: (id: number) => void;
}) {
  const t = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onNav(-1);
      if (e.key === "ArrowRight" && hasNext) onNav(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPrev, hasNext, onClose, onNav]);

  if (!t || !t.image) return null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", height: "2px", background: "linear-gradient(90deg, transparent, var(--accent), transparent)", position: "absolute", top: "8%" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", maxWidth: "90vw", maxHeight: "76vh", position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <div onClick={() => hasPrev && onNav(-1)} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "15%", cursor: hasPrev ? "w-resize" : "default", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {hasPrev && <span style={{ color: "var(--accent)", fontSize: "2rem", opacity: 0.6, userSelect: "none" }}>‹</span>}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${API}${t.image}`} alt={t.content || `Post ${t.id}`} style={{ maxWidth: "100%", maxHeight: "76vh", objectFit: "contain", borderRadius: "4px" }} />
        <div onClick={() => hasNext && onNav(1)} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "15%", cursor: hasNext ? "e-resize" : "default", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {hasNext && <span style={{ color: "var(--accent)", fontSize: "2rem", opacity: 0.6, userSelect: "none" }}>›</span>}
        </div>
      </div>
      {t.content && <p style={{ color: "#aaa", fontSize: "0.8rem", marginTop: "0.75rem", fontStyle: "italic", maxWidth: "42rem", textAlign: "center", padding: "0 1rem" }}>{t.content}</p>}
      {isAdmin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("Delete this post?")) onDelete(t.id);
          }}
          style={{ marginTop: "0.75rem", background: "none", border: "1px solid #f8717140", borderRadius: "4px", color: "#f87171", fontSize: "0.75rem", padding: "0.25rem 0.75rem", cursor: "pointer" }}
        >
          delete
        </button>
      )}
      <div style={{ width: "100%", height: "2px", background: "linear-gradient(90deg, transparent, var(--accent), transparent)", position: "absolute", bottom: "8%" }} />
    </div>
  );
}

/* ── Main page ──────────────────────────────────────── */
export default function ThinksPage() {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [newestId, setNewestId] = useState<number | null>(null);
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const images = withImages(thoughts);
  const lightboxIdx = lightboxId === null ? -1 : images.findIndex((t) => t.id === lightboxId);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/thoughts/?page=${p}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setThoughts((prev) => (p === 1 ? data.thoughts : [...prev, ...data.thoughts]));
      setHasNext(data.has_next);
      setPage(data.page);
    } catch {
      if (p === 1) setThoughts(FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleNewThought(thought: Thought) {
    setNewestId(thought.id);
    setThoughts((prev) => [thought, ...prev]);
    setTimeout(() => setNewestId(null), 500);
  }

  function loadMore() {
    if (!loading && hasNext) fetchPage(page + 1);
  }

  function scrollToTop() {
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function navLightbox(dir: -1 | 1) {
    const next = lightboxIdx + dir;
    if (next >= 0 && next < images.length) setLightboxId(images[next].id);
  }

  async function handleDelete(id: number) {
    const token = getAdminToken();
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/thoughts/${id}/delete/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setThoughts((prev) => prev.filter((t) => t.id !== id));
        setLightboxId(null);
      } else {
        alert("Failed to delete");
      }
    } catch {
      alert("Failed to delete — check your connection");
    }
  }

  return (
    <>
      <title>Nam thinks</title>

      {lightboxIdx >= 0 && <Lightbox images={images} index={lightboxIdx} onClose={() => setLightboxId(null)} onNav={navLightbox} onDelete={handleDelete} />}

      <div ref={topRef} style={{ maxWidth: "64rem", margin: "0 auto", padding: "2rem 1.5rem 6rem", position: "relative", minHeight: "100vh" }}>
        <div style={{ position: "relative", paddingLeft: "3rem" }}>
          {/* Trunk line */}
          <div style={{ position: "absolute", left: TRUNK, top: 0, bottom: 0, width: "1px", background: "linear-gradient(to bottom, #2a2a2a, color-mix(in srgb, var(--accent) 40%, #2a2a2a), #2a2a2a)", boxShadow: "0 0 8px color-mix(in srgb, var(--accent) 20%, transparent)" }} />

          {/* Compose area */}
          <div style={{ position: "relative", marginBottom: "3rem" }}>
            <div style={{ position: "absolute", left: `calc(-3rem + ${TRUNK} - ${HALF_NODE}px)`, top: "0.65rem", width: `${NODE_SIZE}px`, height: `${NODE_SIZE}px`, borderRadius: "50%", background: "#2a2a2a", border: "1.5px solid var(--accent)", zIndex: 2 }} />
            <ComposeCard onPost={handleNewThought} />
            <div style={{ display: "flex", alignItems: "flex-start", marginTop: "0.35rem" }}>
              <div style={{ flexGrow: 1, height: "1px", background: "#2a2a2a" }} />
              <div style={{ width: "1px", height: "8px", background: "#2a2a2a" }} />
            </div>
          </div>

          {/* Sticky scroll-to-top */}
          <div style={{ position: "sticky", top: "4.25rem", zIndex: 10, height: 0, opacity: showScrollTop ? 1 : 0, transition: "opacity 0.3s", pointerEvents: showScrollTop ? "auto" : "none" }}>
            <button
              onClick={scrollToTop}
              aria-label="Scroll to top"
              style={{ position: "absolute", left: `calc(-3rem + ${TRUNK} - 0.6rem)`, top: "-0.6rem", width: "1.2rem", height: "1.2rem", background: "#0e0e0e", border: "1.5px solid var(--accent)", borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, color: "var(--accent)", fontSize: "0.55rem", lineHeight: 1, transition: "background 0.2s, box-shadow 0.2s, transform 0.2s" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--accent)";
                e.currentTarget.style.boxShadow = "0 0 12px var(--accent)";
                e.currentTarget.style.color = "#0e0e0e";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#0e0e0e";
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.color = "var(--accent)";
              }}
            >
              ▲
            </button>
          </div>

          {/* Entries */}
          {thoughts.map((thought) => (
            <div key={thought.id} className={thought.id === newestId ? "thought-new" : ""} style={{ position: "relative", marginBottom: "3rem" }}>
              <div style={{ position: "absolute", left: `calc(-3rem + ${TRUNK} - ${HALF_NODE}px)`, top: "0.1rem", width: `${NODE_SIZE}px`, height: `${NODE_SIZE}px`, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)", zIndex: 2 }} />

              {thought.content && (
                <p style={{ fontSize: "1rem", lineHeight: 1.7, color: "#e5e2e1", fontWeight: 300 }}>{thought.content}</p>
              )}

              {thought.image && (
                <div style={{ display: "flex", justifyContent: "center", marginTop: thought.content ? "0.7rem" : 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${API}${thought.image}`}
                    alt={thought.content || `Post ${thought.id}`}
                    loading="lazy"
                    onClick={() => setLightboxId(thought.id)}
                    style={{ maxWidth: "100%", height: "auto", borderRadius: "6px", cursor: "pointer", display: "block" }}
                  />
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.4rem" }}>
                <span style={{ fontFamily: "var(--font-headline)", fontSize: "0.65rem", color: "#555", letterSpacing: "0.15em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  {formatDate(thought.created_at)}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "flex-start", marginTop: "0.35rem" }}>
                <div style={{ flexGrow: 1, height: "1px", background: "#2a2a2a" }} />
                <div style={{ width: "1px", height: "8px", background: "#2a2a2a" }} />
              </div>
            </div>
          ))}

          {/* Load more */}
          {hasNext && (
            <button onClick={loadMore} disabled={loading} aria-label="Load more" style={{ position: "absolute", left: `calc(${TRUNK} - 3px)`, background: "none", border: "none", cursor: loading ? "wait" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem", padding: "0.5rem 0.75rem", zIndex: 2 }}>
              {[1, 0.6, 0.3].map((opacity, i) => (
                <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 8px var(--accent)", opacity }} />
              ))}
            </button>
          )}
        </div>

        <div style={{ textAlign: "right", marginTop: "4rem", paddingRight: "0.5rem" }}>
          <span style={{ fontStyle: "italic", color: "#555", fontSize: "0.85rem", letterSpacing: "0.02em" }}>sometimes, some of my neurons fire</span>
        </div>
      </div>

      <style>{`
        @keyframes thoughtSlideIn { from { opacity:0; transform:translateY(-1rem);} to { opacity:1; transform:translateY(0);} }
        .thought-new { animation: thoughtSlideIn 0.4s ease-out; }
      `}</style>
    </>
  );
}
```

- [ ] **Step 2: Lint + typecheck the frontend**

Run: `cd frontend && pnpm lint`
Expected: no errors. Fix any reported issues in the file.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/thinks/page.tsx
git commit -m "feat: merged thinks feed with image posts, compose card, lightbox"
```

---

## Task 7: Remove draws page, nav entry, accent map; brighten bg; redirect

**Files:**
- Delete: `frontend/src/app/draws/page.tsx`
- Modify: `frontend/src/lib/navWheel.ts`, `frontend/src/app/layout.tsx`, `frontend/src/components/PageBackground.tsx`, `frontend/next.config.ts`

- [ ] **Step 1: Remove the draws nav entry**

In `frontend/src/lib/navWheel.ts`, delete this line from `NAV_ITEMS`:

```typescript
  { label: "draws", href: "/draws", accent: "#a855f7" },
```

- [ ] **Step 2: Remove draws from the accent map**

In `frontend/src/app/layout.tsx`, in the inline `<script>`, delete the `"/draws":"#a855f7",` entry from the `m` map object.

- [ ] **Step 3: Remove draws bg and brighten thinks bg**

In `frontend/src/components/PageBackground.tsx`:
- Delete the `"/draws": "/images/bg/draws.jpg",` line from `BG_MAP`.
- Brighten the thinks background by applying a filter only when the path is `/thinks`. Change the returned `<div>`'s `style` to include a `filter`:

```tsx
  const isThinks = pathname === "/thinks" || pathname.split("/")[1] === "thinks";
  // ... inside the returned div style object, add:
        filter: isThinks ? "brightness(1.4)" : undefined,
```

Place the `isThinks` const next to the existing `bg` computation, and add the `filter` property to the style object of the returned background `<div>`.

- [ ] **Step 4: Add the redirect**

In `frontend/next.config.ts`, add an async `redirects()` to the exported config (merge with existing config object if one is present):

```typescript
  async redirects() {
    return [{ source: "/draws", destination: "/thinks", permanent: true }];
  },
```

- [ ] **Step 5: Delete the draws page**

```bash
git rm frontend/src/app/draws/page.tsx
```

- [ ] **Step 6: Lint**

Run: `cd frontend && pnpm lint`
Expected: no errors (no remaining imports of the deleted `Drawing` type or draws page).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: drop draws page/nav/bg, brighten thinks bg, redirect /draws"
```

---

## Task 8: Visual verification (Playwright)

**Files:** none (manual verification per CLAUDE.md workflow).

- [ ] **Step 1: Start dev servers**

Run (from repo root): `make dev` (or `docker compose up -d` then `uv run python manage.py runserver` and `cd frontend && pnpm dev`).

- [ ] **Step 2: Seed a mix of posts**

Log in at `/sudo`, then on `/thinks` create: a text-only post, an image-only post (small image to confirm it stays natural size and centered), and a text+image post. If the cooldown blocks rapid posting, temporarily insert rows via `uv run python manage.py shell`.

- [ ] **Step 3: Screenshot and verify with Playwright**

Use the Playwright MCP to navigate to `http://localhost:3001/thinks` and capture a screenshot. Verify:
- Text full-width; small image centered at natural size; large image fills column.
- Trunk, nodes, dates, brightened background present.
- Clicking an image opens the lightbox; ←/→ moves only between image posts; esc closes.
- Navigating to `/draws` redirects to `/thinks`; draws is gone from the nav wheel.

- [ ] **Step 4: Verify draft survival**

In a logged-out browser (clear `adminToken` in localStorage), type text in the compose card and click POST → redirected to `/sudo`. Log in, return to `/thinks`, confirm the typed text is restored in the compose card.

- [ ] **Step 5: Commit any fixes** found during verification with a descriptive message.

---

## Task 9: Update documentation

**Files:**
- Modify: `docs/README.md`, `docs/QA-CHECKLIST.md`, `CLAUDE.md`

- [ ] **Step 1: README**

In `docs/README.md`, merge the thinks and draws sections into one describing the unified `/thinks` feed (text and/or image posts, single-column timeline, lightbox). Remove the standalone draws section.

- [ ] **Step 2: QA checklist**

In `docs/QA-CHECKLIST.md`, replace draws-specific items with: posting text-only / image-only / text+image; image centered & natural size; lightbox open/nav/close/delete; `/draws` redirect; draft restored after login.

- [ ] **Step 3: CLAUDE.md API list**

In `CLAUDE.md`, under API Endpoints: remove the three `/api/drawings/*` lines; update the thoughts block to:

```
POST /api/thoughts/create/      auth required, multipart: optional content + optional image
POST /api/thoughts/<id>/delete/ auth required
```

- [ ] **Step 4: Commit**

```bash
git add docs/README.md docs/QA-CHECKLIST.md CLAUDE.md
git commit -m "docs: update for merged thinks feed"
```

---

## Final verification

- [ ] Backend: `uv run pytest` — all green.
- [ ] Backend lint: `uvx ruff check . && uvx ruff format --check .`
- [ ] Frontend: `cd frontend && pnpm test && pnpm lint && pnpm build` — all green.
- [ ] No remaining references to `Drawing`, `drawing_*`, or `/api/drawings/` (grep: `grep -rn "rawing\|/draws" website frontend/src --include=*.py --include=*.ts --include=*.tsx`, expecting only the redirect and migrations).
