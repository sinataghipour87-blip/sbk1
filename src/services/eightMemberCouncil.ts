import type { AnalysisResult, DataQualityReport, MarketFeedQuality } from '../types/trading';
import type { MacroCorrelationData } from './macroContextBrain';
import type { FreeMacroDataResult } from './freeMacroData';
import {
  deduplicateCandles,
  deduplicateDerivativeObservations,
  deduplicateMacroObservations,
  deduplicateNews,
  deduplicateOnChainTransfers,
} from './councilEvidenceDeduplication';

export type CouncilVote = 'LONG' | 'SHORT' | 'NEUTRAL' | 'ABSTAIN';
export type CouncilDirection = 'LONG' | 'SHORT' | null;

export interface CouncilOptionsData {
  status: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  timestampMs: number | null;
  retrievedAtMs?: number | null;
  ageMs: number | null;
  qualityPct: number;
  impliedVolatilityPct: number | null;
  putCallRatio: number | null;
  expiryTimestampMs: number | null;
  strikePrice: number | null;
  skewPct: number | null;
  provider?: string;
  contractsCount?: number;
  callOpenInterest?: number;
  putOpenInterest?: number;
  underlyingPrice?: number;
}

export interface CouncilWhaleFlowData {
  status: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  provider: string;
  timestampMs: number | null;
  retrievedAtMs?: number | null;
  ageMs: number | null;
  qualityPct: number;
  coverageStatus?: 'SAMPLED' | 'COMPLETE' | 'UNAVAILABLE';
  unavailableReason?: string;
  largeTransfers?: CouncilWhaleTransfer[];
  networkMetrics?: Record<string, number | string | null>;
  exchangeInflowsBtc: number | null;
  exchangeOutflowsBtc: number | null;
  netExchangeFlowBtc: number | null;
  transactionCount: number;
  windowStartHeight: number | null;
  windowEndHeight: number | null;
}

export interface CouncilWhaleTransfer {
  transactionHash: string;
  blockchain: string;
  blockHeight: number | null;
  timestampMs: number;
  sourceProvider: string;
  asset: string;
  amount: number;
  estimatedUsd: number | null;
  confirmationStatus: 'CONFIRMED' | 'UNCONFIRMED' | 'UNKNOWN';
  transferId?: string;
}

export interface CouncilModuleEvidence {
  moduleId: string;
  nameFa: string;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'STALE';
  sourceTimestampMs: number | null;
  summaryFa: string;
  output?: unknown;
}

export type CouncilMacroContext = Pick<
  MacroCorrelationData,
  | 'overallDataStatus'
  | 'lastUpdatedTime'
  | 'sp500Status'
  | 'sp500DailyChangePct'
  | 'dxyStatus'
  | 'dxyDailyChangePct'
  | 'etfFlowStatus'
  | 'spotEtfNetInflowMillionUsd'
  | 'newsSentimentStatus'
  | 'newsSentimentScore'
  | 'newsHeadlinesStatus'
  | 'recentHeadlines'
  | 'whaleFlowStatus'
  | 'whaleNetflowBtc'
  | 'whalePressureIndex'
  | 'whaleSentiment'
  | 'fundamentalBias'
> & Partial<Pick<
  MacroCorrelationData,
  | 'provenance'
  | 'dxyIndex'
  | 'broadDollarProxyStatus'
  | 'broadDollarProxyDailyChangePct'
>>;

export interface CouncilQualityCheck {
  labelFa: string;
  passed: boolean;
  detailFa: string;
}

export interface CouncilMemberDefinition {
  id: number;
  nameFa: string;
  nameEn: string;
  questionFa: string;
  inputIds: readonly string[];
  moduleIds: readonly string[];
}

export interface CouncilMemberVote extends CouncilMemberDefinition {
  vote: CouncilVote;
  rationaleFa: string;
  sourceTimestampMs: number | null;
  sourceAgeMs: number | null;
  dataQualityPct: number | null;
  confidencePct: number | null;
  qualityChecks: CouncilQualityCheck[];
  supportingEvidence: CouncilModuleEvidence[];
}

export interface EightMemberCouncilReport {
  evaluatedAtMs: number;
  quorumRequired: 5;
  members: CouncilMemberVote[];
  longVotes: number;
  shortVotes: number;
  neutralVotes: number;
  abstentions: number;
  selectedDirection: CouncilDirection;
  quorumMet: boolean;
  summaryFa: string;
}

export interface CouncilMemberEvidenceCacheEntry {
  evidenceFingerprint: string;
  evaluatedAtMs: number;
  voteResult: CouncilMemberVote;
}

function reuseCachedMemberVote(
  cached: CouncilMemberEvidenceCacheEntry | undefined,
  evidenceFingerprint: string | undefined,
  nowMs: number,
): CouncilMemberVote | null {
  if (
    !cached ||
    !evidenceFingerprint ||
    cached.evidenceFingerprint !== evidenceFingerprint ||
    cached.voteResult.vote === 'ABSTAIN' ||
    !isFiniteNumber(cached.voteResult.sourceAgeMs) ||
    !isFiniteNumber(cached.evaluatedAtMs)
  ) return null;
  const elapsedMs = nowMs - cached.evaluatedAtMs;
  const sourceAgeMs = cached.voteResult.sourceAgeMs + elapsedMs;
  if (
    elapsedMs < 0 ||
    sourceAgeMs < 0 ||
    elapsedMs > 5 * 60 * 60_000 ||
    sourceAgeMs > (MEMBER_EVIDENCE_MAX_AGE_MS[cached.voteResult.id] ?? 0)
  ) return null;
  const reuseNote = ' شواهد این عضو با دادهٔ پیشین یکسان بود؛ رأی قبلی بدون تحلیل مجدد استفاده شد.';
  return {
    ...cached.voteResult,
    sourceAgeMs,
    rationaleFa: `${cached.voteResult.rationaleFa.replaceAll(reuseNote, '')}${reuseNote}`,
    qualityChecks: [
      ...cached.voteResult.qualityChecks.filter(({ labelFa }) => labelFa !== 'فیلتر داده تکراری'),
      {
        labelFa: 'فیلتر داده تکراری',
        passed: true,
        detailFa: `fingerprint شواهد عضو ${cached.voteResult.id} تغییر نکرده است؛ تحلیل تکراری اجرا نشد.`,
      },
    ],
  };
}

export const EIGHT_MEMBER_COUNCIL: readonly CouncilMemberDefinition[] = [
  {
    id: 1,
    nameFa: 'تحلیلگر روند و ساختار قیمت',
    nameEn: 'Price Action & Technical Analysis',
    questionFa: 'ساختار و شواهد تکنیکال به کدام جهت متمایل‌اند؟',
    inputIds: ['analysis.candles', 'analysis.rsi', 'analysis.mtf1h', 'analysis.mtf4h', 'dataQualityReport.feeds.candles'],
    moduleIds: [
      'brains.brain01MacroTrend', 'brains.brain09BayesianProbabilistic',
      'technical.mtfStructuralReport',
      'sb.SB1', 'openSource.candlestickPatterns', 'openSource.marketRegime', 'openSource.marketAnomaly',
      'openSource.lightgbmForecast', 'openSource.xgboostForecast',
      'marketFallback.binanceCandles', 'marketFallback.binanceFastCandles',
      'marketFallback.binance1hCandles', 'marketFallback.binance4hCandles',
      'marketFallback.crossExchangePrices.member1',
    ],
  },
  {
    id: 2,
    nameFa: 'تحلیلگر معاملات واقعی و فشار خریدوفروش',
    nameEn: 'Trade Flow Analysis',
    questionFa: 'معاملات اجراشده واقعاً فشار خرید دارند یا فروش؟',
    inputIds: ['analysis.orderFlowFeatures.cvdDelta', 'dataQualityReport.feeds.orderFlow'],
    moduleIds: ['brains.brain07OrderBookCvd', 'marketFallback.binanceTrades', 'marketFallback.crossExchangePrices.member2'],
  },
  {
    id: 3,
    nameFa: 'تحلیلگر دفتر سفارش و نقدینگی',
    nameEn: 'Order Book & Liquidity',
    questionFa: 'دفتر سفارش زنده چه عدم‌تعادلی نشان می‌دهد؟',
    inputIds: ['analysis.realObiData', 'dataQualityReport.feeds.orderBook'],
    moduleIds: ['brains.brain02LiquidityFlow', 'sb.SB2', 'marketFallback.binanceOrderBook', 'marketFallback.crossExchangePrices.member3'],
  },
  {
    id: 4,
    nameFa: 'تحلیلگر بازار مشتقات',
    nameEn: 'Futures & Derivatives',
    questionFa: 'ازدحام موقعیت‌های اهرمی چه ریسکی ایجاد می‌کند؟',
    inputIds: ['analysis.fundingRate', 'analysis.oi', 'dataQualityReport.feeds.derivatives'],
    moduleIds: [
      'brains.brain03GarchVolatility', 'brains.brain05FloatingRiskHedging',
      'derivatives.cvdOiMatrix', 'derivatives.liquidationCascade',
      'brains.brain10AutoPilotHarmonizer',
      'marketFallback.binanceDerivatives', 'marketFallback.crossExchangePrices.member4',
    ],
  },
  {
    id: 5,
    nameFa: 'تحلیلگر بازار اختیار معامله',
    nameEn: 'Options Analysis',
    questionFa: 'داده معتبر اختیار معامله چه انتظاری از ریسک دارد؟',
    inputIds: ['optionsData.putCallRatio', 'optionsData.impliedVolatilityPct', 'optionsData.qualityPct'],
    moduleIds: ['options.deribitPublicOptions'],
  },
  {
    id: 6,
    nameFa: 'تحلیلگر آن‌چین و رفتار کیف‌پول‌ها',
    nameEn: 'On-Chain Analysis',
    questionFa: 'شواهد زنجیره‌ای معتبر از رفتار دارایی‌ها چه می‌گویند؟',
    inputIds: ['macroContext.whaleFlowStatus', 'macroContext.whaleSentiment', 'macroContext.whaleNetflowBtc', 'macroSource.bitcoinActiveAddresses'],
    moduleIds: ['brains.brain06OnChainWhaleFlow', 'brains.brain11OnChainWhaleSentiment', 'onchain.bitcoinActiveAddresses', 'onchain.bitcoinPublicTransfers'],
  },
  {
    id: 7,
    nameFa: 'تحلیلگر اقتصاد کلان و نقدینگی جهانی',
    nameEn: 'Macro & Global Liquidity',
    questionFa: 'شرایط کلان و جریان سرمایه به نفع کدام جهت است؟',
    inputIds: ['macroContext.fundamentalBias', 'macroContext.sp500DailyChangePct', 'macroContext.dxyDailyChangePct', 'macroContext.spotEtfNetInflowMillionUsd', 'macroSource.sp500', 'macroSource.dxy', 'macroSource.tradingViewDxyProxy', 'macroSource.broadDollarProxy', 'macroSource.fedRates'],
    moduleIds: ['brains.brain08FundamentalMacro', 'macro.sp500', 'macro.dxy', 'macro.tradingViewDxyProxy', 'macro.broadDollarProxy', 'macro.fedRates'],
  },
  {
    id: 8,
    nameFa: 'تحلیلگر اخبار و احساسات بازار',
    nameEn: 'News & Sentiment',
    questionFa: 'اخبار معتبر و تازه چه اثری بر احساسات بازار دارند؟',
    inputIds: ['macroContext.recentHeadlines', 'macroContext.newsSentimentScore', 'macroContext.newsSentimentStatus'],
    moduleIds: ['openSource.newsSentiment'],
  },
] as const;

