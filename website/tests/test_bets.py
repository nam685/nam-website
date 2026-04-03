from datetime import date
from decimal import Decimal

import pytest

from website.models import PriceSnapshot, Ticker


@pytest.mark.django_db
class TestTickerModel:
    def test_create_ticker(self):
        t = Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
            currency="USD",
        )
        assert t.symbol == "BTC"
        assert t.asset_type == "crypto"
        assert t.provider == "coingecko"
        assert t.currency == "USD"
        assert t.display_order == 0
        assert str(t) == "BTC"

    def test_symbol_unique(self):
        Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        with pytest.raises(Exception):
            Ticker.objects.create(
                symbol="BTC",
                name="Bitcoin 2",
                asset_type="crypto",
                provider="coingecko",
                provider_id="bitcoin2",
            )


@pytest.mark.django_db
class TestPriceSnapshotModel:
    def test_create_snapshot(self):
        t = Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        s = PriceSnapshot.objects.create(
            ticker=t,
            date=date(2026, 4, 1),
            price=Decimal("84000.0000"),
            change_pct=Decimal("-2.3100"),
        )
        assert s.ticker == t
        assert s.price == Decimal("84000.0000")
        assert str(s) == "BTC 2026-04-01: 84000.0000"

    def test_unique_ticker_date(self):
        t = Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        PriceSnapshot.objects.create(ticker=t, date=date(2026, 4, 1), price=Decimal("84000"))
        with pytest.raises(Exception):
            PriceSnapshot.objects.create(ticker=t, date=date(2026, 4, 1), price=Decimal("84500"))

    def test_cascade_delete(self):
        t = Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        PriceSnapshot.objects.create(ticker=t, date=date(2026, 4, 1), price=Decimal("84000"))
        t.delete()
        assert PriceSnapshot.objects.count() == 0
