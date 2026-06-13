from website.strategies.base import Param, Signal


class MomentumStrategy:
    key = "momentum"
    label = "Time-Series Momentum"
    params = [
        Param("lookback", "Lookback (days)", "int", 200, 5, 400),
    ]

    def signal(self, closes: list[float], position_shares: float, params: dict) -> Signal:
        lookback = params["lookback"]
        if len(closes) <= lookback:
            return Signal(action="hold")
        past, now = closes[-lookback - 1], closes[-1]
        up = now > past
        if up and position_shares <= 0:
            return Signal(action="buy", reason=f"Up over trailing {lookback}d")
        if not up and position_shares > 0:
            return Signal(action="sell", reason=f"Down over trailing {lookback}d")
        return Signal(action="hold")
