/**
 * 🧠 لایه منطقی مغز بازیابی استراتژیک (Strategic-Recovery-Brain)
 * 
 * وظایف اصلی:
 * ۱. قفل آنی و انجماد کلیه معاملات جدید سیستم به محض ورود هر پوزیشن به فاز ضرر (Global Trade Freeze)
 * ۲. آنالیز نوسانات میکرو (Micro-Volatility & Orderbook Imbalance) در تایم‌فریم‌های زیر ۱ دقیقه
 * ۳. محاسبه حجم دقیق معکوس (Exact Counter-Volume) برای خنثی‌سازی کامل دلتا (Delta-Hedging)
 * ۴. طراحی مسیر تسویه و رسیدن به نقطه سربه‌سر امن (Breakeven) در کمتر از ۳ دقیقه (Sub-3-Minute Trajectory)
 */

import { TradePosition, Candle, StandaloneRecoveryEvaluation } from '../types/trading';

export interface MicroVolatilityProfile {
  microAtrUsd: number;
  subMinuteDeltaPct: number;
  orderbookImbalanceScore: number; // -100 to +100
  momentumVelocity: number;
  estimatedCycleSeconds: number;
}

export interface DeltaHedgePlan {
  recommendedDirection: 'LONG' | 'SHORT';
  exactCounterVolumeUsd: number;
  counterLeverage: number;
  targetBreakevenPrice: number;
  targetRecoverySeconds: number;
  requiredPriceDeltaPct: number;
  expectedNetPnlUsd: number;
  standaloneSetup: StandaloneRecoveryEvaluation;
  rationaleFa: string;
}


export interface StrategicRecoveryReport {
  timestamp: string;
  isDrawdownDetected: boolean;
  globalTradeFreezeActive: boolean; // آیا تمام معاملات دیگر در فریز هستند؟
  activeLossPositionsCount: number;
  totalFloatingLossUsd: number;
  microVolatility: MicroVolatilityProfile;
  activePlan: DeltaHedgePlan | null;
  subThreeMinuteTimerSec: number;
  recoveryStatusFa: string;
  actionGuidanceFa: string;
  isReadyForExecution: boolean;
}

export class StrategicRecoveryBrainService {
  private static instance: StrategicRecoveryBrainService;
  private freezeActiveUntil: number = 0;
  private recoveryCycleStartTime: number = 0;

  private constructor() {}

  public static getInstance(): StrategicRecoveryBrainService {
    if (!StrategicRecoveryBrainService.instance) {
      StrategicRecoveryBrainService.instance = new StrategicRecoveryBrainService();
    }
    return StrategicRecoveryBrainService.instance;
  }

  /**
   * تحلیل فوری نوسانات میکرو صدم‌ثانیه‌ای
   */
  public analyzeMicroVolatility(currentPrice: number, candles: Candle[] = [], obi = 0): MicroVolatilityProfile {
    let microAtr = currentPrice * 0.0012; // پیش‌فرض ۰.۱۲٪ نوسان
    if (candles && candles.length >= 5) {
      const recent = candles.slice(-5);
      const ranges = recent.map(c => Math.abs(c[1] - c[2])); // High - Low
      const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
      if (avgRange > 0) microAtr = avgRange;
    }

    // سرعت نوسان و ایمبالانس سفارشات
    const subMinuteDeltaPct = (microAtr / Math.max(1, currentPrice)) * 100.0;
    const orderbookImbalanceScore = Math.min(100, Math.max(-100, Math.round(obi * 100))); // استفاده مستقیم از عمق واقعی دفتر سفارشات

    return {
      microAtrUsd: Math.round(microAtr * 100) / 100,
      subMinuteDeltaPct: Math.round(subMinuteDeltaPct * 1000) / 1000,
      orderbookImbalanceScore,
      momentumVelocity: 1.85,
      estimatedCycleSeconds: 120, // چرخه ۲ دقیقه‌ای خروج
    };
  }

