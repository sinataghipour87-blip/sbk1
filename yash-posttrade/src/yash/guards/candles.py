"""Validation for the primary closed 15-minute candle and context candles."""

from dataclasses import dataclass

from yash.contracts.models import CandleEvidence, YashEvaluationRequest


@dataclass(frozen=True)
class CandleGuardResult:
    valid: bool
    reason: str | None


def validate_closed_candles(request: YashEvaluationRequest, evaluated_at_ms: int | None = None) -> CandleGuardResult:
    evaluation_time = request.evaluated_at_ms if evaluated_at_ms is None else evaluated_at_ms
    candles: tuple[CandleEvidence, ...] = (
        request.market.primary_candle,
        *request.market.context_candles,
    )
    for candle in candles:
        if candle.close_time_ms > evaluation_time:
            return CandleGuardResult(False, "CLOSED_CANDLE_REQUIRED")
        if candle.observed_at_ms > evaluation_time:
            return CandleGuardResult(False, "DATA_INCOMPLETE")
    return CandleGuardResult(True, None)

