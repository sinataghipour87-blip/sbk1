from __future__ import annotations

import json
import logging
import math
import os
import re
import subprocess
import sys
import time
from functools import lru_cache
from typing import Any

for thread_variable in (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
):
    os.environ.setdefault(thread_variable, "1")

logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(message)s")
LOGGER = logging.getLogger("sbk1.open_source_advisories")
CONTRACT_VERSION = "sbk1.open-source-advisories.v1"
SUPPORTED_PAIRS = {
    "BTC/USDT:USDT",
    "ETH/USDT:USDT",
    "SOL/USDT:USDT",
    "XRP/USDT:USDT",
    "BNB/USDT:USDT",
}
NEWS_MODEL = "mrm8488/distilroberta-finetuned-financial-news-sentiment-analysis"
NEWS_MODEL_REVISION = "ae0eab9ad336d7d548e0efe394b07c04bcaf6e91"
LEXICON_POSITIVE_TERMS = {
    "adoption", "approved", "approval", "bullish", "gain", "gains", "inflow",
    "outperform", "outperforms", "rally", "rallies", "rebound", "recovered",
    "recovery", "record", "rise", "rises", "rising", "surge", "surges",
    "صعود", "افزایش", "رشد", "جهش", "رکورد", "تایید", "تصویب", "پذیرش",
}
LEXICON_NEGATIVE_TERMS = {
    "ban", "banned", "bankruptcy", "bearish", "crash", "crashes", "decline",
    "default", "defaults", "drop", "dropped", "exploit", "falling", "fraud",
    "hack", "hacked", "liquidation", "loss", "losses", "outflow", "plunge",
    "plunges", "selloff", "sued", "lawsuit",
    "افت", "کاهش", "سقوط", "ریزش", "ممنوع", "ورشکستگی", "هک", "خروج", "لیکویید",
}
FEATURE_NAMES = (
    "return_1",
    "return_4",
    "range_fraction",
    "body_fraction",
    "upper_wick_fraction",
    "lower_wick_fraction",
    "volume_change",
    "realized_volatility_20",
    "rsi_14",
    "atr_fraction_14",
    "adx_14",
)


def unavailable(reason: str, source_timestamp_ms: int | None = None) -> dict[str, Any]:
    return {
        "status": "UNAVAILABLE",
        "sourceTimestampMs": source_timestamp_ms,
        "reason": reason,
    }


def available(source_timestamp_ms: int, **values: Any) -> dict[str, Any]:
    return {
        "status": "AVAILABLE",
        "sourceTimestampMs": source_timestamp_ms,
        **values,
    }


def module_result(name: str, analyzer: Any, *args: Any) -> dict[str, Any]:
    try:
        return analyzer(*args)
    except Exception as error:
        LOGGER.exception("%s advisory analysis failed", name)
        return unavailable(f"{type(error).__name__}: {str(error)[:240]}")


def validate_candles(value: Any) -> tuple[list[dict[str, float]], int]:
    if not isinstance(value, list) or not 1 <= len(value) <= 500:
        raise ValueError("candles must contain between 1 and 500 completed bars")
    candles: list[dict[str, float]] = []
    previous_timestamp = 0
    for candle in value:
        if not isinstance(candle, dict):
            raise ValueError("each candle must be an object")
        timestamp = candle.get("timestampMs")
        if isinstance(timestamp, bool) or not isinstance(timestamp, int) or timestamp <= previous_timestamp:
            raise ValueError("candle timestamps must be positive and strictly increasing")
        previous_timestamp = timestamp
        normalized: dict[str, float] = {"timestampMs": timestamp}
        for key in ("open", "high", "low", "close", "volume"):
            raw = candle.get(key)
            if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
                raise ValueError(f"candle {key} must be finite")
            normalized[key] = float(raw)
        if (
            min(normalized["open"], normalized["high"], normalized["low"], normalized["close"]) <= 0
            or normalized["volume"] < 0
            or normalized["high"] < max(normalized["open"], normalized["close"], normalized["low"])
            or normalized["low"] > min(normalized["open"], normalized["close"], normalized["high"])
        ):
            raise ValueError("candle OHLCV values are inconsistent")
        candles.append(normalized)
    return candles, previous_timestamp


