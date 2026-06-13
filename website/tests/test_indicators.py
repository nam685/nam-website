from website.strategies.indicators import ema, ema_series, macd, pstd, rsi, sma


def test_sma_returns_none_when_insufficient_data():
    assert sma([1, 2], 3) is None


def test_sma_averages_last_window():
    assert sma([1, 2, 3, 4, 5], 3) == 4.0  # (3+4+5)/3


def test_ema_series_first_value_is_seed():
    series = ema_series([10, 20, 30], 2)
    assert series[0] == 10.0
    assert len(series) == 3


def test_ema_returns_last_of_series():
    assert ema([10, 20, 30], 2) == ema_series([10, 20, 30], 2)[-1]


def test_ema_none_when_empty():
    assert ema([], 5) is None


def test_pstd_population_std():
    # population std of [2,4,4,4,5,5,7,9] is 2.0
    assert pstd([2, 4, 4, 4, 5, 5, 7, 9], 8) == 2.0


def test_rsi_all_gains_is_100():
    assert rsi([1, 2, 3, 4, 5, 6], 5) == 100.0


def test_rsi_none_when_insufficient():
    assert rsi([1, 2], 5) is None


def test_macd_returns_macd_and_signal():
    closes = [float(x) for x in range(1, 60)]
    line, signal = macd(closes, 12, 26, 9)
    assert line is not None and signal is not None
    # steadily rising series → MACD line positive
    assert line > 0
