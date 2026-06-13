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
