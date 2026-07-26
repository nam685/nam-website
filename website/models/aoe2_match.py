from django.db import models


class Aoe2Match(models.Model):
    """A parsed AoE2 DE 1v1 recorded game. Opponent stored by civ only (no name)."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PARSING = "parsing", "Parsing"
        DONE = "done", "Done"
        ERROR = "error", "Error"
        SKIPPED = "skipped", "Skipped (not a 1v1)"

    rec_file = models.FileField(upload_to="aoe2/", null=True, blank=True)
    file_hash = models.CharField(max_length=64, unique=True)

    played_at = models.DateTimeField(null=True, blank=True)
    map_name = models.CharField(max_length=64, blank=True, default="")
    duration_seconds = models.IntegerField(default=0)
    game_version = models.CharField(max_length=32, blank=True, default="")

    my_civ = models.CharField(max_length=32, blank=True, default="")
    my_result = models.CharField(max_length=8, blank=True, default="unknown")
    my_elo = models.IntegerField(null=True, blank=True)
    my_rating_change = models.IntegerField(null=True, blank=True)

    opponent_civ = models.CharField(max_length=32, blank=True, default="")
    opponent_elo = models.IntegerField(null=True, blank=True)

    relic_match_id = models.BigIntegerField(null=True, blank=True)
    relic_enriched_at = models.DateTimeField(null=True, blank=True)

    timeline = models.JSONField(default=dict, blank=True)
    metrics = models.JSONField(default=dict, blank=True)

    # --- aoe2coach v2 rich data (sub-projects #1/#2/#3/#5/#6) ---
    # Full #1 Reconstruction dict (meta/ages/techs/production/counts/spatial/population/combat/
    # efficiency). The frontend viz prefers this when present and falls back to flat `metrics`.
    reconstruction = models.JSONField(default=dict, blank=True)
    # Strategic-map geometry for the headline minimap: the raw spatial coords + map_dim + engagements
    # the frontend needs to draw the schematic (a slim projection of `reconstruction`).
    map_geometry = models.JSONField(default=dict, blank=True)
    # #3 deterministic build-order classifier output: {candidates, is_confident, unknown, notes}.
    classifier = models.JSONField(default=dict, blank=True)
    # #6 deterministically flagged mistakes (list[Flagged] enriched with source.study deep-links).
    mistakes = models.JSONField(default=list, blank=True)
    # #2 Tier-B economy ESTIMATE block (may self-suppress collected totals → qualitative only).
    economy = models.JSONField(default=dict, blank=True)
    # Rendered strategic-map PNG media paths (relative to MEDIA_URL): overall first, then engagements.
    map_images = models.JSONField(default=list, blank=True)

    coach_analysis = models.TextField(blank=True, default="")
    coach_model = models.CharField(max_length=64, blank=True, default="")
    coach_tier = models.CharField(max_length=24, blank=True, default="")
    analyzed_at = models.DateTimeField(null=True, blank=True)

    analysis_status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    error_detail = models.TextField(blank=True, default="")

    featured = models.BooleanField(default=False)
    clip_url = models.URLField(max_length=500, blank=True, default="")
    clip_title = models.CharField(max_length=120, blank=True, default="")
    clip_note = models.CharField(max_length=300, blank=True, default="")
    clip_start_seconds = models.IntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-played_at", "-created_at"]

    def __str__(self):
        return f"{self.my_civ} vs {self.opponent_civ} ({self.map_name})"
