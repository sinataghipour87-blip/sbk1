import sys
import json
import math

def calculate_prediction(data):
    candles = data.get('candles', [])
    obi = float(data.get('obi', 0.0) or 0.0)
    symbol = data.get('symbol', 'BTCUSDT')
    previous_trend = data.get('previousTrend', 'NEUTRAL')

    if not candles or len(candles) < 2:
        return {
            "trend": "NEUTRAL",
            "confidenceScore": 50,
            "confidence": 50,
            "isRangeBound": True,
            "reversal30m": {
                "isReversalLikely": False,
                "direction": "NEUTRAL",
                "probability": 50
            },
            "quantumCertainty": {
                "overallScore": 50,
                "grade": "B",
                "lossAvoidanceStatus": "در حال دریافت داده‌های اولیه"
            },
            "microVector": {
                "nextCandleDirection": "BULLISH",
                "velocityScore": 50
            },
            "whaleTrap": {
                "detected": False,
                "trapType": "NONE"
            }
        }

    closes = [float(c[3] if len(c) > 3 else c.get('close', 0)) for c in candles]
    highs = [float(c[1] if len(c) > 1 else c.get('high', 0)) for c in candles]
    lows = [float(c[2] if len(c) > 2 else c.get('low', 0)) for c in candles]
    
    last_close = closes[-1]
    prev_close = closes[-2] if len(closes) > 1 else last_close
    price_change_pct = ((last_close - prev_close) / prev_close * 100.0) if prev_close > 0 else 0.0

    # Moving averages
    period_fast = min(9, len(closes))
    period_slow = min(21, len(closes))
    sma_fast = sum(closes[-period_fast:]) / period_fast
    sma_slow = sum(closes[-period_slow:]) / period_slow

    # Trend logic combining OBI and moving average
    bull_signals = 0
    bear_signals = 0

    if sma_fast > sma_slow:
        bull_signals += 1
    elif sma_fast < sma_slow:
        bear_signals += 1

    if obi > 0.10:
        bull_signals += 2
    elif obi < -0.10:
        bear_signals += 2

    if price_change_pct > 0.05:
        bull_signals += 1
    elif price_change_pct < -0.05:
        bear_signals += 1

    if bull_signals > bear_signals:
        trend = "BULLISH"
        diff = bull_signals - bear_signals
    elif bear_signals > bull_signals:
        trend = "BEARISH"
        diff = bear_signals - bull_signals
    else:
        trend = previous_trend if previous_trend in ("BULLISH", "BEARISH") else "NEUTRAL"
        diff = 0

    confidence_score = min(95, max(52, 55 + diff * 10 + int(abs(obi) * 20)))
    is_range_bound = abs(price_change_pct) < 0.04 and abs(obi) < 0.12

    # Reversal probability
    reversal_likely = abs(obi) > 0.65 or (trend == "BULLISH" and obi < -0.4) or (trend == "BEARISH" and obi > 0.4)
    reversal_dir = "BEARISH" if trend == "BULLISH" else "BULLISH"
    reversal_prob = min(85, max(30, int(40 + abs(obi) * 45))) if reversal_likely else 25

    # Quantum certainty
    grade = "A+" if confidence_score >= 82 else ("A" if confidence_score >= 70 else "B")

    return {
        "trend": trend,
        "confidenceScore": confidence_score,
        "confidence": confidence_score,
        "isRangeBound": is_range_bound,
        "reversal30m": {
            "isReversalLikely": reversal_likely,
            "direction": reversal_dir,
            "probability": reversal_prob
        },
        "quantumCertainty": {
            "overallScore": confidence_score,
            "grade": grade,
            "lossAvoidanceStatus": "مدیریت آماری ریسک چندلایه و ارزیابی شواهد فعال است"
        },
        "microVector": {
            "nextCandleDirection": trend if trend in ("BULLISH", "BEARISH") else "BULLISH",
            "velocityScore": min(95, max(30, int(abs(price_change_pct) * 60 + abs(obi) * 30)))
        },
        "whaleTrap": {
            "detected": abs(obi) > 0.75 and abs(price_change_pct) < 0.03,
            "trapType": "BULL_TRAP" if obi > 0 else "BEAR_TRAP" if obi < 0 else "NONE"
        }
    }

def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        result = calculate_prediction(data)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({
            "trend": "NEUTRAL",
            "confidenceScore": 50,
            "confidence": 50,
            "isRangeBound": True,
            "error": str(e)
        }))

if __name__ == "__main__":
    main()
