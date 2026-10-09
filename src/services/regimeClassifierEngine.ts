/**
 * 🏛️ Comprehensive Market Regime Classifier & Regime-Specific Setup Edge Matrix
 * 
 * ۲۷. ساخت Regime Classifier واقعی (تفکیک ۹ رژیم بازار):
 *    - TREND, RANGE, BREAKOUT, COMPRESSION, EXPANSION, HIGH_VOLATILITY, PANIC, MEAN_REVERSION, NEWS_WHIPSAW
 *    - استراتژی اختصاصی برای هر رژیم بازار
 * 
 * ۲۸. ساخت Regime-Specific Setup Edge Matrix:
 *    - ارزیابی سه‌بعدی Setup × Regime × Timeframe
 *    - محاسبه امید ریاضی مستقل (Expectancy R) و فعال‌سازی منحصراً در صورت تایید Edge مثبت
 */

import {
  AdvancedRegimeType,
  Candle,
  EntryCandidateType,
  MarketRegimeClassification,
  OrderFlowFeatures,
  RegimeSetupMatrixReport,
  RegimeStrategyType,
  SetupRegimeEdgeRecord,
  TradingTimeframe,
} from '../types/trading';
import { centralTradeDatasetService } from './centralTradeDataset';
import { classifyFutureRegime, deriveRegimeFeatures } from './regimeProbabilityModel';

/**
 * ۲۷. طبقه‌بندی هوشمند و چندبعدی رژیم بازار (Regime Classifier)
 */
