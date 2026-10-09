/**
 * =============================================================================
 * ⏳ SIGNAL TTL & 12-FACTOR FINAL PRE-EXECUTION REVALIDATION ENGINE
 * =============================================================================
 * اصول ۳۹ و ۴۰:
 * ۳۹. اتصال حتمی و گیت Signal TTL به لایه اجرای سفارش (Execution):
 *     - هیچ اردری نباید بدون: TTL Check + Fresh Snapshot + Final Revalidation ارسال شود.
 * 
 * ۴۰. اعتبارسنجی مجدد ۱۲ فاکتور حیاتی در میلی‌ثانیه قبل از ارسال نهایی (Final Revalidation):
 *     ۱. Probability (احتمال کالیبره‌شده)
 *     ۲. CI (فاصله اطمینان آماری)
 *     ۳. EV (امید ریاضی مثبت خالص)
 *     ۴. Entry (قرار داشتن درون زون بهینه بدون Chasing)
 *     ۵. Spread (اسپرد کمتر از آستانه مجاز)
 *     ۶. OBI (عدم تعادل اردر بوک همسو)
 *     ۷. CVD (دلتای حجم تجمعی همسو)
 *     ۸. Volatility (کنترل نوسان ATR / عدم وجود شوک مخرب)
 *     ۹. Regime (سازگاری ستاپ با رژیم فعال بازار)
 *     ۱۰. Trigger (تاییدیه ماشه ورود)
 *     ۱۱. Slippage (اسلیپیج مجاز نسبت به فاصله تارگت)
 *     ۱۲. Position Risk (کنترل ریسک و عدم نقض دراداون)
 * 
 * اگر هرکدام نقض شده باشد: بلافاصله وضعیت NO TRADE صادر شده و ارسال اردر لغو می‌شود.
 * =============================================================================
 */

import { AnalysisResult, EntryCandidate } from '../types/trading';
import { validateMarketDataLiveSafety } from './marketData';

export type SignalTtlStatus = 'SIGNAL_CREATED' | 'ACTIVE_VALID' | 'EXPIRED' | 'INVALIDATED_STATE_MUTATION' | 'EXECUTED';

export interface SignalStateSnapshot {
  signalId: string;
  createdAtMs: number;
  ttlMs: number;
  status: SignalTtlStatus;
  initialPrice: number;
  initialObi: number;
  initialCvd?: number | null;
  initialSpreadBps: number;
  initialAtr: number;
  direction: 'LONG' | 'SHORT';
  entryCandidate?: EntryCandidate | null;
  minWinProbability: number;
  expectedValueUsd: number;
  marketRegime?: string;
  maxAllowableSlippageBps?: number;
}

export interface FactorValidationDetail {
  factorName: string;
  factorNameFa: string;
  passed: boolean;
  actualValue: string;
  threshold: string;
  detailsFa: string;
}

export interface FinalPreExecutionRevalidationResult {
  isApprovedForSubmission: boolean;
  decisionStatus: 'APPROVED_FOR_EXECUTION' | 'NO_TRADE_REVALIDATION_FAILED';
  verdictFa: string;
  rejectionReasonsFa: string[];
  rejectionReasonFa?: string;
  passedFactorsCount: number;
  totalFactorsCount: number;
  factorDetails: FactorValidationDetail[];
  snapshotAgeMs: number;
  priceDriftPct: number;
  obiDrift: number;
  currentSpreadBps: number;
  isWithinEntryZone: boolean;
  isEvPositive: boolean;
  evaluatedAtMs: number;
}

export class SignalExpirationEngineService {
  private static instance: SignalExpirationEngineService;

  // Maximum allowed drift thresholds before invalidating signal
  private readonly MAX_PRICE_DRIFT_PCT = 0.20; // 0.20% maximum price movement
  private readonly MAX_SPREAD_WIDENING_BPS = 5.5; // 5.5 bps max allowable spread
  private readonly MAX_OBI_INVERSION_DELTA = 0.35; // OBI flipping against us

