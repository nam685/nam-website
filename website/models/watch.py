from django.db import models


class WatchChannel(models.Model):
    """A YouTube channel the admin watches."""

    class Tier(models.TextChoices):
        HIDDEN = "hidden", "Hidden"
        NEVER_MISS = "never_miss", "Never Miss"
        REGULAR = "regular", "Regular Rotation"
        CHECK_OUT = "check_out", "Worth Checking Out"

    TIER_WEIGHT = {"never_miss": 0, "regular": 1, "check_out": 2, "hidden": 3}

    youtube_channel_id = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    thumbnail_url = models.URLField(max_length=1000, blank=True, default="")
    tier = models.CharField(max_length=16, choices=Tier.choices, default=Tier.HIDDEN)
    display_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["display_order", "name"]

    def __str__(self):
        return self.name

    @property
    def tier_weight(self):
        return self.TIER_WEIGHT.get(self.tier, 3)


class WatchVideo(models.Model):
    """A YouTube video (from liked videos) that can be pinned to a channel."""

    youtube_video_id = models.CharField(max_length=64, unique=True)
    channel = models.ForeignKey(WatchChannel, on_delete=models.SET_NULL, null=True, blank=True, related_name="videos")
    title = models.CharField(max_length=300)
    thumbnail_url = models.URLField(max_length=1000, blank=True, default="")
    note = models.CharField(max_length=200, blank=True, default="")
    pinned = models.BooleanField(default=False)
    visible = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title