export function classifyMarketRegime(
  candles: Candle[],
  currentPrice: number,
  adxVal?: number,
  atrVal?: number,
  bbUp?: number[],
  bbLow?: number[],
  bbMid?: number[],
  vwapVal?: number,
  orderFlow?: OrderFlowFeatures
): MarketRegimeClassification {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error('Regime classifier requires a valid live market price.');
  }
  const safePrice = currentPrice;
  const count = candles.length;

  if (count < 300) {
    throw new Error('Regime classifier requires at least 300 real candles for OOS model validation.');
  }

  const closes = candles.map(c => c[3]);
  const highs = candles.map(c => c[1]);
  const lows = candles.map(c => c[2]);
  const volumes = candles.map(c => c[4]);
  const derivedFeatures = deriveRegimeFeatures(candles);
  if (!derivedFeatures) {
    throw new Error('Regime classifier cannot derive model features from invalid candle data.');
  }
  const effectiveAdx = adxVal !== undefined && Number.isFinite(adxVal) ? adxVal : derivedFeatures.adx;

  // ۱. محاسبه ATR و نسبت آن با میانگین تاریخی ۳۰ دوره
  const currentAtr = atrVal && atrVal > 0
    ? atrVal
    : candles.slice(-14).reduce((sum, candle) => sum + candle[1] - candle[2], 0) / Math.min(14, count);
  if (!Number.isFinite(currentAtr) || currentAtr <= 0) {
    throw new Error('Regime classifier cannot derive ATR from the provided candles.');
  }
  const recentRanges = candles.slice(-30).map(c => c[1] - c[2]);
  const avgHistoricalRange = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
  if (!Number.isFinite(avgHistoricalRange) || avgHistoricalRange <= 0) {
    throw new Error('Regime classifier cannot derive a historical volatility baseline.');
  }
  const atrRatio = Number((currentAtr / avgHistoricalRange).toFixed(2));

  // ۲. عرض باندهای بولینگر (Bollinger Bandwidth)
  const fallbackBbMid = closes.slice(-20).reduce((sum, value) => sum + value, 0) / Math.min(20, closes.length);
  const fallbackBbVariance = closes.slice(-20).reduce((sum, value) => sum + (value - fallbackBbMid) ** 2, 0) / Math.min(20, closes.length);
  const fallbackBbStdDev = Math.sqrt(fallbackBbVariance);
  const lastBbMid = bbMid?.at(-1) ?? fallbackBbMid;
  const lastBbUp = bbUp?.at(-1) ?? lastBbMid + 2 * fallbackBbStdDev;
  const lastBbLow = bbLow?.at(-1) ?? lastBbMid - 2 * fallbackBbStdDev;
  if (lastBbMid <= 0 || !Number.isFinite(lastBbUp) || !Number.isFinite(lastBbLow)) {
    throw new Error('Regime classifier cannot derive valid Bollinger metrics from the provided candles.');
  }
  const bollingerBandWidthPct = Number((((lastBbUp - lastBbLow) / lastBbMid) * 100).toFixed(2));

  // ۳. انحراف از VWAP به صورت انحراف معیار
  const recentVwapCandles = candles.slice(-20);
  const recentVolume = recentVwapCandles.reduce((sum, candle) => sum + candle[4], 0);
  const derivedVwap = recentVolume > 0
    ? recentVwapCandles.reduce((sum, candle) => sum + ((candle[1] + candle[2] + candle[3]) / 3) * candle[4], 0) / recentVolume
    : null;
  const currentVwap = vwapVal && vwapVal > 0 ? vwapVal : derivedVwap;
  if (currentVwap === null || !Number.isFinite(currentVwap) || currentVwap <= 0) {
    throw new Error('Regime classifier requires valid volume data to derive VWAP.');
  }
  const vwapDeviationStd = Number((Math.abs(safePrice - currentVwap) / (currentAtr || 1)).toFixed(2));

  // ۴. جهش غیرعادی حجم (Volume Surge Ratio)
  const lastVol = volumes[count - 1];
  const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  if (avgVol20 <= 0) throw new Error('Regime classifier requires non-zero real volume observations.');
  const volumeSurgeRatio = Number((lastVol / avgVol20).toFixed(2));

  // ۵. نسبت شادو به بدنه شمع‌ها جهت کشف شلاق قیمتی (Whipsaw Wick Ratio)
  const last5Candles = candles.slice(-5);
  let totalWicks = 0;
  let totalBodies = 0;
  for (const c of last5Candles) {
    const range = c[1] - c[2];
    const body = Math.abs(c[3] - c[0]);
    const wicks = range - body;
    totalWicks += wicks;
    totalBodies += Math.max(1, body);
  }
  const whipsawWickRatio = Number((totalWicks / totalBodies).toFixed(2));

  // ۶. افت قیمت اخیر برای تشخیص پنیک
  const priceChangeLast5 = ((closes[count - 1] - closes[Math.max(0, count - 6)]) / closes[Math.max(0, count - 6)]) * 100;

  // ۷. امتیاز هم‌راستایی روند (Trend Alignment Score)
  const ema20Approx = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const ema50Approx = closes.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, closes.length);
  let trendAlignmentScore = 0;
  if (safePrice > ema20Approx && ema20Approx > ema50Approx) {
    trendAlignmentScore = Math.min(100, Math.round(effectiveAdx * 2.5));
  } else if (safePrice < ema20Approx && ema20Approx < ema50Approx) {
    trendAlignmentScore = -Math.min(100, Math.round(effectiveAdx * 2.5));
  }

  const model = classifyFutureRegime(candles, derivedFeatures);
  const { activeRegime, probabilities: regimeProbabilities, validation: probabilityModelValidation } = model;
  const confidencePct = Math.round(regimeProbabilities[activeRegime]);

  // Strategy mapping based on the calibrated active regime
  let regimeFa = 'رنج و خنثی (Range)';
  let suitableStrategy: RegimeStrategyType = 'RANGE_BOUND_SUPPORT_RESISTANCE';
  let strategyDescriptionFa = 'نوسان‌گیری محدود بین حمایت و مقاومت رنج و خروج سریع در لول‌های میانی.';
  let rationaleFa = `مدل رژیم با خروجی ${confidencePct}٪ تعیین شد.`;

  switch (activeRegime) {
    case 'PANIC':
      regimeFa = 'وحشت و تسلیم بازار (Panic / Capitulation)';
      suitableStrategy = 'CAPITULATION_ABSORPTION_HARVEST';
      strategyDescriptionFa = 'توقف معاملات خرید استاندارد، پرهیز از گرفتن چاقوی در حال سقوط، و شکار انحصاری جذب نقدینگی نهایی نهنگ‌ها در کف.';
      rationaleFa = `ریزش شدید ${priceChangeLast5.toFixed(2)}٪ با دلتای فروش تهاجمی نشان‌دهنده پنیک تسلیم با احتمال ${confidencePct}٪ است.`;
      break;
    case 'NEWS_WHIPSAW':
      regimeFa = 'شلاق نوسانی خبری (News / Whipsaw)';
      suitableStrategy = 'DEFENSIVE_PRESERVATION_STANDBY';
      strategyDescriptionFa = 'حالت تدافعی فعال: پرهیز اکید از اردرهای مارکت و بریک‌اوت به دلیل اسلیپیج بالا و سایه‌های قیمتی کشیده دوطرفه.';
      rationaleFa = `نسبت شادوهای نوسانی (${whipsawWickRatio}) به همراه نوسان حجم نشان‌دهنده شوک خبری با احتمال ${confidencePct}٪ است.`;
      break;
    case 'MEAN_REVERSION':
      regimeFa = 'بازگشت آماری به میانگین (Mean Reversion)';
      suitableStrategy = 'STATISTICAL_MEAN_REVERSION';
      strategyDescriptionFa = 'ستاپ معکوس جهت شکار اصلاح قیمت به سمت لنگر تعادل ارزش منصفانه (VWAP و EMA50).';
      rationaleFa = `انحراف ${vwapDeviationStd} برابری از VWAP نشانگر تمایل قوی به بازگشت با احتمال ${confidencePct}٪ است.`;
      break;
    case 'COMPRESSION':
      regimeFa = 'فشردگی شدید نوسان (Compression / Squeeze)';
      suitableStrategy = 'SQUEEZE_BREAKOUT_PREPARATION';
      strategyDescriptionFa = 'آمادگی برای انفجار نوسان: قرار دادن سفارشات استاپ در دو سمت کانال باریک فشرده‌شده و انتظار برای شکست پرحجم.';
      rationaleFa = `فشردگی بولینگر به ${bollingerBandWidthPct}٪ با احتمال ${confidencePct}٪ نشانگر آمادگی خروج انفجاری از رنج است.`;
      break;
    case 'EXPANSION':
      regimeFa = 'انبساط تکانه و شتاب قیمت (Expansion)';
      suitableStrategy = 'IMPULSE_EXPANSION_RIDE';
      strategyDescriptionFa = 'سواری بر موج پرشتاب تکانه با تریلینگ استاپ سریع و همگامی با جریان پول ورودی.';
      rationaleFa = `انبساط دامنه نوسان با رشد حجم تایید شد (احتمال کالیبره‌شده: ${confidencePct}٪).`;
      break;
    case 'HIGH_VOLATILITY':
      regimeFa = 'نوسان‌پذیری بسیار بالا (High Volatility)';
      suitableStrategy = 'VOLATILITY_ADAPTIVE_WIDE_BRACKET';
      strategyDescriptionFa = 'کاهش ۵۰٪ حجم پوزیشن، استفاده از لوریج پایین و تنظیم حد ضررهای عریض متناسب با ATR بزرگ.';
      rationaleFa = `نوسان‌پذیری غیرعادی با ضریب ATR معادل ${atrRatio} (احتمال: ${confidencePct}٪).`;
      break;
    case 'BREAKOUT':
      regimeFa = 'شکست ساختار پرحجم (Breakout)';
      suitableStrategy = 'VOLATILITY_BREAKOUT_EXPANSION';
      strategyDescriptionFa = 'ورود تاییدشده در شکست معتبر سطوح با تثبیت کندل و ورود مجدد در ریتست ساختار.';
      rationaleFa = `شکست سطوح با حجم ${volumeSurgeRatio}x و مومنتوم (احتمال: ${confidencePct}٪).`;
      break;
    case 'TREND':
      regimeFa = trendAlignmentScore > 0 ? 'روند صعودی پرقدرت (Strong Bullish Trend)' : 'روند نزولی پرقدرت (Strong Bearish Trend)';
      suitableStrategy = 'MOMENTUM_TREND_FOLLOWING';
      strategyDescriptionFa = 'تعقیب روند ماژور: ورود انحصاری در پولبک به میانگین متحرک ۲۰ و ۵۰ و پرهیز از معاملات خلاف روند.';
      rationaleFa = `همگرایی مومنتوم و شاخص ADX (${effectiveAdx}) حاکمیت روند را با احتمال ${confidencePct}٪ نشان می‌دهد.`;
      break;
    case 'RANGE':
    default:
      regimeFa = 'رنج و خنثی (Range-bound)';
      suitableStrategy = 'RANGE_BOUND_SUPPORT_RESISTANCE';
      strategyDescriptionFa = 'خرید در کف‌های برابر (EQL) و فروش در سقف‌های برابر (EQH) با تارگت‌های محافظه‌کارانه.';
      rationaleFa = `فقدان تکانه جهتی و ADX ضعیف (${effectiveAdx}) وضعیت رنج را با احتمال ${confidencePct}٪ نشان می‌دهد.`;
      break;
  }
  if (probabilityModelValidation.status === 'UNCALIBRATED') {
    rationaleFa = `احتمال مدل رژیم هنوز کالیبراسیون OOS را نگذرانده است (نمونهٔ OOS: ${probabilityModelValidation.oosSampleSize}). خروجی فعلی صرفاً پیش‌بینی خام مدل است؛ ${rationaleFa}`;
  }

  return {
    activeRegime,
    regimeFa,
    confidencePct,
    suitableStrategy,
    strategyDescriptionFa,
    regimeProbabilities,
    probabilityModelValidation,
    metrics: {
      adx: effectiveAdx,
      atrRatio,
      bollingerBandWidthPct,
      vwapDeviationStd,
      orderBookImbalance: orderFlow?.takerRatio ? (orderFlow.takerRatio - 0.5) * 2 : 0,
      volumeSurgeRatio,
      whipsawWickRatio,
      trendAlignmentScore,
    },
    rationaleFa,
    classifiedAt: Date.now(),
  };
}

