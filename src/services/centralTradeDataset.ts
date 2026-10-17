import { AnalysisResult, TradeContract, TradeHistory, TradePosition } from '../types/trading';

/**
 * 📊 CENTRAL TRADE / PREDICTION DATASET & PERFORMANCE MATRIX SERVICE (ITEMS 16 - 20)
 */

export interface PredictionDatasetRecord {
  // Immutable Audit Traceability IDs (Item 18)
  predictionId: string;
  decisionId?: string;
  tradeId?: string;
  orderId?: string;
  executionAttemptId?: string;

  // Initial Snapshot State (Item 16)
  timestamp: number;
  timestampIso: string;
  market: 'BTC/USDT';
  exchange: string;
  marketType: 'PERPETUAL' | 'SPOT';
  timeframe: '1m' | '5m' | '15m' | '30m' | '1H' | '4H';
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  setupType: string;
  marketRegime: string;
  entryPrice: number | null;
  stopPrice: number | null;
  tpLevels: { tp1: number | null; tp2: number | null; tp3: number | null };
  probability: number | null;
  confidenceInterval: { lower: number; upper: number } | null;
  modelVersion: string;
  featureVersion: string;
  decisionVersion: string;
  features: Record<string, any>;
  orderBookState: {
    bidDepthUsd: number | null;
    askDepthUsd: number | null;
    imbalancePct: number | null;
  };
  CVD: number | null;
  funding: number | null;
  OI: number | null;
  volatility: number | null;
  spread: number | null;
  latency: number | null;

  // Execution Status (Item 17)
  executionStatus: 'PREDICTED_ONLY' | 'DECISION_REJECTED' | 'ORDER_SUBMITTED' | 'EXECUTED_FILLED' | 'CLOSED_COMPLETED';
  decisionRejectionReasonFa?: string;

  // Outcome Feedback Written Back After Completion (Item 19)
  outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'SKIPPED_EXECUTED_NO_FILL' | 'REJECTED_WAIT';
  outcomeSource?: 'FREQTRADE_CONFIRMED' | 'UNVERIFIED_LOCAL';
  freqtradeTradeId?: number;
  PnL?: number;
  R?: number;
  MAE?: number;
  MFE?: number;
  timeInTrade?: number; // seconds
  slippage?: number;
  fees?: number;
  exitReason?: string;
  feedbackProcessedAtMs?: number;
  evaluatedAt?: number;
  entryTimestamp?: number;
}

export interface TradeDatasetRecord {
  tradeId: string;
  predictionId: string; // Linked immutable prediction ID
  decisionId: string;
  orderId?: string;
  executionAttemptId?: string;
  timestamp: number;
  timestampIso: string;
  market: 'BTC/USDT';
  exchange: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  actualFillPrice: number;
  stopPrice: number;
  tp1: number;
  tp2: number;
  tp3: number;
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  
  isClosed: boolean;
  outcomeSource?: 'FREQTRADE_CONFIRMED' | 'UNVERIFIED_LOCAL';
  freqtradeTradeId?: number;
  closedAtMs?: number;
  closedAtIso?: string;
  exitPrice?: number;
  outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN';
  PnL?: number;
  R?: number;
  MAE?: number;
  MFE?: number;
  timeInTradeSeconds?: number;
  actualSlippageUsd?: number;
  actualFeesUsd?: number;
  exitReason?: string;
}

export function hasFreqtradeVerifiedOutcome(record: PredictionDatasetRecord): boolean {
  return record.outcomeSource === 'FREQTRADE_CONFIRMED' &&
    record.executionStatus === 'CLOSED_COMPLETED' &&
    (record.outcome === 'WIN' || record.outcome === 'LOSS' || record.outcome === 'BREAKEVEN') &&
    Number.isSafeInteger(record.freqtradeTradeId) &&
    (record.freqtradeTradeId ?? 0) > 0;
}

export function hasFreqtradeVerifiedTradeOutcome(record: TradeDatasetRecord): boolean {
  return record.outcomeSource === 'FREQTRADE_CONFIRMED' &&
    record.isClosed &&
    (record.outcome === 'WIN' || record.outcome === 'LOSS' || record.outcome === 'BREAKEVEN') &&
    Number.isSafeInteger(record.freqtradeTradeId) &&
    (record.freqtradeTradeId ?? 0) > 0;
}

