from django.db import models


class PriceSnapshot(models.Model):
    ticker = models.ForeignKey("Ticker", on_delete=models.CASCADE, related_name="snapshots")
    date = models.DateField()
    price = models.DecimalField(max_digits=14, decimal_places=4)
    change_pct = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)

    class Meta:
        unique_together = [("ticker", "date")]
        ordering = ["-date"]
        indexes = [
            models.Index(fields=["ticker", "-date"]),
        ]

    def __str__(self):
        return f"{self.ticker.symbol} {self.date}: {self.price}"
