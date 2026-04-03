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


# --- Provider adapter tests ---

from unittest.mock import MagicMock, patch  # noqa: E402

from website.services.alpha_vantage import fetch_alpha_vantage  # noqa: E402
from website.services.coingecko import fetch_coingecko  # noqa: E402
from website.services.ecb import fetch_ecb  # noqa: E402


class TestAlphaVantageAdapter:
    @patch("website.services.alpha_vantage.httpx.get")
    def test_fetch_stock_history(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "Time Series (Daily)": {
                    "2026-04-03": {"4. close": "121.3400"},
                    "2026-04-02": {"4. close": "120.8200"},
                    "2026-04-01": {"4. close": "119.5000"},
                }
            },
        )
        result = fetch_alpha_vantage("VWCE.DE", days=30)
        assert len(result) == 3
        assert result[0] == (date(2026, 4, 1), Decimal("119.5000"))
        assert result[2] == (date(2026, 4, 3), Decimal("121.3400"))

    @patch("website.services.alpha_vantage.httpx.get")
    def test_fetch_forex_gold(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "Time Series FX (Daily)": {
                    "2026-04-03": {"4. close": "2312.5000"},
                    "2026-04-02": {"4. close": "2298.2000"},
                }
            },
        )
        result = fetch_alpha_vantage("XAU", days=30)
        assert len(result) == 2
        assert result[0] == (date(2026, 4, 2), Decimal("2298.2000"))


class TestCoinGeckoAdapter:
    @patch("website.services.coingecko.httpx.get")
    def test_fetch_crypto_history(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "prices": [
                    [1743465600000, 84000.50],
                    [1743552000000, 84500.75],
                    [1743638400000, 83200.00],
                ]
            },
        )
        result = fetch_coingecko("bitcoin", days=30)
        assert len(result) == 3
        assert result[0][1] == Decimal("84000.50")


class TestECBAdapter:
    @patch("website.services.ecb.httpx.get")
    def test_fetch_bond_yield(self, mock_get):
        csv_data = (
            "KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM_ID,DATA_TYPE_FM,REF_SECTOR_ID,TIME_PERIOD,OBS_VALUE\n"
            "FM.M.U2.EUR.4F.BB.U2_10Y.YLD,M,U2,EUR,4F,BB,U2_10Y,2026-01,2.6500\n"
            "FM.M.U2.EUR.4F.BB.U2_10Y.YLD,M,U2,EUR,4F,BB,U2_10Y,2026-02,2.7100\n"
            "FM.M.U2.EUR.4F.BB.U2_10Y.YLD,M,U2,EUR,4F,BB,U2_10Y,2026-03,2.6800\n"
        )
        mock_get.return_value = MagicMock(status_code=200, text=csv_data)
        result = fetch_ecb("FM.M.U2.EUR.4F.BB.U2_10Y.YLD", days=365)
        assert len(result) == 3
        assert result[0] == (date(2026, 1, 1), Decimal("2.6500"))
        assert result[2] == (date(2026, 3, 1), Decimal("2.6800"))
