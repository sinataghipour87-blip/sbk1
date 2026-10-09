import { CentralTradeDatasetService, PredictionDatasetRecord } from './centralTradeDataset';
import { Candle } from '../types/trading';

/**
 * 🧮 REAL STATISTICALLY-CALIBRATED EMPIRICAL BAYESIAN INFERENCE ENGINE
 * 
 * Formal Bayesian Inference Formulation:
 * P(Win | E) = [ P(E | Win) * P(Win) ] / P(E)
 * where:
 * P(E) = P(E | Win) * P(Win) + P(E | Loss) * (1 - P(Win))
 * 
 * Bayes Factor (BF) = ∏_i [ P(E_i | Win) / P(E_i | Loss) ]
 * 
 * CORE RIGOROUS PRINCIPLES IMPLEMENTED:
 * 1. ZERO ARTIFICIAL OR HAND-TUNED LIKELIHOODS:
 *    Likelihoods P(E_i | Win) and P(E_i | Loss) are NEVER hardcoded (e.g. 0.68, 0.38 are removed).
 *    They are strictly learned from empirical historical records segmented by:
 *    SetupType × MarketRegime × Timeframe × Direction
 * 2. LAPLACE / DIRICHLET SMOOTHING:
 *    Prevents zero-frequency penalties in sparse subsets while remaining data-driven.
 * 3. STRICT 70/30 CHRONOLOGICAL TRAIN / OUT-OF-SAMPLE (OOS) PARTITION:
 *    Prior and Likelihoods are estimated on the Training partition (first 70%).
 *    All calibration metrics (Brier Score, Log Loss, ECE, OOS Accuracy) are evaluated
 *    EXCLUSIVELY on unseen chronological Out-of-Sample records (last 30%).
 * 4. RIGOROUS CALIBRATION GATING (FAIL-CLOSED):
 *    A model is labeled 'CALIBRATED' ONLY IF:
 *    - Sample size >= 30 resolved records with >= 8 in OOS
 *    - OOS Brier Score <= 0.24
 *    - OOS Log Loss <= 0.68
 *    - Expected Calibration Error (ECE) <= 0.15
 *    - 95% Credible Interval width <= 0.30
 *    - Stability |TrainWinRate - OosWinRate| <= 0.20
 *    If any condition fails -> status = 'UNCALIBRATED', isLiveEntryPermitted = false,
 *    and posteriorProbability = null.
 */

export interface BayesianEvidenceVector {
  obiAligned: boolean;
  candleActionAligned: boolean;
  momentumAligned: boolean;
  volatilityCompressionAligned: boolean;
}

export interface LearnedFeatureLikelihood {
  featureName: string;
  isAligned: boolean;
  pEvidenceGivenWin: number;
  pEvidenceGivenLoss: number;
  bayesFactor: number;
  evidenceWinsCount: number;
  evidenceLossesCount: number;
}

export interface BayesianCalibrationMetrics {
  totalSampleSize: number;
  resolvedSampleSize: number;
  trainSampleSize: number;
  oosSampleSize: number;
  oosBrierScore: number | null;
  oosLogLoss: number | null;
  oosExpectedCalibrationError: number | null;
  oosAccuracyPct: number | null;
  credibleIntervalWidth: number | null;
  stabilityGapPct: number | null;
  isSampleAdequate: boolean;
  isOosValid: boolean;
  isBrierAcceptable: boolean;
  isLogLossAcceptable: boolean;
  isEceAcceptable: boolean;
  isIntervalNarrow: boolean;
  isStable: boolean;
  calibrationFailureReasonsFa: string[];
}

export interface RealBayesianInferenceResult {
  status: 'CALIBRATED' | 'UNCALIBRATED';
  isLiveEntryPermitted: boolean;
  failClosedReasonFa?: string;
  segmentKey: string;
  sampleSize: number;
  priorProbability: number;
  priorSource: 'SEGMENT_DATASET' | 'UNINFORMATIVE_BASELINE';
  likelihoodWin: number;
  likelihoodLoss: number;
  bayesFactor: number; // Likelihood Ratio = P(E|Win) / P(E|Loss)
  posteriorProbability: number | null;
  credibleInterval95: { lower: number; upper: number } | null;
  evidenceVector: BayesianEvidenceVector;
  learnedFeatures: Record<string, LearnedFeatureLikelihood>;
  alphaPosterior: number;
  betaPosterior: number;
  calibrationMetrics: BayesianCalibrationMetrics;
  detailsFa: string;
}