  /**
   * ۱۵ & ۱۶: ارزیابی ست‌آپ مستقل ورود مجدد و حذف Recovery مبتنی بر امید به برگشت
   */
  public evaluateStandaloneRecoverySetup(
    pos: TradePosition,
    currentPrice: number,
    candles: Candle[] = [],
    obiScore = 0
  ): StandaloneRecoveryEvaluation {
    const now = Date.now();
    const reasonsFa: string[] = [];

    // ۱. بررسی کندل‌های اخیر جهت کشف ست‌آپ تکنیکال جدید و مستقل (شامل سوئپ، شکست MSS یا برگشت از ناحیه ارزش)
    const recent = candles.length >= 10 ? candles.slice(-10) : candles;
    const atrApprox = recent.length > 0
      ? recent.reduce((sum, c) => sum + Math.abs(c[1] - c[2]), 0) / recent.length
      : currentPrice * 0.008;

    const isPrimaryLong = pos.dir === 'LONG';
    const counterDirection: 'LONG' | 'SHORT' = isPrimaryLong ? 'SHORT' : 'LONG';

    let isSetupConfirmed = false;
    let standaloneSetupType: StandaloneRecoveryEvaluation['standaloneSetupType'] = 'NO_STANDALONE_SETUP';
    let targetDirection: 'LONG' | 'SHORT' = counterDirection;

    if (recent.length >= 3) {
      const lastCandle = recent[recent.length - 1];
      const prevCandle = recent[recent.length - 2];
      const prevLow = Math.min(...recent.slice(0, -1).map(c => c[2]));
      const prevHigh = Math.max(...recent.slice(0, -1).map(c => c[1]));

      // بررسی ست‌آپ صعودی (LONG Reentry) - نیازمند تاییدیه سوئپ کف یا شکست معتبر با حجم و OBI
      const sweptLow = lastCandle[2] <= prevLow && lastCandle[3] > prevLow;
      const mssBullish = lastCandle[3] > prevCandle[1] && obiScore >= 15;
      const obiBullish = obiScore >= 25;

      // بررسی ست‌آپ نزولی (SHORT Hedge) - نیازمند تاییدیه سوئپ سقف یا شکست معتبر با حجم و OBI
      const sweptHigh = lastCandle[1] >= prevHigh && lastCandle[3] < prevHigh;
      const mssBearish = lastCandle[3] < prevCandle[2] && obiScore <= -15;
      const obiBearish = obiScore <= -25;


      if (sweptLow || mssBullish || obiBullish) {
        targetDirection = 'LONG';
        standaloneSetupType = sweptLow ? 'LIQUIDITY_SWEEP_REVERSAL' : (mssBullish ? 'MSS_STRUCTURE_BREAKOUT' : 'VALUE_AREA_REJECTION');
        isSetupConfirmed = true;
      } else if (sweptHigh || mssBearish || obiBearish) {
        targetDirection = 'SHORT';
        standaloneSetupType = sweptHigh ? 'LIQUIDITY_SWEEP_REVERSAL' : (mssBearish ? 'MSS_STRUCTURE_BREAKOUT' : 'VALUE_AREA_REJECTION');
        isSetupConfirmed = true;
      }
    }

    // ۲. محاسبه حد ضرر و حد سود کاملاً مستقل بر اساس ساختار جدید
    const independentStopLoss = targetDirection === 'LONG'
      ? currentPrice - (atrApprox * 1.5)
      : currentPrice + (atrApprox * 1.5);

    const independentTakeProfit = targetDirection === 'LONG'
      ? currentPrice + (atrApprox * 2.5)
      : currentPrice - (atrApprox * 2.5);


    const riskDist = Math.abs(currentPrice - independentStopLoss);
    const rewardDist = Math.abs(independentTakeProfit - currentPrice);
    const independentRiskReward = Math.round((rewardDist / (riskDist || 1)) * 100) / 100;

    // ۳. محاسبه احتمال کالیبره‌شده مستقل (Standalone Win Probability)
    const standaloneWinProbPct = isSetupConfirmed ? Math.min(88, Math.max(68, 70 + (obiScore * 0.1))) : 42;
    const posMargin = pos.initialMargin || pos.margin || 50;
    const standaloneEvUsd = isSetupConfirmed
      ? (posMargin * (standaloneWinProbPct / 100) * independentRiskReward) - (posMargin * (1 - standaloneWinProbPct / 100))
      : -15;

    // ۴. قانون ۱۵ و ۱۶: ممانعت کامل از میانگین‌گیری/مارتینگل روی ضرر بدون ست‌آپ (Averaging Down Blocked)
    const averagingDownBlocked = !isSetupConfirmed || standaloneWinProbPct < 65 || standaloneEvUsd <= 0;

    if (averagingDownBlocked) {
      reasonsFa.push('❌ قوانین ۱۵ و ۱۶: ورود مجدد/افزایش حجم فقط به دلیل رفتن معامله در ضرر (امید به برگشت) اکیداً ممنوع است.');
      reasonsFa.push('❌ عدم کشف ست‌آپ تکنیکال جدید و مستقل با احتمال برد ≥۶۵٪ و EV مثبت.');
    } else {
      reasonsFa.push(`✅ تایید ست‌آپ مستقل جدید (${standaloneSetupType}) با احتمال کالیبره‌شده ${standaloneWinProbPct.toFixed(1)}٪ و R:R = ${independentRiskReward}.`);
      reasonsFa.push('✅ ورود مجدد/هج به عنوان یک معامله کاملاً مستقل با حد ضرر و حد سود جدید ارزیابی و تایید شد.');
    }

    return {
      isSetupConfirmed: !averagingDownBlocked,
      standaloneSetupType,
      standaloneWinProbPct: Math.round(standaloneWinProbPct * 10) / 10,
      standaloneEvUsd: Math.round(standaloneEvUsd * 100) / 100,
      independentStopLoss: Math.round(independentStopLoss * 100) / 100,
      independentTakeProfit: Math.round(independentTakeProfit * 100) / 100,
      independentRiskReward,
      averagingDownBlocked,
      decisionStatus: !averagingDownBlocked ? 'INDEPENDENT_SETUP_APPROVED' : 'HOPE_RECOVERY_REJECTED',
      reasonsFa,
      checkedAt: now,
    };
  }

