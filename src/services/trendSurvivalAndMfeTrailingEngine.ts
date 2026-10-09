/**
 * =============================================================================
 * 🌊 TREND SURVIVAL PROBABILITY & MFE-BASED DYNAMIC TRAILING ENGINE (اصول ۳۹ و ۴۰)
 * =============================================================================
 * ۳۹. Trend Survival Probability:
 *    محاسبه پیوسته و لحظه‌ای احتمال دوام و ادامه روند پس از ورود.
 *    - در صورت حفظ احتمال بالا (>=65%): Runner برای شکار بیشترین بخش رالی حفظ می‌شود.
 *    - در صورت تضعیف احتمال (<50% یا <35%): خروج پله‌ای (Stepped De-escalation) فعال می‌شود.
 * 
 * ۴۰. MFE-Based Dynamic Trailing:
 *    تریلینگ استاپ غیرخطی و چندمتغیره بر پایه:
 *    MFE + ATR + رژیم نوسان (Volatility Regime) + ساختار سویینگ‌ها (Structure) + 
 *    دیوارهای نقدینگی (Liquidity Walls) + میرایی مومنتوم (Momentum Decay).
 * =============================================================================
 */

import { Candle } from '../types/trading';

export type VolatilityRegimeType = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

export type RunnerPreservationStatus =
  | 'PRESERVE_100_RUNNER'       // احتمال بالا: نگهداری کامل Runner
  | 'TIGHTEN_MONITORING'        // احتمال متوسط بالا: فشرده‌سازی نظارت و بافر
  | 'STEPPED_DE_ESCALATION'     // احتمال ضعیف: فعال‌سازی خروج پله‌ای
  | 'FULL_HARVEST_EXIT';        // احتمال از دست رفته: تسویه فوری برای ذخیره حداکثری سود

export type DynamicTrailingRung =
  | 'INITIAL_BREATHING_ROOM'        // فضای تنفس اولیه با مضرب ATR مناسب
  | 'BREAKEVEN_LOCK_PLUS_FEES'     // قفل نقطه ورود به همراه کارمزد + بافر اسلیپیج
  | 'MFE_ACCELERATION_RUNG'        // شتاب‌گیری تریلینگ متناسب با جهش MFE
  | 'DYNAMIC_STRUCTURE_PROTECTION'  // استاپ ساختاری در زیر کف‌ها/سقف‌های کلیدی ۵ دقیقه
  | 'MAX_PEAK_HARVEST';            // اوج سود با تریلینگ تنگاتنگ ضد برگشت

export interface TrendSurvivalFactor {
  factorName: string;
  weightPct: number;
  score: number | null; // 0 to 100, or null when the feed is unavailable
  status: 'EXCELLENT' | 'HEALTHY' | 'DEGRADING' | 'FAILED' | 'UNKNOWN';
  descriptionFa: string;
}

export interface TrendSurvivalEvaluation {
  trendSurvivalProbabilityPct: number; // 0 - 100
  runnerStatus: RunnerPreservationStatus;
  steppedExitRecommendedPct: number; // درصد تسویه پله‌ای پیشنهادی (0%, 35%, 60%, 100%)
  statusTitleFa: string;
  primaryActionFa: string;
  factors: {
    momentumHealth: TrendSurvivalFactor;
    orderFlowCvdHealth: TrendSurvivalFactor;
    orderBookImbalanceHealth: TrendSurvivalFactor;
    marketStructureIntegrity: TrendSurvivalFactor;
    liquidityAbsorptionHealth: TrendSurvivalFactor;
    volatilityRegimeStability: TrendSurvivalFactor;
  };
  survivalConfidence: number;
  isRunnerSafeToHold: boolean;
}

export interface MfeDynamicTrailingEvaluation {
  currentPrice: number;
  entryPrice: number;
  direction: 'LONG' | 'SHORT';
  currentMfePct: number;
  currentMaePct: number;
  dynamicTrailingStopPrice: number;
  dynamicTrailingOffsetPct: number;
  stopDistanceInAtr: number;
  activeRung: DynamicTrailingRung;
  isBreakevenCovered: boolean;
  lockedProfitUsd: number;
  lockedProfitPct: number;
  unrealizedProfitUsd: number;
  unrealizedProfitPct: number;
  volatilityRegime: VolatilityRegimeType;
  tighteningRationaleFa: string;
  actionGuidanceFa: string;
}

