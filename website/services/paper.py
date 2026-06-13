"""Advance paper-trading accounts one sync at a time. Reuses the backtest execution rules."""

from datetime import date as _date
from decimal import Decimal

from django.db import transaction

from website.models import PaperSnapshot, PaperTrade, PriceSnapshot
from website.services.backtest import _simulate
from website.strategies import coerce_params, get_strategy

FEE_PCT = 0.001


@transaction.atomic
def advance_account(account) -> None:
    """Recompute the account from its full history and persist any new snapshots/trades.

    Idempotent: existing snapshot dates are left untouched; only missing days are written.
    """
    strategy = get_strategy(account.strategy)
    if strategy is None:
        return

    prices = [
        (d, float(p))
        for d, p in PriceSnapshot.objects.filter(ticker=account.ticker, date__gte=account.started_on)
        .order_by("date")
        .values_list("date", "price")
    ]
    if len(prices) < 1:
        return

    params = coerce_params(strategy, account.params or {})
    curve, trades, cash_curve, shares_curve = _simulate(prices, strategy, params, float(account.starting_cash), FEE_PCT)

    existing_snap_dates = set(account.snapshots.values_list("date", flat=True))
    existing_trade_keys = {(t.date, t.side) for t in account.trades.all()}

    new_snaps = []
    for i, (d, close) in enumerate(prices):
        if d in existing_snap_dates:
            continue
        position_value = shares_curve[i] * close
        new_snaps.append(
            PaperSnapshot(
                account=account,
                date=d,
                portfolio_value=Decimal(str(round(curve[i], 2))),
                cash=Decimal(str(round(cash_curve[i], 2))),
                position_value=Decimal(str(round(position_value, 2))),
            )
        )
    if new_snaps:
        PaperSnapshot.objects.bulk_create(new_snaps)

    new_trades = []
    for t in trades:
        td = _date.fromisoformat(t.date)
        if (td, t.side) in existing_trade_keys:
            continue
        new_trades.append(
            PaperTrade(
                account=account,
                date=td,
                side=t.side,
                shares=Decimal(str(round(t.shares, 8))),
                price=Decimal(str(round(t.price, 4))),
                cash_after=Decimal(str(round(t.cash_after, 2))),
                reason=t.reason[:120],
            )
        )
    if new_trades:
        PaperTrade.objects.bulk_create(new_trades)
