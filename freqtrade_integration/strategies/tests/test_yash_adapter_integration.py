from __future__ import annotations

import logging
import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "freqtrade"))
sys.path.insert(0, str(ROOT / "freqtrade_integration" / "strategies"))

from SbkSignalStrategy import SbkSignalStrategy
from yash_adapter import (
    build_request_from_freqtrade,
    evaluate_enforcing,
    format_audit_log,
)


class YashAdapterIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.open_time = self.now - timedelta(minutes=15)
        self.trade = SimpleNamespace(
            id=42,
            pair="BTC/USDT:USDT",
            is_short=False,
            open_date_utc=self.now - timedelta(minutes=5),
            open_rate=100.0,
            stop_loss=95.0,
            fee_open=0.001,
            fee_close=0.001,
            enter_tag="sbk1_" + "a" * 32,
            leverage=1,
            get_custom_data=Mock(return_value={
                "entryConditions": {"maxHoldingMinutes": 30, "takeProfit": 110.0}
            }),
        )
        self.closed_frame = self._frame(self.open_time)
        self.strategy = SbkSignalStrategy.__new__(SbkSignalStrategy)
        self.strategy._signals = {}
        self.strategy._signals_by_pair = {}
        self.strategy._exit_signals = {}
        self.strategy._consumed_exit_ids = set()
        self.strategy.dp = SimpleNamespace(
            get_pair_dataframe=Mock(side_effect=lambda _pair, timeframe: {
                "15m": self.closed_frame,
                "1h": pd.DataFrame(),
                "4h": pd.DataFrame(),
            }[timeframe])
        )

    @staticmethod
    def _frame(start: datetime) -> pd.DataFrame:
        return pd.DataFrame([{
            "date": start,
            "open": 100.0,
            "high": 102.0,
            "low": 99.0,
            "close": 101.0,
            "volume": 10.0,
        }])

    def _build(self, frame: pd.DataFrame):
        return build_request_from_freqtrade(
            self.trade,
            101.0,
            self.now,
            frame,
            None,
            None,
            {"entry_fee_rate": 0.001, "exit_fee_rate": 0.001},
        )

    def test_open_or_stale_candle_skips_yash_and_preserves_callback_behavior(self) -> None:
        open_frame = self._frame(self.now - timedelta(minutes=5))
        stale_frame = self._frame(self.now - timedelta(minutes=40))
        for frame, expected_reason in (
            (open_frame, "CLOSED_CANDLE_REQUIRED"),
            (stale_frame, "DATA_STALE"),
            (None, "DATA_INCOMPLETE"),
        ):
            with self.subTest(reason=expected_reason), self.assertLogs("SbkSignalStrategy", level="INFO") as logs:
                self.strategy.dp.get_pair_dataframe.side_effect = lambda _pair, timeframe: (
                    frame if timeframe == "15m" else pd.DataFrame()
                )
                stop = self.strategy.custom_stoploss(
                    self.trade.pair,
                    self.trade,
                    self.now,
                    101.0,
                    0.01,
                    False,
                )
                exit_reason = self.strategy.custom_exit(
                    self.trade.pair,
                    self.trade,
                    self.now,
                    101.0,
                    0.01,
                )
                self.assertEqual(stop, -0.05)
                self.assertIsNone(exit_reason)
                self.assertTrue(any(expected_reason in record for record in logs.output))

    def test_valid_request_emits_enforcing_audit_and_evidence_timestamps(self) -> None:
        request = self._build(self.closed_frame)
        self.assertIsNotNone(request)
        envelope = evaluate_enforcing(request)
        audit = format_audit_log(envelope)
        self.assertIn("reason_codes", audit)
        self.assertIn("POLICY_NO_CHANGE", audit)
        self.assertIn("candle_close_time_ms", audit)
        self.assertIn(str(request.market.primary_candle.close_time_ms), audit)
        self.assertFalse(envelope.plan.executable)
        self.assertFalse(envelope.plan.observation_only)
        with self.assertLogs("SbkSignalStrategy", level="INFO") as logs:
            stop = self.strategy.custom_stoploss(
                self.trade.pair,
                self.trade,
                self.now,
                101.0,
                0.01,
                False,
            )
        self.assertEqual(stop, -0.05)
        self.assertTrue(any("YASH_ENFORCING" in item and "reason_codes" in item for item in logs.output))

    def test_breakeven_enforcing_adjusts_stop_only_after_valid_signal(self) -> None:
        with self.assertLogs("SbkSignalStrategy", level="INFO") as logs:
            stop = self.strategy.custom_stoploss(
                self.trade.pair,
                self.trade,
                self.now,
                103.0,
                0.03,
                False,
            )
        self.assertGreater(stop, -0.05)
        self.assertTrue(any("YASH_ENFORCING_APPLIED" in item and "action=stop" in item for item in logs.output))

    def test_short_breakeven_enforcing_returns_tighter_stop(self) -> None:
        self.trade.is_short = True
        self.trade.stop_loss = 105.0
        with self.assertLogs("SbkSignalStrategy", level="INFO") as logs:
            stop = self.strategy.custom_stoploss(
                self.trade.pair,
                self.trade,
                self.now,
                97.0,
                0.03,
                False,
            )
        self.assertGreater(stop, -0.05)
        self.assertTrue(any("YASH_ENFORCING_APPLIED" in item and "action=stop" in item for item in logs.output))

    def test_time_stop_enforcing_returns_yash_exit_reason(self) -> None:
        self.assertFalse(
            self.strategy.confirm_trade_exit(
                self.trade.pair,
                self.trade,
                "market",
                0.01,
                101.0,
                "gtc",
                "yash_time_horizon_elapsed",
                self.now,
            )
        )
        self.trade.open_date_utc = self.now - timedelta(minutes=35)
        with self.assertLogs("SbkSignalStrategy", level="INFO") as logs:
            exit_reason = self.strategy.custom_exit(
                self.trade.pair,
                self.trade,
                self.now,
                101.0,
                0.01,
            )
        self.assertEqual(exit_reason, "yash_time_horizon_elapsed")
        self.assertTrue(any("YASH_ENFORCING_APPLIED" in item and "action=exit" in item for item in logs.output))
        self.assertTrue(
            self.strategy.confirm_trade_exit(
                self.trade.pair,
                self.trade,
                "market",
                0.01,
                101.0,
                "gtc",
                exit_reason,
                self.now,
            )
        )


if __name__ == "__main__":
    unittest.main()