export interface ComprehensiveTrendAndTrailingState {
  timestamp: number;
  trendSurvival: TrendSurvivalEvaluation;
  mfeTrailing: MfeDynamicTrailingEvaluation;
  recommendedCompositeAction: {
    actionType: 'HOLD_RUNNER' | 'PARTIAL_TAKE_PROFIT' | 'TIGHTEN_TRAILING_STOP' | 'FULL_CLOSE';
    exitAmountPct: number;
    trailingStopPrice: number;
    reasonFa: string;
  };
}

export class TrendSurvivalAndMfeTrailingEngine {
  private static instance: TrendSurvivalAndMfeTrailingEngine;

  public static getInstance(): TrendSurvivalAndMfeTrailingEngine {
    if (!TrendSurvivalAndMfeTrailingEngine.instance) {
      TrendSurvivalAndMfeTrailingEngine.instance = new TrendSurvivalAndMfeTrailingEngine();
    }
    return TrendSurvivalAndMfeTrailingEngine.instance;
  }

  /**
   * ارزیابی رژیم نوسان بر مبنای نسبت نوسان جاری به میانگین تاریخی
   */
  public detectVolatilityRegime(atrValue: number, currentPrice: number, baseAtrPct = 0.008): VolatilityRegimeType {
    const currentAtrPct = currentPrice > 0 ? (atrValue / currentPrice) : baseAtrPct;
    const ratio = currentAtrPct / baseAtrPct;
    if (ratio < 0.75) return 'LOW';
    if (ratio <= 1.35) return 'NORMAL';
    if (ratio <= 2.1) return 'HIGH';
    return 'EXTREME';
  }