/**
 * ۳۸. تحلیل رژیم چند تایم‌فریمه (Multi-Timeframe Regime Matrix)
 * تفکیک رژیم‌های ۵m، ۱۵m، ۱H و ۴H و حل‌وفصل تداخل ساختاری میان آن‌ها
 */
export interface MultiTimeframeRegimeReport {
  timeframes: {
    '5m': { regime: AdvancedRegimeType; regimeFa: string; confidencePct: number; probabilityModelValidation: MarketRegimeClassification['probabilityModelValidation']; roleFa: string };
    '15m': { regime: AdvancedRegimeType; regimeFa: string; confidencePct: number; probabilityModelValidation: MarketRegimeClassification['probabilityModelValidation']; roleFa: string };
    '1h': { regime: AdvancedRegimeType; regimeFa: string; confidencePct: number; probabilityModelValidation: MarketRegimeClassification['probabilityModelValidation']; roleFa: string };
    '4h': { regime: AdvancedRegimeType; regimeFa: string; confidencePct: number; probabilityModelValidation: MarketRegimeClassification['probabilityModelValidation']; roleFa: string };
  };
  conflictDetected: boolean;
  conflictType: 'NONE' | 'LTF_BREAKOUT_IN_HTF_RANGE' | 'PULLBACK_IN_HTF_TREND' | 'REGIME_DIVERGENCE_CAUTION' | 'CONGRUENT_EXPANSION';
  conflictResolutionFa: string;
  actionGuidanceFa: string;
  calculatedAt: number;
}

