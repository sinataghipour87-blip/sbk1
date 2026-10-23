"""Closed-candle volume-spike evidence using a trailing reference average."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Sequence

from yash.contracts.models import CandleEvidence, ModelEvidence, ModelEvidenceType
from yash.models._utils import create_candle_evidence, require_closed_15m_candles


@dataclass(frozen=True)
class VolumeClimaxAnalyzer:
    """Flag an unusual closed-candle volume relative to prior 15m observations."""

    lookback: int = 20
    spike_multiple: float = 2.5

    def __post_init__(self) -> None:
        if self.lookback < 2:
            raise ValueError("Volume lookback must be at least 2.")
        if not isfinite(self.spike_multiple) or self.spike_multiple <= 1:
            raise ValueError("Volume spike multiple must be greater than 1.")

    def analyze(self, candles: Sequence[CandleEvidence]) -> ModelEvidence:
        data = require_closed_15m_candles(
            candles,
            self.lookback + 1,
            type(self).__name__,
        )
        baseline = sum(candle.volume for candle in data[-self.lookback - 1 : -1]) / self.lookback
        if baseline <= 0:
            raise ValueError("Volume climax analysis requires positive reference volume.")
        latest = data[-1]
        volume_ratio = latest.volume / baseline
        if volume_ratio >= self.spike_multiple:
            if latest.close > latest.open:
                label = "volume_spike_bullish_close"
            elif latest.close < latest.open:
                label = "volume_spike_bearish_close"
            else:
                label = "volume_spike_indecisive_close"
            probability = min(0.99, 0.5 + (volume_ratio - self.spike_multiple) / self.spike_multiple)
        else:
            label = "no_volume_climax"
            probability = 0.0
        return create_candle_evidence(
            latest,
            ModelEvidenceType.SUSPICIOUS_VOLUME,
            label,
            probability,
            volume_ratio,
        )