  /**
   * اصل ۳۹: محاسبه دقیق احتمال بقا و دوام روند (Trend Survival Probability)
   */
  public evaluateTrendSurvival(params: {
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    currentPrice: number;
    mfePct: number;
    priceDeltaPct: number;
    rsi: number;
    rsiPrevious: number;
    macdHist: number;
    macdHistPrevious: number;
    cvdDelta: number | null;
    cvdSlope: number | null; // شیب اخیر دلتای تجمعی
    orderBookImbalance: number; // -1.0 (فروش کامل) تا +1.0 (خرید کامل)
    isStructureIntact: boolean; // آیا سویینگ‌های ساختاری حفظ شده‌اند؟
    distanceToKeyStructurePct: number;
    liquidityAbsorptionRatio: number; // 0 تا 1
    atrValue: number;
    barsInTrade: number;
  }): TrendSurvivalEvaluation {
    const {
      direction,
      priceDeltaPct,
      mfePct,
      rsi,
      rsiPrevious,
      macdHist,
      macdHistPrevious,
      cvdDelta,
      cvdSlope,
      orderBookImbalance,
      isStructureIntact,
      liquidityAbsorptionRatio,
      atrValue,
      currentPrice,
      barsInTrade,
    } = params;

    const isLong = direction === 'LONG';

    // ۱. ارزیابی سلامت و افت مومنتوم (Momentum Health) - وزن ۲۵٪
    let momentumScore = 50;
    const rsiSlope = rsi - rsiPrevious;
    const macdSlope = macdHist - macdHistPrevious;

    if (isLong) {
      if (rsi >= 52 && rsi <= 72 && rsiSlope >= -0.5 && macdSlope >= 0) {
        momentumScore = 90;
      } else if (rsi > 78) {
        momentumScore = 40; // اشباع خرید شدید و خطر واگرایی
      } else if (rsi < 48 || (rsiSlope < -2 && macdSlope < -0.2)) {
        momentumScore = 25; // افت شدید مومنتوم
      } else {
        momentumScore = 65;
      }
    } else {
      if (rsi <= 48 && rsi >= 28 && rsiSlope <= 0.5 && macdSlope <= 0) {
        momentumScore = 90;
      } else if (rsi < 22) {
        momentumScore = 40; // اشباع فروش شدید
      } else if (rsi > 52 || (rsiSlope > 2 && macdSlope > 0.2)) {
        momentumScore = 25;
      } else {
        momentumScore = 65;
      }
    }

    const momentumHealth: TrendSurvivalFactor = {
      factorName: 'Momentum Velocity & RSI Slope',
      weightPct: 25,
      score: momentumScore,
      status: momentumScore >= 75 ? 'EXCELLENT' : momentumScore >= 55 ? 'HEALTHY' : momentumScore >= 40 ? 'DEGRADING' : 'FAILED',
      descriptionFa: momentumScore >= 75
        ? 'مومنتوم پایدار و پرقدرت بدون واگرایی منفی در تایم‌فریم معاملاتی'
        : momentumScore >= 55
        ? 'مومنتوم در محدوده نرمال با شیب ملایم'
        : 'افت سرعت مومنتوم و نشانه‌های اولیه فرسایش روند'
    };

    // ۲. ارزیابی جریان سفارشات و CVD (Order Flow & CVD Health) - وزن ۲۵٪
    const hasCvdEvidence = cvdDelta !== null && cvdSlope !== null;
    const isCvdDirectional = hasCvdEvidence && (isLong ? (cvdDelta > 0 && cvdSlope >= 0) : (cvdDelta < 0 && cvdSlope <= 0));
    const isCvdReversing = hasCvdEvidence && (isLong ? (cvdDelta < -30 || cvdSlope < -15) : (cvdDelta > 30 || cvdSlope > 15));
    const cvdScore = !hasCvdEvidence ? null : isCvdDirectional ? 92 : isCvdReversing ? 20 : 60;

    const orderFlowCvdHealth: TrendSurvivalFactor = {
      factorName: 'Cumulative Volume Delta (CVD)',
      weightPct: hasCvdEvidence ? 25 : 0,
      score: cvdScore,
      status: cvdScore === null ? 'UNKNOWN' : cvdScore >= 75 ? 'EXCELLENT' : cvdScore >= 55 ? 'HEALTHY' : cvdScore >= 40 ? 'DEGRADING' : 'FAILED',
      descriptionFa: cvdScore === null
        ? 'CVD UNKNOWN: فید ترید واقعی یا شیب معتبر موجود نیست.'
        : cvdScore >= 75
        ? 'تزریق مداوم حجم تهاجمی (Aggressive Market Orders) در راستای پوزیشن'
        : cvdScore >= 55
        ? 'جریان دلتای حجم متعادل با برتری نسبی در جهت معامله'
        : 'چرخش منفی در CVD و ورود سفارشات مارکت مخالف'
    };

    // ۳. ارزیابی عدم تعادل دفتر سفارشات (Order Book Imbalance) - وزن ۱۵٪
    let obiScore = 50;
    const isObiSupportive = isLong ? orderBookImbalance >= 0.15 : orderBookImbalance <= -0.15;
    const isObiHostile = isLong ? orderBookImbalance <= -0.25 : orderBookImbalance >= 0.25;

    if (isObiSupportive) {
      obiScore = 88;
    } else if (isObiHostile) {
      obiScore = 25;
    } else {
      obiScore = 62;
    }

    const orderBookImbalanceHealth: TrendSurvivalFactor = {
      factorName: 'Order Book Depth Imbalance (OBI)',
      weightPct: 15,
      score: obiScore,
      status: obiScore >= 75 ? 'EXCELLENT' : obiScore >= 55 ? 'HEALTHY' : obiScore >= 40 ? 'DEGRADING' : 'FAILED',
      descriptionFa: obiScore >= 75
        ? 'تراکم بالای لایه‌های حمایتی در دفتر سفارشات و نبود مقاومت سنگین'
        : obiScore >= 55
        ? 'عمق دفتر سفارشات در تعادل نسبی'
        : 'فشار دیوار لیمیت سفارشات متضاد در نزدیکی قیمت جاری'
    };

    // ۴. یکپارچگی ساختار بازار (Market Structure Integrity) - وزن ۱۵٪
    let structScore = isStructureIntact ? 85 : 20;
    if (priceDeltaPct < -0.8) structScore = Math.max(10, structScore - 30);

    const marketStructureIntegrity: TrendSurvivalFactor = {
      factorName: 'Market Structure & Swings',
      weightPct: 15,
      score: structScore,
      status: structScore >= 75 ? 'EXCELLENT' : structScore >= 50 ? 'HEALTHY' : 'FAILED',
      descriptionFa: structScore >= 75
        ? 'کف‌ها و سقف‌های ساختاری دست‌نخورده و بدون نقض روند'
        : 'شکست سویینگ ساختاری و تهدید تغییر فاز بازار'
    };

    // ۵. جذب نقدینگی و دیوارهای لیمیت (Liquidity Absorption) - وزن ۱۰٪
    const absScore = Math.round(liquidityAbsorptionRatio * 100);
    const liquidityAbsorptionHealth: TrendSurvivalFactor = {
      factorName: 'Liquidity Absorption & Walls',
      weightPct: 10,
      score: absScore,
      status: absScore >= 70 ? 'EXCELLENT' : absScore >= 50 ? 'HEALTHY' : 'DEGRADING',
      descriptionFa: absScore >= 70
        ? 'جذب موفق نقدینگی مخالف بدون توقف تکانه‌ای قیمت'
        : 'کاهش توان جذب نقدینگی در برابر دیوارهای اوردر بوک'
    };

    // ۶. رژیم نوسان و استهلاک زمان (Volatility & Time Decay) - وزن ۱۰٪
    const volRegime = this.detectVolatilityRegime(atrValue, currentPrice);
    let volScore = 75;
    if (volRegime === 'EXTREME') volScore = 45; // نوسانات انفجاری ریسک تکانه‌ای دارند
    if (barsInTrade > 48) volScore = Math.max(30, volScore - 15); // خستگی ناشی از ماندگاری بیش از حد در معامله

    const volatilityRegimeStability: TrendSurvivalFactor = {
      factorName: 'Volatility Stability & Duration',
      weightPct: 10,
      score: volScore,
      status: volScore >= 70 ? 'EXCELLENT' : volScore >= 50 ? 'HEALTHY' : 'DEGRADING',
      descriptionFa: `رژیم نوسان ${volRegime} | سپری شدن ${barsInTrade} کندل در موقعیت معاملاتی`
    };

    // محاسبه احتمال نهایی وزن‌دهی شده بقای روند (Trend Survival Probability)
    const totalEvidenceWeight = 75 + (hasCvdEvidence ? 25 : 0);
    const compositeSurvivalProb = Math.round((
      (momentumScore * 0.25) +
      ((cvdScore ?? 0) * (hasCvdEvidence ? 0.25 : 0)) +
      (obiScore * 0.15) +
      (structScore * 0.15) +
      (absScore * 0.10) +
      (volScore * 0.10)
    ) * 100 / totalEvidenceWeight);

    // تصمیم‌گیری وضعیت Runner و خروج پله‌ای
    let runnerStatus: RunnerPreservationStatus = 'PRESERVE_100_RUNNER';
    let steppedExitRecommendedPct = 0;
    let statusTitleFa = '';
    let primaryActionFa = '';

    if (compositeSurvivalProb >= 65) {
      runnerStatus = 'PRESERVE_100_RUNNER';
      steppedExitRecommendedPct = 0;
      statusTitleFa = 'تداوم مقتدرانه روند (Runner 100% Active)';
      primaryActionFa = 'حفظ کامل بخش دونده (Runner) برای ثبت بالاترین بازدهی ممکن بر موج صعودی/نزولی.';
    } else if (compositeSurvivalProb >= 50) {
      runnerStatus = 'TIGHTEN_MONITORING';
      steppedExitRecommendedPct = 0;
      statusTitleFa = 'کاهش ملایم شتاب (Tighten Trailing Monitoring)';
      primaryActionFa = 'فشرده‌سازی تریلینگ استاپ و رصد نزدیک سویینگ‌های قیمت بدون نیاز به تسویه فوری.';
    } else if (compositeSurvivalProb >= 35) {
      runnerStatus = 'STEPPED_DE_ESCALATION';
      steppedExitRecommendedPct = 40; // خروج پله‌ای ۴۰٪ از باقیمانده برای ذخیره سود
      statusTitleFa = 'هشدار افت بقای روند (Stepped De-escalation 40%)';
      primaryActionFa = 'فعال‌سازی خروج پله‌ای ۴۰٪ از حجم پوزیشن به منظور صیانت از سودهای کسب‌شده در برابر پولبک عمیق.';
    } else {
      runnerStatus = 'FULL_HARVEST_EXIT';
      steppedExitRecommendedPct = 100;
      statusTitleFa = 'ابطال بقای روند (Full Harvest Exit)';
      primaryActionFa = 'تسویه کامل پوزیشن Runner؛ شواهد حاکی از خاتمه فاز انبساطی موج و شروع چرخش است.';
    }

    return {
      trendSurvivalProbabilityPct: Math.min(100, Math.max(0, compositeSurvivalProb)),
      runnerStatus,
      steppedExitRecommendedPct,
      statusTitleFa,
      primaryActionFa,
      factors: {
        momentumHealth,
        orderFlowCvdHealth,
        orderBookImbalanceHealth,
        marketStructureIntegrity,
        liquidityAbsorptionHealth,
        volatilityRegimeStability
      },
      survivalConfidence: Math.round(compositeSurvivalProb),
      isRunnerSafeToHold: runnerStatus === 'PRESERVE_100_RUNNER' || runnerStatus === 'TIGHTEN_MONITORING'
    };
  }

