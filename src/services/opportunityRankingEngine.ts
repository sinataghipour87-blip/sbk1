/**
 * 🎯 Opportunity Ranking & Independent Dual-Direction Evaluation Engine
 * Items 60, 61, 62, 63
 * 
 * - Item 60: Opportunity Ranking based on Risk-Adjusted Edge:
 *   Score = (EV_R * (Probability / 100)) / (MAE_R + 0.1) * min(2.5, MFE_R / (MAE_R + 0.1))
 * - Item 61: Evaluate LONG and SHORT completely independently from raw features.
 * - Item 62: Eliminate Direction Bias (no forward-carrying of initial direction).
 * - Item 63: Eliminate Circular Scoring (Raw Data -> Features -> Independent Models -> Decision).
 * - RULE: ZERO HEURISTIC-TO-PROBABILITY CONVERSION. Probabilities must come exclusively from
 *   statistically calibrated models. Heuristics remain strictly Feature Scores.
 */

import { AnalysisResult, Candle } from '../types/trading';
import { evaluateRealLearnedSegmentMetrics } from './centralProbabilityEngine';

export interface OpportunityCandidate {
  id: string;
  setupType: string;
  nameFa: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  calibratedWinProbability: number | null; // Calibrated probability exclusively, or null
  heuristicScore: number; // 0 - 100 (Feature/Confluence score, NOT a probability)
  expectedValueR: number | null; // In terms of R
  expectedValueUsd: number | null;
  fillProbability: number; // Item 20: Estimated Fill Probability (0.0 to 1.0)
  historicalMaeR: number; // Historical median MAE in R
  historicalMfeR: number; // Historical median MFE in R
  regimeCompatibilityScore: number; // 0 - 100
  riskAdjustedRankScore: number; // Final composite ranking metric
  rankingGradeFa: string;
  rationaleFa: string;
}

export type StrategyFamily = 
  | 'LIQUIDITY_SWEEP_RECLAIM'
  | 'BREAKOUT_RETEST'
  | 'TREND_CONTINUATION_PULLBACK'
  | 'RANGE_BOUND_MEAN_REVERSION';

export interface StrategyExecutionFriction {
  takerFeeUsd: number;
  estimatedSlippageUsd: number;
  spreadCostUsd: number;
  fundingCostUsd: number;
  totalFrictionUsd: number;
  frictionInR: number;
}

export type OpportunityValidationStatus =
  | 'APPROVED'
  | 'NO_TRADE_REGIME_MISMATCH'
  | 'NO_TRADE_NEGATIVE_NET_EV'
  | 'NO_TRADE_LOW_DATA_QUALITY'
  | 'NO_TRADE_UNVALIDATED_PROBABILITY'
  | 'NO_TRADE_CONFIDENCE_BREACH'
  | 'NO_TRADE_INSUFFICIENT_RR';

export interface UnifiedStandardOpportunity {
  id: string;
  family: StrategyFamily;
  setupNameFa: string;
  definitionFa: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLossPrice: number;
  takeProfit1Price: number;
  takeProfit2Price: number;
  riskRewardRatio: number;
  entryConditionsFa: string[];
  invalidationConditionsFa: string[];
  stopLossRuleFa: string;
  exitRuleFa: string;
  noTradeConditionsFa: string[];
  marketRegime: string;
  isRegimeCompatible: boolean;
  dataQualityScore: number; // 0 - 100
  calibratedWinProbability: number | null; // Calibrated only
  grossExpectedValueR: number | null;
  netExpectedValueR: number | null; // After all execution costs
  netExpectedValueUsd: number | null;
  confidenceInterval95: { minEvR: number; maxEvR: number } | null;
  riskUsd: number;
  executionFriction: StrategyExecutionFriction;
  historicalMaeR: number;
  historicalMfeR: number;
  fillProbability: number;
  finalCompositeScore: number;
  status: OpportunityValidationStatus;
  statusFa: string;
  rationaleFa: string;
}

export interface FourStrategyEvaluationResult {
  detectedMarketRegime: string;
  regimeRationaleFa: string;
  isMarketSafeForTrading: boolean;
  dataQualityScore: number;
  allOpportunities: UnifiedStandardOpportunity[];
  approvedRankedOpportunities: UnifiedStandardOpportunity[];
  topSelectedOpportunity: UnifiedStandardOpportunity | null;
  arbitrationVerdictFa: string;
}

export interface DualDirectionEvaluationResult {
  longCandidate: OpportunityCandidate | null;
  shortCandidate: OpportunityCandidate | null;
  selectedOpportunity: OpportunityCandidate | null;
  evaluationMode: 'HEAD_TO_HEAD_INDEPENDENT';
  arbitrationVerdictFa: string;
  rankedOpportunities: OpportunityCandidate[];
}

export class OpportunityRankingEngine {
  private static instance: OpportunityRankingEngine;

  public static getInstance(): OpportunityRankingEngine {
    if (!OpportunityRankingEngine.instance) {
      OpportunityRankingEngine.instance = new OpportunityRankingEngine();
    }
    return OpportunityRankingEngine.instance;
  }

  /**
   * Calculates Risk-Adjusted Edge Score (Item 60 & 20: Expected Edge × Fill Probability)
   * Evaluates Probability, EV, MAE, MFE, Fill Probability, and R:R
   */
  public calculateRiskAdjustedScore(
    evR: number | null,
    winProb: number | null,
    maeR: number,
    mfeR: number,
    regimeScore: number,
    fillProbability: number = 1.0
  ): number {
    if (evR === null || winProb === null || evR <= 0) {
      return 0.0;
    }
    const safeMae = Math.max(0.15, maeR);
    const mfeToMaeRatio = Math.min(3.0, Math.max(0.5, mfeR / safeMae));
    const regimeWeight = Math.max(0.4, Math.min(1.2, regimeScore / 80));

    // Item 20 Rule: Expected Edge × Fill Probability
    const effectiveEdgeR = evR * fillProbability;

    // Edge Formula: (Effective Edge R * WinProb) / MAE_R * (MFE / MAE bonus) * Regime
    const rawScore = ((effectiveEdgeR * winProb) / safeMae) * mfeToMaeRatio * regimeWeight;
    return Math.round(Math.max(0, rawScore) * 100) / 100;
  }

