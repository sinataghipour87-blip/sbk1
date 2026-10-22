import type { AnalysisResult } from '../types/trading';

export interface VolatilitySpikeReport {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  riskScorePct: number | null;
  expectedDirection: 'UP_SHORT_SQUEEZE' | 'DOWN_LONG_FLUSH' | 'RANGING_COMPRESSION' | 'NEUTRAL' | 'UNAVAILABLE';
  fundingRateStatusFa: string;
  orderBookImbalanceScore: number | null;
  alertLevel: 'CRITICAL_SPIKE_IMMINENT' | 'MODERATE_WARNING' | 'STABLE_ZONES' | 'UNAVAILABLE';
  actionAdvisoryFa: string;
}

function unavailable(reason: string): VolatilitySpikeReport {
  return {
    status: 'UNAVAILABLE',
    riskScorePct: null,
    expectedDirection: 'UNAVAILABLE',
    fundingRateStatusFa: reason,
    orderBookImbalanceScore: null,
    alertLevel: 'UNAVAILABLE',
    actionAdvisoryFa: 'به‌دلیل نبود شواهد زنده و معتبر، این ماژول هشدار صادر نمی‌کند.',
  };
}

export function evaluateVolatilitySpike(
  analysis: Partial<AnalysisResult> | undefined,
  currentPrice = 0,
  nowMs = Date.now(),
): VolatilitySpikeReport {
  const funding = analysis?.funding ?? analysis?.fundingRate;
  const obi = analysis?.realObiData?.obi ?? analysis?.obi;
  const volatilityPct = analysis?.volatilityPct;
  const livePrice = currentPrice > 0 ? currentPrice : analysis?.futuresPrices?.lastPrice;
  const quality = analysis?.dataQualityReport;
  const ticker = analysis?.futuresPrices;
  const orderBook = analysis?.realObiData;
  const derivativeFeed = quality?.feeds.derivatives;
  const orderBookFeed = quality?.feeds.orderBook;
  const tickerFresh = ticker?.status === 'LIVE' &&
    Number.isSafeInteger(ticker.receivedTimestampMs) &&
    nowMs >= ticker.receivedTimestampMs &&
    nowMs - ticker.receivedTimestampMs <= 5_000;
  const orderBookFresh = orderBook?.status === 'LIVE' &&
    orderBookFeed?.status === 'LIVE' &&
    Number.isSafeInteger(orderBook.timestamp) &&
    nowMs >= orderBook.timestamp &&
    nowMs - orderBook.timestamp <= Math.min(orderBookFeed.maxAgeMs ?? 10_000, 10_000);
  const derivativesFresh = derivativeFeed?.status === 'LIVE' &&
    Number.isSafeInteger(derivativeFeed.timestamp) &&
    nowMs >= derivativeFeed.timestamp &&
    nowMs - derivativeFeed.timestamp <= (derivativeFeed.maxAgeMs ?? 10 * 60_000);
  if (
    !['LIVE', 'VERIFIED_REALTIME'].includes(analysis?.dataStatus ?? '') ||
    !quality?.isTradeAllowed ||
    !tickerFresh ||
    !orderBookFresh ||
    !derivativesFresh ||
    typeof funding !== 'number' || !Number.isFinite(funding) ||
    typeof obi !== 'number' || !Number.isFinite(obi) ||
    typeof volatilityPct !== 'number' || !Number.isFinite(volatilityPct) || volatilityPct < 0 ||
    typeof livePrice !== 'number' || !Number.isFinite(livePrice) || livePrice <= 0
  ) {
    return unavailable('فاندینگ، دفتر سفارش، نوسان یا قیمت زنده ناموجود/کهنه است.');
  }

  let riskScorePct = 45;
  let expectedDirection: VolatilitySpikeReport['expectedDirection'] = 'NEUTRAL';
  let alertLevel: VolatilitySpikeReport['alertLevel'] = 'STABLE_ZONES';
  let fundingStatusFa = `فاندینگ ثبت‌شده ${(funding * 100).toFixed(3)}٪ است؛ امتیاز هشدار heuristic و کالیبره‌نشده است.`;
  let advisoryFa = 'ورودی‌ها تازه‌اند؛ امتیاز صرفاً هشدار تحلیلی است و مجوز معامله نیست.';

  if (funding > 0.035 && obi < -0.10) {
    riskScorePct = 89;
    expectedDirection = 'DOWN_LONG_FLUSH';
    alertLevel = 'CRITICAL_SPIKE_IMMINENT';
    fundingStatusFa = `فاندینگ بالا (${(funding * 100).toFixed(3)}٪) همراه با عدم‌تقارن منفی دفتر سفارش.`;
    advisoryFa = 'هشدار heuristic فشار نزولی؛ این خروجی جهت شورا یا دستور اجرایی نیست.';
  } else if (funding < -0.015 && obi > 0.10) {
    riskScorePct = 92;
    expectedDirection = 'UP_SHORT_SQUEEZE';
    alertLevel = 'CRITICAL_SPIKE_IMMINENT';
    fundingStatusFa = `فاندینگ منفی شدید (${(funding * 100).toFixed(3)}٪) همراه با عدم‌تقارن مثبت دفتر سفارش.`;
    advisoryFa = 'هشدار heuristic فشار صعودی؛ این خروجی جهت شورا یا دستور اجرایی نیست.';
  } else if (volatilityPct < 1.0) {
    riskScorePct = 68;
    expectedDirection = 'RANGING_COMPRESSION';
    alertLevel = 'MODERATE_WARNING';
    fundingStatusFa = 'نوسان تحقق‌یافته پایین است؛ احتمال شکست جهت‌دار از این داده به‌تنهایی قابل تعیین نیست.';
    advisoryFa = 'فشردگی نوسان شناسایی شد؛ جهت حرکت قابل پیش‌بینی نیست و خروجی مجوز معامله نیست.';
  }

  return {
    status: 'AVAILABLE',
    riskScorePct,
    expectedDirection,
    fundingRateStatusFa: fundingStatusFa,
    orderBookImbalanceScore: Math.round(obi * 1_000) / 10,
    alertLevel,
    actionAdvisoryFa: advisoryFa,
  };
}
