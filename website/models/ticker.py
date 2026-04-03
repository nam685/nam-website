from django.db import models


class Ticker(models.Model):
    class AssetType(models.TextChoices):
        STOCK = "stock", "Stock"
        COMMODITY = "commodity", "Commodity"
        CRYPTO = "crypto", "Crypto"
        BOND = "bond", "Bond"

    class Provider(models.TextChoices):
        ALPHA_VANTAGE = "alpha_vantage", "Alpha Vantage"
        COINGECKO = "coingecko", "CoinGecko"
        ECB = "ecb", "ECB"

    symbol = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=128)
    asset_type = models.CharField(max_length=16, choices=AssetType.choices)
    provider = models.CharField(max_length=16, choices=Provider.choices)
    provider_id = models.CharField(max_length=128)
    currency = models.CharField(max_length=8, default="USD")
    display_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["display_order", "symbol"]

    def __str__(self):
        return self.symbol
