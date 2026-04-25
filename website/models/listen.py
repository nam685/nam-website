from django.db import models


class ListenTrack(models.Model):
    """A single track play recorded from YouTube Music history."""

    video_id = models.CharField(max_length=64)
    title = models.CharField(max_length=500)
    artist = models.CharField(max_length=500)
    album = models.CharField(max_length=500, blank=True, default="")
    thumbnail_url = models.URLField(max_length=1000, blank=True, default="")
    duration = models.CharField(max_length=16, blank=True, default="")
    played_at = models.DateTimeField()
    is_liked = models.BooleanField(default=False)

    class Meta:
        ordering = ["-played_at"]
        indexes = [models.Index(fields=["-played_at"])]

    def __str__(self):
        return f"{self.artist} — {self.title}"
