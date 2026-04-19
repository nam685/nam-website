from django.db import models


class Attachment(models.Model):
    turn = models.ForeignKey("Turn", on_delete=models.CASCADE, related_name="attachments")
    filename = models.CharField(max_length=255)
    size = models.PositiveIntegerField()
    content_type = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.filename} ({self.size} B)"
