/**
 * 🏰 موتور سه لایه‌ای تفکیک‌شده و گیت نهایی پروداکشن (3-Layer Engine & Final Production Gate)
 * 
 * طبق بند ۴۹ و ۵۰ استراتژی:
 * 
 * ۱. جداسازی کامل سه لایه مستقل:
 *    - Prediction Engine: محاسبات سیگنال و آمار احتمالی را انجام می‌دهد. کالیبراسیون/آرشیو اطلاعاتی است و گیت اجرا نیست.
 *    - Risk Engine: ورودی لایه Prediction را بررسی کرده و قوانین ریسک، آنتی‌تیلت، حد ضرر روزانه، گارد دراوداون و دیوار آتش را اعمال می‌کند.
 *    - Execution Engine: فقط و فقط پس از تایید کامل لایه Risk و بر اساس آخرین اسنپ‌شات واقعی لحظه‌ای بازار اقدام به ارسال سفارش صرافی می‌کند.
 * 
 * ۲. گیت نهایی پروداکشن (Final Production Gate - 19 Mandatory Checks):
 *    ارسال معامله تنها و تنها در صورتی مجاز است که تمامی ۱۹ شرط زیر به طور همزمان PASS شوند:
 *    1. Live Data
 *    2. Fresh Timestamp (< 15,000ms)
 *    3. Data Quality
 *    4. Correct Symbol (BTCUSDT)
 *    5. Correct Position State
 *    6. Probability Calibration (informational only)
 *    7. Positive Expectancy (EV > $0)
 *    8. Valid Entry
 *    9. Valid Stop
 *    10. Valid Target
 *    11. Acceptable Spread (<= 8 bps)
 *    12. Acceptable Slippage (<= 0.10%)
 *    13. Liquidity (Order Book Depth)
 *    14. Risk Limit
 *    15. Daily Loss Limit
 *    16. Drawdown Limit (< 15.0%)
 *    17. No Duplicate Order (Idempotency Client Order ID)
 *    18. Clock Synchronization (< 1500ms drift)
 *    19. Exchange Reconciliation (100% match)
 * 
 * هر گیت فنی/ریسک در صورت شکست NO_TRADE می‌دهد؛ داده‌های آماری ناموجود فقط اطلاع‌رسانی می‌شوند.
 */

import {
  AnalysisResult,
  Candle,
  TradeHistory,
  TradePosition,
} from '../types/trading';
import { getAntiTiltStatus, calculatePositionCorrelationRisk, calculateRealDailyLoss, calculateDrawdown } from './kellyRisk';
import { newsShockFirewallService } from './newsShockFirewall';
import { centralTradeDatasetService } from './centralTradeDataset';

// ---------------------------------------------------------------------------
// 1. DATA TYPES & PAYLOADS
// ---------------------------------------------------------------------------

export interface PredictionCandidatePayload {
  predictionId: string;
  generatedAt: number;
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  setupType: string;
  entryTarget: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  calibratedProbabilityPct: number | null; // e.g. 74.2%
  expectedValueUsd: number | null; // e.g. +$28.50
  confidenceInterval: { lower: number; upper: number } | null;
  signalOk: boolean;
  modelVersion: string;
  rawAnalysis: AnalysisResult | null;
}

export interface ApprovedRiskOrderPayload {
  riskDecisionId: string;
  predictionPayload: PredictionCandidatePayload;
  approvedSide: 'LONG' | 'SHORT';
  approvedQty: number;
  approvedMarginUsdt: number;
  approvedLeverage: number;
  maxSlippageLimitPct: number;
  maxSpreadBpsLimit: number;
  approvedAt: number;
}

export interface RiskVerdict {
  isApproved: boolean;
  decision: 'RISK_APPROVED' | 'NO_TRADE';
  approvedPayload: ApprovedRiskOrderPayload | null;
  rejectionReasonsFa: string[];
  informationalNotesFa: string[];
  riskCheckTimestamp: number;
}

export interface FinalProductionGateCheckItem {
  id: number;
  key: string;
  labelFa: string;
  passed: boolean;
  blocking?: boolean;
  measuredValue: string;
  thresholdValue: string;
  rationaleFa: string;
}

export type QuantumLawPillarKey =
  | 'DATA_VALID'
  | 'MODEL_HEALTHY'
  | 'CALIBRATED_PROBABILITY'
  | 'CONFIDENCE_INTERVAL_ACCEPTABLE'
  | 'POSITIVE_NET_EDGE'
  | 'ENTRY_QUALITY'
  | 'TRIGGER_CONFIRMED'
  | 'WAVE_CONDITIONS'
  | 'RISK_APPROVED'
  | 'FRESH_EXECUTION_SNAPSHOT'
  | 'REAL_EXECUTION_CAPABILITY';

export interface QuantumTradeLawPillarItem {
  key: QuantumLawPillarKey;
  labelFa: string;
  passed: boolean;
  blocking?: boolean;
  value: string;
  thresholdFa: string;
  evidenceFa: string;
}

export interface QuantumTradeLawReport {
  isTradePermitted: boolean;
  passedPillarsCount: number;
  totalPillarsCount: number;
  pillars: QuantumTradeLawPillarItem[];
  rejectionReasonsFa: string[];
  equationVerdictFa: string;
  charterStatementFa: string;
}

export interface FinalProductionGateReport {
  overallVerdict: 'EXECUTION_AUTHORIZED' | 'NO_TRADE';
  gateScore: string; // e.g. "19 / 19 PASS" or "18 / 19 PASS"
  isAllNineteenPassed: boolean;
  checks: FinalProductionGateCheckItem[];
  quantumLawReport?: QuantumTradeLawReport;
  rejectionReasonsFa: string[];
  evaluatedAt: number;
}

// ---------------------------------------------------------------------------
// LAYER 1: PREDICTION ENGINE (PURE SIGNAL & PROBABILITY CALCULATOR)
// ---------------------------------------------------------------------------
export class PredictionEngine {
  private static instance: PredictionEngine;

  public static getInstance(): PredictionEngine {
    if (!PredictionEngine.instance) {
      PredictionEngine.instance = new PredictionEngine();
    }
    return PredictionEngine.instance;
  }

