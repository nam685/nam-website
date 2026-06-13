from datetime import date, timedelta
from decimal import Decimal

import pytest

from website.models import PriceSnapshot, Ticker


@pytest.mark.django_db
def test_strategies_endpoint_lists_all(client):
    resp = client.get("/api/bets/strategies/")
    assert resp.status_code == 200
    data = resp.json()
    keys = {s["key"] for s in data}
    assert keys == {"buy_hold", "ma_crossover", "dca", "macd", "bollinger", "rsi", "momentum"}
    ma = next(s for s in data if s["key"] == "ma_crossover")
    assert {p["name"] for p in ma["params"]} == {"short", "long"}


def _seed_prices(days=120):
    t = Ticker.objects.create(
        symbol="BT", name="BTest", asset_type="stock", provider="alpha_vantage", provider_id="BT"
    )
    base = date(2020, 1, 1)
    for i in range(days):
        PriceSnapshot.objects.create(ticker=t, date=base + timedelta(days=i), price=Decimal(100 + i))
    return t


@pytest.mark.django_db
def test_backtest_returns_curve_and_metrics(client):
    t = _seed_prices()
    resp = client.post(
        "/api/bets/backtest/",
        data={"ticker_id": t.id, "strategy": "ma_crossover", "params": {"short": 5, "long": 20}, "period": "ALL"},
        content_type="application/json",
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["equity_curve"]) == len(body["benchmark_curve"]) == len(body["dates"])
    assert "total_return_pct" in body["metrics"]
    assert "total_return_pct" in body["benchmark_metrics"]


@pytest.mark.django_db
def test_backtest_unknown_strategy_400(client):
    t = _seed_prices(30)
    resp = client.post(
        "/api/bets/backtest/",
        data={"ticker_id": t.id, "strategy": "nope", "params": {}},
        content_type="application/json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_backtest_rate_limited(client, settings):
    t = _seed_prices(30)
    payload = {"ticker_id": t.id, "strategy": "buy_hold", "params": {}}
    last = None
    for _ in range(31):
        last = client.post("/api/bets/backtest/", data=payload, content_type="application/json")
    assert last.status_code == 429