export function classifyMultiTimeframeRegimes(
  candlesByTimeframe: Record<'5m' | '15m' | '1h' | '4h', Candle[]>,
  currentPrice: number
): MultiTimeframeRegimeReport {
  const reports = {
    '5m': classifyMarketRegime(candlesByTimeframe['5m'], currentPrice),
    '15m': classifyMarketRegime(candlesByTimeframe['15m'], currentPrice),
    '1h': classifyMarketRegime(candlesByTimeframe['1h'], currentPrice),
    '4h': classifyMarketRegime(candlesByTimeframe['4h'], currentPrice),
  };
  const regime5m = reports['5m'].activeRegime;
  const regime15m = reports['15m'].activeRegime;
  const regime1h = reports['1h'].activeRegime;
  const regime4h = reports['4h'].activeRegime;

  // 5. Detect Structural Conflicts
  let conflictDetected = false;
  let conflictType: MultiTimeframeRegimeReport['conflictType'] = 'NONE';
  let conflictResolutionFa = 'تایم‌فریم‌ها در رژیم معاملاتی همگرا هستند.';
  let actionGuidanceFa = 'اجرای سفارش بر اساس ستاپ اصلی مجاز است.';

  if (regime5m === 'BREAKOUT' && regime1h === 'RANGE') {
    conflictDetected = true;
    conflictType = 'LTF_BREAKOUT_IN_HTF_RANGE';
    conflictResolutionFa = 'تضاد ساختاری: شکست ۵ دقیقه درون رنج ۱ ساعته قرار دارد. احتمال فیک‌بریک‌اوت در سقف/کف رنج بالاست!';
    actionGuidanceFa = 'ورود فوری در بریک‌اوت مسدود شد. فقط در ریتست تاییدشده یا نزدیک مرزهای معتبر رنج معامله شود.';
  } else if ((regime5m === 'MEAN_REVERSION' || regime5m === 'RANGE') && regime4h === 'TREND') {
    conflictDetected = true;
    conflictType = 'PULLBACK_IN_HTF_TREND';
    conflictResolutionFa = 'تضاد مثبت اصلاح: نوسان خنثی یا برگشتی ۵ و ۱۵ دقیقه در بستر روند قدرتمند ۴ ساعته اصلاح درون‌روندی است.';
    actionGuidanceFa = 'خلاف روند کلان وارد نشوید؛ از پولبک مایکرو برای سوار شدن به روند ۴ ساعته استفاده کنید.';
  } else if (regime5m !== regime1h && regime1h !== regime4h) {
    conflictDetected = true;
    conflictType = 'REGIME_DIVERGENCE_CAUTION';
    conflictResolutionFa = 'واگرایی چندگانه رژیم‌ها: تایم‌فریم‌های مختلف فازهای ناسازگار دارند (عدم قطعیت ماژور).';
    actionGuidanceFa = 'حجم معامله ۵۰٪ کاهش یابد و استاپ‌ها به نقاط غیرقابل نقض ساختاری منتقل شوند.';
  } else if (regime5m === 'BREAKOUT' && regime15m === 'TREND' && regime1h === 'TREND' && regime4h === 'TREND') {
    conflictType = 'CONGRUENT_EXPANSION';
    conflictResolutionFa = 'همگرایی مطلق: شکست مایکرو هم‌جهت با روند میان‌مدت و کلان ۱ ساعته است (بالاترین لبه آماری).';
    actionGuidanceFa = 'مجوز حداکثری ورود صادر شد؛ استفاده از تریلینگ استاپ پویا توصیه می‌شود.';
  }

  if (Object.values(reports).some(report => report.probabilityModelValidation.status !== 'CALIBRATED')) {
    conflictDetected = true;
    conflictType = 'REGIME_DIVERGENCE_CAUTION';
    conflictResolutionFa = 'حداقل یکی از مدل‌های رژیم فاقد اعتبارسنجی کالیبراسیون OOS است.';
    actionGuidanceFa = 'WAIT / NO TRADE تا زمانی که هر چهار مدل با دادهٔ مستقل OOS اعتبارسنجی شوند.';
  }

  return {
    timeframes: {
      '5m': { regime: regime5m, regimeFa: reports['5m'].regimeFa, confidencePct: reports['5m'].confidencePct, probabilityModelValidation: reports['5m'].probabilityModelValidation, roleFa: 'محدوده بهینه و ماشه ورود (Entry/Trigger)' },
      '15m': { regime: regime15m, regimeFa: reports['15m'].regimeFa, confidencePct: reports['15m'].confidencePct, probabilityModelValidation: reports['15m'].probabilityModelValidation, roleFa: 'ستاپ و چرخه موج (Setup Lifecycle)' },
      '1h': { regime: regime1h, regimeFa: reports['1h'].regimeFa, confidencePct: reports['1h'].confidencePct, probabilityModelValidation: reports['1h'].probabilityModelValidation, roleFa: 'رژیم و ساختار میانی (Regime Structure)' },
      '4h': { regime: regime4h, regimeFa: reports['4h'].regimeFa, confidencePct: reports['4h'].confidencePct, probabilityModelValidation: reports['4h'].probabilityModelValidation, roleFa: 'ساختار کلان نهادی (Macro Structure)' },
    },
    conflictDetected,
    conflictType,
    conflictResolutionFa,
    actionGuidanceFa,
    calculatedAt: Date.now(),
  };
}

