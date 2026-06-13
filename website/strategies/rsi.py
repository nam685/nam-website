from website.strategies.base import Param, Signal
from website.strategies.indicators import rsi


class RSIStrategy:
    key = "rsi"
    label = "RSI Mean Reversion"
    params = [
        Param("period", "RSI period", "int", 14, 2, 100),
        Param("low", "Oversold below", "float", 30, 5, 50),
        Param("high", "Overbought above", "float", 70, 50, 95),
    ]

    def signal(self, closes: list[float], position_shares: float, params: dict) -> Signal:
        value = rsi(closes, params["period"])
        if value is None:
            return Signal(action="hold")
        if value <= params["low"] and position_shares <= 0:
            return Signal(action="buy", reason=f"RSI {value:.0f} oversold")
        if value >= params["high"] and position_shares > 0:
            return Signal(action="sell", reason=f"RSI {value:.0f} overbought")
        return Signal(action="hold")
