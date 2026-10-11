import json
import math
import sys


def unavailable_result(reason):
    return {
        "status": "DATA_UNAVAILABLE",
        "tradeEligible": False,
        "reason": reason,
        "trend": None,
        "heuristicConvictionScore": None,
        "calibratedWinProbability": None,
        "isRangeBound": None,
        "reversal30m": {
            "isReversalLikely": None,
            "direction": None,
            "probability": None,
        },
        "microVector": {
            "nextCandleDirection": None,
            "velocityScore": None,
        },
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


def calculate_prediction(data):
    candles = data.get("candles")
    if not isinstance(candles, list) or len(candles) < 20:
        return unavailable_result("At least 20 valid market candles are required.")

    parsed_candles = [parse_candle(candle) for candle in candles]
    if any(candle is None for candle in parsed_candles):
        return unavailable_result("Market candles contain missing or invalid OHLCV values.")

    closes = [candle[3] for candle in parsed_candles]
    obi = data.get("obi")
    has_obi = isinstance(obi, (int, float)) and math.isfinite(obi) and -1 <= obi <= 1

    period_fast = min(9, len(closes))
    period_slow = min(21, len(closes))
    sma_fast = sum(closes[-period_fast:]) / period_fast
    sma_slow = sum(closes[-period_slow:]) / period_slow
    price_change_pct = ((closes[-1] - closes[-2]) / closes[-2]) * 100

    bull_signals = int(sma_fast > sma_slow) + int(price_change_pct > 0.05)
    bear_signals = int(sma_fast < sma_slow) + int(price_change_pct < -0.05)
    if has_obi:
        bull_signals += 2 * int(obi > 0.10)
        bear_signals += 2 * int(obi < -0.10)

    if bull_signals > bear_signals:
        trend = "BULLISH"
    elif bear_signals > bull_signals:
        trend = "BEARISH"
    else:
        trend = "NEUTRAL"

    evidence_count = 3 if has_obi else 2
    conviction = round(abs(bull_signals - bear_signals) / evidence_count * 100)
    is_range_bound = abs(price_change_pct) < 0.04 and (not has_obi or abs(obi) < 0.12)
    reversal_likely = (
        has_obi
        and (abs(obi) > 0.65 or (trend == "BULLISH" and obi < -0.4) or (trend == "BEARISH" and obi > 0.4))
    )
    reversal_direction = "BEARISH" if trend == "BULLISH" else "BULLISH" if trend == "BEARISH" else None
    velocity_score = round(abs(price_change_pct) * 60 + (abs(obi) * 30 if has_obi else 0))

    return {
        "status": "ANALYSIS_ONLY",
        "tradeEligible": False,
        "modelType": "heuristic_moving_average_price_change_order_imbalance",
        "scoreType": "HEURISTIC_CONVICTION_NOT_PROBABILITY",
        "trend": trend,
        "heuristicConvictionScore": min(100, conviction),
        "calibratedWinProbability": None,
        "isRangeBound": is_range_bound,
        "reversal30m": {
            "isReversalLikely": reversal_likely,
            "direction": reversal_direction if reversal_likely else None,
            "probability": None,
        },
        "microVector": {
            "nextCandleDirection": None,
            "velocityScore": min(100, velocity_score),
        },
        "inputs": {
            "orderBookImbalance": obi if has_obi else None,
            "orderBookImbalanceStatus": "PRESENT" if has_obi else "UNAVAILABLE",
        },
    }


def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        if not isinstance(data, dict):
            raise ValueError("Input must be a JSON object.")
        result = calculate_prediction(data)
        print(json.dumps(result, allow_nan=False))
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        print(json.dumps(unavailable_result(str(error)), allow_nan=False))


if __name__ == "__main__":
    main()