  public static getInstance(): SignalExpirationEngineService {
    if (!SignalExpirationEngineService.instance) {
      SignalExpirationEngineService.instance = new SignalExpirationEngineService();
    }
    return SignalExpirationEngineService.instance;
  }

  /**
   * ۳۹. محاسبه دینامیک TTL بر اساس تلاطم بازار (۲.۰ الی ۴.۵ ثانیه)
   */
  public calculateDynamicTtlMs(atrRatio = 1.0, isHighVol = false): number {
    if (isHighVol || atrRatio > 1.4) {
      return 2000; // 2.0 seconds in high volatility / fast market
    }
    return 3500; // 3.5 seconds in standard regime
  }

  /**
   * ۳۹. بررسی اعتبار زمانی و جهش وضعیت اولیه سیگنال (TTL Check)
   */
  public evaluateSignalExpiration(
    signal: SignalStateSnapshot,
    currentMarket: AnalysisResult,
    nowMs: number = Date.now()
  ): { status: SignalTtlStatus; isExpired: boolean; reasonFa: string } {
    const ageMs = nowMs - signal.createdAtMs;

    // ۱. بررسی انقضای زمانی (Time-based TTL)
    if (ageMs > signal.ttlMs) {
      return {
        status: 'EXPIRED',
        isExpired: true,
        reasonFa: `⏳ سیگنال منقضی شد (سن سیگنال: ${ageMs}ms > سقف TTL: ${signal.ttlMs}ms)؛ ارسال اردر لغو و بازار نیازمند محاسبه مجدد است.`,
      };
    }

    // ۲. بررسی تغییر ناگهانی قیمت (Price Mutation)
    const currentPrice = currentMarket.price || signal.initialPrice;
    const priceDriftPct = Math.abs((currentPrice - signal.initialPrice) / signal.initialPrice) * 100;
    if (priceDriftPct > this.MAX_PRICE_DRIFT_PCT) {
      return {
        status: 'INVALIDATED_STATE_MUTATION',
        isExpired: true,
        reasonFa: `⚠️ ابطال سیگنال به دلیل تغییر ناگهانی قیمت (${priceDriftPct.toFixed(2)}% > سقف مجاز ${this.MAX_PRICE_DRIFT_PCT}%).`,
      };
    }

    // ۳. بررسی چرخش عمق سفارشات (OBI Inversion)
    const currentObi = currentMarket.realObiData?.obi ?? currentMarket.obi ?? signal.initialObi;
    const isObiInverted = signal.direction === 'LONG' 
      ? (currentObi < -0.25 && signal.initialObi > 0) 
      : (currentObi > 0.25 && signal.initialObi < 0);
      
    if (isObiInverted) {
      return {
        status: 'INVALIDATED_STATE_MUTATION',
        isExpired: true,
        reasonFa: `⚠️ ابطال سیگنال به دلیل چرخش ناگهانی عمق اردر بوک (OBI: ${currentObi.toFixed(2)}).`,
      };
    }

    return {
      status: 'ACTIVE_VALID',
      isExpired: false,
      reasonFa: `سیگنال معتبر است (سن: ${ageMs}ms / TTL: ${signal.ttlMs}ms).`,
    };
  }