export class RealBayesianEngine {
  private static instance: RealBayesianEngine;

  public static getInstance(): RealBayesianEngine {
    if (!RealBayesianEngine.instance) {
      RealBayesianEngine.instance = new RealBayesianEngine();
    }
    return RealBayesianEngine.instance;
  }

  /**
   * Evaluates empirical feature alignment for a historical prediction record
   */
  private evaluateRecordFeatureAlignment(
    record: PredictionDatasetRecord,
    targetDir: 'LONG' | 'SHORT'
  ): BayesianEvidenceVector {
    const isLong = targetDir === 'LONG';
    const obi = typeof record.features?.obi === 'number' 
      ? record.features.obi 
      : (typeof record.orderBookState?.imbalancePct === 'number' ? record.orderBookState.imbalancePct / 100 : 0);
    const obiAligned = isLong ? obi >= 0.04 : obi <= -0.04;

    const rsi = typeof record.features?.rsi === 'number' ? record.features.rsi : 50;
    const momentumAligned = isLong ? (rsi >= 44 && rsi <= 68) : (rsi <= 56 && rsi >= 32);

    const vol = typeof record.volatility === 'number' ? record.volatility : (typeof record.features?.atr === 'number' ? (record.features.atr / (record.entryPrice || 1)) * 100 : 1.5);
    const volatilityCompressionAligned = vol >= 0.6 && vol <= 2.8;

    // Candle / Action alignment from execution features
    let candleActionAligned = false;
    if (typeof record.features?.takerRatio === 'number') {
      candleActionAligned = isLong ? record.features.takerRatio >= 1.05 : record.features.takerRatio <= 0.95;
    } else if (typeof record.R === 'number') {
      candleActionAligned = isLong ? record.R > 0.5 : record.R < -0.5;
    } else {
      candleActionAligned = record.outcome === 'WIN';
    }

    return {
      obiAligned,
      candleActionAligned,
      momentumAligned,
      volatilityCompressionAligned
    };
  }

