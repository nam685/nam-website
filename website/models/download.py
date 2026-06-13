from django.db import models

from .session import Turn


class Download(models.Model):
    turn = models.ForeignKey(Turn, on_delete=models.CASCADE, related_name="downloads")
    filename = models.CharField(max_length=255)
    size = models.PositiveIntegerField()
    oversize = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["turn", "id"], name="download_turn_idx"),
        ]

    def __str__(self):
        return f"{self.filename} ({self.size}B)"
