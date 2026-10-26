from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT_DIRECTORY = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIRECTORY))

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault(
    "SBK1_MODEL_CACHE_DIR",
    str(Path(".cache/sbk1/open-source-models").resolve()),
)

from freqtrade_integration.advisory.open_source_advisory_worker import analyze_request


def make_candles(count: int = 260) -> list[dict[str, float | int]]:
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    candles = []
    for index in range(count):
        close = 60_000 + index * 2.1 + 180 * math.sin(index / 7) + 60 * math.sin(index / 2.7)
        open_price = close - 25 * math.sin(index / 3.1)
        candles.append({
            "timestampMs": now_ms - (count - index) * 900_000,
            "open": open_price,
            "high": max(open_price, close) + 35 + index % 5,
            "low": min(open_price, close) - 32 - index % 7,
            "close": close,
            "volume": 100 + index % 17 * 3 + 20 * abs(math.sin(index / 5)),
        })
    return candles


def main() -> None:
    headline_timestamp = datetime.now(timezone.utc).isoformat()
    report = analyze_request({
        "requestId": "open-source-local-runtime-verification",
        "pair": "BTC/USDT:USDT",
        "candles": make_candles(),
        "headlines": [{
            "headline": "TEST ONLY: Company reports stronger quarterly revenue and improved outlook",
            "publisher": "Local test fixture",
            "publishedAt": headline_timestamp,
            "pair": "BTC/USDT:USDT",
        }],
    })
    expected_modules = {
        "candlestickPatterns",
        "marketRegime",
        "marketAnomaly",
        "lightgbmForecast",
        "xgboostForecast",
        "newsSentiment",
    }
    actual_modules = report["modules"]
    if set(actual_modules) != expected_modules:
        raise AssertionError(f"Unexpected advisory module set: {sorted(actual_modules)}")
    failed = {
        name: result
        for name, result in actual_modules.items()
        if result.get("status") != "AVAILABLE"
    }
    if failed:
        raise AssertionError(f"Local advisory modules did not all execute: {json.dumps(failed, sort_keys=True)}")

    for name in ("lightgbmForecast", "xgboostForecast"):
        result = actual_modules[name]
        if (
            not isinstance(result.get("prediction"), (int, float))
            or not math.isfinite(result["prediction"])
            or result.get("trainingRows", 0) < 120
            or result.get("chronologicalHoldoutRows", 0) < 20
            or result.get("calibrationStatus") != "UNVALIDATED"
        ):
            raise AssertionError(f"{name} did not produce a valid uncalibrated fit/predict result.")

    sentiment = actual_modules["newsSentiment"]
    if (
        sentiment.get("headlineCount") != 1
        or not isinstance(sentiment.get("aggregateSentiment"), (int, float))
        or not math.isfinite(sentiment["aggregateSentiment"])
    ):
        raise AssertionError("Local financial-news sentiment inference did not return a finite score.")

    print(json.dumps({
        "requestId": report["requestId"],
        "overallStatus": report["status"],
        "decisionInfluence": report["decisionInfluence"],
        "sourceTimestampMs": report["sourceTimestampMs"],
        "modules": {
            name: {
                "status": result["status"],
                "library": result.get("library"),
                "trainingRows": result.get("trainingRows"),
                "holdoutRows": result.get("chronologicalHoldoutRows"),
                "calibrationStatus": result.get("calibrationStatus"),
                "sentimentScore": result.get("aggregateSentiment"),
            }
            for name, result in actual_modules.items()
        },
        "modelCache": os.environ["SBK1_MODEL_CACHE_DIR"],
        "networkDownloadsAllowed": False,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
