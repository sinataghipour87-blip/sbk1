/**
 * 📊 Dynamic Multi-Factor Risk Sizing & Kelly / Cognitive Conviction Engine (Item 32)
 * Calculates dynamic position risk percentage (never static 1.5%) based on:
 * - Volatility (GARCH/ATR)
 * - Current Drawdown
 * - Statistical Edge
 * - Win Probability & Confidence Interval
 * - Cross-Asset / Cross-Exchange Correlation
 * - Market Regime
 */

export interface RiskEvaluationParams {
  baseRiskPct?: number;
  volatilityPct: number;
  drawdownPct: number;
  statisticalEdge: number;
  winProbability: number;
  confidenceIntervalWidth: number;
  correlationRiskFactor: number;
  marketRegime: string;
}

export interface DynamicRiskResult {
  finalRiskPct: number;
  adjustedLeverage: number;
  rationaleFa: string;
  riskTier: 'STRICT_MINIMAL' | 'DEFENSIVE_REDUCED' | 'MODERATE_BALANCED' | 'AGGRESSIVE_SCALE';
  marginScale: number;
  labelFa: string;
  mode: string;
}

/**
 * =============================================================================
 * 📊 RISK ENGINE & POSITION SIZING WITH CONSERVATIVE LOWER CONFIDENCE BOUND
 * =============================================================================
 * اصول ۴۱ و ۴۲:
 * ۴۱. Risk Engine به هیچ عنوان Probability صادر شده از مدل پیش‌بینی را دستکاری نمی‌کند.
 *     - Prediction Engine: محاسبه Edge و Win Probability اصلی (Point Estimate & CI).
 *     - Risk Engine: محاسبه حجم مجاز بر اساس لبه آماری بدون دستکاری عدد Probability.
 *     - Execution Engine: ارزیابی میکروساختاری امکان اجرای معامله در لحظه.
 * 
 * ۴۲. محاسبه حجم پوزیشن (Position Sizing) بر اساس Lower Confidence Bound:
 *     - Position Size بر پایه حد پایین فاصله اطمینان (Lower Bound) محاسبه می‌شود.
 *     - اگر Probability=80% و Lower Bound=56% -> حجم بر اساس ۵۶٪ محافظه‌کارانه.
 *     - اگر Probability=76% و Lower Bound=73% -> حجم بر اساس ۷۳٪.
 * =============================================================================
 */

export interface ConservativeSizingInput {
  calibratedWinProbability: number; // e.g. 0.80 (80%) - Unaltered
  lowerBound: number; // e.g. 0.56 (56%) - Used for Sizing
  upperBound: number; // e.g. 0.88 (88%)
  confidenceIntervalWidth: number;
  expectedValueUsd: number;
  volatilityPct: number;
  drawdownPct: number;
  marketRegime: string;
}

export interface ConservativeSizingResult {
  unalteredPointProbabilityPct: number; // 80% (Point estimate intact)
  effectiveProbabilityForSizingPct: number; // 56% (Lower bound used for size)
  confidenceIntervalWidthPct: number;
  sizingConservativeDiscountFactor: number;
  finalRiskPct: number;
  marginScale: number;
  adjustedLeverage: number;
  rationaleFa: string;
}

