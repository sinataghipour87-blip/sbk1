import sys
import json
import math

def calculate_garch_regime(data):
    candles = data.get('candles', [])
    if len(candles) < 20:
        return {
            "regime": "NORMAL",
            "volatilityForecast": 1.5,
            "expansionProbability": 50.0,
            "targetMultiplier": 1.0,
            "description": "داده‌های کندلی در حال پردازش اولیه هستند."
        }

    closes = [float(c[3]) for c in candles]
    highs = [float(c[1]) for c in candles]
    lows = [float(c[2]) for c in candles]
    
    # Calculate Log Returns
    returns = []
    for i in range(1, len(closes)):
        if closes[i-1] > 0:
            returns.append(math.log(closes[i] / closes[i-1]))
    
    # Estimate GARCH(1,1) Parameters (omega, alpha, beta)
    # sigma_t^2 = omega + alpha * epsilon_{t-1}^2 + beta * sigma_{t-1}^2
    omega = 0.000005
    alpha = 0.12
    beta = 0.85
    
    variance = sum([r**2 for r in returns]) / max(1, len(returns))
    variances = [variance]
    
    for r in returns:
        var_t = omega + (alpha * (r**2)) + (beta * variances[-1])
        variances.append(var_t)
        
    latest_vol_pct = math.sqrt(variances[-1]) * 100.0 * math.sqrt(24) # Annualized/Intraday scaling
    avg_vol_pct = math.sqrt(sum(variances) / len(variances)) * 100.0 * math.sqrt(24)
    
    vol_ratio = latest_vol_pct / max(0.01, avg_vol_pct)
    
    if vol_ratio > 1.4:
        regime = "HIGH_VOLATILITY_EXPANSION"
        expansion_prob = 85.0
        target_multiplier = 1.35
        desc = "رژیم انبساط شدید نوسان (Volatility Breakout): پتانسیل پرتاب سریع قیمت به سمت تارگت‌های ۲ و ۳."
    elif vol_ratio < 0.7:
        regime = "VOLATILITY_SQUEEZE"
        expansion_prob = 78.0
        target_multiplier = 0.90
        desc = "رژیم فشردگی باندها (Squeeze Accumulation): آمادگی انفجار قریب‌الوقوع در جهت روند اصلی."
    else:
        regime = "BALANCED_REGIME"
        expansion_prob = 50.0
        target_multiplier = 1.10
        desc = "رژیم تعادل حرکتی نوسان: حرکت نرم قیمت مطابق با کانال فیبوناچی استاندارد."

    # Calculate localized historical series for line-chart comparison (last 25 points)
    history_points = []
    num_pts = min(25, len(variances))
    
    # Calculate localized True Range for each candle
    atr_values = []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        atr_pct = (tr / max(1.0, closes[i-1])) * 100.0
        atr_values.append(atr_pct)

    recent_vars = variances[-num_pts:]
    recent_atr = atr_values[-num_pts:] if len(atr_values) >= num_pts else ([1.2] * num_pts)
    
    for i in range(len(recent_vars)):
        garch_vol = math.sqrt(recent_vars[i]) * 100.0 * math.sqrt(24)
        atr_val = recent_atr[i] if i < len(recent_atr) else recent_atr[-1]
        history_points.append({
            "step": i + 1,
            "garch": round(garch_vol, 2),
            "atr": round(atr_val, 2)
        })

    return {
        "regime": regime,
        "currentVol": round(latest_vol_pct, 2),
        "meanVol": round(avg_vol_pct, 2),
        "volRatio": round(vol_ratio, 2),
        "expansionProbability": expansion_prob,
        "targetMultiplier": target_multiplier,
        "description": desc,
        "series": history_points
    }

def main():
    try:
        input_data = json.load(sys.stdin)
        result = calculate_garch_regime(input_data)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