def arrays(candles: list[dict[str, float]]) -> tuple[Any, Any, Any, Any, Any]:
    import numpy as np

    return tuple(
        np.asarray([candle[key] for candle in candles], dtype=np.float64)
        for key in ("open", "high", "low", "close", "volume")
    )


def analyze_candle_patterns(candles: list[dict[str, float]], timestamp_ms: int) -> dict[str, Any]:
    import numpy as np
    import talib

    if len(candles) < 3:
        return unavailable("At least 3 completed candles are required.", timestamp_ms)
    open_values, high_values, low_values, close_values, _ = arrays(candles)
    patterns = []
    for name in talib.get_function_groups()["Pattern Recognition"]:
        values = getattr(talib, name)(open_values, high_values, low_values, close_values)
        raw_value = float(values[-1])
        if not np.isfinite(raw_value) or raw_value == 0:
            continue
        patterns.append({
            "name": name,
            "direction": "BULLISH" if raw_value > 0 else "BEARISH",
            "rawStrength": int(raw_value),
        })
    return available(
        timestamp_ms,
        library="TA-Lib",
        candleTimestampMs=timestamp_ms,
        matchedPatternCount=len(patterns),
        patterns=patterns,
        interpretation="Pattern detection only; not a price forecast.",
    )


def feature_matrix(candles: list[dict[str, float]]) -> tuple[Any, Any, Any]:
    import numpy as np
    import pandas as pd
    import talib

    open_values, high_values, low_values, close_values, volume_values = arrays(candles)
    previous_close = np.roll(close_values, 1)
    previous_close[0] = np.nan
    returns = close_values / previous_close - 1
    previous_volume = np.roll(volume_values, 1)
    previous_volume[0] = np.nan
    volume_change = volume_values / np.maximum(previous_volume, 1e-12) - 1
    candle_range = (high_values - low_values) / close_values
    body = (close_values - open_values) / open_values
    upper_wick = (high_values - np.maximum(open_values, close_values)) / close_values
    lower_wick = (np.minimum(open_values, close_values) - low_values) / close_values
    frame = pd.DataFrame({
        "return_1": returns,
        "return_4": pd.Series(close_values).pct_change(4).to_numpy(),
        "range_fraction": candle_range,
        "body_fraction": body,
        "upper_wick_fraction": upper_wick,
        "lower_wick_fraction": lower_wick,
        "volume_change": volume_change,
        "realized_volatility_20": pd.Series(returns).rolling(20, min_periods=20).std().to_numpy(),
        "rsi_14": talib.RSI(close_values, timeperiod=14) / 100.0,
        "atr_fraction_14": talib.ATR(high_values, low_values, close_values, timeperiod=14) / close_values,
        "adx_14": talib.ADX(high_values, low_values, close_values, timeperiod=14) / 100.0,
    })
    features = frame.replace([np.inf, -np.inf], np.nan).to_numpy(dtype=np.float64)
    target = np.full(len(close_values), np.nan, dtype=np.float64)
    if len(close_values) > 4:
        target[:-4] = close_values[4:] / close_values[:-4] - 1
    return features, target, close_values


def analyze_anomaly(candles: list[dict[str, float]], timestamp_ms: int) -> dict[str, Any]:
    import numpy as np
    from sklearn.ensemble import IsolationForest

    features, _, _ = feature_matrix(candles)
    valid = np.isfinite(features).all(axis=1)
    if not valid[-1]:
        return unavailable("Latest candle feature vector is incomplete.", timestamp_ms)
    clean = features[valid]
    if len(clean) < 101:
        return unavailable("At least 100 historical feature rows plus the latest row are required.", timestamp_ms)
    training_features = clean[:-1]
    latest_features = clean[-1:]
    model = IsolationForest(
        n_estimators=100,
        contamination="auto",
        random_state=42,
        n_jobs=1,
    ).fit(training_features)
    score = float(model.decision_function(latest_features)[0])
    prediction = int(model.predict(latest_features)[0])
    return available(
        timestamp_ms,
        library="scikit-learn IsolationForest",
        classification="ANOMALOUS" if prediction < 0 else "WITHIN_TRAINING_DISTRIBUTION",
        anomalyScore=score,
        trainingRows=len(training_features),
        interpretation="Distribution novelty warning only; not a data-validity proof.",
    )


