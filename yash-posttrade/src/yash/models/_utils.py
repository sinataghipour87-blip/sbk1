"""Shared validation and evidence helpers for deterministic candle analyzers."""

from __future__ import annotations

from collections.abc import Sequence

from yash.contracts.models import CandleEvidence, ModelEvidence, ModelEvidenceType

FIFTEEN_MINUTES_MS = 15 * 60_000


def require_closed_15m_candles(
    candles: Sequence[CandleEvidence],
    minimum_count: int,
    analyzer_name: str,
) -> tuple[CandleEvidence, ...]:
    if len(candles) < minimum_count:
        raise ValueError(f"{analyzer_name} requires at least {minimum_count} closed 15m candles.")
    for index, candle in enumerate(candles):
        if candle.timeframe != "15m":
            raise ValueError(f"{analyzer_name} accepts only closed 15m candles.")
        if candle.observed_at_ms < candle.close_time_ms:
            raise ValueError(f"{analyzer_name} cannot analyze an unclosed candle.")
        if index and (
            candle.open_time_ms != candles[index - 1].close_time_ms
            or candle.close_time_ms <= candles[index - 1].close_time_ms
        ):
            raise ValueError(f"{analyzer_name} requires consecutive candles in chronological order.")
    return tuple(candles)


def create_candle_evidence(
    candle: CandleEvidence,
    evidence_type: ModelEvidenceType,
    label: str,
    probability: float,
    value: float,
) -> ModelEvidence:
    return ModelEvidence(
        source=candle.source,
        evidence_type=evidence_type,
        observed_at_ms=candle.observed_at_ms,
        timeframe="15m",
        candle_close_time_ms=candle.close_time_ms,
        probability=min(1.0, max(0.0, probability)),
        label=label,
        value=value,
    )