  /**
   * Ranks an array of opportunities and returns sorted by risk-adjusted edge (Item 60)
   */
  public rankOpportunities(opportunities: OpportunityCandidate[]): OpportunityCandidate[] {
    const scored = opportunities.map((opp) => {
      const riskAdjustedRankScore = this.calculateRiskAdjustedScore(
        opp.expectedValueR,
        opp.calibratedWinProbability,
        opp.historicalMaeR,
        opp.historicalMfeR,
        opp.regimeCompatibilityScore,
        opp.fillProbability ?? 1.0
      );

      let rankingGradeFa = 'C (ریسک بالا یا فاقد کالیبراسیون)';
      if (opp.calibratedWinProbability === null) {
        rankingGradeFa = 'UNVALIDATED (فاقد کالیبراسیون آماری)';
      } else if (riskAdjustedRankScore >= 2.0 && (opp.expectedValueR ?? 0) >= 0.40) {
        rankingGradeFa = 'A+ (لبه برتر سازمانی)';
      } else if (riskAdjustedRankScore >= 1.3 && (opp.expectedValueR ?? 0) >= 0.25) {
        rankingGradeFa = 'A (لبه آماری قدرتمند)';
      } else if (riskAdjustedRankScore >= 0.8) {
        rankingGradeFa = 'B (متعادل و قابل معامله)';
      }

      return {
        ...opp,
        riskAdjustedRankScore,
        rankingGradeFa,
      };
    });

    // Sort descending by risk-adjusted rank score
    return scored.sort((a, b) => b.riskAdjustedRankScore - a.riskAdjustedRankScore);
  }

  private createMissingPriceDualResult(): DualDirectionEvaluationResult {
    return {
      longOpportunity: null,
      shortOpportunity: null,
      comparison: {
        scoreSpread: 0,
        dominance: 'EQUAL',
        verdictFa: '🛑 لغو ارزیابی دوطرفه: قیمت واقعی بازار مفقود است (UNKNOWN)؛ جایگزینی با قیمت فرضی مجاز نیست.',
        executionAction: 'HOLD_BOTH',
      },
    };
  }

  private createMissingPriceFourStrategyResult(): FourStrategyEvaluationResult {
    return {
      detectedMarketRegime: 'UNKNOWN',
      regimeRationaleFa: '🛑 عدم دسترسی به قیمت لحظه‌ای بازار؛ تعیین رژیم مسدود شد.',
      dataQualityScore: 0,
      isTradeAllowed: false,
      evaluatedOpportunities: [],
      selectedOpportunity: null,
      overallDecision: 'NO_TRADE',
      decisionRationaleFa: '🛑 قیمت بازار مفقود است (UNKNOWN)؛ معامله بر اساس مقادیر فرضی اکیداً ممنوع است.',
    };
  }