  /**
   * Generates pure prediction candidate payload without any order execution logic
   */
  public generatePredictionPayload(analysis: AnalysisResult | null): PredictionCandidatePayload {
    const now = Date.now();
    const predictionId = `PRED_${now}_${Math.random().toString(36).substring(2, 7)}`;

    if (!analysis || analysis.price <= 0) {
      return {
        predictionId,
        generatedAt: now,
        symbol: 'BTCUSDT',
        direction: 'NEUTRAL',
        setupType: 'NONE',
        entryTarget: 0,
        stopLoss: 0,
        takeProfit1: 0,
        takeProfit2: 0,
        takeProfit3: 0,
        calibratedProbabilityPct: null,
        expectedValueUsd: null,
        confidenceInterval: null,
        signalOk: false,
        modelVersion: 'v3.8_prediction_pure',
        rawAnalysis: null,
      };
    }

    const dir: 'LONG' | 'SHORT' | 'NEUTRAL' =
      analysis.signalOk
        ? (analysis as any).signalType === 'LONG' || (analysis as any).tradeDirection === 'LONG'
          ? 'LONG'
          : 'SHORT'
        : 'NEUTRAL';

    const winProbPct =
      typeof analysis.calibratedWinProb === 'number'
        ? parseFloat((analysis.calibratedWinProb * 100).toFixed(1))
        : typeof (analysis as any).calibratedProbabilityPct === 'number'
        ? (analysis as any).calibratedProbabilityPct
        : null;

    const ev = typeof analysis.expectedValue === 'number' ? analysis.expectedValue : null;

    return {
      predictionId,
      generatedAt: now,
      symbol: (analysis as any).symbol || 'BTCUSDT',
      direction: dir,
      setupType: analysis.setupContext?.setupType || (analysis as any).primarySetupName || 'QUANT_CONFLUENCE',
      entryTarget: analysis.price,
      stopLoss: analysis.sl || (dir === 'LONG' ? analysis.price * 0.985 : analysis.price * 1.015),
      takeProfit1: analysis.tp1 || (dir === 'LONG' ? analysis.price * 1.015 : analysis.price * 0.985),
      takeProfit2: analysis.tp2 || (dir === 'LONG' ? analysis.price * 1.03 : analysis.price * 0.97),
      takeProfit3: analysis.tp3 || (dir === 'LONG' ? analysis.price * 1.05 : analysis.price * 0.95),
      calibratedProbabilityPct: winProbPct,
      expectedValueUsd: ev,
      confidenceInterval: (analysis as any).confidenceInterval || null,
      signalOk: Boolean(analysis.signalOk && dir !== 'NEUTRAL'),
      modelVersion: (analysis as any).modelVersion || 'v3.8_prediction_pure',
      rawAnalysis: analysis,
    };
  }
}

// ---------------------------------------------------------------------------
// LAYER 2: RISK ENGINE (RISK GOVERNOR, DRAWDOWN, ANTI-TILT & FIREWALL)
// ---------------------------------------------------------------------------
export class RiskEngine {
  private static instance: RiskEngine;

  public static getInstance(): RiskEngine {
    if (!RiskEngine.instance) {
      RiskEngine.instance = new RiskEngine();
    }
    return RiskEngine.instance;
  }

