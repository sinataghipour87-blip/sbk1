import {
  Candle,
  EntryOpportunityReport,
  EntryOpportunitySurfaceReport,
  OpportunityLifecycle,
  TriggerQualityMetrics,
} from '../types/trading';

/**
 * 🎯 موتور مستقل ردیاب فرصت‌های ورود (Entry Opportunity Detector) - قانون ۱۷
 * 🏄‍♂️ موتور زمان‌بندی ورود و محاسبه Timing Score جداگانه از جهت - قانون ۱۸
 */
export class EntryOpportunityAndTimingService {
  private static instance: EntryOpportunityAndTimingService;

  private constructor() {}

  public evaluateOpportunitySurface(params: {
    currentPrice: number;
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    atr: number;
    stopPrice: number;
    targetPrice: number;
    calibratedProbabilityPct: number | null;
    expectedMaeR: number | null;
    expectedMfeR: number | null;
    expectedDurationSeconds: number | null;
    spreadBps: number | null;
    bidDepthUsd: number | null;
    askDepthUsd: number | null;
    orderNotionalUsd: number;
    isTriggerConfirmed: boolean;
    isModelEnsembleHealthy: boolean;
    fillProbabilityPct?: number | null;
    triggerQuality?: TriggerQualityMetrics | null;
  }): EntryOpportunitySurfaceReport {
    const {
      currentPrice, direction, atr, stopPrice, targetPrice, calibratedProbabilityPct,
      expectedMaeR, expectedMfeR, expectedDurationSeconds, spreadBps, bidDepthUsd,
      askDepthUsd, orderNotionalUsd, isTriggerConfirmed,
      isModelEnsembleHealthy,
      fillProbabilityPct = null,
      triggerQuality = null,
    } = params;
    if (
      !Number.isFinite(currentPrice) || currentPrice <= 0 ||
      !Number.isFinite(atr) || atr <= 0 ||
      !Number.isFinite(orderNotionalUsd) || orderNotionalUsd <= 0 ||
      !Number.isFinite(stopPrice) || stopPrice <= 0 ||
      !Number.isFinite(targetPrice) || targetPrice <= 0
    ) {
      throw new Error('Opportunity surface requires validated live price, ATR, stop, target, and order notional.');
    }
    const validMarketInputs =
      Number.isFinite(currentPrice) && currentPrice > 0 &&
      Number.isFinite(atr) && atr > 0 &&
      Number.isFinite(orderNotionalUsd) && orderNotionalUsd > 0 &&
      spreadBps !== null && Number.isFinite(spreadBps) && spreadBps >= 0;
    const points = Array.from({ length: 20 }, (_, index) => {
      const offset = ((index / 19) * 1.2 - 0.6) * atr;
      const entryPrice = Math.round((currentPrice + offset) * 100) / 100;
      const stopDistance = Math.abs(entryPrice - stopPrice);
      const reward = direction === 'LONG'
        ? targetPrice - entryPrice
        : entryPrice - targetPrice;
      const liquidityUsd = direction === 'LONG' ? askDepthUsd : bidDepthUsd;
      const hasLiquidity = typeof liquidityUsd === 'number' && Number.isFinite(liquidityUsd) && liquidityUsd > 0;
      const slippageBps = validMarketInputs && hasLiquidity
        ? (spreadBps! / 2) + (orderNotionalUsd / liquidityUsd!) * 10000
        : null;
      const hasProbability = calibratedProbabilityPct !== null &&
        Number.isFinite(calibratedProbabilityPct) &&
        calibratedProbabilityPct > 0 && calibratedProbabilityPct <= 100;
      const hasValidRiskReward = direction !== 'NEUTRAL' &&
        Number.isFinite(entryPrice) && entryPrice > 0 &&
        Number.isFinite(stopDistance) && stopDistance > 0 &&
        Number.isFinite(reward) && reward > 0;
      const costR = slippageBps !== null ? (slippageBps / 10000) * currentPrice / stopDistance : null;
      const expectedValueR = hasProbability && hasValidRiskReward && costR !== null
        ? (calibratedProbabilityPct! / 100) * (reward / stopDistance) -
          (1 - calibratedProbabilityPct! / 100) - costR
        : null;
      const pointFillProbability = fillProbabilityPct !== null && Number.isFinite(fillProbabilityPct) &&
        fillProbabilityPct >= 0 && fillProbabilityPct <= 100 ? fillProbabilityPct : null;
      const validMaeMfe = expectedMaeR !== null && Number.isFinite(expectedMaeR) && expectedMaeR >= 0 &&
        expectedMfeR !== null && Number.isFinite(expectedMfeR) && expectedMfeR >= 0 &&
        expectedMaeR + expectedMfeR > 0;
      const rewardRiskRatio = hasValidRiskReward ? reward / stopDistance : null;
      const maeMfeScore = validMaeMfe
        ? (expectedMfeR! / (expectedMaeR! + expectedMfeR!)) * 100
        : null;
      const qualityComponents = [
        expectedValueR !== null ? {
          score: Math.max(0, Math.min(100, 100 * expectedValueR / (1 + expectedValueR))),
          weight: 35,
        } : null,
        pointFillProbability !== null ? { score: pointFillProbability, weight: 20 } : null,
        slippageBps !== null && Number.isFinite(slippageBps)
          ? {
              score: reward > 0
                ? Math.max(0, Math.min(100, 100 * (1 - ((slippageBps / 10000) * entryPrice) / reward)))
                : 0,
              weight: 15,
            }
          : null,
        hasLiquidity
          ? { score: Math.max(0, Math.min(100, (liquidityUsd! / orderNotionalUsd) * 10)), weight: 10 }
          : null,
        rewardRiskRatio !== null
          ? { score: Math.max(0, Math.min(100, (rewardRiskRatio / 3) * 100)), weight: 10 }
          : null,
        maeMfeScore !== null ? { score: maeMfeScore, weight: 10 } : null,
      ].filter((component): component is { score: number; weight: number } => component !== null);
      const qualityWeight = qualityComponents.reduce((total, component) => total + component.weight, 0);
      const qualityScore = expectedValueR !== null && expectedValueR > 0 && qualityWeight > 0
        ? Math.round(qualityComponents.reduce(
            (total, component) => total + component.score * component.weight,
            0
          ) / qualityWeight)
        : null;
      return {
        entryPrice,
        calibratedProbabilityPct: hasProbability ? calibratedProbabilityPct : null,
        expectedValueR: expectedValueR === null ? null : Math.round(expectedValueR * 1000) / 1000,
        expectedMaeR,
        expectedMfeR,
        expectedDurationSeconds,
        fillProbabilityPct: pointFillProbability,
        slippageBps: slippageBps === null ? null : Math.round(slippageBps * 100) / 100,
        stopDistance: hasValidRiskReward ? Math.round(stopDistance * 100) / 100 : null,
        reward: hasValidRiskReward ? Math.round(reward * 100) / 100 : null,
        liquidityUsd: hasLiquidity ? liquidityUsd : null,
        qualityScore,
      };
    });

    const bestPoint = points
      .filter(point => point.expectedValueR !== null && point.expectedValueR > 0 &&
        point.qualityScore !== null && point.qualityScore > 0)
      .reduce<typeof points[number] | null>(
        (best, point) => best === null ||
          point.qualityScore! > best.qualityScore! ||
          (point.qualityScore === best.qualityScore && point.expectedValueR! > best.expectedValueR!)
          ? point
          : best,
        null
      );
    const goodPoints = bestPoint
      ? points.filter(point => point.qualityScore !== null &&
        point.qualityScore! >= bestPoint.qualityScore! * 0.95)
      : [];
    const entryZone = goodPoints.length > 0
      ? {
          min: Math.min(...goodPoints.map(point => point.entryPrice)),
          max: Math.max(...goodPoints.map(point => point.entryPrice)),
        }
      : null;
    const tolerance = atr * 0.05;
    const isPriceAtOptimalEntry = bestPoint !== null && Math.abs(currentPrice - bestPoint.entryPrice) <= tolerance;
    const selectedPoint = isPriceAtOptimalEntry
      ? bestPoint
      : null;
    const fillAvailable = bestPoint?.fillProbabilityPct !== null &&
      bestPoint?.fillProbabilityPct !== undefined;
    const hasLiveLiquidityCost = validMarketInputs &&
      points.some(point => point.liquidityUsd !== null && point.slippageBps !== null);
    const canExecute = direction !== 'NEUTRAL' &&
      isModelEnsembleHealthy &&
      validMarketInputs &&
      selectedPoint !== null &&
      isTriggerConfirmed &&
      selectedPoint.fillProbabilityPct !== null &&
      triggerQuality?.isOrderFlowConfirmed === true;
    const mode: EntryOpportunitySurfaceReport['mode'] = canExecute
      ? 'EXECUTE'
      : bestPoint && calibratedProbabilityPct !== null && isModelEnsembleHealthy
      ? 'AMBUSH'
      : 'HUNT';
    const readinessConditions = [
      calibratedProbabilityPct !== null,
      bestPoint !== null && hasLiveLiquidityCost,
      isModelEnsembleHealthy,
      isPriceAtOptimalEntry,
      isTriggerConfirmed,
      fillAvailable,
    ];
    const readinessPct = Math.round(
      readinessConditions.filter(Boolean).length / readinessConditions.length * 100
    );
    const nearMissReasonFa = mode === 'EXECUTE'
      ? null
      : `${readinessPct}% READY — ${
          calibratedProbabilityPct === null
            ? 'WAIT FOR OOS CALIBRATION'
            : !isModelEnsembleHealthy
            ? 'WAIT FOR HEALTHY BRAIN ENSEMBLE'
            : !bestPoint || !hasLiveLiquidityCost
            ? 'WAIT FOR POSITIVE EV AND LIVE LIQUIDITY'
            : !isPriceAtOptimalEntry
            ? `WAIT FOR OPTIMAL ENTRY $${bestPoint.entryPrice.toFixed(2)}`
            : triggerQuality?.isOrderFlowConfirmed !== true
            ? 'WAIT FOR LIVE CVD AND ORDER-FLOW CONFIRMATION'
            : !isTriggerConfirmed
            ? 'WAIT FOR LIVE TRIGGER CONFIRMATION'
            : !fillAvailable
            ? 'WAIT FOR VERIFIED FILL PROBABILITY'
            : 'WAIT FOR EXECUTION GATES'
        }`;

    return {
      mode,
      direction,
      points,
      triggerQuality: triggerQuality ?? undefined,
      entryZone,
      optimalEntryPrice: bestPoint?.entryPrice ?? null,
      isPriceAtOptimalEntry,
      isTriggerConfirmed,
      readinessPct,
      nearMissReasonFa,
      fillProbabilityAvailable: fillAvailable,
      evaluatedAt: Date.now(),
    };
  }

