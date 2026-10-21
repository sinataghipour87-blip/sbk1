import type { AnalysisResult, DataQualityReport, MarketFeedQuality } from '../types/trading';
import type { MacroCorrelationData } from './macroContextBrain';
import type { FreeMacroDataResult } from './freeMacroData';

export type CouncilVote = 'LONG' | 'SHORT' | 'NEUTRAL' | 'ABSTAIN';
export type CouncilDirection = 'LONG' | 'SHORT' | null;

export interface CouncilOptionsData {
  status: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  timestampMs: number | null;
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

export const EIGHT_MEMBER_COUNCIL: readonly CouncilMemberDefinition[] = [
  {
    id: 1,
    nameFa: 'تحلیلگر روند و ساختار قیمت',
    nameEn: 'Price Action & Technical Analysis',
    questionFa: 'ساختار و شواهد تکنیکال به کدام جهت متمایل‌اند؟',
    inputIds: ['analysis.candles', 'analysis.rsi', 'analysis.mtf1h', 'analysis.mtf4h', 'dataQualityReport.feeds.candles'],
    moduleIds: [
      'brains.brain01MacroTrend', 'brains.brain04PatternDivergence', 'brains.brain09BayesianProbabilistic',
      'technical.mtfStructuralReport',
      'sb.SB1', 'openSource.candlestickPatterns', 'openSource.marketRegime', 'openSource.marketAnomaly',
      'openSource.lightgbmForecast', 'openSource.xgboostForecast',
      'marketFallback.binanceCandles', 'marketFallback.crossExchangePrices.member1',
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
    inputIds: ['macroContext.fundamentalBias', 'macroContext.sp500DailyChangePct', 'macroContext.dxyDailyChangePct', 'macroContext.spotEtfNetInflowMillionUsd', 'macroSource.sp500', 'macroSource.dxy', 'macroSource.broadDollarProxy', 'macroSource.fedRates'],
    moduleIds: ['brains.brain08FundamentalMacro', 'macro.sp500', 'macro.dxy', 'macro.broadDollarProxy', 'macro.fedRates'],
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
const MAX_PUBLIC_ONCHAIN_AGE_MS = 20 * 60_000;
const MAX_MACRO_AGE_MS = 5 * 24 * 60 * 60_000;
const MAX_NEWS_AGE_MS = 24 * 60 * 60_000;
const MAX_DIRECT_MACRO_AGE_MS = 5 * 24 * 60 * 60_000;
const MAX_DXY_AGE_MS = 2 * 60_000;

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
  const feed = getFreshFeed(analysis?.dataQualityReport, 'candles', nowMs, 15_000);
  const candles = Array.isArray(analysis?.candles) ? analysis.candles : [];
  const closes = candles
    .map((candle) => candle.length >= 6 ? candle[4] : candle[3])
    .filter((close): close is number => isFiniteNumber(close) && close > 0);
  const hasCandles = candles.length >= 30 && closes.length === candles.length;
  const rsi = isFiniteNumber(analysis?.rsi) && analysis.rsi >= 0 && analysis.rsi <= 100
    ? analysis.rsi
    : calculateRsi14(closes);
  const hasRsi = rsi !== null;
  const checks = [
    { labelFa: 'تازگی و اعتبار فید کندل', passed: feed !== null, detailFa: feed ? `فید زنده؛ ${Math.round(feed.ageMs)}ms` : 'فید کندل زنده/تازه تأیید نشد.' },
    { labelFa: 'کامل بودن داده قیمت', passed: hasCandles, detailFa: hasCandles ? `${candles.length} کندل با close معتبر` : 'کمتر از ۳۰ کندل معتبر یا close نامعتبر است.' },
    { labelFa: 'RSI قابل‌محاسبه', passed: hasRsi, detailFa: hasRsi ? `RSI14: ${rsi!.toFixed(2)}${isFiniteNumber(analysis?.rsi) ? ' از تحلیل snapshot' : ' محاسبه‌شده از closeهای واقعی'}` : 'RSI معتبر از snapshot یا کندل‌ها قابل‌محاسبه نیست.' },
  ];
  if (!feed || !hasCandles) {
    return abstain(member, 'برای تحلیل مستقل تکنیکال، کندل تازه و حداقل ۳۰ close معتبر لازم است.', checks, feed?.feed.timestamp, feed?.ageMs);
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
  const higherTimeframeSignals = [analysis?.mtf1h, analysis?.mtf4h]
    .filter((value): value is string => value === 'BULLISH' || value === 'BEARISH')
    .map((value) => value === 'BULLISH' ? 1 : -1);
  const higherTimeframeSignal = higherTimeframeSignals.length >= 2 &&
    higherTimeframeSignals.every((signal) => signal === higherTimeframeSignals[0])
    ? higherTimeframeSignals[0]
    : 0;
  const score = trendSignal + momentumSignal + rsiSignal + higherTimeframeSignal;
  const vote: CouncilVote = score >= 2 ? 'LONG' : score <= -2 ? 'SHORT' : 'NEUTRAL';
  const rationale = `تحلیل محلی کندل: SMA10 ${fastAverage.toFixed(2)} در برابر SMA30 ${slowAverage.toFixed(2)}؛ مومنتوم ۵ کندلی ${momentumPct.toFixed(3)}٪؛ RSI14 ${hasRsi ? rsi!.toFixed(2) : 'ناموجود'}؛ سیگنال ۱h/۴h ${higherTimeframeSignal > 0 ? 'صعودی' : higherTimeframeSignal < 0 ? 'نزولی' : 'تأییدنشده'}؛ امتیاز اجزای تخصصی ${score}. امتیاز عمومی LONG/SHORT در رأی استفاده نشد.`;
  return createVote(
    member,
    vote,
    rationale,
    checks,
    {
      sourceTimestampMs: feed.feed.timestamp,
      sourceAgeMs: feed.ageMs,
      dataQualityPct: feed.feed.score,
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
    isFiniteNumber(delta);
  const checks = [
    { labelFa: 'جریان معاملات واقعی', passed: flow?.isRealTradeFlow === true && flow.status === 'LIVE', detailFa: flow?.isRealTradeFlow === true && flow.status === 'LIVE' ? 'فید معاملات اجراشده زنده است.' : 'فید زنده معاملات واقعی تأیید نشد.' },
    { labelFa: 'تازگی CVD', passed: sourceFreshness !== null && feed !== null, detailFa: sourceFreshness ? `${Math.round(sourceFreshness.ageMs)}ms` : 'داده فاقد زمان معتبر یا کهنه است.' },
    { labelFa: 'وجود دلتا', passed: isFiniteNumber(delta), detailFa: isFiniteNumber(delta) ? `دلتا: ${delta}` : 'دلتا در دسترس نیست.' },
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
  const valid = feed !== null && isFiniteNumber(fundingRate) && hasOpenInterest;
  const checks = [
    { labelFa: 'فید مشتقات زنده و تازه', passed: feed !== null, detailFa: feed ? `${Math.round(feed.ageMs)}ms` : 'فید مشتقات زنده/تازه تأیید نشد.' },
    { labelFa: 'Funding معتبر', passed: isFiniteNumber(fundingRate), detailFa: isFiniteNumber(fundingRate) ? `Funding: ${fundingRate}` : 'Funding موجود نیست.' },
    { labelFa: 'Open Interest معتبر', passed: hasOpenInterest, detailFa: hasOpenInterest ? `OI: ${analysis!.oi}` : 'OI معتبر موجود نیست.' },
  ];
  if (!valid || !feed || !isFiniteNumber(fundingRate)) {
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
      sourceTimestampMs: feed.feed.timestamp,
      sourceAgeMs: feed.ageMs,
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
    const confirmedTransfers = directWhaleFlow.largeTransfers.filter((transfer) =>
      transfer.confirmationStatus === 'CONFIRMED' &&
      transfer.blockchain.length > 0 &&
      transfer.transactionHash.length > 0 &&
      transfer.amount > 0 &&
      Number.isFinite(transfer.timestampMs) &&
      transfer.timestampMs <= nowMs &&
      nowMs - transfer.timestampMs <= MAX_PUBLIC_ONCHAIN_AGE_MS
    );
    const usable = directWhaleFlow.status === 'LIVE' &&
      freshness !== null &&
      directWhaleFlow.coverageStatus === 'SAMPLED' &&
      confirmedTransfers.length > 0;
    const checks = [
      {
        labelFa: 'تراکنش‌های بزرگ تأییدشده',
        passed: usable,
        detailFa: usable
          ? `${confirmedTransfers.length} تراکنش تأییدشده؛ دادهٔ خام بدون انتساب مالکیت کیف‌پول`
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
    ];
    if (!usable || !freshness) {
      return abstain(member, directWhaleFlow.unavailableReason ?? 'شواهد آن‌چین تازه و تأییدشده برای رأی معتبر کافی نیست.', checks, freshness?.timestampMs, freshness?.ageMs);
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
  const directSignals: Array<{ label: string; direction: -1 | 0 | 1; timestampMs: number }> = [];
  const sp500 = directMacroData?.sp500;
  if (isFreshDirectMacroMetric(sp500, nowMs) && isFiniteNumber(sp500.changePct)) {
    directSignals.push({
      label: 'S&P 500',
      direction: sp500.changePct >= 0.1 ? 1 : sp500.changePct <= -0.1 ? -1 : 0,
      timestampMs: sp500.observedAtMs,
    });
  }

  const broadDollar = directMacroData?.broadDollar;
  if (isFreshDirectMacroMetric(broadDollar, nowMs) && isFiniteNumber(broadDollar.changePct)) {
    directSignals.push({
      label: 'دلار گستردهٔ فدرال رزرو (proxy، نه DXY)',
      direction: broadDollar.changePct >= 0.05 ? -1 : broadDollar.changePct <= -0.05 ? 1 : 0,
      timestampMs: broadDollar.observedAtMs,
    });
  }

  const dxy = directMacroData?.dxy;
  if (isFreshDirectMacroMetric(dxy, nowMs, MAX_DXY_AGE_MS) && isFiniteNumber(dxy.changePct)) {
    directSignals.push({
      label: 'شاخص واقعی DXY',
      direction: dxy.changePct >= 0.05 ? -1 : dxy.changePct <= -0.05 ? 1 : 0,
      timestampMs: dxy.observedAtMs,
    });
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
      direction: averageRateChange >= 0.01 ? -1 : averageRateChange <= -0.01 ? 1 : 0,
      timestampMs: Math.max(...freshFedRates.map((metric) => metric.observedAtMs)),
    });
  }

  if (directSignals.length >= 2) {
    const score = directSignals.reduce((sum, signal) => sum + signal.direction, 0);
    const vote: CouncilVote = score >= 2 ? 'LONG' : score <= -2 ? 'SHORT' : 'NEUTRAL';
    const sourceTimestampMs = Math.max(...directSignals.map((signal) => signal.timestampMs));
    return createVote(
      member,
      vote,
      `رأی از ${directSignals.length} شاخص مستقیم و تازه گرفته شد: ${directSignals.map(({ label, direction }) => `${label} (${direction > 0 ? 'صعودی' : direction < 0 ? 'نزولی' : 'خنثی'})`).join('، ')}؛ proxy دلار به‌جای DXY معرفی نشده است.`,
      [
        {
          labelFa: 'تازگی منابع کلان مستقیم',
          passed: true,
          detailFa: directSignals.map(({ label, timestampMs }) => `${label}: ${Math.round((nowMs - timestampMs) / 60_000)} دقیقه`).join('؛ '),
        },
        {
          labelFa: 'تعداد شاخص‌های مستقیم معتبر',
          passed: true,
          detailFa: `${directSignals.length} شاخص مستقیم: ${directSignals.map(({ label }) => label).join('، ')}`,
        },
      ],
      {
        sourceTimestampMs,
        sourceAgeMs: nowMs - sourceTimestampMs,
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
    return abstain(member, 'برای رأی کلان، داده تازه، نتیجه معتبر و دست‌کم دو شاخص زنده لازم است.', checks, freshness?.timestampMs, freshness?.ageMs);
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
    { sourceTimestampMs: freshness.timestampMs, sourceAgeMs: freshness.ageMs }
  );
}

function evaluateNews(
  member: CouncilMemberDefinition,
  macro: CouncilMacroContext | null | undefined,
  nowMs: number
): CouncilMemberVote {
  const freshness = getMacroAge(macro, nowMs, MAX_NEWS_AGE_MS);
  const hasLiveSentiment = macro?.newsSentimentStatus === 'LIVE' &&
    isFiniteNumber(macro.newsSentimentScore) &&
    macro.newsHeadlinesStatus === 'LIVE' &&
    macro.recentHeadlines.length > 0;
  const latestFreshHeadline = macro?.recentHeadlines.reduce<number | null>((latest, headline) => {
    const publishedAt = Date.parse(headline.publishedAt);
    const ageMs = nowMs - publishedAt;
    return Number.isFinite(publishedAt) && ageMs >= 0 && ageMs <= MAX_NEWS_AGE_MS
      ? Math.max(latest ?? 0, publishedAt)
      : latest;
  }, null) ?? null;
  const headlinesAreFresh = latestFreshHeadline !== null;
  const checks = [
    { labelFa: 'ناشر و خبر معتبر', passed: hasLiveSentiment, detailFa: hasLiveSentiment ? `${macro!.recentHeadlines.length} خبر و امتیاز سنتیمنت زنده` : 'خبر معتبر یا امتیاز سنتیمنت زنده در دسترس نیست.' },
    { labelFa: 'تازگی خبر و داده', passed: freshness !== null && headlinesAreFresh, detailFa: freshness && latestFreshHeadline !== null ? `${Math.round((nowMs - latestFreshHeadline) / 60_000)} دقیقه از انتشار آخرین خبر` : 'زمان خبر/داده کهنه یا نامعتبر است.' },
  ];
  if (!macro || !hasLiveSentiment || !freshness || !headlinesAreFresh || !isFiniteNumber(macro.newsSentimentScore)) {
    return abstain(member, 'خبر زنده همراه با سنتیمنت تأییدشده موجود نیست؛ شایعه یا شمار پست‌ها رأی محسوب نمی‌شود.', checks, freshness?.timestampMs, freshness?.ageMs);
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
  nowMs?: number;
}): EightMemberCouncilReport {
  const nowMs = input.nowMs ?? Date.now();
  const members = EIGHT_MEMBER_COUNCIL;
  const votes = [
    evaluateTechnical(members[0], input.analysis, nowMs),
    evaluateTradeFlow(members[1], input.analysis, nowMs),
    evaluateOrderBook(members[2], input.analysis, nowMs),
    evaluateDerivatives(members[3], input.analysis, nowMs),
    evaluateOptions(members[4], input.optionsData, nowMs),
    evaluateOnChain(members[5], input.macroContext, nowMs, input.whaleFlowData ?? undefined),
    evaluateMacro(members[6], input.macroContext, nowMs, input.directMacroData),
    evaluateNews(members[7], input.macroContext, nowMs),
  ].map((vote) => ({
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
