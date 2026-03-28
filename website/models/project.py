from django.contrib.postgres.fields import ArrayField
from django.db import models


class Project(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_WIP = "wip"
    STATUS_ARCHIVED = "archived"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_WIP, "WIP"),
        (STATUS_ARCHIVED, "Archived"),
    ]

    title = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    description = models.TextField()
    tags = ArrayField(models.CharField(max_length=50), default=list, blank=True)
    github_url = models.URLField(blank=True)
    live_url = models.URLField(blank=True)
    # Extra links: [{label: str, url: str}] — for things like /now, /uses, /changelog
    extra_links = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "-created_at"]

    def __str__(self):
        return self.title
