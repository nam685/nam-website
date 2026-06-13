# Trading Bot (Backtester + Paper Trading) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive, visitor-driven backtester and admin-curated paper-trading showcase to the `/bets` page — no real trades, ever.

**Architecture:** Pure, I/O-free strategy/execution/metrics functions are driven two ways: a backtest loop replays full history; a daily cron tick (piggybacked on `sync_prices`) advances live paper accounts one day at a time. Same engine, two drivers.

**Tech Stack:** Django 6 + PostgreSQL + Redis (backend, `uv`/pytest); Next.js 16 + React 19 + TypeScript + hand-rolled SVG charts (frontend, `pnpm`/vitest). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-13-bets-trading-bot-design.md`

**Worktree:** All work happens in `.claude/worktrees/bets-trading-bot/` on branch `feat/bets-trading-bot`. Run backend commands from the worktree root, frontend commands from `frontend/`.

---

## File Structure

**New backend files:**
- `website/strategies/__init__.py` — strategy registry (`STRATEGIES` dict, `get_strategy`, `list_strategies`)
- `website/strategies/base.py` — `Signal`, `Param`, `Strategy` protocol
- `website/strategies/indicators.py` — pure math: `sma`, `ema_series`, `ema`, `rsi`, `pstd`, `macd`
- `website/strategies/buy_hold.py`, `ma_crossover.py`, `dca.py`, `macd.py`, `bollinger.py`, `rsi.py`, `momentum.py` — one strategy each
- `website/services/backtest.py` — `Trade`, `BacktestResult`, `compute_metrics`, `run_backtest`
- `website/services/paper.py` — `advance_account` (Phase B)
- `website/models/paper_account.py`, `paper_trade.py`, `paper_snapshot.py` — new models (Phase B)
- `website/management/commands/backfill_history.py` — one-time deep history backfill
- `website/management/commands/tick_paper_accounts.py` — daily paper advance (Phase B)
- Tests: `website/tests/test_indicators.py`, `test_strategies.py`, `test_backtest.py`, `test_bets_backtest_api.py`, `test_paper.py`, `test_paper_api.py`

**Modified backend files:**
- `website/models/__init__.py` — export new models (Phase B)
- `website/views/bets.py` — add backtest + paper views
- `website/views/__init__.py` — export new views
- `website/urls.py` — add routes
- `website/management/commands/sync_prices.py` — call paper tick at end (Phase B)

**New frontend files:**
- `frontend/src/lib/backtest.ts` — pure helpers: `curveToPoints`, `fmtPct`, `fmtMoney`
- `frontend/src/lib/__tests__/backtest.test.ts` — vitest
- `frontend/src/components/EquityCurve.tsx` — SVG dual-line chart with trade markers
- `frontend/src/app/bets/Backtester.tsx` — backtest sandbox section
- `frontend/src/app/bets/PaperTrading.tsx` — paper showcase section (Phase B)

**Modified frontend files:**
- `frontend/src/lib/api.ts` — new TypeScript interfaces
- `frontend/src/app/bets/page.tsx` — import + render the two new sections

**Modified docs:**
- `docs/README.md`, `docs/QA-CHECKLIST.md`

---

# PHASE A — Backtester

## Task 1: Indicators module

Pure functions over a list of float closes. Each returns the *latest* value for a prefix (callers slice to get "yesterday").

**Files:**
- Create: `website/strategies/__init__.py` (empty for now — package marker)
- Create: `website/strategies/indicators.py`
- Test: `website/tests/test_indicators.py`

- [ ] **Step 1: Create the package marker**

Create `website/strategies/__init__.py` as an empty file (the registry is added in Task 2).

- [ ] **Step 2: Write failing tests**

Create `website/tests/test_indicators.py`:

```python
import math

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
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `uv run pytest website/tests/test_indicators.py -v`
Expected: FAIL — `ModuleNotFoundError` / `ImportError` (functions not defined).

- [ ] **Step 4: Implement `indicators.py`**

```python
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
```

- [ ] **Step 5: Run tests, verify pass; commit**

Run: `uv run pytest website/tests/test_indicators.py -v`
Expected: PASS (all 10).

```bash
git add website/strategies/__init__.py website/strategies/indicators.py website/tests/test_indicators.py
git commit -m "feat(bets): pure technical-indicator helpers"
```

---

## Task 2: Strategy base interface + registry