  /**
   * Evaluates LONG and SHORT completely independently from raw features (Items 61, 62, 63)
   * Strictly avoids direction bias and circular reasoning.
   */
  public evaluateDualIndependentDirections(
    analysis: AnalysisResult | null,
    candles: Candle[] = []
  ): DualDirectionEvaluationResult {
    const lastCandleClose = candles.length > 0 ? (candles[candles.length - 1][3] ?? 0) : 0;
    const price = (analysis?.price && analysis.price > 0) ? analysis.price : (lastCandleClose > 0 ? lastCandleClose : 0);
    if (!price || price <= 0) {
      return this.createMissingPriceDualResult();
    }
    const atr = Math.max(20, analysis?.atr || price * 0.007);
    const rsi = analysis?.rsi ?? 50;
    const obi = analysis?.obi ?? 0;
    const cvd = analysis?.cvdDelta ?? null;
    const mtf1h = analysis?.mtf1h || 'NEUTRAL';
    const mtf4h = analysis?.mtf4h || 'NEUTRAL';
    const marketRegime = (analysis?.marketRegime as any) || 'TREND';

    // 1. Independent LONG Opportunity Evaluation
    const longSetupType = obi > 0.05 ? 'ORDER_BOOK_ABSORPTION_LONG' : rsi < 40 ? 'MEAN_REVERSION_LONG' : 'TREND_CONTINUATION_LONG';
    const longStop = Math.round((price - 1.5 * atr) * 100) / 100;
    const longTp = Math.round((price + 2.8 * atr) * 100) / 100;
    const longRiskDist = Math.max(1, price - longStop);
    const longRewardDist = Math.abs(longTp - price);
    const longRr = Math.round((longRewardDist / longRiskDist) * 10) / 10;
    const longActualRiskUsd = Math.round(((longRiskDist / price) * 1000) * 100) / 100;

    // Independent Long Heuristic Confluence Score (0-100) - Item 64 (Strictly Feature Score)
    let longHeuristic = 50;
    if (mtf1h === 'BULLISH') longHeuristic += 15;
    if (mtf4h === 'BULLISH') longHeuristic += 15;
    if (obi > 0.04) longHeuristic += 12;
    if (cvd !== null && cvd > 0) longHeuristic += 8;
    if (rsi > 45 && rsi < 65) longHeuristic += 5;
    if (mtf1h === 'BEARISH') longHeuristic -= 25;
    longHeuristic = Math.max(10, Math.min(95, longHeuristic));

    // Statistically Calibrated Win Probability from true OOS evaluation (Rule: NO HEURISTIC-TO-PROBABILITY)
    const longMetrics = evaluateRealLearnedSegmentMetrics(longSetupType, marketRegime, '15m');
    const isLongCalibrated = longMetrics.calibrationStatus === 'CALIBRATED' && longMetrics.calibratedWinProbability !== null;
    const longCalibratedProb = isLongCalibrated ? longMetrics.calibratedWinProbability : null;

    let longEvR: number | null = null;
    let longEvUsd: number | null = null;
    if (longCalibratedProb !== null) {
      const longFrictionInR = (price * 0.0011) / longRiskDist;
      longEvR = Math.round(((longCalibratedProb * longRr) - ((1 - longCalibratedProb) * 1.0) - longFrictionInR) * 100) / 100;
      longEvUsd = Math.round((longEvR * longActualRiskUsd) * 100) / 100;
    }

    const longCandidate: OpportunityCandidate = {
      id: `OPP_LONG_${Date.now()}`,
      setupType: longSetupType,
      nameFa: 'فرصت مستقل خرید (LONG)',
      direction: 'LONG',
      entryPrice: price,
      stopLossPrice: longStop,
      takeProfitPrice: longTp,
      riskRewardRatio: longRr,
      calibratedWinProbability: longCalibratedProb,
      heuristicScore: longHeuristic,
      expectedValueR: longEvR,
      expectedValueUsd: longEvUsd,
      fillProbability: 0.90, // Item 20: Fill Probability
      historicalMaeR: 0.38,
      historicalMfeR: 2.9,
      regimeCompatibilityScore: mtf1h === 'BULLISH' ? 85 : 60,
      riskAdjustedRankScore: 0,
      rankingGradeFa: '',
      rationaleFa: isLongCalibrated
        ? `ارزیابی مستقل لانگ: R:R = ${longRr}, EV = +${longEvR}R, احتمال پر شدن (Fill Prob) = 90% | احتمال کالیبره‌شده = ${((longCalibratedProb ?? 0) * 100).toFixed(1)}%`
        : `ارزیابی لانگ: امتیاز شواهد تکنیکال ${longHeuristic}/100 | احتمال کالیبره‌شده: فاقد اعتبارسنجی OOS (UNVALIDATED)`,
    };

    // 2. Independent SHORT Opportunity Evaluation
    const shortSetupType = obi < -0.05 ? 'ORDER_BOOK_DUMP_SHORT' : rsi > 60 ? 'OVERBOUGHT_REJECTION_SHORT' : 'TREND_CONTINUATION_SHORT';
    const shortStop = Math.round((price + 1.5 * atr) * 100) / 100;
    const shortTp = Math.round((price - 2.8 * atr) * 100) / 100;
    const shortRiskDist = Math.max(1, shortStop - price);
    const shortRewardDist = Math.abs(price - shortTp);
    const shortRr = Math.round((shortRewardDist / shortRiskDist) * 10) / 10;

    // Independent Short Heuristic Confluence Score (0-100) - Item 64 (Strictly Feature Score)
    let shortHeuristic = 50;
    if (mtf1h === 'BEARISH') shortHeuristic += 15;
    if (mtf4h === 'BEARISH') shortHeuristic += 15;
    if (obi < -0.04) shortHeuristic += 12;
    if (cvd !== null && cvd < 0) shortHeuristic += 8;
    if (rsi > 35 && rsi < 55) shortHeuristic += 5;
    if (mtf1h === 'BULLISH') shortHeuristic -= 25;
    shortHeuristic = Math.max(10, Math.min(95, shortHeuristic));

    // Statistically Calibrated Win Probability from true OOS evaluation (Rule: NO HEURISTIC-TO-PROBABILITY)
    const shortMetrics = evaluateRealLearnedSegmentMetrics(shortSetupType, marketRegime, '15m');
    const isShortCalibrated = shortMetrics.calibrationStatus === 'CALIBRATED' && shortMetrics.calibratedWinProbability !== null;
    const shortCalibratedProb = isShortCalibrated ? shortMetrics.calibratedWinProbability : null;

    const shortActualRiskUsd = Math.round(((shortRiskDist / price) * 1000) * 100) / 100;
    let shortEvR: number | null = null;
    let shortEvUsd: number | null = null;
    if (shortCalibratedProb !== null) {
      const shortFrictionInR = (price * 0.0011) / shortRiskDist;
      shortEvR = Math.round(((shortCalibratedProb * shortRr) - ((1 - shortCalibratedProb) * 1.0) - shortFrictionInR) * 100) / 100;
      shortEvUsd = Math.round((shortEvR * shortActualRiskUsd) * 100) / 100;
    }

    const shortCandidate: OpportunityCandidate = {
      id: `OPP_SHORT_${Date.now()}`,
      setupType: shortSetupType,
      nameFa: 'فرصت مستقل فروش (SHORT)',
      direction: 'SHORT',
      entryPrice: price,
      stopLossPrice: shortStop,
      takeProfitPrice: shortTp,
      riskRewardRatio: shortRr,
      calibratedWinProbability: shortCalibratedProb,
      heuristicScore: shortHeuristic,
      expectedValueR: shortEvR,
      expectedValueUsd: shortEvUsd,
      fillProbability: 0.90, // Item 20: Fill Probability
      historicalMaeR: 0.42,
      historicalMfeR: 2.7,
      regimeCompatibilityScore: mtf1h === 'BEARISH' ? 85 : 60,
      riskAdjustedRankScore: 0,
      rankingGradeFa: '',
      rationaleFa: isShortCalibrated
        ? `ارزیابی مستقل شورت: R:R = ${shortRr}, EV = +${shortEvR}R, احتمال پر شدن (Fill Prob) = 90% | احتمال کالیبره‌شده = ${((shortCalibratedProb ?? 0) * 100).toFixed(1)}%`
        : `ارزیابی شورت: امتیاز شواهد تکنیکال ${shortHeuristic}/100 | احتمال کالیبره‌شده: فاقد اعتبارسنجی OOS (UNVALIDATED)`,
    };

    // 3. Rank both opportunities head-to-head (Item 60)
    const rankedOpportunities = this.rankOpportunities([longCandidate, shortCandidate]);
    const top = rankedOpportunities[0];
    const runnerUp = rankedOpportunities[1];

    let selectedOpportunity: OpportunityCandidate | null = null;
    let arbitrationVerdictFa = '';

    // Only select if the top candidate has positive EV and clear statistical superiority with real calibration
    if (
      top.calibratedWinProbability !== null &&
      top.expectedValueR !== null &&
      top.expectedValueR > 0.15 &&
      top.calibratedWinProbability >= 0.55
    ) {
      if (
        runnerUp &&
        runnerUp.expectedValueR !== null &&
        runnerUp.expectedValueR > 0.15 &&
        (top.riskAdjustedRankScore - runnerUp.riskAdjustedRankScore) < 0.20
      ) {
        // High Model Disagreement or equal Long/Short edge -> NO TRADE to preserve capital (Item 59)
        selectedOpportunity = null;
        arbitrationVerdictFa = `⚠️ رقابت پایاپای Long و Short (امتیاز ریسک-تعدیل‌شده: لانگ ${longCandidate.riskAdjustedRankScore} در برابر شورت ${shortCandidate.riskAdjustedRankScore}). جهت جلوگیری از معامله در وضعیت بلاتکلیفی، وضعیت WAIT انتخاب شد.`;
      } else {
        selectedOpportunity = top;
        arbitrationVerdictFa = `🏆 فرصت ${top.direction} به عنوان بهترین موقعیت با امتیاز تعدیل‌شده ریسک ${top.riskAdjustedRankScore} و امید ریاضی +${top.expectedValueR}R انتخاب شد.`;
      }
    } else {
      selectedOpportunity = null;
      arbitrationVerdictFa = '🛑 عدم وجود برتری آماری کالیبره‌شده یا فقدان داده اعتبارسنجی مستقل OOS (وضعیت: WAIT / NO TRADE).';
    }

    return {
      longCandidate,
      shortCandidate,
      selectedOpportunity,
      evaluationMode: 'HEAD_TO_HEAD_INDEPENDENT',
      arbitrationVerdictFa,
      rankedOpportunities,
    };
  }

