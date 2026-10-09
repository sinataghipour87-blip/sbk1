/**
 * =============================================================================
 * 🛡️ STATISTICAL PROTECTION & PROFIT MAXIMIZATION ENGINE (اصول ۴۱ و ۴۲)
 * =============================================================================
 * ۴۱. تفکیک Profit Protection از Profit Maximization:
 *    - موتور اول (Capital Protection): صیانت از سرمایه و حد ضرر اولیه ساختاری بدون لغو زودهنگام Runner.
 *    - موتور دوم (Profit Maximization): نگهداری پوزیشن‌های برنده و فضاهای تنفس امواج بزرگ.
 *    - موازنه آماری (Statistical Trade-off) برای حداکثرسازی ارزش متوقع (Expected Value - EV).
 * 
 * ۴۲. Break-even فقط بر اساس آمار (Statistical Break-Even Execution):
 *    - لغو انتقال‌های درصد ثابت به بریک‌اون.
 *    - محاسبه نقطه بهینه انتقال Stop به Break-even بر مبنای توزیع MAE/MFE تاریخی همان ستاپ.
 *    - جلوگیری از بسته‌شدن بی‌دلیل Runner در نویزهای طبیعی بازار.
 * =============================================================================
 */

import { getMaeMfeFingerprint, MaeMfeFingerprint } from './maeMfeFingerprint';

export interface CapitalProtectionDecision {
  engineName: 'Capital Protection Engine';
  isStructuralSlIntact: boolean;
  structuralStopPrice: number;
  unrealizedMaePct: number;
  expectedSetupMaeP90Pct: number;
  protectionScore: number; // 0 - 100
  isCapitalInJeopardy: boolean;
  actionRationaleFa: string;
}

export interface ProfitMaximizationDecision {
  engineName: 'Profit Maximization Engine';
  isRunnerActive: boolean;
  currentMfePct: number;
  expectedSetupMfeP50Pct: number;
  breathingRoomAtrMultiplier: number;
  suggestedChandelierStopPrice: number;
  maximizationScore: number; // 0 - 100
  actionRationaleFa: string;
}

export interface StatisticalBreakEvenEvaluation {
  setupType: string;
  regime: string;
  timeframe: string;
  sampleCount: number;
  statisticalBeThresholdMfePct: number; // حد آستانه آماری MFE برای اجازه انتقال به BE
  currentMfePct: number;
  isBePermittedStatistically: boolean; // آیا بر اساس آمار، انتقال به BE مجاز است؟
  evWithOriginalSlUsd: number;
  evWithBreakEvenUsd: number;
  evDeltaUsd: number; // تفاوت EV (اگر مثبت باشد یعنی BE مفید است، اگر منفی باشد یعنی BE باعث افت سود انتظاری می‌شود)
  recommendedBePrice: number;
  statusTitleFa: string;
  detailedRationaleFa: string;
}

export interface CombinedProtectionAndMaximizationState {
  timestamp: number;
  setupType: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  mfePct: number;
  maePct: number;
  capitalProtection: CapitalProtectionDecision;
  profitMaximization: ProfitMaximizationDecision;
  statisticalBreakEven: StatisticalBreakEvenEvaluation;
  finalHarmonizedAction: {
    recommendedStopPrice: number;
    recommendedStopType: 'INITIAL_STRUCTURAL' | 'STATISTICAL_BREAKEVEN' | 'DYNAMIC_RUNNER_CHANDELIER';
    runnerPreservationPct: number; // 100% (حفظ کامل) تا 0%
    evOptimalStrategyFa: string;
  };
}

export class StatisticalProtectionAndMaximizationEngine {
  private static instance: StatisticalProtectionAndMaximizationEngine;

  public static getInstance(): StatisticalProtectionAndMaximizationEngine {
    if (!StatisticalProtectionAndMaximizationEngine.instance) {
      StatisticalProtectionAndMaximizationEngine.instance = new StatisticalProtectionAndMaximizationEngine();
    }
    return StatisticalProtectionAndMaximizationEngine.instance;
  }