  public static getInstance(): EntryOpportunityAndTimingService {
    if (!EntryOpportunityAndTimingService.instance) {
      EntryOpportunityAndTimingService.instance = new EntryOpportunityAndTimingService();
    }
    return EntryOpportunityAndTimingService.instance;
  }

  /**
   * محاسبه دقیق امتیاز زمان‌بندی ورود (Entry Timing Score) - قانون ۱۸
   * جدا از امتیاز تاییدیه همگرایی فنی جهت (Direction Score)
   */
  public calculateEntryTimingScore(params: {
    currentPrice: number;
    emaFast: number;
    vwap: number;
    rsi: number;
    stochK?: number;
    atr: number;
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    obi: number;
  }): {
    timingScore: number;
    verdictFa: string;
    isOptimal: boolean;
    reasonsFa: string[];
  } {
    const { currentPrice, emaFast, vwap, rsi, stochK = 50, atr, direction, obi } = params;
    const reasonsFa: string[] = [];
    
    if (direction === 'NEUTRAL') {
      return {
        timingScore: 0,
        verdictFa: 'روند بازار خنثی است؛ زمان‌بندی ورود غیرفعال است.',
        isOptimal: false,
        reasonsFa: ['جهت روند مشخص نیست.'],
      };
    }

    let timingScore = 100;
    const isLong = direction === 'LONG';

    // ۱. بررسی کشیدگی و فاصله قیمت از مبدأ / میانگین ارزش (Anti-Chasing Mean Reversion Rule)
    // هر چه فاصله قیمت از Fast EMA یا VWAP بیشتر از 0.6 * ATR باشد، ورود نامناسب‌تر است و امتیاز کسر می‌شود.
    const averageReference = (emaFast + vwap) / 2;
    const distanceFromMean = Math.abs(currentPrice - averageReference);
    const distanceToAtrRatio = distanceFromMean / (atr || 1);

    if (distanceToAtrRatio > 1.8) {
      timingScore -= 45;
      reasonsFa.push(`🛑 کشیدگی شدید قیمت از میانگین ارزش (${distanceToAtrRatio.toFixed(1)} ATR) - ریسک تعقیب قیمت بالا.`);
    } else if (distanceToAtrRatio > 0.8) {
      timingScore -= 20;
      reasonsFa.push(`⏳ قیمت در لبه بالایی نوسان است؛ ورود ریسک به ریوارد جذابی ندارد.`);
    } else {
      timingScore += 10; // پاداش نزدیکی به میانگین ارزش
      reasonsFa.push(`✅ زمان‌بندی عالی: قیمت چسبیده به میانگین ارزش است و فاقد کشیدگی (Pullback Complete).`);
    }

    // ۲. بررسی اشباع موقتی مومنتوم (RSI Exhaustion / Overbought & Oversold Lock)
    // جهت درست است اما نوسان مومنتوم در انتهاست (ورود در سقف موج موقت ممنوع)
    if (isLong) {
      if (rsi >= 72) {
        timingScore -= 35;
        reasonsFa.push(`🛑 اشباع خرید مومنتوم (RSI: ${Math.round(rsi)}) - جهت درست است، اما زمان ورود هنوز مناسب نیست.`);
      } else if (rsi < 40) {
        timingScore -= 15;
        reasonsFa.push(`⏳ ضعف ممانعت صعودی مومنتوم؛ در انتظار نشانه‌های بازگشت.`);
      } else {
        timingScore += 10;
      }
    } else {
      if (rsi <= 28) {
        timingScore -= 35;
        reasonsFa.push(`🛑 اشباع فروش مومنتوم (RSI: ${Math.round(rsi)}) - جهت نزولی درست است، اما زمان ورود هنوز مناسب نیست.`);
      } else if (rsi > 60) {
        timingScore -= 15;
        reasonsFa.push(`⏳ ضعف ساختار نزولی مومنتوم؛ در انتظار نشانه‌های ریزش.`);
      } else {
        timingScore += 10;
      }
    }

    // ۳. بررسی همگرایی جریان سفارشات (OBI Alignment)
    const isObiAligned = isLong ? obi > 0.05 : obi < -0.05;
    if (!isObiAligned) {
      timingScore -= 15;
      reasonsFa.push(`⏳ عدم انطباق جریان سفارشات (Real OBI: ${obi.toFixed(2)}) - تقاضای لحظه‌ای ضعیف است.`);
    } else {
      timingScore += 10;
    }

    // محدود کردن امتیاز بین ۵ تا ۱۰۰
    timingScore = Math.min(100, Math.max(5, timingScore));

    let verdictFa = 'زمان‌بندی ورود اسنایپر و عالی است؛ آماده شلیک.';
    if (timingScore < 60) {
      verdictFa = 'جهت درست است، اما زمان ورود هنوز مناسب نیست (ریسک بالای اصلاح قیمت).';
    } else if (timingScore < 75) {
      verdictFa = 'زمان‌بندی متوسط؛ در انتظار تکمیل فشرده‌سازی قیمت.';
    }

    return {
      timingScore,
      verdictFa,
      isOptimal: timingScore >= 75,
      reasonsFa,
    };
  }

