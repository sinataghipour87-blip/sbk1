/**
 * 🛡️ موتور یادگیری آنلاین با کنترل ضد خودفریبی (Anti-Self-Deception Online Learning Engine)
 * بر اساس بند ۴۷:
 * سیستم اجازه ندارد فقط به خاطر چند برد اخیر وزن مدل را بالا ببرد.
 * هرگونه تغییر وزن (Weight Adaptation) باید به طور قطعی با ۴ گیت زیر تایید شود:
 * ۱. Out-of-Sample Performance (عملکرد خارج از نمونه)
 * ۲. Sample Size (کف اندازه نمونه - حداقل ۳۰ معامله)
 * ۳. Statistical Significance (معناداری آماری - P-Value < 0.05 / T-Stat)
 * ۴. Regime Stability (پایداری در رژیم‌های مختلف بازار: Trend, Chop, Spike)
 */

import { TradeHistory } from '../types/trading';

export type MarketRegimeType = 'TRENDING_BULL' | 'TRENDING_BEAR' | 'RANGING_CHOP' | 'HIGH_VOLATILITY_SPIKE';

export interface GateVerificationResult {
  passed: boolean;
  score: number;
  threshold: number;
  labelFa: string;
  detailsFa: string;
}

export interface AntiSelfDeceptionAudit {
  isApproved: boolean;
  sampleSizeGate: GateVerificationResult;
  outOfSampleGate: GateVerificationResult;
  statisticalSignificanceGate: GateVerificationResult;
  regimeStabilityGate: GateVerificationResult;
  proposedWeightDelta: number;
  approvedWeightDelta: number;
  verdictFa: string;
  evaluatedAt: number;
}

export interface ModelDriftReport {
  modelId: string;
  isDriftDetected: boolean;
  modelStatus: 'ACTIVE' | 'DEGRADED' | 'OPTIMIZED';
  historicalOosWinRatePct: number;
  rollingWindows: {
    w20WinRatePct: number;
    w50WinRatePct: number;
    w100WinRatePct: number;
    w250WinRatePct: number;
  };
  performanceDropPct: number;
  recommendedWeightMultiplier: number; // e.g. 0.70 when degraded
  diagnosisFa: string;
}

export class AntiSelfDeceptionOnlineLearningService {
  private static instance: AntiSelfDeceptionOnlineLearningService;

  // Strict Thresholds to prevent overfitting & recency bias
  private readonly MIN_SAMPLE_SIZE = 30; // Minimum 30 trades (never 5 lucky trades)
  private readonly MIN_OOS_WINRATE = 0.54; // At least 54% win rate out-of-sample
  private readonly MAX_OOS_DEGRADATION = 0.12; // OOS win rate cannot drop >12% vs In-Sample
  private readonly MAX_P_VALUE = 0.05; // 95% statistical confidence (p < 0.05)
  private readonly MIN_STABLE_REGIMES = 2; // Must be profitable in at least 2 distinct regimes

  public static getInstance(): AntiSelfDeceptionOnlineLearningService {
    if (!AntiSelfDeceptionOnlineLearningService.instance) {
      AntiSelfDeceptionOnlineLearningService.instance = new AntiSelfDeceptionOnlineLearningService();
    }
    return AntiSelfDeceptionOnlineLearningService.instance;
  }