export function calculateConservativePositionSizing(input: ConservativeSizingInput): ConservativeSizingResult {
  const rawProbPct = Math.round((input.calibratedWinProbability <= 1 ? input.calibratedWinProbability * 100 : input.calibratedWinProbability));
  
  // ۴۲. استفاده مستقیم از حد پایین فاصله اطمینان (Lower Bound) برای Position Sizing
  let lowerBoundPct = input.lowerBound <= 1 ? input.lowerBound * 100 : input.lowerBound;
  
  // اگر lowerBound ارائه نشده یا نامعتبر است، با کسر عرض CI محاسبه می‌شود
  if (!lowerBoundPct || isNaN(lowerBoundPct) || lowerBoundPct <= 0) {
    const ciWidth = input.confidenceIntervalWidth <= 1 ? input.confidenceIntervalWidth * 100 : input.confidenceIntervalWidth;
    lowerBoundPct = Math.max(10, rawProbPct - (ciWidth || 10));
  }

  // Effective Probability برای تعیین حجم منحصراً برابر با Lower Bound است
  const effectiveProbForSizingPct = Math.min(rawProbPct, Math.max(10, Math.round(lowerBoundPct)));
  
  // نسبت تخفیف محافظه‌کارانه (Discount Factor) = Effective / Point Estimate
  const discountFactor = Number((effectiveProbForSizingPct / Math.max(1, rawProbPct)).toFixed(3));

  // محاسبه فرمول Kelly بر اساس Effective Lower Bound
  const winLossRatio = Math.max(1.1, input.expectedValueUsd > 0 ? 1.8 : 1.2);
  const p = effectiveProbForSizingPct / 100;
  const q = 1 - p;
  const rawKellyFraction = Math.max(0.005, (p * winLossRatio - q) / winLossRatio);
  
  // اعمال Half-Kelly به اضافه فاکتور نوسان و دراداون
  const volDampener = Math.max(0.4, Math.min(1.4, 1.2 / (input.volatilityPct + 0.2)));
  const ddDampener = input.drawdownPct > 2.0 ? 0.35 : input.drawdownPct > 1.0 ? 0.65 : 1.0;
  
  let finalRiskPct = (rawKellyFraction * 0.5 * 100) * volDampener * ddDampener;
  finalRiskPct = Math.max(0.2, Math.min(2.5, Number(finalRiskPct.toFixed(2))));

  const marginScale = Number((finalRiskPct / 1.5).toFixed(3));
  const adjustedLeverage = finalRiskPct >= 1.8 ? 10 : finalRiskPct >= 0.8 ? 5 : 3;

  const rationaleFa = `حجم پوزیشن بر پایه حد پایین فاصله اطمینان (${effectiveProbForSizingPct.toFixed(1)}٪ Lower Bound) کالیبره شد. (احتمال اصلی مدل: ${rawProbPct}٪ بدون تغییر ماند | فاکتور محافظه‌کاری: ${discountFactor}).`;

  return {
    unalteredPointProbabilityPct: rawProbPct,
    effectiveProbabilityForSizingPct: effectiveProbForSizingPct,
    confidenceIntervalWidthPct: Math.round(Math.abs(rawProbPct - effectiveProbForSizingPct)),
    sizingConservativeDiscountFactor: discountFactor,
    finalRiskPct,
    marginScale,
    adjustedLeverage,
    rationaleFa
  };
}

