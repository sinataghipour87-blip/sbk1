from __future__ import annotations

import unittest
from unittest.mock import Mock

from pydantic import ValidationError

from yash.contracts.models import (
    CONTRACT_VERSION,
    CandleEvidence,
    DecisionType,
    MarketEvidence,
    ModelEvidence,
    ModelEvidenceType,
    TradeState,
    YashEvaluationRequest,
)
from yash.engine import YashEngine
from yash.models import (
    AtrBollingerRegimeAnalyzer,
    MomentumExhaustionAnalyzer,
    PriceStructurePatternAnalyzer,
    TrendReversalModel,
    VolumeClimaxAnalyzer,
    attach_model_evidence,
)

NOW_MS = 1_800_000_000_000
CANDLE_CLOSE_MS = NOW_MS - 1_000


def make_request(*, market: MarketEvidence | None = None) -> YashEvaluationRequest:
    candle = CandleEvidence(
        timeframe="15m",
        open_time_ms=CANDLE_CLOSE_MS - 15 * 60_000,
        close_time_ms=CANDLE_CLOSE_MS,
        observed_at_ms=CANDLE_CLOSE_MS + 100,
        source="verified-market-feed",
        open=100.0,
        high=102.0,
        low=98.0,
        close=101.0,
        volume=10.0,
    )
    trade = TradeState(
        trade_id="trade-model-test",
        pair="BTC/USDT",
        direction="LONG",
        opened_at_ms=NOW_MS - 10 * 60_000,
        entry_price=100.0,
        current_price=100.5,
        current_stop_price=95.0,
        holding_horizon_minutes=30,
        entry_fee_rate=0.001,
        exit_fee_rate=0.001,
    )
    return YashEvaluationRequest(
        contract_version=CONTRACT_VERSION,
        request_id="model-evidence-test",
        evaluated_at_ms=NOW_MS,
        trade=trade,
        market=market or MarketEvidence(primary_candle=candle),
    )


def make_candle_series(
    bodies: list[tuple[float, float]],
    *,
    volumes: list[float] | None = None,
    ranges: list[float] | None = None,
) -> tuple[CandleEvidence, ...]:
    candles = []
    count = len(bodies)
    for index, (open_price, close_price) in enumerate(bodies):
        close_time = CANDLE_CLOSE_MS - (count - index - 1) * 15 * 60_000
        padding = ranges[index] if ranges else 0.2
        candles.append(
            CandleEvidence(
                timeframe="15m",
                open_time_ms=close_time - 15 * 60_000,
                close_time_ms=close_time,
                observed_at_ms=close_time + 100,
                source="verified-market-feed",
                open=open_price,
                high=max(open_price, close_price) + padding,
                low=min(open_price, close_price) - padding,
                close=close_price,
                volume=volumes[index] if volumes else 10.0,
            )
        )
    return tuple(candles)


