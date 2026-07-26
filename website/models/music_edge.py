from django.db import models


class MusicEdge(models.Model):
    """An undirected affinity/structural edge between two MusicNodes.

    Stored canonically with source_id < target_id (enforced by the build pipeline).
    """

    class EdgeType(models.TextChoices):
        STRUCTURAL = "structural"  # track↔artist / track↔album / album↔artist backbone
        TAG = "tag"  # artist↔tag genre membership (multipartite connectivity layer)
        AFFINITY = "affinity"  # recommendation edge (co-listen + Last.fm), Mutual-Proximity rescaled
        # Legacy types kept for choices validation on pre-rebuild rows; collapsed into AFFINITY.
        SIMILAR_ARTIST = "similar_artist"
        SIMILAR_TRACK = "similar_track"
        COLISTEN = "colisten"

    source = models.ForeignKey("MusicNode", on_delete=models.CASCADE, related_name="edges_out")
    target = models.ForeignKey("MusicNode", on_delete=models.CASCADE, related_name="edges_in")
    edge_type = models.CharField(max_length=16, choices=EdgeType.choices)
    # Raw provenance of an affinity edge (colisten | similar_artist | similar_track); "" otherwise.
    # Surfaced in the admin graph viz's edge-type filter.
    source_kind = models.CharField(max_length=16, blank=True, default="")
    weight = models.FloatField(default=1.0)

    class Meta:
        unique_together = [("source", "target", "edge_type")]
        indexes = [
            models.Index(fields=["source"]),
            models.Index(fields=["target"]),
        ]

    def __str__(self):
        return f"{self.source_id}-{self.target_id} ({self.edge_type})"