def analyze_regime(candles: list[dict[str, float]], timestamp_ms: int) -> dict[str, Any]:
    import numpy as np
    from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression

    _, _, _, close_values, _ = arrays(candles)
    returns = np.diff(np.log(close_values)) * 100
    returns = returns[np.isfinite(returns)]
    if len(returns) < 200:
        return unavailable("At least 200 return observations are required.", timestamp_ms)
    fitted = MarkovRegression(
        returns,
        k_regimes=2,
        trend="c",
        switching_variance=True,
    ).fit(disp=False, maxiter=100)
    if not bool(fitted.mle_retvals.get("converged", False)):
        return unavailable("Markov regime fit did not converge.", timestamp_ms)
    probabilities = np.asarray(fitted.smoothed_marginal_probabilities, dtype=np.float64)
    if (
        probabilities.ndim != 2
        or probabilities.shape[0] != len(returns)
        or probabilities.shape[1] != 2
        or not np.isfinite(probabilities).all()
        or np.any(probabilities < -1e-8)
        or np.any(probabilities > 1 + 1e-8)
        or not np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-4)
    ):
        return unavailable("Model returned an invalid smoothed probability matrix.", timestamp_ms)
    probabilities = np.clip(probabilities, 0.0, 1.0)
    row_totals = probabilities.sum(axis=1, keepdims=True)
    if np.any(row_totals <= 0):
        return unavailable("Model returned an empty smoothed probability row.", timestamp_ms)
    probabilities /= row_totals
    weighted_variances = [
        float(np.average((returns - np.average(returns, weights=probabilities[:, index])) ** 2,
                         weights=probabilities[:, index]))
        for index in range(probabilities.shape[1])
    ]
    high_volatility_state = int(np.argmax(weighted_variances))
    low_volatility_state = int(np.argmin(weighted_variances))
    latest = probabilities[-1]
    high_probability = float(latest[high_volatility_state])
    low_probability = float(latest[low_volatility_state])
    return available(
        timestamp_ms,
        library="statsmodels MarkovRegression",
        regimes={
            "LOWER_VOLATILITY": float(latest[low_volatility_state]),
            "HIGHER_VOLATILITY": float(latest[high_volatility_state]),
        },
        dominantRegime="HIGHER_VOLATILITY" if high_probability >= low_probability else "LOWER_VOLATILITY",
        observations=len(returns),
        converged=True,
        interpretation="Two-state volatility-regime estimate; states are descriptive, not directional votes.",
    )


def explain_model(model: Any, row: Any) -> dict[str, Any]:
    import numpy as np
    import shap

    values = shap.TreeExplainer(model).shap_values(row)
    values = np.asarray(values, dtype=np.float64).reshape(-1)
    top_indices = np.argsort(np.abs(values))[::-1][:5]
    return {
        "status": "AVAILABLE",
        "library": "SHAP TreeExplainer",
        "topFeatures": [
            {"feature": FEATURE_NAMES[int(index)], "contribution": float(values[index])}
            for index in top_indices
        ],
        "interpretation": "Local feature contributions for this model output; not causal effects.",
    }


