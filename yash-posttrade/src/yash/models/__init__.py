"""Dependency-light interfaces for optional analytical model plugins."""

from collections.abc import Iterable

from yash.contracts.models import MarketEvidence, ModelEvidence, ModelEvidenceType
from yash.models.momentum_exhaustion import MomentumExhaustionAnalyzer
from yash.models.pattern_volume import PatternVolumeModel, PriceStructurePatternAnalyzer
from yash.models.sentiment_context import SentimentContextModel
from yash.models.trend_reversal import MomentumWeaknessModel, TrendReversalModel
from yash.models.volatility_regime import AtrBollingerRegimeAnalyzer, VolatilityRegimeModel
from yash.models.volume_climax import VolumeClimaxAnalyzer


def attach_model_evidence(
    market: MarketEvidence,
    evidence: Iterable[ModelEvidence],
) -> MarketEvidence:
    """Return market evidence enriched with model context, preserving prior evidence."""
    return MarketEvidence.model_validate(
        {
            "primary_candle": market.primary_candle,
            "context_candles": market.context_candles,
            "invalidation": market.invalidation,
            "model_evidence": (*market.model_evidence, *evidence),
        }
    )


__all__ = [
    "ModelEvidence",
    "ModelEvidenceType",
    "AtrBollingerRegimeAnalyzer",
    "MomentumExhaustionAnalyzer",
    "MomentumWeaknessModel",
    "PatternVolumeModel",
    "PriceStructurePatternAnalyzer",
    "SentimentContextModel",
    "TrendReversalModel",
    "VolatilityRegimeModel",
    "VolumeClimaxAnalyzer",
    "attach_model_evidence",
]