// ============================================================================
// ۲۸. ماتریس عملکرد تخصصی Setup × Regime × Timeframe
// "یک Setup که در Trend سودده است لزوماً در Range سودده نیست"
// فقط ترکیب‌هایی که Edge مثبت دارند فعال شوند.
// ============================================================================

const SETUP_NAMES_FA: Record<EntryCandidateType, string> = {
  PULLBACK_ENTRY: 'ورود در پولبک (Pullback Entry)',
  BREAKOUT_RETEST: 'بریک‌اوت و ریتست (Breakout & Retest)',
  LIQUIDITY_SWEEP_RECLAIM: 'هانت نقدینگی و بازپس‌گیری (Liquidity Sweep & Reclaim)',
  FVG_RETRACEMENT: 'اصلاح به گپ ارزش منصفانه (FVG Retracement)',
  ORDER_BLOCK_RETEST: 'ریتست اوردر بلاک نهادی (Order Block Retest)',
  VWAP_RECLAIM_REJECTION: 'ریجکشن/بازپس‌گیری خط VWAP',
  MOMENTUM_CONTINUATION: 'همراهی با تکانه و مومنتوم (Momentum Continuation)',
};

const REGIME_NAMES_FA: Record<AdvancedRegimeType, string> = {
  TREND: 'رونددار (Trend)',
  RANGE: 'رنج و خنثی (Range)',
  BREAKOUT: 'شکست ساختار (Breakout)',
  COMPRESSION: 'فشردگی نوسان (Compression)',
  EXPANSION: 'انبساط شتاب (Expansion)',
  HIGH_VOLATILITY: 'نوسان بالا (High Volatility)',
  PANIC: 'وحشت و تسلیم (Panic)',
  MEAN_REVERSION: 'بازگشت به میانگین (Mean Reversion)',
  NEWS_WHIPSAW: 'شلاق خبری (News Whipsaw)',
};