def train_and_forecast(model_name: str, candles: list[dict[str, float]], timestamp_ms: int) -> dict[str, Any]:
    import numpy as np
    from sklearn.metrics import mean_absolute_error

    features, target, _ = feature_matrix(candles)
    valid = np.isfinite(features).all(axis=1) & np.isfinite(target)
    x = features[valid]
    y = target[valid]
    if len(y) < 120:
        return unavailable("At least 120 labeled candle rows are required.", timestamp_ms)
    latest_features = features[-1:]
    if not np.isfinite(latest_features).all():
        return unavailable("Latest candle feature vector is incomplete.", timestamp_ms)
    split = int(len(y) * 0.8)
    training_end = split - 4
    if training_end < 80 or len(y) - split < 20:
        return unavailable("Insufficient purged chronological holdout rows.", timestamp_ms)

    if model_name == "LightGBM":
        from lightgbm import LGBMRegressor

        make_model = lambda: LGBMRegressor(
            n_estimators=80,
            learning_rate=0.03,
            max_depth=3,
            num_leaves=7,
            min_child_samples=10,
            verbosity=-1,
            n_jobs=1,
            random_state=42,
        )
    else:
        from xgboost import XGBRegressor

        make_model = lambda: XGBRegressor(
            n_estimators=80,
            learning_rate=0.03,
            max_depth=3,
            subsample=0.8,
            colsample_bytree=0.8,
            objective="reg:squarederror",
            n_jobs=1,
            random_state=42,
            verbosity=0,
        )

    evaluation_model = make_model().fit(x[:training_end], y[:training_end])
    held_out = evaluation_model.predict(x[split:])
    baseline_mae = float(mean_absolute_error(y[split:], np.zeros(len(y) - split)))
    model_mae = float(mean_absolute_error(y[split:], held_out))
    model = make_model().fit(x, y)
    predicted_return = float(model.predict(latest_features)[0])
    try:
        explainability = explain_model(model, latest_features)
    except Exception as error:
        LOGGER.exception("%s SHAP explanation failed", model_name)
        explainability = {
            "status": "UNAVAILABLE",
            "reason": f"{type(error).__name__}: {str(error)[:240]}",
        }
    return available(
        timestamp_ms,
        library=model_name,
        target="four-candle-forward-return",
        prediction=predicted_return,
        interpretedDirection="LONG_BIAS" if predicted_return > 0 else "SHORT_BIAS" if predicted_return < 0 else "NEUTRAL",
        calibrationStatus="UNVALIDATED",
        trainingRows=len(y),
        evaluationTrainingRows=training_end,
        chronologicalHoldoutRows=len(y) - split,
        holdoutMae=model_mae,
        zeroReturnBaselineMae=baseline_mae,
        holdoutRelativeMaePct=(model_mae / baseline_mae - 1) * 100 if baseline_mae > 0 else None,
        explainability=explainability,
        interpretation="Experimental regression analysis only; raw return estimate is not a win probability.",
    )


@lru_cache(maxsize=1)
def load_news_model() -> tuple[Any, Any, Any]:
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    torch.set_num_threads(1)
    cache_dir = os.environ.get("SBK1_MODEL_CACHE_DIR")
    tokenizer = AutoTokenizer.from_pretrained(
        NEWS_MODEL,
        revision=NEWS_MODEL_REVISION,
        cache_dir=cache_dir,
        use_fast=True,
        local_files_only=True,
    )
    model = AutoModelForSequenceClassification.from_pretrained(
        NEWS_MODEL,
        revision=NEWS_MODEL_REVISION,
        cache_dir=cache_dir,
        use_safetensors=True,
        local_files_only=True,
    )
    model.eval()
    return torch, tokenizer, model


def analyze_news(headlines: list[dict[str, Any]], timestamp_ms: int) -> dict[str, Any]:
    if not headlines:
        return unavailable("No fresh headlines were supplied by configured RSS sources.", timestamp_ms)
    torch, tokenizer, model = load_news_model()
    texts = [headline["headline"] for headline in headlines[:24]]
    encoded = tokenizer(texts, padding=True, truncation=True, max_length=160, return_tensors="pt")
    with torch.inference_mode():
        probabilities = torch.softmax(model(**encoded).logits, dim=-1).cpu().tolist()
    labels = model.config.id2label
    normalized_labels = {int(key): str(value).lower() for key, value in labels.items()}
    if not any("positive" in label for label in normalized_labels.values()) or not any(
        "negative" in label for label in normalized_labels.values()
    ):
        return unavailable("The loaded sentiment model has no recognizable positive/negative labels.", timestamp_ms)

    output = []
    scores = []
    for headline, values in zip(headlines[:24], probabilities, strict=True):
        label_probabilities = {
            normalized_labels[index]: float(value)
            for index, value in enumerate(values)
        }
        positive = next(value for label, value in label_probabilities.items() if "positive" in label)
        negative = next(value for label, value in label_probabilities.items() if "negative" in label)
        neutral = next((value for label, value in label_probabilities.items() if "neutral" in label), 0.0)
        scores.append(positive - negative)
        output.append({
            "headline": headline["headline"],
            "publisher": headline["publisher"],
            "publishedAt": headline["publishedAt"],
            "positiveProbability": positive,
            "neutralProbability": neutral,
            "negativeProbability": negative,
            "sentiment": "POSITIVE" if positive > max(negative, neutral) else "NEGATIVE" if negative > max(positive, neutral) else "NEUTRAL",
        })
    return available(
        timestamp_ms,
        library="Transformers financial-news sentiment model",
        model=NEWS_MODEL,
        revision=NEWS_MODEL_REVISION,
        license="Apache-2.0",
        headlineCount=len(output),
        aggregateSentiment=float(sum(scores) / len(scores)),
        headlines=output,
        interpretation="Headline sentiment only; no article-body, crypto-specific, or market-impact inference.",
    )


