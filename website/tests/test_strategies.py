from website.strategies.base import coerce_params
from website.strategies.buy_hold import BuyHoldStrategy


def test_buy_hold_buys_once_then_holds():
    s = BuyHoldStrategy()
    assert s.signal([100.0], 0, {}).action == "buy"
    assert s.signal([100.0, 110.0], 5.0, {}).action == "hold"


def test_coerce_params_clamps():
    from website.strategies.ma_crossover import MACrossoverStrategy

    s = MACrossoverStrategy()
    p = coerce_params(s, {"short": 0, "long": 9999})
    assert p["short"] == 2  # clamped to min
    assert p["long"] == 400  # clamped to max
