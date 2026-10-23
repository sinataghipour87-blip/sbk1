"""Optional plugin interfaces for trend-reversal and momentum models."""

from __future__ import annotations

from typing import Protocol, Sequence

from yash.contracts.models import CandleEvidence, ModelEvidence


class TrendReversalModel(Protocol):
    """Return reversal evidence; implementations may wrap PatchTST or boosting models."""

    def predict(self, candles: Sequence[CandleEvidence]) -> ModelEvidence: ...


class MomentumWeaknessModel(Protocol):
    """Return a momentum-weakness score without making a trade decision."""

    def predict(self, candles: Sequence[CandleEvidence]) -> ModelEvidence: ...