def analyze_news_with_lexicon(
    headlines: list[dict[str, Any]],
    timestamp_ms: int,
    fallback_reason: str,
) -> dict[str, Any]:
    output = []
    scores = []
    matched_headlines = 0
    for headline in headlines[:24]:
        text = headline["headline"].lower()
        tokens = set(re.findall(r"[a-z]+|[\u0600-\u06ff]+", text))
        positive_matches = sorted(LEXICON_POSITIVE_TERMS.intersection(tokens))
        negative_matches = sorted(LEXICON_NEGATIVE_TERMS.intersection(tokens))
        positive_count = len(positive_matches)
        negative_count = len(negative_matches)
        matched = positive_count + negative_count
        if matched:
            matched_headlines += 1
        score = (positive_count - negative_count) / matched if matched else 0.0
        scores.append(score)
        output.append({
            "headline": headline["headline"],
            "publisher": headline["publisher"],
            "publishedAt": headline["publishedAt"],
            "positiveMatches": positive_matches,
            "negativeMatches": negative_matches,
            "sentiment": "POSITIVE" if score > 0 else "NEGATIVE" if score < 0 else "NEUTRAL",
        })
    if matched_headlines == 0:
        return unavailable(
            f"Local finance lexicon matched no sentiment terms; model unavailable: {fallback_reason}",
            timestamp_ms,
        )
    return available(
        timestamp_ms,
        library="Built-in conservative financial-news keyword lexicon",
        analysisMethod="LEXICON_FALLBACK",
        calibrationStatus="UNCALIBRATED",
        fallbackReason=fallback_reason,
        headlineCount=len(output),
        sentimentMatchedHeadlineCount=matched_headlines,
        aggregateSentiment=float(sum(scores) / len(scores)),
        headlines=output,
        interpretation=(
            "Uncalibrated keyword-only headline sentiment; negation, context, "
            "article bodies, and market impact are not modeled."
        ),
    )


def analyze_news_isolated(headlines: list[dict[str, Any]], timestamp_ms: int) -> dict[str, Any]:
    if not headlines:
        return unavailable("No fresh headlines were supplied by configured RSS sources.", timestamp_ms)
    try:
        result = subprocess.run(
            [sys.executable, os.path.abspath(__file__), "--sentiment"],
            input=json.dumps({"headlines": headlines, "sourceTimestampMs": timestamp_ms}),
            text=True,
            capture_output=True,
            timeout=60,
            check=False,
            env=os.environ.copy(),
        )
    except subprocess.TimeoutExpired:
        reason = "Isolated sentiment model exceeded its 60-second timeout."
        LOGGER.warning("%s Falling back to the built-in news lexicon.", reason)
        return analyze_news_with_lexicon(headlines, timestamp_ms, reason)

    if result.returncode != 0:
        failure_detail = result.stderr.strip().splitlines()[-1:]
        reason = f"Isolated sentiment process exited with status {result.returncode}."
        if failure_detail:
            reason = f"{reason} {failure_detail[0][:240]}"
        LOGGER.warning(
            "Isolated sentiment process exited with status %s: %s",
            result.returncode,
            result.stderr[-1_000:],
        )
        return analyze_news_with_lexicon(headlines, timestamp_ms, reason)
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError:
        reason = "Isolated sentiment process returned invalid JSON."
        LOGGER.warning("%s Falling back to the built-in news lexicon.", reason)
        return analyze_news_with_lexicon(headlines, timestamp_ms, reason)
    if (
        not isinstance(response, dict)
        or response.get("status") not in ("AVAILABLE", "UNAVAILABLE")
        or response.get("sourceTimestampMs") != timestamp_ms
    ):
        reason = "Isolated sentiment process returned an incompatible response."
        LOGGER.warning("%s Falling back to the built-in news lexicon.", reason)
        return analyze_news_with_lexicon(headlines, timestamp_ms, reason)
    if response.get("status") != "AVAILABLE":
        reason = str(response.get("reason", "Financial-news sentiment model is unavailable."))
        LOGGER.warning("Sentiment model unavailable: %s Falling back to the built-in news lexicon.", reason)
        return analyze_news_with_lexicon(headlines, timestamp_ms, reason)
    return response