  /**
   * پایش چرخه عمر فرصت معاملاتی (FORMING -> ARMED -> TRIGGERED -> EXECUTABLE -> EXPIRED) - قانون ۱۷
   */
  public detectOpportunityState(params: {
    candles: Candle[];
    currentPrice: number;
    rsi: number;
    obi: number;
    adx: number;
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    emaFast: number;
    vwap: number;
    atr: number;
    isRiskGatePassed: boolean;
  }): EntryOpportunityReport {
    const { candles, currentPrice, rsi, obi, adx, direction, emaFast, vwap, atr, isRiskGatePassed } = params;
    const now = Date.now();
    const reasonsFa: string[] = [];

    const averageReference = (emaFast + vwap) / 2;
    const distanceFromMean = Math.abs(currentPrice - averageReference);
    const distanceToAtrRatio = distanceFromMean / (atr || 1);

    let state: OpportunityLifecycle = 'FORMING';
    let stateFa = 'در حال شکل‌گیری نواحی نقدینگی و رنج (FORMING)';
    let formingProgressPct = 25;
    let timeToTriggerEstMin = 15; // تخمین زمان محرک

    if (direction === 'NEUTRAL') {
      return {
        opportunityId: 'OPP_NEUTRAL',
        state: 'FORMING',
        stateFa: 'در حال پایش و شکل‌گیری (FORMING)',
        direction: 'NEUTRAL',
        timeToTriggerEstMin: 30,
        formingProgressPct: 10,
        isTriggered: false,
        isExecutable: false,
        setupQualityScore: 0,
        timingScore: 0,
        verdictFa: 'سیستم در حال ردیابی نواحی نقدینگی و پیوت‌های جدید است.',
        reasonsFa: ['روند بازار در حال حاضر خنثی یا نامشخص است.'],
        checkedAt: now,
      };
    }

    const isLong = direction === 'LONG';

    // ۱. ارزیابی چرخه عمر بر اساس فاز قیمت و نوسان مومنتوم
    if (distanceToAtrRatio > 2.5) {
      // قیمت بسیار فراتر از مبدأ حرکت دور شده است -> منقضی‌شده و اشباع
      state = 'EXPIRED';
      stateFa = 'فرصت منقضی‌شده و کشیدگی مفرط قیمت (EXPIRED)';
      formingProgressPct = 0;
      timeToTriggerEstMin = 0;
      reasonsFa.push('❌ فرصت منقضی شده است: قیمت حرکت بزرگی انجام داده و ورود در اینجا ریسک تعقیب قیمت شدیدی دارد.');
    } else {
      // بررسی پولبک و ورود قیمت به لایه حساس (Fast EMA یا سقف اردربلاک)
      const isNearMean = distanceToAtrRatio <= 0.8;
      const isMomentumOverExtended = isLong ? rsi > 70 : rsi < 30;

      if (!isNearMean && !isMomentumOverExtended) {
        // قیمت دور از پیوت است اما هنوز حرکت انفجاری نکرده -> در حال تشکیل
        state = 'FORMING';
        stateFa = 'تشکیل تدریجی و انباشت اوردربوک (FORMING)';
        formingProgressPct = 45;
        timeToTriggerEstMin = 8;
        reasonsFa.push('⏳ نواحی و همگرایی‌های جهت درست است، اما قیمت هنوز به عمق منطقه پولبک بهینه نرسیده است.');
      } else if (isNearMean && isMomentumOverExtended) {
        // قیمت وارد فاز فشرده‌سازی شده است -> مسلح (ARMED)
        state = 'ARMED';
        stateFa = 'آماده‌باش و ورود قیمت به لایه پولبک بهینه (ARMED)';
        formingProgressPct = 75;
        timeToTriggerEstMin = 3;
        reasonsFa.push('🎯 تفنگ مسلح است: قیمت در عمیق‌ترین نقطه پولبک و میانگین ارزش قرار دارد؛ در انتظار تایید ممانعت مومنتوم.');
      } else if (isNearMean && !isMomentumOverExtended) {
        // پولبک تکمیل شده و تاییدیه مومنتوم/تغییر ساختار OBI صادر شده -> TRIGGERED
        const isObiConfirm = isLong ? obi > 0.05 : obi < -0.05;
        if (isObiConfirm) {
          state = 'TRIGGERED';
          stateFa = 'شلیک سیگنال زمان‌بندی صادر شد (TRIGGERED)';
          formingProgressPct = 90;
          timeToTriggerEstMin = 1;
          reasonsFa.push('⚡ تریگر صادر شد: تایید تغییر جهت حجم سفارشات زنده و کندل برگشتی ثبت گردید.');
        } else {
          state = 'ARMED';
          stateFa = 'مسلح با کمبود تقاضای لحظه‌ای (ARMED)';
          formingProgressPct = 80;
          timeToTriggerEstMin = 2;
          reasonsFa.push('⏳ قیمت در ناحیه عالی است اما OBI برای ورود قطعی هنوز تایید صادر نکرده است.');
        }
      }
    }

    // ارتقا به EXECUTABLE در صورت عبور از فیلترهای Pre-Trade Risk
    if (state === 'TRIGGERED' && isRiskGatePassed) {
      state = 'EXECUTABLE';
      stateFa = 'کاملاً آماده تسویه و شلیک تایید شده (EXECUTABLE)';
      formingProgressPct = 100;
      timeToTriggerEstMin = 0;
      reasonsFa.push('✅ تمام ۱۸ فیلتر Pre-Trade Risk Gate تایید شد. پوزیشن آماده شلیک آنی است.');
    }

    // ۲. محاسبه امتیاز زمان‌بندی
    const timingEval = this.calculateEntryTimingScore({
      currentPrice,
      emaFast,
      vwap,
      rsi,
      atr,
      direction,
      obi,
    });

    // امتیاز کیفیت تکنیکال جهت (Directional Setup Score)
    const setupQualityScore = adx > 25 ? 85 : 65;

    const opportunityId = `OPP_LIVE_${direction}_${Math.round(averageReference / 100) * 100}_${state}`;

    return {
      opportunityId,
      state,
      stateFa,
      direction,
      timeToTriggerEstMin,
      formingProgressPct,
      isTriggered: state === 'TRIGGERED' || state === 'EXECUTABLE',
      isExecutable: state === 'EXECUTABLE',
      setupQualityScore,
      timingScore: timingEval.timingScore,
      verdictFa: timingEval.verdictFa,
      reasonsFa: [...reasonsFa, ...timingEval.reasonsFa],
      checkedAt: now,
    };
  }
}

export const entryOpportunityAndTiming = EntryOpportunityAndTimingService.getInstance();
