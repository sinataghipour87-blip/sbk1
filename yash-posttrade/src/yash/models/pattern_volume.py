"""Closed-15m-candle price-structure evidence for early reversal patterns."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Protocol, Sequence

from yash.contracts.models import CandleEvidence, ModelEvidence, ModelEvidenceType
from yash.models._utils import create_candle_evidence, require_closed_15m_candles


class PatternVolumeModel(Protocol):
    """Analyze closed 15m candles and return price-pattern evidence."""

    def analyze(self, candles: Sequence[CandleEvidence]) -> ModelEvidence: ...


@dataclass(frozen=True)
class PriceStructurePatternAnalyzer:
    """Detect trend-contextual engulfing and long-wick reversal candle structures."""

    trend_lookback: int = 3
    minimum_trend_return: float = 0.001

    def __post_init__(self) -> None:
        if self.trend_lookback < 2:
            raise ValueError("Trend lookback must be at least 2.")
        if not isfinite(self.minimum_trend_return) or self.minimum_trend_return <= 0:
            raise ValueError("Minimum trend return must be positive.")

    def analyze(self, candles: Sequence[CandleEvidence]) -> ModelEvidence:
        data = require_closed_15m_candles(
            candles,
            self.trend_lookback + 2,
            type(self).__name__,
        )
        trend = data[-self.trend_lookback - 2 : -2]
        previous, latest = data[-2:]
        trend_return = (trend[-1].close - trend[0].open) / trend[0].open
        previous_body = previous.close - previous.open
        current_body = latest.close - latest.open
        label = "no_clear_reversal_pattern"
        strength = 0.0

        if (
            trend_return <= -self.minimum_trend_return
            and previous_body < 0 < current_body
            and latest.open <= previous.close
            and latest.close >= previous.open
        ):
            label = "bullish_engulfing_after_decline"
            strength = abs(current_body) / max(abs(previous_body), 1e-12)
        elif (
            trend_return >= self.minimum_trend_return
            and previous_body > 0 > current_body
            and latest.open >= previous.close
            and latest.close <= previous.open
        ):
            label = "bearish_engulfing_after_rally"
            strength = abs(current_body) / max(abs(previous_body), 1e-12)
        else:
            candle_range = latest.high - latest.low
            body_size = abs(current_body)
            if candle_range > 0 and body_size > 0:
                lower_wick = min(latest.open, latest.close) - latest.low
                upper_wick = latest.high - max(latest.open, latest.close)
                if (
                    trend_return <= -self.minimum_trend_return
                    and lower_wick >= 2 * body_size
                    and upper_wick <= 0.5 * body_size
                    and latest.close >= latest.low + 0.65 * candle_range
                ):
                    label = "hammer_after_decline"
                    strength = lower_wick / body_size
                elif (
                    trend_return >= self.minimum_trend_return
                    and upper_wick >= 2 * body_size
                    and lower_wick <= 0.5 * body_size
                    and latest.close <= latest.low + 0.35 * candle_range
                ):
                    label = "shooting_star_after_rally"
                    strength = upper_wick / body_size

        probability = 0.0 if strength == 0 else min(0.99, 0.5 + min(strength, 4) / 8)
        return create_candle_evidence(
            latest,
            ModelEvidenceType.CANDLE_PATTERN,
            label,
            probability,
            trend_return,
        )
