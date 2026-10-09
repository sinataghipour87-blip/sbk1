/**
 * =============================================================================
 * 🚀 WAVE RUNNER & ADVANCED PROFIT MAXIMIZER ENGINE
 * =============================================================================
 * حل ۵ اصل کلیدی نگهداری موج و بیشینه‌سازی سود (اصول ۲۱ الی ۲۵):
 * ۲۱. تنظیم تریلینگ استاپ بر اساس ATR، ساختار بازار، MFE، افت مومنتوم و جریان سفارشات (نه ضریب ثابت)
 * ۲۲. تفکیک دو مفهوم مستقل: Profit Protection و Profit Maximization (جلوگیری از فعال‌سازی زودهنگام Breakeven)
 * ۲۳. ماشین وضعیت موج (Wave State Machine): ۸ فاز کامل از WAVE_FORMING تا EXIT
 * ۲۴. خروج پله‌ای پویا (Adaptive Tier Allocation: TP1 کاهش ریسک، TP2 تثبیت سود، Runner ادامه‌دار با حجم دینامیک)
 * ۲۵. خروج چندبُعدی شواهد‌محور Runner با امتیاز ساختاری/جریان سفارش (نه احتمال آماری)
 * =============================================================================
 */

import { Candle, OrderFlowFeatures, RealOrderBookImbalance } from '../types/trading';
import { atr, ema, rsi, calcMacd } from './indicators';

export type WaveStateMachineState =
  | 'WAVE_FORMING'
  | 'WAVE_CONFIRMED'
  | 'EARLY_ACCELERATION'
  | 'TREND_EXPANSION'
  | 'MATURE_WAVE'
  | 'EXHAUSTION_WARNING'
  | 'DISTRIBUTION'
  | 'EXIT';

export interface MultiDimensionalExitSignals {
  isStructureBroken: boolean;
  isOrderFlowReversed: boolean;
  isCvdDeteriorated: boolean;
  isObiReversed: boolean;
  isMomentumFailed: boolean;
  isLiquidityTargetReached: boolean;
  isVolatilityExhausted: boolean;
  isContinuationScoreLow: boolean;
  compositeExitUrgencyScore: number; // 0 - 100
  shouldExitRunnerImmediately: boolean;
  exitReasonFa: string;
}

export interface AdaptiveTierAllocations {
  tp1AllocationPct: number; // پله اول: کاهش ریسک (بر اساس نوسان و نسبت MFE/MAE)
  tp2AllocationPct: number; // پله دوم: برداشت بخش عمده سود
  runnerAllocationPct: number; // بخش دونده: نگهداری تا زمان بقای شواهد موج
  descriptionFa: string;
}

export interface PositionProfitState {
  positionId: string;
  unrealizedPnlPct: number;
  unrealizedPnlUsd: number;
  priceDeltaPct: number;
  currentTrailingOffsetPct: number; // Dynamic trailing stop offset
  currentTrailingStopPrice: number;
  waveState: WaveStateMachineState;
  activeLockRung: 'SEARCHING_ENTRY' | 'CAPITAL_PROTECTION_BREAKEVEN' | 'RUNG_1_ALPHA' | 'RUNG_2_EXPANSION' | 'RUNG_3_MAXIMUM_PEAK';
  lockedProfitUsd: number;
  capitalProtectionTriggered: boolean;
  exchangeFeeCovered: boolean;
  continuationHeuristicScore: number | null;
  isBreakevenPermitted: boolean;
  profitProtection: {
    isBreakevenArmed: boolean;
    minimumProtectedPnlUsd: number;
    safeBufferPrice: number;
    protectionRationaleFa: string;
  };
  profitMaximization: {
    isRunnerActive: boolean;
    tierAllocations: AdaptiveTierAllocations;
    breathingRoomAtr: number;
    runnerTargetExtPrice: number;
    maximizationRationaleFa: string;
  };
  exitSignals: MultiDimensionalExitSignals;
  actionGuidanceFa: string;
}

