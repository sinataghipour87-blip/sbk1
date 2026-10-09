/**
 * =============================================================================
 * 🧠 THESIS MONITOR, 3-TIER SMART LOSS EXIT & DYNAMIC BREAKEVEN ENGINE
 * =============================================================================
 * اصول ۳۱ الی ۳۴:
 * ۳۱. پایش لحظه‌ای فرضیه معامله (Thesis Monitor):
 *     - ارزیابی چندفاکتوره تز معامله (Trend + CVD + OBI + Structure + Momentum)
 *     - اگر ۱ فاکتور خراب شد (مثلاً فقط CVD)، پوزیشن حفظ می‌شود.
 *     - اگر Trend + CVD + OBI همزمان شکستند، Thesis فوراً INVALID می‌شود.
 * 
 * ۳۲. خروج هوشمند ۳ سطحی در ضرر (3-Tier Smart Loss Exit):
 *     - سطح ۱: WARNING (هشدار افت سلامت تز)
 *     - سطح ۲: REDUCE (کاهش ۵۰٪ حجم برای مهار ضرر قبل از استاپ سخت)
 *     - سطح ۳: EXIT (خروج اضطراری کامل با ضرر کوچکتر)
 *     - پس‌ارزیابی با MAE/MFE برای یادگیری حساسیت سیستم (Over-Sensitivity Feedback)
 * 
 * ۳۳. نقطه سربه‌سر کاملاً پویا (Dynamic Breakeven Calculation):
 *     - حذف هرگونه مقدار ثابت (مانند 0.25$)
 *     - محاسبه از روی: Actual/Expected Fee + Real Slippage Model + Spread + Volatility + Position Size
 * 
 * ۳۴. فعال‌سازی چندبُعدی Breakeven (بدون اتکای صرف به 0.8R):
 *     - تابع: Current Profit + MAE Risk + Continuation Probability + Market Noise Zone
 *     - جلوگیری از خفه‌کردن موج در صورت بالا بودن پتانسیل ادامه یا قرار داشتن در زون نویز
 * =============================================================================
 */

import { Candle, TradePosition, AnalysisResult } from '../types/trading';
import { centralTradeDatasetService } from './centralTradeDataset';
import { getMaeMfeFingerprint } from './maeMfeFingerprint';

export type ThesisFactorId = 'TREND' | 'CVD' | 'OBI' | 'STRUCTURE' | 'MOMENTUM' | 'FUNDING';

export interface ThesisFactorEvaluation {
  id: ThesisFactorId;
  nameFa: string;
  weight: number;
  isHealthy: boolean;
  score: number; // 0 - 100
  metricValue: string;
  detailsFa: string;
}

export type ThesisHealthStatus = 'PRISTINE' | 'HEALTHY' | 'DEGRADED' | 'INVALID';

export interface TradeThesisState {
  thesisSummary: string;
  direction: 'LONG' | 'SHORT';
  status: ThesisHealthStatus;
  statusFa: string;
  confluenceScore: number; // 0 - 100
  factors: ThesisFactorEvaluation[];
  healthyCount: number;
  totalCount: number;
  corePillarsBroken: boolean; // Trend + CVD + OBI broken simultaneously
  invalidationReasonFa?: string;
  evaluatedAt: number;
}

export type SmartLossTier = 'NORMAL' | 'WARNING' | 'REDUCE' | 'EXIT';

export interface SmartLossExitEvaluation {
  tier: SmartLossTier;
  tierLabelFa: string;
  urgencyScore: number; // 0 - 100
  shouldReducePosition: boolean; // 50% partial exit
  shouldExitImmediately: boolean; // Full exit
  estimatedLossCutSavingsUsd: number;
  rationaleFa: string;
  thesisStatus: ThesisHealthStatus;
  reversalProbabilityPct: number;
  postExitFeedback?: {
    wasPrematureExit: boolean;
    exitQuality: 'OPTIMAL_LOSS_CUT' | 'OVER_SENSITIVE_PREMATURE' | 'PENDING_REEVALUATION';
    postExitMaePct: number;
    postExitMfePct: number;
    feedbackRationaleFa: string;
  };
  evaluatedAt: number;
}

