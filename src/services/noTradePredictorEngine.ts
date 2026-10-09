/**
 * 🛡️ Independent No-Trade Predictor Engine
 * 
 * ۳۳. ساخت No-Trade Predictor:
 *    - مدل مستقل برای پیش‌بینی احتمال «نامناسب بودن بازار برای معامله» در ۵ حالت بحرانی:
 *      1. Chop (نوسان نامنظم، ساید بدون روند)
 *      2. Whipsaw (شلاق نوسانی سریع و دوطرفه)
 *      3. News Shock (شوک ناگهانی خبری و دستکاری حجم)
 *      4. Low Liquidity (نقدینگی پایین، عمق کم و اسلیپیج بالا)
 *      5. Conflicting Signals (سیگنال‌های متناقض و متعارض بین ابزارها)
 * 
 * ۳۴. امتیاز و احتمال مستقل No-Trade (Statistical Veto):
 *    - No-Trade نتیجه صرفاً پایین بودن Score نیست!
 *    - اگر No-Trade Probability از آستانه آماری (۶۵٪) عبور کند، حتی در صورت بالا بودن Long/Short Score، معامله وتو و ممنوع می‌شود.
 */

import {
  AnalysisResult,
  Candle,
  NoTradeFactorAssessment,
  NoTradePredictionReport,
  NoTradeRiskFactorType,
} from '../types/trading';

export const NO_TRADE_THRESHOLD_PCT = 65;

