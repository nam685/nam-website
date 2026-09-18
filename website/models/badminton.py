import secrets

from django.db import models


class BadmintonPlayer(models.Model):
    """Someone whose swings get analysed. `slug` doubles as badminton-coach's player id ([a-z0-9-])."""

    class Hand(models.TextChoices):
        RIGHT = "right", "Right"
        LEFT = "left", "Left"

    slug = models.SlugField(max_length=40, unique=True)
    name = models.CharField(max_length=40)
    height_m = models.FloatField(null=True, blank=True)
    hand = models.CharField(max_length=5, choices=Hand.choices, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


def _new_upload_key():
    return secrets.token_hex(16)


class BadmintonSubmission(models.Model):
    """One uploaded practice video → (after admin approval + analysis on the GPU PC) one dated report.

    Lifecycle: uploading → pending (awaits admin) → approved (queued for the PC worker) → running →
    done | failed. Rejecting deletes the row. The raw video is private (only its capability URL, held by
    admin + worker, can fetch it) and is deleted once the report is in.
    """

    class Status(models.TextChoices):
        UPLOADING = "uploading", "Uploading"
        PENDING = "pending", "Awaiting approval"
        APPROVED = "approved", "Queued"
        RUNNING = "running", "Analysing"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"

    class Lang(models.TextChoices):
        EN = "en", "English"
        DE = "de", "Deutsch"
        VI = "vi", "Tiếng Việt"

    player = models.ForeignKey(BadmintonPlayer, on_delete=models.CASCADE, related_name="submissions")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UPLOADING)

    # What the uploader told us.
    recorded_on = models.DateField()
    height_m = models.FloatField(null=True, blank=True)
    hand = models.CharField(max_length=5, blank=True, default="")
    lang = models.CharField(max_length=2, choices=Lang.choices, default=Lang.EN)
    note = models.CharField(max_length=500, blank=True, default="")

    # Raw upload. Lives at MEDIA_ROOT/badminton/raw/<upload_key>/video<ext>; the unguessable key is the
    # only access control, so it is never exposed publicly.
    upload_key = models.CharField(max_length=32, unique=True, default=_new_upload_key)
    filename = models.CharField(max_length=200)
    size_bytes = models.BigIntegerField()
    received_bytes = models.BigIntegerField(default=0)
    submitter_ip = models.GenericIPAddressField(null=True, blank=True)

    # Worker progress (mirrors badminton-coach serve's job step/stage).
    step = models.CharField(max_length=20, blank=True, default="")
    stage = models.CharField(max_length=40, blank=True, default="")
    error = models.TextField(blank=True, default="")

    # The submission object from badminton-coach's report.json (schema_version 1), asset paths rewritten
    # to public /media URLs.
    report = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-recorded_on", "-created_at"]

    def __str__(self):
        return f"{self.player.slug} {self.recorded_on} ({self.status})"
