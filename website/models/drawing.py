from django.db import models


class Drawing(models.Model):
    CATEGORY_CHOICES = [
        ("pencil", "Pencil"),
        ("camera", "Camera"),
    ]

    image = models.ImageField(upload_to="drawings/%Y/%m/")
    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES)
    caption = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    is_published = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.category}: {self.caption or self.image.name}"
