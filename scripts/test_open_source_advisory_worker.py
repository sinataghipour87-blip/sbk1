from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from freqtrade_integration.advisory import open_source_advisory_worker as worker


class OpenSourceAdvisoryWorkerTests(unittest.TestCase):
    def make_candles(self, count: int = 205) -> list[dict[str, float | int]]:
        return [
            {
                "timestampMs": index * 60_000 + 1,
                "open": 100.0 + index,
                "high": 102.0 + index,
                "low": 99.0 + index,
                "close": 101.0 + index,
                "volume": 10_000.0 + index * 500,
            }
            for index in range(count)
        ]

    def test_validate_candles_rejects_inconsistent_ohlc(self) -> None:
        candles = self.make_candles(1)
        candles[0]["high"] = 90.0
        with self.assertRaisesRegex(ValueError, "inconsistent"):
            worker.validate_candles(candles)

    def test_regime_model_uses_close_prices_not_volume(self) -> None:
        candles = self.make_candles()
        captured: dict[str, np.ndarray] = {}

        class FakeMarkovRegression:
            def __init__(self, endog: np.ndarray, **_kwargs: object) -> None:
                captured["endog"] = endog

            def fit(self, **_kwargs: object) -> SimpleNamespace:
                return SimpleNamespace(
                    mle_retvals={"converged": True},
                    smoothed_marginal_probabilities=np.tile(
                        np.array([0.8, 0.2]), (len(captured["endog"]), 1)
                    ),
                )

        with patch(
            "statsmodels.tsa.regime_switching.markov_regression.MarkovRegression",
            FakeMarkovRegression,
        ):
            result = worker.analyze_regime(candles, int(candles[-1]["timestampMs"]))

        expected = np.diff(np.log(np.asarray([item["close"] for item in candles]))) * 100
        np.testing.assert_allclose(captured["endog"], expected)
        self.assertEqual(result["status"], "AVAILABLE")
        self.assertEqual(result["observations"], len(candles) - 1)

    def test_regime_model_accepts_floating_point_probability_roundoff(self) -> None:
        candles = self.make_candles()

        class FakeMarkovRegression:
            def __init__(self, endog: np.ndarray, **_kwargs: object) -> None:
                self.observation_count = len(endog)

            def fit(self, **_kwargs: object) -> SimpleNamespace:
                return SimpleNamespace(
                    mle_retvals={"converged": True},
                    smoothed_marginal_probabilities=np.tile(
                        np.array([1.0000000000000036, 1e-12]),
                        (self.observation_count, 1),
                    ),
                )

        with patch(
            "statsmodels.tsa.regime_switching.markov_regression.MarkovRegression",
            FakeMarkovRegression,
        ):
            result = worker.analyze_regime(candles, int(candles[-1]["timestampMs"]))

        self.assertEqual(result["status"], "AVAILABLE")
        probabilities = result["regimes"]
        self.assertTrue(all(0 <= probability <= 1 for probability in probabilities.values()))
        self.assertAlmostEqual(sum(probabilities.values()), 1.0)

    def test_request_returns_only_advisory_contract(self) -> None:
        candles = self.make_candles(4)
        request = {"requestId": "test-1", "candles": candles, "headlines": []}
        with patch.object(
            worker,
            "module_result",
            side_effect=lambda _name, _analyzer, *_args: {"status": "UNAVAILABLE", "sourceTimestampMs": None},
        ):
            report = worker.analyze_request(request)

        self.assertEqual(report["requestId"], "test-1")
        self.assertEqual(report["status"], "UNAVAILABLE")
        self.assertEqual(report["decisionInfluence"], "ADVISORY_ONLY")
        self.assertEqual(len(report["modules"]), 6)

    def test_news_sentiment_runs_in_isolated_process(self) -> None:
        timestamp_ms = 123_000
        response = {"status": "AVAILABLE", "sourceTimestampMs": timestamp_ms}
        with patch.object(
            worker.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=0, stdout=json.dumps(response), stderr=""),
        ) as run:
            result = worker.analyze_news_isolated(
                [{"headline": "Market update", "publisher": "Example", "publishedAt": "now"}],
                timestamp_ms,
            )

        self.assertEqual(result, response)
        self.assertIn("--sentiment", run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs["timeout"], 60)

    def test_failed_news_sentiment_process_is_unavailable(self) -> None:
        timestamp_ms = 123_000
        with patch.object(
            worker.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=143, stdout="", stderr="terminated"),
        ):
            result = worker.analyze_news_isolated(
                [{"headline": "Market update", "publisher": "Example", "publishedAt": "now"}],
                timestamp_ms,
            )

        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["sourceTimestampMs"], timestamp_ms)
        self.assertIn("status 143", result["reason"])


if __name__ == "__main__":
    unittest.main()