/**
 * ۲۸. ارزیابی اج آماری ستاپ در رژیم و تایم‌فریم مشخص (Setup × Regime × Timeframe)
 */
export function evaluateRegimeSetupEdge(
  setupCandidate: EntryCandidateType = 'PULLBACK_ENTRY',
  regime: AdvancedRegimeType = 'TREND',
  timeframe: TradingTimeframe = '15m',
  direction: 'LONG' | 'SHORT' = 'LONG'
): RegimeSetupMatrixReport {
  const minimumResolvedSamples = 100;
  const allSetupTypes: EntryCandidateType[] = [
    'PULLBACK_ENTRY',
    'BREAKOUT_RETEST',
    'LIQUIDITY_SWEEP_RECLAIM',
    'FVG_RETRACEMENT',
    'ORDER_BLOCK_RETEST',
    'VWAP_RECLAIM_REJECTION',
    'MOMENTUM_CONTINUATION',
  ];

  const matrixRecords: SetupRegimeEdgeRecord[] = [];
  const allPredictions = centralTradeDatasetService.getAllPredictions();

  for (const sType of allSetupTypes) {
    const resolved = allPredictions.filter(record =>
      record.setupType.toUpperCase() === sType &&
      record.marketRegime.toUpperCase() === regime &&
      record.timeframe.toUpperCase() === timeframe.toUpperCase() &&
      record.direction === direction &&
      (record.outcome === 'WIN' || record.outcome === 'LOSS') &&
      (record.executionStatus === 'EXECUTED_FILLED' || record.executionStatus === 'CLOSED_COMPLETED')
    );
    const wins = resolved.filter(record => record.outcome === 'WIN').length;
    const recordsWithR = resolved.filter(record => typeof record.R === 'number' && Number.isFinite(record.R));
    const averageR = recordsWithR.length > 0
      ? recordsWithR.reduce((sum, record) => sum + (record.R ?? 0), 0) / recordsWithR.length
      : null;
    const hasPnlForAll = resolved.length > 0 && resolved.every(record => typeof record.PnL === 'number');
    const performanceValues = hasPnlForAll
      ? resolved.map(record => (record.PnL ?? 0) - (record.fees ?? 0) - (record.slippage ?? 0))
      : recordsWithR.map(record => record.R ?? 0);
    const grossWins = performanceValues.reduce((sum, value) => {
      return value > 0 ? sum + value : sum;
    }, 0);
    const grossLosses = performanceValues.reduce((sum, value) => {
      return value < 0 ? sum + Math.abs(value) : sum;
    }, 0);
    const enoughSamples = resolved.length >= minimumResolvedSamples && averageR !== null;
    const winRatePct = enoughSamples ? Number((wins / resolved.length * 100).toFixed(1)) : null;
    const profitFactor = enoughSamples && performanceValues.length === resolved.length
      ? (grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : grossWins > 0 ? 99 : null)
      : null;
    const expectancyR = enoughSamples && averageR !== null ? Number(averageR.toFixed(2)) : null;
    const positiveEdgeVerified =
      enoughSamples &&
      expectancyR !== null && expectancyR > 0.15 &&
      winRatePct !== null && winRatePct >= 52 &&
      profitFactor !== null && profitFactor > 1;
    const validationStatus = enoughSamples ? 'VALIDATED' as const : 'UNVALIDATED' as const;
    const activationStatus = !enoughSamples
      ? 'UNVALIDATED' as const
      : positiveEdgeVerified ? 'ACTIVE_APPROVED' as const : 'BLOCKED_NEGATIVE_EDGE' as const;

    matrixRecords.push({
      setupType: sType,
      setupTypeFa: SETUP_NAMES_FA[sType] || sType,
      regime,
      regimeFa: REGIME_NAMES_FA[regime] || regime,
      timeframe,
      sampleCount: resolved.length,
      winRatePct,
      profitFactor,
      averageR: enoughSamples && averageR !== null ? Number(averageR.toFixed(2)) : null,
      expectancyR,
      validationStatus,
      positiveEdgeVerified,
      activationStatus,
      reasonFa: enoughSamples
        ? positiveEdgeVerified
          ? `بر اساس ${resolved.length} معامله واقعی در Dataset، این ترکیب دارای Expectancy مثبت است.`
          : `بر اساس ${resolved.length} معامله واقعی، شرط لبه مثبت تایید نشد.`
        : `UNVALIDATED: فقط ${resolved.length} از ${minimumResolvedSamples} معامله واقعی موردنیاز ثبت شده؛ ورود مسدود است.`,
    });
  }

  // رکورد ستاپ جاری
  const currentEdgeRecord = matrixRecords.find(r => r.setupType === setupCandidate) || matrixRecords[0];
  const isSetupAllowedInCurrentRegime = currentEdgeRecord.positiveEdgeVerified;

  // بهترین ستاپ‌های مجاز برای رژیم فعلی
  const bestSetupsForCurrentRegime = matrixRecords
    .filter(r => r.positiveEdgeVerified)
    .sort((a, b) => b.expectancyR - a.expectancyR)
    .map(r => ({ setupType: r.setupType, setupTypeFa: r.setupTypeFa, expectancyR: r.expectancyR }));

  // ستاپ‌های ممنوعه در رژیم فعلی
  const prohibitedSetupsInCurrentRegime = matrixRecords
    .filter(r => !r.positiveEdgeVerified)
    .map(r => ({ setupType: r.setupType, setupTypeFa: r.setupTypeFa, reasonFa: r.reasonFa }));

  const summaryVerdictFa = isSetupAllowedInCurrentRegime
    ? `ستاپ «${currentEdgeRecord.setupTypeFa}» در رژیم «${currentEdgeRecord.regimeFa}»، جهت ${direction} و تایم‌فریم ${timeframe} بر اساس داده معاملات واقعی تایید شد.`
    : `⛔ اجرای ستاپ «${currentEdgeRecord.setupTypeFa}» برای ${direction} در رژیم «${currentEdgeRecord.regimeFa}» و تایم‌فریم ${timeframe} مسدود است. ${currentEdgeRecord.reasonFa}`;

  return {
    activeRegime: regime,
    activeTimeframe: timeframe,
    activeDirection: direction,
    activeSetupCandidate: setupCandidate,
    currentEdgeRecord,
    isSetupAllowedInCurrentRegime,
    matrixRecords,
    bestSetupsForCurrentRegime,
    prohibitedSetupsInCurrentRegime,
    summaryVerdictFa,
    evaluatedAt: Date.now(),
  };
}

