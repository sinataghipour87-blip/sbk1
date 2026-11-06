"""Fail-closed and stop monotonicity guards."""

from yash.guards.candles import CandleGuardResult, validate_closed_candles
from yash.guards.ratchet import is_stop_tighter, validate_tighter_stop

__all__ = [
    "CandleGuardResult",
    "is_stop_tighter",
    "validate_closed_candles",
    "validate_tighter_stop",
]

