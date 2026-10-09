import {
  AnalysisResult,
  TradePosition,
  TradeHistory,
  MasterDecisionObject,
  MasterDecisionStatus,
  MetaModelHealthState,
  MetaLearnerInputFeatures,
  MetaLearnerPrediction,
  ModelDisagreementReport,
  EntryOpportunitySurfaceReport,
  PredictionStabilityReport,
  TemporalEntryStabilityReport,
} from '../types/trading';
import { centralTradeDatasetService } from './centralTradeDataset';
import { predictEmpiricalMetaProbability } from './empiricalMetaProbabilityModel';

/**
 * 🧠 91-97 & 100. ADVANCED META-MODEL, DYNAMIC ENSEMBLE PRUNING & CANONICAL MASTER DECISION GATE
 */

export interface DynamicEnsembleModelRecord {
  modelId: string;
  nameFa: string;
  baseWeight: number;
  sampleSize: number;
  isFresh: boolean;
  oosPrecisionPct: number | null;
  regimeAccuracyPct: number | null;
  healthState: MetaModelHealthState;
  effectiveWeight: number;
  isPruned: boolean;
  pruneReasonFa?: string;
}

export interface EnsemblePruningReport {
  models: DynamicEnsembleModelRecord[];
  activeModelsCount: number;
  prunedModelsCount: number;
  totalEffectiveWeight: number;
  pruningSummaryFa: string;
}

class MetaModelEnsembleEngine {
  private static instance: MetaModelEnsembleEngine;
  private decisionSequence = 0;

  // 94. Rolling prediction history for stability tracking
  private recentPredictionHistory: Array<{ timestamp: number; probability: number; direction: string }> = [];

  // 95. Rolling entry snapshot scores for temporal stability tracking
  private recentScoreSnapshots: Array<{ timestamp: number; score: number; direction: string; isTradeWorthy: boolean }> = [];

  // 97. Distinct Live Execution Fresh Snapshot Cache (Strictly separated from UI Cache)
  private liveExecutionSnapshotCache: { timestamp: number; data: any } | null = null;

  private constructor() {}

  public static getInstance(): MetaModelEnsembleEngine {
    if (!MetaModelEnsembleEngine.instance) {
      MetaModelEnsembleEngine.instance = new MetaModelEnsembleEngine();
    }
    return MetaModelEnsembleEngine.instance;
  }

