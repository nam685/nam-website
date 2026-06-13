from website.strategies.base import Signal


class BuyHoldStrategy:
    key = "buy_hold"
    label = "Buy & Hold"
    params: list = []

    def signal(self, closes: list[float], position_shares: float, params: dict) -> Signal:  # noqa: ARG002
        if position_shares <= 0:
            return Signal(action="buy", reason="Initial buy-and-hold entry")
        return Signal(action="hold")