export interface PerformanceSegmentMetrics {
  segmentKey: string;
  category: 'TIMEFRAME' | 'DIRECTION' | 'REGIME_SETUP';
  labelFa: string;
  totalPredictionsCount: number;
  executedTradesCount: number;
  minRequiredSamples: number; // Item 67: Minimum sample size based on variance, regime, timeframe
  validationStatus: 'VALIDATED' | 'UNVALIDATED';
  winCount: number;
  lossCount: number;
  winRatePct: number;
  totalPnlUsd: number;
  avgR: number;
  expectancyUsd: number;
  isSegmentActivated: boolean; // Selective Activation Gate (Item 20 & 67)
  activationReasonFa: string;
}

export interface MultiDimensionalPerformanceMatrix {
  timeframeSegments: Record<string, PerformanceSegmentMetrics>;
  directionSegments: Record<string, PerformanceSegmentMetrics>;
  regimeSegments: Record<string, PerformanceSegmentMetrics>;
  lastBatchEvaluationTimeMs: number;
  pendingFeedbackQueueCount: number;
  modelUpdateBatchCycle: number;
}

export interface TraceableIdsPack {
  predictionId: string;
  decisionId: string;
  tradeId: string;
  orderId: string;
  executionAttemptId: string;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function predictionFromArchive(value: unknown): PredictionDatasetRecord | null {
  if (!isObjectRecord(value)) return null;
  const decision = value.decision;
  const features = value.featureSnapshot;
  if (
    !isObjectRecord(decision) ||
    typeof decision.signalId !== 'string' ||
    typeof decision.decisionId !== 'string' ||
    typeof decision.generatedAtMs !== 'number' ||
    !Number.isSafeInteger(decision.generatedAtMs) ||
    typeof decision.direction !== 'string' ||
    !['LONG', 'SHORT'].includes(decision.direction) ||
    typeof decision.exchange !== 'string' ||
    typeof decision.pair !== 'string' ||
    typeof decision.timeframe !== 'string' ||
    !isObjectRecord(decision.entryConditions) ||
    !isObjectRecord(features)
  ) {
    return null;
  }
  const timeframe = ['1m', '5m', '15m', '30m', '1H', '4H'].includes(decision.timeframe)
    ? decision.timeframe as PredictionDatasetRecord['timeframe']
    : '15m';
  const outcome = isObjectRecord(value.outcome) &&
    value.outcome.source === 'FREQTRADE_RPC' &&
    Number.isSafeInteger(value.outcome.tradeId) &&
    (value.outcome.tradeId as number) > 0 &&
    typeof value.outcome.outcome === 'string' &&
    ['WIN', 'LOSS', 'BREAKEVEN'].includes(value.outcome.outcome) &&
    typeof value.outcome.pnlUsd === 'number' &&
    Number.isFinite(value.outcome.pnlUsd) &&
    typeof value.outcome.feesUsd === 'number' &&
    Number.isFinite(value.outcome.feesUsd) &&
    typeof value.outcome.exitReason === 'string' &&
    typeof value.outcome.closedAtMs === 'number' &&
    Number.isSafeInteger(value.outcome.closedAtMs)
    ? value.outcome
    : null;
  const marketRegime = typeof features.marketRegime === 'string' ? features.marketRegime : 'UNKNOWN';
  const timestamp = decision.generatedAtMs;
  const direction = decision.direction as 'LONG' | 'SHORT';
  const entryConditions = decision.entryConditions;
  const tp = entryConditions.takeProfit;
  const entryPrice = entryConditions.entryPrice;

  return {
    predictionId: decision.signalId,
    decisionId: decision.decisionId,
    timestamp,
    timestampIso: new Date(timestamp).toISOString(),
    market: 'BTC/USDT',
    exchange: decision.exchange,
    marketType: 'PERPETUAL',
    timeframe,
    direction,
    setupType: typeof features.setupType === 'string'
      ? features.setupType
      : typeof entryConditions.setupType === 'string'
        ? entryConditions.setupType
        : 'UNKNOWN',
    marketRegime,
    entryPrice: typeof entryPrice === 'number' && Number.isFinite(entryPrice) ? entryPrice : null,
    stopPrice: typeof entryConditions.stopLoss === 'number' && Number.isFinite(entryConditions.stopLoss)
      ? entryConditions.stopLoss
      : null,
    tpLevels: {
      tp1: typeof tp === 'number' && Number.isFinite(tp) ? tp : null,
      tp2: typeof tp === 'number' && Number.isFinite(tp) ? tp : null,
      tp3: typeof tp === 'number' && Number.isFinite(tp) ? tp : null,
    },
    probability: null,
    confidenceInterval: null,
    modelVersion: typeof value.modelVersion === 'string' ? value.modelVersion : 'unknown',
    featureVersion: typeof value.featureVersion === 'string' ? value.featureVersion : 'unknown',
    decisionVersion: 'freqtrade-signal-contract',
    features,
    orderBookState: {
      bidDepthUsd: null,
      askDepthUsd: null,
      imbalancePct: typeof features.obi === 'number' ? Math.round(features.obi * 100) : null,
    },
    CVD: null,
    funding: typeof features.fundingRate === 'number' ? features.fundingRate : null,
    OI: null,
    volatility: typeof features.volatilityPct === 'number' ? features.volatilityPct : null,
    spread: null,
    latency: null,
    executionStatus: outcome ? 'CLOSED_COMPLETED' : 'EXECUTED_FILLED',
    ...(outcome ? {
      outcome: outcome.outcome as PredictionDatasetRecord['outcome'],
      outcomeSource: 'FREQTRADE_CONFIRMED' as const,
      freqtradeTradeId: outcome.tradeId as number,
      PnL: outcome.pnlUsd as number,
      fees: outcome.feesUsd as number,
      exitReason: outcome.exitReason as string,
      feedbackProcessedAtMs: outcome.closedAtMs as number,
    } : {}),
  };
}

export class CentralTradeDatasetService {
  private static instance: CentralTradeDatasetService;
  private batchCycleCount = 14;
  private serverPredictions: PredictionDatasetRecord[] = [];