  // =========================================================================
  // 91. Ensemble باید بتواند Model را حذف کند (Dynamic Model Pruning)
  // =========================================================================
  public evaluateDynamicEnsembleWeights(
    regime: string,
    rawModels: Array<{
      modelId: string;
      nameFa: string;
      sampleSize: number;
      oosPrecisionPct: number | null;
      regimeAccuracyPct: number | null;
      baseWeight: number;
      healthState: MetaModelHealthState;
    }>
  ): EnsemblePruningReport {
    const records: DynamicEnsembleModelRecord[] = [];
    let activeWeightSum = 0;

    for (const m of rawModels) {
      const isUnvalidated = m.oosPrecisionPct === null || m.sampleSize < 15;
      const isFresh = m.sampleSize < 35;
      let effectiveWeight = m.baseWeight;
      let isPruned = false;
      let pruneReasonFa: string | undefined;

      if (m.healthState !== 'HEALTHY') {
        effectiveWeight = 0;
        isPruned = true;
        pruneReasonFa = `مدل با وضعیت سلامت ${m.healthState} مجاز به ورود به Ensemble نیست.`;
      } else if (isUnvalidated) {
        effectiveWeight = 0;
        isPruned = true;
        pruneReasonFa = `حذف کامل مدل (وزن ۰): فاقد داده واقعی کالیبراسیون یا نمونه کافی (حجم نمونه: ${m.sampleSize})`;
      } else if (m.oosPrecisionPct !== null && m.oosPrecisionPct < 50.0 && m.sampleSize >= 15) {
        // ۱. اگر مدل در رژیم فعلی عملکرد ضعیف داشته باشد (زیر ۵۰٪ یا افت شدید)، وزن صفر شده و حذف می‌شود
        effectiveWeight = 0;
        isPruned = true;
        pruneReasonFa = `حذف کامل مدل (وزن ۰) به دلیل افت دقت OOS (${m.oosPrecisionPct.toFixed(1)}٪)`;
      } else if (isFresh) {
        // ۲. اگر مدل تازه است، وزن آن به حداکثر ۰.۰۸ محدود می‌شود تا خطر داده ناکافی مهار شود
        effectiveWeight = Math.min(effectiveWeight, 0.08);
        pruneReasonFa = `سقف‌گذاری وزن مدل تازه (تعداد نمونه ${m.sampleSize} < ۳۵)`;
      } else if (m.oosPrecisionPct !== null && m.oosPrecisionPct >= 70.0) {
        // ۳. اگر دقت خارج از نمونه (OOS) بالایی داشته باشد، ضریب بوست ۱.۴ دریافت می‌کند
        const oosBoost = 1.0 + Math.min(0.5, (m.oosPrecisionPct - 70) * 0.02);
        effectiveWeight = effectiveWeight * oosBoost;
      }

      if (!isPruned) {
        activeWeightSum += effectiveWeight;
      }

      records.push({
        modelId: m.modelId,
        nameFa: m.nameFa,
        baseWeight: m.baseWeight,
        sampleSize: m.sampleSize,
        isFresh,
        oosPrecisionPct: m.oosPrecisionPct,
        regimeAccuracyPct: m.regimeAccuracyPct,
        healthState: m.healthState,
        effectiveWeight,
        isPruned,
        pruneReasonFa,
      });
    }

    // نرمال‌سازی وزن‌های باقیمانده به مجموع ۱.۰
    if (activeWeightSum > 0) {
      for (const rec of records) {
        if (!rec.isPruned) {
          rec.effectiveWeight = Math.round((rec.effectiveWeight / activeWeightSum) * 1000) / 1000;
        }
      }
    }

    const activeCount = records.filter(r => !r.isPruned).length;
    const prunedCount = records.filter(r => r.isPruned).length;

    return {
      models: records,
      activeModelsCount: activeCount,
      prunedModelsCount: prunedCount,
      totalEffectiveWeight: Math.round(records.reduce((acc, r) => acc + r.effectiveWeight, 0) * 100) / 100,
      pruningSummaryFa: prunedCount > 0
        ? `✂️ ${prunedCount} مدل نامناسب با رژیم ${regime} به صورت کاملاً داده‌محور از انسامبل حذف (وزن ۰) شدند.`
        : `✅ تمام ${activeCount} مدل انسامبل با وزن‌دهی مبتنی بر دقت OOS و نمونه آماری فعال هستند.`,
    };
  }