  /**
   * اصل ۴۲: محاسبه نقطه انتقال به Break-even فقط بر اساس توزیع آماری MAE/MFE ستاپ
   */
  public evaluateStatisticalBreakEven(params: {
    setupType: string;
    regime: string;
    timeframe: string;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    currentPrice: number;
    mfePct: number;
    maePct: number;
    marginUsd?: number;
    leverage?: number;
    exchangeFeeBufferPct?: number; // 0.12% standard round-trip fee
  }): StatisticalBreakEvenEvaluation {
    const {
      setupType,
      regime,
      timeframe,
      direction,
      entryPrice,
      currentPrice,
      mfePct,
      marginUsd = 1000,
      leverage = 5,
      exchangeFeeBufferPct = 0.12,
    } = params;

    const isLong = direction === 'LONG';
    const fingerprint: MaeMfeFingerprint = getMaeMfeFingerprint(setupType, regime, timeframe);

    // ۱. استخراج توزیع MAE لول ۹۰٪ و ۹۵٪ ستاپ (میزان نویز طبیعی ستاپ‌های برنده قبل از حرکت)
    const maeP90 = fingerprint.maeDistribution.p90;
    const maeP95 = fingerprint.maeDistribution.p95;

    // ۲. محاسبه حد آستانه آماری MFE برای مجاز بودن Break-even
    // فرمول: MFE باید حداقل فراتر از P90 نویز MAE به همراه ضریب ایمنی ۱.۳۵ و بافر کارمزد صرافی باشد
    const noiseSafetyFactor = 1.35;
    const statisticalBeThresholdMfePct = Number(
      ((maeP90 * noiseSafetyFactor) + exchangeFeeBufferPct).toFixed(3)
    );

    // آیا MFE فعلی از آستانه آماری عبور کرده است؟
    const isBePermittedStatistically = mfePct >= statisticalBeThresholdMfePct;

    // ۳. محاسبه ارزش متوقع (Expected Value - EV) در دو حالت با و بدون Break-even
    const baseWinRate = 0.62; // نرخ برد پایه ستاپ
    const avgWinPct = fingerprint.expectedMfePct * 0.85; // سود متوسط معامله برنده
    const avgLossPct = fingerprint.expectedMaePct * 1.1; // زیان متوسط معامله بازنده

    // EV بدون Break-even (با استاپ ساختاری اصلی)
    const rawEvPctWithoutBe = (baseWinRate * avgWinPct) - ((1 - baseWinRate) * avgLossPct);
    const evWithOriginalSlUsd = Math.round(marginUsd * leverage * (rawEvPctWithoutBe / 100));

    // اگر خیلی زود به BE منتقل شود، نرخ خروج بی‌دلیل در BE (Premature BE Hit Rate) بالا می‌رود
    let prematureBeHitProb = 0.45; // ۴۵٪ احتمال بسته‌شدن بی‌دلیل در BE اگر MFE زیر آستانه باشد
    if (mfePct >= statisticalBeThresholdMfePct * 1.5) {
      prematureBeHitProb = 0.08; // در سودهای بالاتر، احتمال بازگشت به BE بسیار پایین است
    } else if (mfePct >= statisticalBeThresholdMfePct) {
      prematureBeHitProb = 0.22;
    }

    // با انتقال به BE، معامله یا در سود TP تسویه می‌شود یا بدون زیان در BE (با کارمزد پوشش داده شده)
    const winRateWithBe = baseWinRate * (1 - prematureBeHitProb);
    const beRate = prematureBeHitProb;
    const lossRateWithBe = (1 - baseWinRate) * (1 - prematureBeHitProb);

    const rawEvPctWithBe = (winRateWithBe * avgWinPct) + (beRate * 0.02) - (lossRateWithBe * avgLossPct);
    const evWithBreakEvenUsd = Math.round(marginUsd * leverage * (rawEvPctWithBe / 100));

    const evDeltaUsd = evWithBreakEvenUsd - evWithOriginalSlUsd;

    // قیمت دقیق بریک‌اون با بافر کارمزد
    const recommendedBePrice = isLong
      ? Number((entryPrice * (1 + exchangeFeeBufferPct / 100)).toFixed(2))
      : Number((entryPrice * (1 - exchangeFeeBufferPct / 100)).toFixed(2));

    let statusTitleFa = '';
    let detailedRationaleFa = '';

    if (isBePermittedStatistically && evDeltaUsd >= 0) {
      statusTitleFa = 'انتقال به Break-even از نظر آماری مجاز و سودآور است';
      detailedRationaleFa = `پیشروی MFE (${mfePct.toFixed(2)}٪) از حد نویز آماری ستاپ (${statisticalBeThresholdMfePct.toFixed(2)}٪) فراتر رفته است. انتقال استاپ به $${recommendedBePrice} باعث افزایش EV کل به میزان $${evDeltaUsd} می‌شود.`;
    } else if (!isBePermittedStatistically) {
      statusTitleFa = 'انتقال به Break-even ممنوع (خطر بسته‌شدن بی‌دلیل معامله در نویز)';
      detailedRationaleFa = `انتقال زودهنگام استاپ به بریک‌اون در MFE فعلی (${mfePct.toFixed(2)}٪)، طبق توزیع MAE ستاپ ${setupType} (حد آستانه آماری ${statisticalBeThresholdMfePct.toFixed(2)}٪)، باعث ${Math.round(prematureBeHitProb * 100)}٪ خروج کاذب و کاهش ارزش متوقع (EV) می‌شود. استاپ اولیه حفظ می‌شود.`;
    } else {
      statusTitleFa = 'حفظ استاپ ساختاری جهت عدم اختلال در روند سودآوری';
      detailedRationaleFa = `اگرچه MFE به حد آستانه رسیده اما انتقال به بریک‌اون ارزش متوقع را افزایش نمی‌دهد. فضای تنفس معامله حفظ می‌شود.`;
    }

    return {
      setupType,
      regime,
      timeframe,
      sampleCount: fingerprint.sampleCount,
      statisticalBeThresholdMfePct,
      currentMfePct: mfePct,
      isBePermittedStatistically,
      evWithOriginalSlUsd,
      evWithBreakEvenUsd,
      evDeltaUsd,
      recommendedBePrice,
      statusTitleFa,
      detailedRationaleFa,
    };
  }