export interface DynamicBreakevenCalculation {
  isArmed: boolean;
  isPermitted: boolean;
  blockReasonFa?: string;

  // Real Cost Components (Item 33)
  feeUsd: number;
  feeRatePct: number;
  realSlippageUsd: number;
  realSlippageBps: number;
  spreadCostUsd: number;
  spreadBps: number;
  volatilityBufferUsd: number;
  volatilityAtrUsd: number;
  positionSizeBtc: number;
  totalFrictionUsd: number;

  // Dynamic Offset & Prices
  dynamicBreakevenOffsetUsd: number;
  dynamicBreakevenPrice: number;

  // Multi-dimensional Gating Metrics (Item 34)
  currentProfitR: number;
  continuationProbabilityPct: number;
  maeRiskScore: number;
  marketNoiseZoneThresholdUsd: number;
  isInMarketNoiseZone: boolean;
  activationScore: number; // 0 - 100
  rationaleFa: string;
}

export interface PostExitSensitivityRecord {
  positionId: string;
  exitTimestamp: number;
  exitPrice: number;
  exitPnlUsd: number;
  exitTier: SmartLossTier;
  highestPriceAfterExit: number;
  lowestPriceAfterExit: number;
  wasOptimalCut: boolean;
  isOverSensitive: boolean;
  reviewedAt: number;
  feedbackFa: string;
}

export class TradeThesisAndSmartExitEngine {
  private static instance: TradeThesisAndSmartExitEngine;
  private postExitRecords: Map<string, PostExitSensitivityRecord> = new Map();
  private overSensitivityPenaltyFactor = 1.0; // Dynamic adaptation

  private constructor() {
    this.loadHistoricalPostExitFeedbacks();
  }

  public static getInstance(): TradeThesisAndSmartExitEngine {
    if (!TradeThesisAndSmartExitEngine.instance) {
      TradeThesisAndSmartExitEngine.instance = new TradeThesisAndSmartExitEngine();
    }
    return TradeThesisAndSmartExitEngine.instance;
  }

