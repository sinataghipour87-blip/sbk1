import unittest
import sys
import copy
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "freqtrade"))
sys.path.insert(0, str(ROOT / "freqtrade_integration" / "strategies"))

import requests
from SbkSignalStrategy import SbkSignalStrategy
from sbk_signal_contract import is_valid_sbk_signal, unresolved_inflight_signal_ids


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
            "demo_trading": False,
            "force_entry_enable": False,
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

    def test_collection_signal_uses_explicit_collection_entry_tag(self):
        signal = copy.deepcopy(self.signal)
        signal["collectionMode"] = "DRY_RUN_COLLECTION"
        signal["generatedAtMs"] = self.now_ms
        signal["dataQuality"]["observedAtMs"] = self.now_ms
        signal["dataQuality"]["maxAgeMs"] = 5_000
        signal["entryConditions"]["setupType"] = "LIVE_SBK1_SETUP"
        self.strategy._signals = {self.signal_id: signal}
        self.strategy._signal_statuses = {self.signal_id: "ACCEPTED"}
        self.strategy._signals_by_pair = {"BTC/USDT:USDT": signal}
        dataframe = pd.DataFrame([{
            "date": datetime.fromtimestamp(self.now_ms / 1000, UTC),
            "close": signal["referencePrice"],
        }])

        result = self.strategy.populate_entry_trend(dataframe, {"pair": "BTC/USDT:USDT"})

        self.assertEqual(result.iloc[-1]["enter_long"], 1)
        self.assertEqual(result.iloc[-1]["enter_tag"], f"DRY_RUN_COLLECTION:{self.signal_id}")

    def test_collection_entry_is_blocked_when_another_trade_is_open(self):
        signal = copy.deepcopy(self.signal)
        signal["collectionMode"] = "DRY_RUN_COLLECTION"
        signal["generatedAtMs"] = self.now_ms
        signal["dataQuality"]["observedAtMs"] = self.now_ms
        signal["dataQuality"]["maxAgeMs"] = 5_000
        signal["entryConditions"]["setupType"] = "LIVE_SBK1_SETUP"
        self.strategy._signals = {self.signal_id: signal}
        self.strategy._signal_statuses = {self.signal_id: "ACCEPTED"}

        with (
            patch("SbkSignalStrategy.Trade.get_open_trade_count", return_value=1),
            patch.object(self.strategy, "_post_status", return_value=True) as post_status,
        ):
            accepted = self.strategy.confirm_trade_entry(
                "BTC/USDT:USDT",
                "limit",
                0.001,
                signal["referencePrice"],
                "GTC",
                datetime.fromtimestamp(self.now_ms / 1000, UTC),
                f"DRY_RUN_COLLECTION:{self.signal_id}",
                "long",
            )

        self.assertFalse(accepted)
        post_status.assert_called_once_with(
            self.signal_id,
            "REJECTED",
            "Dry-run collection permits at most one open Freqtrade trade.",
        )

    def test_collection_entry_is_blocked_if_dry_run_config_changes(self):
        signal = copy.deepcopy(self.signal)
        signal["collectionMode"] = "DRY_RUN_COLLECTION"
        signal["generatedAtMs"] = self.now_ms
        signal["dataQuality"]["observedAtMs"] = self.now_ms
        signal["dataQuality"]["maxAgeMs"] = 5_000
        signal["entryConditions"]["setupType"] = "LIVE_SBK1_SETUP"
        self.strategy._signals = {self.signal_id: signal}
        self.strategy._signals_by_pair = {"BTC/USDT:USDT": signal}
        self.strategy.config["demo_trading"] = True
        dataframe = pd.DataFrame([{
            "date": datetime.fromtimestamp(self.now_ms / 1000, UTC),
            "close": signal["referencePrice"],
        }])

        with patch.object(self.strategy, "_post_status", return_value=True) as post_status:
            result = self.strategy.populate_entry_trend(dataframe, {"pair": "BTC/USDT:USDT"})

        self.assertEqual(result.iloc[-1]["enter_long"], 0)
        post_status.assert_called_once_with(
            self.signal_id,
            "REJECTED",
            "Dry-run collection requires dry_run=true, demo_trading=false, and force_entry_enable=false.",
        )

    def test_collection_confirmation_rechecks_demo_and_force_entry_settings(self):
        signal = copy.deepcopy(self.signal)
        signal["collectionMode"] = "DRY_RUN_COLLECTION"
        signal["generatedAtMs"] = self.now_ms
        signal["dataQuality"]["observedAtMs"] = self.now_ms
        signal["dataQuality"]["maxAgeMs"] = 5_000
        signal["entryConditions"]["setupType"] = "LIVE_SBK1_SETUP"
        self.strategy._signals = {self.signal_id: signal}
        self.strategy._signal_statuses = {self.signal_id: "ACCEPTED"}

        for setting in ("demo_trading", "force_entry_enable"):
            with self.subTest(setting=setting):
                self.strategy.config[setting] = True
                with patch.object(self.strategy, "_post_status", return_value=True):
                    accepted = self.strategy.confirm_trade_entry(
                        "BTC/USDT:USDT",
                        "limit",
                        0.001,
                        signal["referencePrice"],
                        "GTC",
                        datetime.fromtimestamp(self.now_ms / 1000, UTC),
                        f"DRY_RUN_COLLECTION:{self.signal_id}",
                        "long",
                    )
                self.assertFalse(accepted)
                self.strategy.config[setting] = False

    def test_custom_stake_rejects_signal_below_freqtrade_minimum_stake(self):
        signal = copy.deepcopy(self.signal)
        signal["riskLimits"]["maxStakeQuote"] = 10
        self.strategy._signals = {self.signal_id: signal}

        with patch.object(self.strategy, "_post_status", return_value=True) as post_status:
            stake = self.strategy.custom_stake_amount(
                "BTC/USDT:USDT",
                datetime.fromtimestamp(self.now_ms / 1000, UTC),
                signal["referencePrice"],
                100,
                87.616725,
                100,
                1,
                self.signal_id,
                "long",
            )

        self.assertEqual(stake, 0.0)
        post_status.assert_called_once_with(
            self.signal_id,
            "REJECTED",
            "Freqtrade minimum stake 87.6167 exceeds the risk-bounded signal stake 10.",
        )

    def test_collection_contract_enforces_one_x_and_stake_cap(self):
        signal = copy.deepcopy(self.signal)
        signal["collectionMode"] = "DRY_RUN_COLLECTION"
        signal["generatedAtMs"] = self.now_ms
        signal["expiresAtMs"] = self.now_ms + 60_000
        signal["dataQuality"]["observedAtMs"] = self.now_ms
        signal["dataQuality"]["maxAgeMs"] = 5_000
        signal["entryConditions"]["setupType"] = "LIVE_SBK1_SETUP"
        arguments = {
            "now_ms": self.now_ms,
            "expected_exchange": "bybit",
            "expected_market": "futures",
            "expected_pair": "BTC/USDT:USDT",
            "expected_timeframe": "15m",
        }

        self.assertTrue(is_valid_sbk_signal(signal, **arguments))
        signal["riskLimits"]["maxLeverage"] = 2
        self.assertFalse(is_valid_sbk_signal(signal, **arguments))
        signal["riskLimits"]["maxLeverage"] = 1
        signal["riskLimits"]["maxStakeQuote"] = 101
        self.assertFalse(is_valid_sbk_signal(signal, **arguments))

    def test_market_snapshot_uses_only_completed_dataprovider_candles(self):
        now = datetime.now(UTC)
        now_ms = int(now.timestamp() * 1000)
        timeframe_ms = 15 * 60 * 1000
        current_candle_start = now_ms // timeframe_ms * timeframe_ms
        timestamps = [
            current_candle_start - 2 * timeframe_ms,
            current_candle_start - timeframe_ms,
            current_candle_start,
        ]
        dataframe = pd.DataFrame({
            "date": pd.to_datetime(timestamps, unit="ms", utc=True),
            "open": [60_000, 60_050, 60_100],
            "high": [60_100, 60_150, 60_200],
            "low": [59_900, 60_000, 60_050],
            "close": [60_050, 60_100, 60_150],
            "volume": [1.0, 2.0, 3.0],
        })
        self.strategy.config["dry_run"] = False
        self.strategy.config["runmode"] = SimpleNamespace(value="live")
        self.strategy.dp = SimpleNamespace(
            get_pair_dataframe=Mock(return_value=dataframe),
            ticker=Mock(return_value={
                "timestamp": now_ms - 100,
                "last": 60_150,
                "bid": 60_149,
                "ask": 60_151,
                "mark": 60_152,
                "indexPrice": 60_153,
            }),
            orderbook=Mock(return_value={
                "timestamp": now_ms - 100,
                "bids": [[60_149, 1.0]],
                "asks": [[60_151, 1.0]],
            }),
            funding_rate=Mock(return_value={
                "fundingRate": -0.0001,
                "fundingTimestamp": now_ms + 3_600_000,
            }),
        )
        response = Mock()
        response.raise_for_status.return_value = None

        with patch("SbkSignalStrategy.requests.post", return_value=response) as post:
            self.strategy.bot_loop_start(now)

        self.assertEqual(self.strategy.dp.get_pair_dataframe.call_count, 5)
        self.strategy.dp.get_pair_dataframe.assert_any_call("BTC/USDT:USDT", "15m")
        post.assert_called_once()
        self.assertEqual(post.call_args.args[0], "http://127.0.0.1:3000/api/freqtrade/market-snapshot")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], f"Bearer {'a' * 64}")
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["source"], "freqtrade.dataprovider")
        self.assertEqual(len(payload["candles"]), 2)
        self.assertEqual(payload["candles"][-1]["timestampMs"], timestamps[1])
        self.assertEqual(payload["ticker"]["last"], 60_150)
        self.assertEqual(payload["ticker"]["exchangeTimestampMs"], now_ms - 100)
        self.assertGreaterEqual(payload["ticker"]["retrievedAtMs"], now_ms)
        self.assertEqual(payload["ticker"]["markPrice"], 60_152)
        self.assertEqual(payload["ticker"]["indexPrice"], 60_153)
        self.assertEqual(payload["orderBook"]["bids"][0]["price"], 60_149)
        self.assertEqual(payload["fundingRate"]["rate"], -0.0001)
        self.assertEqual(set(payload["additionalCandles"]), {"1m", "5m", "1h", "4h"})

    def test_market_snapshot_is_not_published_in_backtest(self):
        self.strategy.config["runmode"] = SimpleNamespace(value="backtest")
        self.strategy.dp = SimpleNamespace(get_pair_dataframe=Mock())

        with patch("SbkSignalStrategy.requests.post") as post:
            self.strategy.bot_loop_start(datetime.now(UTC))

        self.strategy.dp.get_pair_dataframe.assert_not_called()
        post.assert_not_called()

    def test_market_snapshot_rejects_ticker_without_exchange_timestamp(self):
        self.strategy.dp = SimpleNamespace(ticker=Mock(return_value={
            "timestamp": None,
            "datetime": None,
            "last": 60_150,
            "info": {"lastPrice": "60150"},
        }))

        with self.assertLogs("SbkSignalStrategy", level="WARNING") as captured:
            ticker = self.strategy._snapshot_ticker(self.strategy.dp, self.strategy._pair)

        self.assertIsNotNone(ticker)
        self.assertIn("no exchange timestamp", captured.output[0])
        self.assertEqual(ticker["exchangeTimestampMs"], None)
        self.assertGreaterEqual(ticker["retrievedAtMs"], self.now_ms)
        self.assertEqual(ticker["last"], 60_150)

    def test_production_signal_gate_reason_and_correlation_are_logged(self):
        self.response.status_code = 503
        self.response.json.return_value = {
            "code": "CALIBRATED_CONFIDENCE_UNAVAILABLE",
            "stage": "CALIBRATION",
            "correlationId": "trace-123",
            "error": "Production signal delivery is disabled pending calibration evidence.",
        }
        self.response.raise_for_status.side_effect = requests.HTTPError(
            "503 Server Error",
            response=self.response,
        )

        with (
            patch("SbkSignalStrategy.requests.get", return_value=self.response),
            self.assertLogs("SbkSignalStrategy", level="WARNING") as captured,
        ):
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))

        self.assertIn("CALIBRATED_CONFIDENCE_UNAVAILABLE", captured.output[0])
        self.assertIn("trace-123", captured.output[0])
        self.assertEqual(self.strategy._signals, {})

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

    def test_restart_keeps_queued_signal_available_without_duplicate_delivery(self):
        self.response.json.return_value = {
            "contractVersion": "sbk1.freqtrade.signal.v1",
            "signals": [{"signal": self.signal, "status": "ACCEPTED"}],
        }
        with (
            patch("SbkSignalStrategy.requests.get", return_value=self.response),
            patch("SbkSignalStrategy.Trade.get_trades_proxy") as get_trades,
        ):
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))

        self.assertEqual(list(self.strategy._signals), [self.signal_id])
        self.assertEqual(list(self.strategy._signals_by_pair), ["BTC/USDT:USDT"])
        self.assertEqual(self.strategy._signal_statuses[self.signal_id], "ACCEPTED")
        get_trades.assert_not_called()

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

    def test_persisted_partial_entry_is_reconciled_without_reentry(self):
        self.response.json.return_value = {
            "contractVersion": "sbk1.freqtrade.signal.v1",
            "signals": [{"signal": self.signal, "status": "ORDER_SUBMITTED"}],
        }
        order = SimpleNamespace(ft_order_side="buy", safe_filled=0.001)
        trade = SimpleNamespace(
            enter_tag=self.signal_id,
            open_orders=[order],
            entry_side="buy",
            select_filled_orders=lambda _side: [],
            amount=0.001,
            open_rate=62_105,
            id=43,
        )
        with (
            patch("SbkSignalStrategy.requests.get", return_value=self.response),
            patch("SbkSignalStrategy.Trade.get_trades_proxy", return_value=[trade]),
            patch.object(self.strategy, "_post_status", return_value=True) as post_status,
        ):
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))

        post_status.assert_called_once_with(
            self.signal_id,
            "PARTIALLY_FILLED",
            "Reconciled signal lifecycle from the persisted Freqtrade trade and order records.",
            trade_id=43,
            filled_amount=0.001,
            average_fill_price=62_105.0,
        )
        self.assertEqual(self.strategy._signal_statuses[self.signal_id], "PARTIALLY_FILLED")
        self.assertNotIn("BTC/USDT:USDT", self.strategy._signals_by_pair)

    def test_persisted_fill_reconciles_submitted_record_after_restart(self):
        self.response.json.return_value = {
            "contractVersion": "sbk1.freqtrade.signal.v1",
            "signals": [{"signal": self.signal, "status": "ORDER_SUBMITTED"}],
        }
        order = SimpleNamespace(ft_order_side="buy", safe_filled=0.002)
        trade = SimpleNamespace(
            enter_tag=self.signal_id,
            open_orders=[],
            entry_side="buy",
            select_filled_orders=lambda _side: [order],
            amount=0.002,
            open_rate=62_105,
            id=44,
        )
        with (
            patch("SbkSignalStrategy.requests.get", return_value=self.response),
            patch("SbkSignalStrategy.Trade.get_trades_proxy", return_value=[trade]),
            patch.object(self.strategy, "_post_status", return_value=True) as post_status,
        ):
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))

        post_status.assert_called_once_with(
            self.signal_id,
            "FILLED",
            "Reconciled signal lifecycle from the persisted Freqtrade trade and order records.",
            trade_id=44,
            filled_amount=0.002,
            average_fill_price=62_105.0,
        )
        self.assertEqual(self.strategy._signal_statuses[self.signal_id], "FILLED")
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
