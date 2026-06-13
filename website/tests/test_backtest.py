from datetime import date

from website.services.backtest import Trade, compute_metrics


def test_total_return_and_cagr():
    dates = [date(2020, 1, 1), date(2021, 1, 1)]  # ~1 year
    curve = [10000.0, 12000.0]
    m = compute_metrics(dates, curve, [], 10000.0)
    assert round(m["total_return_pct"], 2) == 20.0
    assert m["cagr_pct"] > 19  # ~20% over ~1y


def test_max_drawdown():
    dates = [date(2020, 1, i + 1) for i in range(4)]
    curve = [10000.0, 12000.0, 9000.0, 11000.0]  # peak 12000 -> trough 9000 = -25%
    m = compute_metrics(dates, curve, [], 10000.0)
    assert round(m["max_drawdown_pct"], 2) == -25.0


def test_win_rate_round_trips():
    dates = [date(2020, 1, i + 1) for i in range(2)]
    curve = [10000.0, 10500.0]
    trades = [
        Trade("2020-01-01", "buy", 100, 100.0, 0.0, ""),
        Trade("2020-01-02", "sell", 100, 110.0, 11000.0, ""),  # win
        Trade("2020-01-03", "buy", 100, 110.0, 0.0, ""),
        Trade("2020-01-04", "sell", 100, 105.0, 10500.0, ""),  # loss
    ]
    m = compute_metrics(dates, curve, trades, 10000.0)
    assert m["num_trades"] == 4
    assert m["win_rate_pct"] == 50.0


def test_win_rate_none_when_no_round_trips():
    m = compute_metrics([date(2020, 1, 1)], [10000.0], [], 10000.0)
    assert m["win_rate_pct"] is None
