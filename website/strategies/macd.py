from website.strategies.base import Param, Signal
from website.strategies.indicators import macd


class MACDStrategy:
    key = "macd"
    label = "MACD"
    params = [
        Param("fast", "Fast EMA", "int", 12, 2, 200),
        Param("slow", "Slow EMA", "int", 26, 3, 400),
        Param("signal", "Signal EMA", "int", 9, 2, 100),
    ]

    def signal(self, closes: list[float], position_shares: float, params: dict) -> Signal:
        fast, slow, sig = params["fast"], params["slow"], params["signal"]
        if fast >= slow:
            return Signal(action="hold")
        m_now, s_now = macd(closes, fast, slow, sig)
        m_prev, s_prev = macd(closes[:-1], fast, slow, sig)
        if None in (m_now, s_now, m_prev, s_prev):
            return Signal(action="hold")
        crossed_up = m_prev <= s_prev and m_now > s_now
        crossed_down = m_prev >= s_prev and m_now < s_now
        if crossed_up and position_shares <= 0:
            return Signal(action="buy", reason="MACD crossed above signal")
        if crossed_down and position_shares > 0:
            return Signal(action="sell", reason="MACD crossed below signal")
        return Signal(action="hold")