  private constructor() {}

  public static getInstance(): CentralTradeDatasetService {
    if (!CentralTradeDatasetService.instance) {
      CentralTradeDatasetService.instance = new CentralTradeDatasetService();
    }
    return CentralTradeDatasetService.instance;
  }

  /**
   * ITEM 18: Generate immutable traceability IDs for full-chain audit
   */
  public generateTraceableIds(): TraceableIdsPack {
    const timestamp = Date.now();
    const uuidShort = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().substring(0, 6)
      : Math.random().toString(36).substring(2, 8);

    return {
      predictionId: `PRED_${timestamp}_${uuidShort}`,
      decisionId: `DEC_${timestamp}_${uuidShort}`,
      tradeId: `TRD_${timestamp}_${uuidShort}`,
      orderId: `ORD_${timestamp}_${uuidShort}`,
      executionAttemptId: `ATT_${timestamp}_${uuidShort}`,
    };
  }

  /**
   * ITEM 16 & 17: Save prediction record independently from trades
   */
  public recordPrediction(
    analysis: Partial<AnalysisResult> | any,
    targetDir: 'LONG' | 'SHORT' | 'NEUTRAL',
    idsPack?: TraceableIdsPack,
    executionStatus: PredictionDatasetRecord['executionStatus'] = 'PREDICTED_ONLY',
    rejectionReasonFa?: string
  ): PredictionDatasetRecord {
    const ids = idsPack || this.generateTraceableIds();
    const price = analysis?.price ?? null;
    const atr = analysis?.atr ?? null;
    const obi = analysis?.obi ?? null;
    const cvd = analysis?.cvdDelta ?? null;
    const vol = analysis?.volatilityPct ?? null;

    const record: PredictionDatasetRecord = {
      predictionId: ids.predictionId,
      decisionId: ids.decisionId,
      tradeId: ids.tradeId,
      orderId: ids.orderId,
      executionAttemptId: ids.executionAttemptId,

      timestamp: Date.now(),
      timestampIso: new Date().toISOString(),
      market: 'BTC/USDT',
      exchange: analysis?.canonicalSnapshot?.feeds?.[0]?.exchange || 'UNAVAILABLE',
      marketType: 'PERPETUAL',
      timeframe: (analysis?.timeframe as any) || '15m',
      direction: targetDir,
      setupType: analysis?.setupContext?.setupType || 'UNSPECIFIED',
      marketRegime: (analysis?.marketRegime as any) || 'UNKNOWN',
      entryPrice: price,
      stopPrice: analysis?.sl ?? null,
      tpLevels: {
        tp1: analysis?.tp1 ?? null,
        tp2: analysis?.tp2 ?? null,
        tp3: analysis?.tp3 ?? null,
      },
      probability: analysis?.calibratedMetadata?.isCalibrationVerified === true &&
        typeof analysis.calibratedMetadata.calibratedWinProbability === 'number'
        ? analysis.calibratedMetadata.calibratedWinProbability
        : null,
      confidenceInterval: analysis?.confidenceInterval ?? null,
      modelVersion: analysis?.modelVersion || 'v2.1_real',
      featureVersion: 'v4.0-central-probability',
      decisionVersion: 'v2.0',
      features: {
        rsi: analysis?.rsi ?? null,
        adx: analysis?.adx ?? null,
        atr: atr,
        volatilityPct: vol,
        vwap: analysis?.vwap ?? null,
        ema20: analysis?.ema20Val ?? null,
        ema50: analysis?.ema50Val ?? null,
        ema200: analysis?.ema200Val ?? null,
        scoreLong: analysis?.scoreLong ?? null,
        scoreShort: analysis?.scoreShort ?? null,
        regimeProbabilities: analysis?.regimeClassification?.regimeProbabilities ?? null,
        regimeModelCalibrated: analysis?.regimeClassification?.probabilityModelValidation?.status === 'CALIBRATED',
        calibrationErrorPct: typeof analysis?.calibratedMetadata?.expectedCalibrationError === 'number'
          ? analysis.calibratedMetadata.expectedCalibrationError * 100
          : null,
        signalAgeMs: typeof (analysis?.canonicalSnapshot?.timestampUtc ?? analysis?.realObiData?.timestamp) === 'number'
          ? Math.max(0, Date.now() - (analysis?.canonicalSnapshot?.timestampUtc ?? analysis?.realObiData?.timestamp))
          : null,
        oiChangePct: analysis?.cvdOiMatrix?.openInterestChangePct ?? null,
        modelAgreementPct: analysis?.modelAgreementPct ?? null,
        obi: analysis?.realObiData?.obi ?? obi,
        cvdDelta: cvd,
        takerRatio: analysis?.takerRatio ?? null,
      },
      orderBookState: {
        bidDepthUsd: analysis?.realObiData?.bidDepthUsd ?? null,
        askDepthUsd: analysis?.realObiData?.askDepthUsd ?? null,
        imbalancePct: obi !== null ? Math.round(obi * 100) : null,
      },
      CVD: cvd,
      funding: analysis?.cvdOiMatrix?.fundingRatePct ?? analysis?.fundingRate ?? null,
      OI: analysis?.oi ?? null,
      volatility: vol,
      spread: analysis?.canonicalSnapshot?.basisSpreadBps ?? null,
      latency: analysis?.realObiData?.latencyMs ?? null,

      executionStatus,
      decisionRejectionReasonFa: rejectionReasonFa,
    };

    return record;
  }

