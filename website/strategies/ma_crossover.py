from website.strategies.base import Param, Signal
from website.strategies.indicators import sma


class MACrossoverStrategy:
    key = "ma_crossover"
    label = "Moving-Average Crossover"
    params = [
        Param("short", "Short window", "int", 20, 2, 400),
        Param("long", "Long window", "int", 50, 3, 400),
    ]

    def signal(self, closes: list[float], position_shares: float, params: dict) -> Signal:
        short, long = params["short"], params["long"]
        if short >= long:
            return Signal(action="hold")
        s_now, l_now = sma(closes, short), sma(closes, long)
        if s_now is None or l_now is None:
            return Signal(action="hold")
        if s_now > l_now and position_shares <= 0:
            return Signal(action="buy", reason=f"{short}d above {long}d")
        if s_now < l_now and position_shares > 0:
            return Signal(action="sell", reason=f"{short}d below {long}d")
        return Signal(action="hold")