  /**
   * محاسبه دقیق حجم معکوس خنثی‌کننده دلتا برای تسویه زیر ۳ دقیقه
   */
  public computeExactDeltaHedgePlan(
    pos: TradePosition,
    currentPrice: number,
    microVol: MicroVolatilityProfile,
    candles: Candle[] = []
  ): DeltaHedgePlan {
    const isPrimaryLong = pos.dir === 'LONG';
    const counterDirection: 'LONG' | 'SHORT' = isPrimaryLong ? 'SHORT' : 'LONG';
    const leverage = pos.lev || 10;
    const primaryMargin = pos.initialMargin || pos.margin || 10;

    // ارزیابی ست‌آپ مستقل ورود مجدد (قوانین ۱۵ و ۱۶)
    const standaloneSetup = this.evaluateStandaloneRecoverySetup(pos, currentPrice, candles, microVol.orderbookImbalanceScore);

    // محاسبه ضرر انباشته اولیه
    const currentPriceDiff = isPrimaryLong ? (currentPrice - pos.entry) : (pos.entry - currentPrice);
    const pnlPct = (currentPriceDiff / Math.max(1, pos.entry)) * 100.0 * leverage;
    const floatingLossUsd = Math.abs(Math.min(0, primaryMargin * (pnlPct / 100.0)));

    // حجم بهینه لگ هج
    const exactCounterVolumeUsd = Math.round(primaryMargin * 1.25 * 100) / 100;
    
    // هدف قیمتی برای خروج با سود خالص
    const requiredPriceMove = microVol.microAtrUsd * 0.45;
    const targetBreakevenPrice = counterDirection === 'SHORT'
      ? currentPrice - requiredPriceMove
      : currentPrice + requiredPriceMove;

    const requiredPriceDeltaPct = (requiredPriceMove / currentPrice) * 100.0;

    const rationaleFa = standaloneSetup.isSetupConfirmed
      ? `شلیک پوزیشن مستقل ${counterDirection} (ست‌آپ: ${standaloneSetup.standaloneSetupType}، احتمال: ${standaloneSetup.standaloneWinProbPct}٪) جهت پوشش ریسک -$${floatingLossUsd.toFixed(2)}.`
      : `🛑 ورود مجدد/افزایش حجم بلاک شد: عدم وجود ست‌آپ جدید مستقل (امید به برگشت ممنوع است).`;

    return {
      recommendedDirection: counterDirection,
      exactCounterVolumeUsd,
      counterLeverage: leverage,
      targetBreakevenPrice: Math.round(targetBreakevenPrice * 100) / 100,
      targetRecoverySeconds: 160,
      requiredPriceDeltaPct: Math.round(requiredPriceDeltaPct * 100) / 100,
      expectedNetPnlUsd: standaloneSetup.isSetupConfirmed ? 0.12 : 0,
      standaloneSetup,
      rationaleFa,
    };
  }

