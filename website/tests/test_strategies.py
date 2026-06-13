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
