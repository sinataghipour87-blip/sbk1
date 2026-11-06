"""Direction-aware guard that forbids increasing trade risk."""

from yash.contracts.models import TradeState


def is_stop_tighter(direction: str, current_stop: float, proposed_stop: float) -> bool:
    if direction == "LONG":
        return proposed_stop > current_stop
    if direction == "SHORT":
        return proposed_stop < current_stop
    return False


def validate_tighter_stop(trade: TradeState, proposed_stop: float) -> bool:
    if not is_stop_tighter(trade.direction, trade.current_stop_price, proposed_stop):
        return False
    if trade.direction == "LONG":
        return proposed_stop < trade.current_price
    return proposed_stop > trade.current_price

