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


class TestAlphaVantageSearch:
    @patch("website.services.alpha_vantage.httpx.get")
    def test_search_returns_mapped_results(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "bestMatches": [
                    {
                        "1. symbol": "VWCE.DE",
                        "2. name": "Vanguard FTSE All-World UCITS ETF USD Acc",
                        "3. type": "ETF",
                        "4. region": "Frankfurt",
                        "8. currency": "EUR",
                        "9. matchScore": "1.0000",
                    },
                    {
                        "1. symbol": "VWC.L",
                        "2. name": "Vanguard FTSE 100 UCITS ETF",
                        "3. type": "ETF",
                        "4. region": "London",
                        "8. currency": "GBP",
                        "9. matchScore": "0.6000",
                    },
                ]
            },
        )
        from website.services.alpha_vantage import search_alpha_vantage

        results = search_alpha_vantage("vwce")
        assert len(results) == 2
        assert results[0]["symbol"] == "VWCE.DE"
        assert results[0]["name"] == "Vanguard FTSE All-World UCITS ETF USD Acc"
        assert results[0]["asset_type"] == "stock"
        assert results[0]["provider"] == "alpha_vantage"
        assert results[0]["provider_id"] == "VWCE.DE"
        assert results[0]["currency"] == "EUR"
        assert results[0]["match_score"] == 1.0

    @patch("website.services.alpha_vantage.httpx.get")
    def test_search_skips_crypto_type(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "bestMatches": [
                    {
                        "1. symbol": "BTC",
                        "2. name": "Bitcoin",
                        "3. type": "Cryptocurrency",
                        "4. region": "United States",
                        "8. currency": "USD",
                        "9. matchScore": "1.0000",
                    },
                ]
            },
        )
        from website.services.alpha_vantage import search_alpha_vantage

        results = search_alpha_vantage("btc")
        assert len(results) == 0

    @patch("website.services.alpha_vantage.httpx.get")
    def test_search_handles_api_failure(self, mock_get):
        mock_get.side_effect = Exception("API down")
        from website.services.alpha_vantage import search_alpha_vantage

        results = search_alpha_vantage("vwce")
        assert results == []


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


class TestCoinGeckoSearch:
    @patch("website.services.coingecko.httpx.get")
    def test_search_returns_mapped_results(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "coins": [
                    {"id": "bitcoin", "name": "Bitcoin", "symbol": "btc"},
                    {"id": "ethereum", "name": "Ethereum", "symbol": "eth"},
                    {"id": "bitcoin-cash", "name": "Bitcoin Cash", "symbol": "bch"},
                ]
            },
        )
        from website.services.coingecko import search_coingecko

        results = search_coingecko("bitcoin")
        assert len(results) == 3
        assert results[0]["symbol"] == "BTC"
        assert results[0]["name"] == "Bitcoin"
        assert results[0]["asset_type"] == "crypto"
        assert results[0]["provider"] == "coingecko"
        assert results[0]["provider_id"] == "bitcoin"
        assert results[0]["currency"] == "USD"
        assert results[0]["match_score"] == 1.0
        assert results[2]["match_score"] < 1.0

    @patch("website.services.coingecko.httpx.get")
    def test_search_limits_to_five(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"coins": [{"id": f"coin-{i}", "name": f"Coin {i}", "symbol": f"C{i}"} for i in range(10)]},
        )
        from website.services.coingecko import search_coingecko

        results = search_coingecko("coin")
        assert len(results) == 5

    @patch("website.services.coingecko.httpx.get")
    def test_search_handles_api_failure(self, mock_get):
        mock_get.side_effect = Exception("API down")
        from website.services.coingecko import search_coingecko

        results = search_coingecko("bitcoin")
        assert results == []


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


# --- Sync management command tests ---

import json  # noqa: E402

from django.core.cache import cache  # noqa: E402
from django.core.management import call_command  # noqa: E402


@pytest.mark.django_db
class TestSyncPricesCommand:
    @patch("website.services.coingecko.httpx.get")
    def test_syncs_ticker_prices(self, mock_get):
        Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "prices": [
                    [1743465600000, 84000.50],
                    [1743552000000, 84500.75],
                ]
            },
        )
        call_command("sync_prices")
        assert PriceSnapshot.objects.filter(ticker__symbol="BTC").count() == 2

    @patch("website.services.coingecko.httpx.get")
    def test_sync_stores_status_in_cache(self, mock_get):
        Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"prices": [[1743465600000, 84000.50]]},
        )
        call_command("sync_prices")
        status = json.loads(cache.get("bets:sync_status") or "{}")
        assert "last_sync" in status
        assert status["errors"] == []

    @patch("website.services.coingecko.httpx.get")
    def test_sync_records_errors(self, mock_get):
        Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        mock_get.side_effect = Exception("API down")
        call_command("sync_prices")
        status = json.loads(cache.get("bets:sync_status") or "{}")
        assert len(status["errors"]) == 1
        assert status["errors"][0]["symbol"] == "BTC"

    @patch("website.services.coingecko.httpx.get")
    def test_sync_computes_change_pct(self, mock_get):
        t = Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "prices": [
                    [1743465600000, 100.00],
                    [1743552000000, 110.00],
                ]
            },
        )
        call_command("sync_prices")
        snaps = list(PriceSnapshot.objects.filter(ticker=t).order_by("date"))
        assert snaps[0].change_pct is None  # first day, no previous
        assert snaps[1].change_pct == Decimal("10.0000")


# --- API endpoint tests ---

from datetime import timedelta  # noqa: E402