**Files:**
- Create: `website/strategies/base.py`
- Modify: `website/strategies/__init__.py`
- Test: (covered by Task 3's strategy tests — no standalone test here)

- [ ] **Step 1: Implement `base.py`**

```python
"""Strategy interface shared by every strategy and both drivers (backtest + paper)."""

from dataclasses import asdict, dataclass
from typing import Protocol


@dataclass(frozen=True)
class Param:
    """A tunable knob exposed to the UI and validated server-side."""

    name: str
    label: str
    type: str  # "int" | "float"
    default: float
    min: float
    max: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Signal:
    """A strategy's decision for one day.

    action:  "buy" | "sell" | "hold"
    dollars: None  -> all-in (buy) / all-out (sell), skipped if already in the target state
             float -> partial buy of this many dollars (DCA); always allowed if cash remains
    """

    action: str = "hold"
    dollars: float | None = None
    reason: str = ""


class Strategy(Protocol):
    key: str
    label: str
    params: list[Param]

    def signal(self, closes: list[float], position_shares: float, params: dict) -> Signal:
        """Decide for the LAST element of `closes` (today). Must never read future data."""
        ...


def coerce_params(strategy: "Strategy", raw: dict) -> dict:
    """Clamp/validate incoming params against the strategy's schema. Unknown keys dropped."""
    out: dict = {}
    for p in strategy.params:
        val = raw.get(p.name, p.default)
        try:
            val = int(val) if p.type == "int" else float(val)
        except (TypeError, ValueError):
            val = p.default
        out[p.name] = max(p.min, min(p.max, val))
        if p.type == "int":
            out[p.name] = int(out[p.name])
    return out
```

- [ ] **Step 2: Implement the registry in `__init__.py`**

Replace the empty `website/strategies/__init__.py` with:

```python
from website.strategies.base import Param, Signal, Strategy, coerce_params
from website.strategies.bollinger import BollingerStrategy
from website.strategies.buy_hold import BuyHoldStrategy
from website.strategies.dca import DCAStrategy
from website.strategies.ma_crossover import MACrossoverStrategy
from website.strategies.macd import MACDStrategy
from website.strategies.momentum import MomentumStrategy
from website.strategies.rsi import RSIStrategy

STRATEGIES: dict[str, Strategy] = {
    s.key: s
    for s in (
        BuyHoldStrategy(),
        MACrossoverStrategy(),
        DCAStrategy(),
        MACDStrategy(),
        BollingerStrategy(),
        RSIStrategy(),
        MomentumStrategy(),
    )
}


def get_strategy(key: str) -> Strategy | None:
    return STRATEGIES.get(key)


def list_strategies() -> list[dict]:
    """Serializable strategy catalog for the /strategies/ endpoint."""
    return [
        {"key": s.key, "label": s.label, "params": [p.to_dict() for p in s.params]}
        for s in STRATEGIES.values()
    ]


__all__ = ["STRATEGIES", "Param", "Signal", "Strategy", "coerce_params", "get_strategy", "list_strategies"]
```

> NOTE: this `__init__.py` imports all 7 strategy modules. It will raise `ImportError` until Tasks 3–9 create them. That is expected — do not run the full suite until Task 9. Tasks 3–9 each test their own module by direct import (`from website.strategies.buy_hold import ...`), which works incrementally.

- [ ] **Step 3: Commit**

```bash
git add website/strategies/base.py website/strategies/__init__.py
git commit -m "feat(bets): strategy interface + registry skeleton"
```

---

## Task 3: Buy & Hold strategy

**Files:**
- Create: `website/strategies/buy_hold.py`
- Test: `website/tests/test_strategies.py` (created here, appended to in later tasks)

- [ ] **Step 1: Write failing test**

Create `website/tests/test_strategies.py`:

```python
from website.strategies.base import coerce_params
from website.strategies.buy_hold import BuyHoldStrategy


def test_buy_hold_buys_once_then_holds():
    s = BuyHoldStrategy()
    # day 0, flat -> buy all-in
    assert s.signal([100.0], 0, {}).action == "buy"
    # already holding -> hold forever
    assert s.signal([100.0, 110.0], 5.0, {}).action == "hold"


def test_coerce_params_clamps():
    from website.strategies.ma_crossover import MACrossoverStrategy

    s = MACrossoverStrategy()
    p = coerce_params(s, {"short": 0, "long": 9999})
    assert p["short"] == 2  # clamped to min
    assert p["long"] == 400  # clamped to max
```

> NOTE: the second test imports `MACrossoverStrategy` (Task 4). Run only the first test this task: `pytest ...::test_buy_hold_buys_once_then_holds`.

- [ ] **Step 2: Run test, verify fail**

Run: `uv run pytest website/tests/test_strategies.py::test_buy_hold_buys_once_then_holds -v`
Expected: FAIL — `ModuleNotFoundError: website.strategies.buy_hold`.

- [ ] **Step 3: Implement `buy_hold.py`**

```python
from website.strategies.base import Signal


class BuyHoldStrategy:
    key = "buy_hold"
    label = "Buy & Hold"
    params: list = []

    def signal(self, closes: list[float], position_shares: float, params: dict) -> Signal:
        if position_shares <= 0:
            return Signal(action="buy", reason="Initial buy-and-hold entry")
        return Signal(action="hold")
```

- [ ] **Step 4: Run test, verify pass**

Run: `uv run pytest website/tests/test_strategies.py::test_buy_hold_buys_once_then_holds -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/strategies/buy_hold.py website/tests/test_strategies.py
git commit -m "feat(bets): buy & hold strategy"
```

---

## Task 4: Moving-Average Crossover strategy

**Files:**
- Create: `website/strategies/ma_crossover.py`
- Test: append to `website/tests/test_strategies.py`

- [ ] **Step 1: Append failing test**

Add to `website/tests/test_strategies.py`:

```python
def test_ma_crossover_buys_on_golden_cross():
    from website.strategies.ma_crossover import MACrossoverStrategy

    s = MACrossoverStrategy()
    params = {"short": 2, "long": 3}
    # Build a series where the short MA crosses ABOVE the long MA on the last day.
    closes = [10, 10, 10, 9, 12]  # short(2)=10.5, long(3)=11 -> not yet
    closes2 = [10, 10, 10, 9, 12, 14]  # short(2)=13, long(3)=11.67 -> cross up
    assert s.signal(closes, 0, params).action in ("hold", "buy")
    assert s.signal(closes2, 0, params).action == "buy"


def test_ma_crossover_sells_on_death_cross():
    from website.strategies.ma_crossover import MACrossoverStrategy

    s = MACrossoverStrategy()
    params = {"short": 2, "long": 3}
    # short MA dropping below long MA while holding -> sell
    closes = [10, 14, 14, 14, 8, 6]
    assert s.signal(closes, 3.0, params).action == "sell"
```

- [ ] **Step 2: Run, verify fail**

Run: `uv run pytest website/tests/test_strategies.py -k ma_crossover -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ma_crossover.py`**

```python
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
        s_prev, l_prev = sma(closes[:-1], short), sma(closes[:-1], long)
        if None in (s_now, l_now, s_prev, l_prev):
            return Signal(action="hold")
        crossed_up = s_prev <= l_prev and s_now > l_now
        crossed_down = s_prev >= l_prev and s_now < l_now
        if crossed_up and position_shares <= 0:
            return Signal(action="buy", reason=f"{short}d crossed above {long}d")
        if crossed_down and position_shares > 0:
            return Signal(action="sell", reason=f"{short}d crossed below {long}d")
        return Signal(action="hold")
```

- [ ] **Step 4: Run, verify pass**

Run: `uv run pytest website/tests/test_strategies.py -k "ma_crossover or coerce" -v`
Expected: PASS (incl. the `test_coerce_params_clamps` from Task 3).

- [ ] **Step 5: Commit**

```bash
git add website/strategies/ma_crossover.py website/tests/test_strategies.py
git commit -m "feat(bets): moving-average crossover strategy"
```

---

## Task 5: Dollar-Cost Averaging strategy

**Files:**
- Create: `website/strategies/dca.py`
- Test: append to `website/tests/test_strategies.py`

- [ ] **Step 1: Append failing test**

```python
def test_dca_buys_fixed_dollars_on_interval():
    from website.strategies.dca import DCAStrategy

    s = DCAStrategy()
    params = {"amount": 500, "interval": 5}
    # day index = len(closes)-1; buy when index % interval == 0
    buy = s.signal([1, 2, 3, 4, 5], 0, params)  # index 4 -> not a multiple of 5
    assert buy.action == "hold"
    buy2 = s.signal([1], 0, params)  # index 0 -> buy
    assert buy2.action == "buy" and buy2.dollars == 500.0
    buy3 = s.signal([1, 2, 3, 4, 5, 6], 3.0, params)  # index 5 -> buy even while holding
    assert buy3.action == "buy" and buy3.dollars == 500.0
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_strategies.py -k dca -v` → FAIL.

- [ ] **Step 3: Implement `dca.py`**

```python
from website.strategies.base import Param, Signal


class DCAStrategy:
    key = "dca"
    label = "Dollar-Cost Averaging"
    params = [
        Param("amount", "Buy amount ($)", "float", 500, 1, 100000),
        Param("interval", "Every N days", "int", 30, 1, 365),
    ]

    def signal(self, closes: list[float], position_shares: float, params: dict) -> Signal:
        index = len(closes) - 1  # 0-based day index
        if index % params["interval"] == 0:
            return Signal(action="buy", dollars=float(params["amount"]), reason="Scheduled DCA buy")
        return Signal(action="hold")
```

- [ ] **Step 4: Run, verify pass.** `uv run pytest website/tests/test_strategies.py -k dca -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add website/strategies/dca.py website/tests/test_strategies.py
git commit -m "feat(bets): dollar-cost-averaging strategy"
```

---

## Task 6: MACD strategy

**Files:**
- Create: `website/strategies/macd.py`
- Test: append to `website/tests/test_strategies.py`

- [ ] **Step 1: Append failing test**

```python
def test_macd_signal_actions_are_valid():
    from website.strategies.macd import MACDStrategy

    s = MACDStrategy()
    params = {"fast": 12, "slow": 26, "signal": 9}
    rising = [float(x) for x in range(1, 80)]
    out = s.signal(rising, 0, params)
    assert out.action in ("buy", "hold")
    # not enough data -> hold
    assert s.signal([1, 2, 3], 0, params).action == "hold"
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_strategies.py -k macd -v` → FAIL.

- [ ] **Step 3: Implement `macd.py`**

```python
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
```

- [ ] **Step 4: Run, verify pass.** `uv run pytest website/tests/test_strategies.py -k macd -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add website/strategies/macd.py website/tests/test_strategies.py
git commit -m "feat(bets): MACD strategy"
```

---

## Task 7: Bollinger Bands (mean-reversion) strategy

**Files:**
- Create: `website/strategies/bollinger.py`
- Test: append to `website/tests/test_strategies.py`

- [ ] **Step 1: Append failing test**

```python
def test_bollinger_buys_below_lower_band():
    from website.strategies.bollinger import BollingerStrategy

    s = BollingerStrategy()
    params = {"window": 5, "width": 2.0}
    # stable around 100 then a sharp drop -> price below lower band -> buy
    closes = [100, 100, 100, 100, 100, 90]
    assert s.signal(closes, 0, params).action == "buy"


def test_bollinger_sells_above_upper_band():
    from website.strategies.bollinger import BollingerStrategy

    s = BollingerStrategy()
    params = {"window": 5, "width": 2.0}
    closes = [100, 100, 100, 100, 100, 110]
    assert s.signal(closes, 4.0, params).action == "sell"
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_strategies.py -k bollinger -v` → FAIL.

- [ ] **Step 3: Implement `bollinger.py`**

```python
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
```

- [ ] **Step 4: Run, verify pass.** `uv run pytest website/tests/test_strategies.py -k bollinger -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add website/strategies/bollinger.py website/tests/test_strategies.py
git commit -m "feat(bets): bollinger bands mean-reversion strategy"
```

---

## Task 8: RSI mean-reversion strategy

**Files:**
- Create: `website/strategies/rsi.py`
- Test: append to `website/tests/test_strategies.py`

- [ ] **Step 1: Append failing test**

```python
def test_rsi_buys_when_oversold():
    from website.strategies.rsi import RSIStrategy

    s = RSIStrategy()
    params = {"period": 5, "low": 30, "high": 70}
    falling = [100, 95, 90, 85, 80, 75]  # all losses -> RSI 0 -> oversold -> buy
    assert s.signal(falling, 0, params).action == "buy"


def test_rsi_sells_when_overbought():
    from website.strategies.rsi import RSIStrategy

    s = RSIStrategy()
    params = {"period": 5, "low": 30, "high": 70}
    rising = [80, 85, 90, 95, 100, 105]  # all gains -> RSI 100 -> overbought -> sell
    assert s.signal(rising, 3.0, params).action == "sell"
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_strategies.py -k rsi -v` → FAIL.

- [ ] **Step 3: Implement `rsi.py`**

```python
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
```

- [ ] **Step 4: Run, verify pass.** `uv run pytest website/tests/test_strategies.py -k rsi -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add website/strategies/rsi.py website/tests/test_strategies.py
git commit -m "feat(bets): RSI mean-reversion strategy"
```

---

## Task 9: Time-Series (Absolute) Momentum strategy + full registry check

**Files:**
- Create: `website/strategies/momentum.py`
- Test: append to `website/tests/test_strategies.py`

- [ ] **Step 1: Append failing tests (incl. registry integrity)**

```python
def test_momentum_holds_when_up_over_lookback():
    from website.strategies.momentum import MomentumStrategy

    s = MomentumStrategy()
    params = {"lookback": 3}
    up = [100, 101, 102, 110]  # today vs 3 days ago (100) -> up -> buy
    assert s.signal(up, 0, params).action == "buy"


def test_momentum_sells_when_down_over_lookback():
    from website.strategies.momentum import MomentumStrategy

    s = MomentumStrategy()
    params = {"lookback": 3}
    down = [100, 99, 98, 90]  # today (90) < 3 days ago (100) -> sell
    assert s.signal(down, 5.0, params).action == "sell"


def test_registry_has_all_seven_strategies():
    from website.strategies import STRATEGIES, list_strategies

    assert set(STRATEGIES) == {"buy_hold", "ma_crossover", "dca", "macd", "bollinger", "rsi", "momentum"}
    catalog = list_strategies()
    assert len(catalog) == 7
    assert all("key" in c and "label" in c and "params" in c for c in catalog)
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_strategies.py -k "momentum or registry" -v` → FAIL.

- [ ] **Step 3: Implement `momentum.py`**

```python
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
```

- [ ] **Step 4: Run the FULL strategy suite, verify pass**

Run: `uv run pytest website/tests/test_strategies.py website/tests/test_indicators.py -v`
Expected: PASS (all). This confirms the registry `__init__.py` imports cleanly now that all 7 modules exist.

- [ ] **Step 5: Commit**

```bash
git add website/strategies/momentum.py website/tests/test_strategies.py
git commit -m "feat(bets): time-series momentum strategy + registry"
```

---

## Task 10: Metrics

Pure scoring over an equity curve + trade list. No Django.

**Files:**
- Create: `website/services/backtest.py` (metrics portion; engine added in Task 11)
- Test: `website/tests/test_backtest.py`

- [ ] **Step 1: Write failing tests**

Create `website/tests/test_backtest.py`:

```python
from datetime import date

from website.services.backtest import Trade, compute_metrics


def test_total_return_and_cagr():
    dates = [date(2020, 1, 1), date(2021, 1, 1)]  # ~1 year
    curve = [10000.0, 12000.0]
    m = compute_metrics(dates, curve, [], 10000.0)
    assert round(m["total_return_pct"], 2) == 20.0
    assert m["cagr_pct"] > 19  # ~20% over ~1y


def test_max_drawdown():
    dates = [date(2020, 1, i + 1) for i in range(4)]
    curve = [10000.0, 12000.0, 9000.0, 11000.0]  # peak 12000 -> trough 9000 = -25%
    m = compute_metrics(dates, curve, [], 10000.0)
    assert round(m["max_drawdown_pct"], 2) == -25.0


def test_win_rate_round_trips():
    dates = [date(2020, 1, i + 1) for i in range(2)]
    curve = [10000.0, 10500.0]
    trades = [
        Trade("2020-01-01", "buy", 100, 100.0, 0.0, ""),
        Trade("2020-01-02", "sell", 100, 110.0, 11000.0, ""),  # win
        Trade("2020-01-03", "buy", 100, 110.0, 0.0, ""),
        Trade("2020-01-04", "sell", 100, 105.0, 10500.0, ""),  # loss
    ]
    m = compute_metrics(dates, curve, trades, 10000.0)
    assert m["num_trades"] == 4
    assert m["win_rate_pct"] == 50.0


def test_win_rate_none_when_no_round_trips():
    m = compute_metrics([date(2020, 1, 1)], [10000.0], [], 10000.0)
    assert m["win_rate_pct"] is None
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_backtest.py -v` → FAIL (ImportError).

- [ ] **Step 3: Implement metrics in `website/services/backtest.py`**

```python
"""Backtest engine: execution simulator, replay loop, and metrics. Pure (no Django)."""

from dataclasses import asdict, dataclass
from datetime import date


@dataclass
class Trade:
    date: str
    side: str  # "buy" | "sell"
    shares: float
    price: float
    cash_after: float
    reason: str

    def to_dict(self) -> dict:
        return asdict(self)


def compute_metrics(dates: list[date], curve: list[float], trades: list[Trade], starting_cash: float) -> dict:
    """Score an equity curve. Returns return %, CAGR %, max drawdown %, Sharpe, trades, win rate %."""
    if not curve:
        return {
            "total_return_pct": 0.0,
            "cagr_pct": 0.0,
            "max_drawdown_pct": 0.0,
            "sharpe": 0.0,
            "num_trades": 0,
            "win_rate_pct": None,
        }

    final = curve[-1]
    total_return_pct = (final / starting_cash - 1) * 100

    years = (dates[-1] - dates[0]).days / 365.25 if len(dates) > 1 else 0
    if years > 0 and final > 0:
        cagr_pct = ((final / starting_cash) ** (1 / years) - 1) * 100
    else:
        cagr_pct = 0.0

    peak = curve[0]
    max_dd = 0.0
    for v in curve:
        peak = max(peak, v)
        if peak > 0:
            max_dd = min(max_dd, (v - peak) / peak)
    max_drawdown_pct = max_dd * 100

    daily = [curve[i] / curve[i - 1] - 1 for i in range(1, len(curve)) if curve[i - 1] > 0]
    sharpe = 0.0
    if len(daily) > 1:
        mean = sum(daily) / len(daily)
        var = sum((r - mean) ** 2 for r in daily) / len(daily)
        std = var**0.5
        if std > 0:
            sharpe = (mean / std) * (252**0.5)

    wins = round_trips = 0
    last_buy: float | None = None
    for t in trades:
        if t.side == "buy":
            last_buy = t.price
        elif t.side == "sell" and last_buy is not None:
            round_trips += 1
            if t.price > last_buy:
                wins += 1
            last_buy = None
    win_rate_pct = (wins / round_trips * 100) if round_trips else None

    return {
        "total_return_pct": total_return_pct,
        "cagr_pct": cagr_pct,
        "max_drawdown_pct": max_drawdown_pct,
        "sharpe": sharpe,
        "num_trades": len(trades),
        "win_rate_pct": win_rate_pct,
    }
```

- [ ] **Step 4: Run, verify pass.** `uv run pytest website/tests/test_backtest.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add website/services/backtest.py website/tests/test_backtest.py
git commit -m "feat(bets): backtest metrics"
```

---

## Task 11: Backtest engine (execution + replay loop)

Adds `BacktestResult` and `run_backtest` to `backtest.py`. Implements the **T+1 close fill** rule and the **all-in/all-out + DCA** execution model.

**Files:**
- Modify: `website/services/backtest.py`
- Test: append to `website/tests/test_backtest.py`

- [ ] **Step 1: Append failing tests (incl. the no-lookahead guarantee)**

```python
def test_run_backtest_buy_hold_fills_at_t_plus_1():
    from website.services.backtest import run_backtest
    from website.strategies.buy_hold import BuyHoldStrategy

    prices = [(date(2020, 1, 1), 100.0), (date(2020, 1, 2), 110.0), (date(2020, 1, 3), 120.0)]
    res = run_backtest(prices, BuyHoldStrategy(), {}, starting_cash=1000.0, fee_pct=0.0)
    # Signal on day 0 -> filled at day 1 close (110). 1000/110 = 9.0909 shares.
    assert len(res.trades) == 1
    assert res.trades[0].side == "buy"
    assert abs(res.trades[0].price - 110.0) < 1e-9
    # final equity = shares * last close (120)
    assert abs(res.equity_curve[-1] - (1000.0 / 110.0) * 120.0) < 1e-6


def test_run_backtest_fee_reduces_position():
    from website.services.backtest import run_backtest
    from website.strategies.buy_hold import BuyHoldStrategy

    prices = [(date(2020, 1, 1), 100.0), (date(2020, 1, 2), 100.0)]
    res = run_backtest(prices, BuyHoldStrategy(), {}, starting_cash=1000.0, fee_pct=0.01)
    # spend 1000, fee 10, invest 990 at price 100 -> 9.9 shares
    assert abs(res.trades[0].shares - 9.9) < 1e-9


def test_no_lookahead_signal_only_sees_prefix():
    """Strategy must never receive future prices on the decision day."""
    from website.services.backtest import run_backtest

    seen_lengths = []

    class Spy:
        key = "spy"
        label = "spy"
        params: list = []

        def signal(self, closes, position_shares, params):
            seen_lengths.append(len(closes))
            from website.strategies.base import Signal

            return Signal(action="hold")

    prices = [(date(2020, 1, i + 1), 100.0 + i) for i in range(5)]
    run_backtest(prices, Spy(), {}, starting_cash=1000.0, fee_pct=0.0)
    # On day i the strategy sees exactly i+1 closes (prefix), never more.
    assert seen_lengths == [1, 2, 3, 4, 5]


def test_run_backtest_benchmark_curve_present():
    from website.services.backtest import run_backtest
    from website.strategies.buy_hold import BuyHoldStrategy

    prices = [(date(2020, 1, 1), 100.0), (date(2020, 1, 2), 110.0)]
    res = run_backtest(prices, BuyHoldStrategy(), {}, starting_cash=1000.0, fee_pct=0.0)
    assert len(res.benchmark_curve) == len(res.equity_curve) == 2
    assert "total_return_pct" in res.benchmark_metrics
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_backtest.py -k "run_backtest or lookahead" -v` → FAIL.

- [ ] **Step 3: Append engine to `website/services/backtest.py`**

```python
@dataclass
class BacktestResult:
    dates: list[str]
    equity_curve: list[float]
    benchmark_curve: list[float]
    trades: list[Trade]
    metrics: dict
    benchmark_metrics: dict


def _simulate(prices, strategy, params, starting_cash, fee_pct):
    """Core replay: returns (equity_curve, trades). Signal at day i fills at day i+1 close."""
    cash = starting_cash
    shares = 0.0
    trades: list[Trade] = []
    curve: list[float] = []
    closes: list[float] = []
    pending = None  # Signal decided on the previous day, filled today

    for d, close in prices:
        closes.append(close)

        # 1. Fill yesterday's decision at today's close (T+1 rule).
        if pending is not None and pending.action != "hold":
            if pending.action == "buy":
                if pending.dollars is None:
                    spend = cash if shares <= 0 else 0.0  # all-in only if flat
                else:
                    spend = min(pending.dollars, cash)  # DCA partial buy
                if spend > 0:
                    fee = spend * fee_pct
                    bought = (spend - fee) / close
                    shares += bought
                    cash -= spend
                    trades.append(Trade(str(d), "buy", bought, close, cash, pending.reason))
            elif pending.action == "sell" and shares > 0:
                proceeds = shares * close
                fee = proceeds * fee_pct
                cash += proceeds - fee
                trades.append(Trade(str(d), "sell", shares, close, cash, pending.reason))
                shares = 0.0

        # 2. Record equity at today's close, after any fill.
        curve.append(cash + shares * close)

        # 3. Decide today's signal from the prefix (becomes tomorrow's pending).
        pending = strategy.signal(closes, shares, params)

    return curve, trades


def run_backtest(prices, strategy, params, starting_cash=10000.0, fee_pct=0.001) -> BacktestResult:
    """Replay `prices` (sorted ascending [(date, close)]) through `strategy`. Benchmark = Buy & Hold."""
    from website.strategies.buy_hold import BuyHoldStrategy

    dates = [d for d, _ in prices]
    curve, trades = _simulate(prices, strategy, params, starting_cash, fee_pct)
    bench_curve, _ = _simulate(prices, BuyHoldStrategy(), {}, starting_cash, fee_pct)

    return BacktestResult(
        dates=[str(d) for d in dates],
        equity_curve=curve,
        benchmark_curve=bench_curve,
        trades=trades,
        metrics=compute_metrics(dates, curve, trades, starting_cash),
        benchmark_metrics=compute_metrics(dates, bench_curve, [], starting_cash),
    )
```

- [ ] **Step 4: Run full backtest suite, verify pass.** `uv run pytest website/tests/test_backtest.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add website/services/backtest.py website/tests/test_backtest.py
git commit -m "feat(bets): backtest engine with T+1 fills + benchmark"
```

---

## Task 12: `backfill_history` management command

Pulls deep daily history into `PriceSnapshot`. Uses Alpha Vantage with `outputsize=full` (the existing adapter uses `compact`), and CoinGecko with a large `days`.

**Files:**
- Create: `website/management/commands/backfill_history.py`
- Test: `website/tests/test_backfill.py`

- [ ] **Step 1: Write failing test (mock the providers — no network)**

Create `website/tests/test_backfill.py`:

```python
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest

from website.models import PriceSnapshot, Ticker


@pytest.mark.django_db
def test_backfill_inserts_history_without_duplicates():
    t = Ticker.objects.create(
        symbol="TEST", name="Test", asset_type="stock", provider="alpha_vantage", provider_id="TEST"
    )
    PriceSnapshot.objects.create(ticker=t, date=date(2020, 1, 2), price=Decimal("101"))

    fake = [
        (date(2020, 1, 1), Decimal("100")),
        (date(2020, 1, 2), Decimal("101")),  # already exists -> skipped
        (date(2020, 1, 3), Decimal("102")),
    ]
    with patch("website.management.commands.backfill_history.fetch_deep_history", return_value=fake):
        from django.core.management import call_command

        call_command("backfill_history")

    assert PriceSnapshot.objects.filter(ticker=t).count() == 3  # 2 new + 1 existing, no dup
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_backfill.py -v` → FAIL.

- [ ] **Step 3: Implement `backfill_history.py`**

```python
import os
from datetime import date, datetime
from decimal import Decimal

import httpx
from django.core.management.base import BaseCommand

from website.models import PriceSnapshot, Ticker

AV_URL = "https://www.alphavantage.co/query"
CG_URL = "https://api.coingecko.com/api/v3"


def fetch_deep_history(ticker: Ticker) -> list[tuple[date, Decimal]]:
    """Fetch ~max available daily closes for one ticker (AV full / CoinGecko max)."""
    if ticker.provider == "alpha_vantage":
        resp = httpx.get(
            AV_URL,
            params={
                "function": "TIME_SERIES_DAILY",
                "symbol": ticker.provider_id,
                "outputsize": "full",
                "apikey": os.environ.get("ALPHA_VANTAGE_API_KEY", ""),
            },
            timeout=60,
        )
        resp.raise_for_status()
        series = resp.json().get("Time Series (Daily)", {})
        out = [(datetime.strptime(d, "%Y-%m-%d").date(), Decimal(v["4. close"])) for d, v in series.items()]
        out.sort(key=lambda x: x[0])
        return out
    if ticker.provider == "coingecko":
        resp = httpx.get(
            f"{CG_URL}/coins/{ticker.provider_id}/market_chart",
            params={"vs_currency": "usd", "days": "max", "interval": "daily"},
            timeout=60,
        )
        resp.raise_for_status()
        seen, out = set(), []
        for ts_ms, price in resp.json().get("prices", []):
            d = datetime.utcfromtimestamp(ts_ms / 1000).date()
            if d not in seen:
                seen.add(d)
                out.append((d, Decimal(str(price))))
        out.sort(key=lambda x: x[0])
        return out
    return []


class Command(BaseCommand):
    help = "One-time backfill of deep daily history for all tickers (AV full / CoinGecko max)."

    def handle(self, *_args, **_options):
        for ticker in Ticker.objects.all():
            try:
                history = fetch_deep_history(ticker)
            except Exception as e:  # noqa: BLE001 — log and continue
                self.stderr.write(f"  {ticker.symbol}: ERROR — {e}")
                continue
            existing = set(PriceSnapshot.objects.filter(ticker=ticker).values_list("date", flat=True))
            new = [
                PriceSnapshot(ticker=ticker, date=d, price=p) for d, p in history if d not in existing
            ]
            if new:
                PriceSnapshot.objects.bulk_create(new)
            self.stdout.write(f"  {ticker.symbol}: +{len(new)} snapshots")
```

- [ ] **Step 4: Run, verify pass.** `uv run pytest website/tests/test_backfill.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add website/management/commands/backfill_history.py website/tests/test_backfill.py
git commit -m "feat(bets): backfill_history command for deep price history"
```

---

## Task 13: `/api/bets/strategies/` endpoint

**Files:**
- Modify: `website/views/bets.py`, `website/views/__init__.py`, `website/urls.py`
- Test: `website/tests/test_bets_backtest_api.py`

- [ ] **Step 1: Write failing test**

Create `website/tests/test_bets_backtest_api.py`:

```python
import pytest


@pytest.mark.django_db
def test_strategies_endpoint_lists_all(client):
    resp = client.get("/api/bets/strategies/")
    assert resp.status_code == 200
    data = resp.json()
    keys = {s["key"] for s in data}
    assert keys == {"buy_hold", "ma_crossover", "dca", "macd", "bollinger", "rsi", "momentum"}
    ma = next(s for s in data if s["key"] == "ma_crossover")
    assert {p["name"] for p in ma["params"]} == {"short", "long"}
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_bets_backtest_api.py -v` → FAIL (404).

- [ ] **Step 3: Add view + route**

In `website/views/bets.py`, add the import near the top (after existing imports):

```python
from website.strategies import coerce_params, get_strategy, list_strategies
from website.services.backtest import run_backtest
```

Add the view at the end of `website/views/bets.py`:

```python
@require_GET
def bets_strategies(_request):
    """Public: strategy catalog with param schemas (drives the UI form)."""
    return JsonResponse(list_strategies(), safe=False)
```

In `website/views/__init__.py`, add `bets_strategies` to the `from .bets import (...)` block and to `__all__`.

In `website/urls.py`, add after the other `bets/` routes:

```python
    path("bets/strategies/", views.bets_strategies),
```

- [ ] **Step 4: Run, verify pass.** `uv run pytest website/tests/test_bets_backtest_api.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add website/views/bets.py website/views/__init__.py website/urls.py website/tests/test_bets_backtest_api.py
git commit -m "feat(bets): /strategies/ catalog endpoint"
```

---

## Task 14: `/api/bets/backtest/` endpoint (rate-limited, bounded)

**Files:**
- Modify: `website/views/bets.py`, `website/views/__init__.py`, `website/urls.py`
- Test: append to `website/tests/test_bets_backtest_api.py`

- [ ] **Step 1: Append failing tests**

```python
from datetime import date, timedelta
from decimal import Decimal

from website.models import PriceSnapshot, Ticker


def _seed_prices(days=120):
    t = Ticker.objects.create(
        symbol="BT", name="BTest", asset_type="stock", provider="alpha_vantage", provider_id="BT"
    )
    base = date(2020, 1, 1)
    for i in range(days):
        PriceSnapshot.objects.create(ticker=t, date=base + timedelta(days=i), price=Decimal(100 + i))
    return t


@pytest.mark.django_db
def test_backtest_returns_curve_and_metrics(client):
    t = _seed_prices()
    resp = client.post(
        "/api/bets/backtest/",
        data={"ticker_id": t.id, "strategy": "ma_crossover", "params": {"short": 5, "long": 20}, "period": "ALL"},
        content_type="application/json",
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["equity_curve"]) == len(body["benchmark_curve"]) == len(body["dates"])
    assert "total_return_pct" in body["metrics"]
    assert "total_return_pct" in body["benchmark_metrics"]


@pytest.mark.django_db
def test_backtest_unknown_strategy_400(client):
    t = _seed_prices(30)
    resp = client.post(
        "/api/bets/backtest/",
        data={"ticker_id": t.id, "strategy": "nope", "params": {}},
        content_type="application/json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_backtest_rate_limited(client, settings):
    t = _seed_prices(30)
    payload = {"ticker_id": t.id, "strategy": "buy_hold", "params": {}}
    # Exhaust the per-IP allowance, then expect 429.
    last = None
    for _ in range(31):
        last = client.post("/api/bets/backtest/", data=payload, content_type="application/json")
    assert last.status_code == 429
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_bets_backtest_api.py -k backtest -v` → FAIL.

- [ ] **Step 3: Implement the view**

In `website/views/bets.py`, add imports at top:

```python
from website.utils import get_client_ip
```

Add constants near the top of the file (after `PERIOD_DAYS`):

```python
BACKTEST_RATE_LIMIT = 30  # per IP
BACKTEST_RATE_WINDOW = 60  # seconds
```

Add the view at the end of the file:

```python
@csrf_exempt
def bets_backtest(request):
    """Public, rate-limited: run a backtest and return curves + metrics. Not persisted."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    ip = get_client_ip(request)
    key = f"backtest_rl:{ip}"
    try:
        count = cache.get(key, 0)
        if count >= BACKTEST_RATE_LIMIT:
            return JsonResponse({"error": "Too many backtests. Try again shortly."}, status=429)
        cache.set(key, count + 1, BACKTEST_RATE_WINDOW)
    except Exception:
        pass  # fail open if Redis is down

    body, err = parse_json_body(request)
    if err:
        return err

    strategy = get_strategy(body.get("strategy", ""))
    if strategy is None:
        return JsonResponse({"error": "Unknown strategy"}, status=400)

    try:
        ticker = Ticker.objects.get(pk=body.get("ticker_id"))
    except (Ticker.DoesNotExist, ValueError, TypeError):
        return JsonResponse({"error": "Ticker not found"}, status=404)

    period = body.get("period", "ALL")
    days = PERIOD_DAYS.get(period)
    qs = PriceSnapshot.objects.filter(ticker=ticker).order_by("date")
    if days is not None:
        qs = qs.filter(date__gte=date.today() - timedelta(days=days))

    prices = [(d, float(p)) for d, p in qs.values_list("date", "price")]
    if len(prices) < 2:
        return JsonResponse({"error": "Not enough price history for this asset/period"}, status=400)

    params = coerce_params(strategy, body.get("params") or {})
    result = run_backtest(prices, strategy, params)

    return JsonResponse(
        {
            "ticker": {"id": ticker.id, "symbol": ticker.symbol, "name": ticker.name, "currency": ticker.currency},
            "strategy": strategy.key,
            "params": params,
            "dates": result.dates,
            "equity_curve": result.equity_curve,
            "benchmark_curve": result.benchmark_curve,
            "trades": [t.to_dict() for t in result.trades],
            "metrics": result.metrics,
            "benchmark_metrics": result.benchmark_metrics,
        }
    )
```

In `website/views/__init__.py`, add `bets_backtest` to the bets import block and `__all__`. In `website/urls.py`, add:

```python
    path("bets/backtest/", views.bets_backtest),
```

- [ ] **Step 4: Run, verify pass.** `uv run pytest website/tests/test_bets_backtest_api.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add website/views/bets.py website/views/__init__.py website/urls.py website/tests/test_bets_backtest_api.py
git commit -m "feat(bets): /backtest/ endpoint (rate-limited, param-bounded)"
```

---

## Task 15: Frontend types + pure helpers

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/backtest.ts`, `frontend/src/lib/__tests__/backtest.test.ts`

- [ ] **Step 1: Add TypeScript interfaces to `frontend/src/lib/api.ts`**

Append after the existing `BetsSearchResult` interface:

```typescript
/* ── Bets: backtester + paper trading ──────────────────── */

export interface StrategyParam {
  name: string;
  label: string;
  type: "int" | "float";
  default: number;
  min: number;
  max: number;
}

export interface StrategyInfo {
  key: string;
  label: string;
  params: StrategyParam[];
}

export interface BacktestMetrics {
  total_return_pct: number;
  cagr_pct: number;
  max_drawdown_pct: number;
  sharpe: number;
  num_trades: number;
  win_rate_pct: number | null;
}

export interface BacktestTrade {
  date: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  cash_after: number;
  reason: string;
}

export interface BacktestResult {
  ticker: { id: number; symbol: string; name: string; currency: string };
  strategy: string;
  params: Record<string, number>;
  dates: string[];
  equity_curve: number[];
  benchmark_curve: number[];
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  benchmark_metrics: BacktestMetrics;
}

export interface PaperAccount {
  id: number;
  ticker: { id: number; symbol: string; name: string; currency: string };
  strategy: string;
  params: Record<string, number>;
  starting_cash: number;
  started_on: string;
  is_active: boolean;
  current_value: number | null;
  in_position: boolean;
  metrics: BacktestMetrics | null;
}

export interface PaperDetail extends PaperAccount {
  dates: string[];
  equity_curve: number[];
  trades: BacktestTrade[];
}
```

- [ ] **Step 2: Write failing vitest**

Create `frontend/src/lib/__tests__/backtest.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { curveToPoints, fmtMoney, fmtPct } from "../backtest";

describe("backtest helpers", () => {
  it("maps a curve to SVG points within the viewbox", () => {
    const pts = curveToPoints([100, 150, 200], 100, 50);
    const coords = pts.split(" ").map((p) => p.split(",").map(Number));
    expect(coords).toHaveLength(3);
    expect(coords[0][0]).toBe(0); // first x at 0
    expect(coords[2][0]).toBe(100); // last x at width
    expect(coords[0][1]).toBe(50); // min value -> bottom (y=height)
    expect(coords[2][1]).toBe(0); // max value -> top (y=0)
  });

  it("formats percentages with sign", () => {
    expect(fmtPct(12.345)).toBe("+12.35%");
    expect(fmtPct(-3.2)).toBe("-3.20%");
    expect(fmtPct(null)).toBe("—");
  });

  it("formats money", () => {
    expect(fmtMoney(1234.5)).toBe("$1,234.50");
  });
});
```

- [ ] **Step 3: Run, verify fail.** From `frontend/`: `pnpm test backtest` → FAIL.

- [ ] **Step 4: Implement `frontend/src/lib/backtest.ts`**

```typescript
/** Map a numeric series to SVG polyline points spanning [0,width] x [0,height] (y inverted). */
export function curveToPoints(curve: number[], width: number, height: number): string {
  if (curve.length === 0) return "";
  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const span = max - min || 1;
  const step = curve.length > 1 ? width / (curve.length - 1) : 0;
  return curve
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** Percent with explicit sign and 2 decimals; em-dash for null. */
export function fmtPct(pct: number | null): string {
  if (pct === null || pct === undefined) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/** USD money formatting. */
export function fmtMoney(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
```

- [ ] **Step 5: Run, verify pass; commit**

From `frontend/`: `pnpm test backtest` → PASS.

```bash
git add frontend/src/lib/api.ts frontend/src/lib/backtest.ts frontend/src/lib/__tests__/backtest.test.ts
git commit -m "feat(bets): frontend backtest types + pure helpers"
```

---

## Task 16: EquityCurve component + Backtester section + wire into page

**Files:**
- Create: `frontend/src/components/EquityCurve.tsx`, `frontend/src/app/bets/Backtester.tsx`
- Modify: `frontend/src/app/bets/page.tsx`

- [ ] **Step 1: Create `EquityCurve.tsx`**

A dual-line SVG chart (strategy vs. benchmark) with buy/sell markers. Mirrors the existing `<svg viewBox>`/`<polyline>` approach in `page.tsx`.

```tsx
"use client";

import type { BacktestTrade } from "@/lib/api";
import { curveToPoints } from "@/lib/backtest";

const W = 600;
const H = 220;

export default function EquityCurve({
  strategy,
  benchmark,
  dates,
  trades,
  accent,
}: {
  strategy: number[];
  benchmark: number[];
  dates: string[];
  trades: BacktestTrade[];
  accent: string;
}) {
  if (strategy.length < 2) return null;
  const all = [...strategy, ...benchmark];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const step = W / (strategy.length - 1);
  const dateIndex = (d: string) => dates.indexOf(d);
  const yFor = (v: number) => H - ((v - min) / span) * H;

  // points use a shared scale so the two lines are comparable
  const pts = (curve: number[]) =>
    curve.map((v, i) => `${(i * step).toFixed(2)},${yFor(v).toFixed(2)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} aria-label="Equity curve">
      {/* benchmark (buy & hold) — muted */}
      <polyline points={pts(benchmark)} fill="none" stroke="#888" strokeWidth={1.5} strokeDasharray="4 3" />
      {/* strategy — accent */}
      <polyline points={pts(strategy)} fill="none" stroke={accent} strokeWidth={2} />
      {/* trade markers */}
      {trades.map((t, i) => {
        const idx = dateIndex(t.date);
        if (idx < 0) return null;
        return (
          <circle
            key={i}
            cx={(idx * step).toFixed(2)}
            cy={yFor(strategy[idx]).toFixed(2)}
            r={3}
            fill={t.side === "buy" ? "#22c55e" : "#ef4444"}
          />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 2: Create `Backtester.tsx`**

Self-contained section: loads strategies, lets the visitor pick ticker + strategy + params, runs the backtest, renders the chart + metric cards (strategy vs. benchmark). Uses `curveToPoints` indirectly via `EquityCurve`, plus `fmtPct`/`fmtMoney`.

```tsx
"use client";

import { useEffect, useState } from "react";

import EquityCurve from "@/components/EquityCurve";
import {
  API,
  type BacktestResult,
  type BetsTicker,
  type StrategyInfo,
} from "@/lib/api";
import { fmtMoney, fmtPct } from "@/lib/backtest";

export default function Backtester({ tickers, accent }: { tickers: BetsTicker[]; accent: string }) {
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [tickerId, setTickerId] = useState<number | null>(null);
  const [strategyKey, setStrategyKey] = useState<string>("");
  const [params, setParams] = useState<Record<string, number>>({});
  const [period, setPeriod] = useState("ALL");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/bets/strategies/`)
      .then((r) => r.json())
      .then((data: StrategyInfo[]) => {
        setStrategies(data);
        if (data.length) selectStrategy(data[0]);
      });
    if (tickers.length) setTickerId(tickers[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectStrategy(s: StrategyInfo) {
    setStrategyKey(s.key);
    setParams(Object.fromEntries(s.params.map((p) => [p.name, p.default])));
  }

  const current = strategies.find((s) => s.key === strategyKey);

  async function run() {
    if (!tickerId || !strategyKey) return;
    setRunning(true);
    setError(null);
    try {
      const resp = await fetch(`${API}/api/bets/backtest/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker_id: tickerId, strategy: strategyKey, params, period }),
      });
      const body = await resp.json();
      if (!resp.ok) {
        setError(body.error || "Backtest failed");
        setResult(null);
      } else {
        setResult(body);
      }
    } catch {
      setError("Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section style={{ marginTop: "3rem" }}>
      <h2 className="tag">Backtest sandbox</h2>

      {/* controls */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <select value={tickerId ?? ""} onChange={(e) => setTickerId(Number(e.target.value))}>
          {tickers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.symbol} — {t.name}
            </option>
          ))}
        </select>

        <select value={strategyKey} onChange={(e) => selectStrategy(strategies.find((s) => s.key === e.target.value)!)}>
          {strategies.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>

        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {["1Y", "3M", "1M", "ALL"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        {current?.params.map((p) => (
          <label key={p.name} style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem" }}>
            {p.label}
            <input
              type="number"
              value={params[p.name] ?? p.default}
              min={p.min}
              max={p.max}
              step={p.type === "int" ? 1 : 0.1}
              onChange={(e) => setParams({ ...params, [p.name]: Number(e.target.value) })}
              style={{ width: 90 }}
            />
          </label>
        ))}

        <button onClick={run} disabled={running} style={{ borderColor: accent, color: accent }}>
          {running ? "Running…" : "Run backtest"}
        </button>
      </div>

      {error && <p style={{ color: "#ef4444" }}>{error}</p>}

      {result && (
        <div>
          <EquityCurve
            strategy={result.equity_curve}
            benchmark={result.benchmark_curve}
            dates={result.dates}
            trades={result.trades}
            accent={accent}
          />
          <p style={{ fontSize: "0.75rem", color: "#888" }}>
            <span style={{ color: accent }}>━ strategy</span> &nbsp; <span>┄ buy &amp; hold</span>
          </p>
          <MetricsTable m={result} />
        </div>
      )}
    </section>
  );
}

function MetricsTable({ m }: { m: BacktestResult }) {
  const rows: [string, string, string][] = [
    ["Total return", fmtPct(m.metrics.total_return_pct), fmtPct(m.benchmark_metrics.total_return_pct)],
    ["CAGR", fmtPct(m.metrics.cagr_pct), fmtPct(m.benchmark_metrics.cagr_pct)],
    ["Max drawdown", fmtPct(m.metrics.max_drawdown_pct), fmtPct(m.benchmark_metrics.max_drawdown_pct)],
    ["Sharpe", m.metrics.sharpe.toFixed(2), m.benchmark_metrics.sharpe.toFixed(2)],
    ["Trades", String(m.metrics.num_trades), String(m.benchmark_metrics.num_trades)],
    ["Win rate", fmtPct(m.metrics.win_rate_pct), "—"],
  ];
  return (
    <table style={{ width: "100%", fontSize: "0.85rem", marginTop: "1rem" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Metric</th>
          <th style={{ textAlign: "right" }}>Strategy</th>
          <th style={{ textAlign: "right" }}>Buy &amp; Hold</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b]) => (
          <tr key={label}>
            <td>{label}</td>
            <td style={{ textAlign: "right" }}>{a}</td>
            <td style={{ textAlign: "right", color: "#888" }}>{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

> NOTE on styling: this uses minimal inline styles to stay self-contained. When implementing, match the existing card/`.tag`/`.corner-*` classes used elsewhere in `page.tsx` so it visually fits. `fmtMoney` is imported for use in the paper-trading section (Task 21); if linting complains about an unused import here, remove it from this file.

- [ ] **Step 3: Wire into `page.tsx`**

In `frontend/src/app/bets/page.tsx`, add the import at the top:

```tsx
import Backtester from "./Backtester";
```

Inside the `BetsPage` component's returned JSX, after the closing tag of the ticker grid section (before the page container closes), render:

```tsx
      {tickers.length > 0 && <Backtester tickers={tickers} accent="var(--accent)" />}
```

- [ ] **Step 4: Verify build + visual check**

Run from `frontend/`: `pnpm lint && pnpm build`
Expected: build succeeds, no type/lint errors.

Then `pnpm dev`, open `http://localhost:3001/bets`, pick a ticker + MA Crossover, Run, and confirm the equity curve + metrics render. (Requires backend running with backfilled data; if no data, the endpoint returns the "Not enough price history" message — that's expected until backfill runs.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EquityCurve.tsx frontend/src/app/bets/Backtester.tsx frontend/src/app/bets/page.tsx
git commit -m "feat(bets): interactive backtest sandbox UI"
```

---

## Task 17: Phase A docs

**Files:**
- Modify: `docs/README.md`, `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Update `docs/README.md`**

Find the section describing the `/bets` page and append a paragraph:

> **Backtester:** the bets page now includes an interactive backtest sandbox. Visitors pick an asset, a strategy (Buy & Hold, Moving-Average Crossover, Dollar-Cost Averaging, MACD, Bollinger Bands, RSI, Time-Series Momentum), and parameters, then see an equity curve and performance metrics scored against a buy-and-hold benchmark. No real trades are made — it replays historical prices only.

- [ ] **Step 2: Update `docs/QA-CHECKLIST.md`**

Add under the bets section:

```markdown
### Bets — Backtester
- [ ] `/bets` shows the "Backtest sandbox" section below the ticker grid
- [ ] Selecting a ticker + strategy + params and clicking "Run backtest" renders an equity curve
- [ ] The strategy line and the dashed buy & hold line both render
- [ ] Buy (green) and sell (red) markers appear on the curve for trading strategies
- [ ] Metrics table shows return / CAGR / drawdown / Sharpe / trades / win rate vs. buy & hold
- [ ] An asset with too little history shows a clear "not enough history" message, not a crash
- [ ] Spamming "Run" eventually returns a rate-limit message (HTTP 429)
```

- [ ] **Step 3: Commit**

```bash
git add docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs(bets): document backtester"
```

---

# PHASE B — Paper Trading

## Task 18: Paper-trading models

**Files:**
- Create: `website/models/paper_account.py`, `website/models/paper_trade.py`, `website/models/paper_snapshot.py`
- Modify: `website/models/__init__.py`
- Test: `website/tests/test_paper.py` (model creation smoke test)

- [ ] **Step 1: Write failing test**

Create `website/tests/test_paper.py`:

```python
from datetime import date
from decimal import Decimal

import pytest

from website.models import PaperAccount, PaperSnapshot, PaperTrade, Ticker


@pytest.mark.django_db
def test_paper_models_relate():
    t = Ticker.objects.create(symbol="P", name="P", asset_type="stock", provider="alpha_vantage", provider_id="P")
    acct = PaperAccount.objects.create(
        ticker=t, strategy="buy_hold", params={}, starting_cash=Decimal("10000"), started_on=date(2020, 1, 1)
    )
    PaperTrade.objects.create(
        account=acct, date=date(2020, 1, 2), side="buy", shares=Decimal("10"),
        price=Decimal("100"), cash_after=Decimal("9000"), reason="entry"
    )
    PaperSnapshot.objects.create(
        account=acct, date=date(2020, 1, 2), portfolio_value=Decimal("10000"),
        cash=Decimal("9000"), position_value=Decimal("1000")
    )
    assert acct.trades.count() == 1
    assert acct.snapshots.count() == 1
    assert acct.is_active is True
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_paper.py -v` → FAIL (ImportError).

- [ ] **Step 3: Create the three model files**

`website/models/paper_account.py`:

```python
from django.db import models


class PaperAccount(models.Model):
    ticker = models.ForeignKey("Ticker", on_delete=models.CASCADE, related_name="paper_accounts")
    strategy = models.CharField(max_length=32)
    params = models.JSONField(default=dict)
    starting_cash = models.DecimalField(max_digits=14, decimal_places=2, default=10000)
    started_on = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.ticker.symbol} / {self.strategy}"
```

`website/models/paper_trade.py`:

```python
from django.db import models


class PaperTrade(models.Model):
    account = models.ForeignKey("PaperAccount", on_delete=models.CASCADE, related_name="trades")
    date = models.DateField()
    side = models.CharField(max_length=4)  # "buy" | "sell"
    shares = models.DecimalField(max_digits=20, decimal_places=8)
    price = models.DecimalField(max_digits=14, decimal_places=4)
    cash_after = models.DecimalField(max_digits=14, decimal_places=2)
    reason = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["date"]

    def __str__(self):
        return f"{self.account_id} {self.side} {self.date}"
```

`website/models/paper_snapshot.py`:

```python
from django.db import models


class PaperSnapshot(models.Model):
    account = models.ForeignKey("PaperAccount", on_delete=models.CASCADE, related_name="snapshots")
    date = models.DateField()
    portfolio_value = models.DecimalField(max_digits=16, decimal_places=2)
    cash = models.DecimalField(max_digits=16, decimal_places=2)
    position_value = models.DecimalField(max_digits=16, decimal_places=2)

    class Meta:
        unique_together = [("account", "date")]
        ordering = ["date"]
        indexes = [models.Index(fields=["account", "date"])]

    def __str__(self):
        return f"{self.account_id} {self.date}: {self.portfolio_value}"
```

- [ ] **Step 4: Export + migrate + run test**

In `website/models/__init__.py`, add imports and `__all__` entries for `PaperAccount`, `PaperTrade`, `PaperSnapshot` (follow the existing alphabetical-ish style; add the three `from .paper_* import ...` lines and the three names to `__all__`).

Run:
```bash
uv run python manage.py makemigrations website
uv run python manage.py migrate
uv run pytest website/tests/test_paper.py -v
```
Expected: migration created + applied; test PASSES.

- [ ] **Step 5: Commit**

```bash
git add website/models/ website/tests/test_paper.py
git commit -m "feat(bets): paper-trading models + migration"
```

---

## Task 19: Paper advance service + tick command + sync hook

The advance logic reuses the SAME execution rules as the backtest engine, applied to one new day. It is **idempotent**: a date already snapshotted is skipped.

**Files:**
- Create: `website/services/paper.py`
- Create: `website/management/commands/tick_paper_accounts.py`
- Modify: `website/management/commands/sync_prices.py`
- Test: append to `website/tests/test_paper.py`

- [ ] **Step 1: Append failing tests (incl. idempotency)**

```python
from website.models import PriceSnapshot
from datetime import timedelta


@pytest.mark.django_db
def test_advance_account_is_idempotent():
    from website.services.paper import advance_account

    t = Ticker.objects.create(symbol="Q", name="Q", asset_type="stock", provider="alpha_vantage", provider_id="Q")
    base = date(2020, 1, 1)
    for i in range(5):
        PriceSnapshot.objects.create(ticker=t, date=base + timedelta(days=i), price=Decimal(100 + i))
    acct = PaperAccount.objects.create(
        ticker=t, strategy="buy_hold", params={}, starting_cash=Decimal("10000"), started_on=base
    )

    advance_account(acct)
    first_count = PaperSnapshot.objects.filter(account=acct).count()
    assert first_count == 5  # one snapshot per available day

    advance_account(acct)  # run again — must not duplicate
    assert PaperSnapshot.objects.filter(account=acct).count() == first_count


@pytest.mark.django_db
def test_advance_account_buys_and_holds():
    from website.services.paper import advance_account

    t = Ticker.objects.create(symbol="R", name="R", asset_type="stock", provider="alpha_vantage", provider_id="R")
    base = date(2020, 1, 1)
    for i in range(5):
        PriceSnapshot.objects.create(ticker=t, date=base + timedelta(days=i), price=Decimal(100))
    acct = PaperAccount.objects.create(
        ticker=t, strategy="buy_hold", params={}, starting_cash=Decimal("10000"), started_on=base
    )
    advance_account(acct)
    assert acct.trades.filter(side="buy").exists()
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_paper.py -k advance -v` → FAIL.

- [ ] **Step 3: Implement `website/services/paper.py`**

Reuses the backtest `_simulate` over the account's full price history from `started_on`, then writes only the snapshots/trades that don't yet exist (idempotent re-derivation — simplest correct approach for daily data).

```python
"""Advance paper-trading accounts one sync at a time. Reuses the backtest execution rules."""

from decimal import Decimal

from django.db import transaction

from website.models import PaperSnapshot, PaperTrade, PriceSnapshot
from website.services.backtest import _simulate
from website.strategies import coerce_params, get_strategy

FEE_PCT = 0.001


@transaction.atomic
def advance_account(account) -> None:
    """Recompute the account from its full history and persist any new snapshots/trades.

    Idempotent: existing snapshot dates are left untouched; only missing days are written.
    """
    strategy = get_strategy(account.strategy)
    if strategy is None:
        return

    prices = [
        (d, float(p))
        for d, p in PriceSnapshot.objects.filter(ticker=account.ticker, date__gte=account.started_on)
        .order_by("date")
        .values_list("date", "price")
    ]
    if len(prices) < 1:
        return

    params = coerce_params(strategy, account.params or {})
    curve, trades = _simulate(prices, strategy, params, float(account.starting_cash), FEE_PCT)

    existing_snap_dates = set(account.snapshots.values_list("date", flat=True))
    existing_trade_keys = {(t.date, t.side) for t in account.trades.all()}

    dates = [d for d, _ in prices]
    new_snaps = []
    for i, d in enumerate(dates):
        if d in existing_snap_dates:
            continue
        value = curve[i]
        # position value is unknown directly from curve; recompute cash vs position split:
        # snapshots store portfolio_value, and we approximate cash/position from trades up to d.
        new_snaps.append(
            PaperSnapshot(
                account=account,
                date=d,
                portfolio_value=Decimal(str(round(value, 2))),
                cash=Decimal("0"),
                position_value=Decimal("0"),
            )
        )
    if new_snaps:
        PaperSnapshot.objects.bulk_create(new_snaps)

    new_trades = []
    for t in trades:
        from datetime import date as _date

        td = _date.fromisoformat(t.date)
        if (td, t.side) in existing_trade_keys:
            continue
        new_trades.append(
            PaperTrade(
                account=account,
                date=td,
                side=t.side,
                shares=Decimal(str(round(t.shares, 8))),
                price=Decimal(str(round(t.price, 4))),
                cash_after=Decimal(str(round(t.cash_after, 2))),
                reason=t.reason[:120],
            )
        )
    if new_trades:
        PaperTrade.objects.bulk_create(new_trades)
```

> NOTE: cash/position split. To populate `cash` and `position_value` accurately, extend `_simulate` (Task 11 file) to also return per-day `cash` and `shares` lists, OR keep the simpler `portfolio_value`-only snapshots shown above (cash/position set to 0). RECOMMENDATION for this plan: extend `_simulate` to additionally return `cash_curve` and `shares_curve` and have `run_backtest` ignore them (backward compatible via tuple unpacking). If you take the simple path, update `test_advance_account_*` expectations accordingly and note cash/position columns are placeholders. Pick the extended path: modify `_simulate` to `return curve, trades, cash_curve, shares_curve` and update its two call sites in `run_backtest` and here. (This is a deliberate, contained refactor — do it as the first step of implementation here, re-running Task 11's tests to confirm green.)

- [ ] **Step 4: Implement the tick command + sync hook; run tests**

Create `website/management/commands/tick_paper_accounts.py`:

```python
from django.core.management.base import BaseCommand

from website.models import PaperAccount
from website.services.paper import advance_account


class Command(BaseCommand):
    help = "Advance all active paper-trading accounts by any unprocessed days."

    def handle(self, *_args, **_options):
        accounts = PaperAccount.objects.filter(is_active=True)
        for acct in accounts:
            try:
                advance_account(acct)
                self.stdout.write(f"  account {acct.id} ({acct.ticker.symbol}/{acct.strategy}): advanced")
            except Exception as e:  # noqa: BLE001
                self.stderr.write(f"  account {acct.id}: ERROR — {e}")
        self.stdout.write(f"Ticked {accounts.count()} active account(s)")
```

In `website/management/commands/sync_prices.py`, at the very end of `handle` (after the status `cache.set` block), add:

```python
        # Advance paper-trading accounts with the freshly-synced prices.
        try:
            call_command("tick_paper_accounts")
        except Exception as e:  # noqa: BLE001
            self.stderr.write(f"Paper tick failed: {e}")
```

Add the import at the top of `sync_prices.py`:

```python
from django.core.management import call_command
```

Run: `uv run pytest website/tests/test_paper.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/services/paper.py website/management/commands/tick_paper_accounts.py website/management/commands/sync_prices.py website/services/backtest.py website/tests/test_paper.py website/tests/test_backtest.py
git commit -m "feat(bets): paper-trading advance service + sync hook"
```

---

## Task 20: Paper-trading API endpoints

**Files:**
- Modify: `website/views/bets.py`, `website/views/__init__.py`, `website/urls.py`
- Test: `website/tests/test_paper_api.py`

- [ ] **Step 1: Write failing tests**

Create `website/tests/test_paper_api.py`:

```python
from datetime import date, timedelta
from decimal import Decimal

import pytest

from website.models import PaperAccount, PriceSnapshot, Ticker


def _ticker_with_prices():
    t = Ticker.objects.create(symbol="PA", name="PA", asset_type="stock", provider="alpha_vantage", provider_id="PA")
    base = date(2020, 1, 1)
    for i in range(10):
        PriceSnapshot.objects.create(ticker=t, date=base + timedelta(days=i), price=Decimal(100 + i))
    return t


@pytest.mark.django_db
def test_create_requires_admin(client):
    t = _ticker_with_prices()
    resp = client.post(
        "/api/bets/paper/create/",
        data={"ticker_id": t.id, "strategy": "buy_hold", "params": {}},
        content_type="application/json",
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_admin_can_create_and_list(client, auth_headers):
    t = _ticker_with_prices()
    resp = client.post(
        "/api/bets/paper/create/",
        data={"ticker_id": t.id, "strategy": "buy_hold", "params": {}, "starting_cash": 10000},
        content_type="application/json",
        **auth_headers,
    )
    assert resp.status_code == 201
    listing = client.get("/api/bets/paper/").json()
    assert len(listing) == 1
    assert listing[0]["strategy"] == "buy_hold"


@pytest.mark.django_db
def test_detail_and_stop_and_delete(client, auth_headers):
    t = _ticker_with_prices()
    acct = PaperAccount.objects.create(
        ticker=t, strategy="buy_hold", params={}, starting_cash=Decimal("10000"), started_on=date(2020, 1, 1)
    )
    detail = client.get(f"/api/bets/paper/{acct.id}/")
    assert detail.status_code == 200
    assert "equity_curve" in detail.json()

    stop = client.post(f"/api/bets/paper/{acct.id}/stop/", **auth_headers)
    assert stop.status_code == 200
    acct.refresh_from_db()
    assert acct.is_active is False

    dele = client.post(f"/api/bets/paper/{acct.id}/delete/", **auth_headers)
    assert dele.status_code == 200
    assert not PaperAccount.objects.filter(id=acct.id).exists()
```

- [ ] **Step 2: Run, verify fail.** `uv run pytest website/tests/test_paper_api.py -v` → FAIL (404/401-shaped).

- [ ] **Step 3: Implement views + serializer helper**

Add to `website/views/bets.py`:

```python
from website.models import PaperAccount, PaperSnapshot, PaperTrade
from website.services.paper import advance_account


def _serialize_paper(acct, detail=False):
    snaps = list(acct.snapshots.order_by("date").values_list("date", "portfolio_value"))
    curve = [float(v) for _, v in snaps]
    dates = [str(d) for d, _ in snaps]
    trades = list(acct.trades.order_by("date"))
    in_position = False
    if trades:
        in_position = trades[-1].side == "buy"
    metrics = None
    if curve:
        from website.services.backtest import compute_metrics

        metrics = compute_metrics([d for d, _ in snaps], curve, _trades_as_dataclasses(trades), float(acct.starting_cash))
    data = {
        "id": acct.id,
        "ticker": {
            "id": acct.ticker.id,
            "symbol": acct.ticker.symbol,
            "name": acct.ticker.name,
            "currency": acct.ticker.currency,
        },
        "strategy": acct.strategy,
        "params": acct.params,
        "starting_cash": float(acct.starting_cash),
        "started_on": str(acct.started_on),
        "is_active": acct.is_active,
        "current_value": curve[-1] if curve else None,
        "in_position": in_position,
        "metrics": metrics,
    }
    if detail:
        data["dates"] = dates
        data["equity_curve"] = curve
        data["trades"] = [
            {
                "date": str(t.date),
                "side": t.side,
                "shares": float(t.shares),
                "price": float(t.price),
                "cash_after": float(t.cash_after),
                "reason": t.reason,
            }
            for t in trades
        ]
    return data


def _trades_as_dataclasses(trades):
    from website.services.backtest import Trade

    return [Trade(str(t.date), t.side, float(t.shares), float(t.price), float(t.cash_after), t.reason) for t in trades]


@require_GET
def bets_paper_list(_request):
    """Public: all paper accounts with latest value + metrics."""
    accts = PaperAccount.objects.select_related("ticker").prefetch_related("snapshots", "trades")
    return JsonResponse([_serialize_paper(a) for a in accts], safe=False)


@require_GET
def bets_paper_detail(_request, account_id):
    """Public: one account with full equity curve + trades."""
    try:
        acct = PaperAccount.objects.select_related("ticker").get(pk=account_id)
    except PaperAccount.DoesNotExist:
        return JsonResponse({"error": "Account not found"}, status=404)
    return JsonResponse(_serialize_paper(acct, detail=True))


@csrf_exempt
@require_admin
def bets_paper_create(request):
    """Admin: start a paper run. Immediately advances it over existing history."""
    body, err = parse_json_body(request)
    if err:
        return err
    strategy = get_strategy(body.get("strategy", ""))
    if strategy is None:
        return JsonResponse({"error": "Unknown strategy"}, status=400)
    try:
        ticker = Ticker.objects.get(pk=body.get("ticker_id"))
    except (Ticker.DoesNotExist, ValueError, TypeError):
        return JsonResponse({"error": "Ticker not found"}, status=404)

    first = PriceSnapshot.objects.filter(ticker=ticker).order_by("date").values_list("date", flat=True).first()
    if first is None:
        return JsonResponse({"error": "No price history for this ticker"}, status=400)

    acct = PaperAccount.objects.create(
        ticker=ticker,
        strategy=strategy.key,
        params=coerce_params(strategy, body.get("params") or {}),
        starting_cash=body.get("starting_cash", 10000),
        started_on=first,
    )
    advance_account(acct)
    return JsonResponse(_serialize_paper(acct), status=201)


@csrf_exempt
@require_admin
def bets_paper_stop(_request, account_id):
    """Admin: stop an account (keeps history)."""
    try:
        acct = PaperAccount.objects.get(pk=account_id)
    except PaperAccount.DoesNotExist:
        return JsonResponse({"error": "Account not found"}, status=404)
    acct.is_active = False
    acct.save(update_fields=["is_active"])
    return JsonResponse({"ok": True})


@csrf_exempt
@require_admin
def bets_paper_delete(_request, account_id):
    """Admin: delete an account and its trades/snapshots."""
    try:
        acct = PaperAccount.objects.get(pk=account_id)
    except PaperAccount.DoesNotExist:
        return JsonResponse({"error": "Account not found"}, status=404)
    acct.delete()
    return JsonResponse({"ok": True})
```

In `website/views/__init__.py`, add `bets_paper_list`, `bets_paper_detail`, `bets_paper_create`, `bets_paper_stop`, `bets_paper_delete` to the bets import block and `__all__`.

In `website/urls.py`, add:

```python
    path("bets/paper/", views.bets_paper_list),
    path("bets/paper/create/", views.bets_paper_create),
    path("bets/paper/<int:account_id>/", views.bets_paper_detail),
    path("bets/paper/<int:account_id>/stop/", views.bets_paper_stop),
    path("bets/paper/<int:account_id>/delete/", views.bets_paper_delete),
```

> NOTE: order matters — `paper/create/` must be listed before `paper/<int:account_id>/` is fine since `create` is not an int, but keep `paper/` (list) and `paper/create/` before the `<int>` patterns for clarity.

- [ ] **Step 4: Run, verify pass.** `uv run pytest website/tests/test_paper_api.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add website/views/bets.py website/views/__init__.py website/urls.py website/tests/test_paper_api.py
git commit -m "feat(bets): paper-trading API endpoints"
```

---

## Task 21: Paper-trading showcase UI

**Files:**
- Create: `frontend/src/app/bets/PaperTrading.tsx`
- Modify: `frontend/src/app/bets/page.tsx`

- [ ] **Step 1: Create `PaperTrading.tsx`**

Public showcase of active accounts; admin sees create/stop/delete controls. Reuses `EquityCurve`, `fmtMoney`, `fmtPct`.

```tsx
"use client";

import { useEffect, useState } from "react";

import EquityCurve from "@/components/EquityCurve";
import { API, type BetsTicker, type PaperAccount, type PaperDetail, type StrategyInfo } from "@/lib/api";
import { store } from "@/lib/auth";
import { fmtMoney, fmtPct } from "@/lib/backtest";

export default function PaperTrading({
  tickers,
  strategies,
  accent,
  isAdmin,
}: {
  tickers: BetsTicker[];
  strategies: StrategyInfo[];
  accent: string;
  isAdmin: boolean;
}) {
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [details, setDetails] = useState<Record<number, PaperDetail>>({});

  function load() {
    fetch(`${API}/api/bets/paper/`)
      .then((r) => r.json())
      .then(setAccounts);
  }
  useEffect(load, []);

  async function expand(id: number) {
    if (details[id]) return;
    const d = await fetch(`${API}/api/bets/paper/${id}/`).then((r) => r.json());
    setDetails((prev) => ({ ...prev, [id]: d }));
  }

  async function create(tickerId: number, strategy: string) {
    const token = store("adminToken");
    await fetch(`${API}/api/bets/paper/create/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ticker_id: tickerId, strategy, params: {}, starting_cash: 10000 }),
    });
    load();
  }

  async function action(id: number, verb: "stop" | "delete") {
    const token = store("adminToken");
    await fetch(`${API}/api/bets/paper/${id}/${verb}/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  }

  if (accounts.length === 0 && !isAdmin) return null;

  return (
    <section style={{ marginTop: "3rem" }}>
      <h2 className="tag">Paper trading</h2>

      {isAdmin && (
        <AdminCreate tickers={tickers} strategies={strategies} accent={accent} onCreate={create} />
      )}

      <div style={{ display: "grid", gap: "1.5rem", marginTop: "1rem" }}>
        {accounts.map((a) => {
          const d = details[a.id];
          return (
            <div key={a.id} className="corner-tl corner-br" style={{ padding: "1rem", border: "1px solid #333" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>
                  {a.ticker.symbol} · {a.strategy} {a.is_active ? "" : "(stopped)"}
                </strong>
                <span>
                  {a.current_value !== null ? fmtMoney(a.current_value) : "—"}{" "}
                  {a.metrics && (
                    <span style={{ color: a.metrics.total_return_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                      {fmtPct(a.metrics.total_return_pct)}
                    </span>
                  )}
                </span>
              </div>

              <p style={{ fontSize: "0.8rem", color: "#888" }}>
                {a.in_position ? "● holding" : "○ in cash"} · since {a.started_on}
              </p>

              <button onClick={() => expand(a.id)} style={{ fontSize: "0.75rem" }}>
                {d ? "" : "Show chart"}
              </button>

              {d && (
                <EquityCurve
                  strategy={d.equity_curve}
                  benchmark={d.equity_curve}
                  dates={d.dates}
                  trades={d.trades}
                  accent={accent}
                />
              )}

              {isAdmin && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {a.is_active && (
                    <button onClick={() => action(a.id, "stop")} style={{ fontSize: "0.75rem" }}>
                      Stop
                    </button>
                  )}
                  <button onClick={() => action(a.id, "delete")} style={{ fontSize: "0.75rem", color: "#ef4444" }}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AdminCreate({
  tickers,
  strategies,
  accent,
  onCreate,
}: {
  tickers: BetsTicker[];
  strategies: StrategyInfo[];
  accent: string;
  onCreate: (tickerId: number, strategy: string) => void;
}) {
  const [tickerId, setTickerId] = useState<number>(tickers[0]?.id ?? 0);
  const [strategy, setStrategy] = useState<string>(strategies[0]?.key ?? "");
  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <select value={tickerId} onChange={(e) => setTickerId(Number(e.target.value))}>
        {tickers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.symbol}
          </option>
        ))}
      </select>
      <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
        {strategies.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <button onClick={() => onCreate(tickerId, strategy)} style={{ borderColor: accent, color: accent }}>
        Start paper run
      </button>
    </div>
  );
}
```

> NOTE: the detail endpoint returns only the strategy's own equity curve (no benchmark curve persisted for paper accounts), so `EquityCurve` is passed the strategy curve for both props — the benchmark line overlaps. If you want a true benchmark line here, compute a buy & hold curve over the same dates in `_serialize_paper(detail=True)` and add a `benchmark_curve` field; this is an optional enhancement, not required for v1.

- [ ] **Step 2: Wire into `page.tsx`**

`Backtester` already fetches strategies; to avoid a second fetch, lift the strategies fetch into `page.tsx` and pass down, OR let `PaperTrading` fetch its own. SIMPLEST: have `page.tsx` fetch the strategy catalog once and pass to both. In `page.tsx`:

- add state: `const [strategies, setStrategies] = useState<StrategyInfo[]>([]);`
- in the initial `useEffect`, add: `fetch(`${API}/api/bets/strategies/`).then(r => r.json()).then(setStrategies);`
- import `PaperTrading` and `StrategyInfo`.
- render after `<Backtester ... />`:

```tsx
      <PaperTrading tickers={tickers} strategies={strategies} accent="var(--accent)" isAdmin={isAdmin} />
```

(Backtester can keep its own strategies fetch, or accept `strategies` as a prop — passing it down is cleaner. If you pass it down, update `Backtester`'s props to accept `strategies` and remove its internal fetch.)

- [ ] **Step 3: Verify build + visual check**

From `frontend/`: `pnpm lint && pnpm build` → succeeds.
With backend running + at least one paper account created via `/sudo`, confirm the showcase renders cards, the chart expands, and admin controls work.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/bets/PaperTrading.tsx frontend/src/app/bets/page.tsx
git commit -m "feat(bets): paper-trading showcase UI"
```

---

## Task 22: Phase B docs + full suite

**Files:**
- Modify: `docs/README.md`, `docs/QA-CHECKLIST.md`

- [ ] **Step 1: Update `docs/README.md`**

Append to the bets section:

> **Paper trading:** the site owner can start "pretend money" runs from `/sudo` — a strategy + asset + starting cash. A daily job (piggybacked on the price sync) advances each active run, recording simulated trades. The public bets page shows each run's live equity curve, current position, and performance. No real money is ever involved.

- [ ] **Step 2: Update `docs/QA-CHECKLIST.md`**

```markdown
### Bets — Paper trading
- [ ] Public `/bets` shows the "Paper trading" section when accounts exist
- [ ] Each account card shows current value, total return %, and in-position/cash status
- [ ] "Show chart" expands a live equity curve with trade markers
- [ ] As admin (`/sudo`), "Start paper run" creates a new account that appears immediately
- [ ] As admin, "Stop" marks the account stopped (history retained); "Delete" removes it
- [ ] Non-admins cannot create/stop/delete (API returns 401)
- [ ] Running `sync_prices` advances active accounts (new snapshot per new day, no duplicates)
```

- [ ] **Step 3: Run the FULL backend + frontend suites**

```bash
uv run pytest
cd frontend && pnpm test && pnpm lint && pnpm build
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/README.md docs/QA-CHECKLIST.md
git commit -m "docs(bets): document paper trading"
```

---

## Post-implementation (manual, one-time)

After merge + deploy, run the deep-history backfill ONCE on the server (it hits provider rate limits, so it's not part of CI):

```bash
uv run python manage.py backfill_history
```

Then optionally create a few showcase paper accounts via `/sudo` so the public page isn't empty.

---

## Self-Review Notes (for the implementing agent)

- **No-lookahead** is enforced structurally: `_simulate` passes `closes[:i+1]` and fills the prior day's signal at today's close. Task 11's `test_no_lookahead_signal_only_sees_prefix` guards this — do not "optimize" it away.
- **Shared engine:** paper trading calls the exact same `_simulate`. If you change execution rules, both backtest and paper update together — re-run `test_backtest.py` AND `test_paper.py`.
- **`_simulate` return signature:** Task 19 extends it to return `(curve, trades, cash_curve, shares_curve)`. Update both call sites in `run_backtest` and `advance_account`, and re-run Task 11 tests.
- **Strategy registry import:** `website/strategies/__init__.py` imports all 7 modules; the full suite only passes once Task 9 completes. Tasks 3–8 test via direct module imports.
- **Frontend file size:** new UI lives in `Backtester.tsx`/`PaperTrading.tsx`/`EquityCurve.tsx`, not in the already-large `page.tsx`.