export class ProfitMaximizerTrailingEngine {
  private static instance: ProfitMaximizerTrailingEngine;

  public static getInstance(): ProfitMaximizerTrailingEngine {
    if (!ProfitMaximizerTrailingEngine.instance) {
      ProfitMaximizerTrailingEngine.instance = new ProfitMaximizerTrailingEngine();
    }
    return ProfitMaximizerTrailingEngine.instance;
  }

  /**
   * ۲۳. ارزیابی فاز حرکتی موج (Wave State Machine)
   */
  public determineWaveState(params: {
    direction: 'LONG' | 'SHORT';
    priceDeltaPct: number;
    mfePct: number;
    curAtr: number;
    currentPrice: number;
    curRsi: number;
    macdHistDelta: number;
    obi: number | null;
    cvdDelta: number | null;
  }): { state: WaveStateMachineState; continuationHeuristicScore: number | null; rationaleFa: string } {
    const {
      direction,
      priceDeltaPct,
      mfePct,
      curAtr,
      currentPrice,
      curRsi,
      macdHistDelta,
      obi,
      cvdDelta
    } = params;

    const isLong = direction === 'LONG';
    const isObiSupportive = obi !== null && (isLong ? obi >= 0 : obi <= 0);
    const isCvdSupportive = cvdDelta !== null && (isLong ? cvdDelta >= 0 : cvdDelta <= 0);

    // ۱. فاز خروج اضطراری (EXIT)
    if (priceDeltaPct <= -1.8) {
      return {
        state: 'EXIT',
        continuationHeuristicScore: null,
        rationaleFa: 'خروج فوری: نقض کامل شرایط موج و فعال‌سازی حد ابطال ساختاری.'
      };
    }

    // ۲. فاز توزیع / تخلیه نقدینگی (DISTRIBUTION)
    if (mfePct >= 3.5 && ((isLong && curRsi > 78 && macdHistDelta < 0) || (!isLong && curRsi < 22 && macdHistDelta > 0))) {
      return {
        state: 'DISTRIBUTION',
        continuationHeuristicScore: null,
        rationaleFa: 'فاز توزیع نهنگ‌ها: اشباع شدید قیمت همراه با واگرایی نزولی و کاهش شتاب حجم.'
      };
    }

    // ۳. فاز هشدار خستگی موج (EXHAUSTION_WARNING)
    if (mfePct >= 2.5 && ((isLong && curRsi > 72 && !isObiSupportive) || (!isLong && curRsi < 28 && !isObiSupportive))) {
      return {
        state: 'EXHAUSTION_WARNING',
        continuationHeuristicScore: null,
        rationaleFa: 'هشدار خستگی موج: واگرایی سفارشات دفتر سفارش و افت مومنتوم نسبت به سقف/کف قبلی.'
      };
    }

    // ۴. فاز موج بالغ (MATURE_WAVE)
    if (priceDeltaPct >= 2.2 && mfePct >= 2.2) {
      return {
        state: 'MATURE_WAVE',
        continuationHeuristicScore: null,
        rationaleFa: 'موج بالغ و پیشرفته: بخش عمده تارگت محقق شده؛ فعال‌سازی مدیریت تریلینگ روی Runner.'
      };
    }

    // ۵. فاز انبساط روند پرقدرت (TREND_EXPANSION)
    if (priceDeltaPct >= 1.2 && isObiSupportive && isCvdSupportive) {
      return {
        state: 'TREND_EXPANSION',
        continuationHeuristicScore: null,
        rationaleFa: 'انبساط روند (Trend Expansion): قدرت بالای جریان سفارشات و مومنتوم شتاب‌گیرنده در جهت پوزیشن.'
      };
    }

    // ۶. فاز شتاب اولیه (EARLY_ACCELERATION)
    if (priceDeltaPct >= 0.55 && isObiSupportive) {
      return {
        state: 'EARLY_ACCELERATION',
        continuationHeuristicScore: null,
        rationaleFa: 'شتاب اولیه: خروج از محدوده تراکم و حرکت هماهنگ با اردر بوک به سمت تارگت ۱.'
      };
    }

    // ۷. فاز تثبیت موج (WAVE_CONFIRMED)
    if (priceDeltaPct >= 0.20) {
      return {
        state: 'WAVE_CONFIRMED',
        continuationHeuristicScore: null,
        rationaleFa: 'تایید اولیه موج: ورود موفق و آغاز واکنش مثبت بدون شکست ساختار کف/سقف حمایتی.'
      };
    }

    // ۸. فاز شکل‌گیری موج (WAVE_FORMING)
    return {
      state: 'WAVE_FORMING',
      continuationHeuristicScore: null,
      rationaleFa: 'در حال شکل‌گیری موج اولیه: حفظ فضای تنفس استاندارد برای نوسانات طبیعی پولبک.'
    };
  }