  /**
   * ۴۰. اعتبارسنجی جامع ۱۲ فاکتوره دقیقاً در میلی‌ثانیه قبل از شلیک اردر (Final Revalidation Gate)
   */
  public revalidateEntryBeforeOrderSubmission(
    signal: SignalStateSnapshot,
    freshMarketSnapshot: AnalysisResult,
    nowMs: number = Date.now(),
    accountContext?: {
      availableBalanceUsd?: number;
      dailyDrawdownPct?: number;
    }
  ): FinalPreExecutionRevalidationResult {
    const ageMs = nowMs - signal.createdAtMs;
    const freshPrice = freshMarketSnapshot.price || signal.initialPrice;
    const isLong = signal.direction === 'LONG';

    // ۱. Probability
    const freshWinProb = freshMarketSnapshot.calibratedWinProbability !== null && freshMarketSnapshot.calibratedWinProbability !== undefined
      ? freshMarketSnapshot.calibratedWinProbability * 100
      : (freshMarketSnapshot.confScore || 50);
    const isProbPassed = freshWinProb >= (signal.minWinProbability || 52);

    // ۲. Confidence Interval (CI)
    const ciWidth = (freshMarketSnapshot as any).confidenceIntervalWidth ?? 12;
    const isCiPassed = ciWidth <= 20;

    // ۳. Expected Value (EV)
    const freshEv = freshMarketSnapshot.expectedValue ?? signal.expectedValueUsd ?? 0.5;
    const isEvPassed = freshEv > 0.05;

    // ۴. Entry Zone & Anti-Chasing
    let isWithinEntryZone = true;
    if (signal.entryCandidate?.entryZone) {
      const { min, max } = signal.entryCandidate.entryZone;
      isWithinEntryZone = freshPrice >= min * 0.9985 && freshPrice <= max * 1.0015;
    }
    const priceDriftPct = Number((Math.abs((freshPrice - signal.initialPrice) / signal.initialPrice) * 100).toFixed(3));
    const isEntryPassed = isWithinEntryZone && priceDriftPct <= this.MAX_PRICE_DRIFT_PCT;

    // ۵. Spread
    const freshSpread = freshMarketSnapshot.realObiData?.spreadUsd
      ? (freshMarketSnapshot.realObiData.spreadUsd / freshPrice) * 10000
      : (freshMarketSnapshot.canonicalSnapshot?.basisSpreadBps ?? (freshMarketSnapshot as any).spreadBps ?? 1.4);
    const isSpreadPassed = freshSpread <= this.MAX_SPREAD_WIDENING_BPS;

    // ۶. OBI (Order Book Imbalance)
    const freshObi = freshMarketSnapshot.realObiData?.obi ?? freshMarketSnapshot.obi ?? 0;
    const obiDrift = Number((freshObi - signal.initialObi).toFixed(2));
    const isObiPassed = isLong ? freshObi >= -0.22 : freshObi <= 0.22;

    // ۷. CVD (Cumulative Volume Delta)
    const freshCvd = freshMarketSnapshot.orderFlowFeatures?.cvdDelta ?? freshMarketSnapshot.cvdDelta ?? 0;
    const isCvdPassed = isLong ? freshCvd >= -25 : freshCvd <= 25;

    // ۸. Volatility & ATR Shock
    const freshAtr = freshMarketSnapshot.atr || signal.initialAtr || (freshPrice * 0.008);
    const atrSpikeRatio = freshAtr / Math.max(1, signal.initialAtr || freshAtr);
    const isVolPassed = atrSpikeRatio <= 1.8 && (freshMarketSnapshot.marketRegime !== 'PANIC');

    // ۹. Market Regime
    const activeRegime = freshMarketSnapshot.marketRegime || 'TREND';
    const isRegimePassed = activeRegime !== 'NEWS_WHIPSAW' && activeRegime !== 'PANIC';

    // ۱۰. Trigger Confirmation
    const isTriggerPassed = freshMarketSnapshot.signalOk !== false;

    // ۱۱. Dynamic Slippage Limit
    const estimatedSlippageBps = Number(((freshSpread * 0.5) + (freshAtr / freshPrice) * 100).toFixed(2));
    const maxSlippageBps = signal.maxAllowableSlippageBps || 3.5;
    const isSlippagePassed = estimatedSlippageBps <= maxSlippageBps;

    // ۱۲. Position & Account Risk
    const dailyDd = accountContext?.dailyDrawdownPct ?? 0;
    const availBal = accountContext?.availableBalanceUsd ?? 1000;
    const isRiskPassed = dailyDd < 3.5 && availBal >= 10;

    // ۴۷. حائل ایمنی نفوذ داده‌های مصنوعی: بررسی اصالت کاندل‌ها و فیچرها (Item 47)
    const candlesSafety = validateMarketDataLiveSafety(
      (freshMarketSnapshot as any).candles || (freshMarketSnapshot as any).rawCandles || [],
      (freshMarketSnapshot as any).feedStatus
    );
    const isDataAuthenticPassed = candlesSafety.isLiveSafe;

    // ثبت جزئیات فاکتورهای حیاتی (شامل حائل ایمنی داده لایو)
    const factorDetails: FactorValidationDetail[] = [
      {
        factorName: 'DataAuthenticity',
        factorNameFa: '۰. اصالت داده لایو و عدم نفوذ دیتای رندوم/مصنوعی',
        passed: isDataAuthenticPassed,
        actualValue: candlesSafety.status,
        threshold: 'LIVE_DATA_VALID (بدون داده ساختگی)',
        detailsFa: isDataAuthenticPassed ? 'داده‌ها اصیل و مستقیم از صرافی هستند.' : candlesSafety.reasonFa
      },
      {
        factorName: 'Probability',
        factorNameFa: '۱. احتمال کالیبره‌شده برد',
        passed: isProbPassed,
        actualValue: `${freshWinProb.toFixed(1)}%`,
        threshold: `≥ ${signal.minWinProbability || 52}%`,
        detailsFa: isProbPassed ? 'احتمال کالیبره‌شده در حد مجاز است.' : 'افت احتمال برد زیر کف مجاز.'
      },
      {
        factorName: 'CI',
        factorNameFa: '۲. فاصله اطمینان آماری (CI)',
        passed: isCiPassed,
        actualValue: `عرض ±${ciWidth}%`,
        threshold: 'عرض ≤ ۲۰٪',
        detailsFa: isCiPassed ? 'عدم قطعیت آماری کنترل شده است.' : 'عرض فاصله اطمینان بیش از حد عریض است.'
      },
      {
        factorName: 'EV',
        factorNameFa: '۳. امید ریاضی خالص (EV)',
        passed: isEvPassed,
        actualValue: `+$${freshEv.toFixed(2)}`,
        threshold: '> +$۰.۰۵',
        detailsFa: isEvPassed ? 'امید ریاضی معامله مثبت و سودآور است.' : 'امید ریاضی منفی یا نزدیک به صفر.'
      },
      {
        factorName: 'Entry',
        factorNameFa: '۴. زون ورود و عدم تعقیب قیمت',
        passed: isEntryPassed,
        actualValue: `$${freshPrice.toFixed(1)} (انحراف: ${priceDriftPct}%)`,
        threshold: `انحراف ≤ ${this.MAX_PRICE_DRIFT_PCT}%`,
        detailsFa: isEntryPassed ? 'قیمت در محدوده ورود ایده‌آل است.' : 'قیمت از زون ورود فرار کرده است.'
      },
      {
        factorName: 'Spread',
        factorNameFa: '۵. اسپرد لحظه‌ای بازار',
        passed: isSpreadPassed,
        actualValue: `${freshSpread.toFixed(1)} Bps`,
        threshold: `≤ ${this.MAX_SPREAD_WIDENING_BPS} Bps`,
        detailsFa: isSpreadPassed ? 'اسپرد فشرده و مناسب اجرای سفارش است.' : 'اسپرد باز غیرمجاز.'
      },
      {
        factorName: 'OBI',
        factorNameFa: '۶. تعادل اردر بوک (OBI)',
        passed: isObiPassed,
        actualValue: `OBI: ${(freshObi * 100).toFixed(1)}%`,
        threshold: isLong ? 'OBI ≥ -۲۲٪' : 'OBI ≤ +۲۲٪',
        detailsFa: isObiPassed ? 'عمق دفتر سفارشات همسو است.' : 'فشار مخالف در دفتر سفارشات.'
      },
      {
        factorName: 'CVD',
        factorNameFa: '۷. جریان تجمعی حجم (CVD)',
        passed: isCvdPassed,
        actualValue: `Delta: ${freshCvd >= 0 ? '+' : ''}${Math.round(freshCvd)} BTC`,
        threshold: isLong ? 'Delta ≥ -۲۵' : 'Delta ≤ +۲۵',
        detailsFa: isCvdPassed ? 'جریان سفارشات تهاجمی تاییدکننده است.' : 'واگرایی منفی در دلتای حجم.'
      },
      {
        factorName: 'Volatility',
        factorNameFa: '۸. نوسان و عدم شوک ATR',
        passed: isVolPassed,
        actualValue: `ATR: $${freshAtr.toFixed(1)} (نسبت: ${atrSpikeRatio.toFixed(2)})`,
        threshold: 'نسبت جهش ≤ ۱.۸x',
        detailsFa: isVolPassed ? 'تلاطم بازار در بازه نرمال است.' : 'شوک نوسانی ناگهانی در بازار.'
      },
      {
        factorName: 'Regime',
        factorNameFa: '۹. سازگاری با رژیم بازار',
        passed: isRegimePassed,
        actualValue: activeRegime,
        threshold: 'به جز شلاق خبری/پنیک',
        detailsFa: isRegimePassed ? 'رژیم بازار برای اجرای ستاپ معتبر است.' : 'بازار در رژیم پرریسک شلاق خبری است.'
      },
      {
        factorName: 'Trigger',
        factorNameFa: '۱۰. تایید ماشه ورود',
        passed: isTriggerPassed,
        actualValue: isTriggerPassed ? 'تایید شده' : 'رد شده',
        threshold: 'تایید قطعی',
        detailsFa: isTriggerPassed ? 'ماشه ورود فعال است.' : 'ماشه ورود منقضی یا باطل شده است.'
      },
      {
        factorName: 'Slippage',
        factorNameFa: '۱۱. اسلیپیج تخمینی',
        passed: isSlippagePassed,
        actualValue: `${estimatedSlippageBps} Bps`,
        threshold: `≤ ${maxSlippageBps} Bps`,
        detailsFa: isSlippagePassed ? 'اسلیپیج در محدوده اقتصادی است.' : 'اسلیپیج فراتر از حد مجاز است.'
      },
      {
        factorName: 'PositionRisk',
        factorNameFa: '۱۲. کنترل ریسک حساب و دراداون',
        passed: isRiskPassed,
        actualValue: `دراداون: ${dailyDd}% | موجودی: $${availBal.toFixed(1)}`,
        threshold: 'دراداون < ۳.۵٪',
        detailsFa: isRiskPassed ? 'سقف ریسک و دراداون رعایت شده است.' : 'سقف ریسک روزانه نقض گردیده است.'
      }
    ];

    const passedFactorsCount = factorDetails.filter(f => f.passed).length;
    const totalFactorsCount = factorDetails.length;
    const rejectionReasonsFa = factorDetails.filter(f => !f.passed).map(f => `${f.factorNameFa}: ${f.detailsFa}`);

    // شرط تایید: گذراندن موفق تمام ۱۲ فاکتور و عدم انقضای TTL
    const isApprovedForSubmission = (passedFactorsCount === totalFactorsCount) && (ageMs <= signal.ttlMs);

    return {
      isApprovedForSubmission,
      decisionStatus: isApprovedForSubmission ? 'APPROVED_FOR_EXECUTION' : 'NO_TRADE_REVALIDATION_FAILED',
      verdictFa: isApprovedForSubmission
        ? `✅ اعتبارسنجی ۱۲ فاکتوره در میلی‌ثانیه قبل از سفارش با موفقیت کامل پاس شد (${passedFactorsCount}/${totalFactorsCount}).`
        : `🛑 ارسال اردر لغو شد (NO TRADE): نقض ${totalFactorsCount - passedFactorsCount} فاکتور از ۱۲ فاکتور حیاتی پیش از ورود.`,
      rejectionReasonsFa,
      rejectionReasonFa: isApprovedForSubmission ? undefined : rejectionReasonsFa.join(' | '),
      passedFactorsCount,
      totalFactorsCount,
      factorDetails,
      snapshotAgeMs: ageMs,
      priceDriftPct,
      obiDrift,
      currentSpreadBps: freshSpread,
      isWithinEntryZone,
      isEvPositive: freshEv > 0,
      evaluatedAtMs: nowMs,
    };
  }
}

export const signalExpirationEngine = SignalExpirationEngineService.getInstance();