  // =========================================================================
  // 93. Model Disagreement را به‌عنوان Signal خطر و عامل تصمیم وارد کن (Requirement 8)
  // =========================================================================
  public evaluateModelDisagreement(
    models: Array<{
      modelId: string;
      nameFa?: string;
      modelNameFa?: string;
      direction: 'LONG' | 'SHORT' | 'NEUTRAL';
      confidencePct: number | null;
      effectiveWeightPct: number;
    }>
  ): ModelDisagreementReport {
    if (!models || models.length === 0) {
      return {
        isHighDisagreementDetected: true,
        disagreementIndex: 100,
        directionalEntropy: 1,
        conflictingDirectionCount: 0,
        modelsBreakdown: [],
        disagreementPenaltyFactor: 0,
        vetoTriggered: true,
        verdictFa: '🛑 پیش‌بینی مدل معتبری برای سنجش اختلاف در دسترس نیست؛ ورود در وضعیت WAIT مسدود شد.',
      };
    }

    let longWeight = 0;
    let shortWeight = 0;
    let neutralWeight = 0;
    let totalWeight = 0;

    for (const m of models) {
      const w = Number.isFinite(m.effectiveWeightPct) ? Math.max(0.0, m.effectiveWeightPct) : 0;
      const confidence = m.confidencePct;
      if (
        w <= 0 ||
        confidence === null ||
        !Number.isFinite(confidence) ||
        confidence <= 0 ||
        confidence > 100
      ) continue;

      const directionalEvidenceWeight = w * (confidence / 100);
      if (directionalEvidenceWeight <= 0) continue;
      totalWeight += directionalEvidenceWeight;
      if (m.direction === 'LONG') {
        longWeight += directionalEvidenceWeight;
      } else if (m.direction === 'SHORT') {
        shortWeight += directionalEvidenceWeight;
      } else {
        neutralWeight += directionalEvidenceWeight;
      }
    }

    if (totalWeight <= 0) {
      return {
        isHighDisagreementDetected: true,
        disagreementIndex: 100,
        directionalEntropy: 1.0,
        conflictingDirectionCount: 0,
        modelsBreakdown: models.map(m => ({
          modelId: m.modelId,
          modelNameFa: m.modelNameFa || m.nameFa || m.modelId,
          direction: m.direction,
          confidencePct: m.confidencePct ?? 0,
          effectiveWeightPct: m.effectiveWeightPct,
        })),
        disagreementPenaltyFactor: 0.0,
        vetoTriggered: true,
        verdictFa: '🛑 هیچ مدل کالیبره‌شده فعال با وزن مثبت یافت نشد (WAIT / NO TRADE).',
      };
    }

    const pLong = longWeight / totalWeight;
    const pShort = shortWeight / totalWeight;
    const pNeutral = neutralWeight / totalWeight;

    // محاسبه آنتروپی شانون (Shannon Entropy) بر روی آرای مدل‌ها
    let entropy = 0;
    [pLong, pShort, pNeutral].forEach(p => {
      if (p > 0.001) {
        entropy -= p * (Math.log2(p) / Math.log2(3));
      }
    });
    entropy = Math.max(0, Math.min(1, entropy));

    // شاخص تضاد مستقیم (Direct Opposition: Long vs Short)
    const directOpposition = Math.min(pLong, pShort) * 2.0; // 0.0 تا 1.0
    const disagreementIndex = Math.round(Math.max(entropy * 80, directOpposition * 100));

    const isHighDisagreement = disagreementIndex >= 38;
    const isModerateDisagreement = disagreementIndex >= 25 && disagreementIndex < 38;

    // جریمه عدم قطعیت و کنترل ریسک بر اساس میزان تشتت آرا
    let penaltyFactor = 1.0;
    let vetoTriggered = false;
    let verdictFa = '✅ اجماع یکپارچه بین مدل‌های مستقل برقرار است.';

    if (isHighDisagreement || directOpposition >= 0.50) {
      vetoTriggered = true;
      penaltyFactor = 0.0;
      verdictFa = `🛑 تضاد شدید آرا بین مدل‌های مستقل (${disagreementIndex}٪ اختلاف) — میانگین‌گیری ساده ممنوع و معامله اکیداً وتو شد (WAIT / NO TRADE).`;
    } else if (isModerateDisagreement) {
      penaltyFactor = 0.50; // جریمه ۵۰٪ حجم برای تشتت آرا
      verdictFa = `⚠️ اختلاف نظر متوسط بین مدل‌ها (${disagreementIndex}٪) — اتخاذ استراتژی احتیاطی و کاهش ۵۰٪ حجم پوزیشن (REDUCED SIZE).`;
    }

    const conflictingCount = (pLong > 0.15 ? 1 : 0) + (pShort > 0.15 ? 1 : 0) + (pNeutral > 0.35 ? 1 : 0);

    return {
      isHighDisagreementDetected: isHighDisagreement || vetoTriggered,
      disagreementIndex,
      directionalEntropy: Math.round(entropy * 100) / 100,
      conflictingDirectionCount: conflictingCount,
      modelsBreakdown: models.map(m => ({
        modelId: m.modelId,
        modelNameFa: m.modelNameFa || m.nameFa || m.modelId,
        direction: m.direction,
        confidencePct: m.confidencePct ?? 0,
        effectiveWeightPct: m.effectiveWeightPct,
      })),
      disagreementPenaltyFactor: Math.round(penaltyFactor * 100) / 100,
      vetoTriggered,
      verdictFa,
    };
  }

