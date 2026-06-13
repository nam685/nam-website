import pytest


@pytest.mark.django_db
def test_strategies_endpoint_lists_all(client):
    resp = client.get("/api/bets/strategies/")
    assert resp.status_code == 200
    data = resp.json()
    keys = {s["key"] for s in data}
    assert keys == {"buy_hold", "ma_crossover", "dca", "macd", "bollinger", "rsi", "momentum"}
    ma = next(s for s in data if s["key"] == "ma_crossover")
    assert {p["name"] for p in ma["params"]} == {"short", "long"}