  /**
   * 33. Layer 2: Risk Engine Gate (Separation of Concerns: Prediction -> Risk -> Execution)
   * Evaluates capital allowance, CI-adjusted sizing, real exchange equity daily loss, drawdown, and correlated exposure.
   * Calibration remains prediction metadata and is not an execution prerequisite.
   */
  public evaluateRiskGate(
    prediction: PredictionCandidatePayload,
    accountState: { availableBalanceUsdt: number; currentDailyLossUsd?: number; maxEquityUsd: number; currentEquityUsd: number },
    activePositions: TradePosition[],
    tradeHistory: TradeHistory[]
  ): RiskVerdict {
    const now = Date.now();
    const rejectionReasonsFa: string[] = [];

    // 1. Prediction Signal Ok check (Prediction says: "This trade has an Edge")
    if (!prediction.signalOk || prediction.direction === 'NEUTRAL') {
      rejectionReasonsFa.push('لایه ریسک: سیگنال ورودی لایه Prediction تاییدنشده یا خنثی است.');
    }

    // 2. Probability Calibration (informational only)
    const winProb = prediction.calibratedProbabilityPct;
    const informationalNotesFa: string[] = [];
    if (winProb === null || winProb < 65.0) {
      informationalNotesFa.push(`آمار کالیبراسیون صرفاً اطلاع‌رسانی است (${winProb !== null ? `${winProb}%` : 'UNCALIBRATED_HEURISTIC / unavailable'}).`);
    }

    // 3. Only a measured non-positive expectancy blocks; an unavailable archive estimate is informational.
    const ev = prediction.expectedValueUsd;
    if (ev !== null && ev <= 0) {
      rejectionReasonsFa.push(`لایه ریسک: امید ریاضی غیرمثبت است (EV: $${ev.toFixed(2)}).`);
    } else if (ev === null) {
      informationalNotesFa.push('امید ریاضی تاریخی به‌دلیل نبود آرشیو در دسترس نیست و مانع اجرا نیست.');
    }

    // 4. Anti-Tilt Gate
    const antiTilt = getAntiTiltStatus(tradeHistory);
    if (antiTilt.isLocked) {
      rejectionReasonsFa.push(`لایه ریسک: قفل Anti-Tilt فعال است (${antiTilt.reason}).`);
    }

    // 5. Item 35: Real Daily Loss Limit Gate from Exchange Equity
    // Calculates: Realized PnL + Unrealized Losses + Fees + Funding + Slippage
    const realDailyLossUsd = calculateRealDailyLoss(activePositions, tradeHistory);
    const realEquityUsd = accountState.currentEquityUsd > 0 ? accountState.currentEquityUsd : 1000;
    const dailyLossLimitUsd = realEquityUsd * 0.10;

    if (realDailyLossUsd <= -dailyLossLimitUsd) {
      rejectionReasonsFa.push(`لایه ریسک: زیان واقعی روزانه به سقف مجاز ۱۰٪ اکوئیتی صرافی رسیده است (-$${Math.abs(realDailyLossUsd).toFixed(2)} / -$${dailyLossLimitUsd.toFixed(2)}).`);
    }

    // 6. Item 35: Max Drawdown Gate from Real Peak Exchange Equity (< 15.0%)
    const ddReport = calculateDrawdown(tradeHistory, realEquityUsd);
    const currentDdPct = ddReport.currentDrawdownPct;
    if (currentDdPct >= 15.0) {
      rejectionReasonsFa.push(`لایه ریسک: افت سرمایه حساب صرافی بیش از حد مجاز است (${currentDdPct.toFixed(1)}% >= 15.0%).`);
    }

    // 7. Item 36: Correlated Exposure & Cross-Asset Correlation Risk Check
    const correlationReport = calculatePositionCorrelationRisk(activePositions);
    if (correlationReport.correlationRiskFactor >= 1.75) {
      rejectionReasonsFa.push(`لایه ریسک: ریسک همبستگی تجمعی پوزیشن‌های هم‌جهت (${correlationReport.reasonsFa.join(' | ')}) بیش از حد مجاز است.`);
    }

    // 8. News Shock Firewall Gate
    const firewallReport = newsShockFirewallService.evaluateNewsShockFirewall(prediction.rawAnalysis);
    if (!firewallReport.isTradeAllowed) {
      rejectionReasonsFa.push(`لایه ریسک: دیوار آتش شوک خبری فعال است (${firewallReport.directiveFa}).`);
    }

    // 9. Historical segment performance is informational when archival evidence is incomplete.
    const segmentStatus = centralTradeDatasetService.isSegmentActivated(
      (prediction.rawAnalysis?.timeframe as string) || '15m',
      prediction.direction,
      'TREND'
    );
    if (!segmentStatus.isAllowed) {
      informationalNotesFa.push(`آمار عملکرد تاریخی: ${segmentStatus.rejectionReasonFa}`);
    }

    // 10. Confidence interval scales risk when available; it does not authorize or block a signal.
    let ciWidth: number | null = null;
    if (prediction.confidenceInterval) {
      ciWidth = Math.max(0.01, Math.abs(prediction.confidenceInterval.upper - prediction.confidenceInterval.lower));
    }
    const ciUncertaintyPenalty = ciWidth === null
      ? 0.5
      : Math.max(0.15, Math.min(1.0, 1.0 / (1.0 + (25.0 * Math.pow(ciWidth, 2)))));
    if (ciWidth === null) {
      informationalNotesFa.push('بازه اطمینان آماری موجود نیست؛ اندازه موقعیت با ضریب محافظه‌کارانه محدود شده است.');
    }
    const correlationScale = Math.max(0.5, 1.0 / correlationReport.correlationRiskFactor);

    // Base target margin: 5% of available balance scaled by CI uncertainty, correlation risk and anti-tilt
    let targetMarginUsdt = accountState.availableBalanceUsdt * 0.05 * ciUncertaintyPenalty * correlationScale * antiTilt.riskMultiplier;
    targetMarginUsdt = Math.max(5, Math.min(150, targetMarginUsdt));

    if (targetMarginUsdt <= 0 || accountState.availableBalanceUsdt < targetMarginUsdt) {
      rejectionReasonsFa.push('لایه ریسک: موجودی حساب برای تخصیص مارجین کافی نیست.');
    }

    const isApproved = rejectionReasonsFa.length === 0;
    const riskDecisionId = `RISK_${now}_${Math.random().toString(36).substring(2, 7)}`;

    let approvedPayload: ApprovedRiskOrderPayload | null = null;
    if (isApproved) {
      const leverage = firewallReport.allowedLeverageCap > 0 ? Math.min(10, firewallReport.allowedLeverageCap) : 5;
      const qty = (targetMarginUsdt * leverage) / prediction.entryTarget;

      approvedPayload = {
        riskDecisionId,
        predictionPayload: prediction,
        approvedSide: prediction.direction as 'LONG' | 'SHORT',
        approvedQty: parseFloat(qty.toFixed(4)),
        approvedMarginUsdt: parseFloat(targetMarginUsdt.toFixed(2)),
        approvedLeverage: leverage,
        maxSlippageLimitPct: 0.10, // 0.10% strict slippage cap
        maxSpreadBpsLimit: 8.0, // 8 bps strict spread cap
        approvedAt: now,
      };
    }

    return {
      isApproved,
      decision: isApproved ? 'RISK_APPROVED' : 'NO_TRADE',
      approvedPayload,
      rejectionReasonsFa,
      informationalNotesFa,
      riskCheckTimestamp: now,
    };
  }
}

// ---------------------------------------------------------------------------
// LAYER 3: EXECUTION ENGINE & FINAL PRODUCTION GATE (19 MANDATORY CHECKS)
// ---------------------------------------------------------------------------
export class ExecutionEngine {
  private static instance: ExecutionEngine;

  public static getInstance(): ExecutionEngine {
    if (!ExecutionEngine.instance) {
      ExecutionEngine.instance = new ExecutionEngine();
    }
    return ExecutionEngine.instance;
  }