  // =========================================================================
  // 92. فرامدل جامع و چندبعدی (Meta-Learner Architecture - Requirement 7)
  // =========================================================================
  public runMetaLearner(
    inputs: MetaLearnerInputFeatures,
    disagreementReport: ModelDisagreementReport,
    pruningReport: EnsemblePruningReport
  ): MetaLearnerPrediction {
    // ارزیابی آماری و وزن‌دهی تجربی مدل‌های مستقل بر اساس وضعیت OOS
    let aggregateLongScore = 0;
    let aggregateShortScore = 0;
    let totalActiveWeight = 0;
    let highestWeightModel = 'NO_VALIDATED_MODEL';

    for (const pr of pruningReport.models) {
      if (pr.isPruned || pr.healthState !== 'HEALTHY') continue;
      const pred = inputs.modelPredictions[pr.modelId] || {
        direction: 'NEUTRAL',
        prob: null,
        healthState: 'SUSPENDED' as const,
      };
      if (pred.healthState !== 'HEALTHY' || pred.prob === null || !Number.isFinite(pred.prob) || pred.prob <= 0 || pred.prob > 100) continue;
      const w = pr.effectiveWeight;
      totalActiveWeight += w;

      if (pred.direction === 'LONG') {
        aggregateLongScore += (pred.prob / 100) * w;
      } else if (pred.direction === 'SHORT') {
        aggregateShortScore += (pred.prob / 100) * w;
      }

      if (w > (pruningReport.models.find(m => m.modelId === highestWeightModel)?.effectiveWeight || 0)) {
        highestWeightModel = pr.modelId;
      }
    }

    let finalDirection: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    let ensembleProbability: number | null = null;
    if (totalActiveWeight > 0 && aggregateLongScore !== aggregateShortScore) {
      if (aggregateLongScore > aggregateShortScore) {
        finalDirection = 'LONG';
        ensembleProbability = aggregateLongScore / totalActiveWeight;
      } else {
        finalDirection = 'SHORT';
        ensembleProbability = aggregateShortScore / totalActiveWeight;
      }
    }

    const empiricalModel = finalDirection === 'NEUTRAL'
      ? null
      : predictEmpiricalMetaProbability(
          centralTradeDatasetService.getAllPredictions(),
          inputs,
          finalDirection,
          ensembleProbability
        );
    const isVetoed = disagreementReport.vetoTriggered || totalActiveWeight <= 0;
    const calibratedProbabilityPct = !isVetoed && empiricalModel?.status === 'CALIBRATED' && empiricalModel.probability !== null
      ? Math.round(empiricalModel.probability * 1000) / 10
      : null;
    const calibrationStatus: MetaLearnerPrediction['calibrationStatus'] =
      calibratedProbabilityPct !== null ? 'CALIBRATED' : (empiricalModel?.status === 'UNCALIBRATED' || isVetoed ? 'UNCALIBRATED' : 'UNRANKED');

    // محاسبه Edge از توزیع نتایج واقعیِ OOS مدل فرامدل
    let expectedReturnR: number | null = null;
    const expectedReturnUsd: number | null = null;
    if (
      calibratedProbabilityPct !== null &&
      empiricalModel?.averageWinR !== null &&
      empiricalModel?.averageLossR !== null
    ) {
      const p = calibratedProbabilityPct / 100;
      expectedReturnR = Math.round((p * empiricalModel.averageWinR + (1 - p) * empiricalModel.averageLossR) * 100) / 100;
    }

    const closedTrades = centralTradeDatasetService.getAllTradeRecords().filter(trade =>
      trade.isClosed &&
      (trade.outcome === 'WIN' || trade.outcome === 'LOSS' || trade.outcome === 'BREAKEVEN') &&
      Number.isFinite(trade.entryPrice) &&
      Number.isFinite(trade.stopPrice) &&
      Number.isFinite(trade.notionalUsd) &&
      trade.notionalUsd > 0
    );
    const excursionSamples = closedTrades.flatMap(trade => {
      const riskUsd = trade.notionalUsd * (Math.abs(trade.entryPrice - trade.stopPrice) / trade.entryPrice);
      if (
        riskUsd <= 0 ||
        typeof trade.MAE !== 'number' || !Number.isFinite(trade.MAE) ||
        typeof trade.MFE !== 'number' || !Number.isFinite(trade.MFE) ||
        typeof trade.timeInTradeSeconds !== 'number' || !Number.isFinite(trade.timeInTradeSeconds) ||
        trade.timeInTradeSeconds < 0
      ) return [];
      return [{
        maeR: trade.MAE / riskUsd,
        mfeR: trade.MFE / riskUsd,
        durationSeconds: trade.timeInTradeSeconds,
      }];
    });
    const hasSufficientExcursionSamples = excursionSamples.length >= 20;
    const expectedMaeR = hasSufficientExcursionSamples
      ? Math.round(excursionSamples.reduce((sum, sample) => sum + sample.maeR, 0) / excursionSamples.length * 100) / 100
      : null;
    const expectedMfeR = hasSufficientExcursionSamples
      ? Math.round(excursionSamples.reduce((sum, sample) => sum + sample.mfeR, 0) / excursionSamples.length * 100) / 100
      : null;
    const expectedDurationSeconds = hasSufficientExcursionSamples
      ? Math.round(excursionSamples.reduce((sum, sample) => sum + sample.durationSeconds, 0) / excursionSamples.length)
      : null;

    const confidenceInterval: MetaLearnerPrediction['confidenceInterval'] = null;
    let metaRationaleFa = calibratedProbabilityPct !== null
      ? `Meta-Model یادگرفته‌شده از ترکیب احتمال‌های رژیم، ستاپ، Order Flow، نوسان، نقدینگی و توافق مدل‌ها: ${finalDirection} با احتمال OOS کالیبره‌شده ${calibratedProbabilityPct}٪ و Edge تاریخی ${expectedReturnR ?? 'ناموجود'}R.`
      : `Meta-Model اجازه معامله نمی‌دهد: ${disagreementReport.vetoTriggered ? disagreementReport.verdictFa : `داده/نمونه OOS کافی یا کیفیت لازم احراز نشد (Train/Calibration/OOS: ${empiricalModel?.trainingSampleSize ?? 0}/${empiricalModel?.calibrationSampleSize ?? 0}/${empiricalModel?.oosSampleSize ?? 0}).`}`;

    return {
      direction: calibratedProbabilityPct !== null ? finalDirection : 'NEUTRAL',
      calibratedProbabilityPct,
      expectedReturnR,
      expectedReturnUsd,
      expectedMaeR,
      expectedMfeR,
      expectedDurationSeconds,
      confidenceInterval,
      dominantModelId: highestWeightModel,
      calibrationStatus,
      confidenceScorePct: calibratedProbabilityPct,
      metaRationaleFa,
      evaluatedAt: Date.now(),
    };
  }

