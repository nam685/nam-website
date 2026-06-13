from django.db import models


class PaperSnapshot(models.Model):
    account = models.ForeignKey("PaperAccount", on_delete=models.CASCADE, related_name="snapshots")
    date = models.DateField()
    portfolio_value = models.DecimalField(max_digits=16, decimal_places=2)
    cash = models.DecimalField(max_digits=16, decimal_places=2)
    position_value = models.DecimalField(max_digits=16, decimal_places=2)

    class Meta:
        unique_together = [("account", "date")]
        ordering = ["date"]
        indexes = [models.Index(fields=["account", "date"])]

    def __str__(self):
        return f"{self.account_id} {self.date}: {self.portfolio_value}"
