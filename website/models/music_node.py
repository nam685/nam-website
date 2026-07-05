from django.db import models


class MusicNode(models.Model):
    """A node in the listening graph: a track, artist, or album.

    Derived cache rebuilt from ListenTrack + YTM personalization on each sync.
    """

    class NodeType(models.TextChoices):
        ARTIST = "artist"
        ALBUM = "album"
        TRACK = "track"
        TAG = "tag"  # Last.fm genre/mood — the multipartite connective layer

    node_type = models.CharField(max_length=8, choices=NodeType.choices)
    key = models.CharField(max_length=600)  # video_id | artist_lower | "artist::album"
    title = models.CharField(max_length=500)
    subtitle = models.CharField(max_length=500, blank=True, default="")
    thumbnail_url = models.URLField(max_length=1000, blank=True, default="")
    video_id = models.CharField(max_length=64, blank=True, default="")
    play_count = models.IntegerField(default=0)
    last_played = models.DateTimeField(null=True, blank=True)
    is_liked = models.BooleanField(default=False)
    is_subscribed = models.BooleanField(default=False)
    in_library = models.BooleanField(default=False)
    recommend_score = models.FloatField(default=0.0)
    degree = models.PositiveIntegerField(default=0)  # incident-edge count; set during graph rebuild

    class Meta:
        unique_together = [("node_type", "key")]
        indexes = [
            models.Index(fields=["node_type"]),
            models.Index(fields=["-recommend_score"]),
        ]

    def __str__(self):
        return f"{self.node_type}:{self.title}"
