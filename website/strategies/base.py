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
