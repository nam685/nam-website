from django.db import models


class LastfmCache(models.Model):
    """Cached Last.fm API responses so repeated graph builds don't re-hit the API."""

    cache_key = models.CharField(max_length=600, unique=True)
    payload = models.JSONField(default=list)
    # auto_now (not auto_now_add): entries are refreshed via update_or_create, and TTL is
    # measured from the LAST fetch, so this must advance whenever the payload is rewritten.
    fetched_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.cache_key