export function evaluateCognitiveConviction(
  paramOrAnalysis: RiskEvaluationParams | any,
  prediction?: any,
  confidenceScore?: number
): DynamicRiskResult {
  let baseRiskPct = 1.5;
  let volatilityPct = 1.2;
  let drawdownPct = 0.0;
  let statisticalEdge = 1.2;
  let winProbability = 70;
  let confidenceIntervalWidth = 0.05;
  let correlationRiskFactor = 1.0;
  let marketRegime = 'TREND';

  if (paramOrAnalysis && 'volatilityPct' in paramOrAnalysis && typeof paramOrAnalysis.volatilityPct === 'number') {
    const p = paramOrAnalysis as RiskEvaluationParams;
    baseRiskPct = p.baseRiskPct ?? 1.5;
    volatilityPct = p.volatilityPct;
    drawdownPct = p.drawdownPct ?? 0.0;
    statisticalEdge = p.statisticalEdge ?? 1.2;
    winProbability = p.winProbability ?? 70;
    confidenceIntervalWidth = p.confidenceIntervalWidth ?? 0.05;
    correlationRiskFactor = p.correlationRiskFactor ?? 1.0;
    marketRegime = p.marketRegime ?? 'TREND';
  } else if (paramOrAnalysis) {
    const analysis = paramOrAnalysis;
    volatilityPct = analysis.volatilityPct || 1.2;
    marketRegime = analysis.marketRegime || 'TREND';
    winProbability = Math.round((analysis.calibratedWinProbability || 0.7) * 100);
    statisticalEdge = analysis.expectedValue ? Math.max(0.5, analysis.expectedValue / 10) : 1.2;
    if (analysis.confidenceInterval && typeof analysis.confidenceInterval.upper === 'number' && typeof analysis.confidenceInterval.lower === 'number') {
      confidenceIntervalWidth = Math.abs(analysis.confidenceInterval.upper - analysis.confidenceInterval.lower);
    } else {
      confidenceIntervalWidth = analysis.uncertaintySpread || 0.05;
    }
    correlationRiskFactor = Math.abs(analysis.macroCorrelation || 0) > 0.7 ? 1.3 : 1.0;
  }

  const volFactor = Math.max(0.4, Math.min(1.6, 1.2 / (volatilityPct + 0.3)));
  const ddDamper = drawdownPct > 2.0 ? 0.3 : drawdownPct > 1.0 ? 0.6 : drawdownPct > 0.5 ? 0.8 : 1.0;
  const edgeMultiplier = Math.max(0.2, Math.min(1.8, (statisticalEdge * (winProbability / 100))));
  
  // Item 66: Confidence Interval position sizing calibration
  // CI 76-80 (width = 0.04) -> uncertaintyPenalization = ~0.97
  // CI 51-94 (width = 0.43) -> uncertaintyPenalization = ~0.23 (substantially smaller trade)
  const uncertaintyPenalization = Math.max(0.12, Math.min(1.0, 1.0 / (1.0 + (18.0 * Math.pow(confidenceIntervalWidth, 2)))));
  const corrFactor = Math.max(0.6, Math.min(1.3, 1.0 / (correlationRiskFactor || 1.0)));

  let regimeMultiplier = 1.0;
  if (marketRegime === 'PANIC' || marketRegime === 'NEWS_WHIPSAW') {
    regimeMultiplier = 0.25;
  } else if (marketRegime === 'COMPRESSION') {
    regimeMultiplier = 0.7;
  } else if (marketRegime === 'TREND' && winProbability >= 75 && statisticalEdge >= 1.5) {
    regimeMultiplier = 1.35;
  } else if (marketRegime === 'RANGE') {
    regimeMultiplier = 0.85;
  }

  let calculatedRisk = baseRiskPct * volFactor * ddDamper * edgeMultiplier * uncertaintyPenalization * corrFactor * regimeMultiplier;
  calculatedRisk = Math.max(0.1, Math.min(3.0, Number(calculatedRisk.toFixed(2))));

  let riskTier: DynamicRiskResult['riskTier'] = 'MODERATE_BALANCED';
  let labelFa = 'متعادل پویا';
  let rationaleFa = `ریسک پویا کالیبره شد: ${calculatedRisk}% (بر اساس نوسان ${volatilityPct.toFixed(1)}٪، رژیم ${marketRegime} و لبه آماری).`;

  if (calculatedRisk >= 2.0) {
    riskTier = 'AGGRESSIVE_SCALE';
    labelFa = 'بیشینه‌سازی اثبات‌شده';
    rationaleFa = `رژیم قدرتمند و اثبات آماری بالا: ریسک به ${calculatedRisk}% افزایش یافت.`;
  } else if (calculatedRisk <= 0.6) {
    riskTier = 'STRICT_MINIMAL';
    labelFa = 'حداقل تدافعی';
    rationaleFa = `شرایط ضعیف یا پرریسک: ریسک به شدت کاهش یافت تا از سرمایه محافظت شود (${calculatedRisk}%).`;
  } else if (calculatedRisk < 1.0) {
    riskTier = 'DEFENSIVE_REDUCED';
    labelFa = 'کاهش ریسک تدافعی';
    rationaleFa = `ریسک تدافعی فعال: ریسک محدود به ${calculatedRisk}% شد.`;
  }

  const adjustedLeverage = calculatedRisk > 2.0 ? 10 : calculatedRisk > 1.2 ? 5 : 3;
  const marginScale = calculatedRisk / 1.5;

  return {
    finalRiskPct: calculatedRisk,
    adjustedLeverage,
    rationaleFa,
    riskTier,
    marginScale,
    labelFa,
    mode: riskTier,
  };
}

export function calculateKellyRisk(...args: any[]): number {
  if (args.length > 0 && typeof args[0] === 'number') {
    const winProb = args[0] > 1 ? args[0] / 100 : args[0];
    const winLossRatio = args[1] || 1.8;
    const q = 1 - winProb;
    const kelly = (winProb * winLossRatio - q) / winLossRatio;
    return Math.max(0.005, Math.min(0.03, Number((kelly * 0.5).toFixed(3))));
  }
  return 0.015;
}