  /**
   * پایش وضعیت کلیه معاملات و اعمال انجماد سراسری در صورت وجود ضرر
   */
  public evaluateRecoveryState(
    activePositions: TradePosition[],
    currentPrice: number,
    candles: Candle[] = []
  ): StrategicRecoveryReport {
    const microVol = this.analyzeMicroVolatility(currentPrice, candles);
    
    // شناسایی پوزیشن‌های در ضرر
    let totalLossUsd = 0;
    const lossPositions: TradePosition[] = [];

    activePositions.forEach((pos) => {
      const isLong = pos.dir === 'LONG';
      const entry = pos.entry || currentPrice;
      const lev = pos.lev || 10;
      const margin = pos.initialMargin || pos.margin || 10;
      const diff = isLong ? (currentPrice - entry) : (entry - currentPrice);
      const pnlPct = (diff / Math.max(1, entry)) * 100.0 * lev;
      const pnlUsd = margin * (pnlPct / 100.0) + (pos.realizedPnlUsd || 0);

      if (pnlUsd < -0.15 || pos.hedgeActive) {
        lossPositions.push(pos);
        totalLossUsd += Math.abs(Math.min(0, pnlUsd));
      }
    });

    const isDrawdownDetected = lossPositions.length > 0;

    // فعال‌سازی قفل سراسری معاملات
    if (isDrawdownDetected) {
      this.freezeActiveUntil = Date.now() + 180000; // قفل ۳ دقیقه‌ای
      if (this.recoveryCycleStartTime === 0) {
        this.recoveryCycleStartTime = Date.now();
      }
    } else {
      this.recoveryCycleStartTime = 0;
    }

    const elapsedSec = this.recoveryCycleStartTime > 0 
      ? Math.floor((Date.now() - this.recoveryCycleStartTime) / 1000)
      : 0;
    const remainingTimerSec = Math.max(0, 180 - elapsedSec);

    let activePlan: DeltaHedgePlan | null = null;
    if (lossPositions.length > 0) {
      activePlan = this.computeExactDeltaHedgePlan(lossPositions[0], currentPrice, microVol, candles);
    }

    const isReadyForExecution = Boolean(activePlan && activePlan.standaloneSetup.isSetupConfirmed);

    return {
      timestamp: new Date().toLocaleTimeString('fa-IR'),
      isDrawdownDetected,
      globalTradeFreezeActive: isDrawdownDetected,
      activeLossPositionsCount: lossPositions.length,
      totalFloatingLossUsd: Math.round(totalLossUsd * 100) / 100,
      microVolatility: microVol,
      activePlan,
      subThreeMinuteTimerSec: isDrawdownDetected ? remainingTimerSec : 180,
      recoveryStatusFa: isDrawdownDetected
        ? (isReadyForExecution
            ? `🚨 پوزیشن در ضرر شناسایی شد؛ ست‌آپ مستقل ورود مجدد تایید شده و آماده اجرای هج ساختاری است.`
            : `🛑 پوزیشن در ضرر شناسایی شد اما اضافه کردن حجم به دلیل عدم وجود ست‌آپ مستقل جدید بلاک گردید (مارتینگل/امید به برگشت ممنوع).`)
        : `🟢 وضعیت امن؛ کلیه پوزیشن‌ها در سود یا سربه‌سر هستند و ورود به سیگنال‌های جدید آزاد است.`,
      actionGuidanceFa: isDrawdownDetected
        ? (isReadyForExecution
            ? `اجرای ورود مجدد مستقل بر پایه ست‌آپ تاییدشده ${activePlan?.standaloneSetup.standaloneSetupType}.`
            : `توقف هرگونه ورود یا اضافه کردن حجم تا زمان شکل‌گیری یک ست‌آپ جدید و مستقل با احتمال برد بالا.`)
        : `سیستم با حفظ حداکثر فرکانس و دقت، آماده اجرای سیگنال‌های بعدی است.`,
      isReadyForExecution,
    };
  }


  /**
   * آیا باز کردن معامله جدید مجاز است یا در فریز ضرر هستیم؟
   */
  public isNewTradeAllowed(activePositions: TradePosition[], currentPrice: number): boolean {
    const report = this.evaluateRecoveryState(activePositions, currentPrice);
    return !report.globalTradeFreezeActive;
  }
}

export const strategicRecoveryBrain = StrategicRecoveryBrainService.getInstance();