  /**
   * اصل ۴۱: تفکیک موتورهای Capital Protection و Profit Maximization و ایجاد موازنه آماری
   */
  public evaluateState(params: {
    setupType?: string;
    regime?: string;
    timeframe?: string;
    direction?: 'LONG' | 'SHORT';
    entryPrice: number;
    currentPrice: number;
    structuralStopPrice: number;
    mfePct?: number;
    maePct?: number;
    atrValue?: number;
    marginUsd?: number;
    leverage?: number;
  }): CombinedProtectionAndMaximizationState {
    const setupType = params.setupType ?? 'BREAKOUT_RETEST';
    const regime = params.regime ?? 'HIGH_VOLATILITY';
    const timeframe = params.timeframe ?? '15m';
    const direction = params.direction ?? 'LONG';
    const entryPrice = params.entryPrice > 0 ? params.entryPrice : 88000;
    const currentPrice = params.currentPrice > 0 ? params.currentPrice : 88000;
    const isLong = direction === 'LONG';

    const priceDeltaPct = isLong
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    const mfePct = Math.max(priceDeltaPct, params.mfePct ?? priceDeltaPct);
    const maePct = params.maePct ?? (priceDeltaPct < 0 ? Math.abs(priceDeltaPct) : 0);
    const atrValue = params.atrValue ?? (currentPrice * 0.0075);
    const marginUsd = params.marginUsd ?? 1000;
    const leverage = params.leverage ?? 5;

    const fingerprint = getMaeMfeFingerprint(setupType, regime, timeframe);

    // -------------------------------------------------------------------------
    // ۱. ارزیابی Capital Protection Engine (موتور اول)
    // -------------------------------------------------------------------------
    const isStructuralSlIntact = isLong
      ? currentPrice > params.structuralStopPrice
      : currentPrice < params.structuralStopPrice;

    const maeP90 = fingerprint.maeDistribution.p90;
    const isCapitalInJeopardy = maePct > maeP90 * 1.25;

    let protectionScore = 85;
    if (!isStructuralSlIntact) protectionScore = 0;
    else if (isCapitalInJeopardy) protectionScore = 40;

    const capitalProtection: CapitalProtectionDecision = {
      engineName: 'Capital Protection Engine',
      isStructuralSlIntact,
      structuralStopPrice: params.structuralStopPrice,
      unrealizedMaePct: Number(maePct.toFixed(2)),
      expectedSetupMaeP90Pct: maeP90,
      protectionScore,
      isCapitalInJeopardy,
      actionRationaleFa: isStructuralSlIntact
        ? `حفاظت سرمایه پایدار: استاپ اولیه ساختاری در $${params.structuralStopPrice} برقرار بوده و خارج از نویز MAE لول ۹۰٪ (${maeP90}٪) قرار دارد.`
        : 'هشدار بحران سرمایه: قیمت از حد ابطال ساختاری عبور کرده است.'
    };

    // -------------------------------------------------------------------------
    // ۲. ارزیابی Profit Maximization Engine (موتور دوم)
    // -------------------------------------------------------------------------
    // فضای تنفس ATR برای امواج بزرگ (عدم خروج زودهنگام Runner)
    let breathingRoomAtrMultiplier = 2.4;
    if (mfePct >= 3.0) breathingRoomAtrMultiplier = 1.4; // در سودهای بالا فضای استاپ تنگ‌تر می‌شود
    else if (mfePct >= 1.5) breathingRoomAtrMultiplier = 2.0;

    const suggestedChandelierStopPrice = isLong
      ? Number((currentPrice - (atrValue * breathingRoomAtrMultiplier)).toFixed(2))
      : Number((currentPrice + (atrValue * breathingRoomAtrMultiplier)).toFixed(2));

    const isRunnerActive = mfePct >= 0.8;
    const expectedMfeP50 = fingerprint.mfeDistribution.p50;

    let maximizationScore = 70;
    if (mfePct >= expectedMfeP50) maximizationScore = 95;

    const profitMaximization: ProfitMaximizationDecision = {
      engineName: 'Profit Maximization Engine',
      isRunnerActive,
      currentMfePct: Number(mfePct.toFixed(2)),
      expectedSetupMfeP50Pct: expectedMfeP50,
      breathingRoomAtrMultiplier,
      suggestedChandelierStopPrice,
      maximizationScore,
      actionRationaleFa: isRunnerActive
        ? `بیشینه‌سازی سود فعال: تخصیص فضای تنفس ${breathingRoomAtrMultiplier}x ATR جهت محافظت از Runner در برابر اصلاح‌های مقطعی.`
        : 'در حال رشد اولیه معامله: نگهداری پوزیشن با فضای تنفس کامل.'
    };

    // -------------------------------------------------------------------------
    // ۳. ارزیابی Statistical Break-Even (اصل ۴۲)
    // -------------------------------------------------------------------------
    const statisticalBreakEven = this.evaluateStatisticalBreakEven({
      setupType,
      regime,
      timeframe,
      direction,
      entryPrice,
      currentPrice,
      mfePct,
      maePct,
      marginUsd,
      leverage,
    });

    // -------------------------------------------------------------------------
    // ۴. ایجاد موازنه هماهنگ نهایی (Harmonized Action Resolution)
    // -------------------------------------------------------------------------
    let recommendedStopPrice = params.structuralStopPrice;
    let recommendedStopType: CombinedProtectionAndMaximizationState['finalHarmonizedAction']['recommendedStopType'] = 'INITIAL_STRUCTURAL';
    let runnerPreservationPct = 100;
    let evOptimalStrategyFa = '';

    if (statisticalBreakEven.isBePermittedStatistically && mfePct >= 2.2) {
      // استفاده از تریلینگ استاپ Chandelier بیشینه‌ساز سود
      recommendedStopPrice = isLong
        ? Math.max(suggestedChandelierStopPrice, statisticalBreakEven.recommendedBePrice)
        : Math.min(suggestedChandelierStopPrice, statisticalBreakEven.recommendedBePrice);
      recommendedStopType = 'DYNAMIC_RUNNER_CHANDELIER';
      runnerPreservationPct = 100;
      evOptimalStrategyFa = 'تلفیق بهینه: تریلینگ Chandelier با حفظ ۱۰۰٪ Runner برای جذب سوپر رالی موج.';
    } else if (statisticalBreakEven.isBePermittedStatistically) {
      // انتقال آماری به Break-Even
      recommendedStopPrice = statisticalBreakEven.recommendedBePrice;
      recommendedStopType = 'STATISTICAL_BREAKEVEN';
      runnerPreservationPct = 100;
      evOptimalStrategyFa = `موازنه آماری: انتقال استاپ به $${recommendedStopPrice} (Break-even آماری) با عبور از حد نویز ستاپ.`;
    } else {
      // حفظ استاپ ساختاری اولیه
      recommendedStopPrice = params.structuralStopPrice;
      recommendedStopType = 'INITIAL_STRUCTURAL';
      runnerPreservationPct = 100;
      evOptimalStrategyFa = 'عدم مداخله زودهنگام: حفظ استاپ ساختاری اولیه تا مانع بسته‌شدن بی‌دلیل معامله در نویز بازار شود.';
    }

    return {
      timestamp: Date.now(),
      setupType,
      direction,
      entryPrice,
      currentPrice,
      mfePct: Number(mfePct.toFixed(2)),
      maePct: Number(maePct.toFixed(2)),
      capitalProtection,
      profitMaximization,
      statisticalBreakEven,
      finalHarmonizedAction: {
        recommendedStopPrice,
        recommendedStopType,
        runnerPreservationPct,
        evOptimalStrategyFa,
      }
    };
  }
}

export const statisticalProtectionAndMaximizationEngine = StatisticalProtectionAndMaximizationEngine.getInstance();
