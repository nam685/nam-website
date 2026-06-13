from datetime import date, timedelta
from decimal import Decimal

import pytest

from website.models import PaperAccount, PaperSnapshot, PaperTrade, PriceSnapshot, Ticker


@pytest.mark.django_db
def test_paper_models_relate():
    t = Ticker.objects.create(symbol="P", name="P", asset_type="stock", provider="alpha_vantage", provider_id="P")
    acct = PaperAccount.objects.create(
        ticker=t, strategy="buy_hold", params={}, starting_cash=Decimal("10000"), started_on=date(2020, 1, 1)
    )
    PaperTrade.objects.create(
        account=acct,
        date=date(2020, 1, 2),
        side="buy",
        shares=Decimal("10"),
        price=Decimal("100"),
        cash_after=Decimal("9000"),
        reason="entry",
    )
    PaperSnapshot.objects.create(
        account=acct,
        date=date(2020, 1, 2),
        portfolio_value=Decimal("10000"),
        cash=Decimal("9000"),
        position_value=Decimal("1000"),
    )
    assert acct.trades.count() == 1
    assert acct.snapshots.count() == 1
    assert acct.is_active is True


@pytest.mark.django_db
def test_advance_account_is_idempotent():
    from website.services.paper import advance_account

    t = Ticker.objects.create(symbol="Q", name="Q", asset_type="stock", provider="alpha_vantage", provider_id="Q")
    base = date(2020, 1, 1)
    for i in range(5):
        PriceSnapshot.objects.create(ticker=t, date=base + timedelta(days=i), price=Decimal(100 + i))
    acct = PaperAccount.objects.create(
        ticker=t, strategy="buy_hold", params={}, starting_cash=Decimal("10000"), started_on=base
    )

    advance_account(acct)
    first_count = PaperSnapshot.objects.filter(account=acct).count()
    assert first_count == 5  # one snapshot per available day

    advance_account(acct)  # run again — must not duplicate
    assert PaperSnapshot.objects.filter(account=acct).count() == first_count


@pytest.mark.django_db
def test_advance_account_buys_and_holds():
    from website.services.paper import advance_account

    t = Ticker.objects.create(symbol="R", name="R", asset_type="stock", provider="alpha_vantage", provider_id="R")
    base = date(2020, 1, 1)
    for i in range(5):
        PriceSnapshot.objects.create(ticker=t, date=base + timedelta(days=i), price=Decimal(100))
    acct = PaperAccount.objects.create(
        ticker=t, strategy="buy_hold", params={}, starting_cash=Decimal("10000"), started_on=base
    )
    advance_account(acct)
    assert acct.trades.filter(side="buy").exists()


@pytest.mark.django_db
def test_advance_account_snapshot_cash_and_position_split():
    """After a buy, a snapshot's cash + position_value must equal its portfolio_value."""
    from website.services.paper import advance_account

    t = Ticker.objects.create(symbol="S", name="S", asset_type="stock", provider="alpha_vantage", provider_id="S")
    base = date(2020, 1, 1)
    for i in range(4):
        PriceSnapshot.objects.create(ticker=t, date=base + timedelta(days=i), price=Decimal(100))
    acct = PaperAccount.objects.create(
        ticker=t, strategy="buy_hold", params={}, starting_cash=Decimal("10000"), started_on=base
    )
    advance_account(acct)
    snap = acct.snapshots.order_by("date").last()
    assert snap.cash + snap.position_value == snap.portfolio_value
    assert snap.position_value > 0  # bought in, holding
