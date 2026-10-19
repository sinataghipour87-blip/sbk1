import unittest
import sys
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
from sbk_signal_contract import is_signal_runtime, unresolved_inflight_signal_ids


AUTHORIZATION_GATE_IDS = (
    "STAGE_1_MARKET_DATA",
    "STAGE_2_DATA_QUALITY",
    "STAGE_3_MARKET_REGIME",
    "STAGE_4_HTF_STRUCTURE",
    "STAGE_5_SETUP_DETECTION",
    "STAGE_6_LIQUIDITY_ANALYSIS",
    "STAGE_7_ORDER_FLOW",
    "STAGE_8_ENTRY_TRIGGER",
    "STAGE_9_ENTRY_PRICE",
    "STAGE_10_STOP_INVALIDATION",
    "STAGE_11_TP_TARGETS",
    "STAGE_12_EXPECTED_VALUE",
    "STAGE_13_POSITION_SIZE",
    "STAGE_14_EXECUTION",
)


def make_authorization(signal_id, timestamp_ms, timeframe, direction):
    model_direction = direction
    return {
        "contractVersion": "sbk1.entry.authorization.v1",
        "decision": "APPROVE_ENTRY",
        "decisionId": signal_id,
        "snapshotId": f"SNP_{timestamp_ms}_python_test",
        "snapshotTimestampMs": timestamp_ms,
        "evaluatedAtMs": timestamp_ms,
        "timeframe": timeframe,
        "direction": direction,
        "gates": [
            {"id": gate_id, "status": "PASSED", "reason": "Isolated contract test evidence."}
            for gate_id in AUTHORIZATION_GATE_IDS
        ],
        "models": [
            {
                "id": "M1_TEST",
                "status": "HEALTHY",
                "calibrated": True,
                "independenceValidated": True,
                "direction": model_direction,
                "probabilityPct": 70,
                "sampleSize": 40,
                "oosPrecisionPct": 60,
                "effectiveWeight": 0.4,
            },
            {
                "id": "M2_TEST",
                "status": "HEALTHY",
                "calibrated": True,
                "independenceValidated": True,
                "direction": model_direction,
                "probabilityPct": 68,
                "sampleSize": 40,
                "oosPrecisionPct": 60,
                "effectiveWeight": 0.3,
            },
        ],
        "disagreementVeto": False,
        "ensembleProbabilityPct": 69.14,
        "riskRewardRatio": 2,
        "allocatedRiskUsd": 1,
    }


class InflightSignalReconciliationTests(unittest.TestCase):
    def test_unmatched_inflight_signal_states_are_quarantined(self):
        records = [
            {"status": "STRATEGY_ACCEPTED", "signal": {"signalId": "accepted"}},
            {"status": "ORDER_SUBMITTED", "signal": {"signalId": "missing-order"}},
            {"status": "PARTIALLY_FILLED", "signal": {"signalId": "missing-partial"}},
            {"status": "UNKNOWN_IN_FLIGHT", "signal": {"signalId": "missing-unknown"}},
            {"status": "ORDER_SUBMITTED", "signal": {"signalId": "open"}},
            {"status": "ACCEPTED", "signal": {"signalId": "not-submitted"}},
            {"status": "FILLED", "signal": {"signalId": "filled"}},
            {"status": "ORDER_SUBMITTED", "signal": {}},
            None,
        ]

        self.assertEqual(
            unresolved_inflight_signal_ids(records, {"open", "filled"}),
            ["accepted", "missing-order", "missing-partial", "missing-unknown"],
        )


class SbkSignalStrategyRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.strategy = SbkSignalStrategy.__new__(SbkSignalStrategy)
        self.strategy._signals = {}
        self.strategy._signal_statuses = {}
        self.strategy._signals_by_pair = {}
        self.strategy._exit_signals = {}
        self.strategy._consumed_exit_ids = set()
        self.strategy._pair = "BTC/USDT:USDT"
        self.strategy._bridge_url = "http://127.0.0.1:3000"
        self.strategy._bridge_token = "a" * 64
        self.strategy.config = {
            "dry_run": True,
            "runmode": SimpleNamespace(value="dry_run"),
            "exchange": {"name": "bybit"},
            "trading_mode": "futures",
            "stake_amount": 100,
        }
        self.now_ms = int(datetime.now(UTC).timestamp() * 1000)
        self.signal_id = "sbk1_" + "a" * 32
        self.signal = {
            "contractVersion": "sbk1.freqtrade.signal.v2",
            "decisionId": self.signal_id,
            "signalId": self.signal_id,
            "exchange": "bybit",
            "market": "futures",
            "pair": "BTC/USDT:USDT",
            "direction": "LONG",
            "timeframe": "15m",
            "generatedAtMs": self.now_ms - 1_000,
            "expiresAtMs": self.now_ms + 20_000,
            "referencePrice": 62_100,
            "engineScore": 84,
            "dataQuality": {
                "status": "LIVE",
                "source": "SBK1 signal engine",
                "observedAtMs": self.now_ms - 1_000,
                "maxAgeMs": 5_000,
            },
            "entryConditions": {
                "setupType": "BULLISH_LIQUIDITY_SWEEP",
                "entryPrice": 62_100,
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
        self.signal["authorization"] = make_authorization(
            self.signal_id,
            self.now_ms - 1_000,
            self.signal["timeframe"],
            self.signal["direction"],
        )
        self.response = Mock()
        self.response.raise_for_status.return_value = None
        self.response.json.return_value = {
            "contractVersion": "sbk1.freqtrade.signal.v2",
            "signals": [{"signal": self.signal, "status": "STRATEGY_ACCEPTED"}],
        }

    def test_empty_bridge_environment_uses_default_loopback_url(self):
        with patch.dict("os.environ", {
            "SBK1_BRIDGE_URL": "",
            "SBK1_FREQTRADE_PAIR": self.strategy._pair,
            "SBK1_FREQTRADE_BRIDGE_TOKEN": self.strategy._bridge_token,
        }):
            self.strategy.bot_start()

        self.assertEqual(self.strategy._bridge_url, "http://127.0.0.1:3000")

    def test_market_snapshot_refreshes_inside_ticker_window_with_completed_candles(self):
        now = datetime.now(UTC)
        now_ms = int(now.timestamp() * 1000)
        self.strategy._market_snapshot_last_publish_ms = now_ms - 5_000
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
        self.strategy.config["dry_run"] = True
        self.strategy.config["runmode"] = SimpleNamespace(value="dry_run")
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
        self.strategy.dp._exchange = SimpleNamespace(_api=SimpleNamespace(
            has={"fetchTrades": True},
            fetch_trades=Mock(return_value=[
                {"id": "t1", "timestamp": now_ms - 500, "side": "buy", "price": 60_150, "amount": 0.01},
                {"id": "t2", "timestamp": now_ms - 200, "side": "sell", "price": 60_149, "amount": 0.005},
            ]),
        ))
        response = Mock()
        response.raise_for_status.return_value = None
        poll_response = Mock()
        poll_response.raise_for_status.return_value = None
        poll_response.json.return_value = {
            "contractVersion": "sbk1.freqtrade.signal.v2",
            "signals": [],
        }

        with (
            patch("SbkSignalStrategy.requests.post", return_value=response) as post,
            patch("SbkSignalStrategy.requests.get", return_value=poll_response) as get,
        ):
            self.strategy.bot_loop_start(now)

        get.assert_called_once()
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
        self.assertEqual(payload["contractVersion"], "sbk1.freqtrade.market-snapshot.v5")
        self.assertEqual(len(payload["tradeFlow"]["trades"]), 2)
        self.assertEqual(payload["tradeFlow"]["trades"][0]["side"], "buy")
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

    def test_production_signal_is_available_only_in_dry_run(self):
        self.response.json.return_value = {
            "contractVersion": "sbk1.freqtrade.signal.v2",
            "signals": [{"signal": self.signal, "status": "ACCEPTED"}],
        }
        with patch("SbkSignalStrategy.requests.get", return_value=self.response) as get:
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))
        get.assert_called_once()
        self.assertEqual(self.strategy._signals[self.signal_id], self.signal)
        self.assertEqual(self.strategy._signal_statuses[self.signal_id], "ACCEPTED")

        dataframe = pd.DataFrame({
            "date": [datetime.fromtimestamp((self.now_ms - 60_000) / 1000, UTC)],
            "close": [self.signal["referencePrice"]],
        })
        entries = self.strategy.populate_entry_trend(dataframe, {"pair": self.signal["pair"]})
        self.assertEqual(entries.iloc[-1]["enter_long"], 1)
        self.assertEqual(entries.iloc[-1]["enter_tag"], self.signal_id)
        with patch.object(self.strategy, "_post_status", return_value=True):
            accepted = self.strategy.confirm_trade_entry(
                self.signal["pair"],
                "limit",
                0.001,
                self.signal["referencePrice"],
                "gtc",
                datetime.fromtimestamp(self.now_ms / 1000, UTC),
                self.signal_id,
                "long",
            )
        self.assertTrue(accepted)
        self.assertEqual(self.strategy._signal_statuses[self.signal_id], "STRATEGY_ACCEPTED")

        self.strategy.config["dry_run"] = False
        self.strategy.config["runmode"] = SimpleNamespace(value="live")
        with patch("SbkSignalStrategy.requests.get") as live_get:
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))
        live_get.assert_not_called()
        self.assertFalse(is_signal_runtime("live"))
        self.assertTrue(is_signal_runtime("dry_run"))

    def test_stake_uses_signal_risk_and_never_exceeds_configured_cap(self):
        self.strategy._signals = {self.signal_id: self.signal}
        self.strategy.config["stake_amount"] = 100
        self.signal["entryConditions"]["stopLoss"] = 62_100 * 0.99
        self.signal["riskLimits"]["riskBudgetPct"] = 0.5

        stake = self.strategy.custom_stake_amount(
            self.signal["pair"],
            datetime.fromtimestamp(self.now_ms / 1000, UTC),
            62_100,
            500,
            1,
            500,
            2,
            self.signal_id,
            "long",
        )

        self.assertAlmostEqual(stake, 25)
        self.assertLessEqual(stake, self.strategy.config["stake_amount"])

        self.strategy.config["stake_amount"] = 20
        capped_stake = self.strategy.custom_stake_amount(
            self.signal["pair"],
            datetime.fromtimestamp(self.now_ms / 1000, UTC),
            62_100,
            500,
            1,
            500,
            1,
            self.signal_id,
            "long",
        )
        self.assertLessEqual(capped_stake, 20)

    def test_leverage_is_capped_by_signal_and_exchange_and_defaults_to_one(self):
        self.strategy._signals = {self.signal_id: self.signal}
        self.signal["riskLimits"]["maxLeverage"] = 1.5
        current_time = datetime.fromtimestamp(self.now_ms / 1000, UTC)

        self.assertEqual(
            self.strategy.leverage(
                self.signal["pair"], current_time, 62_100, 3, 10, self.signal_id, "long"
            ),
            1.5,
        )
        self.assertEqual(
            self.strategy.leverage(
                self.signal["pair"], current_time, 62_100, 3, 1.25, self.signal_id, "long"
            ),
            1.25,
        )
        self.assertEqual(
            self.strategy.leverage(
                self.signal["pair"], current_time, 62_100, 3, 10, None, "long"
            ),
            1,
        )

    def test_signal_stoploss_is_used_and_fixed_stoploss_is_fallback(self):
        trade = SimpleNamespace(
            enter_tag=self.signal_id,
            is_short=False,
            leverage=1,
            get_custom_data=Mock(return_value=self.signal),
        )

        with patch("SbkSignalStrategy.stoploss_from_absolute", return_value=-0.01) as convert:
            result = self.strategy.custom_stoploss(
                self.signal["pair"],
                trade,
                datetime.fromtimestamp(self.now_ms / 1000, UTC),
                62_100,
                0,
                False,
            )

        convert.assert_called_once_with(
            61_800,
            62_100,
            is_short=False,
            leverage=1,
        )
        self.assertEqual(result, -0.01)

        trade.get_custom_data.return_value = None
        self.assertEqual(
            self.strategy.custom_stoploss(
                self.signal["pair"],
                trade,
                datetime.fromtimestamp(self.now_ms / 1000, UTC),
                62_100,
                0,
                False,
            ),
            -0.05,
        )

    def test_minimal_roi_does_not_create_a_separate_roi_exit(self):
        self.assertEqual(self.strategy.minimal_roi, {})

    def test_populate_exit_trend_requires_the_matching_entry_tag(self):
        exit_id = "sbk1_exit_" + "b" * 32
        self.strategy._exit_signals = {
            exit_id: {
                "contractVersion": "sbk1.freqtrade.signal.v2",
                "signalType": "EXIT",
                "exitId": exit_id,
                "pair": self.signal["pair"],
                "tradeId": 42,
                "entryTag": self.signal_id,
                "direction": "LONG",
                "reason": "CONTRACT_TEST_ONLY thesis invalidation",
                "generatedAtMs": self.now_ms,
                "expiresAtMs": self.now_ms + 30_000,
            },
        }
        frame = pd.DataFrame({"enter_tag": [self.signal_id]})
        result = self.strategy.populate_exit_trend(frame, {"pair": self.signal["pair"]})

        self.assertEqual(result.iloc[-1]["exit_long"], 1)
        self.assertEqual(result.iloc[-1]["exit_short"], 0)
        self.assertEqual(result.iloc[-1]["exit_tag"], f"sbk_exit_{exit_id}")

        frame.loc[0, "enter_tag"] = "sbk1_" + "c" * 32
        unrelated = self.strategy.populate_exit_trend(frame, {"pair": self.signal["pair"]})
        self.assertEqual(unrelated.iloc[-1]["exit_long"], 0)

    def test_custom_exit_matches_trade_id_entry_tag_and_direction_and_is_one_shot(self):
        exit_id = "sbk1_exit_" + "b" * 32
        self.strategy._exit_signals = {
            exit_id: {
                "contractVersion": "sbk1.freqtrade.signal.v2",
                "signalType": "EXIT",
                "exitId": exit_id,
                "pair": self.signal["pair"],
                "tradeId": 42,
                "entryTag": self.signal_id,
                "direction": "LONG",
                "reason": "CONTRACT_TEST_ONLY thesis invalidation",
                "generatedAtMs": self.now_ms,
                "expiresAtMs": self.now_ms + 30_000,
            },
        }
        trade = SimpleNamespace(
            id=42,
            enter_tag=self.signal_id,
            is_short=False,
            get_custom_data=Mock(return_value=self.signal),
            set_custom_data=Mock(),
        )
        current_time = datetime.fromtimestamp(self.now_ms / 1000, UTC)

        self.assertEqual(
            self.strategy.custom_exit(self.signal["pair"], trade, current_time, 62_100, 0),
            f"sbk_exit_{exit_id}",
        )
        trade.set_custom_data.assert_called_once_with("sbk_exit_signal_id", exit_id)
        with patch.object(self.strategy, "_post_exit_status", return_value=True) as post_status:
            accepted = self.strategy.confirm_trade_exit(
                self.signal["pair"],
                trade,
                "market",
                0.002,
                62_100,
                "gtc",
                f"sbk_exit_{exit_id}",
                current_time,
            )
        self.assertTrue(accepted)
        post_status.assert_called_once_with(
            exit_id,
            "CONFIRMED",
            "Freqtrade accepted the SBK1-directed exit order.",
        )
        self.assertIsNone(
            self.strategy.custom_exit(self.signal["pair"], trade, current_time, 62_100, 0)
        )

    def test_confirmed_exit_signal_is_reloaded_after_strategy_restart(self):
        exit_id = "sbk1_exit_" + "b" * 32
        exit_signal = {
            "contractVersion": "sbk1.freqtrade.signal.v2",
            "signalType": "EXIT",
            "exitId": exit_id,
            "pair": self.signal["pair"],
            "tradeId": 42,
            "entryTag": self.signal_id,
            "direction": "LONG",
            "reason": "CONTRACT_TEST_ONLY restart replay",
            "generatedAtMs": self.now_ms,
            "expiresAtMs": self.now_ms + 30_000,
        }
        self.response.json.return_value = {
            "contractVersion": "sbk1.freqtrade.signal.v2",
            "signals": [],
            "exitSignals": [exit_signal],
        }
        self.strategy._exit_signals = {}
        with patch("SbkSignalStrategy.requests.get", return_value=self.response):
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))

        trade = SimpleNamespace(
            id=42,
            enter_tag=self.signal_id,
            is_short=False,
            get_custom_data=Mock(return_value=self.signal),
            set_custom_data=Mock(),
        )
        self.assertEqual(
            self.strategy.custom_exit(
                self.signal["pair"],
                trade,
                datetime.fromtimestamp(self.now_ms / 1000, UTC),
                62_100,
                0,
            ),
            f"sbk_exit_{exit_id}",
        )

    def test_take_profit_maps_to_freqtrade_exit_without_an_sbk1_exit_signal(self):
        trade = SimpleNamespace(
            id=42,
            enter_tag=self.signal_id,
            is_short=False,
            get_custom_data=Mock(return_value=self.signal),
        )
        current_time = datetime.fromtimestamp(self.now_ms / 1000, UTC)

        self.assertIsNone(
            self.strategy.custom_exit(
                self.signal["pair"],
                trade,
                current_time,
                self.signal["entryConditions"]["takeProfit"] - 1,
                0.01,
            )
        )
        self.assertEqual(
            self.strategy.custom_exit(
                self.signal["pair"],
                trade,
                current_time,
                self.signal["entryConditions"]["takeProfit"],
                0.01,
            ),
            "sbk_take_profit",
        )
        self.assertTrue(
            self.strategy.confirm_trade_exit(
                self.signal["pair"],
                trade,
                "market",
                0.001,
                self.signal["entryConditions"]["takeProfit"],
                "gtc",
                "sbk_take_profit",
                current_time,
            )
        )

    def test_exit_fill_marks_the_matching_exit_signal_closed(self):
        exit_id = "sbk1_exit_" + "b" * 32
        self.strategy._exit_signals = {exit_id: {"exitId": exit_id}}
        trade = SimpleNamespace(
            enter_tag=self.signal_id,
            is_short=False,
            is_open=False,
            get_custom_data=Mock(return_value=exit_id),
        )
        order = SimpleNamespace(ft_order_side="sell")
        with patch.object(self.strategy, "_post_exit_status", return_value=True) as post_status:
            self.strategy.order_filled(
                self.signal["pair"],
                trade,
                order,
                datetime.fromtimestamp(self.now_ms / 1000, UTC),
            )

        post_status.assert_called_once_with(
            exit_id,
            "CLOSED",
            "Freqtrade confirmed the SBK1-directed position close.",
        )
        self.assertNotIn(exit_id, self.strategy._exit_signals)

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

    def test_unknown_signal_remains_quarantined_until_trade_reconciliation(self):
        unknown_response = Mock()
        unknown_response.raise_for_status.return_value = None
        unknown_response.json.return_value = {
            "contractVersion": "sbk1.freqtrade.signal.v2",
            "signals": [{"signal": self.signal, "status": "UNKNOWN_IN_FLIGHT"}],
        }
        with (
            patch("SbkSignalStrategy.requests.get", return_value=unknown_response),
            patch("SbkSignalStrategy.Trade.get_trades_proxy", return_value=[]),
            patch.object(self.strategy, "_post_status", return_value=True) as post_status,
        ):
            self.strategy.bot_loop_start(datetime.fromtimestamp(self.now_ms / 1000, UTC))

        self.assertEqual(self.strategy._signals, {})
        post_status.assert_not_called()

    def test_unknown_signal_is_reconciled_from_matching_persisted_trade(self):
        unknown_response = Mock()
        unknown_response.raise_for_status.return_value = None
        unknown_response.json.return_value = {
            "contractVersion": "sbk1.freqtrade.signal.v2",
            "signals": [{"signal": self.signal, "status": "UNKNOWN_IN_FLIGHT"}],
        }
        order = SimpleNamespace(ft_order_side="buy", safe_filled=0)
        trade = SimpleNamespace(
            enter_tag=self.signal_id,
            pair=self.signal["pair"],
            is_short=False,
            open_orders=[order],
            entry_side="buy",
            select_filled_orders=lambda _side: [],
            amount=0,
            open_rate=62_100,
            id=42,
        )
        with (
            patch("SbkSignalStrategy.requests.get", return_value=unknown_response),
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

    def test_unknown_signal_with_mismatched_trade_remains_quarantined(self):
        trade = SimpleNamespace(
            enter_tag=self.signal_id,
            pair="ETH/USDT:USDT",
            is_short=False,
            open_orders=[],
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

        self.assertEqual(self.strategy._signals, {})
        post_status.assert_called_once_with(
            self.signal_id,
            "UNKNOWN_IN_FLIGHT",
            "A Freqtrade trade with this signal tag has a different pair or direction; the signal remains quarantined.",
        )

    def test_persisted_open_entry_order_is_reconciled_without_reentry(self):
        order = SimpleNamespace(ft_order_side="buy", safe_filled=0)
        trade = SimpleNamespace(
            enter_tag=self.signal_id,
            pair=self.signal["pair"],
            is_short=False,
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
