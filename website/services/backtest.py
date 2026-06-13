"""Backtest engine: execution simulator, replay loop, and metrics. Pure (no Django)."""

from dataclasses import asdict, dataclass
from datetime import date


@dataclass
class Trade:
    date: str
    side: str  # "buy" | "sell"
    shares: float
    price: float
    cash_after: float
    reason: str

    def to_dict(self) -> dict:
        return asdict(self)


def compute_metrics(dates: list[date], curve: list[float], trades: list[Trade], starting_cash: float) -> dict:
    """Score an equity curve. Returns return %, CAGR %, max drawdown %, Sharpe, trades, win rate %."""
    if not curve:
        return {
            "total_return_pct": 0.0,
            "cagr_pct": 0.0,
            "max_drawdown_pct": 0.0,
            "sharpe": 0.0,
            "num_trades": 0,
            "win_rate_pct": None,
        }

    final = curve[-1]
    total_return_pct = (final / starting_cash - 1) * 100

    years = (dates[-1] - dates[0]).days / 365.25 if len(dates) > 1 else 0
    if years > 0 and final > 0:
        cagr_pct = ((final / starting_cash) ** (1 / years) - 1) * 100
    else:
        cagr_pct = 0.0

    peak = curve[0]
    max_dd = 0.0
    for v in curve:
        peak = max(peak, v)
        if peak > 0:
            max_dd = min(max_dd, (v - peak) / peak)
    max_drawdown_pct = max_dd * 100

    daily = [curve[i] / curve[i - 1] - 1 for i in range(1, len(curve)) if curve[i - 1] > 0]
    sharpe = 0.0
    if len(daily) > 1:
        mean = sum(daily) / len(daily)
        var = sum((r - mean) ** 2 for r in daily) / len(daily)
        std = var**0.5
        if std > 0:
            sharpe = (mean / std) * (252**0.5)

    wins = round_trips = 0
    last_buy: float | None = None
    for t in trades:
        if t.side == "buy":
            last_buy = t.price
        elif t.side == "sell" and last_buy is not None:
            round_trips += 1
            if t.price > last_buy:
                wins += 1
            last_buy = None
    win_rate_pct = (wins / round_trips * 100) if round_trips else None

    return {
        "total_return_pct": total_return_pct,
        "cagr_pct": cagr_pct,
        "max_drawdown_pct": max_drawdown_pct,
        "sharpe": sharpe,
        "num_trades": len(trades),
        "win_rate_pct": win_rate_pct,
    }
