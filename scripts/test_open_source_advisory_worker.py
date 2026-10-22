from __future__ import annotations

import json
import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import numpy as np

from freqtrade_integration.advisory import open_source_advisory_worker as worker


class OpenSourceAdvisoryWorkerTests(unittest.TestCase):
    def mock_markov_regression(self, markov_regression: object):
        statsmodels = ModuleType("statsmodels")
        tsa = ModuleType("statsmodels.tsa")
        regime_switching = ModuleType("statsmodels.tsa.regime_switching")
        markov_regression_module = ModuleType(
            "statsmodels.tsa.regime_switching.markov_regression"
        )
        markov_regression_module.MarkovRegression = markov_regression
        statsmodels.tsa = tsa
        tsa.regime_switching = regime_switching
        regime_switching.markov_regression = markov_regression_module
        return patch.dict(sys.modules, {
            "statsmodels": statsmodels,
            "statsmodels.tsa": tsa,
            "statsmodels.tsa.regime_switching": regime_switching,
            "statsmodels.tsa.regime_switching.markov_regression": markov_regression_module,
        })

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

        with self.mock_markov_regression(FakeMarkovRegression):
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

        with self.mock_markov_regression(FakeMarkovRegression):
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

    def test_failed_news_sentiment_process_uses_local_lexicon(self) -> None:
        timestamp_ms = 123_000
        headlines = [{
            "headline": "Bitcoin adoption surged as institutional inflows rise",
            "publisher": "Example",
            "publishedAt": "now",
        }]
        with patch.object(
            worker.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=1, stdout="", stderr="No module named torch"),
        ):
            result = worker.analyze_news_isolated(headlines, timestamp_ms)

        self.assertEqual(result["status"], "AVAILABLE")
        self.assertEqual(result["sourceTimestampMs"], timestamp_ms)
        self.assertEqual(result["analysisMethod"], "LEXICON_FALLBACK")
        self.assertEqual(result["calibrationStatus"], "UNCALIBRATED")
        self.assertGreater(result["aggregateSentiment"], 0)
        self.assertIn("torch", result["fallbackReason"])

    def test_local_lexicon_does_not_invent_sentiment_without_keyword_matches(self) -> None:
        result = worker.analyze_news_with_lexicon(
            [{
                "headline": "Bitcoin market update",
                "publisher": "Example",
                "publishedAt": "now",
            }],
            123_000,
            "model unavailable",
        )

        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertIn("matched no sentiment terms", result["reason"])


if __name__ == "__main__":
    unittest.main()
