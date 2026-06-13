from website.strategies.base import coerce_params
from website.strategies.buy_hold import BuyHoldStrategy


def test_buy_hold_buys_once_then_holds():
    s = BuyHoldStrategy()
    assert s.signal([100.0], 0, {}).action == "buy"
    assert s.signal([100.0, 110.0], 5.0, {}).action == "hold"


def test_ma_crossover_buys_on_golden_cross():
    from website.strategies.ma_crossover import MACrossoverStrategy

    s = MACrossoverStrategy()
    params = {"short": 2, "long": 3}
    closes = [10, 10, 10, 9, 12]
    closes2 = [10, 10, 10, 9, 12, 14]
    assert s.signal(closes, 0, params).action in ("hold", "buy")
    assert s.signal(closes2, 0, params).action == "buy"


def test_ma_crossover_sells_on_death_cross():
    from website.strategies.ma_crossover import MACrossoverStrategy

    s = MACrossoverStrategy()
    params = {"short": 2, "long": 3}
    closes = [10, 14, 14, 14, 8, 6]
    assert s.signal(closes, 3.0, params).action == "sell"


def test_coerce_params_clamps():
    from website.strategies.ma_crossover import MACrossoverStrategy

    s = MACrossoverStrategy()
    p = coerce_params(s, {"short": 0, "long": 9999})
    assert p["short"] == 2  # clamped to min
    assert p["long"] == 400  # clamped to max


def test_dca_buys_fixed_dollars_on_interval():
    from website.strategies.dca import DCAStrategy

    s = DCAStrategy()
    params = {"amount": 500, "interval": 5}
    buy = s.signal([1, 2, 3, 4, 5], 0, params)
    assert buy.action == "hold"
    buy2 = s.signal([1], 0, params)
    assert buy2.action == "buy" and buy2.dollars == 500.0
    buy3 = s.signal([1, 2, 3, 4, 5, 6], 3.0, params)
    assert buy3.action == "buy" and buy3.dollars == 500.0


def test_macd_signal_actions_are_valid():
    from website.strategies.macd import MACDStrategy

    s = MACDStrategy()
    params = {"fast": 12, "slow": 26, "signal": 9}
    rising = [float(x) for x in range(1, 80)]
    out = s.signal(rising, 0, params)
    assert out.action in ("buy", "hold")
    assert s.signal([1, 2, 3], 0, params).action == "hold"


def test_bollinger_buys_below_lower_band():
    from website.strategies.bollinger import BollingerStrategy

    s = BollingerStrategy()
    params = {"window": 5, "width": 2.0}
    closes = [100, 100, 100, 100, 100, 90]
    assert s.signal(closes, 0, params).action == "buy"


def test_bollinger_sells_above_upper_band():
    from website.strategies.bollinger import BollingerStrategy

    s = BollingerStrategy()
    params = {"window": 5, "width": 2.0}
    closes = [100, 100, 100, 100, 100, 110]
    assert s.signal(closes, 4.0, params).action == "sell"
