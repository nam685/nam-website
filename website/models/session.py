from django.db import models


class Session(models.Model):
    workspace = models.CharField(max_length=255, blank=True, default="")
    trace_path = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=20, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="session_status_created_idx"),
        ]

    def __str__(self):
        first_turn = self.turns.first()
        if first_turn:
            prompt = first_turn.prompt
            return prompt[:80] + ("..." if len(prompt) > 80 else "")
        return "(empty session)"


class Turn(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("running", "Running"),
        ("done", "Done"),
        ("failed", "Failed"),
    ]

    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="turns")
    prompt = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    submitter_ip = models.GenericIPAddressField()

    # timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    # execution results
    token_count = models.IntegerField(default=0)
    tool_calls = models.IntegerField(default=0)
    summary = models.TextField(blank=True, default="")
    error = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["session", "status"], name="turn_session_status_idx"),
            models.Index(fields=["submitter_ip", "-created_at"], name="turn_ip_created_idx"),
        ]

    def __str__(self):
        return self.prompt[:80] + ("..." if len(self.prompt) > 80 else "")