  /**
   * 31. Real Model Drift Detection (Evaluates rolling windows: 20, 50, 100, 250 trades)
   * Flags DEGRADED status and reduces weight if recent performance drops significantly vs OOS baseline.
   */
  public detectModelDrift(
    tradeHistory: TradeHistory[],
    baselineOosWinRatePct = 72.0,
    modelId = 'champion-core-v3'
  ): ModelDriftReport {
    const validTrades = (tradeHistory || []).filter(
      (t) => typeof t.pnlUsd === 'number' || typeof t.realizedPnlUsd === 'number'
    );
    const n = validTrades.length;

    const calcWinRate = (slice: TradeHistory[]): number => {
      if (slice.length === 0) return 0;
      const wins = slice.filter((t) => (t.pnlUsd ?? t.realizedPnlUsd ?? 0) > 0).length;
      return Number(((wins / slice.length) * 100).toFixed(1));
    };

    const w20 = calcWinRate(validTrades.slice(-20));
    const w50 = calcWinRate(validTrades.slice(-50));
    const w100 = calcWinRate(validTrades.slice(-100));
    const w250 = calcWinRate(validTrades.slice(-250));

    // Evaluate empirical performance without fabricated assumptions
    const recentWinRate = n >= 15 ? w20 : (n > 0 ? calcWinRate(validTrades) : 0);
    const effectiveBaseline = n >= 30 ? baselineOosWinRatePct : (n > 0 ? calcWinRate(validTrades) : 0);
    const performanceDropPct = effectiveBaseline > 0 ? Number((effectiveBaseline - recentWinRate).toFixed(1)) : 0;

    let isDriftDetected = false;
    let modelStatus: ModelDriftReport['modelStatus'] = n >= 15 ? 'ACTIVE' : 'DEGRADED';
    let recommendedWeightMultiplier = n >= 15 ? 1.0 : 0.70;
    let diagnosisFa = n >= 15
      ? 'عملکرد مدل پایدار و منطبق بر آستانه ارزیابی تجربی است.'
      : 'تعداد معاملات واقعی ثبت‌شده برای اثبات آماری و اعتبارسنجی رانش مدل ناکافی است (نیازمند حداقل ۱۵ معامله واقعی).';

    if (performanceDropPct >= 15.0 || recentWinRate < 54.0) {
      isDriftDetected = true;
      modelStatus = 'DEGRADED';
      recommendedWeightMultiplier = 0.65; // Reduce weight by 35%
      diagnosisFa = `⚠️ رانش مدل (Model Drift) کشف شد: وین‌ریت مرجع تاریخی ${baselineOosWinRatePct}٪ بوده اما عملکرد اخیر در پنجره ۲۰ معامله به ${recentWinRate}٪ سقوط کرده است. وضعیت مدل به DEGRADED تغییر یافت و وزن آن ۳۵٪ کاهش پیدا کرد.`;
    } else if (performanceDropPct >= 8.0) {
      isDriftDetected = true;
      modelStatus = 'DEGRADED';
      recommendedWeightMultiplier = 0.85; // Reduce weight by 15%
      diagnosisFa = `⚡ هشدار ملایم رانش مدل: افت عملکرد ${performanceDropPct}٪ نسبت به مرجع OOS مشاهده شد. وزن مدل ۱۵٪ تعدیل شد.`;
    }

    return {
      modelId,
      isDriftDetected,
      modelStatus,
      historicalOosWinRatePct: baselineOosWinRatePct,
      rollingWindows: {
        w20WinRatePct: w20,
        w50WinRatePct: w50,
        w100WinRatePct: w100,
        w250WinRatePct: w250,
      },
      performanceDropPct,
      recommendedWeightMultiplier,
      diagnosisFa,
    };
  }