export function evaluateNoTradeProbability(
  candles: Candle[],
  currentPrice: number,
  analysis?: AnalysisResult | null
): NoTradePredictionReport {
  const safePrice = currentPrice > 0 ? currentPrice : (analysis?.price && analysis.price > 0 ? analysis.price : (candles && candles.length > 0 ? (candles[candles.length - 1][3] ?? 0) : 0));
  const count = candles.length;

  // استخراج متغیرهای بازار
  const adx = analysis?.adx ?? 22;
  const currAtr = analysis?.atr ?? (safePrice * 0.008);
  const bbUp = analysis?.bbUp && analysis.bbUp.length > 0 ? analysis.bbUp[analysis.bbUp.length - 1] : safePrice * 1.015;
  const bbLow = analysis?.bbLow && analysis.bbLow.length > 0 ? analysis.bbLow[analysis.bbLow.length - 1] : safePrice * 0.985;
  const bbMid = analysis?.bbMid && analysis.bbMid.length > 0 ? analysis.bbMid[analysis.bbMid.length - 1] : safePrice;
  const bbWidthPct = Number((((bbUp - bbLow) / bbMid) * 100).toFixed(2));

  const orderFlow = analysis?.orderFlowFeatures;
  const isTrapAlert = Boolean(analysis?.cvdOiMatrix?.institutionalTrapAlert);
  const mtfConflict = Boolean(analysis?.mtfStructuralReport?.isConflictDetected);
  const regime = analysis?.regimeClassification?.activeRegime;

  // محاسبه شادوها و نوسانات ۵ کندل اخیر
  let totalWicks = 0;
  let totalBodies = 0;
  const last5 = candles.slice(-5);
  for (const c of last5) {
    const range = c[1] - c[2];
    const body = Math.abs(c[3] - c[0]);
    totalWicks += (range - body);
    totalBodies += Math.max(1, body);
  }
  const wickRatio = totalBodies > 0 ? totalWicks / totalBodies : 1.0;

  // ۱. ارزیابی فاکتور ۱: CHOP (نوسان نامنظم و فاقد مومنتوم)
  let chopSeverity = 20;
  let chopEvidence = 'بازار دارای جهت‌گیری حرکتی و مومنتوم پایدار است.';
  if (adx < 16) {
    chopSeverity = 88;
    chopEvidence = `شاخص ADX در سطح بسیار ضعیف ${adx} قرار دارد و بازار دچار مرگ حرکتی و فرسایش شدید است.`;
  } else if (adx < 22 && bbWidthPct < 1.4) {
    chopSeverity = 72;
    chopEvidence = `شاخص ADX پایین (${adx}) همزمان با فشردگی باندها (${bbWidthPct}٪) بازار را در وضعیت رکود فرسایشی قرار داده است.`;
  } else if (adx < 25) {
    chopSeverity = 45;
    chopEvidence = `مومنتوم متوسط (${adx}) با احتمال شکل‌گیری فازهای رنج موقت.`;
  }

  // ۲. ارزیابی فاکتور ۲: WHIPSAW (شلاق نوسانی و سایه‌های کشیده دوطرفه)
  let whipsawSeverity = 25;
  let whipsawEvidence = 'طول بدنه کندل‌ها متناسب با دامنه نوسان است.';
  if (wickRatio > 2.5 || regime === 'NEWS_WHIPSAW') {
    whipsawSeverity = 92;
    whipsawEvidence = `نسبت شادوهای بلند به بدنه کندل‌ها (${wickRatio.toFixed(1)}x) نشان‌دهنده نوسانات شلاقی و خطر فعال شدن هر دو استاپ است.`;
  } else if (wickRatio > 1.8) {
    whipsawSeverity = 68;
    whipsawEvidence = `افزایش سایه‌های دوطرفه کندل‌ها (${wickRatio.toFixed(1)}x) هشدار فیک‌اوت‌های درون‌روزی است.`;
  }

  // ۳. ارزیابی فاکتور ۳: NEWS SHOCK (شوک ناگهانی خبری و جهش نوسان نامتعارف)
  let newsSeverity = 15;
  let newsEvidence = 'نوسانات حجم و دامنه قیمت در محدوده نرمال تاریخی است.';
  if (regime === 'PANIC' || ((analysis as any)?.volatilitySpikePrediction?.spikeProbabilityPct ?? 0) > 75) {
    newsSeverity = 85;
    newsEvidence = 'شوک شدید نوسانی یا افت ناگهانی نقدینگی بر بازار حاکم است.';
  } else if (analysis?.volatilityPct && analysis.volatilityPct > 3.2) {
    newsSeverity = 70;
    newsEvidence = `شاخص نوسان جاری (${analysis.volatilityPct}٪) بیش از ۲ برابر میانگین تاریخی است.`;
  }

  // ۴. ارزیابی فاکتور ۴: LOW LIQUIDITY (نقدینگی پایین، عمق کم و اسلیپیج بالا)
  let liquiditySeverity = 20;
  let liquidityEvidence = 'عمق دفتر سفارشات و نقدینگی در سطوح استاندارد است.';
  const slippageBps = (analysis as any)?.slippageModel?.realSlippageBps ?? 4.5;
  if (slippageBps > 14 || (orderFlow && (orderFlow.takerBuyVol + orderFlow.takerSellVol) < 5000000)) {
    liquiditySeverity = 82;
    liquidityEvidence = `اسلیپیج برآوردی بالا (${slippageBps} bps) ناشی از کاهش شدید عمق سفارشات در اردر بوک است.`;
  } else if (slippageBps > 8) {
    liquiditySeverity = 55;
    liquidityEvidence = `اسلیپیج متوسط رو به بالا (${slippageBps} bps) نیازمند کاهش حجم معاملات است.`;
  }

  // ۵. ارزیابی فاکتور ۵: CONFLICTING SIGNALS (تناقض شدید بین اندیکاتورها و تایم‌فریم‌ها)
  let conflictSeverity = 25;
  let conflictEvidence = 'همگرایی منطقی بین ساختار چند تایم‌فریمه و جریان سفارشات وجود دارد.';
  if (mtfConflict && isTrapAlert) {
    conflictSeverity = 90;
    conflictEvidence = 'تناقض همزمان در ساختار تایم‌فریم‌ها و واگرایی مشکوک قیمت با دلتای تجمعی حجم (CVD Trap).';
  } else if (mtfConflict || isTrapAlert) {
    conflictSeverity = 66;
    conflictEvidence = 'عدم هم‌راستایی کامل بین ساختار کلان و تایم‌فریم‌های ورودی مایکرو.';
  }

  // ۶. ارزیابی فاکتور ۶: MISSING CRITICAL DATA (تغذیه ناقص داده‌های بازار - بندهای ۵۰-۵۲)
  let missingDataSeverity = 10;
  let missingDataEvidence = 'تمامی فیدهای داده حیاتی (تیکر، OBI، فاندینگ) در وضعیت VALID هستند.';
  const hasObi = analysis?.obi !== undefined && analysis?.obi !== null && !isNaN(analysis.obi);
  const hasFunding = (analysis?.fundingRate ?? analysis?.funding) !== undefined && (analysis?.fundingRate ?? analysis?.funding) !== null;
  if (!hasObi || !hasFunding) {
    missingDataSeverity = 98;
    missingDataEvidence = `🛑 داده‌های حیاتی بازار مفقود است (OBI: ${hasObi ? 'VALID' : 'UNKNOWN'}, Funding: ${hasFunding ? 'VALID' : 'UNKNOWN'}). جایگزینی با ۰ اکیداً مسدود گردید.`;
  }

  // وزن‌های فاکتورهای ریسک
  const weights: Record<NoTradeRiskFactorType | 'MISSING_DATA', number> = {
    CHOP: 0.20,
    WHIPSAW: 0.20,
    NEWS_SHOCK: 0.15,
    LOW_LIQUIDITY: 0.15,
    CONFLICTING_SIGNALS: 0.15,
    MISSING_DATA: 0.15,
  };

  const riskFactors: NoTradeFactorAssessment[] = [
    {
      factor: 'CHOP',
      factorFa: 'نوسان نامنظم و فاقد روند (Chop)',
      severityScore: chopSeverity,
      weight: weights.CHOP,
      isTriggered: chopSeverity >= 65,
      evidenceFa: chopEvidence,
    },
    {
      factor: 'WHIPSAW',
      factorFa: 'شلاق قیمتی و استاپ‌هانتر (Whipsaw)',
      severityScore: whipsawSeverity,
      weight: weights.WHIPSAW,
      isTriggered: whipsawSeverity >= 65,
      evidenceFa: whipsawEvidence,
    },
    {
      factor: 'NEWS_SHOCK',
      factorFa: 'شوک خبری و نوسان انفجاری (News Shock)',
      severityScore: newsSeverity,
      weight: weights.NEWS_SHOCK,
      isTriggered: newsSeverity >= 65,
      evidenceFa: newsEvidence,
    },
    {
      factor: 'LOW_LIQUIDITY',
      factorFa: 'نقدینگی پایین و اسلیپیج بالا (Low Liquidity)',
      severityScore: liquiditySeverity,
      weight: weights.LOW_LIQUIDITY,
      isTriggered: liquiditySeverity >= 65,
      evidenceFa: liquidityEvidence,
    },
    {
      factor: 'CONFLICTING_SIGNALS',
      factorFa: 'سیگنال‌های متناقض ابزارها (Conflicting Signals)',
      severityScore: conflictSeverity,
      weight: weights.CONFLICTING_SIGNALS,
      isTriggered: conflictSeverity >= 65,
      evidenceFa: conflictEvidence,
    },
    {
      factor: 'MISSING_DATA' as any,
      factorFa: 'نقص فید داده زنده (Missing Data Feed)',
      severityScore: missingDataSeverity,
      weight: weights.MISSING_DATA,
      isTriggered: missingDataSeverity >= 65,
      evidenceFa: missingDataEvidence,
    },
  ];

  // محاسبه احتمال مستقل No-Trade (Statistical Uncertainty Score)
  let rawWeightedScore = riskFactors.reduce((acc, f) => acc + (f.severityScore * f.weight), 0);

  // جریمه تشدید غیرخطی: اگر حتی یک فاکتور بحرانی شدید بالای ۸۵ باشد، احتمال No-Trade پرش می‌کند
  const maxSeverity = Math.max(...riskFactors.map(f => f.severityScore));
  if (maxSeverity >= 85) {
    rawWeightedScore = Math.max(rawWeightedScore, maxSeverity * 0.9);
  }

  const noTradeProbabilityPct = Math.min(99, Math.max(5, Math.round(rawWeightedScore)));

  // ۳۴. اعمال وتوی آماری سخت‌گیرانه (Hard Statistical Circuit Breaker)
  const isNoTradeTriggered = noTradeProbabilityPct >= NO_TRADE_THRESHOLD_PCT;

  // پیدا کردن عامل اصلی ریسک
  const sortedFactors = [...riskFactors].sort((a, b) => b.severityScore - a.severityScore);
  const primaryFactor = sortedFactors[0]?.severityScore >= 60 ? sortedFactors[0].factor : null;

  let vetoAction: NoTradePredictionReport['vetoAction'] = 'SAFE_TO_TRADE';
  let overrideMessageFa = '';
  let verdictFa = '';

  if (isNoTradeTriggered) {
    vetoAction = 'HARD_LOCK_NO_TRADE';
    overrideMessageFa = `🚨 وتوی قطعی معامله (STATISTICAL VETO): احتمال نویز و نامناسب بودن بازار برابر با ${noTradeProbabilityPct}٪ (بالاتر از آستانه ${NO_TRADE_THRESHOLD_PCT}٪) است. حتی با وجود امتیازهای بالای لانگ یا شورت، معامله مسدود شد!`;
    verdictFa = `عامل بحرانی حاکم بر بازار: «${sortedFactors[0]?.factorFa}» با شدت بحرانی ${sortedFactors[0]?.severityScore}٪. ${sortedFactors[0]?.evidenceFa}`;
  } else if (noTradeProbabilityPct >= 50) {
    vetoAction = 'CONDITIONAL_CAUTION';
    overrideMessageFa = `⚠️ احتیاط معاملاتی: احتمال عدم قطعیت بازار ${noTradeProbabilityPct}٪ است. معاملات با حجم ۵۰٪ و فقط در ستاپ‌های گرید عالی مجاز است.`;
    verdictFa = `بازار در وضعیت احتیاطی قرار دارد؛ فاکتور پیشتاز: ${sortedFactors[0]?.factorFa}.`;
  } else {
    vetoAction = 'SAFE_TO_TRADE';
    overrideMessageFa = `✓ بستر پایدار بازار: احتمال نویز و عدم قطعیت در سطح پایین (${noTradeProbabilityPct}٪) قرار دارد. ورود به معاملات بر اساس ستاپ‌های معتبر مجاز است.`;
    verdictFa = 'شرایط نقدینگی، روند و همگرایی اندیکاتورها برای اجرای استراتژی‌های معاملاتی مطلوب است.';
  }

  return {
    noTradeProbabilityPct,
    statisticalThresholdPct: NO_TRADE_THRESHOLD_PCT,
    isNoTradeTriggered,
    primaryRiskFactor: primaryFactor,
    riskFactors,
    vetoAction,
    overrideMessageFa,
    verdictFa,
    calculatedAt: Date.now(),
  };
}
