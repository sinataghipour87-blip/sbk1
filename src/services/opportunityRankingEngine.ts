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

  /**
   * Evaluates LONG and SHORT completely independently from raw features (Items 61, 62, 63)
   * Strictly avoids direction bias and circular reasoning.
   */
  public evaluateDualIndependentDirections(
    analysis: AnalysisResult | null,
    candles: Candle[] = []
  ): DualDirectionEvaluationResult {
    const price = analysis?.price || (candles.length > 0 ? candles[candles.length - 1][3] : 88500);
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
      longEvUsd = Math.round((longEvR * 50) * 100) / 100;
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

    let shortEvR: number | null = null;
    let shortEvUsd: number | null = null;
    if (shortCalibratedProb !== null) {
      const shortFrictionInR = (price * 0.0011) / shortRiskDist;
      shortEvR = Math.round(((shortCalibratedProb * shortRr) - ((1 - shortCalibratedProb) * 1.0) - shortFrictionInR) * 100) / 100;
      shortEvUsd = Math.round((shortEvR * 50) * 100) / 100;
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
}

export const opportunityRankingEngine = OpportunityRankingEngine.getInstance();
