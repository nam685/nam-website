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


@dataclass
class BacktestResult:
    dates: list[str]
    equity_curve: list[float]
    benchmark_curve: list[float]
    trades: list[Trade]
    metrics: dict
    benchmark_metrics: dict


def _simulate(prices, strategy, params, starting_cash, fee_pct):
    """Core replay: returns (equity_curve, trades, cash_curve, shares_curve).

    Signal at day i fills at day i+1 close.
    """
    cash = starting_cash
    shares = 0.0
    trades: list[Trade] = []
    curve: list[float] = []
    cash_curve: list[float] = []
    shares_curve: list[float] = []
    closes: list[float] = []
    pending = None  # Signal decided on the previous day, filled today

    for d, close in prices:
        closes.append(close)

        # 1. Fill yesterday's decision at today's close (T+1 rule).
        if pending is not None and pending.action != "hold":
            if pending.action == "buy":
                if pending.dollars is None:
                    spend = cash if shares <= 0 else 0.0  # all-in only if flat
                else:
                    spend = min(pending.dollars, cash)  # DCA partial buy
                if spend > 0:
                    fee = spend * fee_pct
                    bought = (spend - fee) / close
                    shares += bought
                    cash -= spend
                    trades.append(Trade(str(d), "buy", bought, close, cash, pending.reason))
            elif pending.action == "sell" and shares > 0:
                proceeds = shares * close
                fee = proceeds * fee_pct
                cash += proceeds - fee
                trades.append(Trade(str(d), "sell", shares, close, cash, pending.reason))
                shares = 0.0

        # 2. Record equity at today's close, after any fill.
        curve.append(cash + shares * close)
        cash_curve.append(cash)
        shares_curve.append(shares)

        # 3. Decide today's signal from the prefix (becomes tomorrow's pending).
        pending = strategy.signal(closes, shares, params)

    return curve, trades, cash_curve, shares_curve


def run_backtest(prices, strategy, params, starting_cash=10000.0, fee_pct=0.001) -> BacktestResult:
    """Replay `prices` (sorted ascending [(date, close)]) through `strategy`. Benchmark = Buy & Hold."""
    from website.strategies.buy_hold import BuyHoldStrategy

    dates = [d for d, _ in prices]
    curve, trades, _, _ = _simulate(prices, strategy, params, starting_cash, fee_pct)
    bench_curve, _, _, _ = _simulate(prices, BuyHoldStrategy(), {}, starting_cash, fee_pct)

    return BacktestResult(
        dates=[str(d) for d in dates],
        equity_curve=curve,
        benchmark_curve=bench_curve,
        trades=trades,
        metrics=compute_metrics(dates, curve, trades, starting_cash),
        benchmark_metrics=compute_metrics(dates, bench_curve, [], starting_cash),
    )