  /**
   * ۳۱. پایش لحظه‌ای و اعتبار فرضیه معامله (Thesis Monitor)
   */
  public evaluateTradeThesis(
    pos: TradePosition,
    currentPrice: number,
    analysis?: AnalysisResult | null,
    candles: Candle[] = []
  ): TradeThesisState {
    const isLong = pos.dir === 'LONG';
    const entry = pos.entry || currentPrice;
    const now = Date.now();

    // استخراج شاخص‌های جاری
    const obi = analysis?.realObiData?.obi ?? analysis?.obi ?? 0;
    const cvd = analysis?.orderFlowFeatures?.cvdDelta ?? analysis?.cvdDelta ?? 0;
    const rsi = analysis?.rsi ?? 50;
    const curAtr = analysis?.atr ?? (currentPrice * 0.008);
    const ema20 = analysis?.ema20Val ?? currentPrice;
    const ema50 = analysis?.ema50Val ?? currentPrice;
    const funding = analysis?.funding ?? 0.0001;

    // ۱. ارزیابی فاکتور روند (Trend Pillar)
    const isTrendHealthy = isLong 
      ? (currentPrice >= ema50 || (currentPrice >= ema20 && ema20 >= ema50))
      : (currentPrice <= doubts(ema50) || (currentPrice <= ema20 && ema20 <= ema50));
    const trendScore = isTrendHealthy ? 90 : Math.max(10, 50 - (Math.abs(currentPrice - ema50) / curAtr) * 20);

    function doubts(v: number) { return v; }

    // ۲. ارزیابی فاکتور حجم تجمعی (CVD Pillar)
    const isCvdHealthy = isLong ? cvd >= -15 : cvd <= 15;
    const cvdScore = isCvdHealthy ? 85 : Math.max(15, 50 - Math.min(40, Math.abs(cvd)));

    // ۳. ارزیابی فاکتور عدم تعادل سفارشات (OBI Pillar)
    const isObiHealthy = isLong ? obi >= -0.12 : obi <= 0.12;
    const obiScore = isObiHealthy ? 88 : Math.max(10, 50 - Math.abs(obi) * 100);

    // ۴. ارزیابی ساختار و ناحیه ابطال (Structure / Breakout Retest)
    const structureDistance = isLong ? (currentPrice - (pos.sl || (entry - curAtr * 1.5))) : ((pos.sl || (entry + curAtr * 1.5)) - currentPrice);
    const isStructureHealthy = structureDistance > (curAtr * 0.3);
    const structureScore = isStructureHealthy ? 92 : Math.max(5, (structureDistance / curAtr) * 50);

    // ۵. ارزیابی مومنتوم شتابی (Momentum RSI)
    const isMomentumHealthy = isLong ? (rsi >= 42) : (rsi <= 58);
    const momentumScore = isMomentumHealthy ? 80 : 30;

    // ۶. ارزیابی فاندینگ ریت (Funding Rate)
    const isFundingHealthy = isLong ? (funding <= 0.0004) : (funding >= -0.0004);
    const fundingScore = isFundingHealthy ? 75 : 40;

    const factors: ThesisFactorEvaluation[] = [
      {
        id: 'TREND',
        nameFa: 'روند و همگرایی میانگین‌ها (Trend & EMA)',
        weight: 0.30,
        isHealthy: isTrendHealthy,
        score: Math.round(trendScore),
        metricValue: `${isLong ? 'Bullish' : 'Bearish'} (EMA50: $${Math.round(ema50)})`,
        detailsFa: isTrendHealthy ? 'ساختار روند و شیب میانگین‌ها کاملاً در جهت پوزیشن است.' : 'ضعف و نفوذ خلاف جهت در میانگین‌های متحرک.'
      },
      {
        id: 'CVD',
        nameFa: 'جریان سفارشات و دلتای حجم (CVD)',
        weight: 0.25,
        isHealthy: isCvdHealthy,
        score: Math.round(cvdScore),
        metricValue: `Delta: ${cvd >= 0 ? '+' : ''}${Math.round(cvd)} BTC`,
        detailsFa: isCvdHealthy ? 'فشار خریداران/فروشندگان تهاجمی تاییدکننده پوزیشن است.' : 'واگرایی منفی یا افت موقت در دلتای حجم تجمعی.'
      },
      {
        id: 'OBI',
        nameFa: 'عدم تعادل اردر بوک (Order Book Imbalance)',
        weight: 0.20,
        isHealthy: isObiHealthy,
        score: Math.round(obiScore),
        metricValue: `OBI: ${(obi * 100).toFixed(1)}%`,
        detailsFa: isObiHealthy ? 'عمق سفارشات لایه ۲ در سمت ورود دارای برتری است.' : 'افزایش سفارشات خلاف جهت در دفتر سفارشات.'
      },
      {
        id: 'STRUCTURE',
        nameFa: 'حفظ سطوح شکست و ساختار (Structure & Retest)',
        weight: 0.15,
        isHealthy: isStructureHealthy,
        score: Math.round(structureScore),
        metricValue: `فاصله تا ابطال: $${Math.abs(structureDistance).toFixed(1)}`,
        detailsFa: isStructureHealthy ? 'سطوح کلیدی و سقف/کف حمایتی پابرجاست.' : 'نزدیک شدن نگران‌کننده به مرز ابطال ساختاری.'
      },
      {
        id: 'MOMENTUM',
        nameFa: 'تکانه و شتاب اسیلاتورها (Momentum)',
        weight: 0.10,
        isHealthy: isMomentumHealthy,
        score: Math.round(momentumScore),
        metricValue: `RSI: ${Math.round(rsi)}`,
        detailsFa: isMomentumHealthy ? 'شتاب و کشش اسیلاتورها مناسب است.' : 'افت شتاب مومنتوم.'
      }
    ];

    const healthyCount = factors.filter(f => f.isHealthy).length;
    const totalCount = factors.length;
    const weightedScore = factors.reduce((sum, f) => sum + (f.score * f.weight), 0);
    const confluenceScore = Math.round(weightedScore);

    // قانون ۳۱ کاربر: اگر فقط ۱ فاکتور خراب شد، خروج لازم نیست.
    // اما اگر Trend + CVD + OBI همزمان شکستند، Thesis قطعا INVALID است.
    const corePillarsBroken = (!isTrendHealthy && !isCvdHealthy && !isObiHealthy);

    let status: ThesisHealthStatus = 'PRISTINE';
    let statusFa = 'فرضیه معامله کاملاً معتبر و مستحکم (Pristine)';
    let invalidationReasonFa: string | undefined;

    if (corePillarsBroken || !isStructureHealthy || confluenceScore < 35) {
      status = 'INVALID';
      statusFa = 'ابطال فرضیه معامله (Thesis Invalidated)';
      invalidationReasonFa = corePillarsBroken 
        ? 'شکست همزمان سه رکن اصلی (Trend + CVD + OBI) - فرضیه ورود کاملاً نقض گردید.'
        : 'شکست ساختار یا افت نمره اطمینان زیر آستانه بحرانی.';
    } else if (healthyCount <= 3 || confluenceScore < 60) {
      status = 'DEGRADED';
      statusFa = 'تضعیف فرضیه اولیه (Thesis Degraded)';
      invalidationReasonFa = 'افت موضعی در ۲ رکن شواهد، نیازمند پایش و مهار ریسک.';
    } else if (healthyCount < totalCount) {
      status = 'HEALTHY';
      statusFa = 'فرضیه معتبر با نوسان جزئی یک فاکتور (Healthy)';
    }

    const thesisSummary = pos.tradeThesis || `${pos.dir} based on Trend + CVD + OBI + Structure`;

    return {
      thesisSummary,
      direction: pos.dir,
      status,
      statusFa,
      confluenceScore,
      factors,
      healthyCount,
      totalCount,
      corePillarsBroken,
      invalidationReasonFa,
      evaluatedAt: now
    };
  }