  // =========================================================================
  // 94. Prediction Stability اضافه کن
  // =========================================================================
  public evaluatePredictionStability(currentProb: number | null, currentDir: string): PredictionStabilityReport {
    const now = Date.now();
    if (currentProb !== null && Number.isFinite(currentProb)) {
      this.recentPredictionHistory.push({ timestamp: now, probability: currentProb, direction: currentDir });
    }

    // نگه‌داری نمونه‌های ۱۰ ثانیه اخیر (حداکثر ۱۵ نمونه)
    this.recentPredictionHistory = this.recentPredictionHistory
      .filter(item => now - item.timestamp <= 12000)
      .slice(-15);

    const probs = this.recentPredictionHistory.map(p => p.probability);
    const dirs = this.recentPredictionHistory.map(p => p.direction);

    if (currentProb === null || !Number.isFinite(currentProb) || probs.length < 3) {
      return {
        isPredictionStable: false,
        predictionStabilityScore: 0,
        recentPredictionsJitterVariance: 0,
        isEntryBlockedByInstability: true,
        recentProbabilitiesSample: probs,
        reasonsFa: [
          currentProb === null || !Number.isFinite(currentProb)
            ? 'احتمال معتبر در دسترس نیست؛ ورود تا دریافت پیش‌بینی کالیبره‌شده متوقف است.'
            : `نمونه‌های متوالی ناکافی است (${probs.length}/۳)؛ وضعیت WAIT تا تکمیل تاریخچه پایداری.`,
        ],
        evaluatedAt: now,
      };
    }

    // محاسبه واریانس و پرش‌های ناگهانی (Jitter Variance)
    let totalJitter = 0;
    for (let i = 1; i < probs.length; i++) {
      totalJitter += Math.abs(probs[i] - probs[i - 1]);
    }
    const avgJitter = totalJitter / (probs.length - 1);

    // محاسبه تغییر جهت مکرر (Direction Flip Flop)
    let dirFlips = 0;
    for (let i = 1; i < dirs.length; i++) {
      if (dirs[i] !== dirs[i - 1] && dirs[i] !== 'NEUTRAL' && dirs[i - 1] !== 'NEUTRAL') {
        dirFlips++;
      }
    }

    // امتیاز پایداری از ۱۰۰
    const stabilityScore = Math.max(
      0,
      Math.min(100, Math.round(100 - (avgJitter * 2.5) - (dirFlips * 20)))
    );

    const isUnstable = stabilityScore < 60 || dirFlips >= 2 || avgJitter > 15;
    const reasonsFa: string[] = [];

    if (isUnstable) {
      reasonsFa.push(`پرش سریع پیش‌بینی (میانگین نوسان لحظه‌ای ${avgJitter.toFixed(1)}٪ در هر تیک)`);
      if (dirFlips > 0) reasonsFa.push(`تغییر مکرر جهت سیگنال (${dirFlips} بار چرخش در چند ثانیه)`);
    } else {
      reasonsFa.push(`پیش‌بینی با ضریب ثبات ${stabilityScore}٪ پایدار و قابل اتکاست.`);
    }

    return {
      isPredictionStable: !isUnstable,
      predictionStabilityScore: stabilityScore,
      recentPredictionsJitterVariance: Math.round(avgJitter * 10) / 10,
      isEntryBlockedByInstability: isUnstable,
      recentProbabilitiesSample: probs,
      reasonsFa,
      evaluatedAt: now,
    };
  }