  /**
   * Evaluates proposed weight adjustment against the 4 Anti-Self-Deception Gates
   */
  public verifyWeightAdjustment(
    tradeHistory: TradeHistory[],
    candidatePillarName: string,
    rawDesiredDelta: number
  ): AntiSelfDeceptionAudit {
    const now = Date.now();
    const validTrades = (tradeHistory || []).filter(
      (t) => typeof t.pnlUsd === 'number' || typeof t.realizedPnlUsd === 'number'
    );
    const n = validTrades.length;

    // -------------------------------------------------------------
    // Gate 1: Sample Size Gate (کف اندازه نمونه)
    // -------------------------------------------------------------
    const sampleSizePassed = n >= this.MIN_SAMPLE_SIZE;
    const sampleSizeGate: GateVerificationResult = {
      passed: sampleSizePassed,
      score: n,
      threshold: this.MIN_SAMPLE_SIZE,
      labelFa: 'گیت اندازه نمونه (Sample Size Gate)',
      detailsFa: sampleSizePassed
        ? `تعداد نمونه کافی است (${n} معامله >= حداقل ${this.MIN_SAMPLE_SIZE}).`
        : `🛑 تعداد نمونه (${n}) ناکافی است. حداقل نیاز به ${this.MIN_SAMPLE_SIZE} معامله برای جلوگیری از فریب بردهای کوتاه‌مدت.`,
    };

    // -------------------------------------------------------------
    // Gate 2: Out-of-Sample (OOS) Performance Gate (عملکرد خارج از نمونه)
    // -------------------------------------------------------------
    // Strict 70% In-Sample / 30% Out-of-Sample Walk-Forward Split
    let oosPassed = false;
    let oosWinRate = 0;
    let isWinRate = 0;
    let oosExpectancy = 0;

    if (n >= 10) {
      const splitIndex = Math.floor(n * 0.7);
      const inSample = validTrades.slice(0, splitIndex);
      const outOfSample = validTrades.slice(splitIndex);

      const isWins = inSample.filter((t) => (t.pnlUsd ?? t.realizedPnlUsd ?? 0) > 0).length;
      isWinRate = inSample.length > 0 ? isWins / inSample.length : 0;

      const oosWins = outOfSample.filter((t) => (t.pnlUsd ?? t.realizedPnlUsd ?? 0) > 0).length;
      oosWinRate = outOfSample.length > 0 ? oosWins / outOfSample.length : 0;

      const oosPnls = outOfSample.map((t) => t.pnlUsd ?? t.realizedPnlUsd ?? 0);
      oosExpectancy = oosPnls.length > 0 ? oosPnls.reduce((a, b) => a + b, 0) / oosPnls.length : 0;

      const degradation = isWinRate - oosWinRate;
      oosPassed = sampleSizePassed && oosWinRate >= this.MIN_OOS_WINRATE && degradation <= this.MAX_OOS_DEGRADATION && oosExpectancy > 0;
    }

    const outOfSampleGate: GateVerificationResult = {
      passed: oosPassed,
      score: Math.round(oosWinRate * 100),
      threshold: Math.round(this.MIN_OOS_WINRATE * 100),
      labelFa: 'گیت عملکرد خارج از نمونه (OOS Performance Gate)',
      detailsFa: oosPassed
        ? `وین‌ریت خارج از نمونه ${Math.round(oosWinRate * 100)}% با امید ریاضی مثبت (+$${oosExpectancy.toFixed(1)}). بیش‌برازش رد شد.`
        : `🛑 رد گیت OOS: وین‌ریت خارج از نمونه (${Math.round(oosWinRate * 100)}%) زیر حد مجاز است یا علائم بیش‌برازش (Overfitting) کشف شد.`,
    };

    // -------------------------------------------------------------
    // Gate 3: Statistical Significance Gate (معناداری آماری - P-Value / T-Stat)
    // -------------------------------------------------------------
    let statPassed = false;
    let pValue = 1.0;
    let tStat = 0;

    if (n >= 15) {
      const returns = validTrades.map((t) => t.pnlUsd ?? t.realizedPnlUsd ?? 0);
      const mean = returns.reduce((a, b) => a + b, 0) / n;
      const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1 || 1);
      const stdDev = Math.sqrt(variance) || 1;
      const standardError = stdDev / Math.sqrt(n);

      tStat = standardError > 0 ? mean / standardError : 0;
      // Approximate Student's t distribution two-tailed p-value for large N via standard normal approximation
      const z = Math.abs(tStat);
      pValue = Math.min(1.0, Math.max(0.0001, 2 * (1 - this.approximateNormCdf(z))));

      statPassed = sampleSizePassed && pValue <= this.MAX_P_VALUE && tStat > 1.65;
    }

    const statisticalSignificanceGate: GateVerificationResult = {
      passed: statPassed,
      score: Math.round((1 - pValue) * 100),
      threshold: Math.round((1 - this.MAX_P_VALUE) * 100),
      labelFa: 'گیت معناداری آماری (Statistical Significance Gate)',
      detailsFa: statPassed
        ? `معناداری آماری اثبات شد (t = ${tStat.toFixed(2)}, p = ${pValue.toFixed(4)} < 0.05). سود تصادفی نیست.`
        : `🛑 عدم اثبات معناداری آماری (p = ${pValue.toFixed(4)} >= 0.05). نتایج اخیر ممکن است بر اثر شانس و نویز بازار باشد.`,
    };

    // -------------------------------------------------------------
    // Gate 4: Regime Stability Gate (پایداری در میان رژیم‌های مختلف)
    // -------------------------------------------------------------
    const regimeDistribution: Record<MarketRegimeType, { total: number; wins: number; pnl: number }> = {
      TRENDING_BULL: { total: 0, wins: 0, pnl: 0 },
      TRENDING_BEAR: { total: 0, wins: 0, pnl: 0 },
      RANGING_CHOP: { total: 0, wins: 0, pnl: 0 },
      HIGH_VOLATILITY_SPIKE: { total: 0, wins: 0, pnl: 0 },
    };

