"""Pure technical-indicator math over lists of float closes. No I/O, no Django."""


def sma(values: list[float], window: int) -> float | None:
    """Simple moving average of the last `window` values, or None if too few."""
    if window <= 0 or len(values) < window:
        return None
    return sum(values[-window:]) / window


def ema_series(values: list[float], span: int) -> list[float]:
    """Full exponential-moving-average series, seeded with the first value."""
    if not values:
        return []
    alpha = 2 / (span + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(alpha * v + (1 - alpha) * out[-1])
    return out


def ema(values: list[float], span: int) -> float | None:
    """Latest EMA value, or None if empty."""
    series = ema_series(values, span)
    return series[-1] if series else None


def pstd(values: list[float], window: int) -> float | None:
    """Population standard deviation of the last `window` values, or None if too few."""
    if window <= 0 or len(values) < window:
        return None
    window_vals = values[-window:]
    mean = sum(window_vals) / window
    variance = sum((x - mean) ** 2 for x in window_vals) / window
    return variance**0.5


def rsi(values: list[float], period: int) -> float | None:
    """Wilder-style RSI over the most recent `period` deltas, or None if too few.

    Returns 100.0 when there are no losses in the window.
    """
    if period <= 0 or len(values) < period + 1:
        return None
    deltas = [values[i] - values[i - 1] for i in range(1, len(values))]
    window = deltas[-period:]
    gains = sum(d for d in window if d > 0) / period
    losses = -sum(d for d in window if d < 0) / period
    if losses == 0:
        return 100.0
    rs = gains / losses
    return 100 - (100 / (1 + rs))


def macd(values: list[float], fast: int, slow: int, signal: int) -> tuple[float | None, float | None]:
    """Latest (MACD line, signal line). Either is None if there is too little data."""
    if len(values) < slow:
        return None, None
    fast_series = ema_series(values, fast)
    slow_series = ema_series(values, slow)
    macd_series = [f - s for f, s in zip(fast_series, slow_series)]
    signal_series = ema_series(macd_series, signal)
    return macd_series[-1], signal_series[-1]