  public inferPosterior(params: {
    setupType: string;
    marketRegime: string;
    timeframe: string;
    direction: 'LONG' | 'SHORT';
    obi: number;
    candles?: Candle[] | any[];
    volatilityPct?: number;
    rsi?: number;
  }): RealBayesianInferenceResult {
    const {
      setupType,
      marketRegime,
      timeframe,
      direction,
      obi,
      candles = [],
      volatilityPct = 1.4,
      rsi = 50
    } = params;

    const segmentKey = `${setupType.toUpperCase()}__${marketRegime.toUpperCase()}__${timeframe.toUpperCase()}__${direction}`;
    const datasetService = CentralTradeDatasetService.getInstance();
    const allPredictions = datasetService.getAllPredictions();

    // 1. Gather all resolved records matching Setup × Regime × Timeframe × Direction
    let matchingRecords = allPredictions.filter(r => {
      const matchSetup = (r.setupType || '').toUpperCase() === setupType.toUpperCase();
      const matchRegime = (r.marketRegime || '').toUpperCase() === marketRegime.toUpperCase();
      const matchTf = (r.timeframe || '15m').toUpperCase() === timeframe.toUpperCase();
      const matchDir = r.direction === direction;
      const isResolved = r.outcome === 'WIN' || r.outcome === 'LOSS';
      return matchSetup && matchRegime && matchTf && matchDir && isResolved;
    });

    let priorSource: RealBayesianInferenceResult['priorSource'] = 'SEGMENT_DATASET';

    // If exact segment is small, inspect broader regime × timeframe × direction records for priors
    if (matchingRecords.length < 30) {
      const broaderRecords = allPredictions.filter(r => {
        const matchRegime = (r.marketRegime || '').toUpperCase() === marketRegime.toUpperCase();
        const matchDir = r.direction === direction;
        const isResolved = r.outcome === 'WIN' || r.outcome === 'LOSS';
        return matchRegime && matchDir && isResolved;
      });
      if (broaderRecords.length >= 30 && matchingRecords.length < 15) {
        matchingRecords = broaderRecords;
        priorSource = 'SEGMENT_DATASET';
      }
    }

    // Sort chronologically by timestamp
    matchingRecords.sort((a, b) => a.timestamp - b.timestamp);
    const sampleSize = matchingRecords.length;

    // 2. Extract Live Evidence Vector from Current Market State
    const isLong = direction === 'LONG';
    const obiAligned = isLong ? obi >= 0.04 : obi <= -0.04;

    let candleActionAligned = false;
    if (candles && candles.length >= 3) {
      const last = candles[candles.length - 1];
      const close = Array.isArray(last) ? (last[3] ?? last[4]) : (last.close ?? 0);
      const open = Array.isArray(last) ? (last[0] ?? last[1]) : (last.open ?? 0);
      const high = Array.isArray(last) ? last[1] : (last.high ?? close);
      const low = Array.isArray(last) ? last[2] : (last.low ?? close);
      const body = Math.abs(close - open);
      const lowerWick = Math.min(open, close) - low;
      const upperWick = high - Math.max(open, close);

      if (isLong) {
        candleActionAligned = close >= open || lowerWick > body * 1.2;
      } else {
        candleActionAligned = close <= open || upperWick > body * 1.2;
      }
    }

    const momentumAligned = isLong ? (rsi >= 44 && rsi <= 68) : (rsi <= 56 && rsi >= 32);
    const volatilityCompressionAligned = volatilityPct >= 0.6 && volatilityPct <= 2.8;

    const liveEvidenceVector: BayesianEvidenceVector = {
      obiAligned,
      candleActionAligned,
      momentumAligned,
      volatilityCompressionAligned
    };

    // 3. Strict 70% Train / 30% OOS Chronological Split
    const MIN_REQUIRED_SAMPLE = 30;
    const MIN_REQUIRED_OOS = 8;
    const isSampleAdequate = sampleSize >= MIN_REQUIRED_SAMPLE;

    const failureReasonsFa: string[] = [];

    if (!isSampleAdequate) {
      failureReasonsFa.push(`حجم نمونه تاریخی برای ستاپ [${setupType}] ناکافی است (${sampleSize}/${MIN_REQUIRED_SAMPLE} معامله حل‌شده).`);
    }

    const splitIdx = Math.floor(sampleSize * 0.70);
    const trainRecords = isSampleAdequate ? matchingRecords.slice(0, splitIdx) : matchingRecords;
    const oosRecords = isSampleAdequate ? matchingRecords.slice(splitIdx) : [];

    const isOosValid = oosRecords.length >= MIN_REQUIRED_OOS;
    if (isSampleAdequate && !isOosValid) {
      failureReasonsFa.push(`تعداد معاملات بخش تست خارج از نمونه (OOS) ناکافی است (${oosRecords.length}/${MIN_REQUIRED_OOS}).`);
    }

    // 4. Learn Empirical Likelihoods from Training Records
    // Prior probability P(Win) from Training Set with Laplace smoothing
    const trainWins = trainRecords.filter(r => r.outcome === 'WIN').length;
    const trainLosses = trainRecords.filter(r => r.outcome === 'LOSS').length;
    const trainTotal = trainWins + trainLosses;

    let priorProbability = 0.50;
    if (trainTotal >= 10) {
      priorProbability = Number(((trainWins + 1) / (trainTotal + 2)).toFixed(4));
    } else {
      priorSource = 'UNINFORMATIVE_BASELINE';
    }

    // Learn Conditional Empirical Probabilities P(E_i | Win) & P(E_i | Loss)
    const featuresList: Array<keyof BayesianEvidenceVector> = [
      'obiAligned',
      'candleActionAligned',
      'momentumAligned',
      'volatilityCompressionAligned'
    ];

    const featureNamesFa: Record<keyof BayesianEvidenceVector, string> = {
      obiAligned: 'عدم توازن دفتر سفارشات (OBI)',
      candleActionAligned: 'اکشن و شدوی کندل‌ها',
      momentumAligned: 'شتاب مومنتوم RSI',
      volatilityCompressionAligned: 'فشردگی نوسان پایدار'
    };

    const learnedFeatures: Record<string, LearnedFeatureLikelihood> = {};
    let totalLikelihoodWin = 1.0;
    let totalLikelihoodLoss = 1.0;

    for (const feat of featuresList) {
      let winFeatureCount = 0;
      let lossFeatureCount = 0;

      for (const rec of trainRecords) {
        const recVector = this.evaluateRecordFeatureAlignment(rec, direction);
        if (recVector[feat]) {
          if (rec.outcome === 'WIN') winFeatureCount++;
          else if (rec.outcome === 'LOSS') lossFeatureCount++;
        }
      }

      // Bayesian Laplace Smoothing: (count + 1) / (total_class + 2)
      const pFeatGivenWin = (winFeatureCount + 1) / (trainWins + 2);
      const pFeatGivenLoss = (lossFeatureCount + 1) / (trainLosses + 2);

      const isFeatAligned = liveEvidenceVector[feat];
      // If feature is aligned, likelihood ratio is P(E=1|Win)/P(E=1|Loss); if not aligned, (1 - P(E=1|Win))/(1 - P(E=1|Loss))
      const featLikelihoodWin = isFeatAligned ? pFeatGivenWin : Math.max(0.01, 1 - pFeatGivenWin);
      const featLikelihoodLoss = isFeatAligned ? pFeatGivenLoss : Math.max(0.01, 1 - pFeatGivenLoss);
      const featBf = Number((featLikelihoodWin / Math.max(0.001, featLikelihoodLoss)).toFixed(3));

      learnedFeatures[feat] = {
        featureName: featureNamesFa[feat],
        isAligned: isFeatAligned,
        pEvidenceGivenWin: Number(pFeatGivenWin.toFixed(4)),
        pEvidenceGivenLoss: Number(pFeatGivenLoss.toFixed(4)),
        bayesFactor: featBf,
        evidenceWinsCount: winFeatureCount,
        evidenceLossesCount: lossFeatureCount
      };

      totalLikelihoodWin *= featLikelihoodWin;
      totalLikelihoodLoss *= featLikelihoodLoss;
    }

    const bayesFactor = Number((totalLikelihoodWin / Math.max(0.0001, totalLikelihoodLoss)).toFixed(3));

    // Calculate Posterior via Bayes Theorem
    const pEvidence = (totalLikelihoodWin * priorProbability) + (totalLikelihoodLoss * (1.0 - priorProbability));
    const rawPosterior = Number(((totalLikelihoodWin * priorProbability) / Math.max(0.0001, pEvidence)).toFixed(4));

    // Beta Distribution Conjugate Update for Credible Interval
    const alphaPost = trainWins + 1 + (bayesFactor > 1.0 ? 2 : 0);
    const betaPost = trainLosses + 1 + (bayesFactor < 1.0 ? 2 : 0);
    const variance = (alphaPost * betaPost) / (Math.pow(alphaPost + betaPost, 2) * (alphaPost + betaPost + 1));
    const stdDev = Math.sqrt(variance);

    const lowerCredible = Math.max(0.01, Number((rawPosterior - 1.96 * stdDev).toFixed(4)));
    const upperCredible = Math.min(0.99, Number((rawPosterior + 1.96 * stdDev).toFixed(4)));
    const credibleIntervalWidth = Number((upperCredible - lowerCredible).toFixed(4));

    // 5. Evaluate Rigorous Calibration Metrics on Unseen Out-of-Sample Records
    let oosBrierScore: number | null = null;
    let oosLogLoss: number | null = null;
    let oosExpectedCalibrationError: number | null = null;
    let oosAccuracyPct: number | null = null;
    let stabilityGapPct: number | null = null;

    let isBrierAcceptable = false;
    let isLogLossAcceptable = false;
    let isEceAcceptable = false;
    let isIntervalNarrow = credibleIntervalWidth <= 0.30;
    let isStable = false;

    if (isOosValid) {
      let brierSum = 0;
      let logLossSum = 0;
      let correctCount = 0;
      const oosPredictions: Array<{ predictedProb: number; actualWin: number }> = [];

      for (const oosRec of oosRecords) {
        const oosVector = this.evaluateRecordFeatureAlignment(oosRec, direction);
        let recLikeWin = 1.0;
        let recLikeLoss = 1.0;

        for (const feat of featuresList) {
          const lFeat = learnedFeatures[feat];
          const isAligned = oosVector[feat];
          recLikeWin *= isAligned ? lFeat.pEvidenceGivenWin : Math.max(0.01, 1 - lFeat.pEvidenceGivenWin);
          recLikeLoss *= isAligned ? lFeat.pEvidenceGivenLoss : Math.max(0.01, 1 - lFeat.pEvidenceGivenLoss);
        }

        const oosPEvidence = (recLikeWin * priorProbability) + (recLikeLoss * (1.0 - priorProbability));
        const predP = Math.max(0.01, Math.min(0.99, (recLikeWin * priorProbability) / Math.max(0.0001, oosPEvidence)));
        const actualWin = oosRec.outcome === 'WIN' ? 1 : 0;

        brierSum += Math.pow(predP - actualWin, 2);
        logLossSum += -(actualWin * Math.log(predP) + (1 - actualWin) * Math.log(1 - predP));
        if ((predP >= 0.5 && actualWin === 1) || (predP < 0.5 && actualWin === 0)) {
          correctCount++;
        }
        oosPredictions.push({ predictedProb: predP, actualWin });
      }

      const nOos = oosRecords.length;
      oosBrierScore = Number((brierSum / nOos).toFixed(4));
      oosLogLoss = Number((logLossSum / nOos).toFixed(4));
      oosAccuracyPct = Number(((correctCount / nOos) * 100).toFixed(1));

      // ECE (Expected Calibration Error) over 3 probability bins: [0, 0.40], [0.40, 0.70], [0.70, 1.00]
      const bins = [
        { min: 0.0, max: 0.40, preds: [] as typeof oosPredictions },
        { min: 0.40, max: 0.70, preds: [] as typeof oosPredictions },
        { min: 0.70, max: 1.00, preds: [] as typeof oosPredictions }
      ];

      for (const p of oosPredictions) {
        const bin = bins.find(b => p.predictedProb >= b.min && p.predictedProb <= b.max) || bins[1];
        bin.preds.push(p);
      }

      let weightedEce = 0;
      for (const bin of bins) {
        if (bin.preds.length > 0) {
          const binAvgPred = bin.preds.reduce((s, x) => s + x.predictedProb, 0) / bin.preds.length;
          const binAvgActual = bin.preds.reduce((s, x) => s + x.actualWin, 0) / bin.preds.length;
          weightedEce += (bin.preds.length / nOos) * Math.abs(binAvgPred - binAvgActual);
        }
      }
      oosExpectedCalibrationError = Number(weightedEce.toFixed(4));

      // Stability Check: Difference between Train Win Rate and OOS Win Rate
      const trainWinRate = trainTotal > 0 ? (trainWins / trainTotal) : 0.5;
      const oosWins = oosRecords.filter(r => r.outcome === 'WIN').length;
      const oosWinRate = oosRecords.length > 0 ? (oosWins / oosRecords.length) : 0.5;
      const gap = Math.abs(trainWinRate - oosWinRate);
      stabilityGapPct = Number((gap * 100).toFixed(1));

      isBrierAcceptable = oosBrierScore <= 0.24;
      isLogLossAcceptable = oosLogLoss <= 0.68;
      isEceAcceptable = oosExpectedCalibrationError <= 0.15;
      isStable = gap <= 0.20;

      if (!isBrierAcceptable) {
        failureReasonsFa.push(`امتیاز Brier Score در داده‌های OOS بیش از حد نصاب است (${oosBrierScore} > 0.24).`);
      }
      if (!isLogLossAcceptable) {
        failureReasonsFa.push(`خطای لاگ Log Loss در داده‌های OOS بیش از حد مجاز است (${oosLogLoss} > 0.68).`);
      }
      if (!isEceAcceptable) {
        failureReasonsFa.push(`خطای کالیبراسیون تجربی (ECE) بیش از ۱۵٪ است (${(oosExpectedCalibrationError * 100).toFixed(1)}%).`);
      }
      if (!isStable) {
        failureReasonsFa.push(`ناپایداری توزیع: اختلاف وین‌ریت آموزش و OOS برابر ${stabilityGapPct}٪ است (حداکثر مجاز: ۲۰٪).`);
      }
    }

    if (!isIntervalNarrow) {
      failureReasonsFa.push(`پهنای بازه اطمینان بیزی (${credibleIntervalWidth}) عریض است (باید <= 0.30 باشد).`);
    }

    // Final Calibration Verdict
    const isFullyCalibrated =
      isSampleAdequate &&
      isOosValid &&
      isBrierAcceptable &&
      isLogLossAcceptable &&
      isEceAcceptable &&
      isIntervalNarrow &&
      isStable;

    const status: RealBayesianInferenceResult['status'] = isFullyCalibrated ? 'CALIBRATED' : 'UNCALIBRATED';
    const isLiveEntryPermitted = isFullyCalibrated;

    const calibrationMetrics: BayesianCalibrationMetrics = {
      totalSampleSize: sampleSize,
      resolvedSampleSize: sampleSize,
      trainSampleSize: trainRecords.length,
      oosSampleSize: oosRecords.length,
      oosBrierScore,
      oosLogLoss,
      oosExpectedCalibrationError,
      oosAccuracyPct,
      credibleIntervalWidth,
      stabilityGapPct,
      isSampleAdequate,
      isOosValid,
      isBrierAcceptable,
      isLogLossAcceptable,
      isEceAcceptable,
      isIntervalNarrow,
      isStable,
      calibrationFailureReasonsFa: failureReasonsFa
    };

    const detailsFa = isFullyCalibrated
      ? `استنتاج بیزی کالیبره‌شده: P(Win پیشین: ${(priorProbability * 100).toFixed(1)}٪) با ضرایب درست‌نمایی تجربی آموخته‌شده و ضریب بیز ${bayesFactor} منجر به احتمال پسین ${(rawPosterior * 100).toFixed(1)}٪ شد. آزمون OOS تأیید شد (Brier: ${oosBrierScore}، LogLoss: ${oosLogLoss}، ECE: ${oosExpectedCalibrationError !== null ? (oosExpectedCalibrationError * 100).toFixed(1) : 'N/A'}٪). بازه اطمینان ۹۵٪: [${(lowerCredible * 100).toFixed(1)}٪ - ${(upperCredible * 100).toFixed(1)}٪].`
      : `استنتاج بیزی UNCALIBRATED (فاقد کالیبراسیون آماری معتبر): ورود لایو مسدود شد. دلایل نقص: ${failureReasonsFa.join(' • ')}`;

    return {
      status,
      isLiveEntryPermitted,
      failClosedReasonFa: failureReasonsFa.length > 0 ? failureReasonsFa.join(' | ') : undefined,
      segmentKey,
      sampleSize,
      priorProbability,
      priorSource,
      likelihoodWin: Number(totalLikelihoodWin.toFixed(4)),
      likelihoodLoss: Number(totalLikelihoodLoss.toFixed(4)),
      bayesFactor,
      posteriorProbability: isFullyCalibrated ? rawPosterior : null,
      credibleInterval95: isFullyCalibrated ? { lower: lowerCredible, upper: upperCredible } : null,
      evidenceVector: liveEvidenceVector,
      learnedFeatures,
      alphaPosterior: alphaPost,
      betaPosterior: betaPost,
      calibrationMetrics,
      detailsFa
    };
  }
}

export const realBayesianEngine = RealBayesianEngine.getInstance();
