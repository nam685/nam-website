from datetime import date
from decimal import Decimal

import pytest

from website.models import PaperAccount, PaperSnapshot, PaperTrade, Ticker


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
