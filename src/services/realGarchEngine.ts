import { Candle } from '../types/trading';

/**
 * 📈 REAL GARCH(1,1) PARAMETRIC VOLATILITY ENGINE
 * 
 * Mathematical Formulation:
 * Log Returns: r_t = ln(P_t / P_{t-1})
 * Mean-adjusted innovation: ε_t = r_t - μ
 * Conditional Variance: σ_t^2 = ω + α * ε_{t-1}^2 + β * σ_{t-1}^2
 * Stationarity requirement: α >= 0, β >= 0, α + β < 1.0
 * Long-run (Unconditional) Variance: σ_L^2 = ω / (1 - α - β)
 * 
 * Out-of-Sample (OOS) Validation:
 * Train on in-sample returns, forecast volatility on OOS returns,
 * calculate Mean Absolute Percentage Error (MAPE) and Root Mean Squared Error (RMSE).
 */

export interface RealGarchResult {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  sampleSize: number;
  oosSampleSize: number;
  omega: number | null;
  alpha: number | null;
  beta: number | null;
  persistence: number | null; // α + β
  longRunVolAnnualizedPct: number | null;
  currentConditionalVolPct: number | null;
  forecastVol15mPct: number | null;
  forecastVol1hPct: number | null;
  oosForecastMape: number | null; // Out-of-Sample Mean Absolute Percentage Error
  oosRmse: number | null;
  regime: 'COMPRESSION' | 'NORMAL' | 'EXPANSION' | 'SPIKE_TURBULENCE' | 'UNKNOWN';
  regimeProbability: number | null;
  isStationary: boolean;
  modelTimestamp: number;
  detailsFa: string;
}

export class RealGarchEngine {
  private static instance: RealGarchEngine;

  public static getInstance(): RealGarchEngine {
    if (!RealGarchEngine.instance) {
      RealGarchEngine.instance = new RealGarchEngine();
    }
    return RealGarchEngine.instance;
  }

  /**
   * Fit GARCH(1,1) model on series of candles.
   * Splits into In-Sample (80%) and Out-of-Sample (20%).
   */
  public fitAndForecast(candles: Candle[] | any[]): RealGarchResult {
    if (!candles || candles.length < 25) {
      return {
        status: 'UNAVAILABLE',
        sampleSize: candles ? candles.length : 0,
        oosSampleSize: 0,
        omega: null,
        alpha: null,
        beta: null,
        persistence: null,
        longRunVolAnnualizedPct: null,
        currentConditionalVolPct: null,
        forecastVol15mPct: null,
        forecastVol1hPct: null,
        oosForecastMape: null,
        oosRmse: null,
        regime: 'UNKNOWN',
        regimeProbability: null,
        isStationary: false,
        modelTimestamp: Date.now(),
        detailsFa: 'داده‌های سری زمانی کندل‌ها ناکافی است (حداقل ۲۵ کندل جهت برازش GARCH الزامی است).'
      };
    }

    // Extract closes
    const closes: number[] = candles.map((c: any) => {
      if (Array.isArray(c)) return c[3] ?? c[4] ?? 0;
      return c.close ?? c.c ?? 0;
    }).filter(p => typeof p === 'number' && p > 0);

    if (closes.length < 25) {
      return {
        status: 'UNAVAILABLE',
        sampleSize: closes.length,
        oosSampleSize: 0,
        omega: null,
        alpha: null,
        beta: null,
        persistence: null,
        longRunVolAnnualizedPct: null,
        currentConditionalVolPct: null,
        forecastVol15mPct: null,
        forecastVol1hPct: null,
        oosForecastMape: null,
        oosRmse: null,
        regime: 'UNKNOWN',
        regimeProbability: null,
        isStationary: false,
        modelTimestamp: Date.now(),
        detailsFa: 'تعداد قیمت‌های معتبر برای سری زمانی GARCH ناکافی است.'
      };
    }

    // 1. Calculate Log Returns: r_t = ln(P_t / P_{t-1})
    const logReturns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const r = Math.log(closes[i] / closes[i - 1]);
      if (isFinite(r)) {
        logReturns.push(r);
      }
    }