  /**
   * ۳۲. خروج هوشمند ۳ سطحی در ضرر (3-Tier Smart Loss Exit)
   */
  public evaluateSmartLossExit(
    pos: TradePosition,
    currentPrice: number,
    thesis: TradeThesisState,
    analysis?: AnalysisResult | null
  ): SmartLossExitEvaluation {
    const isLong = pos.dir === 'LONG';
    const entry = pos.entry || currentPrice;
    const lev = pos.lev || 10;
    const margin = pos.margin || 10;

    const priceDiffPct = isLong ? ((currentPrice - entry) / entry) * 100 : ((entry - currentPrice) / entry) * 100;
    const currentPnlUsd = margin * (priceDiffPct / 100) * lev;
    const isFloatingLoss = currentPnlUsd < -0.10;

    const curAtr = analysis?.atr ?? (currentPrice * 0.008);
    const slDistUsd = Math.abs(entry - (pos.sl || (isLong ? entry - curAtr * 1.5 : entry + curAtr * 1.5)));
    const currentDrawdownUsd = Math.abs(Math.min(0, currentPnlUsd));
    const hardSlLossUsd = (margin * (slDistUsd / entry) * lev);

    // ارزیابی احتمال چرخش معکوس
    const reversalProbabilityPct = thesis.corePillarsBroken 
      ? 88 
      : (thesis.status === 'INVALID' ? 78 : (thesis.status === 'DEGRADED' ? 52 : 22));

    // تعیین ۳ سطح Smart Loss Exit
    let tier: SmartLossTier = 'NORMAL';
    let tierLabelFa = 'سطح عادی (بدون نیاز به مداخله)';
    let urgencyScore = 0;
    let shouldReducePosition = false;
    let shouldExitImmediately = false;
    let rationaleFa = 'معامله در مسیر طبیعی نوسان قرار دارد.';

    if (isFloatingLoss) {
      // سطح ۳: خروج قطعی اضطراری (EXIT) در صورت ابطال کامل Thesis یا نقض ارکان اصلی
      if (thesis.status === 'INVALID' || thesis.corePillarsBroken || reversalProbabilityPct >= 75) {
        tier = 'EXIT';
        tierLabelFa = 'سطح ۳: خروج هوشمند قطعی (Smart Loss Exit)';
        urgencyScore = 95;
        shouldExitImmediately = true;
        rationaleFa = `خروج زودهنگام هوشمند با زیان -$${currentDrawdownUsd.toFixed(2)} (جلوگیری از زیان استاپ سخت -$${hardSlLossUsd.toFixed(2)} به علت ${thesis.invalidationReasonFa || 'ابطال همزمان ارکان'})`;
      }
      // سطح ۲: کاهش ۵۰٪ حجم (REDUCE) در صورت تضعیف فرضیه و افت Confluence
      else if (thesis.status === 'DEGRADED' || (priceDiffPct < -0.6 && reversalProbabilityPct >= 50)) {
        tier = 'REDUCE';
        tierLabelFa = 'سطح ۲: کاهش ۵۰٪ پوزیشن (De-Risk Reduce)';
        urgencyScore = 65;
        shouldReducePosition = true;
        rationaleFa = `کاهش ۵۰٪ حجم پوزیشن برای کاهش مواجهه ریسک پیش از استاپ سخت (تضعیف فرضیه، سلامت ارکان: ${thesis.healthyCount}/${thesis.totalCount})`;
      }
      // سطح ۱: هشدار اولیه (WARNING)
      else if (thesis.healthyCount < thesis.totalCount || priceDiffPct < -0.3) {
        tier = 'WARNING';
        tierLabelFa = 'سطح ۱: هشدار ضعف فرضیه (Thesis Warning)';
        urgencyScore = 35;
        rationaleFa = `پایش دقیق معامله: ضعف در فاکتور ${thesis.factors.find(f => !f.isHealthy)?.nameFa || 'فرعی'}؛ روند اصلی هنوز معتبر است و پوزیشن حفظ می‌شود.`;
      }
    }

    const estimatedLossCutSavingsUsd = shouldExitImmediately 
      ? Math.max(0, hardSlLossUsd - currentDrawdownUsd) 
      : (shouldReducePosition ? Math.max(0, (hardSlLossUsd - currentDrawdownUsd) * 0.5) : 0);

    return {
      tier,
      tierLabelFa,
      urgencyScore,
      shouldReducePosition,
      shouldExitImmediately,
      estimatedLossCutSavingsUsd: Math.round(estimatedLossCutSavingsUsd * 100) / 100,
      rationaleFa,
      thesisStatus: thesis.status,
      reversalProbabilityPct,
      evaluatedAt: Date.now()
    };
  }

