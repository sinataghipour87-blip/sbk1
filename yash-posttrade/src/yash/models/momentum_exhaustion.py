"""Closed-15m-candle evidence for directional momentum exhaustion."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Sequence

from yash.contracts.models import CandleEvidence, ModelEvidence, ModelEvidenceType
from yash.models._utils import create_candle_evidence, require_closed_15m_candles


@dataclass(frozen=True)
class MomentumExhaustionAnalyzer:
    """Compare adjacent signed candle-body impulses to identify weakening pressure."""

    window: int = 4
    minimum_prior_impulse: float = 0.001
    minimum_decline: float = 0.4

    def __post_init__(self) -> None:
        if self.window < 2:
            raise ValueError("Momentum window must be at least 2.")
        if not isfinite(self.minimum_prior_impulse) or self.minimum_prior_impulse <= 0:
            raise ValueError("Minimum prior impulse must be positive.")
        if not isfinite(self.minimum_decline) or not 0 < self.minimum_decline < 1:
            raise ValueError("Minimum decline must be greater than 0 and less than 1.")

    def analyze(self, candles: Sequence[CandleEvidence]) -> ModelEvidence:
        data = require_closed_15m_candles(
            candles,
            2 * self.window + 1,
            type(self).__name__,
        )
        bodies = tuple(
            (candle.close - candle.open) / previous.close
            for previous, candle in zip(data, data[1:])
        )
        previous_impulse = sum(bodies[-2 * self.window : -self.window])
        current_impulse = sum(bodies[-self.window :])
        decline = 0.0
        if (
            previous_impulse >= self.minimum_prior_impulse
            and current_impulse < previous_impulse * (1 - self.minimum_decline)
        ):
            label = "buyers_exhaustion"
            decline = (previous_impulse - current_impulse) / previous_impulse
        elif (
            previous_impulse <= -self.minimum_prior_impulse
            and current_impulse > previous_impulse * (1 - self.minimum_decline)
        ):
            label = "sellers_exhaustion"
            decline = max(
                0.0,
                (abs(previous_impulse) - abs(current_impulse)) / abs(previous_impulse),
            )
        else:
            label = "no_clear_exhaustion"
        probability = 0.0 if label == "no_clear_exhaustion" else min(0.99, 0.5 + decline / 2)
        return create_candle_evidence(
            data[-1],
            ModelEvidenceType.MOMENTUM_WEAKNESS,
            label,
            probability,
            current_impulse,
        )
