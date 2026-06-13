from website.strategies.base import Param, Signal
from website.strategies.indicators import pstd, sma


class BollingerStrategy:
    key = "bollinger"
    label = "Bollinger Bands (mean reversion)"
    params = [
        Param("window", "Window", "int", 20, 2, 400),
        Param("width", "Band width (std devs)", "float", 2.0, 0.5, 4.0),
    ]

    def signal(self, closes: list[float], position_shares: float, params: dict) -> Signal:
        window, width = params["window"], params["width"]
        mid = sma(closes, window)
        sd = pstd(closes, window)
        if mid is None or sd is None:
            return Signal(action="hold")
        price = closes[-1]
        lower, upper = mid - width * sd, mid + width * sd
        if price <= lower and position_shares <= 0:
            return Signal(action="buy", reason="Price below lower band")
        if price >= upper and position_shares > 0:
            return Signal(action="sell", reason="Price above upper band")
        return Signal(action="hold")