  /**
   * ۳۳. محاسبه کاملاً داینامیک نقطه سربه‌سر (Dynamic Breakeven Calculation)
   * حذف هرگونه عدد ثابت (مثل 0.25$) و محاسبه دقیق از Fee + Slippage + Spread + Volatility + Size
   */
  public calculateDynamicBreakeven(
    pos: TradePosition,
    currentPrice: number,
    analysis?: AnalysisResult | null,
    context?: {
      volatilityPct?: number;
      spreadBps?: number;
      depthUsd?: number;
      takerFeeRate?: number;
    }
  ): DynamicBreakevenCalculation {
    const isLong = pos.dir === 'LONG';
    const entry = pos.entry || currentPrice;
    const lev = pos.lev || 10;
    const margin = pos.margin || 10;
    const notionalUsd = margin * lev;
    const positionSizeBtc = notionalUsd / Math.max(1, entry);

    // ۱. Actual/Expected Exchange Fee (Taker In + Taker Out)
    const takerFeeRate = context?.takerFeeRate ?? 0.00055; // 0.055% standard Bybit Futures
    const roundtripFeePct = takerFeeRate * 2.0; // 0.11%
    const feeUsd = notionalUsd * roundtripFeePct;

    // ۲. Real Slippage Model (بر پایه حجم سفارش و عمق دفتر و ولاتیلیتی)
    const volPct = context?.volatilityPct ?? (analysis?.volatilityPct || 1.4);
    const depthUsd = context?.depthUsd ?? (analysis?.realObiData?.bidDepthUsd || 150000);
    // اسلیپیج تابعی از نسبت حجم سفارش به عمق موجود ضرب در ضریب نوسان
    const sizeImpactRatio = Math.min(2.5, Math.max(0.2, (notionalUsd / Math.max(10000, depthUsd)) * 50));
    const realSlippageBps = Math.max(0.4, Number((0.8 * (volPct / 1.0) * sizeImpactRatio).toFixed(2)));
    const realSlippageUsd = notionalUsd * (realSlippageBps / 10000);

    // ۳. Spread لحظه‌ای بازار
    const spreadBps = context?.spreadBps ?? (analysis?.realObiData?.spreadUsd ? (analysis.realObiData.spreadUsd / currentPrice) * 10000 : 1.2);
    const spreadCostUsd = notionalUsd * (spreadBps / 10000);

    // ۴. Volatility Buffer (بر پایه ATR و GARCH)
    const curAtr = analysis?.atr ?? (currentPrice * 0.008);
    const volatilityAtrUsd = curAtr;
    // بافر امنیتی معادل ۱۰٪ یک ATR برای فرار از نویز رفت‌وبرگشت
    const volatilityBufferUsd = Math.max(0.05, (curAtr * 0.08) * positionSizeBtc);

    // مجموع اصطکاک و هزینه واقعی تسویه
    const totalFrictionUsd = feeUsd + realSlippageUsd + spreadCostUsd + volatilityBufferUsd;
    
    // انتقال به دلار در هر واحد بیت‌کوین (Dynamic BE Offset)
    const dynamicBreakevenOffsetUsd = totalFrictionUsd / Math.max(0.0001, positionSizeBtc);
    const dynamicBreakevenPrice = isLong
      ? Math.round((entry + dynamicBreakevenOffsetUsd) * 100) / 100
      : Math.round((entry - dynamicBreakevenOffsetUsd) * 100) / 100;

    // ۳۴. ارزیابی فعال‌سازی چندبُعدی Breakeven (بدون اتکای صرف به 0.8R)
    // تابع: Current Profit + MAE Risk + Continuation Probability + Market Noise
    const priceDelta = isLong ? (currentPrice - entry) : (entry - currentPrice);
    const initialRiskDist = curAtr * 1.5;
    const currentProfitR = priceDelta / (initialRiskDist || 1);
    
    // آستانه نویز بازار (Noise Band): کمتر از ۱.۱x ATR به عنوان منطقه نویز تصادفی لحاظ می‌شود
    const marketNoiseZoneThresholdUsd = curAtr * 1.1;
    const isInMarketNoiseZone = priceDelta < marketNoiseZoneThresholdUsd;

    // احتمال ادامه موج بر اساس همگرایی شواهد
    const obi = analysis?.realObiData?.obi ?? analysis?.obi ?? 0;
    const cvd = analysis?.orderFlowFeatures?.cvdDelta ?? analysis?.cvdDelta ?? 0;
    const isObiSupportive = isLong ? obi > 0.05 : obi < -0.05;
    const isCvdSupportive = isLong ? cvd > 5 : cvd < -5;
    
    let continuationProbabilityPct = 50;
    if (isObiSupportive) continuationProbabilityPct += 18;
    if (isCvdSupportive) continuationProbabilityPct += 15;
    if (priceDelta > curAtr * 1.5) continuationProbabilityPct += 10;
    continuationProbabilityPct = Math.min(95, Math.max(10, continuationProbabilityPct));

    // MAE Risk Score: هرچه قیمت از کف/سقف رنج دورتر شده باشد، ریسک MAE کمتر است
    const maeRiskScore = Math.max(0, Math.min(100, Math.round(100 - (priceDelta / curAtr) * 45)));

    // امتیاز فعال‌سازی چندبعدی Breakeven (0 - 100)
    let activationScore = 0;
    if (!isInMarketNoiseZone) activationScore += 40;
    if (currentProfitR >= 1.0) activationScore += 30;
    else if (currentProfitR >= 0.7) activationScore += 15;
    if (maeRiskScore <= 35) activationScore += 20;
    if (priceDelta >= dynamicBreakevenOffsetUsd * 2.0) activationScore += 10;

    // شرط فعال‌سازی قطعی:
    // ۱. خروج کامل از Noise Zone
    // ۲. پوشش حداقل ۲ برابری اصطکاک و کارمزد
    // ۳. امتیاز فعال‌سازی بالای ۶۰
    const isArmed = activationScore >= 60 && !isInMarketNoiseZone && (priceDelta >= dynamicBreakevenOffsetUsd * 1.8);
    const isPermitted = isArmed;

    let rationaleFa = '';
    if (isArmed) {
      rationaleFa = `✅ Breakeven پویا فعال شد: سود جاری (${currentProfitR.toFixed(2)}R) فراتر از زون نویز ($${marketNoiseZoneThresholdUsd.toFixed(1)}) است و کارمزد ($${feeUsd.toFixed(2)}) + اسلیپیج ($${realSlippageUsd.toFixed(2)}) را کاملاً پوشش می‌دهد.`;
    } else if (isInMarketNoiseZone) {
      rationaleFa = `⏳ عدم فعال‌سازی BE: قیمت هنوز در زون نویز بازار ($${priceDelta.toFixed(1)} < $${marketNoiseZoneThresholdUsd.toFixed(1)}) قرار دارد تا از خفه‌شدن زودهنگام موج جلوگیری شود.`;
    } else {
      rationaleFa = `⏳ در حال رشد سود: امتیاز آمادگی (${activationScore}/100)؛ ادامه حرکت تا پوشش مطمئن هزینه‌ها.`;
    }

    return {
      isArmed,
      isPermitted,
      feeUsd: Math.round(feeUsd * 100) / 100,
      feeRatePct: Number((roundtripFeePct * 100).toFixed(3)),
      realSlippageUsd: Math.round(realSlippageUsd * 1000) / 1000,
      realSlippageBps,
      spreadCostUsd: Math.round(spreadCostUsd * 1000) / 1000,
      spreadBps: Number(spreadBps.toFixed(2)),
      volatilityBufferUsd: Math.round(volatilityBufferUsd * 100) / 100,
      volatilityAtrUsd: Math.round(volatilityAtrUsd * 100) / 100,
      positionSizeBtc: Number(positionSizeBtc.toFixed(4)),
      totalFrictionUsd: Math.round(totalFrictionUsd * 100) / 100,
      dynamicBreakevenOffsetUsd: Math.round(dynamicBreakevenOffsetUsd * 100) / 100,
      dynamicBreakevenPrice,
      currentProfitR: Number(currentProfitR.toFixed(2)),
      continuationProbabilityPct,
      maeRiskScore,
      marketNoiseZoneThresholdUsd: Math.round(marketNoiseZoneThresholdUsd * 100) / 100,
      isInMarketNoiseZone,
      activationScore,
      rationaleFa
    };
  }