  // =========================================================================
  // 95. Entry Score باید Temporal Stability داشته باشد
  // =========================================================================
  public evaluateTemporalEntryStability(
    currentScore: number,
    currentDir: string,
    isTriggerConfirmed: boolean,
    triggerName?: string
  ): TemporalEntryStabilityReport {
    const now = Date.now();
    const isTradeWorthy = currentScore >= 75;

    this.recentScoreSnapshots.push({
      timestamp: now,
      score: currentScore,
      direction: currentDir,
      isTradeWorthy,
    });

    // نگه‌داری اسنپ‌شات‌های ۲۰ ثانیه اخیر
    this.recentScoreSnapshots = this.recentScoreSnapshots
      .filter(s => now - s.timestamp <= 20000)
      .slice(-10);

    // شمارش تعداد اسنپ‌شات‌های متوالی با امتیاز بالا
    let consecutiveHigh = 0;
    for (let i = this.recentScoreSnapshots.length - 1; i >= 0; i--) {
      if (this.recentScoreSnapshots[i].isTradeWorthy && this.recentScoreSnapshots[i].direction === currentDir) {
        consecutiveHigh++;
      } else {
        break;
      }
    }

    const requiredConsecutive = 3;
    // تایید ثبات زمانی: یا ۳ اسنپ‌شات متوالی حفظ شده، یا تریگر رویدادی معتبر قیمت رخ داده است
    const isTemporalStabilityVerified = (consecutiveHigh >= requiredConsecutive) || isTriggerConfirmed;

    let verdictFa = `ثبات زمانی امتیاز معامله (${consecutiveHigh}/${requiredConsecutive} اسنپ‌شات متوالی) تایید شد.`;
    if (!isTemporalStabilityVerified) {
      verdictFa = `🛑 عدم احراز ثبات زمانی: امتیاز بالا فقط در یک تیک بوده و هنوز برای ۳ اسنپ‌شات متوالی تثبیت نشده است.`;
    } else if (isTriggerConfirmed) {
      verdictFa = `⚡ تایید فوری با ماشه رویدادی قیمت (${triggerName || 'SMC Liquidity Sweep'}) بدون تاخیر ورود.`;
    }

    return {
      isTemporalStabilityVerified,
      consecutiveHighThresholdSnapshots: consecutiveHigh,
      requiredConsecutiveSnapshots: requiredConsecutive,
      isStructuralTriggerConfirmed: isTriggerConfirmed,
      structuralTriggerType: triggerName,
      isLateEntryPrevented: true,
      verdictFa,
      checkedAt: now,
    };
  }

