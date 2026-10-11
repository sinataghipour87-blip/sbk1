import json
import math
import sys


def unavailable_result(reason):
    return {
        "status": "DATA_UNAVAILABLE",
        "tradeEligible": False,
        "modelType": "fixed_parameter_garch_approximation",
        "reason": reason,
        "regime": None,
        "conditionalVolatilityPctPerCandle": None,
        "historicalMeanVolatilityPctPerCandle": None,
        "volatilityRatio": None,
        "expansionProbability": None,
        "targetMultiplier": None,
        "series": [],
    }


def parse_candle(candle):
    if isinstance(candle, dict):
        values = [candle.get(key) for key in ("open", "high", "low", "close", "volume")]
    elif isinstance(candle, (list, tuple)) and len(candle) >= 5:
        values = candle[:5]
    else:
        return None

    try:
        opening, high, low, close, volume = (float(value) for value in values)
    except (TypeError, ValueError):
        return None

    if not all(math.isfinite(value) for value in (opening, high, low, close, volume)):
        return None
    if min(opening, high, low, close) <= 0 or volume < 0:
        return None
    if high < max(opening, close) or low > min(opening, close) or high < low:
        return None
    return opening, high, low, close, volume


def calculate_garch_regime(data):
    candles = data.get("candles")
    if not isinstance(candles, list) or len(candles) < 20:
        return unavailable_result("At least 20 valid market candles are required.")

    parsed_candles = [parse_candle(candle) for candle in candles]
    if any(candle is None for candle in parsed_candles):
        return unavailable_result("Market candles contain missing or invalid OHLCV values.")

    closes = [candle[3] for candle in parsed_candles]
    returns = [math.log(current / previous) for previous, current in zip(closes, closes[1:])]
    if not returns or not all(math.isfinite(value) for value in returns):
        return unavailable_result("Market candles do not produce finite returns.")

    omega = 0.000005
    alpha = 0.12
    beta = 0.85
    variance = sum(value * value for value in returns) / len(returns)
    variances = [variance]
    for value in returns:
        variance = omega + alpha * value * value + beta * variance
        if not math.isfinite(variance) or variance <= 0:
            return unavailable_result("Volatility recursion produced an invalid variance.")
        variances.append(variance)

    current_volatility_pct = math.sqrt(variances[-1]) * 100
    mean_volatility_pct = math.sqrt(sum(variances) / len(variances)) * 100
    if not all(math.isfinite(value) for value in (current_volatility_pct, mean_volatility_pct)) or mean_volatility_pct <= 0:
        return unavailable_result("Volatility estimate is unavailable.")

    volatility_ratio = current_volatility_pct / mean_volatility_pct
    if volatility_ratio > 1.4:
        regime = "HIGH_VOLATILITY"
    elif volatility_ratio < 0.7:
        regime = "LOW_VOLATILITY"
    else:
        regime = "BALANCED_VOLATILITY"

    series = [
        {
            "step": index + 1,
            "conditionalVolatilityPctPerCandle": round(math.sqrt(value) * 100, 4),
        }
        for index, value in enumerate(variances[-25:])
    ]

    return {
        "status": "ANALYSIS_ONLY",
        "tradeEligible": False,
        "modelType": "fixed_parameter_garch_approximation",
        "parameterStatus": "FIXED_NOT_FITTED_OR_VALIDATED",
        "volatilityUnit": "PERCENT_PER_CANDLE",
        "omega": omega,
        "alpha": alpha,
        "beta": beta,
        "regime": regime,
        "conditionalVolatilityPctPerCandle": round(current_volatility_pct, 4),
        "historicalMeanVolatilityPctPerCandle": round(mean_volatility_pct, 4),
        "volatilityRatio": round(volatility_ratio, 4),
        "expansionProbability": None,
        "targetMultiplier": None,
        "forecastHorizonCandles": 1,
        "series": series,
    }


def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        if not isinstance(data, dict):
            raise ValueError("Input must be a JSON object.")
        result = calculate_garch_regime(data)
        print(json.dumps(result, allow_nan=False))
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        print(json.dumps(unavailable_result(str(error)), allow_nan=False))


if __name__ == "__main__":
    main()
