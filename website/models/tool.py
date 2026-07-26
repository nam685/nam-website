from django.db import models


class TrackedTool(models.Model):
    STATUS_CHOICES = [
        ("watching", "Watching"),
        ("adopted", "Adopted"),
        ("dropped", "Dropped"),
    ]

    name = models.CharField(max_length=255)
    url = models.URLField(max_length=500)
    description = models.TextField(blank=True, default="")
    category = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="watching")
    is_new = models.BooleanField(default=True)
    source = models.CharField(max_length=100, default="manual")
    source_key = models.CharField(max_length=255, unique=True)
    notes = models.TextField(blank=True, default="")
    stars = models.IntegerField(null=True, blank=True)
    added_at = models.DateTimeField(auto_now_add=True)
    last_reviewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-added_at"]
        indexes = [
            models.Index(fields=["status", "-added_at"], name="tool_status_added_idx"),
        ]

    def __str__(self):
        return self.name