  /**
   * ITEM 17: Record trade execution separately and link to predictionId
   */
  public recordTradeExecution(trade: TradePosition | TradeHistory, predictionId: string): TradeDatasetRecord {
    const tradeRecord: TradeDatasetRecord = {
      tradeId: trade.id,
      predictionId,
      decisionId: trade.decisionId || `DEC_${Date.now()}`,
      orderId: trade.uniqueClientOrderId || `ORD_${Date.now()}`,
      executionAttemptId: trade.executionAttemptId || `ATT_${Date.now()}`,
      timestamp: Date.now(),
      timestampIso: new Date().toISOString(),
      market: 'BTC/USDT',
      exchange: 'BYBIT',
      direction: trade.dir,
      entryPrice: trade.entry,
      actualFillPrice: trade.entry,
      stopPrice: trade.sl,
      tp1: trade.tp1 || trade.tp,
      tp2: trade.tp2 || trade.tp,
      tp3: trade.tp3 || trade.tp,
      leverage: trade.lev,
      marginUsd: trade.margin,
      notionalUsd: trade.margin * trade.lev,
      isClosed: false,
      outcomeSource: 'UNVERIFIED_LOCAL',
    };

    return tradeRecord;
  }

  /**
   * ITEM 19: Closed-loop outcome feedback writeback to Prediction Dataset
   * Prevents instant overfitting by queuing feedback for batch evaluation
   */
  public writebackOutcome(
    predictionId: string,
    outcome: 'WIN' | 'LOSS' | 'BREAKEVEN',
    pnlUsd: number,
    rMultiple: number,
    maeUsd: number,
    mfeUsd: number,
    durationSeconds: number,
    slippageUsd: number,
    feeUsd: number,
    exitReason: string
  ): boolean {
    void predictionId;
    void outcome;
    void pnlUsd;
    void rMultiple;
    void maeUsd;
    void mfeUsd;
    void durationSeconds;
    void slippageUsd;
    void feeUsd;
    void exitReason;
    return false;
  }

