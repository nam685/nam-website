from django.db import models


class MusicEdge(models.Model):
    """An undirected affinity/structural edge between two MusicNodes.

    Stored canonically with source_id < target_id (enforced by the build pipeline).
    """

    class EdgeType(models.TextChoices):
        SIMILAR_ARTIST = "similar_artist"
        SIMILAR_TRACK = "similar_track"
        COLISTEN = "colisten"
        STRUCTURAL = "structural"

    source = models.ForeignKey("MusicNode", on_delete=models.CASCADE, related_name="edges_out")
    target = models.ForeignKey("MusicNode", on_delete=models.CASCADE, related_name="edges_in")
    edge_type = models.CharField(max_length=16, choices=EdgeType.choices)
    weight = models.FloatField(default=1.0)

    class Meta:
        unique_together = [("source", "target", "edge_type")]
        indexes = [
            models.Index(fields=["source"]),
            models.Index(fields=["target"]),
        ]

    def __str__(self):
        return f"{self.source_id}-{self.target_id} ({self.edge_type})"