def analyze_request(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict) or not isinstance(request.get("requestId"), str):
        raise ValueError("requestId is required")
    pair = request.get("pair")
    if not isinstance(pair, str) or pair not in SUPPORTED_PAIRS:
        raise ValueError("pair must be a supported full Freqtrade pair")
    candles, timestamp_ms = validate_candles(request.get("candles"))
    raw_headlines = request.get("headlines")
    if not isinstance(raw_headlines, list) or len(raw_headlines) > 24:
        raise ValueError("headlines must be a list with at most 24 records")
    headlines = []
    for headline in raw_headlines:
        if (
            not isinstance(headline, dict)
            or not isinstance(headline.get("headline"), str)
            or not headline["headline"].strip()
            or not isinstance(headline.get("publisher"), str)
            or not isinstance(headline.get("publishedAt"), str)
            or headline.get("pair") != pair
        ):
            raise ValueError("headline records must be scoped to the request pair")
        headlines.append(headline)

    news_sentiment = module_result(
        "isolated financial-news sentiment",
        analyze_news_isolated,
        headlines,
        timestamp_ms,
    )
    modules = {
        "candlestickPatterns": module_result("TA-Lib candle patterns", analyze_candle_patterns, candles, timestamp_ms),
        "marketRegime": module_result("statsmodels regime", analyze_regime, candles, timestamp_ms),
        "marketAnomaly": module_result("scikit-learn anomaly", analyze_anomaly, candles, timestamp_ms),
        "lightgbmForecast": module_result("LightGBM forecast", train_and_forecast, "LightGBM", candles, timestamp_ms),
        "xgboostForecast": module_result("XGBoost forecast", train_and_forecast, "XGBoost", candles, timestamp_ms),
        "newsSentiment": news_sentiment,
    }
    states = [module["status"] for module in modules.values()]
    overall_status = "AVAILABLE" if all(state == "AVAILABLE" for state in states) else (
        "UNAVAILABLE" if all(state == "UNAVAILABLE" for state in states) else "PARTIAL"
    )
    return {
        "requestId": request["requestId"],
        "pair": pair,
        "contractVersion": CONTRACT_VERSION,
        "generatedAtMs": int(time.time() * 1000),
        "sourceTimestampMs": timestamp_ms,
        "status": overall_status,
        "decisionInfluence": "ADVISORY_ONLY",
        "modules": modules,
    }


def run_sentiment_mode() -> int:
    request = json.load(sys.stdin)
    if (
        not isinstance(request, dict)
        or not isinstance(request.get("headlines"), list)
        or isinstance(request.get("sourceTimestampMs"), bool)
        or not isinstance(request.get("sourceTimestampMs"), int)
    ):
        raise ValueError("sentiment mode requires headlines and an integer sourceTimestampMs")
    response = analyze_news(request["headlines"], request["sourceTimestampMs"])
    print(json.dumps(response, allow_nan=False, separators=(",", ":")), flush=True)
    return 0


def main() -> int:
    if sys.argv[1:] == ["--sentiment"]:
        return run_sentiment_mode()
    for line in sys.stdin:
        try:
            response = analyze_request(json.loads(line))
            print(json.dumps(response, allow_nan=False, separators=(",", ":")), flush=True)
        except (json.JSONDecodeError, ValueError) as error:
            LOGGER.error("Advisory request rejected: %s", error)
            print(json.dumps({
                "requestId": None,
                "status": "INVALID_REQUEST",
                "error": str(error),
            }, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