const MAX_OPTIONS_AGE_MS = 5 * 60_000;
const MAX_ONCHAIN_AGE_MS = 10 * 60_000;
const MAX_PUBLIC_ONCHAIN_AGE_MS = 5 * 60_000;
const MAX_MACRO_AGE_MS = 14 * 24 * 60 * 60_000;
const MAX_NEWS_AGE_MS = 6 * 60 * 60_000;
const MAX_DIRECT_MACRO_AGE_MS = 14 * 24 * 60 * 60_000;
const MAX_DXY_AGE_MS = 7 * 24 * 60 * 60_000;
const MEMBER_EVIDENCE_MAX_AGE_MS: Readonly<Record<number, number>> = {
  1: 65_000,
  2: 5_000,
  3: 5_000,
  4: 10_000,
  5: MAX_OPTIONS_AGE_MS,
  6: MAX_PUBLIC_ONCHAIN_AGE_MS,
  7: MAX_DIRECT_MACRO_AGE_MS,
  8: MAX_NEWS_AGE_MS,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLiveStatus(status: string | undefined): boolean {
  return status === 'LIVE' || status === 'VERIFIED_REALTIME';
}

function getFreshFeed(
  report: DataQualityReport | undefined,
  feedId: keyof DataQualityReport['feeds'],
  nowMs: number,
  fallbackMaxAgeMs: number
): { feed: MarketFeedQuality; ageMs: number } | null {
  const feed = report?.feeds[feedId];
  if (
    !feed ||
    !isLiveStatus(feed.status) ||
    !isFiniteNumber(feed.timestamp) ||
    !isFiniteNumber(feed.ageMs) ||
    !isFiniteNumber(feed.score) ||
    feed.score < 0 ||
    feed.score > 100
  ) return null;

  const actualAgeMs = nowMs - feed.timestamp;
  const maxAgeMs = feed.maxAgeMs ?? fallbackMaxAgeMs;
  if (
    actualAgeMs < 0 ||
    actualAgeMs > maxAgeMs ||
    feed.ageMs < 0 ||
    feed.ageMs > maxAgeMs ||
    Math.abs(actualAgeMs - feed.ageMs) > 5_000
  ) return null;

  return { feed, ageMs: Math.max(actualAgeMs, feed.ageMs) };
}

function freshTimestamp(
  timestampMs: number | null | undefined,
  declaredAgeMs: number | null | undefined,
  nowMs: number,
  maxAgeMs: number
): { timestampMs: number; ageMs: number } | null {
  if (!isFiniteNumber(timestampMs) || !isFiniteNumber(declaredAgeMs)) return null;
  const actualAgeMs = nowMs - timestampMs;
  if (
    actualAgeMs < 0 ||
    actualAgeMs > maxAgeMs ||
    declaredAgeMs < 0 ||
    declaredAgeMs > maxAgeMs ||
    Math.abs(actualAgeMs - declaredAgeMs) > 5_000
  ) return null;
  return { timestampMs, ageMs: Math.max(actualAgeMs, declaredAgeMs) };
}

function confidenceForStrength(strength: number): number {
  return Math.round(Math.max(50, Math.min(95, 50 + strength)));
}

function createVote(
  member: CouncilMemberDefinition,
  vote: CouncilVote,
  rationaleFa: string,
  qualityChecks: CouncilQualityCheck[],
  options: {
    sourceTimestampMs?: number | null;
    sourceAgeMs?: number | null;
    dataQualityPct?: number | null;
    confidencePct?: number | null;
  } = {}
): CouncilMemberVote {
  return {
    ...member,
    vote,
    rationaleFa,
    sourceTimestampMs: options.sourceTimestampMs ?? null,
    sourceAgeMs: options.sourceAgeMs ?? null,
    dataQualityPct: options.dataQualityPct ?? null,
    confidencePct: vote === 'ABSTAIN' ? null : (options.confidencePct ?? 50),
    qualityChecks,
    supportingEvidence: [],
  };
}

function abstain(
  member: CouncilMemberDefinition,
  reasonFa: string,
  checks: CouncilQualityCheck[],
  sourceTimestampMs: number | null = null,
  sourceAgeMs: number | null = null
): CouncilMemberVote {
  return createVote(member, 'ABSTAIN', reasonFa, checks, { sourceTimestampMs, sourceAgeMs });
}

function getMacroAge(
  macro: CouncilMacroContext | null | undefined,
  nowMs: number,
  maxAgeMs: number
): { timestampMs: number; ageMs: number } | null {
  if (!macro?.lastUpdatedTime) return null;
  const ageMs = nowMs - macro.lastUpdatedTime;
  if (ageMs < 0 || ageMs > maxAgeMs) return null;
  return { timestampMs: macro.lastUpdatedTime, ageMs };
}

function getMacroSourceTimestamp(
  macro: CouncilMacroContext | null | undefined,
  metricId: string,
  nowMs: number,
  maxAgeMs = MAX_DIRECT_MACRO_AGE_MS,
): number | null {
  const provenance = macro?.provenance?.[metricId];
  if (!isRecord(provenance)) return null;
  const source = provenance;
  const timestampMs = isFiniteNumber(source.observedAtMs)
    ? source.observedAtMs
    : source.retrievedAtMs;
  return isFiniteNumber(timestampMs) &&
    timestampMs <= nowMs &&
    nowMs - timestampMs <= maxAgeMs
    ? timestampMs
    : null;
}

function isFreshDirectMacroMetric(
  metric: FreeMacroDataResult[keyof FreeMacroDataResult] | undefined,
  nowMs: number,
  maxAgeMs = MAX_DIRECT_MACRO_AGE_MS,
): metric is FreeMacroDataResult[keyof FreeMacroDataResult] & {
  value: number;
  previousValue: number | null;
  observedAtMs: number;
} {
  if (
    !metric ||
    metric.status !== 'LIVE' ||
    !isFiniteNumber(metric.value) ||
    !isFiniteNumber(metric.observedAtMs)
  ) return false;
  const ageMs = nowMs - metric.observedAtMs;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

function calculateRsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= 14; index += 1) {
    const change = closes[index] - closes[index - 1];
    averageGain += Math.max(change, 0) / 14;
    averageLoss += Math.max(-change, 0) / 14;
  }
  for (let index = 15; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    averageGain = (averageGain * 13 + Math.max(change, 0)) / 14;
    averageLoss = (averageLoss * 13 + Math.max(-change, 0)) / 14;
  }
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

function evaluateTechnical(
  member: CouncilMemberDefinition,
  analysis: Partial<AnalysisResult> | null | undefined,
  nowMs: number
): CouncilMemberVote {
  const dataQuality = analysis?.dataQualityReport;
  const candleFeed = dataQuality?.feeds.candles;
  const usesOneMinuteCandles = Array.isArray(analysis?.htfCandles?.['1m']) &&
    analysis.htfCandles['1m'].length >= 30;
  const sourceCandles = usesOneMinuteCandles
    ? analysis!.htfCandles!['1m']
    : Array.isArray(analysis?.candles) ? analysis.candles : [];
  const candleDeduplication = deduplicateCandles(sourceCandles);
  const candles = candleDeduplication.values;
  const conflictingCandleTimestamp = candleDeduplication.conflictingIdentity;
  const closes = candles
    .map((candle) => candle.length >= 6 ? candle[4] : candle[3])
    .filter((close): close is number => isFiniteNumber(close) && close > 0);
  const hasCandles = !conflictingCandleTimestamp &&
    candles.length >= 30 &&
    closes.length === candles.length;
  const candleTimestampMs = usesOneMinuteCandles
    ? analysis?.signalDataTimestamps?.mtf1mMs
    : candleFeed?.timestamp;
  const candleFreshness = freshTimestamp(
    candleTimestampMs,
    candleTimestampMs == null ? null : nowMs - candleTimestampMs,
    nowMs,
    65_000,
  );
  const candleFeedIsValid = !!candleFeed &&
    isLiveStatus(candleFeed.status) &&
    isFiniteNumber(candleFeed.score) &&
    candleFeed.score >= 0 &&
    candleFeed.score <= 100;
  const rsi = calculateRsi14(closes);
  const hasRsi = rsi !== null;
  const mtf1hFreshness = freshTimestamp(
    analysis?.signalDataTimestamps?.mtf1hMs,
    analysis?.signalDataTimestamps?.mtf1hMs == null
      ? null
      : nowMs - analysis.signalDataTimestamps.mtf1hMs,
    nowMs,
    60 * 60_000 + 5_000,
  );
  const mtf4hFreshness = freshTimestamp(
    analysis?.signalDataTimestamps?.mtf4hMs,
    analysis?.signalDataTimestamps?.mtf4hMs == null
      ? null
      : nowMs - analysis.signalDataTimestamps.mtf4hMs,
    nowMs,
    4 * 60 * 60_000 + 5_000,
  );
  const higherTimeframeEvidenceIsTimestamped = mtf1hFreshness !== null &&
    mtf4hFreshness !== null;
  const higherTimeframeValuesAreValid =
    (analysis?.mtf1h === 'BULLISH' || analysis?.mtf1h === 'BEARISH') &&
    (analysis?.mtf4h === 'BULLISH' || analysis?.mtf4h === 'BEARISH');
  const checks = [
    { labelFa: 'تازگی کندل رأی', passed: candleFreshness !== null && candleFeedIsValid, detailFa: candleFreshness && candleFeedIsValid ? `${usesOneMinuteCandles ? analysis?.signalDataTimestamps?.mtf1mIsPartial ? 'کندل ۱m در حال تشکیل' : 'کندل ۱m تکمیل‌شده' : 'کندل اصلی'}؛ سن ${Math.round(candleFreshness.ageMs)}ms` : 'فید معتبر یا کندل تازهٔ حداکثر ۶۵ ثانیه‌ای موجود نیست.' },
    { labelFa: 'کامل بودن داده قیمت', passed: hasCandles, detailFa: hasCandles ? `${candles.length} کندل با close معتبر` : 'کمتر از ۳۰ کندل معتبر یا close نامعتبر است.' },
    { labelFa: 'حذف کندل تکراری', passed: !conflictingCandleTimestamp, detailFa: conflictingCandleTimestamp ? 'برای یک timestamp چند کندل با مقادیر متناقض دریافت شد؛ رأی مسدود است.' : `${candleDeduplication.duplicateCount} کندل تکراری حذف شد.` },
    { labelFa: 'RSI از کندل‌های همین snapshot', passed: hasRsi, detailFa: hasRsi ? `RSI14: ${rsi!.toFixed(2)}؛ مستقیماً از closeهای همین snapshot محاسبه شد.` : 'RSI از کندل‌های همین snapshot قابل‌محاسبه نیست.' },
    { labelFa: 'تازگی تایم‌فریم ۱h/۴h', passed: higherTimeframeEvidenceIsTimestamped, detailFa: higherTimeframeEvidenceIsTimestamped ? `۱h ${Math.round(mtf1hFreshness!.ageMs / 1000)}s؛ ۴h ${Math.round(mtf4hFreshness!.ageMs / 1000)}s` : 'timestamp مستقل و تازه برای هر دو تایم‌فریم موجود نیست؛ تأیید آن‌ها در رأی استفاده نمی‌شود.' },
  ];
  if (!candleFreshness || !candleFeedIsValid || !hasCandles) {
    return abstain(
      member,
      'برای تحلیل مستقل تکنیکال، کندل تازه و حداقل ۳۰ close معتبر لازم است.',
      checks,
      candleFreshness?.timestampMs ?? candleFeed?.timestamp ?? null,
      candleFreshness?.ageMs ?? null,
    );
  }

  const fastAverage = closes.slice(-10).reduce((sum, close) => sum + close, 0) / 10;
  const slowAverage = closes.slice(-30).reduce((sum, close) => sum + close, 0) / 30;
  const priorClose = closes.at(-6)!;
  const latestClose = closes.at(-1)!;
  const momentumPct = (latestClose - priorClose) / priorClose * 100;
  const trendSignal = fastAverage >= slowAverage * 1.0005
    ? 1
    : fastAverage <= slowAverage * 0.9995
      ? -1
      : 0;
  const momentumSignal = momentumPct >= 0.2 ? 1 : momentumPct <= -0.2 ? -1 : 0;
  const rsiSignal = hasRsi
    ? rsi! >= 55 ? 1 : rsi! <= 45 ? -1 : 0
    : 0;
  const higherTimeframeSignals = higherTimeframeEvidenceIsTimestamped && higherTimeframeValuesAreValid
    ? [analysis!.mtf1h, analysis!.mtf4h].map((value) => value === 'BULLISH' ? 1 : -1)
    : [];
  const higherTimeframeSignal = higherTimeframeSignals.length === 2 &&
    higherTimeframeSignals.every((signal) => signal === higherTimeframeSignals[0])
    ? higherTimeframeSignals[0]
    : 0;
  const score = trendSignal + momentumSignal + rsiSignal + higherTimeframeSignal;
  const vote: CouncilVote = score >= 2 ? 'LONG' : score <= -2 ? 'SHORT' : 'NEUTRAL';
  const candleState = usesOneMinuteCandles && analysis?.signalDataTimestamps?.mtf1mIsPartial
    ? 'کندل زندهٔ درحال‌تشکیل'
    : 'کندل بسته‌شده';
  const rationale = `تحلیل محلی ${candleState}: SMA10 ${fastAverage.toFixed(2)} در برابر SMA30 ${slowAverage.toFixed(2)}؛ مومنتوم ۵ کندلی ${momentumPct.toFixed(3)}٪؛ RSI14 ${hasRsi ? rsi!.toFixed(2) : 'ناموجود'}؛ تأیید ۱h/۴h ${higherTimeframeSignal > 0 ? 'صعودی' : higherTimeframeSignal < 0 ? 'نزولی' : 'نامعتبر/ناهمسو'}؛ امتیاز اجزای تخصصی ${score}. امتیاز عمومی LONG/SHORT در رأی استفاده نشد.`;
  return createVote(
    member,
    vote,
    rationale,
    checks,
    {
      sourceTimestampMs: candleFreshness.timestampMs,
      sourceAgeMs: candleFreshness.ageMs,
      dataQualityPct: candleFeed.score,
      confidencePct: confidenceForStrength(Math.min(35, Math.abs(score) * 10)),
    }
  );
}

function evaluateTradeFlow(
  member: CouncilMemberDefinition,
  analysis: Partial<AnalysisResult> | null | undefined,
  nowMs: number
): CouncilMemberVote {
  const flow = analysis?.orderFlowFeatures;
  const feed = getFreshFeed(analysis?.dataQualityReport, 'orderFlow', nowMs, 5_000);
  const sourceFreshness = freshTimestamp(flow?.timestampUtc, flow?.ageMs, nowMs, 5_000);
  const delta = flow?.cvdDeltaUsd ?? flow?.cvdDelta;
  const valid = flow?.isRealTradeFlow === true &&
    flow.status === 'LIVE' &&
    feed !== null &&
    sourceFreshness !== null &&
    (flow.uniqueTradeCount === undefined ||
      (Number.isSafeInteger(flow.uniqueTradeCount) && flow.uniqueTradeCount > 0)) &&
    isFiniteNumber(delta);
  const checks = [
    { labelFa: 'جریان معاملات واقعی', passed: flow?.isRealTradeFlow === true && flow.status === 'LIVE', detailFa: flow?.isRealTradeFlow === true && flow.status === 'LIVE' ? 'فید معاملات اجراشده زنده است.' : 'فید زنده معاملات واقعی تأیید نشد.' },
    { labelFa: 'تازگی CVD', passed: sourceFreshness !== null && feed !== null, detailFa: sourceFreshness ? `${Math.round(sourceFreshness.ageMs)}ms` : 'داده فاقد زمان معتبر یا کهنه است.' },
    { labelFa: 'وجود دلتا', passed: isFiniteNumber(delta), detailFa: isFiniteNumber(delta) ? `دلتا: ${delta}` : 'دلتا در دسترس نیست.' },
    {
      labelFa: 'معاملات یکتای عضو',
      passed: flow?.uniqueTradeCount === undefined ||
        (Number.isSafeInteger(flow.uniqueTradeCount) && flow.uniqueTradeCount > 0),
      detailFa: flow?.uniqueTradeCount === undefined
        ? 'منبع ورودی فقط CVD تجمیعی ارائه می‌کند؛ شمار شناسه‌دار معاملات در دسترس نیست.'
        : `${flow.uniqueTradeCount} معامله یکتا؛ ${flow.duplicateTradeCount ?? 0} رویداد تکراری حذف شد.`,
    },
  ];
  if (!valid || !flow || !sourceFreshness || !feed) {
    return abstain(member, 'بدون CVD/دلتا از فید زنده معاملات اجراشده، رأی جریان معاملات صادر نمی‌شود.', checks, sourceFreshness?.timestampMs, sourceFreshness?.ageMs);
  }

  const vote: CouncilVote = delta > 0 ? 'LONG' : delta < 0 ? 'SHORT' : 'NEUTRAL';
  return createVote(
    member,
    vote,
    `جهت رأی از دلتا/CVD واقعی (${delta}) گرفته شد؛ از OBI به‌عنوان جایگزین استفاده نشده است.`,
    checks,
    {
      sourceTimestampMs: sourceFreshness.timestampMs,
      sourceAgeMs: sourceFreshness.ageMs,
      dataQualityPct: feed.feed.score,
      confidencePct: confidenceForStrength(Math.min(40, Math.abs(delta) / 10)),
    }
  );
}

function evaluateOrderBook(
  member: CouncilMemberDefinition,
  analysis: Partial<AnalysisResult> | null | undefined,
  nowMs: number
): CouncilMemberVote {
  const book = analysis?.realObiData;
  const feed = getFreshFeed(analysis?.dataQualityReport, 'orderBook', nowMs, 5_000);
  const sourceFreshness = book
    ? freshTimestamp(book.timestamp, book.ageMs, nowMs, 5_000)
    : null;
  const valid = !!book &&
    isLiveStatus(book.status) &&
    feed !== null &&
    sourceFreshness !== null &&
    isFiniteNumber(book.obi) &&
    isFiniteNumber(book.bidDepthUsd) &&
    isFiniteNumber(book.askDepthUsd) &&
    book.bidDepthUsd + book.askDepthUsd > 0 &&
    book.levelsCount > 0;
  const checks = [
    { labelFa: 'دفتر سفارش واقعی و زنده', passed: !!book && isLiveStatus(book.status), detailFa: book ? `وضعیت فید: ${book.status}` : 'دفتر سفارش واقعی موجود نیست.' },
    { labelFa: 'تازگی snapshot', passed: sourceFreshness !== null && feed !== null, detailFa: sourceFreshness ? `${Math.round(sourceFreshness.ageMs)}ms` : 'snapshot تازه تأیید نشد.' },
    { labelFa: 'حذف snapshot تکراری', passed: true, detailFa: `${book?.duplicateSnapshotCount ?? 0} snapshot تکراری با sequence/timestamp یکسان حذف شد.` },
    { labelFa: 'عمق معتبر', passed: !!book && isFiniteNumber(book.obi) && isFiniteNumber(book.bidDepthUsd) && isFiniteNumber(book.askDepthUsd) && book.bidDepthUsd + book.askDepthUsd > 0 && book.levelsCount > 0, detailFa: valid ? `${book!.levelsCount} سطح` : 'عمق/عدم‌تعادل دفتر سفارش ناقص است.' },
  ];
  if (!valid || !book || !sourceFreshness || !feed || !isFiniteNumber(book.obi)) {
    return abstain(member, 'بدون OBI و عمق معتبر از دفتر سفارش تازه، رأی صادر نمی‌شود.', checks, sourceFreshness?.timestampMs, sourceFreshness?.ageMs);
  }

  const vote: CouncilVote = book.obi >= 0.05 ? 'LONG' : book.obi <= -0.05 ? 'SHORT' : 'NEUTRAL';
  return createVote(
    member,
    vote,
    `رأی فقط بر پایه OBI زنده (${book.obi.toFixed(3)}) و عمق ثبت‌شده است؛ امتیازهای تخمینی نقدینگی شمرده نشده‌اند.`,
    checks,
    {
      sourceTimestampMs: sourceFreshness.timestampMs,
      sourceAgeMs: sourceFreshness.ageMs,
      dataQualityPct: feed.feed.score,
      confidencePct: confidenceForStrength(Math.min(35, Math.abs(book.obi) * 100)),
    }
  );
}

function evaluateDerivatives(
  member: CouncilMemberDefinition,
  analysis: Partial<AnalysisResult> | null | undefined,
  nowMs: number
): CouncilMemberVote {
  const feed = getFreshFeed(analysis?.dataQualityReport, 'derivatives', nowMs, 60_000);
  const fundingRate = analysis?.fundingRate ?? analysis?.funding;
  const hasOpenInterest = isFiniteNumber(analysis?.oi) && analysis.oi > 0;
  const derivativeObservations = deduplicateDerivativeObservations([
    ...(isFiniteNumber(analysis?.signalDataTimestamps?.fundingRateMs)
      ? [{
        venue: analysis?.dataQualityReport?.feeds.derivatives.source ?? 'unknown',
        symbol: analysis?.canonicalSnapshot?.symbol ?? 'BTCUSDT',
        timestampMs: analysis!.signalDataTimestamps!.fundingRateMs!,
        dataType: 'funding' as const,
      }]
      : []),
    ...(isFiniteNumber(analysis?.signalDataTimestamps?.openInterestMs)
      ? [{
        venue: analysis?.dataQualityReport?.feeds.derivatives.source ?? 'unknown',
        symbol: analysis?.canonicalSnapshot?.symbol ?? 'BTCUSDT',
        timestampMs: analysis!.signalDataTimestamps!.openInterestMs!,
        dataType: 'open-interest' as const,
      }]
      : []),
  ]);
  const fundingFreshness = freshTimestamp(
    analysis?.signalDataTimestamps?.fundingRateMs,
    analysis?.signalDataTimestamps?.fundingRateMs === undefined ||
      analysis.signalDataTimestamps.fundingRateMs === null
      ? null
      : nowMs - analysis.signalDataTimestamps.fundingRateMs,
    nowMs,
    60_000,
  );
  const openInterestFreshness = freshTimestamp(
    analysis?.signalDataTimestamps?.openInterestMs,
    analysis?.signalDataTimestamps?.openInterestMs === undefined ||
      analysis.signalDataTimestamps.openInterestMs === null
      ? null
      : nowMs - analysis.signalDataTimestamps.openInterestMs,
    nowMs,
    10_000,
  );
  const valid = feed !== null &&
    isFiniteNumber(fundingRate) &&
    fundingFreshness !== null &&
    hasOpenInterest &&
    openInterestFreshness !== null;
  const checks = [
    { labelFa: 'فید مشتقات زنده و تازه', passed: feed !== null, detailFa: feed ? `${Math.round(feed.ageMs)}ms` : 'فید مشتقات زنده/تازه تأیید نشد.' },
    { labelFa: 'Funding معتبر و تازه', passed: isFiniteNumber(fundingRate) && fundingFreshness !== null, detailFa: fundingFreshness && isFiniteNumber(fundingRate) ? `Funding: ${fundingRate}؛ سن ${Math.round(fundingFreshness.ageMs)}ms` : 'Funding فاقد timestamp مستقل و تازه است.' },
    { labelFa: 'Open Interest معتبر و تازه', passed: hasOpenInterest && openInterestFreshness !== null, detailFa: openInterestFreshness && hasOpenInterest ? `OI: ${analysis!.oi}؛ سن ${Math.round(openInterestFreshness.ageMs)}ms` : 'OI فاقد timestamp مستقل و تازه است.' },
    { labelFa: 'مشاهدات مشتقات یکتا', passed: !derivativeObservations.conflictingIdentity, detailFa: `${derivativeObservations.values.length} مشاهدهٔ یکتا؛ ${derivativeObservations.duplicateCount} تکراری حذف شد.` },
  ];
  if (
    !valid ||
    derivativeObservations.conflictingIdentity ||
    !feed ||
    !fundingFreshness ||
    !openInterestFreshness ||
    !isFiniteNumber(fundingRate)
  ) {
    return abstain(member, 'بدون Funding، OI و فید تازه مشتقات، رأی صادر نمی‌شود.', checks, feed?.feed.timestamp, feed?.ageMs);
  }

  const vote: CouncilVote = fundingRate >= 0.00015
    ? 'SHORT'
    : fundingRate <= -0.00015
      ? 'LONG'
      : 'NEUTRAL';
  const fundingPct = fundingRate * 100;
  return createVote(
    member,
    vote,
    `برداشت از ازدحام Funding (${fundingPct.toFixed(4)}٪) با OI معتبر است؛ Funding به‌تنهایی پیش‌بینی جهت قیمت تلقی نمی‌شود.`,
    checks,
    {
      sourceTimestampMs: Math.min(fundingFreshness.timestampMs, openInterestFreshness.timestampMs),
      sourceAgeMs: Math.max(fundingFreshness.ageMs, openInterestFreshness.ageMs),
      dataQualityPct: feed.feed.score,
      confidencePct: confidenceForStrength(Math.min(30, Math.abs(fundingRate) * 100_000)),
    }
  );
}

function evaluateOptions(
  member: CouncilMemberDefinition,
  options: CouncilOptionsData | null | undefined,
  nowMs: number
): CouncilMemberVote {
  const sourceFreshness = options
    ? freshTimestamp(options.timestampMs, options.ageMs, nowMs, MAX_OPTIONS_AGE_MS)
    : null;
  const valid = !!options &&
    options.status === 'LIVE' &&
    sourceFreshness !== null &&
    isFiniteNumber(options.qualityPct) &&
    options.qualityPct >= 80 &&
    options.qualityPct <= 100 &&
    isFiniteNumber(options.contractsCount) &&
    options.contractsCount >= 20 &&
    typeof options.provider === 'string' &&
    options.provider.length > 0 &&
    isFiniteNumber(options.impliedVolatilityPct) &&
    options.impliedVolatilityPct >= 0 &&
    isFiniteNumber(options.putCallRatio) &&
    options.putCallRatio > 0 &&
    isFiniteNumber(options.expiryTimestampMs) &&
    options.expiryTimestampMs > nowMs &&
    options.expiryTimestampMs <= 8_640_000_000_000_000 &&
    isFiniteNumber(options.strikePrice) &&
    options.strikePrice > 0 &&
    isFiniteNumber(options.skewPct);
  const checks = [
    { labelFa: 'فید اختیار معامله', passed: !!options && options.status === 'LIVE', detailFa: options ? `${options.provider ?? 'منبع نامشخص'}؛ وضعیت: ${options.status}` : 'فید اختیار معامله به سیستم متصل نیست.' },
    { labelFa: 'تازگی و کیفیت منبع', passed: sourceFreshness !== null && !!options && isFiniteNumber(options.qualityPct) && options.qualityPct >= 80 && isFiniteNumber(options.contractsCount) && options.contractsCount >= 20, detailFa: sourceFreshness && options ? `${Math.round(sourceFreshness.ageMs)}ms؛ کیفیت ${options.qualityPct}/100؛ قرارداد معتبر ${options.contractsCount ?? 0}` : 'زمان/کیفیت معتبر برای منبع موجود نیست.' },
    { labelFa: 'نوسان ضمنی', passed: !!options && isFiniteNumber(options.impliedVolatilityPct) && options.impliedVolatilityPct >= 0, detailFa: options && isFiniteNumber(options.impliedVolatilityPct) ? `IV: ${options.impliedVolatilityPct}%` : 'IV معتبر موجود نیست.' },
    { labelFa: 'Put/Call معتبر', passed: !!options && isFiniteNumber(options.putCallRatio) && options.putCallRatio > 0, detailFa: options && isFiniteNumber(options.putCallRatio) ? `Put/Call: ${options.putCallRatio}` : 'نسبت معتبر Put/Call موجود نیست.' },
    { labelFa: 'سررسید، Strike و Skew', passed: !!options && isFiniteNumber(options.expiryTimestampMs) && options.expiryTimestampMs > nowMs && isFiniteNumber(options.strikePrice) && options.strikePrice > 0 && isFiniteNumber(options.skewPct), detailFa: options && isFiniteNumber(options.expiryTimestampMs) && isFiniteNumber(options.strikePrice) && isFiniteNumber(options.skewPct) ? `سررسید ${new Date(options.expiryTimestampMs).toISOString()}؛ Strike ${options.strikePrice}؛ Skew ${options.skewPct}%` : 'سررسید/Strike/Skew معتبر موجود نیست.' },
  ];
  if (!valid || !options || !sourceFreshness || !isFiniteNumber(options.putCallRatio) || !isFiniteNumber(options.impliedVolatilityPct)) {
    return abstain(member, 'داده تازه و معتبر IV، Put/Call، Strike و سررسید اختیار معامله کامل نیست؛ عضو از ساختن تحلیل خودداری کرد.', checks, sourceFreshness?.timestampMs, sourceFreshness?.ageMs);
  }

  const vote: CouncilVote = options.putCallRatio > 1.2
    ? 'SHORT'
    : options.putCallRatio < 0.8
      ? 'LONG'
      : 'NEUTRAL';
  return createVote(
    member,
    vote,
    `رأی مبتنی بر نسبت OI اختیار فروش به خرید (${options.putCallRatio.toFixed(2)}) از ${options.provider ?? 'منبع نامشخص'} است؛ IV ${options.impliedVolatilityPct}%، Skew ${options.skewPct}% و ${options.contractsCount ?? 'تعداد نامشخص'} قرارداد معتبر ثبت شد. نسبت اختیارها ممکن است پوشش ریسک باشد و به‌تنهایی اثبات جهت نیست.`,
    checks,
    {
      sourceTimestampMs: sourceFreshness.timestampMs,
      sourceAgeMs: sourceFreshness.ageMs,
      dataQualityPct: options.qualityPct,
      confidencePct: confidenceForStrength(Math.min(25, Math.abs(options.putCallRatio - 1) * 50)),
    }
  );
}

function evaluateOnChain(
  member: CouncilMemberDefinition,
  macro: CouncilMacroContext | null | undefined,
  nowMs: number,
  directWhaleFlow?: CouncilWhaleFlowData,
): CouncilMemberVote {
  if (directWhaleFlow?.largeTransfers) {
    const freshness = freshTimestamp(
      directWhaleFlow.timestampMs,
      directWhaleFlow.ageMs,
      nowMs,
      MAX_PUBLIC_ONCHAIN_AGE_MS,
    );
    const eligibleTransfers = directWhaleFlow.largeTransfers.filter((transfer) =>
      transfer.confirmationStatus === 'CONFIRMED' &&
      transfer.blockchain.length > 0 &&
      transfer.transactionHash.length > 0 &&
      transfer.amount > 0 &&
      Number.isFinite(transfer.timestampMs) &&
      transfer.timestampMs <= nowMs &&
      nowMs - transfer.timestampMs <= MAX_PUBLIC_ONCHAIN_AGE_MS
    );
    const identifiedTransfers = deduplicateOnChainTransfers(eligibleTransfers);
    const confirmedTransfers = identifiedTransfers.values.filter((transfer) =>
      Boolean(transfer.transferId?.trim())
    );
    const missingTransferIdentity = eligibleTransfers.some((transfer) =>
      !transfer.transferId?.trim()
    );
    const usable = directWhaleFlow.status === 'LIVE' &&
      freshness !== null &&
      directWhaleFlow.coverageStatus === 'SAMPLED';
    const checks = [
      {
        labelFa: 'اعتبار دادهٔ بلوک‌های نمونه‌برداری‌شده',
        passed: usable,
        detailFa: usable
          ? confirmedTransfers.length > 0
            ? `${confirmedTransfers.length} انتقال بزرگ تأییدشده؛ دادهٔ خام بدون انتساب مالکیت کیف‌پول`
            : 'نمونهٔ تازه معتبر است؛ در بلوک‌های بررسی‌شده انتقال بزرگِ واجد آستانه پیدا نشد.'
          : directWhaleFlow.unavailableReason ?? 'تراکنش بزرگِ تأییدشده و تازه برای تحلیل جهت‌دار موجود نیست.',
      },
      {
        labelFa: 'تازگی و پوشش provider',
        passed: freshness !== null && directWhaleFlow.coverageStatus !== 'UNAVAILABLE',
        detailFa: freshness
          ? `${Math.round(freshness.ageMs / 60_000)} دقیقه؛ پوشش ${directWhaleFlow.coverageStatus ?? 'نامشخص'}`
          : 'منبع قدیمی یا زمان‌نامعتبر است.',
      },
      {
        labelFa: 'انتساب مالکیت یا جهت جریان',
        passed: false,
        detailFa: 'آدرس‌ها ناشناس‌اند؛ ورود، خروج، خرید یا فروش استنباط نمی‌شود.',
      },
      {
        labelFa: 'شناسهٔ یکتای انتقال',
        passed: !identifiedTransfers.conflictingIdentity && !missingTransferIdentity,
        detailFa: identifiedTransfers.conflictingIdentity
          ? 'برای یک blockchain/txid/logIndex یا vout مقادیر متناقض دریافت شد.'
          : missingTransferIdentity
            ? 'حداقل یک انتقال فاقد logIndex/vout پایدار است و برای رأی قابل‌شمارش نیست.'
            : `${identifiedTransfers.duplicateCount} انتقال تکراری از چند provider حذف شد.`,
      },
    ];
    if (!usable || !freshness || identifiedTransfers.conflictingIdentity || missingTransferIdentity) {
      return abstain(member, directWhaleFlow.unavailableReason ?? 'شواهد آن‌چین تازه و تأییدشده برای رأی معتبر کافی نیست.', checks, freshness?.timestampMs, freshness?.ageMs);
    }
    if (confirmedTransfers.length === 0) {
      return createVote(
        member,
        'NEUTRAL',
        'در بلوک‌های تازه و نمونه‌برداری‌شده انتقال بزرگِ واجد آستانه مشاهده نشد؛ این فقط نبود رویداد نهنگی در نمونهٔ محدود است، نه اثبات آرامش کل شبکه یا نبود فشار فروش.',
        checks,
        {
          sourceTimestampMs: freshness.timestampMs,
          sourceAgeMs: freshness.ageMs,
          dataQualityPct: directWhaleFlow.qualityPct,
          confidencePct: 0,
        },
      );
    }
    return createVote(
      member,
      'NEUTRAL',
      `در ${confirmedTransfers.length} تراکنش بزرگ ${confirmedTransfers.map(({ blockchain, asset, amount, estimatedUsd }) =>
        `${blockchain} ${amount} ${asset}${estimatedUsd === null ? '' : ` (حدود $${Math.round(estimatedUsd).toLocaleString('en-US')})`}`
      ).join('، ')} مشاهده شد. تراکنش زنجیره‌ای به‌تنهایی هویت مالک یا قصد خریدوفروش را ثابت نمی‌کند؛ رأی جهت‌دار صادر نمی‌شود.`,
      checks,
      {
        sourceTimestampMs: freshness.timestampMs,
        sourceAgeMs: freshness.ageMs,
        dataQualityPct: directWhaleFlow.qualityPct,
        confidencePct: 0,
      },
    );
  }
  if (directWhaleFlow) {
    const freshness = freshTimestamp(
      directWhaleFlow.timestampMs,
      directWhaleFlow.ageMs,
      nowMs,
      MAX_ONCHAIN_AGE_MS,
    );
    const valid = directWhaleFlow.status === 'LIVE' &&
      freshness !== null &&
      directWhaleFlow.qualityPct >= 80 &&
      isFiniteNumber(directWhaleFlow.netExchangeFlowBtc) &&
      directWhaleFlow.transactionCount > 0;
    const checks = [
      {
        labelFa: 'برچسب‌گذاری جریان صرافی',
        passed: valid,
        detailFa: valid
          ? `${directWhaleFlow.provider}؛ ${directWhaleFlow.transactionCount} انتقال برچسب‌خورده`
          : `${directWhaleFlow.provider}؛ داده/انتساب کافی برای رأی معتبر نیست.`,
      },
      {
        labelFa: 'تازگی داده زنجیره‌ای',
        passed: freshness !== null,
        detailFa: freshness ? `${Math.round(freshness.ageMs / 60_000)} دقیقه` : 'زمان منبع کهنه یا نامعتبر است.',
      },
    ];
    if (!valid || !freshness || !isFiniteNumber(directWhaleFlow.netExchangeFlowBtc)) {
      return abstain(member, 'بدون جریان تازه و برچسب‌خوردهٔ صرافی از انتقال‌های بزرگ BTC، رأی آن‌چین صادر نمی‌شود.', checks, freshness?.timestampMs, freshness?.ageMs);
    }

    const netflow = directWhaleFlow.netExchangeFlowBtc;
    const vote: CouncilVote = 'NEUTRAL';
    return createVote(
      member,
      vote,
      `در دادهٔ ${directWhaleFlow.provider} جریان خالص منتسب به صرافی ${netflow.toFixed(4)} BTC دیده شد؛ این انتقال‌ها جهت معامله را اثبات نمی‌کنند و رأی جهت‌دار صادر نمی‌شود.`,
      checks,
      {
        sourceTimestampMs: freshness.timestampMs,
        sourceAgeMs: freshness.ageMs,
        dataQualityPct: directWhaleFlow.qualityPct,
        confidencePct: confidenceForStrength(Math.min(25, Math.abs(netflow) * 10)),
      },
    );
  }

  const freshness = getMacroAge(macro, nowMs, MAX_ONCHAIN_AGE_MS);
  const hasFlow = macro?.whaleFlowStatus === 'LIVE' &&
    isFiniteNumber(macro.whaleNetflowBtc) &&
    macro.whaleSentiment !== null &&
    macro.whaleSentiment !== 'UNKNOWN';
  const checks = [
    { labelFa: 'منبع آن‌چین زنده', passed: hasFlow, detailFa: hasFlow ? 'جریان و برچسب احساسات نهنگ در منبع زنده موجود است.' : 'داده جریان/رفتار کیف‌پول معتبر موجود نیست.' },
    { labelFa: 'تازگی داده آن‌چین', passed: freshness !== null, detailFa: freshness ? `${Math.round(freshness.ageMs / 1000)}s` : 'زمان به‌روزرسانی معتبر یا تازه نیست.' },
  ];
  if (!hasFlow || !freshness || !macro) {
    return abstain(member, 'بدون جریان آن‌چین زنده و زمان‌دار، این عضو رأی نمی‌دهد.', checks, freshness?.timestampMs, freshness?.ageMs);
  }

  const vote: CouncilVote = macro.whaleSentiment === 'ACCUMULATION'
    ? 'LONG'
    : macro.whaleSentiment === 'DISTRIBUTION'
      ? 'SHORT'
      : 'NEUTRAL';
  return createVote(
    member,
    vote,
    `برچسب جریان آن‌چین ${macro.whaleSentiment} و خالص جریان ${macro.whaleNetflowBtc} BTC از منبع تأییدشده دریافت شد.`,
    checks,
    { sourceTimestampMs: freshness.timestampMs, sourceAgeMs: freshness.ageMs }
  );
}

function evaluateMacro(
  member: CouncilMemberDefinition,
  macro: CouncilMacroContext | null | undefined,
  nowMs: number,
  directMacroData?: FreeMacroDataResult,
): CouncilMemberVote {
  const directSignals: Array<{
    label: string;
    provider: string;
    metric: string;
    direction: -1 | 0 | 1;
    timestampMs: number;
  }> = [];
  const sp500 = directMacroData?.sp500;
  if (isFreshDirectMacroMetric(sp500, nowMs) && isFiniteNumber(sp500.changePct)) {
    directSignals.push({
      label: 'S&P 500',
      provider: sp500.provider,
      metric: sp500.metric,
      direction: sp500.changePct >= 0.1 ? 1 : sp500.changePct <= -0.1 ? -1 : 0,
      timestampMs: sp500.observedAtMs,
    });
  }

  const dxy = directMacroData?.dxy;
  const freshDxy = isFreshDirectMacroMetric(dxy, nowMs, MAX_DXY_AGE_MS) &&
    isFiniteNumber(dxy.changePct);
  if (freshDxy) {
    directSignals.push({
      label: 'شاخص واقعی DXY',
      provider: dxy.provider,
      metric: dxy.metric,
      direction: dxy.changePct >= 0.05 ? -1 : dxy.changePct <= -0.05 ? 1 : 0,
      timestampMs: dxy.observedAtMs,
    });
  } else {
    const dxyProxy = directMacroData?.dxyProxy;
    const freshTradingViewProxy = isFreshDirectMacroMetric(
      dxyProxy,
      nowMs,
      5_000,
    ) && isFiniteNumber(dxyProxy.changePct) &&
      dxyProxy.provider.includes('TradingView public Scanner') &&
      dxyProxy.metric.includes('not official ICE DXY');
    if (freshTradingViewProxy) {
      directSignals.push({
        label: 'TradingView TVC:DXY (CFD proxy؛ زمان دریافت، نه timestamp منبع)',
        provider: dxyProxy.provider,
        metric: dxyProxy.metric,
        direction: dxyProxy.changePct >= 0.05 ? -1 : dxyProxy.changePct <= -0.05 ? 1 : 0,
        timestampMs: dxyProxy.observedAtMs,
      });
    } else {
      const broadDollar = directMacroData?.broadDollar;
      if (isFreshDirectMacroMetric(broadDollar, nowMs) && isFiniteNumber(broadDollar.changePct)) {
        directSignals.push({
          label: 'دلار گستردهٔ فدرال رزرو (proxy، نه DXY)',
          provider: broadDollar.provider,
          metric: broadDollar.metric,
          direction: broadDollar.changePct >= 0.05 ? -1 : broadDollar.changePct <= -0.05 ? 1 : 0,
          timestampMs: broadDollar.observedAtMs,
        });
      }
    }
  }

  const freshFedRates = [
    directMacroData?.fedEffectiveRate,
    directMacroData?.fedTargetUpperBound,
  ].filter((metric) => isFreshDirectMacroMetric(metric, nowMs) &&
    isFiniteNumber(metric.previousValue));
  if (freshFedRates.length > 0) {
    const averageRateChange = freshFedRates.reduce(
      (sum, metric) => sum + metric.value - metric.previousValue!,
      0,
    ) / freshFedRates.length;
    directSignals.push({
      label: 'نرخ‌های منتشرشدهٔ فدرال رزرو',
      provider: [...new Set(freshFedRates.map(({ provider }) => provider))].sort().join('+'),
      metric: [...new Set(freshFedRates.map(({ metric }) => metric))].sort().join('+'),
      direction: averageRateChange >= 0.01 ? -1 : averageRateChange <= -0.01 ? 1 : 0,
      timestampMs: Math.max(...freshFedRates.map((metric) => metric.observedAtMs)),
    });
  }

  const macroDeduplication = deduplicateMacroObservations(directSignals.map((signal) => ({
    ...signal,
  })));
  const uniqueDirectSignals = macroDeduplication.values;
  const conflictingDirectSignalIdentity = macroDeduplication.conflictingIdentity;

  if (conflictingDirectSignalIdentity) {
    return abstain(
      member,
      'یک منبع برای همان شاخص و timestamp مقادیر متناقض فرستاده است؛ عضو کلان ممتنع می‌شود.',
      [{
        labelFa: 'تعارض شناسهٔ شاخص کلان',
        passed: false,
        detailFa: 'یک شناسهٔ منبع/زمان جهت‌های متناقض ارائه کرده است.',
      }],
      Math.max(...directSignals.map(({ timestampMs }) => timestampMs)),
      null,
    );
  }

  if (uniqueDirectSignals.length >= 2) {
    const score = uniqueDirectSignals.reduce((sum, signal) => sum + signal.direction, 0);
    const vote: CouncilVote = score >= 2 ? 'LONG' : score <= -2 ? 'SHORT' : 'NEUTRAL';
    const sourceTimestampMs = Math.max(...uniqueDirectSignals.map((signal) => signal.timestampMs));
    return createVote(
      member,
      vote,
      `رأی از ${uniqueDirectSignals.length} شاخص مستقیم و تازه گرفته شد: ${uniqueDirectSignals.map(({ label, direction }) => `${label} (${direction > 0 ? 'صعودی' : direction < 0 ? 'نزولی' : 'خنثی'})`).join('، ')}؛ شاخص یا proxy با نام و نوع واقعی خودش گزارش شده است.`,
      [
        {
          labelFa: 'تازگی منابع کلان مستقیم',
          passed: true,
          detailFa: uniqueDirectSignals.map(({ label, timestampMs }) => `${label}: ${Math.round((nowMs - timestampMs) / 60_000)} دقیقه`).join('؛ '),
        },
        {
          labelFa: 'تعداد شاخص‌های مستقیم معتبر',
          passed: true,
          detailFa: `${uniqueDirectSignals.length} شاخص مستقیم یکتا: ${uniqueDirectSignals.map(({ label }) => label).join('، ')}`,
        },
        {
          labelFa: 'تعارض شناسهٔ شاخص کلان',
          passed: !conflictingDirectSignalIdentity,
          detailFa: conflictingDirectSignalIdentity
            ? 'یک منبع/زمان برای شاخص کلان جهت‌های متناقض ارائه کرده است.'
            : 'برای یک شاخص و timestamp، مشاهدهٔ متناقضی وجود ندارد.',
        },
      ],
      {
        sourceTimestampMs,
        sourceAgeMs: nowMs - sourceTimestampMs,
        dataQualityPct: Math.round(Math.min(uniqueDirectSignals.length, 3) / 3 * 100),
        confidencePct: confidenceForStrength(Math.min(30, Math.abs(score) * 10)),
      },
    );
  }

  const contextSignals: Array<{ label: string; direction: -1 | 0 | 1; timestampMs: number }> = [];
  const sp500TimestampMs = getMacroSourceTimestamp(macro, 'sp500DailyChangePct', nowMs);
  if (
    macro?.sp500Status === 'LIVE' &&
    isFiniteNumber(macro.sp500DailyChangePct) &&
    sp500TimestampMs !== null
  ) {
    contextSignals.push({
      label: 'S&P 500',
      direction: macro.sp500DailyChangePct >= 0.1 ? 1 : macro.sp500DailyChangePct <= -0.1 ? -1 : 0,
      timestampMs: sp500TimestampMs,
    });
  }
  const dxyTimestampMs = getMacroSourceTimestamp(macro, 'dxyIndex', nowMs, MAX_DXY_AGE_MS);
  if (
    macro?.dxyStatus === 'LIVE' &&
    isFiniteNumber(macro.dxyDailyChangePct) &&
    dxyTimestampMs !== null
  ) {
    contextSignals.push({
      label: 'شاخص واقعی DXY',
      direction: macro.dxyDailyChangePct >= 0.05
        ? -1
        : macro.dxyDailyChangePct <= -0.05
          ? 1
          : 0,
      timestampMs: dxyTimestampMs,
    });
  }
  const dollarTimestampMs = getMacroSourceTimestamp(macro, 'broadDollarProxy', nowMs);
  if (
    contextSignals.every(({ label }) => label !== 'شاخص واقعی DXY') &&
    (macro?.broadDollarProxyStatus === 'LIVE' || macro?.broadDollarProxyStatus === 'PROXY') &&
    isFiniteNumber(macro.broadDollarProxyDailyChangePct) &&
    dollarTimestampMs !== null
  ) {
    contextSignals.push({
      label: 'دلار گستردهٔ فدرال رزرو (proxy، نه DXY)',
      direction: macro.broadDollarProxyDailyChangePct >= 0.05
        ? -1
        : macro.broadDollarProxyDailyChangePct <= -0.05
          ? 1
          : 0,
      timestampMs: dollarTimestampMs,
    });
  }
  if (contextSignals.length >= 2) {
    const score = contextSignals.reduce((sum, signal) => sum + signal.direction, 0);
    const vote: CouncilVote = score >= 2 ? 'LONG' : score <= -2 ? 'SHORT' : 'NEUTRAL';
    const sourceTimestampMs = Math.max(...contextSignals.map((signal) => signal.timestampMs));
    return createVote(
      member,
      vote,
      `رأی از ${contextSignals.length} شاخص مستقیم و تازهٔ زمینهٔ کلان گرفته شد: ${contextSignals.map(({ label, direction }) => `${label} (${direction > 0 ? 'صعودی' : direction < 0 ? 'نزولی' : 'خنثی'})`).join('، ')}؛ proxy دلار به‌جای DXY معرفی نشده است.`,
      [
        {
          labelFa: 'تازگی منابع کلان مستقیم',
          passed: true,
          detailFa: contextSignals.map(({ label, timestampMs }) => `${label}: ${Math.round((nowMs - timestampMs) / 60_000)} دقیقه`).join('؛ '),
        },
        {
          labelFa: 'تعداد شاخص‌های مستقیم معتبر',
          passed: true,
          detailFa: `${contextSignals.length} شاخص زمینه‌ای؛ استقلال providerها در این شمارش ادعا نمی‌شود: ${contextSignals.map(({ label }) => label).join('، ')}`,
        },
      ],
      {
        sourceTimestampMs,
        sourceAgeMs: nowMs - sourceTimestampMs,
        dataQualityPct: Math.round(Math.min(contextSignals.length, 3) / 3 * 100),
        confidencePct: confidenceForStrength(Math.min(30, Math.abs(score) * 10)),
      },
    );
  }

  const freshness = getMacroAge(macro, nowMs, MAX_MACRO_AGE_MS);
  const liveIndicatorCount = [
    macro?.sp500Status === 'LIVE' && isFiniteNumber(macro.sp500DailyChangePct),
    macro?.dxyStatus === 'LIVE' &&
      isFiniteNumber(macro.dxyDailyChangePct) &&
      getMacroSourceTimestamp(macro, 'dxyIndex', nowMs, MAX_DXY_AGE_MS) !== null,
    macro?.etfFlowStatus === 'LIVE' && isFiniteNumber(macro.spotEtfNetInflowMillionUsd),
  ].filter(Boolean).length;
  const hasBias = macro?.overallDataStatus === 'LIVE' &&
    macro.fundamentalBias !== 'UNAVAILABLE' &&
    liveIndicatorCount >= 2;
  const checks = [
    { labelFa: 'تازگی داده کلان', passed: freshness !== null, detailFa: freshness ? `${Math.round(freshness.ageMs / 60_000)} دقیقه` : 'داده کلان قدیمی یا زمان‌نامعتبر است.' },
    { labelFa: 'پوشش مستقل شاخص‌ها', passed: liveIndicatorCount >= 2, detailFa: `${liveIndicatorCount} شاخص زنده از SP500، DXY و ETF` },
    { labelFa: 'نتیجه ارزیابی کلان', passed: hasBias, detailFa: hasBias ? `سوگیری: ${macro!.fundamentalBias}` : 'سوگیری کلان معتبر و پوشش کافی وجود ندارد.' },
  ];
  if (!macro || !freshness || !hasBias) {
    return createVote(
      member,
      'ABSTAIN',
      'برای رأی کلان، داده تازه، نتیجه معتبر و دست‌کم دو شاخص زنده لازم است.',
      checks,
      {
        sourceTimestampMs: freshness?.timestampMs,
        sourceAgeMs: freshness?.ageMs,
        dataQualityPct: Math.round(liveIndicatorCount / 3 * 100),
      },
    );
  }

  const vote: CouncilVote = macro.fundamentalBias === 'BULLISH'
    ? 'LONG'
    : macro.fundamentalBias === 'BEARISH'
      ? 'SHORT'
      : 'NEUTRAL';
  return createVote(
    member,
    vote,
    `سوگیری کلان ${macro.fundamentalBias} با پوشش ${liveIndicatorCount} شاخص زنده دریافت شد.`,
    checks,
    {
      sourceTimestampMs: freshness.timestampMs,
      sourceAgeMs: freshness.ageMs,
      dataQualityPct: Math.round(liveIndicatorCount / 3 * 100),
    }
  );
}

function evaluateNews(
  member: CouncilMemberDefinition,
  macro: CouncilMacroContext | null | undefined,
  nowMs: number
): CouncilMemberVote {
  const freshness = getMacroAge(macro, nowMs, MAX_NEWS_AGE_MS);
  const newsDeduplication = deduplicateNews(macro?.recentHeadlines ?? []);
  const uniqueHeadlines = newsDeduplication.values;
  const freshHeadlines = uniqueHeadlines.filter((headline) => {
    const publishedAt = Date.parse(headline.publishedAt);
    const ageMs = nowMs - publishedAt;
    return Number.isFinite(publishedAt) && ageMs >= 0 && ageMs <= MAX_NEWS_AGE_MS;
  });
  const hasLiveSentiment = macro?.newsSentimentStatus === 'LIVE' &&
    isFiniteNumber(macro.newsSentimentScore) &&
    macro.newsHeadlinesStatus === 'LIVE' &&
    freshHeadlines.length > 0;
  const independentPublisherCount = new Set(
    freshHeadlines.map((headline) => headline.source.trim().toLowerCase()).filter(Boolean),
  ).size;
  const hasSufficientCoverage = freshHeadlines.length >= 3 &&
    independentPublisherCount >= 2;
  const latestFreshHeadline = freshHeadlines.reduce<number | null>((latest, headline) => {
    const publishedAtMs = Date.parse(headline.publishedAt);
    return Math.max(latest ?? 0, publishedAtMs);
  }, null);
  const headlinesAreFresh = latestFreshHeadline !== null;
  const dataQualityPct = hasLiveSentiment
    ? Math.round(
        Math.min(freshHeadlines.length, 10) / 10 * 60 +
        Math.min(independentPublisherCount, 4) / 4 * 40,
      )
    : 0;
  const checks = [
    { labelFa: 'پوشش ناشران مستقل', passed: hasSufficientCoverage, detailFa: hasSufficientCoverage ? `${freshHeadlines.length} خبر یکتای تازه از ${independentPublisherCount} ناشر` : `حداقل ۳ خبر یکتای تازه از ۲ ناشر لازم است؛ اکنون ${freshHeadlines.length} خبر از ${independentPublisherCount} ناشر موجود است.` },
    { labelFa: 'حذف خبرهای تکراری و هم‌معنی', passed: true, detailFa: `${newsDeduplication.duplicateCount} خبر تکراری/هم‌معنی از URLهای متفاوت ادغام شد.` },
    { labelFa: 'ناشر و خبر معتبر', passed: hasLiveSentiment, detailFa: hasLiveSentiment ? `${freshHeadlines.length} خبر یکتای تازه و امتیاز سنتیمنت زنده` : 'خبر معتبر یا امتیاز سنتیمنت زنده در دسترس نیست.' },
    { labelFa: 'تازگی خبر و داده', passed: freshness !== null && headlinesAreFresh, detailFa: freshness && latestFreshHeadline !== null ? `${Math.round((nowMs - latestFreshHeadline) / 60_000)} دقیقه از انتشار آخرین خبر` : 'زمان خبر/داده کهنه یا نامعتبر است.' },
  ];
  if (!macro || !hasLiveSentiment || !hasSufficientCoverage || !freshness || !headlinesAreFresh || !isFiniteNumber(macro.newsSentimentScore)) {
    return createVote(
      member,
      'ABSTAIN',
      'خبر تازه از چند ناشر مستقل همراه با سنتیمنت تأییدشده موجود نیست؛ شایعه یا شمار پست‌ها رأی محسوب نمی‌شود.',
      checks,
      {
        sourceTimestampMs: freshness?.timestampMs,
        sourceAgeMs: freshness?.ageMs,
        dataQualityPct,
      },
    );
  }

  const score = macro.newsSentimentScore;
  const vote: CouncilVote = score >= 10 ? 'LONG' : score <= -10 ? 'SHORT' : 'NEUTRAL';
  return createVote(
    member,
    vote,
    `امتیاز سنتیمنت خبر معتبر ${score} است؛ آستانه رأی جهت‌دار ±۱۰ است.`,
    checks,
    {
      sourceTimestampMs: latestFreshHeadline,
      sourceAgeMs: nowMs - latestFreshHeadline,
      dataQualityPct,
      confidencePct: confidenceForStrength(Math.min(30, Math.abs(score) / 2)),
    }
  );
}

export function validateCouncilModuleOwnership(
  members: readonly CouncilMemberDefinition[] = EIGHT_MEMBER_COUNCIL
): string[] {
  const owners = new Map<string, number>();
  const duplicated: string[] = [];
  const ownershipGroups: (readonly string[])[] = [
    ...members.flatMap((member) => [[...member.inputIds], [...member.moduleIds]]),
  ];
  if (members === EIGHT_MEMBER_COUNCIL) {
    ownershipGroups.push(
      COUNCIL_COORDINATOR_MODULES,
      CENTRAL_CONTROL_MODULES,
      UNWIRED_TRADE_MANAGEMENT_MODULES,
      UNWIRED_OR_LEGACY_ANALYSIS_MODULES
    );
  }
  for (const group of ownershipGroups) {
    for (const ownedId of group) {
      if (owners.has(ownedId)) duplicated.push(ownedId);
      else owners.set(ownedId, owners.size + 1);
    }
  }
  return duplicated;
}

export const COUNCIL_COORDINATOR_MODULES = ['sb.SB5'] as const;

export const CENTRAL_CONTROL_MODULES = [
  'control.holdingHorizonSelector',
  'control.postCouncilTradeController',
  'control.decisionPipeline',
  'control.riskAllocator',
  'control.positionSizer',
  'control.riskBasedLeverage',
  'control.contractValidator',
  'control.freqtradeSignalAdapter',
] as const;

export const UNWIRED_TRADE_MANAGEMENT_MODULES = [
  'brains.brain12ExecutionSniper',
  'brains.brain13AsymmetricProfitRunner',
  'brains.brain14LossToBreakeven',
  'brains.brain15FrequencyPreserver',
  'brains.brain16DrawdownLockout',
  'brains.brain17RapidTurnaround',
  'brains.brain18StagnantLiquidator',
  'brains.brain19LoadReallocator',
  'brains.brain20LatencyArbitrage',
  'brains.brain21StrategicRecovery',
  'sb.SB3',
  'sb.SB4',
] as const;

export const UNWIRED_OR_LEGACY_ANALYSIS_MODULES = [
  'pillars.AI_NEURAL',
  'pillars.HTF_TREND',
  'pillars.SMC_PRICE_ACTION',
  'pillars.TREND_RIBBON',
  'pillars.MOMENTUM_INDICATORS',
  'pillars.ORDER_BOOK_DERIVATIVES',
  'pillars.VOLATILITY_REGIME',
  'pillars.FUNDAMENTAL_MACRO_NEWS',
  'gates.RISK_ANTI_TILT',
  'news.shockFirewall',
] as const;

export function evaluateEightMemberCouncil(input: {
  analysis?: Partial<AnalysisResult> | null;
  macroContext?: CouncilMacroContext | null;
  directMacroData?: FreeMacroDataResult;
  optionsData?: CouncilOptionsData | null;
  whaleFlowData?: CouncilWhaleFlowData | null;
  supportingModules?: Readonly<Record<string, CouncilModuleEvidence>>;
  evidenceFingerprints?: Readonly<Record<number, string>>;
  previousMemberEvidence?: Readonly<Record<number, CouncilMemberEvidenceCacheEntry>>;
  nowMs?: number;
}): EightMemberCouncilReport {
  const nowMs = input.nowMs ?? Date.now();
  const members = EIGHT_MEMBER_COUNCIL;
  const evaluators = [
    () => evaluateTechnical(members[0], input.analysis, nowMs),
    () => evaluateTradeFlow(members[1], input.analysis, nowMs),
    () => evaluateOrderBook(members[2], input.analysis, nowMs),
    () => evaluateDerivatives(members[3], input.analysis, nowMs),
    () => evaluateOptions(members[4], input.optionsData, nowMs),
    () => evaluateOnChain(members[5], input.macroContext, nowMs, input.whaleFlowData ?? undefined),
    () => evaluateMacro(members[6], input.macroContext, nowMs, input.directMacroData),
    () => evaluateNews(members[7], input.macroContext, nowMs),
  ];
  const votes = evaluators.map((evaluate, index) => {
    const memberId = index + 1;
    return reuseCachedMemberVote(
      input.previousMemberEvidence?.[memberId],
      input.evidenceFingerprints?.[memberId],
      nowMs,
    ) ?? evaluate();
  }).map((vote) => ({
    ...vote,
    supportingEvidence: vote.moduleIds.map((moduleId) => input.supportingModules?.[moduleId] ?? {
      moduleId,
      nameFa: moduleId,
      status: 'UNAVAILABLE' as const,
      sourceTimestampMs: null,
      summaryFa: 'خروجی این ماژول هنوز به شورا نرسیده است؛ در رأی عضو دخالت ندارد.',
    }),
  }));
  const longVotes = votes.filter(({ vote }) => vote === 'LONG').length;
  const shortVotes = votes.filter(({ vote }) => vote === 'SHORT').length;
  const neutralVotes = votes.filter(({ vote }) => vote === 'NEUTRAL').length;
  const abstentions = votes.filter(({ vote }) => vote === 'ABSTAIN').length;
  const selectedDirection: CouncilDirection = longVotes >= 5
    ? 'LONG'
    : shortVotes >= 5
      ? 'SHORT'
      : null;
  const summaryFa = selectedDirection
    ? `شورا با ${selectedDirection === 'LONG' ? longVotes : shortVotes} رأی از ۸ عضو جهت ${selectedDirection} را انتخاب کرد؛ این نتیجه به‌تنهایی مجوز اجرای معامله نیست.`
    : `حدنصاب ۵ رأی از ۸ عضو حاصل نشد (LONG: ${longVotes}، SHORT: ${shortVotes}، خنثی: ${neutralVotes}، ممتنع: ${abstentions})؛ جهت انتخاب نشد.`;

  return {
    evaluatedAtMs: nowMs,
    quorumRequired: 5,
    members: votes,
    longVotes,
    shortVotes,
    neutralVotes,
    abstentions,
    selectedDirection,
    quorumMet: selectedDirection !== null,
    summaryFa,
  };
}
