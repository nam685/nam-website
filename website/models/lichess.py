from django.db import models


class LichessToken(models.Model):
    """Stored Lichess OAuth token. Single-row table — only one admin account."""

    access_token = models.CharField(max_length=256)
    lichess_username = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"Lichess: {self.lichess_username}"