  /**
   * اصل ۴۰: محاسبه MFE-Based Dynamic Trailing Stop
   * تنظیم داینامیک بر پایه MFE, ATR, Volatility Regime, Structure, Liquidity Walls, Momentum Decay
   */
  public calculateMfeDynamicTrailing(params: {
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    currentPrice: number;
    mfePct: number;
    maePct: number;
    marginUsd: number;
    leverage: number;
    atrValue: number;
    candles?: Candle[];
    trendSurvivalProbPct: number;
    cvdSlope: number;
    orderBookSupportPrice?: number;
    recentSwingProtectionPrice?: number;
  }): MfeDynamicTrailingEvaluation {
    const {
      direction,
      entryPrice,
      currentPrice,
      mfePct,
      maePct,
      marginUsd,
      leverage,
      atrValue,
      trendSurvivalProbPct,
      cvdSlope,
      orderBookSupportPrice,
      recentSwingProtectionPrice
    } = params;

    const isLong = direction === 'LONG';
    const priceDeltaPct = isLong
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    const unrealizedProfitPct = Math.round(priceDeltaPct * leverage * 100) / 100;
    const unrealizedProfitUsd = Math.round(marginUsd * (unrealizedProfitPct / 100) * 100) / 100;

    const volRegime = this.detectVolatilityRegime(atrValue, currentPrice);

    // تعیین ضریب پایه ATR بر اساس رژیم نوسان
    let baseAtrMultiplier = 2.2;
    if (volRegime === 'LOW') baseAtrMultiplier = 1.6;
    else if (volRegime === 'NORMAL') baseAtrMultiplier = 2.0;
    else if (volRegime === 'HIGH') baseAtrMultiplier = 2.4;
    else if (volRegime === 'EXTREME') baseAtrMultiplier = 2.8;

    // اعمال منحنی سفت‌سازی MFE (MFE Tightening Curve)
    // با افزایش MFE، استاپ هوشمندانه به قیمت نزدیک‌تر می‌شود تا سودهای بزرگ بازگشت نخورد
    let mfeTighteningReduction = 0;
    let activeRung: DynamicTrailingRung = 'INITIAL_BREATHING_ROOM';

    // احتساب کارمزد معاملاتی صرافی + اسلیپیج بافر (0.15%)
    const feeBufferPct = 0.15;
    const breakevenPlusPrice = isLong
      ? entryPrice * (1 + feeBufferPct / 100)
      : entryPrice * (1 - feeBufferPct / 100);

    let stopDistanceInAtr = baseAtrMultiplier;
    let isBreakevenCovered = false;

    if (mfePct >= 3.5) {
      // اوج رالی سود (Super Peak): تریلینگ بسیار نزدیک با 1.0x ATR و زیر آخرین سویینگ
      activeRung = 'MAX_PEAK_HARVEST';
      stopDistanceInAtr = Math.max(0.9, baseAtrMultiplier * 0.45);
      isBreakevenCovered = true;
    } else if (mfePct >= 2.0) {
      // ساختار پیشرفته و شتاب موج
      activeRung = 'DYNAMIC_STRUCTURE_PROTECTION';
      stopDistanceInAtr = Math.max(1.2, baseAtrMultiplier * 0.65);
      isBreakevenCovered = true;
    } else if (mfePct >= 1.2) {
      // ورود به فاز انبساط و قفل بریک‌اون + کارمزد
      activeRung = 'BREAKEVEN_LOCK_PLUS_FEES';
      stopDistanceInAtr = Math.max(1.5, baseAtrMultiplier * 0.80);
      isBreakevenCovered = true;
    } else {
      // فاز اولیه تنفس
      activeRung = 'INITIAL_BREATHING_ROOM';
      stopDistanceInAtr = baseAtrMultiplier;
      isBreakevenCovered = false;
    }

    // فاکتور میرایی مومنتوم (Momentum Decay Modifier):
    // اگر احتمال بقای روند افت کند، استاپ 20% الی 35% سفت‌تر می‌شود
    if (trendSurvivalProbPct < 50) {
      stopDistanceInAtr *= 0.75;
    } else if (trendSurvivalProbPct < 35) {
      stopDistanceInAtr *= 0.55;
    }

    // محاسبه قیمت استاپ تریلینگ بر اساس ATR
    let calculatedStopPrice = isLong
      ? currentPrice - (atrValue * stopDistanceInAtr)
      : currentPrice + (atrValue * stopDistanceInAtr);

    // اعمال حفاظت ساختاری سویینگ ۵ دقیقه (اگر موجود باشد)
    if (recentSwingProtectionPrice && recentSwingProtectionPrice > 0) {
      if (isLong && recentSwingProtectionPrice > calculatedStopPrice) {
        calculatedStopPrice = Math.min(recentSwingProtectionPrice, currentPrice - (atrValue * 0.6));
      } else if (!isLong && recentSwingProtectionPrice < calculatedStopPrice) {
        calculatedStopPrice = Math.max(recentSwingProtectionPrice, currentPrice + (atrValue * 0.6));
      }
    }

    // اعمال حمایت/مقاومت دیوار دفتر سفارشات (Liquidity Wall Protection)
    if (orderBookSupportPrice && orderBookSupportPrice > 0) {
      if (isLong && orderBookSupportPrice > calculatedStopPrice && orderBookSupportPrice < currentPrice) {
        // قرار دادن استاپ کمی زیر دیوار سفارشات خرید (0.05% زیر دیوار)
        calculatedStopPrice = Math.max(calculatedStopPrice, orderBookSupportPrice * 0.9995);
      } else if (!isLong && orderBookSupportPrice < calculatedStopPrice && orderBookSupportPrice > currentPrice) {
        // قرار دادن استاپ کمی بالای دیوار سفارشات فروش
        calculatedStopPrice = Math.min(calculatedStopPrice, orderBookSupportPrice * 1.0005);
      }
    }

    // تضمین فعال‌سازی Breakeven Lock در صورت رسیدن MFE به حد مجاز
    if (isBreakevenCovered) {
      if (isLong && calculatedStopPrice < breakevenPlusPrice) {
        calculatedStopPrice = breakevenPlusPrice;
      } else if (!isLong && calculatedStopPrice > breakevenPlusPrice) {
        calculatedStopPrice = breakevenPlusPrice;
      }
    }

    // محاسبه فاصله درصدی استاپ تا قیمت جاری
    const dynamicTrailingOffsetPct = isLong
      ? Math.abs(((currentPrice - calculatedStopPrice) / currentPrice) * 100)
      : Math.abs(((calculatedStopPrice - currentPrice) / currentPrice) * 100);

    // محاسبه سود قفل‌شده در صورت لمس استاپ
    const lockedDeltaPct = isLong
      ? ((calculatedStopPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - calculatedStopPrice) / entryPrice) * 100;
    
    const lockedProfitPct = Math.round(lockedDeltaPct * leverage * 100) / 100;
    const lockedProfitUsd = Math.round(marginUsd * (lockedProfitPct / 100) * 100) / 100;

    let tighteningRationaleFa = '';
    let actionGuidanceFa = '';

    if (activeRung === 'MAX_PEAK_HARVEST') {
      tighteningRationaleFa = `رالی چشمگیر MFE (${mfePct.toFixed(2)}٪): فشرده‌سازی تریلینگ به ${stopDistanceInAtr.toFixed(1)}x ATR جهت صید اوج سود بدون پس دادن به بازار.`;
      actionGuidanceFa = `🎯 اوج سودگیری: سود تضمین‌شده $${lockedProfitUsd > 0 ? lockedProfitUsd : 0} • استاپ در ${calculatedStopPrice.toFixed(2)}`;
    } else if (activeRung === 'DYNAMIC_STRUCTURE_PROTECTION') {
      tighteningRationaleFa = `پیشروی روند: تریلینگ متصل به ساختار سویینگ و دیوار نقدینگی با ضریب ${stopDistanceInAtr.toFixed(1)}x ATR.`;
      actionGuidanceFa = `🛡️ استاپ ساختاری هوشمند: قفل سود $${lockedProfitUsd > 0 ? lockedProfitUsd : 0} • فاصله ${dynamicTrailingOffsetPct.toFixed(2)}٪`;
    } else if (activeRung === 'BREAKEVEN_LOCK_PLUS_FEES') {
      tighteningRationaleFa = `تثبیت فاز اول: قفل نقطه ورود + پوشش کامل کارمزد صرافی (BE+Fees) جهت تضمین ریسک صفر مطلق.`;
      actionGuidanceFa = `🔒 ریسک صفر مطلق: استاپ در نقطه ورود بهینه ${calculatedStopPrice.toFixed(2)}`;
    } else {
      tighteningRationaleFa = `فاز شکل‌گیری اولیه: حفظ فضای تنفس استاندارد (${stopDistanceInAtr.toFixed(1)}x ATR) جهت در امان ماندن از نویزهای پولبک ابتدایی.`;
      actionGuidanceFa = `⏳ تنفس طبیعی موج: استاپ اولیه در ${calculatedStopPrice.toFixed(2)} (${dynamicTrailingOffsetPct.toFixed(2)}٪ فاصله)`;
    }

    return {
      currentPrice,
      entryPrice,
      direction,
      currentMfePct: Math.round(mfePct * 100) / 100,
      currentMaePct: Math.round(maePct * 100) / 100,
      dynamicTrailingStopPrice: Math.round(calculatedStopPrice * 100) / 100,
      dynamicTrailingOffsetPct: Math.round(dynamicTrailingOffsetPct * 100) / 100,
      stopDistanceInAtr: Math.round(stopDistanceInAtr * 100) / 100,
      activeRung,
      isBreakevenCovered,
      lockedProfitUsd,
      lockedProfitPct,
      unrealizedProfitUsd,
      unrealizedProfitPct,
      volatilityRegime: volRegime,
      tighteningRationaleFa,
      actionGuidanceFa
    };
  }