export function getAntiTiltStatus(historyOrLosses: any = 0): {
  isTiltActive: boolean;
  isLocked: boolean;
  riskMultiplier: number;
  consecutiveLosses: number;
  lossCauseCategory?: 'EXECUTION_FRICTION' | 'MODEL_REGIME_DECAY' | 'NORMAL_STATISTICAL_VARIANCE';
  reason: string;
  messageFa: string;
} {
  let consecutiveLosses = 0;
  let isExecutionFrictionLoss = false;
  let isModelDecayLoss = false;

  if (Array.isArray(historyOrLosses)) {
    for (let i = historyOrLosses.length - 1; i >= 0; i--) {
      const trade = historyOrLosses[i];
      const pnl = trade.pnlUsd !== undefined ? trade.pnlUsd : (trade.realizedPnlUsd || 0);
      if (pnl < 0) {
        consecutiveLosses++;
        const cause = (trade.lossCause || trade.rootCauseType || trade.exitReason || '').toUpperCase();
        if (cause.includes('SLIPPAGE') || cause.includes('LATENCY') || cause.includes('EXECUTION') || cause.includes('SPREAD')) {
          isExecutionFrictionLoss = true;
        } else if (cause.includes('REGIME') || cause.includes('ALPHA') || cause.includes('DECAY') || cause.includes('REVERSAL')) {
          isModelDecayLoss = true;
        }
      } else {
        break;
      }
    }
  } else if (typeof historyOrLosses === 'number') {
    consecutiveLosses = historyOrLosses;
  }

  // Item 79: Root-cause aware Anti-Martingale position sizing
  if (consecutiveLosses >= 3) {
    if (isExecutionFrictionLoss && !isModelDecayLoss) {
      // Problem was exchange execution/slippage, do not over-penalize model predictions
      return {
        isTiltActive: true,
        isLocked: false,
        consecutiveLosses,
        lossCauseCategory: 'EXECUTION_FRICTION',
        riskMultiplier: 0.75,
        reason: 'ضرر ناشی از اسلیپیج و اصطکاک اجرا بوده؛ مدل پیش‌بینی جریمه سنگین نشد.',
        messageFa: '⚠️ کاهش جزئی ریسک به علت اسلیپیج بالای صرافی (مدل پیش‌بینی سالم است).'
      };
    }

    return {
      isTiltActive: true,
      isLocked: true,
      consecutiveLosses,
      lossCauseCategory: isModelDecayLoss ? 'MODEL_REGIME_DECAY' : 'NORMAL_STATISTICAL_VARIANCE',
      riskMultiplier: 0.35,
      reason: '۳ ضرر متوالی ساختاری؛ کاهش ریسک به ۳۵٪ جهت حفظ اصل سرمایه',
      messageFa: '🚨 حالت ضدتیلت و حفاظت رژیم فعال شد: کاهش هوشمند حجم معاملات به ۳۵٪.'
    };
  } else if (consecutiveLosses === 2) {
    const riskMult = isExecutionFrictionLoss ? 0.85 : 0.65;
    return {
      isTiltActive: true,
      isLocked: false,
      consecutiveLosses,
      lossCauseCategory: isExecutionFrictionLoss ? 'EXECUTION_FRICTION' : 'NORMAL_STATISTICAL_VARIANCE',
      riskMultiplier: riskMult,
      reason: '۲ ضرر متوالی؛ کاهش موقت و هوشمند ریسک',
      messageFa: '⚠️ هشدار تپش معامله: ۲ ضرر متوالی؛ کاهش تعدیل‌شده ریسک بر اساس علت ضرر.'
    };
  }

  return {
    isTiltActive: false,
    isLocked: false,
    consecutiveLosses,
    lossCauseCategory: 'NORMAL_STATISTICAL_VARIANCE',
    riskMultiplier: 1.0,
    reason: 'وضعیت نرمال',
    messageFa: 'وضعیت سلامت مدل و مدیریت ریسک نرمال است.'
  };
}

