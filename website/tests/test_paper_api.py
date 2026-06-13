from datetime import date, timedelta
from decimal import Decimal

import pytest

from website.models import PaperAccount, PriceSnapshot, Ticker


def _ticker_with_prices():
    t = Ticker.objects.create(symbol="PA", name="PA", asset_type="stock", provider="alpha_vantage", provider_id="PA")
    base = date(2020, 1, 1)
    for i in range(10):
        PriceSnapshot.objects.create(ticker=t, date=base + timedelta(days=i), price=Decimal(100 + i))
    return t


@pytest.mark.django_db
def test_create_requires_admin(client):
    t = _ticker_with_prices()
    resp = client.post(
        "/api/bets/paper/create/",
        data={"ticker_id": t.id, "strategy": "buy_hold", "params": {}},
        content_type="application/json",
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_create_rejects_zero_starting_cash(client, auth_headers):
    t = _ticker_with_prices()
    resp = client.post(
        "/api/bets/paper/create/",
        data={"ticker_id": t.id, "strategy": "buy_hold", "params": {}, "starting_cash": 0},
        content_type="application/json",
        **auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_admin_can_create_and_list(client, auth_headers):
    t = _ticker_with_prices()
    resp = client.post(
        "/api/bets/paper/create/",
        data={"ticker_id": t.id, "strategy": "buy_hold", "params": {}, "starting_cash": 10000},
        content_type="application/json",
        **auth_headers,
    )
    assert resp.status_code == 201
    listing = client.get("/api/bets/paper/").json()
    assert len(listing) == 1
    assert listing[0]["strategy"] == "buy_hold"


@pytest.mark.django_db
def test_detail_and_stop_and_delete(client, auth_headers):
    t = _ticker_with_prices()
    acct = PaperAccount.objects.create(
        ticker=t, strategy="buy_hold", params={}, starting_cash=Decimal("10000"), started_on=date(2020, 1, 1)
    )
    detail = client.get(f"/api/bets/paper/{acct.id}/")
    assert detail.status_code == 200
    assert "equity_curve" in detail.json()

    stop = client.post(f"/api/bets/paper/{acct.id}/stop/", **auth_headers)
    assert stop.status_code == 200
    acct.refresh_from_db()
    assert acct.is_active is False

    dele = client.post(f"/api/bets/paper/{acct.id}/delete/", **auth_headers)
    assert dele.status_code == 200
    assert not PaperAccount.objects.filter(id=acct.id).exists()
