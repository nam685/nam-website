from website.strategies.base import Param, Signal


class DCAStrategy:
    key = "dca"
    label = "Dollar-Cost Averaging"
    params = [
        Param("amount", "Buy amount ($)", "float", 500, 1, 100000),
        Param("interval", "Every N days", "int", 30, 1, 365),
    ]

    def signal(self, closes: list[float], position_shares: float, params: dict) -> Signal:  # noqa: ARG002
        index = len(closes) - 1
        if index % params["interval"] == 0:
            return Signal(action="buy", dollars=float(params["amount"]), reason="Scheduled DCA buy")
        return Signal(action="hold")
