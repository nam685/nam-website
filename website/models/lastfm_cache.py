from django.db import models


class LastfmCache(models.Model):
    """Cached Last.fm API responses so repeated graph builds don't re-hit the API."""

    cache_key = models.CharField(max_length=600, unique=True)
    payload = models.JSONField(default=list)
    # Records when the payload was last written (auto_now advances on each refresh).
    # Operational metadata / future TTL hook; the cache currently has no expiry.
    fetched_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.cache_key