/**
 * ۳۸. تحلیل و حل ساختاری تضاد رژیم در چند تایم‌فریم (Multi-Timeframe Regime Structural Resolver)
 * 5m = BREAKOUT, 15m = TREND, 1H = RANGE, 4H = BULLISH TREND
 */
export interface MultiTimeframeRegimeAnalysis {
  tf5m: { regime: AdvancedRegimeType; confidencePct: number; regimeFa: string };
  tf15m: { regime: AdvancedRegimeType; confidencePct: number; regimeFa: string };
  tf1h: { regime: AdvancedRegimeType; confidencePct: number; regimeFa: string };
  tf4h: { regime: AdvancedRegimeType; confidencePct: number; regimeFa: string };
  conflictType: 'FULL_CONFLUENCE' | 'EXPANSION_WITHIN_RANGE' | 'COUNTER_TREND_BREAKOUT' | 'COMPRESSION_BUILDUP' | 'STRUCTURAL_DIVERGENCE';
  conflictResolutionVerdictFa: string;
  structuralAlignmentScorePct: number;
  allowedActionFa: string;
  recommendedPositionSizeMultiplier: number;
}

export function resolveMultiTimeframeRegimeConflict(
  tf5mRegime: AdvancedRegimeType,
  tf15mRegime: AdvancedRegimeType,
  tf1hRegime: AdvancedRegimeType,
  tf4hRegime: AdvancedRegimeType,
  confidences: { tf5m: number; tf15m: number; tf1h: number; tf4h: number }
): MultiTimeframeRegimeAnalysis {
  const c5m = confidences.tf5m;
  const c15m = confidences.tf15m;
  const c1h = confidences.tf1h;
  const c4h = confidences.tf4h;

  let conflictType: MultiTimeframeRegimeAnalysis['conflictType'] = 'EXPANSION_WITHIN_RANGE';
  let conflictResolutionVerdictFa = '';
  let structuralAlignmentScorePct = 0;
  let allowedActionFa = 'کاهش حجم به ۵۰٪ و حد سود محافظه‌کارانه در سقف رنج ۱ ساعته';
  let recommendedPositionSizeMultiplier = 0.65;

  const isTf4hTrend = tf4hRegime === 'TREND' || tf4hRegime === 'EXPANSION';
  const isTf1hRange = tf1hRegime === 'RANGE';
  const isTf5mBreakout = tf5mRegime === 'BREAKOUT';

  if (tf5mRegime === tf15mRegime && tf15mRegime === tf1hRegime && tf1hRegime === tf4hRegime) {
    conflictType = 'FULL_CONFLUENCE';
    conflictResolutionVerdictFa = 'همگرایی کامل ۱۰۰٪ در کلیه افق‌های زمانی (5m, 15m, 1H, 4H). بالاترین احتمال موفقیت.';
    allowedActionFa = 'اجرای بدون فیلتر با تخصیص ۱۰۰٪ حجم استاندارد و تریلینگ استاپ پویا';
    recommendedPositionSizeMultiplier = 1.0;
  } else if (isTf1hRange && isTf5mBreakout) {
    // دقیقا سناریوی مثال کاربر: 5m=BREAKOUT, 15m=TREND, 1H=RANGE, 4H=BULLISH TREND
    conflictType = 'EXPANSION_WITHIN_RANGE';
    conflictResolutionVerdictFa = 'شکست در تایم‌فریم کوتاه‌مدت (5m) داخل محدوده نوسانی کلان (1H Range) واقع شده است. ریسک تله شکست (Fakeout/Liquidity Sweep) در سقف/کف رنج وجود دارد.';
    allowedActionFa = 'ورود مجاز فقط به عنوان Scalp سریع تا مرز بیرونی رنج با کاهش ریسک به ۵۰٪؛ خروج پیش از برخورد به دیوار نقدینگی ۱ ساعته';
    recommendedPositionSizeMultiplier = 0.5;
  } else if (!isTf4hTrend && isTf5mBreakout) {
    conflictType = 'COUNTER_TREND_BREAKOUT';
    conflictResolutionVerdictFa = 'شکست کوتاه‌مدت خلاف جهت ساختار ۴ ساعته است. ساختار کلان ارجحیت قطعی دارد.';
    allowedActionFa = 'معامله ممنوع یا کاهش شدید سایز به ۲۵٪ با تاییدیه کندل ۱ ساعته';
    recommendedPositionSizeMultiplier = 0.25;
  } else if (tf1hRegime === 'COMPRESSION' || tf4hRegime === 'COMPRESSION') {
    conflictType = 'COMPRESSION_BUILDUP';
    conflictResolutionVerdictFa = 'فشردگی نوسان در تایم‌های بالا در حال آماده‌سازی برای انفجار روند بزرگ است. سیگنال‌های خلاف جهت فیلتر می‌شوند.';
    allowedActionFa = 'انتظار برای شکست تایید شده در تایم ۱۵ دقیقه و همراهی با مومنتوم خروجی';
    recommendedPositionSizeMultiplier = 0.75;
  } else {
    conflictType = 'STRUCTURAL_DIVERGENCE';
    conflictResolutionVerdictFa = 'ناهمخوانی ساختاری بین تایم‌فریم‌های مختلف. سیستم به رژیم تایم‌های کلان (1H و 4H) وزن مضاعف اختصاص می‌دهد.';
    allowedActionFa = 'اجرای احتیاطی با پوزیشن ۳۰٪ الی ۵۰٪ تا همگرایی رژیم‌ها';
    recommendedPositionSizeMultiplier = 0.45;
  }

  const regimeCounts = [tf5mRegime, tf15mRegime, tf1hRegime, tf4hRegime]
    .reduce((counts, regime) => counts.set(regime, (counts.get(regime) ?? 0) + 1), new Map<AdvancedRegimeType, number>());
  const majorityAgreement = Math.max(...regimeCounts.values()) / 4;
  const meanRegimeProbability = (c5m + c15m + c1h + c4h) / 4;
  structuralAlignmentScorePct = Math.round(majorityAgreement * meanRegimeProbability);

  return {
    tf5m: { regime: tf5mRegime, confidencePct: c5m, regimeFa: REGIME_NAMES_FA[tf5mRegime] || tf5mRegime },
    tf15m: { regime: tf15mRegime, confidencePct: c15m, regimeFa: REGIME_NAMES_FA[tf15mRegime] || tf15mRegime },
    tf1h: { regime: tf1hRegime, confidencePct: c1h, regimeFa: REGIME_NAMES_FA[tf1hRegime] || tf1hRegime },
    tf4h: { regime: tf4hRegime, confidencePct: c4h, regimeFa: REGIME_NAMES_FA[tf4hRegime] || tf4hRegime },
    conflictType,
    conflictResolutionVerdictFa,
    structuralAlignmentScorePct,
    allowedActionFa,
    recommendedPositionSizeMultiplier,
  };
}
