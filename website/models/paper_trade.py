from django.db import models


class PaperTrade(models.Model):
    account = models.ForeignKey("PaperAccount", on_delete=models.CASCADE, related_name="trades")
    date = models.DateField()
    side = models.CharField(max_length=4)  # "buy" | "sell"
    shares = models.DecimalField(max_digits=20, decimal_places=8)
    price = models.DecimalField(max_digits=14, decimal_places=4)
    cash_after = models.DecimalField(max_digits=14, decimal_places=2)
    reason = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["date"]

    def __str__(self):
        return f"{self.account_id} {self.side} {self.date}"