@pytest.mark.django_db
class TestBetsListEndpoint:
    def test_empty_list(self, client):
        resp = client.get("/api/bets/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_tickers_with_sparkline(self, client):
        t = Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
            currency="USD",
        )
        PriceSnapshot.objects.create(ticker=t, date=date(2026, 4, 1), price=Decimal("80000"))
        PriceSnapshot.objects.create(ticker=t, date=date(2026, 4, 2), price=Decimal("82000"), change_pct=Decimal("2.5"))
        PriceSnapshot.objects.create(
            ticker=t, date=date(2026, 4, 3), price=Decimal("81000"), change_pct=Decimal("-1.22")
        )

        data = client.get("/api/bets/").json()
        assert len(data) == 1
        assert data[0]["symbol"] == "BTC"
        assert data[0]["price"] == "81000.0000"
        assert data[0]["change_pct"] == "-1.2200"
        assert data[0]["currency"] == "USD"
        assert data[0]["sparkline"] == [80000.0, 82000.0, 81000.0]

    def test_ordered_by_display_order(self, client):
        Ticker.objects.create(
            symbol="XAU",
            name="Gold",
            asset_type="commodity",
            provider="alpha_vantage",
            provider_id="XAU",
            display_order=1,
        )
        Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
            display_order=0,
        )
        data = client.get("/api/bets/").json()
        assert data[0]["symbol"] == "BTC"
        assert data[1]["symbol"] == "XAU"


@pytest.mark.django_db
class TestBetsHistoryEndpoint:
    def test_returns_price_history(self, client):
        t = Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
            currency="USD",
        )
        PriceSnapshot.objects.create(ticker=t, date=date(2026, 4, 1), price=Decimal("80000"))
        PriceSnapshot.objects.create(ticker=t, date=date(2026, 4, 2), price=Decimal("82000"), change_pct=Decimal("2.5"))

        data = client.get(f"/api/bets/{t.id}/history/").json()
        assert data["symbol"] == "BTC"
        assert data["currency"] == "USD"
        assert len(data["prices"]) == 2
        assert data["prices"][0]["date"] == "2026-04-01"

    def test_period_filter(self, client):
        t = Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        for i in range(40):
            d = date(2026, 2, 22) + timedelta(days=i)
            PriceSnapshot.objects.create(ticker=t, date=d, price=Decimal("80000") + i)

        data = client.get(f"/api/bets/{t.id}/history/?period=1W").json()
        assert len(data["prices"]) == 7

    def test_not_found(self, client):
        resp = client.get("/api/bets/999/history/")
        assert resp.status_code == 404


# --- Admin endpoint tests ---


@pytest.mark.django_db
class TestBetsCreateEndpoint:
    def test_requires_auth(self, client):
        resp = client.post("/api/bets/create/", content_type="application/json", data=json.dumps({"symbol": "ETH"}))
        assert resp.status_code == 401

    def test_creates_ticker(self, client, auth_headers):
        resp = client.post(
            "/api/bets/create/",
            content_type="application/json",
            data=json.dumps(
                {
                    "symbol": "ETH",
                    "name": "Ethereum",
                    "asset_type": "crypto",
                    "provider": "coingecko",
                    "provider_id": "ethereum",
                    "currency": "USD",
                }
            ),
            **auth_headers,
        )
        assert resp.status_code == 201
        assert Ticker.objects.filter(symbol="ETH").exists()

    def test_rejects_duplicate_symbol(self, client, auth_headers):
        Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        resp = client.post(
            "/api/bets/create/",
            content_type="application/json",
            data=json.dumps(
                {
                    "symbol": "BTC",
                    "name": "Bitcoin 2",
                    "asset_type": "crypto",
                    "provider": "coingecko",
                    "provider_id": "bitcoin2",
                }
            ),
            **auth_headers,
        )
        assert resp.status_code == 400


@pytest.mark.django_db
class TestBetsDeleteEndpoint:
    def test_requires_auth(self, client):
        resp = client.post("/api/bets/1/delete/")
        assert resp.status_code == 401

    def test_deletes_ticker(self, client, auth_headers):
        t = Ticker.objects.create(
            symbol="BTC",
            name="Bitcoin",
            asset_type="crypto",
            provider="coingecko",
            provider_id="bitcoin",
        )
        resp = client.post(f"/api/bets/{t.id}/delete/", **auth_headers)
        assert resp.status_code == 200
        assert not Ticker.objects.filter(pk=t.id).exists()

    def test_not_found(self, client, auth_headers):
        resp = client.post("/api/bets/999/delete/", **auth_headers)
        assert resp.status_code == 404


@pytest.mark.django_db
class TestBetsSyncEndpoint:
    @patch("website.views.bets.call_command")
    def test_requires_auth(self, mock_cmd, client):
        resp = client.post("/api/bets/sync/")
        assert resp.status_code == 401
        mock_cmd.assert_not_called()

    @patch("website.views.bets.call_command")
    def test_triggers_sync(self, mock_cmd, client, auth_headers):
        resp = client.post("/api/bets/sync/", **auth_headers)
        assert resp.status_code == 200
        mock_cmd.assert_called_once_with("sync_prices")


@pytest.mark.django_db
class TestBetsSyncStatusEndpoint:
    def test_requires_auth(self, client):
        resp = client.get("/api/bets/sync-status/")
        assert resp.status_code == 401

    def test_returns_status(self, client, auth_headers):
        cache.set("bets:sync_status", json.dumps({"last_sync": "2026-04-03T08:00:00", "errors": []}))
        data = client.get("/api/bets/sync-status/", **auth_headers).json()
        assert data["last_sync"] == "2026-04-03T08:00:00"
        assert data["errors"] == []

    def test_returns_empty_when_never_synced(self, client, auth_headers):
        data = client.get("/api/bets/sync-status/", **auth_headers).json()
        assert data["last_sync"] is None