    const totalN = logReturns.length;
    if (totalN < 20) {
      return {
        status: 'UNAVAILABLE',
        sampleSize: totalN,
        oosSampleSize: 0,
        omega: null,
        alpha: null,
        beta: null,
        persistence: null,
        longRunVolAnnualizedPct: null,
        currentConditionalVolPct: null,
        forecastVol15mPct: null,
        forecastVol1hPct: null,
        oosForecastMape: null,
        oosRmse: null,
        regime: 'UNKNOWN',
        regimeProbability: null,
        isStationary: false,
        modelTimestamp: Date.now(),
        detailsFa: 'تعداد بازده‌های معتبر برای برازش GARCH کمتر از حد مجاز است.'
      };
    }

    // 2. Train / OOS Split (80% In-sample train, 20% Out-of-sample test)
    const trainSize = Math.max(16, Math.floor(totalN * 0.8));
    const trainReturns = logReturns.slice(0, trainSize);
    const oosReturns = logReturns.slice(trainSize);
    const oosSize = oosReturns.length;

    // 3. Compute In-Sample sample mean and sample variance
    const meanReturn = trainReturns.reduce((a, b) => a + b, 0) / trainReturns.length;
    const sampleVar = trainReturns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0) / (trainReturns.length - 1);
    
    // Variance targeting GARCH(1,1) parameter estimation:
    // Typical empirical crypto high-frequency persistence: α ~ 0.12 - 0.18, β ~ 0.75 - 0.82
    let bestAlpha = 0.14;
    let bestBeta = 0.81;
    let minNegLogLikelihood = Infinity;

    // Grid search optimizer for Maximum Likelihood Estimation (MLE)
    const alphaCandidates = [0.05, 0.08, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20];
    const betaCandidates = [0.70, 0.75, 0.78, 0.80, 0.82, 0.85];

    for (const a of alphaCandidates) {
      for (const b of betaCandidates) {
        if (a + b >= 0.999) continue; // Stationarity constraint

        const omega = sampleVar * (1 - a - b);
        let currentSigma2 = sampleVar;
        let negLogLik = 0;

        for (let t = 0; t < trainReturns.length; t++) {
          const resid = trainReturns[t] - meanReturn;
          currentSigma2 = omega + a * Math.pow(resid, 2) + b * currentSigma2;
          if (currentSigma2 <= 0) {
            negLogLik = Infinity;
            break;
          }
          // Gaussian log-likelihood component: ln(σ^2) + ε^2 / σ^2
          negLogLik += 0.5 * (Math.log(currentSigma2) + Math.pow(resid, 2) / currentSigma2);
        }

        if (negLogLik < minNegLogLikelihood) {
          minNegLogLikelihood = negLogLik;
          bestAlpha = a;
          bestBeta = b;
        }
      }
    }

    const alpha = bestAlpha;
    const beta = bestBeta;
    const persistence = Number((alpha + beta).toFixed(4));
    const omega = sampleVar * (1 - persistence);
    const longRunVar = omega / Math.max(0.001, 1 - persistence);
    const longRunVolAnnualizedPct = Number((Math.sqrt(longRunVar * 365 * 24 * 4) * 100).toFixed(2));

    // 4. Filter full series up to current bar to obtain current conditional variance
    let currentSigma2 = sampleVar;
    for (let t = 0; t < totalN; t++) {
      const resid = logReturns[t] - meanReturn;
      currentSigma2 = omega + alpha * Math.pow(resid, 2) + beta * currentSigma2;
    }

    const currentConditionalVolPct = Number((Math.sqrt(currentSigma2) * 100).toFixed(2));

    // 5. Multi-step forecasts: σ_{t+k}^2 = σ_L^2 + (α + β)^k * (σ_t^2 - σ_L^2)
    const forecastVar15m = longRunVar + persistence * (currentSigma2 - longRunVar);
    const forecastVar1h = longRunVar + Math.pow(persistence, 4) * (currentSigma2 - longRunVar);
    const forecastVol15mPct = Number((Math.sqrt(Math.max(0.000001, forecastVar15m)) * 100).toFixed(2));
    const forecastVol1hPct = Number((Math.sqrt(Math.max(0.000001, forecastVar1h)) * 100).toFixed(2));

    // 6. True Out-of-Sample Evaluation
    let sumAbsPctErr = 0;
    let sumSqErr = 0;
    let validOosCount = 0;

    let rollingSigma2 = sampleVar;
    // Step through train to seed OOS
    for (let t = 0; t < trainSize; t++) {
      const resid = trainReturns[t] - meanReturn;
      rollingSigma2 = omega + alpha * Math.pow(resid, 2) + beta * rollingSigma2;
    }

    // Step through OOS and evaluate 1-step ahead realized vs forecast volatility
    for (let t = 0; t < oosSize; t++) {
      const actualAbsReturn = Math.abs(oosReturns[t]);
      const predictedVol = Math.sqrt(rollingSigma2);
      
      const err = actualAbsReturn - (predictedVol * 0.7979); // E[|r|] = σ * sqrt(2/π) ~ σ * 0.7979
      sumSqErr += Math.pow(err, 2);
      if (actualAbsReturn > 0.00001) {
        sumAbsPctErr += Math.abs(err) / actualAbsReturn;
        validOosCount++;
      }

      // Update rolling variance for next step
      const resid = oosReturns[t] - meanReturn;
      rollingSigma2 = omega + alpha * Math.pow(resid, 2) + beta * rollingSigma2;
    }

    const oosRmse = oosSize > 0 ? Number((Math.sqrt(sumSqErr / oosSize) * 100).toFixed(3)) : null;
    const oosForecastMape = validOosCount > 0 ? Number(((sumAbsPctErr / validOosCount) * 100).toFixed(1)) : null;

    // 7. Dynamic Regime Classification based on conditional volatility vs long-run variance
    const volRatio = currentConditionalVolPct / Math.max(0.01, Math.sqrt(longRunVar) * 100);
    let regime: RealGarchResult['regime'] = 'NORMAL';
    let regimeProbability = 0.50;

    if (volRatio < 0.75) {
      regime = 'COMPRESSION';
      regimeProbability = Number((Math.min(0.92, 0.60 + (0.75 - volRatio) * 0.8)).toFixed(3));
    } else if (volRatio > 2.2) {
      regime = 'SPIKE_TURBULENCE';
      regimeProbability = Number((Math.min(0.95, 0.70 + (volRatio - 2.2) * 0.2)).toFixed(3));
    } else if (volRatio > 1.3) {
      regime = 'EXPANSION';
      regimeProbability = Number((Math.min(0.88, 0.55 + (volRatio - 1.3) * 0.3)).toFixed(3));
    } else {
      regime = 'NORMAL';
      regimeProbability = 0.65;
    }

    const detailsFa = `مدل GARCH(1,1) کالیبره‌شده: ω=${omega.toExponential(2)}, α=${alpha.toFixed(2)}, β=${beta.toFixed(2)} (ماندگاری: ${persistence}). نوسان شرطی ${currentConditionalVolPct}٪ در رژیم [${regime}] با خطای OOS برابر ${oosRmse ?? 'N/A'}٪.`;

    return {
      status: 'AVAILABLE',
      sampleSize: totalN,
      oosSampleSize: oosSize,
      omega: Number(omega.toFixed(8)),
      alpha,
      beta,
      persistence,
      longRunVolAnnualizedPct,
      currentConditionalVolPct,
      forecastVol15mPct,
      forecastVol1hPct,
      oosForecastMape,
      oosRmse,
      regime,
      regimeProbability,
      isStationary: persistence < 1.0,
      modelTimestamp: Date.now(),
      detailsFa
    };
  }
}

export const realGarchEngine = RealGarchEngine.getInstance();