class ModelEvidenceTests(unittest.TestCase):
    def test_mock_model_output_is_attached_and_preserved_by_engine(self) -> None:
        request = make_request()
        evidence = ModelEvidence(
            source="test-trend-plugin",
            evidence_type=ModelEvidenceType.TREND_REVERSAL,
            observed_at_ms=NOW_MS - 500,
            timeframe="15m",
            candle_close_time_ms=CANDLE_CLOSE_MS,
            probability=0.99,
            label="bearish_reversal_context",
        )
        model = Mock(spec=TrendReversalModel)
        model.predict.return_value = evidence

        model_output = model.predict((request.market.primary_candle,))
        enriched_market = attach_model_evidence(request.market, (model_output,))
        result = YashEngine().evaluate(request.model_copy(update={"market": enriched_market}))

        self.assertEqual(enriched_market.model_evidence, (evidence,))
        self.assertEqual(result.plan.decision.evidence_snapshot.model_evidence, (evidence,))
        self.assertEqual(result.plan.decision.decision_type, DecisionType.HOLD)
        self.assertFalse(result.plan.executable)
        model.predict.assert_called_once()

    def test_evidence_attachment_preserves_existing_context(self) -> None:
        first = ModelEvidence(
            source="trend-plugin",
            evidence_type=ModelEvidenceType.MOMENTUM_WEAKNESS,
            observed_at_ms=NOW_MS - 1_000,
            probability=0.7,
        )
        second = ModelEvidence(
            source="sentiment-plugin",
            evidence_type=ModelEvidenceType.SENTIMENT,
            observed_at_ms=NOW_MS - 500,
            label="negative",
            value=-0.4,
        )
        market = attach_model_evidence(make_request().market, (first,))

        enriched = attach_model_evidence(market, (second,))

        self.assertEqual(enriched.model_evidence, (first, second))

    def test_model_evidence_probability_and_content_are_validated(self) -> None:
        base = {
            "source": "test-plugin",
            "evidence_type": ModelEvidenceType.VOLATILITY_REGIME,
            "observed_at_ms": NOW_MS,
        }
        with self.assertRaises(ValidationError):
            ModelEvidence.model_validate({**base, "probability": 1.1})
        with self.assertRaises(ValidationError):
            ModelEvidence.model_validate(base)

    def test_model_evidence_cannot_reference_unclosed_or_future_data(self) -> None:
        with self.assertRaises(ValidationError):
            ModelEvidence(
                source="test-plugin",
                evidence_type=ModelEvidenceType.CANDLE_PATTERN,
                observed_at_ms=CANDLE_CLOSE_MS - 1,
                timeframe="15m",
                candle_close_time_ms=CANDLE_CLOSE_MS,
                label="pattern_context",
            )

        request = make_request()
        future_evidence = ModelEvidence(
            source="test-plugin",
            evidence_type=ModelEvidenceType.SENTIMENT,
            observed_at_ms=NOW_MS + 1,
            label="positive",
        )
        with self.assertRaises(ValidationError):
            YashEvaluationRequest(
                contract_version=request.contract_version,
                request_id=request.request_id,
                evaluated_at_ms=NOW_MS,
                trade=request.trade,
                market=MarketEvidence(
                    primary_candle=request.market.primary_candle,
                    model_evidence=(future_evidence,),
                ),
            )

    def test_stale_model_evidence_cannot_veto_native_policy(self) -> None:
        request = make_request()
        request = request.model_copy(
            update={"trade": request.trade.model_copy(update={"current_price": 103.0})}
        )
        stale_evidence = ModelEvidence(
            source="test-regime-plugin",
            evidence_type=ModelEvidenceType.VOLATILITY_REGIME,
            observed_at_ms=NOW_MS - 20_000,
            label="trending",
        )
        market = attach_model_evidence(request.market, (stale_evidence,))
        engine = YashEngine()
        without_model = engine.evaluate(request)
        with_model = engine.evaluate(request.model_copy(update={"market": market}))

        self.assertEqual(without_model.plan.decision.decision_type, DecisionType.ARM_BREAKEVEN)
        self.assertEqual(
            with_model.plan.decision.decision_type,
            without_model.plan.decision.decision_type,
        )
        self.assertEqual(with_model.plan.decision.new_stoploss, without_model.plan.decision.new_stoploss)
        self.assertEqual(with_model.plan.decision.reason_codes, without_model.plan.decision.reason_codes)
        self.assertEqual(
            with_model.plan.decision.evidence_snapshot.model_evidence,
            (stale_evidence,),
        )
        self.assertFalse(with_model.plan.executable)


