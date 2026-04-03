import io

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from PIL import Image as PILImage

from website.models import Drawing
from website.views.drawing import _normalize_image


class Command(BaseCommand):
    help = "Normalize existing drawing images: crop extreme aspect ratios to [0.8, 1.2], pad to square."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Show what would change without modifying files")

    def handle(self, **options):
        dry_run = options["dry_run"]
        drawings = Drawing.objects.all()
        modified = 0

        for d in drawings:
            try:
                img = PILImage.open(d.image)
            except Exception as e:
                self.stderr.write(f"  Skipping #{d.id}: cannot open — {e}")
                continue

            w, h = img.size
            ratio = w / h
            needs_crop = ratio < 0.8 or ratio > 1.2
            needs_pad = w != h

            if not needs_crop and not needs_pad:
                continue

            if dry_run:
                self.stdout.write(f"  #{d.id}: {w}x{h} (ratio={ratio:.2f}) — would normalize")
                modified += 1
                continue

            fmt = img.format or "PNG"
            normalized = _normalize_image(img)
            buf = io.BytesIO()
            save_fmt = fmt if fmt != "BMP" else "PNG"
            normalized.save(buf, format=save_fmt)

            old_name = d.image.name
            d.image.delete(save=False)
            d.image.save(old_name, ContentFile(buf.getvalue()), save=True)
            self.stdout.write(f"  #{d.id}: {w}x{h} -> {normalized.size[0]}x{normalized.size[1]}")
            modified += 1

        prefix = "[DRY RUN] " if dry_run else ""
        self.stdout.write(f"\n{prefix}Normalized {modified}/{drawings.count()} drawings.")
