import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.historical_decision_replay import (
    DEFAULT_TAKER_FEE_RATE,
    _simulate_decision,
    replay,
)


def candle(timestamp, open_price=100.0, high=101.0, low=99.0, close=100.0):
    return {
        "timestamp": timestamp,
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "volume": 10.0,
    }


def decision(timestamp=1_000, direction="LONG"):
    return {
        "signalId": "test-signal",
        "decisionTimestampMs": timestamp,
        "pair": "BTC/USDT:USDT",
        "timeframe": "15m",
        "direction": direction,
        "entry": 100.0,
        "stop": 95.0 if direction == "LONG" else 105.0,
        "target": 105.0 if direction == "LONG" else 95.0,
    }


class HistoricalDecisionReplayTests(unittest.TestCase):
    def test_entry_uses_first_later_candle_open_not_decision_candle_close(self):
        result, reason = _simulate_decision(
            decision(),
            [
                candle(1_000, open_price=100.0, high=104.0, low=96.0, close=103.0),
                candle(901_000, open_price=101.0, high=102.0, low=100.0, close=101.0),
                candle(1_801_000, open_price=101.0, high=106.0, low=100.0, close=105.0),
            ],
            None,
            DEFAULT_TAKER_FEE_RATE,
            0.0,
            2,
            1_000.0,
        )

        self.assertIsNone(reason)
        self.assertIsNotNone(result)
        self.assertEqual(result["entryTimestampMs"], 901_000)
        self.assertEqual(result["entryPrice"], 101.0)
        self.assertEqual(result["exitReason"], "TARGET")

    def test_same_candle_stop_and_target_assumes_stop_first(self):
        result, reason = _simulate_decision(
            decision(),
            [
                candle(1_000),
                candle(901_000, open_price=100.0, high=106.0, low=94.0, close=100.0),
            ],
            None,
            DEFAULT_TAKER_FEE_RATE,
            0.0,
            1,
            1_000.0,
        )

        self.assertIsNone(reason)
        self.assertEqual(result["exitReason"], "STOP")

    def test_taker_fee_and_slippage_reduce_long_trade_net_pnl(self):
        candles = [
            candle(1_000),
            candle(901_000, open_price=100.0, high=106.0, low=99.0, close=105.0),
        ]
        no_friction, _ = _simulate_decision(
            decision(), candles, None, 0.0, 0.0, 1, 1_000.0
        )
        with_friction, _ = _simulate_decision(
            decision(), candles, None, DEFAULT_TAKER_FEE_RATE, 5.0, 1, 1_000.0
        )

        self.assertGreater(no_friction["pnlAfterKnownCostsQuote"], with_friction["pnlAfterKnownCostsQuote"])
        self.assertGreater(with_friction["feesPaidQuote"], 0)
        self.assertGreater(with_friction["slippageCostQuote"], 0)
        self.assertIsNone(with_friction["fundingPaidQuote"])
        self.assertIsNone(with_friction["netPnlQuote"])
        self.assertEqual(with_friction["outcome"], "UNAVAILABLE_FUNDING_DATA")
        self.assertAlmostEqual(
            with_friction["feesPaidQuote"],
            (1_000 + 1_000 * with_friction["exitPrice"] / with_friction["entryPrice"])
            * DEFAULT_TAKER_FEE_RATE,
            places=6,
        )

    def test_available_funding_is_charged_at_last_completed_candle_price(self):
        result, reason = _simulate_decision(
            decision(),
            [
                candle(1_000, close=100.0),
                candle(901_000, high=102.0, low=99.0, close=101.0),
                candle(1_801_000, high=106.0, low=100.0, close=105.0),
            ],
            [{"timestamp": 1_801_000, "rate": 0.001}],
            DEFAULT_TAKER_FEE_RATE,
            0.0,
            2,
            1_000.0,
        )

        self.assertIsNone(reason)
        self.assertAlmostEqual(result["fundingPaidQuote"], 1.01, places=2)
        self.assertIsNotNone(result["netPnlQuote"])

    def test_replay_metrics_and_confidence_intervals_require_thirty_closed_trades(self):
        decisions = [decision() for _ in range(30)]
        candles = [
            candle(1_000),
            candle(901_000, high=102.0, low=99.0, close=101.0),
            candle(1_801_000, high=106.0, low=100.0, close=105.0),
        ]
        with tempfile.TemporaryDirectory() as directory:
            market_file = Path(directory) / "BTC_USDT_USDT-15m-futures.feather"
            market_file.touch()
            with patch("scripts.historical_decision_replay._load_feather", return_value=candles):
                result = replay(decisions=decisions, data_dir=Path(directory))

        self.assertEqual(result["status"], "SUCCESS")
        self.assertEqual(result["label"], "REPLAY_SIMULATED")
        self.assertEqual(result["counts"]["replayableDecisions"], 30)
        self.assertEqual(result["metrics"]["tradeCount"], 30)
        self.assertIn("confidenceIntervals", result["metrics"])
        self.assertNotIn("outcomeSource", result)
        self.assertTrue(all(trade["label"] == "REPLAY_SIMULATED" for trade in result["trades"]))
        self.assertNotIn("FREQTRADE_CONFIRMED", str(result))

    def test_endpoint_replay_stays_unavailable_with_exact_counts_below_minimum(self):
        result = replay(decisions=[])

        self.assertEqual(result["status"], "HISTORICAL_SIGNALS_UNAVAILABLE")
        self.assertEqual(result["label"], "REPLAY_SIMULATED")
        self.assertEqual(result["counts"]["archivedDecisions"], 0)
        self.assertEqual(result["counts"]["replayableDecisions"], 0)
        self.assertEqual(result["counts"]["requiredReplayableDecisions"], 30)
        self.assertEqual(result["counts"]["additionalReplayableDecisionsNeeded"], 30)
        self.assertNotIn("trades", result)

    def test_missing_market_file_is_counted_as_unavailable_not_zero_performance(self):
        with tempfile.TemporaryDirectory() as directory:
            result = replay(decisions=[decision()], data_dir=Path(directory))

        self.assertEqual(result["status"], "HISTORICAL_SIGNALS_UNAVAILABLE")
        self.assertEqual(result["counts"]["archivedDecisions"], 1)
        self.assertEqual(result["counts"]["structurallyValidDecisions"], 1)
        self.assertEqual(result["counts"]["missingMarketData"], 1)
        self.assertEqual(result["counts"]["replayableDecisions"], 0)
        self.assertEqual(result["counts"]["additionalReplayableDecisionsNeeded"], 30)


if __name__ == "__main__":
    unittest.main()