export function calculateDynamicKellyMargin(
  balance = 0,
  riskOrHistory: any = 1.5,
  entryOrConf: any = 0,
  stopLossOrMargin: any = 0,
  ..._rest: any[]
): number {
  if (balance <= 0) return 0;
  let riskPct = 1.5;
  if (typeof riskOrHistory === 'number') {
    riskPct = riskOrHistory;
  } else if (Array.isArray(riskOrHistory)) {
    const tilt = getAntiTiltStatus(riskOrHistory);
    riskPct = 1.5 * tilt.riskMultiplier;
  }
  const riskUsd = balance * (riskPct / 100);
  const positionSizeUsd = Math.max(10, riskUsd * 4);
  return Math.round(positionSizeUsd * 100) / 100;
}


import { TradePosition, TradeHistory } from '../types/trading';

export interface CorrelationRiskReport {
  aggregateExposureUsd: number;
  netExposureUsd: number;
  correlationRiskFactor: number;
  reasonsFa: string[];
}

/**
 * 83. Position Correlation Risk:
 * If multiple positions are open at the same time, calculates aggregate and net exposure, 
 * returning a correlation risk factor that dampens position sizing under high unidirectional exposure.
 */
export function calculatePositionCorrelationRisk(activePositions: TradePosition[]): CorrelationRiskReport {
  let aggregateExposureUsd = 0;
  let netExposureUsd = 0;
  const reasonsFa: string[] = [];
  
  let longExposure = 0;
  let shortExposure = 0;
  const symbols: string[] = [];

  for (const pos of activePositions) {
    const notional = (pos.initialMargin || pos.margin || 50) * pos.lev;
    aggregateExposureUsd += notional;
    if (pos.dir === 'LONG') {
      longExposure += notional;
    } else {
      shortExposure += notional;
    }
    const sym = pos.name || 'BTCUSDT';
    symbols.push(`${sym} (${pos.dir})`);
  }

  netExposureUsd = longExposure - shortExposure;

  let correlationRiskFactor = 1.0;
  if (activePositions.length > 1) {
    const totalNotional = longExposure + shortExposure;
    if (totalNotional > 0) {
      const netRatio = Math.abs(longExposure - shortExposure) / totalNotional;
      if (netRatio > 0.7) {
        correlationRiskFactor = 1.0 + (activePositions.length - 1) * 0.25; // +25% risk per additional same-dir position
        reasonsFa.push(`⚠️ ریسک همبستگی بالا: ${activePositions.length} پوزیشن هم‌جهت باز هستند (${symbols.join(', ')}). ریسک کل تجمیع شده است.`);
      } else {
        correlationRiskFactor = 0.8 + netRatio * 0.2;
        reasonsFa.push(`✅ اثر هج همبستگی: پوزیشن‌های متضاد باز هستند که ریسک همبستگی تجمیعی را کاهش می‌دهند.`);
      }
    }
  } else if (activePositions.length === 1) {
    reasonsFa.push(`✅ ریسک همبستگی نرمال است (فقط یک پوزیشن فعال وجود دارد).`);
  } else {
    reasonsFa.push(`✅ هیچ پوزیشن فعالی وجود ندارد.`);
  }

  correlationRiskFactor = Math.min(2.0, Math.max(0.5, correlationRiskFactor));

  return {
    aggregateExposureUsd,
    netExposureUsd,
    correlationRiskFactor,
    reasonsFa
  };
}

/**
 * 81. Real Daily Loss calculation:
 * Includes Realized PnL today + Unrealized losses + Fees + Funding + Slippage of active and closed trades.
 */