  // =========================================================================
  // 96 & 97. Speed vs Accuracy & Fresh Snapshot Isolation
  // =========================================================================
  public async getFreshExecutionSnapshot(analysis: AnalysisResult | null, freshFetchFn?: () => Promise<any>): Promise<any> {
    // Live Execution Cache باید کاملاً از UI Cache جدا باشد و اسنپ‌شات اتمیک و تازه ارائه دهد
    if (freshFetchFn) {
      try {
        const freshData = await freshFetchFn();
        this.liveExecutionSnapshotCache = { timestamp: Date.now(), data: freshData };
        return freshData;
      } catch {
        // Fallback to current memory snapshot
      }
    }
    return analysis;
  }

  // =========================================================================
  // 100. آخرین Gate قبل از معامله: Master Decision Object
  // هیچ مسیر دیگری نباید بتواند مستقیم Order ارسال کند.
  // =========================================================================
  public generateMasterDecisionObject(options: {
    analysis: AnalysisResult | null;
    metaLearnerOutput: MetaLearnerPrediction;
    disagreementReport: ModelDisagreementReport;
    predictionStability: PredictionStabilityReport;
    temporalStability: TemporalEntryStabilityReport;
    pipelinePassed: boolean;
    pipelineRejections: string[];
    riskGovernorApproved: boolean;
    riskGovernorBlockers: string[];
    opportunitySurface?: EntryOpportunitySurfaceReport;
    price: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    allocatedRiskUsd: number;
    modelVersion?: string;
  }): MasterDecisionObject {
    const {
      analysis,
      metaLearnerOutput,
      disagreementReport,
      predictionStability,
      temporalStability,
      pipelinePassed,
      pipelineRejections,
      riskGovernorApproved,
      riskGovernorBlockers,
      opportunitySurface,
      price,
      stopLossPrice,
      takeProfitPrice,
      allocatedRiskUsd,
      modelVersion = 'v4.2-ensemble-meta',
    } = options;

    const now = Date.now();
    const ttlMs = 180000; // 3 دقیقه مهلت اعتبار سیگنال (TTL)
    const expiryTs = now + ttlMs;

    const allBlockers: string[] = [
      ...pipelineRejections,
      ...riskGovernorBlockers,
    ];

    if (disagreementReport.vetoTriggered) {
      allBlockers.push(disagreementReport.verdictFa);
    }
    if (predictionStability.isEntryBlockedByInstability) {
      allBlockers.push(...predictionStability.reasonsFa);
    }
    if (!temporalStability.isTemporalStabilityVerified) {
      allBlockers.push(temporalStability.verdictFa);
    }
    if (opportunitySurface && opportunitySurface.mode !== 'EXECUTE' && opportunitySurface.nearMissReasonFa) {
      allBlockers.push(opportunitySurface.nearMissReasonFa);
    }

    let status: MasterDecisionStatus = 'NO_TRADE';
    let statusFa = '🛑 بدون معامله (NO_TRADE)';
    let executionPermitted = false;

    const hasNoBlockers = allBlockers.length === 0;
    const isDirectionValid = metaLearnerOutput.direction !== 'NEUTRAL';
    const isProbSufficient = metaLearnerOutput.calibratedProbabilityPct !== null && metaLearnerOutput.calibratedProbabilityPct >= 65.0;
    const isOpportunityExecutable = opportunitySurface?.mode === 'EXECUTE';

    if (pipelinePassed && riskGovernorApproved && hasNoBlockers && isDirectionValid && isProbSufficient && isOpportunityExecutable) {
      if (temporalStability.isStructuralTriggerConfirmed) {
        status = 'EXECUTE';
        statusFa = '🚀 صدور مجوز اجرای قطعی (EXECUTE)';
        executionPermitted = true;
      } else {
        status = 'TRIGGERED';
        statusFa = '⚡ ماشه فعال - در انتظار اجرای اوردر (TRIGGERED)';
        executionPermitted = true;
      }
    } else if (isDirectionValid && isProbSufficient && allBlockers.length <= 1) {
      status = 'ARMED';
      statusFa = '🎯 ستاپ مسلح شده - در انتظار تکمیل شرایط (ARMED)';
      executionPermitted = false;
    } else {
      status = 'NO_TRADE';
      statusFa = '🛑 بدون معامله و حفظ سرمایه (NO_TRADE)';
      executionPermitted = false;
    }

    this.decisionSequence += 1;
    const uniqueId = `MST_${now}_${this.decisionSequence.toString(36).toUpperCase()}`;

    return {
      decisionId: uniqueId,
      status,
      statusFa,
      direction: executionPermitted ? metaLearnerOutput.direction : 'NEUTRAL',
      probabilityPct: metaLearnerOutput.calibratedProbabilityPct ?? 0,
      confidenceInterval: metaLearnerOutput.confidenceInterval ? {
        lowerBoundPct: metaLearnerOutput.confidenceInterval.lowerBoundPct ?? 0,
        upperBoundPct: metaLearnerOutput.confidenceInterval.upperBoundPct ?? 0,
        widthPct: Math.round(((metaLearnerOutput.confidenceInterval.upperBoundPct ?? 0) - (metaLearnerOutput.confidenceInterval.lowerBoundPct ?? 0)) * 10) / 10,
      } : { lowerBoundPct: 0, upperBoundPct: 0, widthPct: 0 },
      score: metaLearnerOutput.confidenceScorePct ?? 0,
      expectedValueUsd: Math.round((allocatedRiskUsd * (metaLearnerOutput.expectedReturnR ?? 0)) * 100) / 100,
      entryPrice: price,
      stopLossPrice,
      takeProfitPrice,
      riskUsd: allocatedRiskUsd,
      modelVersion,
      dataTimestamp: now,
      dataTimestampIso: new Date(now).toISOString(),
      signalExpiryTimestamp: expiryTs,
      isExpired: false,
      masterVerdictFa: executionPermitted
        ? `مجوز قطعی ورود صادر شد: جهت [${metaLearnerOutput.direction}] با احتمال کالیبره‌شده ${metaLearnerOutput.calibratedProbabilityPct}٪ و تایید تمام فیلترهای پایداری و ریسک.`
        : `ورود مسدود شد: ${allBlockers[0] || 'عدم احراز برتری قطعی آماری'}.`,
      rejectionBlockersFa: allBlockers,
      executionPermitted,
      metaLearnerOutput,
      disagreementReport,
      predictionStability,
      temporalStability,
      opportunitySurface,
    };
  }
}

export const metaModelEnsembleEngine = MetaModelEnsembleEngine.getInstance();
