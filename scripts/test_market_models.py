import unittest
from unittest.mock import patch

from freqtrade_integration.strategies.sbk_signal_contract import (
    ENTRY_AUTHORIZATION_VERSION,
    SIGNAL_CONTRACT_VERSION,
    is_signal_runtime,
    is_valid_sbk_exit_signal,
    is_valid_sbk_signal,
    validate_bridge_url,
)
from scripts.garch_volatility import calculate_garch_regime
from scripts.predictor import calculate_prediction


def flat_candles(count=25):
    return [[100.0, 101.0, 99.0, 100.0, 10.0] for _ in range(count)]


def valid_sbk_signal(now_ms=1_800_000_000_000):
    observed_at_ms = now_ms - 500
    required_gate_ids = (
        "COUNCIL_REPORT",
        "LIVE_DATA",
        "REFERENCE_PRICE",
        "VOLATILITY",
        "EXECUTION_SPREAD",
        "TRADE_LEVELS",
        "STOP_AND_TARGET",
        "PORTFOLIO_RISK",
        "DAILY_LOSS",
        "RISK_ALLOCATION",
        "HOLDING_HORIZON",
    )
    return {
        "contractVersion": SIGNAL_CONTRACT_VERSION,
        "decisionId": "sbk1_" + "a" * 32,
        "signalId": "sbk1_" + "a" * 32,
        "exchange": "bybit",
        "market": "futures",
        "pair": "BTC/USDT:USDT",
        "direction": "LONG",
        "timeframe": "15m",
        "generatedAtMs": now_ms - 1_000,
        "expiresAtMs": now_ms + 44_000,
        "referencePrice": 62_100,
        "engineScore": 84,
        "dataQuality": {
            "status": "LIVE",
            "source": "Bybit Linear Futures Ticker (BTCUSDT)",
            "observedAtMs": observed_at_ms,
            "maxAgeMs": 5_000,
        },
        "entryConditions": {
            "setupType": "BULLISH_LIQUIDITY_SWEEP",
            "entryPrice": 62_100,
            "stopLoss": 61_800,
            "takeProfit": 62_700,
            "maxPriceDeviationBps": 50,
            "maxHoldingMinutes": 30,
        },
        "riskLimits": {
            "riskBudgetPct": 1,
            "maxStakeQuote": 100,
            "maxLeverage": 1,
        },
        "authorization": {
            "contractVersion": ENTRY_AUTHORIZATION_VERSION,
            "decision": "APPROVE_ENTRY",
            "decisionId": "sbk1_" + "a" * 32,
            "snapshotId": f"SNP_{observed_at_ms}_test",
            "snapshotTimestampMs": observed_at_ms,
            "evaluatedAtMs": observed_at_ms,
            "timeframe": "15m",
            "direction": "LONG",
            "gates": [
                {"id": gate_id, "status": "PASSED", "reason": "Isolated contract test evidence."}
                for gate_id in required_gate_ids
            ],
            "models": [],
            "disagreementVeto": False,
            "ensembleProbabilityPct": None,
            "riskRewardRatio": 2,
            "allocatedRiskUsd": 0.4,
            "holdingHorizonMinutes": 30,
        },
    }