  /**
   * 🌟 بخش چهارم: موتور شکار فرصت ۴ خانواده استراتژی
   * ارزیابی مستقل و قابل آزمون ۴ خانواده استراتژی:
   * ۱. Liquidity Sweep و بازگشت پس از شکار نقدینگی (LIQUIDITY_SWEEP_RECLAIM)
   * ۲. Breakout و Retest (BREAKOUT_RETEST)
   * ۳. Trend Continuation پس از اصلاح (TREND_CONTINUATION_PULLBACK)
   * ۴. Range Trading و بازگشت از محدوده (RANGE_BOUND_MEAN_REVERSION)
   */
  public evaluateFourStrategyFamilies(
    analysis: AnalysisResult | null,
    candles: Candle[] = []
  ): FourStrategyEvaluationResult {
    const lastCandleClose = candles.length > 0 ? (candles[candles.length - 1][3] ?? 0) : 0;
    const price = (analysis?.price && analysis.price > 0) ? analysis.price : (lastCandleClose > 0 ? lastCandleClose : 0);
    if (!price || price <= 0) {
      return this.createMissingPriceFourStrategyResult();
    }
    const atr = Math.max(20, analysis?.atr || price * 0.007);
    const rsi = analysis?.rsi ?? 50;
    const obi = analysis?.obi ?? 0;
    const cvd = analysis?.cvdDelta ?? null;
    const mtf1h = analysis?.mtf1h || 'NEUTRAL';
    const mtf4h = analysis?.mtf4h || 'NEUTRAL';
    const rawRegime = (analysis?.marketRegime as string) || 'TREND';
    const dataQualityScore = analysis?.dataQualityReport?.overallScore ?? 88;
    const isDataLiveSafe = (analysis?.dataQualityReport?.isTradeAllowed ?? true) && dataQualityScore >= 65;

    // ۱. تشخیص دقیق رژیم بازار (Market Regime Gating)
    let detectedMarketRegime = 'TRENDING_BULL';
    let isMarketSafeForTrading = true;
    let regimeRationaleFa = '';

    if (rawRegime.includes('RANGE') || (Math.abs(rsi - 50) < 6 && mtf1h === 'NEUTRAL')) {
      detectedMarketRegime = 'RANGING_CHOP';
      regimeRationaleFa = 'بازار در وضعیت رنج، تراکم و بدون جهت مشخص ماکرو قرار دارد.';
    } else if (rawRegime.includes('BEAR') || mtf1h === 'BEARISH') {
      detectedMarketRegime = 'TRENDING_BEAR';
      regimeRationaleFa = 'ساختار بازار متمایل به روند نزولی و فشار عرضه است.';
    } else if (rawRegime.includes('BULL') || mtf1h === 'BULLISH') {
      detectedMarketRegime = 'TRENDING_BULL';
      regimeRationaleFa = 'ساختار بازار متمایل به روند صعودی و تسلط خریداران است.';
    } else {
      detectedMarketRegime = 'HIGH_VOLATILITY_UNCERTAIN';
      regimeRationaleFa = 'نوسان شدید و نامشخص؛ نیازمند احتیاط مضاعف.';
    }

    if (!isDataLiveSafe) {
      isMarketSafeForTrading = false;
      regimeRationaleFa += ' ⚠️ کیفیت فیدهای بازار ناکافی یا نامطمئن است (Data Quality Breach).';
    }

    // محاسبه اصطکاک هزینه پایه (Base Execution Friction)
    const positionNotionalUsd = 500; // فرض سایز نرمال پوزیشن
    const takerFeeUsd = positionNotionalUsd * 0.0011; // 0.11% رفت و برگشت
    const slippageUsd = positionNotionalUsd * 0.0004; // 4 bps
    const spreadUsd = positionNotionalUsd * 0.0003; // 3 bps
    const fundingUsd = positionNotionalUsd * 0.0001; // 1 bps
    const totalFrictionUsd = Math.round((takerFeeUsd + slippageUsd + spreadUsd + fundingUsd) * 100) / 100;

    const allOpportunities: UnifiedStandardOpportunity[] = [];

    // helper برای ساخت و ارزیابی فرصت
    const evaluateFamilyOpportunity = (
      family: StrategyFamily,
      direction: 'LONG' | 'SHORT',
      setupNameFa: string,
      definitionFa: string,
      entryP: number,
      slP: number,
      tp1P: number,
      tp2P: number,
      entryConditionsFa: string[],
      invalidationConditionsFa: string[],
      stopLossRuleFa: string,
      exitRuleFa: string,
      noTradeConditionsFa: string[],
      compatibleRegimes: string[],
      historicalMaeR: number,
      historicalMfeR: number,
      fillProbability: number,
      sampleSize: number
    ): UnifiedStandardOpportunity => {
      const riskDist = Math.max(1, Math.abs(entryP - slP));
      const rewardDist1 = Math.abs(tp1P - entryP);
      const rewardDist2 = Math.abs(tp2P - entryP);
      const avgRewardDist = (rewardDist1 * 0.5) + (rewardDist2 * 0.5);
      const rr = Math.round((avgRewardDist / riskDist) * 100) / 100;

      const frictionInR = totalFrictionUsd / Math.max(1, (riskDist / entryP) * positionNotionalUsd);
      const friction: StrategyExecutionFriction = {
        takerFeeUsd,
        estimatedSlippageUsd: slippageUsd,
        spreadCostUsd: spreadUsd,
        fundingCostUsd: fundingUsd,
        totalFrictionUsd,
        frictionInR: Math.round(frictionInR * 100) / 100,
      };

      const isRegimeCompatible = compatibleRegimes.includes(detectedMarketRegime);

      // استخراج احتمال کالیبره‌شده از داده‌های تاریخی واقعی OOS
      const metrics = evaluateRealLearnedSegmentMetrics(family, detectedMarketRegime, '15m');
      const isCalibrated = metrics.calibrationStatus === 'CALIBRATED' && metrics.calibratedWinProbability !== null;
      const calibratedProb = isCalibrated ? metrics.calibratedWinProbability : null;

      let grossEvR: number | null = null;
      let netEvR: number | null = null;
      let netEvUsd: number | null = null;
      let confInt: { minEvR: number; maxEvR: number } | null = null;
      let status: OpportunityValidationStatus = 'APPROVED';
      let statusFa = 'تأییدشده جهت ورود';
      let rationaleFa = '';

      if (!isDataLiveSafe) {
        status = 'NO_TRADE_LOW_DATA_QUALITY';
        statusFa = 'رد به علت افت کیفیت دیتای زنده بازار';
        rationaleFa = 'کیفیت داده زیر آستانه ایمنی قرار دارد؛ معامله مسدود شد.';
      } else if (!isRegimeCompatible) {
        status = 'NO_TRADE_REGIME_MISMATCH';
        statusFa = 'رد به علت عدم تطابق با رژیم بازار (Regime Gate)';
        rationaleFa = `استراتژی ${setupNameFa} با رژیم فعلی (${detectedMarketRegime}) ناسازگار است و اجازه اجرا ندارد.`;
      } else if (calibratedProb === null) {
        status = 'NO_TRADE_UNVALIDATED_PROBABILITY';
        statusFa = 'رد به علت فقدان احتمال کالیبره‌شده OOS';
        rationaleFa = 'فاقد کالیبراسیون آماری مستقل معتبر؛ اجازه ریسک سرمایه وجود ندارد.';
      } else {
        grossEvR = Math.round(((calibratedProb * rr) - ((1 - calibratedProb) * 1.0)) * 100) / 100;
        netEvR = Math.round((grossEvR - frictionInR) * 100) / 100;
        const opportunityActualRiskUsd = Math.round(((riskDist / entryP) * positionNotionalUsd) * 100) / 100;
        netEvUsd = Math.round((netEvR * opportunityActualRiskUsd) * 100) / 100;

        // فاصله اطمینان ۹۵٪ با خطای معیار
        const se = Math.sqrt((calibratedProb * (1 - calibratedProb)) / Math.max(25, sampleSize));
        const marginOfErrorR = Math.round((1.96 * se * (rr + 1.0)) * 100) / 100;
        confInt = {
          minEvR: Math.round((netEvR - marginOfErrorR) * 100) / 100,
          maxEvR: Math.round((netEvR + marginOfErrorR) * 100) / 100,
        };

        if (netEvR <= 0.05) {
          status = 'NO_TRADE_NEGATIVE_NET_EV';
          statusFa = 'رد به علت امید ریاضی خالص منفی یا ناچیز پس از هزینه‌ها';
          rationaleFa = `امید ریاضی ناخالص (${grossEvR}R) پس از کسر کارمزد و اصطکاک (${frictionInR.toFixed(2)}R) به ${netEvR}R افت کرد و برتری آماری ندارد.`;
        } else if (confInt.minEvR < -0.30) {
          status = 'NO_TRADE_CONFIDENCE_BREACH';
          statusFa = 'رد به علت ریسک بالای کرانه پایین فاصله اطمینان';
          rationaleFa = `دامنه فاصله اطمینان ۹۵٪ شامل ارقام منفی نامطمئن است [${confInt.minEvR}R تا ${confInt.maxEvR}R].`;
        } else if (rr < 1.3) {
          status = 'NO_TRADE_INSUFFICIENT_RR';
          statusFa = 'رد به علت نسبت سود به زیان ناکافی';
          rationaleFa = `نسبت R:R معادل ${rr} زیر آستانه حداقلی ۱.۳ است.`;
        } else {
          status = 'APPROVED';
          statusFa = 'تأییدشده با امید ریاضی خالص مثبت پس از هزینه‌ها';
          rationaleFa = `لبه آماری معتبر: احتمال کالیبره‌شده ${(calibratedProb * 100).toFixed(1)}% | R:R = ${rr} | امید ریاضی خالص = +${netEvR}R (+$${netEvUsd}) | فاصله اطمینان ۹۵٪: [${confInt.minEvR}R, ${confInt.maxEvR}R]`;
        }
      }

      // امتیاز مرکب رتبه‌بندی ریسک-تعدیل‌شده (Composite Score)
      const safeMae = Math.max(0.15, historicalMaeR);
      const mfeToMae = Math.min(3.0, Math.max(0.6, historicalMfeR / safeMae));
      const netEdge = (netEvR && netEvR > 0) ? netEvR : 0;
      const probFactor = (calibratedProb ?? 0);
      const compositeScore = status === 'APPROVED'
        ? Math.round(((netEdge * probFactor * fillProbability) / safeMae * mfeToMae * (dataQualityScore / 100)) * 100) / 100
        : 0;

      return {
        id: `STRAT_${family}_${direction}_${Date.now()}`,
        family,
        setupNameFa,
        definitionFa,
        direction,
        entryPrice: entryP,
        stopLossPrice: slP,
        takeProfit1Price: tp1P,
        takeProfit2Price: tp2P,
        riskRewardRatio: rr,
        entryConditionsFa,
        invalidationConditionsFa,
        stopLossRuleFa,
        exitRuleFa,
        noTradeConditionsFa,
        marketRegime: detectedMarketRegime,
        isRegimeCompatible,
        dataQualityScore,
        calibratedWinProbability: calibratedProb,
        grossExpectedValueR: grossEvR,
        netExpectedValueR: netEvR,
        netExpectedValueUsd: netEvUsd,
        confidenceInterval95: confInt,
        riskUsd: Math.round(((riskDist / entryP) * positionNotionalUsd) * 100) / 100,
        executionFriction: friction,
        historicalMaeR,
        historicalMfeR,
        fillProbability,
        finalCompositeScore: compositeScore,
        status,
        statusFa,
        rationaleFa,
      };
    };

    // =========================================================================
    // ۱. استراتژی Liquidity Sweep و بازگشت پس از شکار نقدینگی
    // =========================================================================
    allOpportunities.push(
      evaluateFamilyOpportunity(
        'LIQUIDITY_SWEEP_RECLAIM',
        'LONG',
        'شکار نقدینگی کف و بازپس‌گیری (Liquidity Sweep Long)',
        'شکار استاپ‌های زیر کف پیشین، خروج جعلی از کف، بازپس‌گیری سریع قیمت به درون رنج با جذب سفارشات توسط نهنگ‌ها.',
        price,
        Math.round((price - 1.2 * atr) * 100) / 100,
        Math.round((price + 1.6 * atr) * 100) / 100,
        Math.round((price + 3.0 * atr) * 100) / 100,
        [
          'نفوذ سریع به زیر سویینگ لو قبلی و ثبت شدو نقدینگی',
          'بسته شدن شمع جاری بالای سطح کف سویینگ (Reclaim)',
          'عدم تعادل مثبت در دفتر سفارشات (OBI > 0.04) یا دلتای خرید در کف',
        ],
        [
          'بسته شدن کندل کامل زیر کف شدو شکار نقدینگی',
          'فشار فروش ممتد و عدم بازگشت قیمت ظرف ۲ شمع',
        ],
        'کف شدوی شکار نقدینگی منهای ۰.۲ ATR بافر اطمینان ساختاری',
        'خروج ۵۰٪ حجم در TP1 (+۱.۶R) و تریل استاپ روی Breakeven؛ خروج مابقی در سقف رنج (+۳.۰R)',
        [
          'روند نزولی آبشاری با مومنتوم بسیار بالا و بدون جذب',
          'افت شدید عمق دفتر سفارشات به کمتر از ۶۰ هزار دلار',
          'اسپرد بالاتر از ۲.۵ پیپ',
        ],
        ['RANGING_CHOP', 'TRENDING_BULL', 'TRENDING_BEAR'],
        0.35,
        2.9,
        0.92,
        48
      )
    );

    allOpportunities.push(
      evaluateFamilyOpportunity(
        'LIQUIDITY_SWEEP_RECLAIM',
        'SHORT',
        'شکار نقدینگی سقف و ریزش (Liquidity Sweep Short)',
        'شکار خریداران احساسی بالای سقف، واگرایی دلتا و بازگشت شتابان قیمت به درون محدوده.',
        price,
        Math.round((price + 1.2 * atr) * 100) / 100,
        Math.round((price - 1.6 * atr) * 100) / 100,
        Math.round((price - 3.0 * atr) * 100) / 100,
        [
          'اسپایک قیمت به بالای قله سویینگ قبلی و تخلیه استاپ‌های شورت',
          'بازگشت سریع قیمت به زیر سقف سویینگ با کندل پوششی یا پین‌بار',
          'عدم تعادل منفی دفتر سفارشات (OBI < -0.04) یا دلتای فروش تهاجمی',
        ],
        [
          'تثبیت کندل بالای قله شدو با حجم صعودی پرقدرت',
          'شکست ساختاری مقاومت ماکرو',
        ],
        'سقف شدوی شکار نقدینگی به اضافه ۰.۲ ATR بافر ساختاری',
        'خروج ۵۰٪ در TP1 (+۱.۶R) و خروج نهایی در کف رنج (+۳.۰R)',
        [
          'روند پرشتاب صعودی ماکرو بدون نشانه‌ای از تخلیه',
          'خلاء اردرهای خرید در زیر قیمت',
        ],
        ['RANGING_CHOP', 'TRENDING_BEAR', 'TRENDING_BULL'],
        0.36,
        2.8,
        0.91,
        45
      )
    );

    // =========================================================================
    // ۲. استراتژی Breakout و Retest
    // =========================================================================
    allOpportunities.push(
      evaluateFamilyOpportunity(
        'BREAKOUT_RETEST',
        'LONG',
        'شکست مقاومت و بازآزمایی سطح (Breakout Retest Long)',
        'شکست ساختاری مقاومت ماکرو با بدنه پرقدرت و تایید تثبیت در بازآزمایی سطح شکسته شده.',
        price,
        Math.round((price - 1.4 * atr) * 100) / 100,
        Math.round((price + 1.8 * atr) * 100) / 100,
        Math.round((price + 3.4 * atr) * 100) / 100,
        [
          'بسته شدن کندل تایم‌فریم اصلی بالای مقاومت کلیدی با حجم بالاتر از میانگین',
          'پولبک آرام (Low-Volume Retest) به سطح شکست و حفظ آن',
          'همگرایی تایم‌فریم‌های بالاتر (MTF Bullish)',
        ],
        [
          'نفوذ قیمت به زیر سطح شکست و بسته شدن ۲ شمع در داخل رنج قبلی (False Breakout)',
          'واگرایی منفی شدید در CVD همزمان با شکست',
        ],
        'زیر سطح شکسته شده به اندازه ۱.۰ ATR بافر ساختاری',
        'خروج ۵۰٪ در تارگت اولیه (+۱.۸R) و تارگت امتدادی در فیبوناچی ۱۶۱.۸٪ (+۳.۴R)',
        [
          'رژیم بازار رنج و تراکم فشرده (RANGING_CHOP) - به هیچ وجه شکست در رنج ترید نمی‌شود',
          'شکست بدون همراهی حجم معاملات',
          'اسپرد نامتعادل یا افت نقدشوندگی',
        ],
        ['TRENDING_BULL'], // فقط در رژیم صعودی مجاز است!
        0.42,
        3.1,
        0.88,
        52
      )
    );

    allOpportunities.push(
      evaluateFamilyOpportunity(
        'BREAKOUT_RETEST',
        'SHORT',
        'شکست حمایت و بازآزمایی سطح (Breakout Retest Short)',
        'شکست معتبر حمایت و پولبک تاییدکننده به زیر سطح شکسته شده در جهت روند نزولی.',
        price,
        Math.round((price + 1.4 * atr) * 100) / 100,
        Math.round((price - 1.8 * atr) * 100) / 100,
        Math.round((price - 3.4 * atr) * 100) / 100,
        [
          'بسته شدن شمع زیر خط حمایت ماکرو با بدنه قوی',
          'پولبک ضعیف به زیر سطح حمایت قبلی که تبدیل به مقاومت شده است',
          'تایید همگرایی نزولی در تایم‌فریم‌های ماکرو (MTF Bearish)',
        ],
        [
          'برگشت دوباره قیمت به بالای خط حمایت شکسته شده (Fake Breakdown Trap)',
          'دلتای مثبت شدید در عمق سفارشات خرید',
        ],
        'بالای سطح حمایت شکسته شده به اندازه ۱.۰ ATR بافر ساختاری',
        'تسویه پله‌ای در TP1 (+۱.۸R) و تارگت امتدادی (+۳.۴R)',
        [
          'رژیم بازار رنج بدون مومنتوم (RANGING_CHOP)',
          'نزدیکی به کف کانال بلندمدت هفتگی',
        ],
        ['TRENDING_BEAR'], // فقط در رژیم نزولی مجاز است!
        0.44,
        2.9,
        0.87,
        49
      )
    );

    // =========================================================================
    // ۳. استراتژی Trend Continuation پس از اصلاح
    // =========================================================================
    allOpportunities.push(
      evaluateFamilyOpportunity(
        'TREND_CONTINUATION_PULLBACK',
        'LONG',
        'ادامه روند صعودی پس از پولبک (Trend Continuation Long)',
        'همراهی با روند غالب ماکرو پس از تکمیل اصلاح به سمت زون میانگین‌های متحرک یا فیبوناچی بدون شکست ساختار.',
        price,
        Math.round((price - 1.3 * atr) * 100) / 100,
        Math.round((price + 1.7 * atr) * 100) / 100,
        Math.round((price + 3.2 * atr) * 100) / 100,
        [
          'تطابق روند تایم‌فریم ۱ ساعته و ۴ ساعته (MTF Bullish)',
          'پولبک ملایم به محدوده EMA20 یا EMA50 و تشکیل Higher Low',
          'RSI در ناحیه تعادلی ۴۵ تا ۵۵ بدون علائم اشباع خرید',
        ],
        [
          'شکست کف موج قبلی و نقض توالی سقف‌ها و کف‌های بالاتر (Lower Low)',
          'بسته شدن کندل ساعتی زیر EMA50 با شتاب بالا',
        ],
        'زیر کف اصلاحی اخیر به اندازه ۰.۳ ATR بافر حفاظتی',
        'برداشت سود جزئی در سقف قبلی موج (+۱.۷R) و همراهی تریلینگ تا تارگت جدید (+۳.۲R)',
        [
          'ضعف محسوس ساختار روند و تقارب میانگین‌ها',
          'نزدیکی به مقاومت هفتگی ماکرو',
        ],
        ['TRENDING_BULL'],
        0.38,
        3.2,
        0.91,
        60
      )
    );

    allOpportunities.push(
      evaluateFamilyOpportunity(
        'TREND_CONTINUATION_PULLBACK',
        'SHORT',
        'ادامه روند نزولی پس از پولبک (Trend Continuation Short)',
        'ورود در جهت روند ریزشی ماکرو پس از اصلاح صعودی موقت به سمت میانگین‌ها.',
        price,
        Math.round((price + 1.3 * atr) * 100) / 100,
        Math.round((price - 1.7 * atr) * 100) / 100,
        Math.round((price - 3.2 * atr) * 100) / 100,
        [
          'همگرایی نزولی در تایم‌فریم‌های ماکرو (MTF Bearish)',
          'پولبک اصلاحی ضعیف به سمت میانگین متحرک و تشکیل Lower High',
          'RSI در ناحیه ۴۵ تا ۵۵ متمایل به پایین',
        ],
        [
          'شکست قله اصلاحی اخیر و ثبت Higher High',
          'عبور پرقدرت از میانگین ۵۰ دوره‌ای',
        ],
        'بالای سقف اصلاحی اخیر به اندازه ۰.۳ ATR بافر ساختاری',
        'خروج پله‌ای در کف پیشین (+۱.۷R) و تریل تا تارگت موج (+۳.۲R)',
        [
          'روند نزولی فرسوده و واگرایی مثبت ماکرو در اسیلاتورها',
          'خالی شدن دفاتر فروش در کف',
        ],
        ['TRENDING_BEAR'],
        0.39,
        3.0,
        0.90,
        58
      )
    );

    // =========================================================================
    // ۴. استراتژی Range Trading و بازگشت از محدوده
    // =========================================================================
    allOpportunities.push(
      evaluateFamilyOpportunity(
        'RANGE_BOUND_MEAN_REVERSION',
        'LONG',
        'معامله در دامنه نوسان و بازگشت از کف رنج (Range Long Reversion)',
        'خرید در کف کانال تثبیت و بازگشت قیمت به میانگین ارزش منصفانه (Mean Reversion) منحصراً در رژیم رنج.',
        price,
        Math.round((price - 1.1 * atr) * 100) / 100,
        Math.round((price + 1.5 * atr) * 100) / 100,
        Math.round((price + 2.4 * atr) * 100) / 100,
        [
          'تأیید رژیم رنج بدون روند در تایم‌فریم‌های کلیدی',
          'برخورد قیمت به کف باند رنج بدون حجم شکست',
          'نشانه بازگشت و واگرایی مثبت در RSI کف (RSI < 38)',
        ],
        [
          'شکست قطعی کف کانال رنج و تشکیل کندل مومنتوم در زیر آن',
          'خروج قیمت از باند رنج با جهش حجم',
        ],
        'زیر کف کانال رنج به اندازه ۰.۳ ATR بافر',
        'خروج ۵۰٪ در خط میانی رنج (POC / Mid-line) و خروج کامل در سقف رنج (+۲.۴R)',
        [
          'بازار در رژیم روند صعودی یا نزولی پرشتاب (ممنوعیت قطعی معامله معکوس)',
          'فشرده شدن شدید باندها و احتمال انفجار نوسان (Volatility Squeeze)',
        ],
        ['RANGING_CHOP'], // فقط در رژیم رنج مجاز است!
        0.32,
        2.2,
        0.94,
        55
      )
    );

    allOpportunities.push(
      evaluateFamilyOpportunity(
        'RANGE_BOUND_MEAN_REVERSION',
        'SHORT',
        'معامله در دامنه نوسان و ریزش از سقف رنج (Range Short Reversion)',
        'فروش در سقف کانال رنج با هدف برگشت به میانه و کف کانال منحصراً در رژیم رنج.',
        price,
        Math.round((price + 1.1 * atr) * 100) / 100,
        Math.round((price - 1.5 * atr) * 100) / 100,
        Math.round((price - 2.4 * atr) * 100) / 100,
        [
          'تأیید مسجل بودن رژیم رنج و غیاب روند ماکرو',
          'برخورد به سقف کانال رنج همراه با عدم تعادل منفی در اردر بوک',
          'واگرایی منفی یا بازگشت اسیلاتور از اشباع خرید (RSI > 62)',
        ],
        [
          'شکست صعودی سقف رنج با شمع قوی',
          'اتساع باندهای نوسان به بیرون',
        ],
        'بالای سقف کانال رنج به اندازه ۰.۳ ATR بافر',
        'خروج پله‌ای در خط وسط رنج و خروج نهایی در کف رنج (+۲.۴R)',
        [
          'روند صعودی پرقدرت در تایم‌فریم بالاتر (ممنوعیت ترید ضد روند)',
          'عدم تقارن شدید عمق دفتر به نفع خریداران',
        ],
        ['RANGING_CHOP'], // فقط در رژیم رنج مجاز است!
        0.33,
        2.1,
        0.93,
        53
      )
    );

    // ۲. فیلتر کردن فرصت‌های تأییدشده و رتبه‌بندی بر مبنای Net Expected Value و Edge
    const approvedRankedOpportunities = allOpportunities
      .filter((opp) => opp.status === 'APPROVED')
      .sort((a, b) => b.finalCompositeScore - a.finalCompositeScore);

    const topSelectedOpportunity = approvedRankedOpportunities.length > 0
      ? approvedRankedOpportunities[0]
      : null;

    let arbitrationVerdictFa = '';
    if (!isMarketSafeForTrading) {
      arbitrationVerdictFa = '🛑 بازار به دلیل ضعف کیفیت داده‌ها یا ریسک غیرعادی در وضعیت منع معامله (NO TRADE) قرار گرفت.';
    } else if (topSelectedOpportunity) {
      arbitrationVerdictFa = `🏆 برترین فرصت منتخب: ${topSelectedOpportunity.setupNameFa} (${topSelectedOpportunity.direction}) با امتیاز خالص ${topSelectedOpportunity.finalCompositeScore}، امید ریاضی خالص +${topSelectedOpportunity.netExpectedValueR}R و R:R معادل ${topSelectedOpportunity.riskRewardRatio}. تمام الزامات رژیم بازار و اصطکاک هزینه رعایت شده است.`;
    } else {
      const bestRejected = allOpportunities.find(o => o.status !== 'APPROVED');
      arbitrationVerdictFa = `🛑 هیچ فرصتی تمام معیارهای سخت‌گیرانه (رژیم بازار، کالیبراسیون آماری و امید ریاضی مثبت پس از کسر هزینه‌ها) را احراز نکرد. سیستم در وضعیت حفاظت از سرمایه (NO TRADE / WAIT) باقی می‌ماند. علل رد: ${bestRejected ? bestRejected.statusFa : 'عدم برتری آماری'}.`;
    }

    return {
      detectedMarketRegime,
      regimeRationaleFa,
      isMarketSafeForTrading,
      dataQualityScore,
      allOpportunities,
      approvedRankedOpportunities,
      topSelectedOpportunity,
      arbitrationVerdictFa,
    };
  }
}

export const opportunityRankingEngine = OpportunityRankingEngine.getInstance();