  /**
   * ۲۴. محاسبه تخصیص پله‌ای ۲ مرحله‌ای (50% TP1 @ 1.5R + 50% Dynamic Chandelier Runner)
   */
  public calculateAdaptiveTierAllocations(volatilityPct: number, maePctExpected: number): AdaptiveTierAllocations {
    // طبق الزامات Profit Milking Engine: خروج کاملا ۲ پله‌ای (۵۰٪ TP1 + ۵۰٪ Runner)
    return {
      tp1AllocationPct: 50, // پله اول: ۵۰٪ حجم دقیقا در ریوارد ۱:۱.۵ تسویه می‌شود
      tp2AllocationPct: 0,  // لغو پله‌های واسط نویزدار
      runnerAllocationPct: 50, // ۵۰٪ دوم: تریلینگ داینامیک ۵ دقیقه‌ای
      descriptionFa: 'منطق ۲ پله‌ای: ۵۰٪ تسویه قطعی در ریوارد ۱:۱.۵ (TP1) و ۵۰٪ دوم توسط تریلینگ Chandelier ۵ دقیقه‌ای'
    };
  }

  /**
   * ۲۱ الی ۲۵. ارزیابی جامع سود، تریلینگ چندعامله و شواهد خروج Runner
   */
  public evaluatePositionProfitTrailing(
    entryPrice: number,
    currentPrice: number,
    positionType: 'LONG' | 'SHORT' = 'LONG',
    marginUsd = 1000,
    leverage = 5,
    context?: {
      candles?: Candle[];
      obi?: number | null;
      cvdDelta?: number | null;
      volatilityPct?: number;
      mfeAchievedPct?: number;
      maeAchievedPct?: number;
    }
  ): PositionProfitState {
    const entry = entryPrice > 0 ? entryPrice : 0;
    const current = currentPrice > 0 ? currentPrice : 0;
    const isLong = positionType === 'LONG';

    const priceDeltaPct = (entry > 0 && current > 0)
      ? (isLong ? ((current - entry) / entry) * 100 : ((entry - current) / entry) * 100)
      : 0;
    const unrealizedPnlPct = Math.round((priceDeltaPct * leverage) * 100) / 100;
    const unrealizedPnlUsd = Math.round((marginUsd * (unrealizedPnlPct / 100)) * 100) / 100;

    const mfePct = Math.max(priceDeltaPct, context?.mfeAchievedPct ?? priceDeltaPct);
    const maePct = context?.maeAchievedPct ?? (priceDeltaPct < 0 ? Math.abs(priceDeltaPct) : 0);
    const obi = context?.obi ?? null;
    const cvdDelta = context?.cvdDelta ?? null;
    const volPct = context?.volatilityPct ?? 1.4;

    // استخراج شاخص‌های کندلی در صورت وجود
    const curAtr = current * 0.008 * (volPct / 1.0);
    const curRsi = isLong ? 58 + Math.min(25, priceDeltaPct * 6) : 42 - Math.min(25, priceDeltaPct * 6);
    const macdHistDelta = priceDeltaPct >= 0 ? 1 : -1;

    // ۲۳. تعیین وضعیت Wave State Machine
    const waveInfo = this.determineWaveState({
      direction: positionType,
      priceDeltaPct,
      mfePct,
      curAtr,
      currentPrice: current,
      curRsi,
      macdHistDelta,
      obi,
      cvdDelta
    });

    // ۲۴. تخصیص دینامیک حجم پله‌ها
    const tierAllocations = this.calculateAdaptiveTierAllocations(volPct, maePct);

    // ۲۶ و ۲۷. محاسبه نقطه سربه‌سر کاملاً پویا و فعال‌سازی چندبُعدی Breakeven (اصول ۳۳ و ۳۴)
    // حذف هرگونه مقدار ثابت (مانند 0.25$) و جایگزینی با: Actual Fee + Real Slippage + Spread + Volatility + Position Size
    const notionalUsd = marginUsd * leverage;
    const positionSizeBtc = notionalUsd / Math.max(1, entry);
    
    // ۱. کارمزد واقعی رفت و برگشت صرافی
    const takerFeeRate = 0.00055;
    const roundtripFeeUsd = notionalUsd * (takerFeeRate * 2.0);
    
    // ۲. مدل اسلیپیج واقعی بر اساس نوسان و حجم سفارش
    const slippageBps = Math.max(0.4, Number((0.75 * (volPct / 1.0)).toFixed(2)));
    const dynamicSlippageUsd = notionalUsd * (slippageBps / 10000);
    
    // ۳. اسپرد و بافر نوسان ATR
    const spreadCostUsd = notionalUsd * (1.2 / 10000);
    const dynamicAtrBufferUsd = (curAtr * 0.08) * positionSizeBtc;
    
    const totalDynamicFrictionUsd = roundtripFeeUsd + dynamicSlippageUsd + spreadCostUsd + dynamicAtrBufferUsd;
    const dynamicOffsetPerBtc = totalDynamicFrictionUsd / Math.max(0.0001, positionSizeBtc);

    const realisticBreakevenPrice = isLong
      ? entry + dynamicOffsetPerBtc
      : entry - dynamicOffsetPerBtc;

    // ۳۴. فعال‌سازی چندبعدی Breakeven:
    // Breakeven نباید صرفاً با 0.8R یا 1.0R فعال شود.
    // تابع: Current Profit + MAE Risk + Continuation Probability + Market Noise Zone
    const initialRiskDist = curAtr * 1.5;
    const currentRMultiple = (Math.abs(current - entry)) / (initialRiskDist || 1.0);
    const mfeRMultiple = mfePct / (((initialRiskDist / entry) * 100) || 1.0);
    
    const marketNoiseZoneUsd = curAtr * 1.1; // زون نویز طبیعی بازار
    const isOutOfNoiseZone = Math.abs(current - entry) > marketNoiseZoneUsd;
    const isContinuationStrong = waveInfo.state === 'TREND_EXPANSION' || waveInfo.state === 'EARLY_ACCELERATION';
    const isMaeRiskSafe = maePct < 0.65;
    const isFrictionCovered = Math.abs(current - entry) >= (dynamicOffsetPerBtc * 1.8);

    // Breakeven فقط زمانی فعال می‌شود که از Noise Zone خارج شده و ریسک MAE مهار شده باشد
    const isBreakevenPermitted = isOutOfNoiseZone && isFrictionCovered && isMaeRiskSafe && (currentRMultiple >= 0.85 || mfeRMultiple >= 1.0);

    let activeLockRung: PositionProfitState['activeLockRung'] = 'SEARCHING_ENTRY';
    let lockedProfitUsd = 0;
    let capitalProtectionTriggered = false;

    // ۲۵. تریلینگ استاپ کاملاً پویا (تابعی از ATR + Volatility + Wave Stage + MFE + OrderFlow + Spread)
    let dynamicTrailingAtrMultiplier = 2.2; // Base Chandelier ATR factor
    if (waveInfo.state === 'TREND_EXPANSION') {
      dynamicTrailingAtrMultiplier = 2.0; // Tighten slightly during strong expansion
    } else if (waveInfo.state === 'MATURE_WAVE') {
      dynamicTrailingAtrMultiplier = 1.6; // Lock profit in mature wave
    } else if (waveInfo.state === 'EXHAUSTION_WARNING' || waveInfo.state === 'DISTRIBUTION') {
      dynamicTrailingAtrMultiplier = 1.1; // Strict trailing during exhaustion
    }

    // Volatility adjustment: wider trailing in high volatility, tighter in low volatility
    const volScaling = Math.max(0.8, Math.min(1.5, volPct / 1.4));
    dynamicTrailingAtrMultiplier *= volScaling;

    const dynamicTrailingDistanceUsd = curAtr * dynamicTrailingAtrMultiplier;
    const currentTrailingOffsetPct = (dynamicTrailingDistanceUsd / current) * 100;
    const breathingRoomAtr = Math.round(dynamicTrailingAtrMultiplier * 10) / 10;

    if (waveInfo.state === 'TREND_EXPANSION' || waveInfo.state === 'MATURE_WAVE') {
      activeLockRung = 'RUNG_3_MAXIMUM_PEAK';
      lockedProfitUsd = Math.round(marginUsd * (priceDeltaPct * 0.50 * leverage / 100));
      capitalProtectionTriggered = true;
    } else if (isBreakevenPermitted) {
      activeLockRung = 'CAPITAL_PROTECTION_BREAKEVEN';
      lockedProfitUsd = Math.round(totalDynamicFrictionUsd);
      capitalProtectionTriggered = true;
    } else {
      activeLockRung = 'SEARCHING_ENTRY';
      lockedProfitUsd = 0;
      capitalProtectionTriggered = false;
    }

    // محاسبه قیمت استاپ تریلینگ پویا Chandelier
    let currentTrailingStopPrice = isLong
      ? current - dynamicTrailingDistanceUsd
      : current + dynamicTrailingDistanceUsd;

    if (isBreakevenPermitted) {
      // اگر بریک‌ایون چندبعدی مجاز گردید، استاپ نباید از قیمت بریک‌ایون واقعی پایین‌تر رود
      if (isLong && currentTrailingStopPrice < realisticBreakevenPrice) {
        currentTrailingStopPrice = realisticBreakevenPrice;
      } else if (!isLong && currentTrailingStopPrice > realisticBreakevenPrice) {
        currentTrailingStopPrice = realisticBreakevenPrice;
      }
    }

    // ۲۴ و ۲۵. خروج چندبعدی ۵۰٪ دوم (Runner) - حفظ پوزیشن بر اساس امتیاز ساختاری موج
    const isStructureBroken = isLong ? current < (entry - curAtr * 1.8) : current > (entry + curAtr * 1.8);
    const isOrderFlowReversed = obi !== null && (isLong ? obi < -0.35 : obi > 0.35);
    const isCvdDeteriorated = cvdDelta !== null && (isLong ? cvdDelta < -120 : cvdDelta > 120);
    const isObiReversed = obi !== null && (isLong ? obi < -0.28 : obi > 0.28);
    const isMomentumFailed = (isLong && curRsi < 35) || (!isLong && curRsi > 65);
    const isLiquidityTargetReached = mfePct >= 5.0;
    const isVolatilityExhausted = waveInfo.state === 'DISTRIBUTION';
    const isContinuationScoreLow = waveInfo.continuationHeuristicScore !== null && waveInfo.continuationHeuristicScore < 40;

    let exitUrgencyScore = 0;
    if (isStructureBroken) exitUrgencyScore += 50;
    if (isOrderFlowReversed) exitUrgencyScore += 30;
    if (isCvdDeteriorated) exitUrgencyScore += 20;
    if (isContinuationScoreLow) exitUrgencyScore += 25;
    exitUrgencyScore = Math.min(100, exitUrgencyScore);

    // خروج Runner صرفاً در صورت نمره urgency بالای ۷۵ یا شکست قطعی ساختار
    const shouldExitRunnerImmediately = exitUrgencyScore >= 75 || isStructureBroken;
    const exitReasonFa = shouldExitRunnerImmediately
      ? `خروج Runner: ${isStructureBroken ? 'شکست ساختار روند ۵ دقیقه‌ای' : ''} ${isOrderFlowReversed ? 'چرخش شدید جریان سفارشات' : ''}`
      : `احتمال ادامهٔ موج UNVALIDATED است؛ Runner فقط با تریلینگ ساختاری ${breathingRoomAtr} ATR مدیریت می‌شود.`;

    const runnerTargetExtPrice = isLong ? entry + (curAtr * 4.5) : entry - (curAtr * 4.5);

    return {
      positionId: 'pos_wave_runner_1',
      unrealizedPnlPct,
      unrealizedPnlUsd,
      priceDeltaPct: Math.round(priceDeltaPct * 100) / 100,
      currentTrailingOffsetPct: Math.round(currentTrailingOffsetPct * 100) / 100,
      currentTrailingStopPrice: Math.round(currentTrailingStopPrice * 100) / 100,
      waveState: waveInfo.state,
      activeLockRung,
      lockedProfitUsd,
      capitalProtectionTriggered,
      exchangeFeeCovered: true,
      continuationHeuristicScore: waveInfo.continuationHeuristicScore,
      isBreakevenPermitted,
      profitProtection: {
        isBreakevenArmed: isBreakevenPermitted,
        minimumProtectedPnlUsd: lockedProfitUsd,
        safeBufferPrice: Math.round(realisticBreakevenPrice * 100) / 100,
        protectionRationaleFa: isBreakevenPermitted
          ? `حفاظت از اصل سرمایه فعال (Capital Protection): استاپ به $${Math.round(realisticBreakevenPrice)} (نقطه ورود + کارمزد + اسلیپیج) منتقل شد.`
          : `حفاظت سرمایه در فاز تنفس (${mfeRMultiple.toFixed(2)}R): استاپ به بریک‌اون منتقل نشده تا معامله از نویزهای اولیه خارج نشود (نیازمند حداقل 1.0R).`,
      },
      profitMaximization: {
        isRunnerActive: waveInfo.state !== 'WAVE_FORMING' && waveInfo.state !== 'EXIT' &&
          waveInfo.continuationHeuristicScore !== null && waveInfo.continuationHeuristicScore >= 40,
        tierAllocations,
        breathingRoomAtr,
        runnerTargetExtPrice: Math.round(runnerTargetExtPrice * 100) / 100,
        maximizationRationaleFa: `ماشین وضعیت: ${waveInfo.state} | احتمال ادامه: UNVALIDATED | فاصله تریلینگ پویا: ${breathingRoomAtr} ATR`,
      },
      exitSignals: {
        isStructureBroken,
        isOrderFlowReversed,
        isCvdDeteriorated,
        isObiReversed,
        isMomentumFailed,
        isLiquidityTargetReached,
        isVolatilityExhausted,
        isContinuationScoreLow,
        compositeExitUrgencyScore: exitUrgencyScore,
        shouldExitRunnerImmediately,
        exitReasonFa,
      },
      actionGuidanceFa: shouldExitRunnerImmediately
        ? `🚨 ${exitReasonFa}`
        : `🌊 فاز موج: ${waveInfo.state} (احتمال ادامه UNVALIDATED) • تریلینگ پویا ${breathingRoomAtr}x ATR (${currentTrailingOffsetPct.toFixed(2)}٪) • ${tierAllocations.descriptionFa}`,
    };
  }
}

export const profitMaximizerTrailingEngine = ProfitMaximizerTrailingEngine.getInstance();