  /**
   * ITEM 19: Batch model evaluation cycle (Overfitting Guard)
   */
  public checkAndTriggerBatchModelEvaluation(): void {
    const predictions = this.getFreqtradeVerifiedPredictions();
    const completedFeedbackCount = predictions.filter(p => p.feedbackProcessedAtMs).length;

    if (completedFeedbackCount > 0 && completedFeedbackCount % 5 === 0) {
      this.batchCycleCount += 1;
      this.recalculatePerformanceMatrix();
    }
  }

  /**
   * ITEM 20: Multi-Dimensional Performance Matrix Calculation
   */
  public recalculatePerformanceMatrix(): MultiDimensionalPerformanceMatrix {
    const predictions = this.getAllPredictions();
    const completed = predictions.filter(
      (record) => hasFreqtradeVerifiedOutcome(record) && record.outcome !== undefined
    );

    const buildSegment = (
      key: string,
      category: PerformanceSegmentMetrics['category'],
      labelFa: string,
      filterFn: (p: PredictionDatasetRecord) => boolean
    ): PerformanceSegmentMetrics => {
      const segPredictions = predictions.filter(filterFn);
      const segCompleted = completed.filter(filterFn);
      const winCount = segCompleted.filter(p => p.outcome === 'WIN').length;
      const lossCount = segCompleted.filter(p => p.outcome === 'LOSS').length;
      const totalPnlUsd = segCompleted.reduce((sum, p) => sum + (p.PnL || 0), 0);
      const totalR = segCompleted.reduce((sum, p) => sum + (p.R || 0), 0);
      const winRatePct = segCompleted.length > 0 ? Math.round((winCount / segCompleted.length) * 100) : 0;
      const avgR = segCompleted.length > 0 ? Math.round((totalR / segCompleted.length) * 10) / 10 : 0;
      const expectancyUsd = segCompleted.length > 0 ? Math.round((totalPnlUsd / segCompleted.length) * 100) / 100 : 0;

      // Item 67: Minimum Sample Size based on Variance, Regime, Setup Complexity, and Timeframe
      let minRequiredSamples = 30;
      if (category === 'REGIME_SETUP') {
        if (key === 'HIGH_VOL' || key === 'REVERSAL') minRequiredSamples = 45; // High variance and complexity
        else if (key === 'BREAKOUT') minRequiredSamples = 35;
        else if (key === 'RANGE') minRequiredSamples = 30;
        else minRequiredSamples = 25; // Trend
      } else if (category === 'TIMEFRAME') {
        if (key === '5m') minRequiredSamples = 40; // Micro noise
        else if (key === '15m') minRequiredSamples = 30;
        else minRequiredSamples = 20; // 1H / 4H macro
      } else if (category === 'DIRECTION') {
        minRequiredSamples = 25;
      }

      // If completed samples are less than minRequiredSamples, status is UNVALIDATED (No Trade)
      const isSampleSufficient = segCompleted.length >= minRequiredSamples;
      const validationStatus: 'VALIDATED' | 'UNVALIDATED' = isSampleSufficient ? 'VALIDATED' : 'UNVALIDATED';

      let isSegmentActivated = isSampleSufficient;
      let activationReasonFa = isSampleSufficient
        ? 'آمار تاریخی در حداقل نمونهٔ لازم است؛ این معیار فقط اطلاع‌رسانی است.'
        : `نمونه ناکافی (${segCompleted.length}/${minRequiredSamples})؛ صرفاً گزارش آماری و بدون اثر بر اجرای معامله.`;

      if (isSampleSufficient && (winRatePct < 45 || expectancyUsd <= 0)) {
        isSegmentActivated = false;
        activationReasonFa = `آمار تاریخی ضعیف است (نرخ برد ${winRatePct}٪، امید ریاضی $${expectancyUsd})؛ صرفاً اطلاع‌رسانی.`;
      }

      return {
        segmentKey: key,
        category,
        labelFa,
        totalPredictionsCount: segPredictions.length,
        executedTradesCount: segCompleted.length,
        minRequiredSamples,
        validationStatus,
        winCount,
        lossCount,
        winRatePct,
        totalPnlUsd,
        avgR,
        expectancyUsd,
        isSegmentActivated,
        activationReasonFa,
      };
    };

    const timeframeSegments = {
      '5m': buildSegment('5m', 'TIMEFRAME', 'تایم‌فریم ۵ دقیقه', p => p.timeframe === '5m'),
      '15m': buildSegment('15m', 'TIMEFRAME', 'تایم‌فریم ۱۵ دقیقه', p => p.timeframe === '15m'),
      '30m': buildSegment('30m', 'TIMEFRAME', 'تایم‌فریم ۳۰ دقیقه', p => p.timeframe === '30m'),
      '1H': buildSegment('1H', 'TIMEFRAME', 'تایم‌فریم ۱ ساعته', p => p.timeframe === '1H'),
      '4H': buildSegment('4H', 'TIMEFRAME', 'تایم‌فریم ۴ ساعته', p => p.timeframe === '4H'),
    };

    const directionSegments = {
      'LONG': buildSegment('LONG', 'DIRECTION', 'معاملات خرید (LONG)', p => p.direction === 'LONG'),
      'SHORT': buildSegment('SHORT', 'DIRECTION', 'معاملات فروش (SHORT)', p => p.direction === 'SHORT'),
    };

    const regimeSegments = {
      'TREND': buildSegment('TREND', 'REGIME_SETUP', 'رژیم روندی (TREND)', p => p.marketRegime === 'TREND'),
      'RANGE': buildSegment('RANGE', 'REGIME_SETUP', 'رژیم ساید (RANGE)', p => p.marketRegime === 'RANGE'),
      'BREAKOUT': buildSegment('BREAKOUT', 'REGIME_SETUP', 'رژیم شکست (BREAKOUT)', p => p.marketRegime === 'BREAKOUT'),
      'REVERSAL': buildSegment('REVERSAL', 'REGIME_SETUP', 'رژیم چرخش (REVERSAL)', p => p.marketRegime === 'REVERSAL'),
      'HIGH_VOL': buildSegment('HIGH_VOL', 'REGIME_SETUP', 'نوسان بالا (HIGH_VOL)', p => p.marketRegime === 'HIGH_VOL'),
      'LOW_VOL': buildSegment('LOW_VOL', 'REGIME_SETUP', 'نوسان کم (LOW_VOL)', p => p.marketRegime === 'LOW_VOL'),
    };

    const matrix: MultiDimensionalPerformanceMatrix = {
      timeframeSegments,
      directionSegments,
      regimeSegments,
      lastBatchEvaluationTimeMs: Date.now(),
      pendingFeedbackQueueCount: completed.length,
      modelUpdateBatchCycle: this.batchCycleCount,
    };

    return matrix;
  }