class BuiltInModelAnalyzerTests(unittest.TestCase):
    def test_atr_and_bollinger_analyzer_reports_expansion_as_evidence(self) -> None:
        bodies = [(100.0, 100.0)] * 26
        for index in range(14):
            opening = 100 + index * 0.5
            bodies.append((opening, opening + 0.5))
        ranges = [0.1] * 26 + [4.0] * 14
        evidence = AtrBollingerRegimeAnalyzer().analyze(
            make_candle_series(bodies, ranges=ranges)
        )

        self.assertEqual(evidence.evidence_type, ModelEvidenceType.VOLATILITY_REGIME)
        self.assertEqual(evidence.label, "volatility_expansion")
        self.assertGreater(evidence.value or 0, 1.25)
        self.assertEqual(evidence.timeframe, "15m")

    def test_momentum_analyzer_identifies_buyers_losing_impulse(self) -> None:
        candles = make_candle_series(
            [
                (100.0, 100.0),
                (100.0, 101.0),
                (101.0, 102.0),
                (102.0, 102.2),
                (102.2, 102.1),
            ]
        )

        evidence = MomentumExhaustionAnalyzer(window=2).analyze(candles)

        self.assertEqual(evidence.evidence_type, ModelEvidenceType.MOMENTUM_WEAKNESS)
        self.assertEqual(evidence.label, "buyers_exhaustion")
        self.assertGreater(evidence.probability or 0, 0.5)

    def test_volume_analyzer_flags_abnormal_closed_candle_volume(self) -> None:
        candles = make_candle_series(
            [(100.0, 100.1), (100.1, 100.0), (100.0, 100.05), (100.05, 100.3)],
            volumes=[10.0, 12.0, 8.0, 40.0],
        )

        evidence = VolumeClimaxAnalyzer(lookback=3).analyze(candles)

        self.assertEqual(evidence.evidence_type, ModelEvidenceType.SUSPICIOUS_VOLUME)
        self.assertEqual(evidence.label, "volume_spike_bullish_close")
        self.assertAlmostEqual(evidence.value or 0, 4.0)

    def test_price_pattern_requires_prior_trend_and_closed_candles(self) -> None:
        candles = make_candle_series(
            [
                (100.0, 99.0),
                (99.0, 98.0),
                (98.0, 97.0),
                (97.0, 96.0),
                (95.8, 97.2),
            ]
        )

        evidence = PriceStructurePatternAnalyzer().analyze(candles)

        self.assertEqual(evidence.evidence_type, ModelEvidenceType.CANDLE_PATTERN)
        self.assertEqual(evidence.label, "bullish_engulfing_after_decline")
        self.assertGreater(evidence.probability or 0, 0.5)

    def test_analyzer_evidence_is_added_to_market_and_engine_snapshot(self) -> None:
        candles = make_candle_series(
            [
                (100.0, 99.0),
                (99.0, 98.0),
                (98.0, 97.0),
                (97.0, 96.0),
                (95.8, 97.2),
            ]
        )
        evidence = PriceStructurePatternAnalyzer().analyze(candles)
        market = attach_model_evidence(MarketEvidence(primary_candle=candles[-1]), (evidence,))
        request = make_request(market=market)

        result = YashEngine().evaluate(request)

        self.assertEqual(result.plan.decision.evidence_snapshot.model_evidence, (evidence,))
        self.assertFalse(result.plan.executable)

    def test_analyzers_reject_insufficient_or_non_15m_input(self) -> None:
        analyzer = VolumeClimaxAnalyzer(lookback=3)
        with self.assertRaises(ValueError):
            analyzer.analyze(make_candle_series([(100.0, 100.1)] * 3))

        hourly = CandleEvidence(
            timeframe="1h",
            open_time_ms=CANDLE_CLOSE_MS - 60 * 60_000,
            close_time_ms=CANDLE_CLOSE_MS,
            observed_at_ms=CANDLE_CLOSE_MS + 100,
            source="verified-market-feed",
            open=100.0,
            high=101.0,
            low=99.0,
            close=100.5,
            volume=10.0,
        )
        with self.assertRaises(ValueError):
            analyzer.analyze((hourly,) * 4)


if __name__ == "__main__":
    unittest.main()