class MarketModelFailClosedTests(unittest.TestCase):
    def test_signal_runtime_accepts_dry_run_only(self):
        self.assertTrue(is_signal_runtime("dry_run"))
        self.assertFalse(is_signal_runtime("live"))
        self.assertFalse(is_signal_runtime("backtest"))
        self.assertFalse(is_signal_runtime(""))

    def test_entry_authorization_uses_council_without_predictive_model_veto(self):
        now_ms = 1_800_000_000_000
        signal = valid_sbk_signal(now_ms)
        signal["authorization"]["disagreementVeto"] = True

        self.assertTrue(
            is_valid_sbk_signal(
                signal,
                now_ms=now_ms,
                expected_exchange="bybit",
                expected_market="futures",
                expected_pair="BTC/USDT:USDT",
                expected_timeframe="15m",
            )
        )

    def test_exit_signal_contract_requires_target_direction_reason_and_expiry(self):
        now_ms = 1_800_000_000_000
        signal = {
            "contractVersion": SIGNAL_CONTRACT_VERSION,
            "signalType": "EXIT",
            "exitId": "sbk1_exit_" + "b" * 32,
            "pair": "BTC/USDT:USDT",
            "tradeId": 42,
            "entryTag": "sbk1_" + "a" * 32,
            "direction": "LONG",
            "reason": "CONTRACT_TEST_ONLY thesis invalidation",
            "generatedAtMs": now_ms,
            "expiresAtMs": now_ms + 30_000,
        }
        self.assertTrue(
            is_valid_sbk_exit_signal(
                signal,
                now_ms=now_ms,
                expected_pair="BTC/USDT:USDT",
            )
        )
        for invalid in (
            {**signal, "tradeId": 0, "entryTag": None},
            {**signal, "direction": "FLAT"},
            {**signal, "reason": ""},
            {**signal, "expiresAtMs": now_ms},
            {**signal, "exitId": "wrong"},
        ):
            with self.subTest(invalid=invalid):
                self.assertFalse(
                    is_valid_sbk_exit_signal(
                        invalid,
                        now_ms=now_ms,
                        expected_pair="BTC/USDT:USDT",
                    )
                )

    def test_dry_run_fixture_allows_bounded_strategy_poll_latency(self):
        now_ms = 1_800_000_000_000
        signal = valid_sbk_signal(now_ms)
        signal["generatedAtMs"] = now_ms - 40_000
        signal["expiresAtMs"] = now_ms + 20_000
        signal["entryConditions"]["setupType"] = "DRY_RUN_E2E_FIXTURE_TEST"
        signal["dataQuality"]["maxAgeMs"] = 55_000
        signal["dataQuality"]["observedAtMs"] = now_ms - 40_000
        signal["authorization"]["snapshotTimestampMs"] = now_ms - 40_000
        signal["authorization"]["evaluatedAtMs"] = now_ms - 40_000
        signal["authorization"]["snapshotId"] = f"SNP_{now_ms - 40_000}_test"
        signal["authorization"].update({
            "decision": "DRY_RUN_TEST_ONLY",
            "models": [],
            "ensembleProbabilityPct": None,
        })
        with patch.dict("os.environ", {"SBK1_DRY_RUN_FIXTURE_ENABLED": "true"}):
            self.assertTrue(
                is_valid_sbk_signal(
                    signal,
                    now_ms=now_ms,
                    expected_exchange="bybit",
                    expected_market="futures",
                    expected_pair="BTC/USDT:USDT",
                    expected_timeframe="15m",
                )
            )

    def test_predictor_marks_missing_candles_unavailable(self):
        result = calculate_prediction({})

        self.assertEqual(result["status"], "DATA_UNAVAILABLE")
        self.assertFalse(result["tradeEligible"])
        self.assertIsNone(result["trend"])
        self.assertIsNone(result["heuristicConvictionScore"])
        self.assertIsNone(result["calibratedWinProbability"])
        self.assertIsNone(result["microVector"]["nextCandleDirection"])

    def test_predictor_rejects_invalid_candle_instead_of_using_partial_input(self):
        candles = flat_candles()
        candles[-1] = [100.0, 99.0, 98.0, 100.0, 10.0]

        result = calculate_prediction({"candles": candles})

        self.assertEqual(result["status"], "DATA_UNAVAILABLE")
        self.assertFalse(result["tradeEligible"])

    def test_predictor_valid_output_is_heuristic_not_a_trade_signal(self):
        result = calculate_prediction({"candles": flat_candles()})

        self.assertEqual(result["status"], "ANALYSIS_ONLY")
        self.assertFalse(result["tradeEligible"])
        self.assertEqual(result["trend"], "NEUTRAL")
        self.assertIsNone(result["calibratedWinProbability"])
        self.assertIsNone(result["microVector"]["nextCandleDirection"])
        self.assertEqual(result["inputs"]["orderBookImbalanceStatus"], "UNAVAILABLE")

    def test_garch_missing_candles_has_no_neutral_regime_fallback(self):
        result = calculate_garch_regime({})

        self.assertEqual(result["status"], "DATA_UNAVAILABLE")
        self.assertFalse(result["tradeEligible"])
        self.assertIsNone(result["regime"])
        self.assertIsNone(result["expansionProbability"])
        self.assertIsNone(result["targetMultiplier"])

    def test_garch_discloses_fixed_unvalidated_parameters(self):
        result = calculate_garch_regime({"candles": flat_candles()})

        self.assertEqual(result["status"], "ANALYSIS_ONLY")
        self.assertFalse(result["tradeEligible"])
        self.assertEqual(result["parameterStatus"], "FIXED_NOT_FITTED_OR_VALIDATED")
        self.assertEqual(result["volatilityUnit"], "PERCENT_PER_CANDLE")
        self.assertIsNone(result["expansionProbability"])
        self.assertIsNone(result["targetMultiplier"])

    def test_python_consumer_accepts_the_versioned_authorized_signal_contract(self):
        now_ms = 1_800_000_000_000

        self.assertTrue(
            is_valid_sbk_signal(
                valid_sbk_signal(now_ms),
                now_ms=now_ms,
                expected_exchange="bybit",
                expected_market="futures",
                expected_pair="BTC/USDT:USDT",
                expected_timeframe="15m",
            )
        )

    def test_python_consumer_defaults_to_uncalibrated_heuristic_without_fabricating_score(self):
        now_ms = 1_800_000_000_000
        signal = valid_sbk_signal(now_ms)
        signal["engineScore"] = None

        self.assertTrue(
            is_valid_sbk_signal(
                signal,
                now_ms=now_ms,
                expected_exchange="bybit",
                expected_market="futures",
                expected_pair="BTC/USDT:USDT",
                expected_timeframe="15m",
            )
        )

        signal["evidenceLevel"] = "CALIBRATED"
        self.assertFalse(
            is_valid_sbk_signal(
                signal,
                now_ms=now_ms,
                expected_exchange="bybit",
                expected_market="futures",
                expected_pair="BTC/USDT:USDT",
                expected_timeframe="15m",
            )
        )

    def test_python_consumer_rejects_failed_execution_gate(self):
        now_ms = 1_800_000_000_000
        failed_gate = valid_sbk_signal(now_ms)
        failed_gate["authorization"]["gates"][0]["status"] = "FAILED"

        self.assertFalse(
            is_valid_sbk_signal(
                failed_gate,
                now_ms=now_ms,
                expected_exchange="bybit",
                expected_market="futures",
                expected_pair="BTC/USDT:USDT",
                expected_timeframe="15m",
            )
        )

    def test_python_consumer_ignores_optional_model_disagreement(self):
        now_ms = 1_800_000_000_000
        signal = valid_sbk_signal(now_ms)
        signal["authorization"]["disagreementVeto"] = True
        signal["authorization"]["models"] = [{"status": "UNAVAILABLE"}]

        self.assertTrue(
            is_valid_sbk_signal(
                signal,
                now_ms=now_ms,
                expected_exchange="bybit",
                expected_market="futures",
                expected_pair="BTC/USDT:USDT",
                expected_timeframe="15m",
            )
        )

    def test_python_consumer_rejects_risk_allocation_above_stop_loss_exposure(self):
        now_ms = 1_800_000_000_000
        signal = valid_sbk_signal(now_ms)
        signal["authorization"]["allocatedRiskUsd"] = 1

        self.assertFalse(
            is_valid_sbk_signal(
                signal,
                now_ms=now_ms,
                expected_exchange="bybit",
                expected_market="futures",
                expected_pair="BTC/USDT:USDT",
                expected_timeframe="15m",
            )
        )


    def test_python_consumer_rejects_stale_and_mismatched_contract_data(self):
        now_ms = 1_800_000_000_000
        stale = valid_sbk_signal(now_ms)
        stale["dataQuality"]["observedAtMs"] = now_ms - 15_001
        invalid_timestamp = valid_sbk_signal(now_ms)
        invalid_timestamp["generatedAtMs"] = True

        for signal in (stale, invalid_timestamp, {**valid_sbk_signal(now_ms), "pair": "ETH/USDT:USDT"}):
            with self.subTest(signal=signal):
                self.assertFalse(
                    is_valid_sbk_signal(
                        signal,
                        now_ms=now_ms,
                        expected_exchange="bybit",
                        expected_market="futures",
                        expected_pair="BTC/USDT:USDT",
                        expected_timeframe="15m",
                    )
                )

    def test_python_consumer_rejects_invalid_risk_and_spot_short_signals(self):
        now_ms = 1_800_000_000_000
        invalid_reward = valid_sbk_signal(now_ms)
        invalid_reward["entryConditions"]["takeProfit"] = 62_200
        oversized_risk = valid_sbk_signal(now_ms)
        oversized_risk["riskLimits"]["riskBudgetPct"] = 10**10_000
        spot_short = valid_sbk_signal(now_ms)
        spot_short["market"] = "spot"
        spot_short["direction"] = "SHORT"
        spot_short["entryConditions"].update({"stopLoss": 62_400, "takeProfit": 61_800})

        for signal in (invalid_reward, oversized_risk, spot_short):
            with self.subTest(signal=signal):
                self.assertFalse(
                    is_valid_sbk_signal(
                        signal,
                        now_ms=now_ms,
                        expected_exchange="bybit",
                        expected_market=signal["market"],
                        expected_pair="BTC/USDT:USDT",
                        expected_timeframe="15m",
                    )
                )

    def test_bridge_url_only_allows_remote_https(self):
        self.assertEqual(
            validate_bridge_url("http://127.0.0.1:3000/"),
            "http://127.0.0.1:3000",
        )
        self.assertEqual(
            validate_bridge_url("https://sbk.example:3000/"),
            "https://sbk.example:3000",
        )
        for url in (
            "http://sbk.example:3000",
            "https://user:password@sbk.example",
            "https://sbk.example?token=secret",
            "https://sbk.example:invalid",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_bridge_url(url)


if __name__ == "__main__":
    unittest.main()