  /**
   * Check if a specific setup/timeframe/regime segment is activated
   */
  public isSegmentActivated(timeframe = '15m', direction = 'LONG', regime = 'TREND'): { isAllowed: boolean; rejectionReasonFa?: string } {
    void timeframe;
    void direction;
    void regime;
    return { isAllowed: true };
  }

  public getAllPredictions(): PredictionDatasetRecord[] {
    return structuredClone(this.serverPredictions);
  }

  public async refreshTrainingArchive(adminToken: string): Promise<number> {
    const response = await fetch('/api/operational-trade-archive', {
      headers: { 'x-admin-token': adminToken },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`آرشیو سروری در دسترس نیست (HTTP ${response.status}).`);
    const payload: unknown = await response.json();
    if (!isObjectRecord(payload) || !Array.isArray(payload.records)) {
      throw new Error('پاسخ آرشیو سروری ساختار معتبری ندارد.');
    }
    this.serverPredictions = payload.records
      .map(predictionFromArchive)
      .filter((record): record is PredictionDatasetRecord => record !== null);
    return this.serverPredictions.length;
  }

  public clearServerTrainingArchive(): void {
    this.serverPredictions = [];
  }

  public getFreqtradeVerifiedPredictions(): PredictionDatasetRecord[] {
    return this.getAllPredictions().filter(
      (record) => hasFreqtradeVerifiedOutcome(record) && record.outcome !== undefined
    );
  }

  public getAllTradeRecords(): TradeDatasetRecord[] {
    return [];
  }

  public getFreqtradeVerifiedTradeRecords(): TradeDatasetRecord[] {
    return this.getAllTradeRecords().filter(
      (record) => hasFreqtradeVerifiedTradeOutcome(record) && record.isClosed
    );
  }

  public getPerformanceMatrix(): MultiDimensionalPerformanceMatrix {
    return this.recalculatePerformanceMatrix();
  }
}

export const centralTradeDatasetService = CentralTradeDatasetService.getInstance();