export function calculateRealDailyLoss(activePositions: TradePosition[], tradeHistory: TradeHistory[]): number {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  
  // 1. Closed trades today (last 24 hours)
  const closedToday = tradeHistory.filter(t => {
    const closedTime = t.closedAt ? new Date(t.closedAt).getTime() : 0;
    if (closedTime === 0 && t.closedAt) {
      // Parse string hour like "14:25"
      const [h, m] = t.closedAt.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return (now - d.getTime()) <= oneDayMs;
    }
    return (now - closedTime) <= oneDayMs;
  });

  let realizedPnl = 0;
  let closedFees = 0;
  let closedSlippage = 0;
  let closedFunding = 0;

  for (const t of closedToday) {
    realizedPnl += (t.pnlUsd !== undefined ? t.pnlUsd : (t.realizedPnlUsd || 0));
    closedFees += t.realizedFeesUsd || t.exchangeFeeEstimateUsd || 0;
    closedSlippage += t.slippageUsd || 0;
    closedFunding += (t as any).fundingCostUsd || 0;
  }

  // 2. Active positions unrealized loss, fees, funding, slippage
  let unrealizedLoss = 0;
  let activeFees = 0;
  let activeSlippage = 0;
  let activeFunding = 0;

  for (const p of activePositions) {
    const floatPnl = p.floatingPnlUsd || 0;
    if (floatPnl < 0) {
      unrealizedLoss += Math.abs(floatPnl); // Unrealized Loss
    }
    activeFees += p.realizedFeesUsd || p.exchangeFeeEstimateUsd || 0;
    activeSlippage += p.slippageUsd || 0;
    activeFunding += (p as any).fundingCostUsd || 0;
  }

  // Daily Loss is realized PnL today minus unrealized losses, fees, slippage, funding
  const totalDailyLossUsd = realizedPnl - unrealizedLoss - closedFees - activeFees - closedSlippage - activeSlippage - closedFunding - activeFunding;
  return totalDailyLossUsd;
}

export function calculateDrawdown(equityOrHistory: any, startingEquity?: number): { maxDrawdownPct: number; currentDrawdownPct: number } {
  if (!equityOrHistory || equityOrHistory.length === 0) return { maxDrawdownPct: 0, currentDrawdownPct: 0 };
  let equityCurve: number[] = [];
  if (typeof equityOrHistory[0] === 'number') {
    equityCurve = equityOrHistory;
  } else if (typeof equityOrHistory[0] === 'object') {
    // 82. Global Drawdown must be calculated from actual Account/Exchange starting equity
    const initialTrade = equityOrHistory[0];
    let eq = startingEquity ?? (initialTrade.netEquityUsd ? (initialTrade.netEquityUsd - (initialTrade.pnlUsd || initialTrade.realizedPnlUsd || 0)) : 1000);
    if (eq <= 0) eq = 1000;
    
    equityCurve = [eq];
    for (const t of equityOrHistory) {
      eq += (t.pnlUsd !== undefined ? t.pnlUsd : (t.realizedPnlUsd || 0));
      equityCurve.push(eq);
    }
  }
  let peak = equityCurve[0];
  let maxDd = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }
  const latestEq = equityCurve[equityCurve.length - 1];
  const currentDd = peak > 0 ? ((peak - latestEq) / peak) * 100 : 0;
  return { maxDrawdownPct: Math.round(maxDd * 100) / 100, currentDrawdownPct: Math.round(currentDd * 100) / 100 };
}

export interface RealExchangeEquityReport {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  feesUsd: number;
  fundingUsd: number;
  slippageUsd: number;
  dailyLossUsd: number;
  peakEquityUsd: number;
  currentEquityUsd: number;
  maxDrawdownPct: number;
  isDrawdownWithinLimit: boolean;
  statusFa: string;
}

/**
 * 35. Real Exchange Equity Report (Source of Truth for Daily Risk & Drawdown)
 */