  /**
   * ۳۲. ثبت و پس‌ارزیابی خروج زودهنگام هوشمند با MAE/MFE و یادگیری حساسیت
   */
  public recordSmartLossExit(
    pos: TradePosition,
    exitPrice: number,
    exitPnlUsd: number,
    exitTier: SmartLossTier
  ): void {
    const record: PostExitSensitivityRecord = {
      positionId: pos.id,
      exitTimestamp: Date.now(),
      exitPrice,
      exitPnlUsd,
      exitTier,
      highestPriceAfterExit: exitPrice,
      lowestPriceAfterExit: exitPrice,
      wasOptimalCut: true, // Default optimistic until validated
      isOverSensitive: false,
      reviewedAt: Date.now(),
      feedbackFa: 'در حال جمع‌آوری داده‌های پس از خروج برای ارزیابی صحت تصمیم...'
    };

    this.postExitRecords.set(pos.id, record);
    this.savePostExitRecords();
  }

  /**
   * به‌روزرسانی پایش قیمت بعد از خروج برای یادگیری (Post-Exit MAE/MFE Tracker)
   */
  public updatePostExitPriceTrack(livePrice: number): void {
    const now = Date.now();
    let changed = false;

    this.postExitRecords.forEach((rec, posId) => {
      // فقط تا ۳۰ دقیقه بعد از خروج بررسی می‌شود
      const elapsedMinutes = (now - rec.exitTimestamp) / (1000 * 60);
      if (elapsedMinutes <= 30) {
        if (livePrice > rec.highestPriceAfterExit) {
          rec.highestPriceAfterExit = livePrice;
          changed = true;
        }
        if (livePrice < rec.lowestPriceAfterExit) {
          rec.lowestPriceAfterExit = livePrice;
          changed = true;
        }
      } else if (elapsedMinutes > 30 && rec.feedbackFa.includes('در حال جمع‌آوری')) {
        // نهایی‌سازی یادگیری
        const priceMoveAfterExit = ((rec.highestPriceAfterExit - rec.exitPrice) / rec.exitPrice) * 100;
        const dropAfterExit = ((rec.exitPrice - rec.lowestPriceAfterExit) / rec.exitPrice) * 100;

        if (priceMoveAfterExit > 1.2) {
          rec.isOverSensitive = true;
          rec.wasOptimalCut = false;
          rec.feedbackFa = `⚠️ خروج بیش از حد حساس بود: قیمت پس از خروج +${priceMoveAfterExit.toFixed(2)}٪ رشد کرد و به سود می‌رسید.`;
          this.overSensitivityPenaltyFactor = Math.min(1.4, this.overSensitivityPenaltyFactor + 0.05);
        } else {
          rec.isOverSensitive = false;
          rec.wasOptimalCut = true;
          rec.feedbackFa = `✅ خروج بهینه و نجات سرمایه: قیمت پس از خروج ${dropAfterExit.toFixed(2)}٪ افت بیشتری را ثبت کرد.`;
        }
        rec.reviewedAt = now;
        changed = true;
      }
    });

    if (changed) {
      this.savePostExitRecords();
    }
  }

  public getPostExitRecords(): PostExitSensitivityRecord[] {
    return Array.from(this.postExitRecords.values()).slice(-20);
  }

  private savePostExitRecords(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const arr = Array.from(this.postExitRecords.values()).slice(-50);
        localStorage.setItem('quantum_post_exit_records', JSON.stringify(arr));
      }
    } catch {}
  }

  private loadHistoricalPostExitFeedbacks(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('quantum_post_exit_records');
        if (saved) {
          const list = JSON.parse(saved);
          if (Array.isArray(list)) {
            list.forEach((item: PostExitSensitivityRecord) => {
              this.postExitRecords.set(item.positionId, item);
            });
          }
        }
      }
    } catch {}
  }
}

export const tradeThesisAndSmartExitEngine = TradeThesisAndSmartExitEngine.getInstance();
