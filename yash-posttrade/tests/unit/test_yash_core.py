from __future__ import annotations

import unittest

from pydantic import ValidationError

from yash.contracts.models import (
    CONTRACT_VERSION,
    CandleEvidence,
    DecisionType,
    ReasonCode,
    TradeState,
    YashEvaluationRequest,
)
from yash.engine import EngineConfig, YashEngine
from yash.guards.ratchet import is_stop_tighter, validate_tighter_stop

NOW_MS = 1_800_000_000_000
CANDLE_CLOSE_MS = NOW_MS - 1_000
CANDLE_OPEN_MS = CANDLE_CLOSE_MS - 15 * 60_000


def make_trade(direction: str, **overrides: object) -> TradeState:
    defaults = {
        "trade_id": "trade-42",
        "pair": "BTC/USDT:USDT",
        "direction": direction,
        "opened_at_ms": NOW_MS - 10 * 60_000,
        "entry_price": 100.0,
        "current_price": 100.5,
        "current_stop_price": 95.0 if direction == "LONG" else 105.0,
        "holding_horizon_minutes": 30,
        "entry_fee_rate": 0.001,
        "exit_fee_rate": 0.001,
        "breakeven_buffer_rate": 0.0002,
    }
    defaults.update(overrides)
    return TradeState.model_validate(defaults)


def make_candle(
    timeframe: str = "15m",
    *,
    open_time_ms: int | None = None,
    close_time_ms: int | None = None,
    observed_at_ms: int = CANDLE_CLOSE_MS + 100,
    source: str = "verified-market-feed",
) -> CandleEvidence:
    duration = {"15m": 15, "1h": 60, "4h": 240}[timeframe] * 60_000
    close = CANDLE_CLOSE_MS if close_time_ms is None else close_time_ms
    open_ = close - duration if open_time_ms is None else open_time_ms
    return CandleEvidence(
        timeframe=timeframe,
        open_time_ms=open_,
        close_time_ms=close,
        observed_at_ms=observed_at_ms,
        source=source,
        open=100.0,
        high=102.0,
        low=98.0,
        close=101.0,
        volume=10.0,
    )


def make_request(
    direction: str,
    *,
    evaluated_at_ms: int = NOW_MS,
    trade_overrides: dict[str, object] | None = None,
    primary_candle: CandleEvidence | None = None,
    context_candles: tuple[CandleEvidence, ...] = (),
    invalidation: dict[str, object] | None = None,
) -> YashEvaluationRequest:
    return YashEvaluationRequest.model_validate(
        {
            "contract_version": CONTRACT_VERSION,
            "request_id": f"request-{direction.lower()}",
            "evaluated_at_ms": evaluated_at_ms,
            "trade": make_trade(direction, **(trade_overrides or {})).model_dump(),
            "market": {
                "primary_candle": (primary_candle or make_candle()).model_dump(),
                "context_candles": [c.model_dump() for c in context_candles],
                "invalidation": invalidation,
            },
        }
    )


class YashPhaseOneTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = YashEngine()

    def test_long_and_short_breakeven_arms_only_after_threshold_and_covers_fees(self) -> None:
        cases = (
            ("LONG", 103.0, 100.22),
            ("SHORT", 97.0, 99.78),
        )
        for direction, current_price, expected_stop in cases:
            with self.subTest(direction=direction):
                request = make_request(
                    direction,
                    trade_overrides={"current_price": current_price},
                )
                result = self.engine.evaluate(request)
                self.assertEqual(result.plan.decision.decision_type, DecisionType.ARM_BREAKEVEN)
                self.assertAlmostEqual(result.plan.decision.new_stoploss or 0, expected_stop, places=6)
                self.assertIn(ReasonCode.BREAKEVEN_THRESHOLD_REACHED, result.plan.decision.reason_codes)
                self.assertFalse(result.plan.executable)
                self.assertTrue(result.plan.observation_only)

    def test_long_and_short_below_breakeven_threshold_hold(self) -> None:
        cases = (("LONG", 101.99), ("SHORT", 98.01))
        for direction, current_price in cases:
            with self.subTest(direction=direction):
                result = self.engine.evaluate(
                    make_request(direction, trade_overrides={"current_price": current_price})
                )
                self.assertEqual(result.plan.decision.decision_type, DecisionType.HOLD)
                self.assertIn(ReasonCode.POLICY_NO_CHANGE, result.plan.decision.reason_codes)

    def test_long_and_short_time_stop_triggers_at_exact_horizon(self) -> None:
        for direction in ("LONG", "SHORT"):
            with self.subTest(direction=direction):
                request = make_request(
                    direction,
                    trade_overrides={"opened_at_ms": NOW_MS - 30 * 60_000},
                )
                result = self.engine.evaluate(request)
                self.assertEqual(result.plan.decision.decision_type, DecisionType.EXIT)
                self.assertEqual(result.plan.decision.custom_exit_reason, "yash_time_horizon_elapsed")
                self.assertIn(ReasonCode.TIME_HORIZON_ELAPSED, result.plan.decision.reason_codes)

    def test_long_and_short_time_stop_does_not_trigger_early(self) -> None:
        for direction in ("LONG", "SHORT"):
            with self.subTest(direction=direction):
                request = make_request(
                    direction,
                    trade_overrides={"opened_at_ms": NOW_MS - 30 * 60_000 + 1},
                )
                result = self.engine.evaluate(request)
                self.assertEqual(result.plan.decision.decision_type, DecisionType.HOLD)

    def test_long_and_short_confirmed_invalidation_has_highest_policy_priority(self) -> None:
        for direction in ("LONG", "SHORT"):
            with self.subTest(direction=direction):
                request = make_request(
                    direction,
                    trade_overrides={"opened_at_ms": NOW_MS - 60 * 60_000},
                    invalidation={
                        "source": "closed-15m-structure",
                        "reason": "Confirmed invalidation",
                        "candle_close_time_ms": CANDLE_CLOSE_MS,
                        "observed_at_ms": CANDLE_CLOSE_MS + 100,
                    },
                )
                result = self.engine.evaluate(request)
                self.assertEqual(result.plan.decision.decision_type, DecisionType.EXIT)
                self.assertEqual(result.plan.decision.custom_exit_reason, "yash_invalidation_confirmed")
                self.assertIn(ReasonCode.INVALIDATION_CONFIRMED, result.plan.decision.reason_codes)

    def test_stale_primary_or_context_evidence_cannot_produce_action(self) -> None:
        stale_primary = make_candle(
            close_time_ms=NOW_MS - 30_000,
            observed_at_ms=NOW_MS - 20_000,
        )
        stale_context = make_candle(
            "1h",
            close_time_ms=NOW_MS - 30_000,
            observed_at_ms=NOW_MS - 20_000,
        )
        for direction in ("LONG", "SHORT"):
            for candle, contexts in ((stale_primary, ()), (make_candle(), (stale_context,))):
                with self.subTest(direction=direction, stale=candle.timeframe):
                    result = self.engine.evaluate(
                        make_request(
                            direction,
                            trade_overrides={
                                "current_price": 103.0 if direction == "LONG" else 97.0,
                            },
                            primary_candle=stale_primary if not contexts else make_candle(),
                            context_candles=contexts,
                        )
                    )
                    self.assertEqual(result.plan.decision.decision_type, DecisionType.HOLD)
                    self.assertIn(ReasonCode.DATA_STALE, result.plan.decision.reason_codes)
                    self.assertFalse(result.plan.executable)

    def test_incomplete_payload_returns_safe_hold(self) -> None:
        result = self.engine.evaluate_payload({"contract_version": CONTRACT_VERSION})
        self.assertEqual(result.plan.decision.decision_type, DecisionType.HOLD)
        self.assertIn(ReasonCode.DATA_INCOMPLETE, result.plan.decision.reason_codes)
        self.assertFalse(result.plan.executable)

    def test_unsupported_contract_returns_safe_hold(self) -> None:
        result = self.engine.evaluate_payload(
            {"contract_version": "yash.posttrade.v99", "request_id": "old", "evaluated_at_ms": NOW_MS}
        )
        self.assertIn(ReasonCode.CONTRACT_UNSUPPORTED, result.plan.decision.reason_codes)
        self.assertFalse(result.plan.executable)

    def test_invalid_request_id_is_sanitized_on_validation_failure(self) -> None:
        result = self.engine.evaluate_payload(
            {"contract_version": "yash.posttrade.v99", "request_id": "contains spaces", "evaluated_at_ms": NOW_MS}
        )
        self.assertEqual(result.request_id, "invalid-request")
        self.assertFalse(result.plan.executable)

    def test_open_primary_candle_is_rejected_and_mapped_to_non_action(self) -> None:
        open_candle = make_candle(close_time_ms=NOW_MS + 1_000, observed_at_ms=NOW_MS + 1_100)
        with self.assertRaises(ValidationError):
            make_request("LONG", primary_candle=open_candle)
        payload = {
            "contract_version": CONTRACT_VERSION,
            "request_id": "open-candle",
            "evaluated_at_ms": NOW_MS,
            "trade": make_trade("LONG").model_dump(),
            "market": {
                "primary_candle": open_candle.model_dump(),
                "context_candles": [],
                "invalidation": None,
            },
        }
        result = self.engine.evaluate_payload(payload)
        self.assertIn(ReasonCode.CLOSED_CANDLE_REQUIRED, result.plan.decision.reason_codes)
        self.assertFalse(result.plan.executable)

    def test_future_observations_are_rejected(self) -> None:
        future_candle = make_candle(observed_at_ms=NOW_MS + 1)
        payload = {
            "contract_version": CONTRACT_VERSION,
            "request_id": "future",
            "evaluated_at_ms": NOW_MS,
            "trade": make_trade("LONG").model_dump(),
            "market": {
                "primary_candle": future_candle.model_dump(),
                "context_candles": [],
                "invalidation": None,
            },
        }
        result = self.engine.evaluate_payload(payload)
        self.assertIn(ReasonCode.DATA_INCOMPLETE, result.plan.decision.reason_codes)
        self.assertFalse(result.plan.executable)

    def test_ratchet_never_allows_long_or_short_stop_to_loosen(self) -> None:
        long_trade = make_trade("LONG")
        short_trade = make_trade("SHORT")
        self.assertTrue(validate_tighter_stop(long_trade, 96.0))
        self.assertFalse(validate_tighter_stop(long_trade, 94.0))
        self.assertTrue(validate_tighter_stop(short_trade, 104.0))
        self.assertFalse(validate_tighter_stop(short_trade, 106.0))
        self.assertFalse(is_stop_tighter("LONG", 95.0, 95.0))
        self.assertFalse(is_stop_tighter("SHORT", 105.0, 105.0))

    def test_breakeven_policy_refuses_stop_that_is_not_tighter_than_existing(self) -> None:
        cases = (
            ("LONG", 103.0, 100.5),
            ("SHORT", 97.0, 99.5),
        )
        for direction, current_price, existing_stop in cases:
            with self.subTest(direction=direction):
                result = self.engine.evaluate(
                    make_request(
                        direction,
                        trade_overrides={
                            "current_price": current_price,
                            "current_stop_price": existing_stop,
                        },
                    )
                )
                self.assertEqual(result.plan.decision.decision_type, DecisionType.HOLD)
                self.assertIn(ReasonCode.STOP_NOT_TIGHTER, result.plan.decision.reason_codes)

    def test_stop_cannot_be_placed_beyond_current_market_price(self) -> None:
        request = make_request(
            "LONG",
            trade_overrides={
            "current_price": 103.0,
                "current_stop_price": 99.0,
            "entry_fee_rate": 0.015,
            "exit_fee_rate": 0.015,
            },
        )
        result = self.engine.evaluate(request)
        self.assertEqual(result.plan.decision.decision_type, DecisionType.HOLD)
        self.assertIn(ReasonCode.STOP_NOT_TIGHTER, result.plan.decision.reason_codes)

    def test_decisions_are_deterministic_and_expire(self) -> None:
        request = make_request("LONG", trade_overrides={"current_price": 103.0})
        first = self.engine.evaluate(request)
        second = self.engine.evaluate(request)
        self.assertEqual(first.model_dump(), second.model_dump())
        self.assertGreater(first.expires_at_ms, first.generated_at_ms)

    def test_context_timeframes_are_context_only(self) -> None:
        context = (make_candle("1h"), make_candle("4h"))
        request = make_request(
            "LONG",
            trade_overrides={"current_price": 101.0},
            context_candles=context,
        )
        result = self.engine.evaluate(request)
        self.assertEqual(result.plan.decision.decision_type, DecisionType.HOLD)
        self.assertEqual(result.plan.decision.evidence_snapshot.context_timeframes, ("1h", "4h"))

    def test_configurable_freshness_limit_is_not_read_from_untrusted_payload(self) -> None:
        engine = YashEngine(EngineConfig(freshness_limit_ms=5_000))
        request = make_request(
            "LONG",
            primary_candle=make_candle(
                close_time_ms=NOW_MS - 10_000,
                observed_at_ms=NOW_MS - 6_000,
            ),
        )
        result = engine.evaluate(request)
        self.assertIn(ReasonCode.DATA_STALE, result.plan.decision.reason_codes)

    def test_freshness_limit_cannot_be_loosened_beyond_sbK1_limit(self) -> None:
        with self.assertRaises(ValueError):
            EngineConfig(freshness_limit_ms=15_001)

    def test_observation_only_cannot_be_disabled_in_phase_one(self) -> None:
        result = self.engine.evaluate(make_request("LONG", trade_overrides={"current_price": 103.0}))
        self.assertFalse(result.plan.executable)
        self.assertTrue(result.plan.observation_only)
        self.assertIn(ReasonCode.OBSERVATION_ONLY, result.plan.decision.reason_codes)


if __name__ == "__main__":
    unittest.main()
