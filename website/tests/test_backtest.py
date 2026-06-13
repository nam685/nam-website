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


def test_compute_metrics_handles_zero_starting_cash():
    """Zero starting cash must not raise ZeroDivisionError."""
    m = compute_metrics([date(2020, 1, 1), date(2021, 1, 1)], [0.0, 0.0], [], 0.0)
    assert m["total_return_pct"] == 0.0
    assert m["cagr_pct"] == 0.0


def test_run_backtest_buy_hold_fills_at_t_plus_1():
    from website.services.backtest import run_backtest
    from website.strategies.buy_hold import BuyHoldStrategy

    prices = [(date(2020, 1, 1), 100.0), (date(2020, 1, 2), 110.0), (date(2020, 1, 3), 120.0)]
    res = run_backtest(prices, BuyHoldStrategy(), {}, starting_cash=1000.0, fee_pct=0.0)
    assert len(res.trades) == 1
    assert res.trades[0].side == "buy"
    assert abs(res.trades[0].price - 110.0) < 1e-9
    assert abs(res.equity_curve[-1] - (1000.0 / 110.0) * 120.0) < 1e-6


def test_run_backtest_fee_reduces_position():
    from website.services.backtest import run_backtest
    from website.strategies.buy_hold import BuyHoldStrategy

    prices = [(date(2020, 1, 1), 100.0), (date(2020, 1, 2), 100.0)]
    res = run_backtest(prices, BuyHoldStrategy(), {}, starting_cash=1000.0, fee_pct=0.01)
    assert abs(res.trades[0].shares - 9.9) < 1e-9


def test_no_lookahead_signal_only_sees_prefix():
    """Strategy must never receive future prices on the decision day."""
    from website.services.backtest import run_backtest

    seen_lengths = []

    class Spy:
        key = "spy"
        label = "spy"
        params: list = []

        def signal(self, closes, position_shares, params):  # noqa: ARG002
            seen_lengths.append(len(closes))
            from website.strategies.base import Signal

            return Signal(action="hold")

    prices = [(date(2020, 1, i + 1), 100.0 + i) for i in range(5)]
    run_backtest(prices, Spy(), {}, starting_cash=1000.0, fee_pct=0.0)
    assert seen_lengths == [1, 2, 3, 4, 5]


def test_run_backtest_benchmark_curve_present():
    from website.services.backtest import run_backtest
    from website.strategies.buy_hold import BuyHoldStrategy

    prices = [(date(2020, 1, 1), 100.0), (date(2020, 1, 2), 110.0)]
    res = run_backtest(prices, BuyHoldStrategy(), {}, starting_cash=1000.0, fee_pct=0.0)
    assert len(res.benchmark_curve) == len(res.equity_curve) == 2
    assert "total_return_pct" in res.benchmark_metrics


def test_run_backtest_sell_path_liquidates_position_at_t_plus_1():
    """Exercise the sell branch: buy, hold, then sell — fill each at the next close."""
    from website.services.backtest import run_backtest
    from website.strategies.base import Signal

    class BuyThenSell:
        key = "bts"
        label = "bts"
        params: list = []

        def signal(self, closes, position_shares, params):  # noqa: ARG002
            if position_shares <= 0 and len(closes) == 1:
                return Signal(action="buy")
            if position_shares > 0 and len(closes) == 3:
                return Signal(action="sell")
            return Signal(action="hold")

    prices = [
        (date(2020, 1, 1), 100.0),  # decide buy
        (date(2020, 1, 2), 100.0),  # fill buy @100 -> 10 shares
        (date(2020, 1, 3), 100.0),  # decide sell
        (date(2020, 1, 4), 120.0),  # fill sell @120 -> cash 1200
    ]
    res = run_backtest(prices, BuyThenSell(), {}, starting_cash=1000.0, fee_pct=0.0)
    assert [t.side for t in res.trades] == ["buy", "sell"]
    assert abs(res.trades[1].price - 120.0) < 1e-9
    assert abs(res.trades[1].shares - 10.0) < 1e-9
    # fully liquidated: final equity is all cash, no residual position
    assert abs(res.equity_curve[-1] - 1200.0) < 1e-6
