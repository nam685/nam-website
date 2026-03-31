from django.db import models


class Feedback(models.Model):
    message = models.TextField()
    ip_address = models.GenericIPAddressField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["ip_address", "-created_at"], name="feedback_ip_created_idx"),
        ]

    def __str__(self):
        return self.message[:80]
