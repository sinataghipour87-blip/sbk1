import unittest
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "freqtrade"))
sys.path.insert(0, str(ROOT / "freqtrade_integration" / "strategies"))

import requests
from SbkSignalStrategy import SbkSignalStrategy
from sbk_signal_contract import unresolved_inflight_signal_ids


class InflightSignalReconciliationTests(unittest.TestCase):
    def test_unmatched_inflight_signal_states_are_quarantined(self):
        records = [
            {"status": "STRATEGY_ACCEPTED", "signal": {"signalId": "accepted"}},
            {"status": "ORDER_SUBMITTED", "signal": {"signalId": "missing-order"}},
            {"status": "PARTIALLY_FILLED", "signal": {"signalId": "missing-partial"}},
            {"status": "ORDER_SUBMITTED", "signal": {"signalId": "open"}},
            {"status": "ACCEPTED", "signal": {"signalId": "not-submitted"}},
            {"status": "FILLED", "signal": {"signalId": "filled"}},
            {"status": "ORDER_SUBMITTED", "signal": {}},
            None,
        ]

        self.assertEqual(
            unresolved_inflight_signal_ids(records, {"open", "filled"}),
            ["accepted", "missing-order", "missing-partial"],
        )


class SbkSignalStrategyRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.strategy = SbkSignalStrategy.__new__(SbkSignalStrategy)
        self.strategy._signals = {}
        self.strategy._signal_statuses = {}
        self.strategy._signals_by_pair = {}
        self.strategy._pair = "BTC/USDT:USDT"
        self.strategy._bridge_url = "http://127.0.0.1:3000"
        self.strategy._bridge_token = "a" * 64
        self.strategy.config = {
            "dry_run": True,
            "runmode": SimpleNamespace(value="dry_run"),
            "exchange": {"name": "bybit"},
            "trading_mode": "futures",
        }
        self.now_ms = int(datetime.now(UTC).timestamp() * 1000)
        self.signal_id = "sbk1_" + "a" * 32
        self.signal = {
            "contractVersion": "sbk1.freqtrade.signal.v1",
            "decisionId": self.signal_id,
            "signalId": self.signal_id,
            "exchange": "bybit",
            "market": "futures",
            "pair": "BTC/USDT:USDT",
            "direction": "LONG",
            "timeframe": "15m",
            "generatedAtMs": self.now_ms - 40_000,
            "expiresAtMs": self.now_ms + 20_000,
            "referencePrice": 62_100,
            "dataQuality": {
                "status": "LIVE",
                "source": "dry-run test fixture",
                "observedAtMs": self.now_ms - 40_000,
                "maxAgeMs": 55_000,
            },
            "entryConditions": {
                "setupType": "DRY_RUN_E2E_FIXTURE_TEST",
                "stopLoss": 61_800,
                "takeProfit": 62_700,
                "maxPriceDeviationBps": 50,
            },
            "riskLimits": {
                "riskBudgetPct": 1,
                "maxStakeQuote": 100,
                "maxLeverage": 1,
            },
        }
        self.response = Mock()
        self.response.raise_for_status.return_value = None
        self.response.json.return_value = {
            "contractVersion": "sbk1.freqtrade.signal.v1",
            "signals": [{"signal": self.signal, "status": "STRATEGY_ACCEPTED"}],
        }

    def test_restart_without_a_persisted_freqtrade_trade_quarantines_signal(self):
        with (
            patch("SbkSignalStrategy.requests.get", return_value=self.response),
            patch("SbkSignalStrategy.Trade.get_trades_proxy", return_value=[]),
            patch.object(self.strategy, "_post_status", return_value=True) as post_status,
        ):
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))

        self.assertEqual(self.strategy._signals, {})
        post_status.assert_called_once_with(
            self.signal_id,
            "UNKNOWN_IN_FLIGHT",
            "The signal was accepted for order submission but no matching Freqtrade trade is persisted. It is quarantined and will not be submitted again.",
        )

    def test_persisted_open_entry_order_is_reconciled_without_reentry(self):
        order = SimpleNamespace(ft_order_side="buy", safe_filled=0)
        trade = SimpleNamespace(
            enter_tag=self.signal_id,
            open_orders=[order],
            entry_side="buy",
            select_filled_orders=lambda _side: [],
            amount=0,
            open_rate=62_100,
            id=42,
        )
        with (
            patch("SbkSignalStrategy.requests.get", return_value=self.response),
            patch("SbkSignalStrategy.Trade.get_trades_proxy", return_value=[trade]),
            patch.object(self.strategy, "_post_status", return_value=True) as post_status,
        ):
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))

        post_status.assert_called_once_with(
            self.signal_id,
            "ORDER_SUBMITTED",
            "Reconciled signal lifecycle from the persisted Freqtrade trade and order records.",
            trade_id=42,
            filled_amount=0.0,
            average_fill_price=62_100.0,
        )
        self.assertIn(self.signal_id, self.strategy._signals)
        self.assertNotIn("BTC/USDT:USDT", self.strategy._signals_by_pair)

    def test_bridge_disconnect_clears_cached_signals(self):
        self.strategy._signals = {self.signal_id: self.signal}
        self.strategy._signal_statuses = {self.signal_id: "ACCEPTED"}
        self.strategy._signals_by_pair = {"BTC/USDT:USDT": self.signal}
        with patch(
            "SbkSignalStrategy.requests.get",
            side_effect=requests.ConnectionError("RPC disconnected"),
        ):
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))

        self.assertEqual(self.strategy._signals, {})
        self.assertEqual(self.strategy._signal_statuses, {})
        self.assertEqual(self.strategy._signals_by_pair, {})

    def test_status_payload_uses_typescript_contract_field_names(self):
        response = Mock()
        response.raise_for_status.return_value = None
        with patch("SbkSignalStrategy.requests.post", return_value=response) as post_status:
            self.assertTrue(
                self.strategy._post_status(
                    self.signal_id,
                    "PARTIALLY_FILLED",
                    "partial fill",
                    trade_id=42,
                    filled_amount=0.001,
                    average_fill_price=62_105,
                )
            )

        payload = post_status.call_args.kwargs["json"]
        self.assertEqual(
            payload,
            {
                "status": "PARTIALLY_FILLED",
                "reason": "partial fill",
                "tradeId": 42,
                "filledAmount": 0.001,
                "averageFillPrice": 62_105,
            },
        )

    def test_expired_entry_is_cancelled_by_freqtrade_timeout_callback(self):
        expired_signal = {**self.signal, "expiresAtMs": self.now_ms - 1}
        self.strategy._signals = {self.signal_id: expired_signal}
        trade = SimpleNamespace(enter_tag=self.signal_id, is_short=False, id=42)
        order = SimpleNamespace(ft_order_side="buy")
        with patch.object(self.strategy, "_post_status", return_value=True) as post_status:
            should_cancel = self.strategy.check_entry_timeout(
                "BTC/USDT:USDT",
                trade,
                order,
                datetime.fromtimestamp(self.now_ms / 1000, UTC),
            )

        self.assertTrue(should_cancel)
        self.assertEqual(post_status.call_args.args[:2], (self.signal_id, "CANCELLED"))

    def test_freqtrade_fill_callback_persists_signal_and_fill_status(self):
        self.strategy._signals = {self.signal_id: self.signal}
        self.strategy._signal_statuses = {}
        trade = SimpleNamespace(
            enter_tag=self.signal_id,
            is_short=False,
            id=42,
            set_custom_data=Mock(),
        )
        order = SimpleNamespace(ft_order_side="buy", safe_price=62_105, safe_filled=0.002, filled=0.002)
        with patch.object(self.strategy, "_post_status", return_value=True) as post_status:
            self.strategy.order_filled(
                "BTC/USDT:USDT",
                trade,
                order,
                datetime.fromtimestamp(self.now_ms / 1000, UTC),
            )

        trade.set_custom_data.assert_called_once_with("sbk_signal", self.signal)
        self.assertEqual(self.strategy._signal_statuses[self.signal_id], "FILLED")
        self.assertEqual(post_status.call_args.args[:2], (self.signal_id, "FILLED"))
        self.assertEqual(post_status.call_args.kwargs["filled_amount"], 0.002)


if __name__ == "__main__":
    unittest.main()