export function calculateRealExchangeEquityReport(
  exchangeBalanceUsdt: number,
  activePositions: TradePosition[],
  tradeHistory: TradeHistory[]
): RealExchangeEquityReport {
  let realizedPnlUsd = 0;
  let feesUsd = 0;
  let fundingUsd = 0;
  let slippageUsd = 0;

  for (const t of tradeHistory) {
    realizedPnlUsd += (t.pnlUsd !== undefined ? t.pnlUsd : (t.realizedPnlUsd || 0));
    feesUsd += t.realizedFeesUsd || t.exchangeFeeEstimateUsd || 0;
    slippageUsd += t.slippageUsd || 0;
    fundingUsd += (t as any).fundingCostUsd || 0;
  }

  let unrealizedPnlUsd = 0;
  for (const p of activePositions) {
    unrealizedPnlUsd += p.floatingPnlUsd || 0;
    feesUsd += p.realizedFeesUsd || p.exchangeFeeEstimateUsd || 0;
    slippageUsd += p.slippageUsd || 0;
    fundingUsd += (p as any).fundingCostUsd || 0;
  }

  const currentEquityUsd = Number((exchangeBalanceUsdt + unrealizedPnlUsd).toFixed(2));
  const dailyLossUsd = Number(calculateRealDailyLoss(activePositions, tradeHistory).toFixed(2));
  
  const dd = calculateDrawdown(tradeHistory, currentEquityUsd);
  const maxDrawdownPct = dd.maxDrawdownPct;
  const peakEquityUsd = Number((currentEquityUsd / Math.max(0.01, 1 - (maxDrawdownPct / 100))).toFixed(2));

  const isDrawdownWithinLimit = maxDrawdownPct < 15.0;

  return {
    realizedPnlUsd: Number(realizedPnlUsd.toFixed(2)),
    unrealizedPnlUsd: Number(unrealizedPnlUsd.toFixed(2)),
    feesUsd: Number(feesUsd.toFixed(2)),
    fundingUsd: Number(fundingUsd.toFixed(2)),
    slippageUsd: Number(slippageUsd.toFixed(2)),
    dailyLossUsd,
    peakEquityUsd,
    currentEquityUsd,
    maxDrawdownPct,
    isDrawdownWithinLimit,
    statusFa: isDrawdownWithinLimit
      ? `اکوئیتی واقعی صرافی: $${currentEquityUsd} | افت سرمایه: ${maxDrawdownPct}% (در محدوده مجاز)`
      : `⚠️ نقض سقف افت سرمایه: افت ${maxDrawdownPct}% فراتر از حد مجاز ۱۵٪ اکوئیتی صرافی است.`
  };
}

export function calculatePrecisionEngineeredLeverage(volatilityPct = 1.0, confidenceScore = 80): number {
  if (volatilityPct > 2.5 || confidenceScore < 60) return 3;
  if (volatilityPct > 1.5) return 5;
  if (confidenceScore >= 85) return 10;
  return 5;
}

export function evaluateAccountLevelRisk(...args: any[]): {
  allowed: boolean;
  isOrderPermitted: boolean;
  maxRiskPct: number;
  rejectionReasonFa: string;
  reasonFa: string;
  maxDrawdownPct: number;
} {
  let drawdown = 0;
  let activePositions: TradePosition[] = [];
  let tradeHistory: TradeHistory[] = [];
  let accountEquity = 1000;

  if (args.length > 0 && typeof args[0] === 'object') {
    const opts = args[0];
    activePositions = opts.activePositions || [];
    tradeHistory = opts.tradeHistory || [];
    accountEquity = opts.accountEquityUsd || 1000;
    
    // Calculate global drawdown using actual starting equity from options if provided
    const dd = calculateDrawdown(tradeHistory, accountEquity);
    drawdown = dd.currentDrawdownPct;
  }

  // 81. Daily Loss Limit Check from real Equity
  const realDailyLoss = calculateRealDailyLoss(activePositions, tradeHistory);
  const dailyLossLimitUsd = accountEquity * 0.05; // 5% daily loss limit of account equity

  if (realDailyLoss < -dailyLossLimitUsd) {
    return {
      allowed: false,
      isOrderPermitted: false,
      maxRiskPct: 0,
      rejectionReasonFa: `توقف به علت لمس حد ضرر روزانه واقعی: -$${Math.abs(realDailyLoss).toFixed(2)} (سقف مجاز: -$${dailyLossLimitUsd.toFixed(2)})`,
      reasonFa: `توقف به علت لمس حد ضرر روزانه واقعی: -$${Math.abs(realDailyLoss).toFixed(2)} (سقف مجاز: -$${dailyLossLimitUsd.toFixed(2)})`,
      maxDrawdownPct: drawdown,
    };
  }

  if (drawdown > 15.0) { // Fail-closed standard threshold is 15.0% global drawdown from real equity
    return {
      allowed: false,
      isOrderPermitted: false,
      maxRiskPct: 0,
      rejectionReasonFa: 'توقف اجباری حساب: افت سرمایه بیش از حد مجاز (حداکثر ۱۵٪)',
      reasonFa: 'توقف اجباری حساب: افت سرمایه بیش از حد مجاز (حداکثر ۱۵٪)',
      maxDrawdownPct: drawdown,
    };
  }

  return {
    allowed: true,
    isOrderPermitted: true,
    maxRiskPct: 1.5,
    rejectionReasonFa: '',
    reasonFa: 'مدیریت ریسک حساب در وضعیت عادی است.',
    maxDrawdownPct: drawdown,
  };
}
