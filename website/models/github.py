from django.db import models


class GitHubContributions(models.Model):
    data = models.JSONField(help_text="Contribution calendar JSON from GitHub GraphQL API")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "GitHub contributions"

    def __str__(self):
        total = self.data.get("totalContributions", "?") if self.data else "empty"
        return f"Contributions ({total}) — updated {self.updated_at}"
