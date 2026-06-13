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
    return [{"key": s.key, "label": s.label, "params": [p.to_dict() for p in s.params]} for s in STRATEGIES.values()]


__all__ = ["STRATEGIES", "Param", "Signal", "Strategy", "coerce_params", "get_strategy", "list_strategies"]