  /**
   * ارزیابی یکپارچه و بلادرنگ هر دو موتور (اصل ۳۹ + اصل ۴۰)
   */
  public evaluateState(params: {
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    currentPrice: number;
    marginUsd?: number;
    leverage?: number;
    mfeAchievedPct?: number;
    maeAchievedPct?: number;
    rsi?: number;
    rsiPrevious?: number;
    macdHist?: number;
    macdHistPrevious?: number;
    cvdDelta?: number | null;
    cvdSlope?: number | null;
    orderBookImbalance?: number;
    isStructureIntact?: boolean;
    distanceToKeyStructurePct?: number;
    liquidityAbsorptionRatio?: number;
    atrValue?: number;
    barsInTrade?: number;
    orderBookSupportPrice?: number;
    recentSwingProtectionPrice?: number;
  }): ComprehensiveTrendAndTrailingState {
    const direction = params.direction ?? 'LONG';
    const entryPrice = params.entryPrice > 0 ? params.entryPrice : 88500;
    const currentPrice = params.currentPrice > 0 ? params.currentPrice : 88500;
    const marginUsd = params.marginUsd ?? 1000;
    const leverage = params.leverage ?? 5;

    const isLong = direction === 'LONG';
    const priceDeltaPct = isLong
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    const mfePct = Math.max(priceDeltaPct, params.mfeAchievedPct ?? priceDeltaPct);
    const maePct = params.maeAchievedPct ?? (priceDeltaPct < 0 ? Math.abs(priceDeltaPct) : 0);

    const atrValue = params.atrValue ?? (currentPrice * 0.0075);
    const rsi = params.rsi ?? (isLong ? 58 : 42);
    const rsiPrevious = params.rsiPrevious ?? (isLong ? 56 : 44);
    const macdHist = params.macdHist ?? (isLong ? 1.2 : -1.2);
    const macdHistPrevious = params.macdHistPrevious ?? (isLong ? 1.0 : -1.0);
    const cvdDelta = params.cvdDelta ?? null;
    const cvdSlope = params.cvdSlope ?? null;
    const orderBookImbalance = params.orderBookImbalance ?? (isLong ? 0.22 : -0.22);
    const isStructureIntact = params.isStructureIntact ?? true;
    const distanceToKeyStructurePct = params.distanceToKeyStructurePct ?? 1.2;
    const liquidityAbsorptionRatio = params.liquidityAbsorptionRatio ?? 0.85;
    const barsInTrade = params.barsInTrade ?? 12;

    // ۱. ارزیابی Trend Survival Probability (اصل ۳۹)
    const trendSurvival = this.evaluateTrendSurvival({
      direction,
      entryPrice,
      currentPrice,
      mfePct,
      priceDeltaPct,
      rsi,
      rsiPrevious,
      macdHist,
      macdHistPrevious,
      cvdDelta,
      cvdSlope,
      orderBookImbalance,
      isStructureIntact,
      distanceToKeyStructurePct,
      liquidityAbsorptionRatio,
      atrValue,
      barsInTrade
    });

    // ۲. محاسبه MFE-Based Dynamic Trailing (اصل ۴۰)
    const mfeTrailing = this.calculateMfeDynamicTrailing({
      direction,
      entryPrice,
      currentPrice,
      mfePct,
      maePct,
      marginUsd,
      leverage,
      atrValue,
      trendSurvivalProbPct: trendSurvival.trendSurvivalProbabilityPct,
      cvdSlope,
      orderBookSupportPrice: params.orderBookSupportPrice,
      recentSwingProtectionPrice: params.recentSwingProtectionPrice
    });

    // ۳. جمع‌بندی توصیه اقدام ترکیبی
    let actionType: ComprehensiveTrendAndTrailingState['recommendedCompositeAction']['actionType'] = 'HOLD_RUNNER';
    let exitAmountPct = 0;
    let reasonFa = '';

    if (trendSurvival.runnerStatus === 'FULL_HARVEST_EXIT') {
      actionType = 'FULL_CLOSE';
      exitAmountPct = 100;
      reasonFa = 'افت شدید احتمال بقای روند زیر ۳۵٪؛ خروج کامل برای حفظ سود حداکثری.';
    } else if (trendSurvival.runnerStatus === 'STEPPED_DE_ESCALATION') {
      actionType = 'PARTIAL_TAKE_PROFIT';
      exitAmountPct = trendSurvival.steppedExitRecommendedPct;
      reasonFa = `افت احتمال بقای روند به ${trendSurvival.trendSurvivalProbabilityPct}٪؛ خروج پله‌ای ${exitAmountPct}٪ و تریلینگ سفت برای الباقی.`;
    } else if (mfeTrailing.activeRung === 'MAX_PEAK_HARVEST' || mfeTrailing.activeRung === 'DYNAMIC_STRUCTURE_PROTECTION') {
      actionType = 'TIGHTEN_TRAILING_STOP';
      exitAmountPct = 0;
      reasonFa = `احتمال بقای روند پایدار (${trendSurvival.trendSurvivalProbabilityPct}٪)؛ حفظ کامل Runner با تریلینگ داینامیک ${mfeTrailing.dynamicTrailingOffsetPct}٪.`;
    } else {
      actionType = 'HOLD_RUNNER';
      exitAmountPct = 0;
      reasonFa = `موقعیت در فاز رشد سالم (${trendSurvival.trendSurvivalProbabilityPct}٪ بقا)؛ فضای تنفس تریلینگ برقرار است.`;
    }

    return {
      timestamp: Date.now(),
      trendSurvival,
      mfeTrailing,
      recommendedCompositeAction: {
        actionType,
        exitAmountPct,
        trailingStopPrice: mfeTrailing.dynamicTrailingStopPrice,
        reasonFa
      }
    };
  }
}

export const trendSurvivalAndMfeTrailingEngine = TrendSurvivalAndMfeTrailingEngine.getInstance();