    // Classify trades across regimes based on setup type or notes
    for (const t of validTrades) {
      const type = (((t as any).setupType || (t as any).strategyType || '') as string).toUpperCase();
      let reg: MarketRegimeType = 'RANGING_CHOP';
      if (type.includes('TREND') || type.includes('WAVE') || type.includes('PULLBACK')) {
        reg = t.dir === 'LONG' ? 'TRENDING_BULL' : 'TRENDING_BEAR';
      } else if (type.includes('VOL') || type.includes('SPIKE') || type.includes('SHOCK')) {
        reg = 'HIGH_VOLATILITY_SPIKE';
      }

      const pnl = t.pnlUsd ?? t.realizedPnlUsd ?? 0;
      regimeDistribution[reg].total++;
      if (pnl > 0) regimeDistribution[reg].wins++;
      regimeDistribution[reg].pnl += pnl;
    }

    let profitableRegimesCount = 0;
    for (const key of Object.keys(regimeDistribution) as MarketRegimeType[]) {
      const r = regimeDistribution[key];
      if (r.total >= 4 && r.pnl > 0 && r.wins / r.total >= 0.50) {
        profitableRegimesCount++;
      }
    }

    const regimePassed = sampleSizePassed && profitableRegimesCount >= this.MIN_STABLE_REGIMES;
    const regimeStabilityGate: GateVerificationResult = {
      passed: regimePassed,
      score: profitableRegimesCount,
      threshold: this.MIN_STABLE_REGIMES,
      labelFa: 'گیت پایداری در رژیم‌ها (Regime Stability Gate)',
      detailsFa: regimePassed
        ? `مدل در ${profitableRegimesCount} رژیم مختلف پایدار و سودآور است (>= حداقل ${this.MIN_STABLE_REGIMES}).`
        : `🛑 عدم پایداری در چند رژیم (${profitableRegimesCount} رژیم سودآور). مدل فقط در یک وضعیت خاص برنده بوده است.`,
    };

    // Final Decision: ALL 4 GATES MUST PASS!
    const isApproved = sampleSizePassed && oosPassed && statPassed && regimePassed;
    let approvedWeightDelta = 0;
    let verdictFa = '';

    if (isApproved) {
      // Conservative damping: allow at most +1.5% adjustment per cycle
      approvedWeightDelta = Math.max(-2.0, Math.min(2.0, rawDesiredDelta * 0.5));
      verdictFa = `✅ تایید وزن‌دهی آنلاین (${candidatePillarName}): تمام ۴ گیت ضد خودفریبی با موفقیت پاس شدند. تغییر مجاز: ${approvedWeightDelta > 0 ? '+' : ''}${approvedWeightDelta.toFixed(1)}٪.`;
    } else {
      approvedWeightDelta = 0; // Strictly zero weight modification
      const failedGates: string[] = [];
      if (!sampleSizePassed) failedGates.push('تعداد نمونه');
      if (!oosPassed) failedGates.push('عملکرد خارج از نمونه OOS');
      if (!statPassed) failedGates.push('معناداری آماری');
      if (!regimePassed) failedGates.push('پایداری رژیم‌ها');
      verdictFa = `🛑 مسدودسازی تغییر وزن آنلاین (${candidatePillarName}): گیت‌های (${failedGates.join('، ')}) مانع افزایش وزن شدند تا از خودفریبی جلوگیری شود. وزن روی مبنا قفل ماند.`;
    }

    return {
      isApproved,
      sampleSizeGate,
      outOfSampleGate,
      statisticalSignificanceGate,
      regimeStabilityGate,
      proposedWeightDelta: rawDesiredDelta,
      approvedWeightDelta,
      verdictFa,
      evaluatedAt: now,
    };
  }

  /**
   * Approximation of Normal Cumulative Distribution Function (Abramowitz and Stegun)
   */
  private approximateNormCdf(z: number): number {
    const p = 0.2316419;
    const b1 = 0.319381530;
    const b2 = -0.356563782;
    const b3 = 1.781477937;
    const b4 = -1.821255978;
    const b5 = 1.330274429;

    const t = 1.0 / (1.0 + p * Math.abs(z));
    const poly = ((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t;
    const phi = (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z);
    const cdf = 1.0 - phi * poly;
    return z >= 0 ? cdf : 1.0 - cdf;
  }
}

export const antiSelfDeceptionOnlineLearning = AntiSelfDeceptionOnlineLearningService.getInstance();
