from django.db import models


class PaperAccount(models.Model):
    ticker = models.ForeignKey("Ticker", on_delete=models.CASCADE, related_name="paper_accounts")
    strategy = models.CharField(max_length=32)
    params = models.JSONField(default=dict)
    starting_cash = models.DecimalField(max_digits=14, decimal_places=2, default=10000)
    started_on = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.ticker.symbol} / {self.strategy}"
