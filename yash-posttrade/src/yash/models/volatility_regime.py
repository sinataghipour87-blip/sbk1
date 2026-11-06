"""Dependency-light ATR and Bollinger-band volatility regime evidence."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite, log, sqrt
from typing import Protocol, Sequence

from yash.contracts.models import CandleEvidence, ModelEvidence, ModelEvidenceType
from yash.models._utils import create_candle_evidence, require_closed_15m_candles


class VolatilityRegimeModel(Protocol):
    """Return regime evidence without changing a trade or its stop."""

    def analyze(self, candles: Sequence[CandleEvidence]) -> ModelEvidence: ...


@dataclass(frozen=True)
class AtrBollingerRegimeAnalyzer:
    """Compare adjacent ATR and Bollinger bandwidth windows for regime context."""

    atr_period: int = 14
    band_period: int = 20
    contraction_threshold: float = 0.8
    expansion_threshold: float = 1.25

    def __post_init__(self) -> None:
        if self.atr_period < 2 or self.band_period < 2:
            raise ValueError("ATR and band periods must be at least 2.")
        if (
            not isfinite(self.contraction_threshold)
            or not isfinite(self.expansion_threshold)
            or not 0 < self.contraction_threshold < 1 < self.expansion_threshold
        ):
            raise ValueError("Regime thresholds must satisfy 0 < contraction < 1 < expansion.")

    def analyze(self, candles: Sequence[CandleEvidence]) -> ModelEvidence:
        minimum_count = max(2 * self.atr_period + 1, 2 * self.band_period)
        data = require_closed_15m_candles(
            candles,
            minimum_count,
            type(self).__name__,
        )
        true_ranges = tuple(
            max(
                candle.high - candle.low,
                abs(candle.high - data[index - 1].close),
                abs(candle.low - data[index - 1].close),
            )
            for index, candle in enumerate(data)
            if index
        )
        current_atr = sum(true_ranges[-self.atr_period :]) / self.atr_period
        previous_atr = sum(
            true_ranges[-2 * self.atr_period : -self.atr_period]
        ) / self.atr_period
        closes = tuple(candle.close for candle in data)
        current_bandwidth = _bollinger_bandwidth(closes[-self.band_period :])
        previous_bandwidth = _bollinger_bandwidth(
            closes[-2 * self.band_period : -self.band_period]
        )
        atr_ratio = _safe_ratio(current_atr, previous_atr)
        band_ratio = _safe_ratio(current_bandwidth, previous_bandwidth)

        if (
            atr_ratio >= self.expansion_threshold
            and band_ratio >= self.expansion_threshold
        ):
            label = "volatility_expansion"
        elif (
            atr_ratio <= self.contraction_threshold
            and band_ratio <= self.contraction_threshold
        ):
            label = "volatility_contraction"
        else:
            label = "volatility_transition"
        strength = abs(log(atr_ratio)) + abs(log(band_ratio))
        probability = 0.5 + min(0.49, strength / 4)
        return create_candle_evidence(
            data[-1],
            ModelEvidenceType.VOLATILITY_REGIME,
            label,
            probability,
            atr_ratio,
        )


def _bollinger_bandwidth(closes: Sequence[float]) -> float:
    mean = sum(closes) / len(closes)
    deviation = sqrt(sum((close - mean) ** 2 for close in closes) / len(closes))
    return 4 * deviation / mean


def _safe_ratio(current: float, previous: float) -> float:
    if current == 0 and previous == 0:
        return 1.0
    return min(1_000_000.0, current / max(previous, 1e-12))