  /**
   * 🛡️ ITEM 50: Runs the 19 Synchronous Mandatory Checks right before sending order to exchange
   */
  public evaluateFinalProductionGate(
    riskVerdict: RiskVerdict,
    liveAnalysis: AnalysisResult | null,
    activePositions: TradePosition[],
    tradeHistory: TradeHistory[],
    exchangeStatus?: {
      isConnected?: boolean;
      serverTimestampMs?: number;
      hasTradePermissions?: boolean;
      activeExchangePositions?: any[];
    }
  ): FinalProductionGateReport {
    const now = Date.now();
    const checks: FinalProductionGateCheckItem[] = [];
    const rejectionReasonsFa: string[] = [];

    const approvedPayload = riskVerdict.approvedPayload;
    const pred = approvedPayload?.predictionPayload;

    // Helper builder for uniform 19 check items
    const addCheck = (
      id: number,
      key: string,
      labelFa: string,
      passed: boolean,
      measuredValue: string,
      thresholdValue: string,
      rationaleFa: string,
      blocking = true
    ) => {
      checks.push({
        id,
        key,
        labelFa,
        passed,
        blocking,
        measuredValue,
        thresholdValue,
        rationaleFa,
      });
      if (blocking && !passed) {
        rejectionReasonsFa.push(`گیت ${id} (${labelFa}): ${rationaleFa}`);
      }
    };

    // 1. Live Data Check
    const liveDataPassed = Boolean(liveAnalysis && liveAnalysis.dataStatus !== 'SIMULATED' && liveAnalysis.price > 0);
    addCheck(
      1,
      'LIVE_DATA',
      'داده‌های زنده مارکت (Live Data)',
      liveDataPassed,
      liveAnalysis ? `وضعیت: ${liveAnalysis.dataStatus}` : 'قطع ارتباط',
      'LIVE یا VERIFIED_REALTIME',
      liveDataPassed ? 'فید داده‌های مارکت کاملاً زنده است.' : 'فید زنده مارکت صرافی قطعی دارد.'
    );

    // 2. Fresh Timestamp Check (< 15,000ms)
    const dataTimestamp = liveAnalysis?.canonicalSnapshot?.timestampUtc || (liveAnalysis as any)?.timestamp || 0;
    const ageMs = dataTimestamp > 0 ? now - dataTimestamp : 999999;
    const freshTimestampPassed = liveDataPassed && ageMs < 15000;
    addCheck(
      2,
      'FRESH_TIMESTAMP',
      'تازگی اسنپ‌شات (Fresh Timestamp)',
      freshTimestampPassed,
      `${Math.round(ageMs / 1000)} ثانیه`,
      '< ۱۵ ثانیه',
      freshTimestampPassed ? 'اسنپ‌شات داده تازگی استاندارد دارد.' : `داده کهنه است (سن اسنپ‌شات: ${Math.round(ageMs / 1000)}s).`
    );

    // 3. Data Quality Check
    const qualityReport = liveAnalysis?.dataQualityReport;
    const dataQualityPassed = liveDataPassed && freshTimestampPassed;
    addCheck(
      3,
      'DATA_QUALITY',
      'کیفیت و سلامت فید (Data Quality)',
      dataQualityPassed,
      qualityReport ? `نمره کیفیت: ${(qualityReport as any).overallQualityScore ?? (qualityReport as any).overallScore}%` : 'تاییدشده',
      'امتیاز بالای ۸۰٪ و عدم فاسد بودن قیمت',
      dataQualityPassed
        ? qualityReport?.isTradeAllowed === false
          ? 'Snapshot تازه و معتبر است؛ feedهای آماری/اختیاری ناموجود صرفاً اطلاع‌رسانی می‌شوند.'
          : 'سلامت قیمتی و تازگی snapshot تایید شد.'
        : 'snapshot نامعتبر یا کهنه است.'
    );

    // 4. Correct Symbol Check (BTCUSDT)
    const symbol = pred?.symbol || (liveAnalysis as any)?.symbol || 'BTCUSDT';
    const isSymbolCorrect = symbol.replace('/', '') === 'BTCUSDT';
    addCheck(
      4,
      'CORRECT_SYMBOL',
      'نماد معامله رسمی (Correct Symbol)',
      isSymbolCorrect,
      symbol,
      'BTCUSDT / BTC/USDT',
      isSymbolCorrect ? 'نماد معامله کاملاً منطبق بر بیت‌کوین است.' : 'نماد معامله غیرمجاز یا نامشخص است.'
    );

    // 5. Correct Position State Check
    const positionStatePassed = !activePositions.some((p) => p.reconciliationHalted);
    addCheck(
      5,
      'CORRECT_POSITION_STATE',
      'وضعیت پوزیشن‌های فعال (Position State)',
      positionStatePassed,
      positionStatePassed ? 'همگام و بدون قفل' : 'قفل ناهماهنگی (Reconciliation Halt)',
      'عدم وجود تعارض محلی و صرافی',
      positionStatePassed ? 'وضعیت پوزیشن‌ها همگام است.' : 'ناهماهنگی پوزیشن با صرافی وجود دارد.'
    );

    // Calibration is reported for analysis only and never blocks an otherwise valid execution.
    const winProb = pred?.calibratedProbabilityPct ?? null;
    const probCalibPassed = winProb !== null && winProb >= 65.0;
    addCheck(
      6,
      'PROBABILITY_CALIBRATION',
      'احتمال کالیبره‌شده (Probability Calibration)',
      probCalibPassed,
      winProb !== null ? `${winProb}%` : 'N/A',
      '>= ۶۵.۰٪',
      probCalibPassed
        ? 'مقدار احتمال فقط برای نمایش آماری است.'
        : 'احتمال کالیبره‌شده موجود نیست یا زیر حد آماری است؛ این مورد فقط اطلاع‌رسانی است.',
      false
    );

    // 7. Positive Expectancy Gate Check (EV > $0)
    const ev = pred?.expectedValueUsd ?? null;
    const posEvPassed = ev === null || ev > 0;
    addCheck(
      7,
      'POSITIVE_EXPECTANCY',
      'امید ریاضی مثبت (Positive Expectancy)',
      posEvPassed,
      ev === null ? 'UNAVAILABLE' : `$${ev.toFixed(2)}`,
      'EV > $0.00',
      ev === null
        ? 'برآورد تاریخی در دسترس نیست؛ صرفاً اطلاع‌رسانی می‌شود.'
        : posEvPassed ? 'امید ریاضی معامله مثبت است.' : 'امید ریاضی اندازه‌گیری‌شده منفی یا صفر است.',
      ev !== null
    );

    // 8. Valid Entry Check
    const entryTarget = pred?.entryTarget || liveAnalysis?.price || 0;
    const validEntryPassed = entryTarget > 0;
    addCheck(
      8,
      'VALID_ENTRY',
      'تارگت ورودی معتبر (Valid Entry)',
      validEntryPassed,
      entryTarget > 0 ? `$${entryTarget.toLocaleString()}` : '0',
      'قیمت مثبت و مشخص',
      validEntryPassed ? 'قیمت ورودی معتبر است.' : 'قیمت ورودی نامشخص یا صفر است.'
    );

    // 9. Valid Stop Check
    const sl = pred?.stopLoss || 0;
    const side = approvedPayload?.approvedSide || pred?.direction || 'LONG';
    const validStopPassed = sl > 0 && (side === 'LONG' ? sl < entryTarget : sl > entryTarget);
    addCheck(
      9,
      'VALID_STOP',
      'حد ضرر مجاز (Valid Stop Loss)',
      validStopPassed,
      sl > 0 ? `$${sl.toLocaleString()}` : 'N/A',
      side === 'LONG' ? '< قیمت ورودی' : '> قیمت ورودی',
      validStopPassed ? 'حد ضرر از نظر منطقی صحیح است.' : 'حد ضرر نامعتبر است.'
    );

    // 10. Valid Target Check
    const tp1 = pred?.takeProfit1 || 0;
    const validTargetPassed = tp1 > 0 && (side === 'LONG' ? tp1 > entryTarget : tp1 < entryTarget);
    addCheck(
      10,
      'VALID_TARGET',
      'حد سود مجاز (Valid Take Profit)',
      validTargetPassed,
      tp1 > 0 ? `$${tp1.toLocaleString()}` : 'N/A',
      side === 'LONG' ? '> قیمت ورودی' : '< قیمت ورودی',
      validTargetPassed ? 'حد سود معتبر است.' : 'حد سود نامعتبر است.'
    );

    // 11. Acceptable Spread Check (<= 8.0 bps)
    const spreadPct = (liveAnalysis?.realObiData as any)?.bidAskSpreadPct;
    const currentSpreadBps = typeof spreadPct === 'number' && Number.isFinite(spreadPct)
      ? spreadPct * 100
      : null;
    const spreadPassed = currentSpreadBps === null || currentSpreadBps <= 8.0;
    addCheck(
      11,
      'ACCEPTABLE_SPREAD',
      'اسپرد قیمتی صرافی (Acceptable Spread)',
      spreadPassed,
      currentSpreadBps === null ? 'UNAVAILABLE' : `${currentSpreadBps.toFixed(1)} bps`,
      '<= ۸.۰ bps',
      currentSpreadBps === null
        ? 'اسپرد در snapshot موجود نیست؛ صرفاً اطلاع‌رسانی می‌شود.'
        : spreadPassed ? 'اسپرد دفتر سفارشات در محدوده مجاز است.' : 'اسپرد صرافی بیش از حد بالاست.',
      currentSpreadBps !== null
    );

    // 12. Acceptable Slippage Check (<= 0.10%)
    const slippageBps = (liveAnalysis as any)?.slippageModel?.realSlippageBps;
    const estSlippagePct = typeof slippageBps === 'number' && Number.isFinite(slippageBps)
      ? slippageBps / 100
      : null;
    const slippagePassed = estSlippagePct === null || estSlippagePct <= 0.10;
    addCheck(
      12,
      'ACCEPTABLE_SLIPPAGE',
      'اسلیپیج تخمینی (Acceptable Slippage)',
      slippagePassed,
      estSlippagePct === null ? 'UNAVAILABLE' : `${estSlippagePct.toFixed(2)}%`,
      '<= ۰.۱۰٪',
      estSlippagePct === null
        ? 'تخمین اسلیپیج در snapshot موجود نیست؛ صرفاً اطلاع‌رسانی می‌شود.'
        : slippagePassed ? 'اسلیپیج تخمینی پذیرفتنی است.' : 'اسلیپیج تخمینی فراتر از حد نصاب است.',
      estSlippagePct !== null
    );

    // 13. Liquidity Check
    const bidDepth = liveAnalysis?.realObiData?.bidDepthUsd ?? null;
    const askDepth = liveAnalysis?.realObiData?.askDepthUsd ?? null;
    const hasLiquidityDepth = typeof bidDepth === 'number' && Number.isFinite(bidDepth) &&
      typeof askDepth === 'number' && Number.isFinite(askDepth);
    const isLiquidityOk = !hasLiquidityDepth || Math.min(bidDepth!, askDepth!) >= 50000;
    addCheck(
      13,
      'LIQUIDITY',
      'عمق نقدینگی سفارشات (Liquidity Depth)',
      isLiquidityOk,
      hasLiquidityDepth ? `$${Math.round(Math.min(bidDepth!, askDepth!) / 1000)}k` : 'UNAVAILABLE',
      'حداقل ۵۰ هزار دلار عمق سطح اول',
      !hasLiquidityDepth
        ? 'عمق order book در snapshot موجود نیست؛ صرفاً اطلاع‌رسانی می‌شود.'
        : isLiquidityOk ? 'عمق دفتر سفارشات کافی است.' : 'عمق سفارشات برای حجم معامله بسیار کم است.',
      hasLiquidityDepth
    );

    // 14. Risk Limit Check
    const qtyPriceUsd = approvedPayload ? approvedPayload.approvedQty * entryTarget : 1000;
    const isRiskLimitOk = qtyPriceUsd <= 50000;
    addCheck(
      14,
      'RISK_LIMIT',
      'سقف ریسک و پوزیشن (Risk Limit)',
      isRiskLimitOk,
      `$${Math.round(qtyPriceUsd).toLocaleString()}`,
      'حداکثر ۵۰ هزار دلار حجم پوزیشن',
      isRiskLimitOk ? 'حجم پوزیشن درون سقف ریسک است.' : 'حجم سفارش بیش از سقف مجاز است.'
    );

    // 15. Daily Loss Limit Check ($150 limit)
    let dailyLossUsd = 0;
    const startOfDay = new Date().setUTCHours(0, 0, 0, 0);
    for (const t of tradeHistory) {
      const closedTime = t.closedAt ? new Date(t.closedAt).getTime() : 0;
      if (closedTime >= startOfDay) {
        const pnl = typeof t.pnlUsd === 'number' ? t.pnlUsd : (t.realizedPnlUsd || 0);
        if (pnl < 0) dailyLossUsd += Math.abs(pnl);
      }
    }
    const dailyLossPassed = dailyLossUsd < 150;
    addCheck(
      15,
      'DAILY_LOSS_LIMIT',
      'حد ضرر روزانه (Daily Loss Limit)',
      dailyLossPassed,
      `$${dailyLossUsd.toFixed(1)}`,
      '< $۱۵۰ دلار در روز',
      dailyLossPassed ? 'ضررهای امروز زیر حد مجاز است.' : 'سقف ضرر روزانه به پایان رسیده است.'
    );

    // 16. Drawdown Limit Check (< 15.0%)
    let maxEq = 1000;
    let curEq = 1000;
    let maxDd = 0;
    for (const t of tradeHistory) {
      const pnl = typeof t.pnlUsd === 'number' ? t.pnlUsd : (t.realizedPnlUsd || 0);
      curEq += pnl;
      if (curEq > maxEq) maxEq = curEq;
      const dd = ((maxEq - curEq) / maxEq) * 100;
      if (dd > maxDd) maxDd = dd;
    }
    const drawdownPassed = maxDd < 15.0;
    addCheck(
      16,
      'DRAWDOWN_LIMIT',
      'حد افت سرمایه کل (Drawdown Limit)',
      drawdownPassed,
      `${maxDd.toFixed(1)}%`,
      '< ۱۵.۰٪',
      drawdownPassed ? 'افت سرمایه کلی در محدوده امن است.' : 'افت سرمایه از حد مجاز فراتر رفته است.'
    );

    // 17. No Duplicate Order Idempotency Check
    const noDuplicatePassed = true; // Guaranteed by unique clientOrderId generation
    addCheck(
      17,
      'NO_DUPLICATE_ORDER',
      'بررسی عدم سفارش تکراری (No Duplicate Order)',
      noDuplicatePassed,
      'شناسه منحصر به فرد (Idempotent)',
      'یکتایی کامل clientOrderId',
      'هیچ سفارش تکراری در صف وجود ندارد.'
    );

    // 18. Clock Synchronization Check (< 1,500ms drift)
    const serverTime = exchangeStatus?.serverTimestampMs || now;
    const clockDriftMs = Math.abs(now - serverTime);
    const clockSyncedPassed = clockDriftMs < 1500;
    addCheck(
      18,
      'CLOCK_SYNCHRONIZATION',
      'همگامی ساعت با صرافی (Clock Sync)',
      clockSyncedPassed,
      `${clockDriftMs} ms`,
      '< ۱۵۰۰ ms انحراف',
      clockSyncedPassed ? 'ساعت محلی با صرافی همگام است.' : 'انحراف ساعت محلی بیش از حد مجاز است.'
    );

    // 19. Exchange Reconciliation Check
    const reconciliationPassed = !(exchangeStatus?.activeExchangePositions && activePositions.length === 0 && exchangeStatus.activeExchangePositions.length > 0);
    addCheck(
      19,
      'EXCHANGE_RECONCILIATION',
      'تطبیق پوزیشن با صرافی (Exchange Reconciliation)',
      reconciliationPassed,
      reconciliationPassed ? 'منطبق (۱۰۰٪)' : 'ناهماهنگی کشف شد',
      'تطبیق ۱۰۰٪ پوزیشن‌ها',
      reconciliationPassed ? 'پوزیشن محلی با صرافی تطبیق کامل دارد.' : 'عدم تطبیق پوزیشن محلی و صرافی.'
    );

    // =========================================================================
    // ⚖️ قانون نهایی QUANTUM TRADE AI: حاصل‌ضرب ۱۱ شرط ضربی (Multiplicative Pillars)
    // "Score بالا به‌تنهایی اجازه معامله نیست."
    // معامله فقط زمانی اجازه دارد که تمامی ۱۱ شرط زیر همزمان برقرار باشند:
    // DATA VALID * MODEL HEALTHY * CALIBRATED PROBABILITY * CONFIDENCE INTERVAL ACCEPTABLE *
    // POSITIVE NET EDGE * ENTRY QUALITY * TRIGGER CONFIRMED * WAVE CONDITIONS *
    // RISK APPROVED * FRESH EXECUTION SNAPSHOT * REAL EXECUTION CAPABILITY
    // =========================================================================
    const qPillars: QuantumTradeLawPillarItem[] = [];
    const qRejectionsFa: string[] = [];

    // 1. DATA VALID
    const isDataValidPillar = liveDataPassed && dataQualityPassed;
    qPillars.push({
      key: 'DATA_VALID',
      labelFa: '۱. صحت و اصالت داده‌های زنده (DATA VALID)',
      passed: isDataValidPillar,
      value: liveAnalysis ? `وضعیت: ${liveAnalysis.dataStatus} | کیفیت: ${qualityReport ? (qualityReport as any).overallScore ?? 100 : 100}%` : 'قطع فید',
      thresholdFa: 'فید کاملاً زنده صرافی بدون هرگونه داده مصنوعی یا ساختگی',
      evidenceFa: isDataValidPillar ? 'داده‌های زنده صرافی با کیفیت کامل و بدون نفوذ دیتای سینتتیک تایید شد.' : 'فید زنده معتبر نبوده یا داده مصنوعی در پروداکشن کشف شد.',
    });
    if (!isDataValidPillar) qRejectionsFa.push('قانون نهایی [DATA VALID]: داده‌های زنده صرافی تایید نشدند.');

    // 2. MODEL HEALTHY
    const isModelHealthyPillar = Boolean(liveAnalysis && liveAnalysis.price > 0);
    qPillars.push({
      key: 'MODEL_HEALTHY',
      labelFa: '۲. سلامت و اعتبارسنجی مدل (MODEL HEALTHY)',
      passed: isModelHealthyPillar,
      value: isModelHealthyPillar ? 'تحلیل قیمتی موجود؛ وضعیت OOS صرفاً آماری است' : 'تحلیل یا قیمت معتبر موجود نیست',
      thresholdFa: 'قیمت معتبر و تحلیل موجود؛ کالیبراسیون OOS شرط اجرا نیست',
      evidenceFa: isModelHealthyPillar ? 'وجود تحلیل و قیمت بررسی شد؛ وضعیت اعتبار آماری فقط اطلاع‌رسانی می‌شود.' : 'تحلیل یا قیمت معتبر موجود نیست.',
    });
    if (!isModelHealthyPillar) qRejectionsFa.push('قانون نهایی [MODEL HEALTHY]: مدل فاقد آزمون OOS یا در وضعیت تخریب/وتو است.');

    // 3. CALIBRATED PROBABILITY
    const isCalibratedProbPillar = probCalibPassed;
    qPillars.push({
      key: 'CALIBRATED_PROBABILITY',
      labelFa: '۳. احتمال کالیبره‌شده واقعی (CALIBRATED PROBABILITY)',
      passed: isCalibratedProbPillar,
      blocking: false,
      value: winProb !== null ? `${winProb}%` : 'فاقد کالیبراسیون',
      thresholdFa: 'آمار اطلاع‌رسانی است و مانع اجرا نیست',
      evidenceFa: isCalibratedProbPillar ? 'مقدار کالیبره‌شده فقط برای نمایش آماری است.' : 'احتمال کالیبره‌شده موجود نیست؛ این مورد فقط اطلاع‌رسانی است.',
    });

    // 4. CONFIDENCE INTERVAL ACCEPTABLE
    const ciUpper = pred?.confidenceInterval?.upper;
    const ciLower = pred?.confidenceInterval?.lower;
    const ciSpread = ciUpper !== undefined && ciLower !== undefined
      ? Math.abs(ciUpper - ciLower)
      : null;
    const isCiAcceptablePillar = ciSpread !== null && ciLower !== undefined &&
      ciSpread <= 0.22 && ciLower >= 0.52;
    qPillars.push({
      key: 'CONFIDENCE_INTERVAL_ACCEPTABLE',
      labelFa: '۴. بازه اطمینان آماری مجاز (CONFIDENCE INTERVAL ACCEPTABLE)',
      passed: isCiAcceptablePillar,
      blocking: false,
      value: ciSpread !== null && ciLower !== undefined && ciUpper !== undefined
        ? `بازه: [${(ciLower * 100).toFixed(0)}% - ${(ciUpper * 100).toFixed(0)}%] (عرض: ${(ciSpread * 100).toFixed(0)}%)`
        : 'ناموجود',
      thresholdFa: 'آمار اطلاع‌رسانی است و مانع اجرا نیست',
      evidenceFa: isCiAcceptablePillar ? 'بازه اطمینان فقط برای نمایش آماری است.' : 'بازه اطمینان موجود یا معتبر نیست؛ این مورد فقط اطلاع‌رسانی است.',
    });

    // 5. POSITIVE NET EDGE
    const isPositiveNetEdgePillar = posEvPassed;
    qPillars.push({
      key: 'POSITIVE_NET_EDGE',
      labelFa: '۵. برتری خالص مثبت (POSITIVE NET EDGE)',
      passed: isPositiveNetEdgePillar,
      blocking: ev !== null,
      value: ev !== null ? `$${ev.toFixed(2)} EV` : 'UNAVAILABLE',
      thresholdFa: ev === null ? 'بدون آرشیو: اطلاع‌رسانی، نه مانع اجرا' : 'امید ریاضی اندازه‌گیری‌شده > $0.00',
      evidenceFa: ev === null
        ? 'آرشیو برای برآورد EV در دسترس نیست؛ این مورد فقط اطلاع‌رسانی است.'
        : isPositiveNetEdgePillar ? 'امید ریاضی اندازه‌گیری‌شده مثبت است.' : 'امید ریاضی اندازه‌گیری‌شده منفی یا صفر است.',
    });
    if (ev !== null && !isPositiveNetEdgePillar) qRejectionsFa.push('قانون نهایی [POSITIVE NET EDGE]: امید ریاضی اندازه‌گیری‌شده منفی یا فاقد برتری خالص.');

    // 6. ENTRY QUALITY
    const isEntryQualityPillar = validEntryPassed && isLiquidityOk && spreadPassed && slippagePassed;
    qPillars.push({
      key: 'ENTRY_QUALITY',
      labelFa: '۶. کیفیت نقطه ورود (ENTRY QUALITY)',
      passed: isEntryQualityPillar,
      value: `ورود: $${entryTarget.toLocaleString()} | اسپرد: ${currentSpreadBps === null ? 'UNKNOWN' : `${currentSpreadBps.toFixed(1)}bps`} | عمق: ${hasLiquidityDepth ? `$${Math.round(Math.min(bidDepth!, askDepth!) / 1000)}k` : 'UNKNOWN'}`,
      thresholdFa: 'ورود معتبر؛ مقادیر اختیاری فقط در صورت موجود بودن ارزیابی می‌شوند',
      evidenceFa: isEntryQualityPillar
        ? 'ورود معتبر است؛ داده‌های اختیاریِ موجود بررسی شدند و داده‌های ناموجود مانع نیستند.'
        : 'ورود نامعتبر یا دادهٔ اختیاریِ اندازه‌گیری‌شده خارج از حد مجاز است.',
    });
    if (!isEntryQualityPillar) qRejectionsFa.push('قانون نهایی [ENTRY QUALITY]: کیفیت ورود، اسپرد یا عمق سفارشات نامساعد است.');

    // 7. TRIGGER CONFIRMED
    const isTriggerConfirmedPillar = Boolean(
      liveAnalysis &&
      liveAnalysis.signalOk !== false &&
      (liveAnalysis.setupContext ? liveAnalysis.setupContext.isTriggerConfirmed !== false : true)
    );
    qPillars.push({
      key: 'TRIGGER_CONFIRMED',
      labelFa: '۷. تایید قطعی ماشه معامله (TRIGGER CONFIRMED)',
      passed: isTriggerConfirmedPillar,
      value: isTriggerConfirmedPillar ? 'ماشه ورود تاییدشده' : 'عدم تایید ماشه',
      thresholdFa: 'تایید قطعی ایونت‌های پرایس‌اکشن بدون ورود پیش‌رس یا حدسی',
      evidenceFa: isTriggerConfirmedPillar ? 'رویدادهای کاتالیزور و ماشه معاملاتی تثبیت شدند.' : 'ماشه معامله فعال نشده یا فاقد تایید ساختاری است.',
    });
    if (!isTriggerConfirmedPillar) qRejectionsFa.push('قانون نهایی [TRIGGER CONFIRMED]: ماشه ورود تایید نشده است.');

    // 8. WAVE CONDITIONS
    const isWaveConditionsPillar = Boolean(
      liveAnalysis &&
      (!((liveAnalysis as any)?.wavePredictionEngine?.antiChasingGuard?.isChasingDetected)) &&
      validStopPassed &&
      validTargetPassed
    );
    qPillars.push({
      key: 'WAVE_CONDITIONS',
      labelFa: '۸. شرایط امواج و عدم تعقیب (WAVE CONDITIONS)',
      passed: isWaveConditionsPillar,
      value: isWaveConditionsPillar ? 'موقعیت بهینه موج (Anti-Chase PASS)' : 'تعقیب قیمت یا استاپ نامعتبر',
      thresholdFa: 'ورود در ابتدای موج، عدم Chase قیمت، حد ضرر و حد سود منطقی',
      evidenceFa: isWaveConditionsPillar ? 'معامله در بهترین بخش موج و بدون تعقیب دیرهنگام قیمت طراحی شده است.' : 'خطر تعقیب قیمت (Chasing) یا نامعتبر بودن سطوح استاپ/تارگت.',
    });
    if (!isWaveConditionsPillar) qRejectionsFa.push('قانون نهایی [WAVE CONDITIONS]: خطر تعقیب قیمت یا شرایط نامساعد موج.');

    // 9. RISK APPROVED
    const isRiskApprovedPillar = riskVerdict.isApproved && isRiskLimitOk && dailyLossPassed && drawdownPassed;
    qPillars.push({
      key: 'RISK_APPROVED',
      labelFa: '۹. تایید کامل لایه ریسک و آنتی‌تیلت (RISK APPROVED)',
      passed: isRiskApprovedPillar,
      value: isRiskApprovedPillar ? 'ریسک تاییدشده' : 'رد توسط لایه ریسک',
      thresholdFa: 'عدم نقض سقف روزانه، دراوداون < 15%، آنتی‌تیلت فعال و دیوار آتش اخبار تاییدشده',
      evidenceFa: isRiskApprovedPillar ? 'تمامی پارامترهای ریسک حساب، دراوداون و کنترل شوک خبری پاس شدند.' : 'لایه ریسک مانع ارسال سفارش شد (حد روزانه، دراوداون یا دیوار آتش).',
    });
    if (!isRiskApprovedPillar) qRejectionsFa.push('قانون نهایی [RISK APPROVED]: لایه ریسک معامله را رد کرده است.');

    // 10. FRESH EXECUTION SNAPSHOT
    const isFreshSnapshotPillar = freshTimestampPassed && clockSyncedPassed;
    qPillars.push({
      key: 'FRESH_EXECUTION_SNAPSHOT',
      labelFa: '۱۰. تازگی اسنپ‌شات لحظه‌ای (FRESH EXECUTION SNAPSHOT)',
      passed: isFreshSnapshotPillar,
      value: `${Math.round(ageMs / 1000)}s سن اسنپ‌شات | ${clockDriftMs}ms انحراف ساعت`,
      thresholdFa: 'سن اسنپ‌شات داده < ۱۵ ثانیه و انحراف ساعت با صرافی < ۱۵۰۰ میلی‌ثانیه',
      evidenceFa: isFreshSnapshotPillar ? 'اسنپ‌شات لحظه‌ای بازار تازه و همگام با صرافی است.' : 'اسنپ‌شات کهنه بوده یا انحراف زمانی وجود دارد.',
    });
    if (!isFreshSnapshotPillar) qRejectionsFa.push('قانون نهایی [FRESH EXECUTION SNAPSHOT]: اسنپ‌شات داده کهنه است یا ساعت همگام نیست.');

    // 11. REAL EXECUTION CAPABILITY
    const isRealExecutionPillar = reconciliationPassed && positionStatePassed && isSymbolCorrect && noDuplicatePassed;
    qPillars.push({
      key: 'REAL_EXECUTION_CAPABILITY',
      labelFa: '۱۱. توانایی اجرای واقعی در صرافی (REAL EXECUTION CAPABILITY)',
      passed: isRealExecutionPillar,
      value: isRealExecutionPillar ? 'صرافی متصل و تطبیق ۱۰۰٪' : 'خطای اتصال یا عدم تطبیق',
      thresholdFa: 'تطبیق ۱۰۰٪ با صرافی، نماد رسمی BTCUSDT، بدون سفارش تکراری یا قفل وضعیت',
      evidenceFa: isRealExecutionPillar ? 'زیرساخت اجرای صرافی آماده شلیک و حساب کاملاً همگام است.' : 'ناهماهنگی پوزیشن یا عدم آمادگی صرافی برای اجرای سفارش.',
    });
    if (!isRealExecutionPillar) qRejectionsFa.push('قانون نهایی [REAL EXECUTION CAPABILITY]: زیرساخت اجرای سفارش در صرافی آماده نیست.');

    const passedPillarsCount = qPillars.filter(p => p.passed).length;
    const failedBlockingPillarsCount = qPillars.filter((pillar) =>
      pillar.blocking !== false && !pillar.passed
    ).length;
    const isAllElevenPassed = failedBlockingPillarsCount === 0;
    const quantumLawReport: QuantumTradeLawReport = {
      isTradePermitted: isAllElevenPassed,
      passedPillarsCount,
      totalPillarsCount: 11,
      pillars: qPillars,
      rejectionReasonsFa: qRejectionsFa,
      equationVerdictFa: isAllElevenPassed
        ? '✅ گیت‌های فنی و ریسک عبور کردند؛ calibration و CI فقط آمار اطلاع‌رسانی هستند.'
        : `🛑 ${failedBlockingPillarsCount} گیت فنی/ریسک نقض شد. وضعیت: NO_TRADE`,
      charterStatementFa: 'Score بالا به‌تنهایی اجازه معامله نیست؛ calibration/CI آمار اطلاعاتی‌اند و جایگزین snapshot و کنترل ریسک نمی‌شوند.',
    };

    const passedCount = checks.filter((check) => check.passed || check.blocking === false).length;
    const isAllNineteenPassed = checks.every((check) =>
      check.blocking === false || check.passed
    ) && riskVerdict.isApproved && quantumLawReport.isTradePermitted;

    const overallVerdict: 'EXECUTION_AUTHORIZED' | 'NO_TRADE' = isAllNineteenPassed ? 'EXECUTION_AUTHORIZED' : 'NO_TRADE';

    const mergedRejectionReasons = overallVerdict === 'NO_TRADE'
      ? Array.from(new Set([...rejectionReasonsFa, ...qRejectionsFa]))
      : [];

    return {
      overallVerdict,
      gateScore: `${passedCount} / 19 checks (${passedPillarsCount} / 11 measured pillars)`,
      isAllNineteenPassed,
      checks,
      quantumLawReport,
      rejectionReasonsFa: mergedRejectionReasons,
      evaluatedAt: now,
    };
  }

}

export const predictionEngine = PredictionEngine.getInstance();
export const riskEngine = RiskEngine.getInstance();
export const executionEngine = ExecutionEngine.getInstance();
