from django.db import models


class Mission(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("running", "Running"),
        ("done", "Done"),
        ("failed", "Failed"),
    ]

    prompt = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    submitter_ip = models.GenericIPAddressField()
    workspace = models.CharField(max_length=255, blank=True, default="")

    # trace metadata
    trace_path = models.CharField(max_length=255, blank=True, default="")
    token_count = models.IntegerField(default=0)
    tool_calls = models.IntegerField(default=0)

    # timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    # result
    summary = models.TextField(blank=True, default="")
    error = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="mission_status_created_idx"),
            models.Index(fields=["submitter_ip", "-created_at"], name="mission_ip_created_idx"),
        ]

    def __str__(self):
        return self.prompt[:80] + ("..." if len(self.prompt) > 80 else "")
