import type { AnalysisResult, DataQualityReport, MarketFeedQuality } from '../types/trading';
import type { MacroCorrelationData } from './macroContextBrain';
import type { FreeMacroDataResult } from './freeMacroData';
import { getFreqtradePairBaseAsset, SUPPORTED_FREQTRADE_PAIRS } from './freqtradePairs';
import { getCouncilMemberSources } from './councilSourceRegistry';
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
  pair?: string;
  asset?: string;
  sourceId?: string;
  fallbackSourceId?: string;
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
  unavailableReason?: string;
}

export interface CouncilWhaleFlowData {
  pair?: string;
  asset?: string;
  status: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  provider: string;
  sourceId?: string;
  fallbackSourceId?: string;
  timestampMs: number | null;
  retrievedAtMs?: number | null;
  ageMs: number | null;
  qualityPct: number;
  coverageStatus?: 'SAMPLED' | 'COMPLETE' | 'UNAVAILABLE';
  unavailableReason?: string;
  largeTransfers?: CouncilWhaleTransfer[];
  networkMetrics?: Record<string, number | string | null>;
  ethereumWhaleSignals?: CouncilEthereumWhaleSignal[];
  exchangeInflowsBtc: number | null;
  exchangeOutflowsBtc: number | null;
  netExchangeFlowBtc: number | null;
  transactionCount: number;
  windowStartHeight: number | null;
  windowEndHeight: number | null;
}

export interface CouncilEthereumWhaleSignal {
  sourceId: string;
  status: 'LIVE' | 'UNAVAILABLE' | 'REGION_RESTRICTED';
  direction: 'LONG' | 'SHORT' | 'NEUTRAL' | 'UNAVAILABLE';
  confidencePct: number;
  weightPct: number;
  coverage: string;
  coverageComplete: boolean;
  observedAtMs: number | null;
  interpretationFa: string;
  evidence: unknown;
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

export type CouncilSourceCheckStatus =
  | 'HEALTHY'
  | 'BROKEN'
  | 'MISSING_API_KEY'
  | 'REGION_RESTRICTED'
  | 'UNTESTED';

export interface CouncilMemberSourceCheck {
  sourceId: string;
  status: CouncilSourceCheckStatus;
  detail: string;
  httpHealthy?: boolean | null;
  dataValid?: boolean | null;
  dataDetail?: string;
  observedAtMs?: number | null;
  normalizedData?: Readonly<Record<string, number | string | null>>;
  ethPriceUsd?: number | null;
  voteValue?: 'USEFUL' | 'LOW_VALUE' | 'UNKNOWN';
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
  voteWeightPct?: number;
  sourceId: string | null;
  fallbackSourceId: string | null;
  healthySourceCount: number | null;
  sourceChecks: CouncilMemberSourceCheck[];
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
  weightedLongVotes?: number;
  weightedShortVotes?: number;
  neutralVotes: number;
  abstentions: number;
  selectedDirection: CouncilDirection;
  quorumMet: boolean;
  summaryFa: string;
}

export function getCouncilWeightedVoteCounts(
  members: readonly Pick<CouncilMemberVote, 'vote' | 'voteWeightPct'>[],
): { long: number; short: number } {
  return members.reduce(
    (counts, member) => {
      const weight = (member.voteWeightPct ?? 100) / 100;
      if (member.vote === 'LONG') counts.long += weight;
      if (member.vote === 'SHORT') counts.short += weight;
      return counts;
    },
    { long: 0, short: 0 },
  );
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
    inputIds: [
      'macroContext.whaleFlowStatus',
      'macroContext.whaleSentiment',
      'macroContext.whaleNetflowBtc',
      'macroSource.bitcoinActiveAddresses',
      'macroSource.ethereumActiveAddresses',
    ],
    moduleIds: [
      'brains.brain06OnChainWhaleFlow',
      'brains.brain11OnChainWhaleSentiment',
      'onchain.bitcoinActiveAddresses',
      'onchain.bitcoinPublicTransfers',
      'onchain.ethereumActiveAddresses',
      'onchain.ethereumPublicTransfers',
      'onchain.assetPublicTransfers',
      'onchain.hyperliquidWhales',
      'onchain.deribitBlockTrades',
      'onchain.ethLargeTransfers',
      'onchain.exchangeLabels',
    ],
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
const MAX_PUBLIC_BITCOIN_ONCHAIN_AGE_MS = 20 * 60_000;
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

function sourceIdForProvider(memberId: number, provider: string | undefined): string | null {
  if (!provider) return null;
  const normalized = provider.toLowerCase();
  const sourcesByMember: Readonly<Record<number, readonly [string, string][]>> = {
    1: [
      ['freqtrade', 'market.freqtrade-snapshot'],
      ['binance', 'market.candles-binance'],
      ['coinbase', 'council.member1.coinbase-candles'],
      ['kraken', 'council.member1.kraken-ohlc'],
      ['okx', 'council.member1.okx-candles'],
      ['bitstamp', 'council.member1.bitstamp-ohlc'],
    ],
    2: [
      ['freqtrade', 'market.freqtrade-snapshot'],
      ['coinbase', 'council.member2.coinbase-trades'],
      ['kraken', 'council.member2.kraken-trades'],
      ['okx', 'council.member2.okx-trades'],
      ['bitfinex', 'council.member2.bitfinex-trades'],
    ],
    3: [
      ['freqtrade', 'market.freqtrade-snapshot'],
      ['coinbase', 'council.member3.coinbase-level2'],
      ['kraken', 'council.member3.kraken-depth'],
      ['okx', 'council.member3.okx-books'],
      ['bitstamp', 'council.member3.bitstamp-order-book'],
    ],
    4: [
      ['freqtrade', 'market.freqtrade-snapshot'],
      ['okx', 'council.member4.okx-derivatives'],
      ['deribit', 'council.member4.deribit-perpetual'],
      ['hyperliquid', 'council.member4.hyperliquid'],
      ['binance', 'council.member4.binance-fapi'],
    ],
    5: [
      ['deribit', 'council.member5.deribit-options'],
      ['okx', 'council.member5.okx-opt-summary'],
      ['bybit', 'council.member5.bybit-options'],
      ['binance', 'council.member5.binance-eapi'],
    ],
    6: [
      ['defillama dex', 'council.member6.defillama-dex-volume'],
      ['publicnode', 'council.member6.staking-deposits'],
      ['defillama', 'council.member6.defillama'],
      ['publicnode fee history', 'council.member6.fee-history'],
    ],
    7: [
      ['fred', 'council.member7.fred'],
      ['fred public csv', 'council.member7.fred-market-series'],
      ['treasury', 'council.member7.treasury'],
      ['stooq', 'council.member7.stooq'],
      ['ecb', 'council.member7.ecb'],
    ],
    8: [
      ['ethereum foundation', 'council.member8.ethereum-foundation'],
      ['coindesk', 'council.member8.coindesk'],
      ['cointelegraph', 'council.member8.cointelegraph'],
      ['google news', 'council.member8.google-news'],
      ['alternative.me', 'council.member8.alternative-fng'],
    ],
  };
  return sourcesByMember[memberId]?.find(([providerName]) =>
    normalized.includes(providerName)
  )?.[1] ?? null;
}

const DEFAULT_MACRO_BETA_BY_PAIR: Readonly<Record<string, number>> = {
  'BTC/USDT:USDT': 1,
  'ETH/USDT:USDT': 1.05,
  'SOL/USDT:USDT': 1.3,
  'XRP/USDT:USDT': 1.2,
  'BNB/USDT:USDT': 1.15,
};

function readMacroBeta(pair: string): number | null {
  if (!getFreqtradePairBaseAsset(pair)) return null;
  const raw = process.env.SBK1_MACRO_BETA_BY_PAIR?.trim();
  if (!raw) return DEFAULT_MACRO_BETA_BY_PAIR[pair] ?? null;
  let values: Record<string, unknown>;
  if (raw.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('SBK1_MACRO_BETA_BY_PAIR must be a valid JSON object or pair=number list.');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('SBK1_MACRO_BETA_BY_PAIR must be a JSON object keyed by full Freqtrade pair.');
    }
    values = parsed as Record<string, unknown>;
  } else {
    values = {};
    for (const entry of raw.split(',')) {
      const separator = entry.lastIndexOf('=');
      if (separator < 1) {
        throw new Error('SBK1_MACRO_BETA_BY_PAIR must contain comma-separated full-pair=number entries.');
      }
      const configuredPair = entry.slice(0, separator).trim();
      const beta = Number(entry.slice(separator + 1).trim());
      if (!configuredPair || Object.hasOwn(values, configuredPair)) {
        throw new Error('SBK1_MACRO_BETA_BY_PAIR contains an empty or duplicate pair entry.');
      }
      values[configuredPair] = beta;
    }
  }
  for (const [configuredPair, beta] of Object.entries(values)) {
    if (
      !SUPPORTED_FREQTRADE_PAIRS.includes(configuredPair as (typeof SUPPORTED_FREQTRADE_PAIRS)[number]) ||
      !isFiniteNumber(beta) ||
      beta <= 0 ||
      beta > 5
    ) {
      throw new Error('SBK1_MACRO_BETA_BY_PAIR values must map supported full pairs to numbers in (0, 5].');
    }
  }
  const beta = values[pair];
  return isFiniteNumber(beta) && beta > 0 && beta <= 5
    ? beta
    : (raw ? null : DEFAULT_MACRO_BETA_BY_PAIR[pair] ?? null);
}

export function getCouncilMacroBeta(pair: string): number | null {
  return readMacroBeta(pair);
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
    sourceId?: string | null;
    fallbackSourceId?: string | null;
    sourceTimestampMs?: number | null;
    sourceAgeMs?: number | null;
    dataQualityPct?: number | null;
    confidencePct?: number | null;
    voteWeightPct?: number;
  } = {}
): CouncilMemberVote {
  return {
    ...member,
    vote,
    voteWeightPct: options.voteWeightPct ?? 100,
    sourceId: options.sourceId ?? null,
    fallbackSourceId: options.fallbackSourceId ?? null,
    healthySourceCount: null,
    sourceChecks: [],
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
  nowMs: number,
  pair?: string,
): CouncilMemberVote {
  const pairMatches = pair === undefined || (
    options?.pair === pair &&
    options.asset === getFreqtradePairBaseAsset(pair)
  );
  const sourceFreshness = options
    ? freshTimestamp(options.timestampMs, options.ageMs, nowMs, MAX_OPTIONS_AGE_MS)
    : null;
  const valid = pairMatches && !!options &&
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
    { labelFa: 'تطبیق جفت‌ارز', passed: pairMatches, detailFa: pairMatches ? `دادهٔ اختیار برای ${pair ?? options?.pair ?? 'جفت نامشخص'} است.` : `دادهٔ جفت ${options?.pair ?? 'نامشخص'} برای ${pair} رد شد.` },
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
  pair?: string,
): CouncilMemberVote {
  if (pair !== undefined && directWhaleFlow && directWhaleFlow.pair !== pair) {
    return abstain(
      member,
      `دادهٔ آن‌چین برای ${directWhaleFlow.pair ?? 'جفت نامشخص'} است و برای ${pair} قابل استفاده نیست.`,
      [{
        labelFa: 'تطبیق جفت‌ارز و شبکه',
        passed: false,
        detailFa: `انتظار ${pair}؛ دریافت ${directWhaleFlow.pair ?? 'دادهٔ بدون جفت'}.`,
      }],
      directWhaleFlow.timestampMs,
      directWhaleFlow.ageMs,
    );
  }
  if (
    pair !== undefined &&
    directWhaleFlow &&
    directWhaleFlow.asset !== getFreqtradePairBaseAsset(pair)
  ) {
    return abstain(
      member,
      `شبکه/دارایی دادهٔ آن‌چین با دارایی ${pair} تطبیق ندارد.`,
      [{
        labelFa: 'تطبیق دارایی زنجیره',
        passed: false,
        detailFa: `انتظار ${getFreqtradePairBaseAsset(pair)}؛ دریافت ${directWhaleFlow.asset ?? 'دارایی نامشخص'}.`,
      }],
      directWhaleFlow.timestampMs,
      directWhaleFlow.ageMs,
    );
  }
  if (getFreqtradePairBaseAsset(pair ?? '') === 'ETH') {
    const directionalSignals = (directWhaleFlow?.ethereumWhaleSignals ?? []).filter((signal) =>
      signal.status === 'LIVE' &&
      (signal.direction === 'LONG' || signal.direction === 'SHORT') &&
      Number.isFinite(signal.confidencePct) &&
      signal.confidencePct > 0 &&
      Number.isFinite(signal.weightPct) &&
      signal.weightPct > 0
    );
    const weightedScore = directionalSignals.reduce((total, signal) =>
      total + (signal.direction === 'LONG' ? 1 : -1) *
        signal.confidencePct * signal.weightPct / 100,
    0);
    const agreeingSignalCount = directionalSignals.filter((signal) =>
      Math.sign(weightedScore) === (signal.direction === 'LONG' ? 1 : -1)
    ).length;
    if (agreeingSignalCount >= 2 && Math.abs(weightedScore) >= 15) {
      const direction = weightedScore > 0 ? 'LONG' : 'SHORT';
      const primarySignal = [...directionalSignals].sort((left, right) =>
        right.confidencePct * right.weightPct - left.confidencePct * left.weightPct
      )[0];
      const sourceTimestampMs = Math.max(
        ...directionalSignals
          .map(({ observedAtMs }) => observedAtMs)
          .filter(isFiniteNumber),
      );
      return createVote(
        member,
        direction,
        `حداقل دو سیگنال مستقل ETH با وزن پوشش‌تعدیل‌شده هم‌جهت‌اند (امتیاز ${weightedScore.toFixed(1)}). جریان به صرافی فقط احتمال فروش و خروج از صرافی فقط احتمال انباشت است، نه قطعیت.`,
        [
          {
            labelFa: 'هم‌جهتی سیگنال‌های نهنگ',
            passed: true,
            detailFa: `${agreeingSignalCount} سیگنال زنده و هم‌جهت؛ امتیاز وزن‌دار ${weightedScore.toFixed(1)}.`,
          },
          {
            labelFa: 'پوشش ناقص و وزن کاهش‌یافته',
            passed: directionalSignals.every(({ coverageComplete }) => coverageComplete),
            detailFa: directionalSignals.map(({ sourceId, coverage, weightPct }) =>
              `${sourceId}: ${coverage}; وزن ${weightPct}٪`
            ).join('؛ '),
          },
        ],
        {
          sourceId: primarySignal.sourceId,
          sourceTimestampMs: Number.isFinite(sourceTimestampMs) ? sourceTimestampMs : null,
          sourceAgeMs: Number.isFinite(sourceTimestampMs) ? nowMs - sourceTimestampMs : null,
          dataQualityPct: Math.min(60, directionalSignals.reduce((sum, signal) => sum + signal.weightPct, 0)),
          confidencePct: Math.min(55, 25 + Math.round(Math.abs(weightedScore))),
        },
      );
    }
  }
  if (directWhaleFlow?.largeTransfers && (pair === undefined || directWhaleFlow.pair === pair)) {
    const expectedAsset = pair
      ? getFreqtradePairBaseAsset(pair)
      : directWhaleFlow.asset ?? null;
    const maximumPublicAgeMs = expectedAsset === 'BTC'
      ? MAX_PUBLIC_BITCOIN_ONCHAIN_AGE_MS
      : MAX_PUBLIC_ONCHAIN_AGE_MS;
    const freshness = freshTimestamp(
      directWhaleFlow.timestampMs,
      directWhaleFlow.ageMs,
      nowMs,
      maximumPublicAgeMs,
    );
    const expectedBlockchain: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      SOL: 'solana',
      XRP: 'xrp',
      BNB: 'binance_smart_chain',
    };
    const hasForeignTransfer = expectedAsset !== null &&
      directWhaleFlow.largeTransfers.some((transfer) => {
        const isEthereumTokenTransfer = expectedAsset === 'ETH' &&
          transfer.blockchain.toLowerCase() === 'ethereum' &&
          transfer.asset.toUpperCase() !== 'ETH' &&
          transfer.transferId?.startsWith('erc20:') === true;
        return !isEthereumTokenTransfer &&
          (transfer.asset.toUpperCase() !== expectedAsset ||
            transfer.blockchain.toLowerCase() !== expectedBlockchain[expectedAsset]);
      });
    if (hasForeignTransfer) {
      return abstain(
        member,
        `provider برای ${pair} انتقالی از شبکه یا دارایی دیگری فرستاد؛ کل شواهد رد شد.`,
        [{
          labelFa: 'تطبیق شبکهٔ انتقال‌ها',
          passed: false,
          detailFa: `شبکه و دارایی مورد انتظار ${expectedBlockchain[expectedAsset!]}/${expectedAsset}.`,
        }],
        directWhaleFlow.timestampMs,
        directWhaleFlow.ageMs,
      );
    }
    const eligibleTransfers = directWhaleFlow.largeTransfers.filter((transfer) =>
      transfer.confirmationStatus === 'CONFIRMED' &&
      transfer.blockchain.length > 0 &&
      transfer.transactionHash.length > 0 &&
      transfer.amount > 0 &&
      Number.isFinite(transfer.timestampMs) &&
      transfer.timestampMs <= nowMs &&
      nowMs - transfer.timestampMs <= maximumPublicAgeMs
    );
    const identifiedTransfers = deduplicateOnChainTransfers(eligibleTransfers);
    const confirmedTransfers = identifiedTransfers.values.filter((transfer) =>
      Boolean(transfer.transferId?.trim())
    );
    const nativeTransfers = confirmedTransfers.filter((transfer) =>
      transfer.asset.toUpperCase() === expectedAsset
    );
    const tokenTransfers = expectedAsset === 'ETH'
      ? confirmedTransfers.filter((transfer) => transfer.transferId?.startsWith('erc20:') === true)
      : [];
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
              ? `${nativeTransfers.length} انتقال بومی ${expectedAsset} و ${tokenTransfers.length} انتقال ERC-20 تأییدشده؛ دادهٔ خام بدون انتساب مالکیت کیف‌پول`
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

  if (pair !== undefined) {
    return abstain(
      member,
      `دادهٔ آن‌چین pair-scoped برای ${pair} موجود نیست؛ context قدیمی BTCمحور برای این عضو استفاده نشد.`,
      [{
        labelFa: 'دادهٔ اختصاصی دارایی',
        passed: false,
        detailFa: 'منبع آن‌چین فاقد جفت/شبکهٔ منطبق است.',
      }],
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
  pair?: string,
): CouncilMemberVote {
  const macroBeta = pair === undefined ? 1 : readMacroBeta(pair);
  if (macroBeta === null) {
    return abstain(
      member,
      `ضریب واکنش کلانِ کالیبره‌شده برای ${pair} تنظیم نشده است؛ رأی عمومی بازار روی این دارایی اعمال نشد.`,
      [{
        labelFa: 'ضریب واکنش اختصاصی دارایی',
        passed: false,
        detailFa: `SBK1_MACRO_BETA_BY_PAIR باید برای ${pair} مقدار کالیبره‌شده داشته باشد.`,
      }],
    );
  }
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
    const score = uniqueDirectSignals.reduce((sum, signal) => sum + signal.direction * macroBeta, 0);
    const vote: CouncilVote = score >= 2 ? 'LONG' : score <= -2 ? 'SHORT' : 'NEUTRAL';
    const sourceTimestampMs = Math.max(...uniqueDirectSignals.map((signal) => signal.timestampMs));
    return createVote(
      member,
      vote,
      `رأی ${pair ?? 'بازار'} با ضریب واکنش ${macroBeta} از ${uniqueDirectSignals.length} شاخص مستقیم و تازه گرفته شد: ${uniqueDirectSignals.map(({ label, direction }) => `${label} (${direction > 0 ? 'صعودی' : direction < 0 ? 'نزولی' : 'خنثی'})`).join('، ')}؛ شاخص یا proxy با نام و نوع واقعی خودش گزارش شده است.`,
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
    const score = contextSignals.reduce((sum, signal) => sum + signal.direction * macroBeta, 0);
    const vote: CouncilVote = score >= 2 ? 'LONG' : score <= -2 ? 'SHORT' : 'NEUTRAL';
    const sourceTimestampMs = Math.max(...contextSignals.map((signal) => signal.timestampMs));
    return createVote(
      member,
      vote,
      `رأی ${pair ?? 'بازار'} با ضریب واکنش ${macroBeta} از ${contextSignals.length} شاخص مستقیم و تازهٔ زمینهٔ کلان گرفته شد: ${contextSignals.map(({ label, direction }) => `${label} (${direction > 0 ? 'صعودی' : direction < 0 ? 'نزولی' : 'خنثی'})`).join('، ')}؛ proxy دلار به‌جای DXY معرفی نشده است.`,
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

  if (pair !== undefined) {
    return abstain(
      member,
      `برای ${pair} دو شاخص مستقیم و تازه برای ارزیابی واکنش اختصاصی موجود نیست؛ سوگیری عمومی macroContext به ارث نمی‌رسد.`,
      [{
        labelFa: 'پوشش شاخص‌های واکنش‌پذیری',
        passed: false,
        detailFa: `${contextSignals.length} شاخص pair-context معتبر؛ حداقل دو شاخص مستقل لازم است.`,
      }],
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
    ? macroBeta >= 1 ? 'LONG' : 'NEUTRAL'
    : macro.fundamentalBias === 'BEARISH'
      ? macroBeta >= 1 ? 'SHORT' : 'NEUTRAL'
      : 'NEUTRAL';
  return createVote(
    member,
    vote,
    `سوگیری کلان ${macro.fundamentalBias} برای ${pair ?? 'بازار'} با ضریب واکنش ${macroBeta} و پوشش ${liveIndicatorCount} شاخص زنده ارزیابی شد.`,
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
  nowMs: number,
  pair?: string,
): CouncilMemberVote {
  const freshness = getMacroAge(macro, nowMs, MAX_NEWS_AGE_MS);
  const pairHeadlines = pair === undefined
    ? macro?.recentHeadlines ?? []
    : (macro?.recentHeadlines ?? []).filter((headline) => headline.pair === pair);
  const newsDeduplication = deduplicateNews(pairHeadlines);
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
    { labelFa: 'تطبیق جفت‌ارز خبر', passed: pair === undefined || freshHeadlines.every((headline) => headline.pair === pair), detailFa: pair === undefined ? 'اجرای بدون جفت؛ سازگاری قدیمی.' : `${freshHeadlines.length} خبر برای ${pair} فیلتر شد.` },
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

function evaluatePrimaryAssetSourceVote(
  member: CouncilMemberDefinition,
  checks: readonly CouncilMemberSourceCheck[],
  nowMs: number,
  macroContext?: CouncilMacroContext | null,
  pair?: string,
): CouncilMemberVote {
  const asset = getFreqtradePairBaseAsset(pair ?? '') ?? 'ETH';
  const registeredIds = getCouncilMemberSources(member.id, asset).map(({ id }) => id);
  const validSources = checks
    .filter(({ sourceId, status, dataValid, normalizedData, voteValue }) =>
      registeredIds.includes(sourceId) &&
      status === 'HEALTHY' &&
      dataValid === true &&
      voteValue !== 'LOW_VALUE' &&
      normalizedData !== undefined
    )
    .sort((left, right) => registeredIds.indexOf(left.sourceId) - registeredIds.indexOf(right.sourceId));
  const observedSources = checks
    .filter(({ sourceId, status, dataValid }) =>
      registeredIds.includes(sourceId) && status === 'HEALTHY' && dataValid === true
    )
    .sort((left, right) => registeredIds.indexOf(left.sourceId) - registeredIds.indexOf(right.sourceId));
  const metric = (source: CouncilMemberSourceCheck, name: string): number | null => {
    const value = source.normalizedData?.[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const sourceSignals: Array<{ source: CouncilMemberSourceCheck; value: number; timestampMs: number }> = [];
  const minIndependentSignals = 2;
  const sourceTimestampMs = validSources.reduce<number | null>((latest, source) =>
    source.observedAtMs !== null && source.observedAtMs !== undefined
      ? Math.max(latest ?? 0, source.observedAtMs)
      : latest,
  null);
  const fallbackSourceId = (signals: readonly { source: CouncilMemberSourceCheck }[]): string | null =>
    signals[0] && signals[0].source.sourceId !== registeredIds[0]
      ? signals[0].source.sourceId
      : null;

  if (member.id === 1) {
    for (const source of validSources) {
      const returnPct = metric(source, 'returnPct');
      if (returnPct !== null) sourceSignals.push({
        source, value: returnPct, timestampMs: source.observedAtMs ?? nowMs,
      });
    }
    if (sourceSignals.length >= minIndependentSignals) {
      const meanReturnPct = sourceSignals.reduce((sum, signal) => sum + signal.value, 0) / sourceSignals.length;
      const vote: CouncilVote = meanReturnPct >= 0.05 ? 'LONG' : meanReturnPct <= -0.05 ? 'SHORT' : 'NEUTRAL';
      return createVote(
        member,
        vote,
        `رأی روند ${asset} از بازده کندل ساعتی منابع ثبت‌شده محاسبه شد؛ میانگین تغییر ${meanReturnPct.toFixed(4)}٪ از ${sourceSignals.length} منبع معتبر.`,
        [
          { labelFa: 'دادهٔ مستقیم منابع عضو', passed: true, detailFa: `${sourceSignals.map(({ source, value }) => `${source.sourceId}=${value.toFixed(4)}٪`).join('؛ ')}` },
          { labelFa: 'حداقل منابع مستقل', passed: true, detailFa: `${sourceSignals.length} منبع دادهٔ معتبر؛ حداقل ${minIndependentSignals}.` },
        ],
        {
          sourceId: sourceSignals[0].source.sourceId,
          fallbackSourceId: fallbackSourceId(sourceSignals),
          sourceTimestampMs,
          sourceAgeMs: sourceTimestampMs === null ? null : nowMs - sourceTimestampMs,
          dataQualityPct: Math.min(100, sourceSignals.length * 25),
          confidencePct: Math.min(85, 50 + Math.round(Math.abs(meanReturnPct) * 10)),
        },
      );
    }
    return {
      ...abstain(
        member,
        `کمتر از دو منبع آپشنِ دارای سنجهٔ جهت‌ساز معتبر است (${sourceSignals.length}/2)؛ سطوح IV یا mark price به‌تنهایی جهت قیمت را تعیین نمی‌کنند.`,
        [
          { labelFa: 'تعداد سنجه‌های جهت‌دار آپشن', passed: false, detailFa: `${sourceSignals.length}/2 منبع معتبر.` },
          { labelFa: 'IV و mark price', passed: false, detailFa: 'دادهٔ زمینه‌ایِ بدون skew یا OI جهت‌دار در رأی شمرده نمی‌شود.' },
        ],
        sourceTimestampMs,
        sourceTimestampMs === null ? null : nowMs - sourceTimestampMs,
      ),
      sourceId: sourceSignals[0]?.source.sourceId ??
        checks.find(({ status }) => status === 'HEALTHY')?.sourceId ?? null,
      fallbackSourceId: null,
    };
  }

  if (member.id === 2) {
    for (const source of validSources) {
      const cvd = metric(source, 'cvdBase') ?? metric(source, 'cvdEth');
      const buyVolume = metric(source, 'buyVolumeBase') ?? metric(source, 'buyVolumeEth');
      const sellVolume = metric(source, 'sellVolumeBase') ?? metric(source, 'sellVolumeEth');
      const classifiedCount = metric(source, 'classifiedTradeCount');
      const total = (buyVolume ?? 0) + (sellVolume ?? 0);
      if (cvd !== null && total > 0 && (classifiedCount ?? 0) >= 5 &&
          metric(source, 'cvdWindowMs') === 5 * 60_000) {
        sourceSignals.push({
          source,
          value: cvd / total,
          timestampMs: metric(source, 'tradeTimestampMs') ??
            source.observedAtMs ?? nowMs,
        });
      }
    }
    const selectedSignal = sourceSignals[0];
    if (selectedSignal) {
      const cvdRatio = selectedSignal.value;
      const vote: CouncilVote = cvdRatio >= 0.05 ? 'LONG' : cvdRatio <= -0.05 ? 'SHORT' : 'NEUTRAL';
      const failoverActive = selectedSignal.source.sourceId !== registeredIds[0];
      return createVote(
        member,
        vote,
        `رأی CVD فقط از یک صرافی گرفته شد (${selectedSignal.source.sourceId})؛ نسبت خالص ${cvdRatio.toFixed(4)} در پنجرهٔ ۵ دقیقه. ${failoverActive ? 'Failover فعال است.' : 'منبع اصلی فعال است.'}`,
        [
          { labelFa: 'CVD مستقیم یک صرافی', passed: true, detailFa: `${selectedSignal.source.sourceId}=${cvdRatio.toFixed(4)}؛ ${metric(selectedSignal.source, 'classifiedTradeCount')} معاملات دسته‌بندی‌شده در ۵ دقیقه.` },
          { labelFa: 'Failover خودکار', passed: true, detailFa: failoverActive ? `Failover فعال؛ منبع اصلی ${registeredIds[0]} در دسترس نبود.` : 'منبع اولویت اول استفاده شد.' },
        ],
        {
          sourceId: selectedSignal.source.sourceId,
          fallbackSourceId: failoverActive ? selectedSignal.source.sourceId : null,
          sourceTimestampMs: selectedSignal.timestampMs,
          sourceAgeMs: nowMs - selectedSignal.timestampMs,
          dataQualityPct: failoverActive ? 40 : 60,
          confidencePct: Math.min(failoverActive ? 40 : 55, 35 + Math.round(Math.abs(cvdRatio) * 100)),
        },
      );
    }
  }

  if (member.id === 3) {
    for (const source of validSources) {
      const imbalance = metric(source, 'orderBookImbalance');
      if (imbalance !== null) sourceSignals.push({
        source, value: imbalance, timestampMs: source.observedAtMs ?? nowMs,
      });
    }
    if (sourceSignals.length >= minIndependentSignals) {
      const meanImbalance = sourceSignals.reduce((sum, signal) => sum + signal.value, 0) / sourceSignals.length;
      const vote: CouncilVote = meanImbalance >= 0.05 ? 'LONG' : meanImbalance <= -0.05 ? 'SHORT' : 'NEUTRAL';
      return createVote(
        member,
        vote,
        `رأی دفتر سفارش ${asset} از عدم‌تعادل bid/ask منابع ثبت‌شده محاسبه شد؛ میانگین OBI=${meanImbalance.toFixed(4)} از ${sourceSignals.length} دفتر.`,
        [
          { labelFa: 'دفترهای سفارش مستقیم', passed: true, detailFa: sourceSignals.map(({ source, value }) => `${source.sourceId} OBI=${value.toFixed(4)}`).join('؛ ') },
          { labelFa: 'حداقل منابع مستقل', passed: true, detailFa: `${sourceSignals.length} دفتر معتبر.` },
        ],
        {
          sourceId: sourceSignals[0].source.sourceId,
          fallbackSourceId: fallbackSourceId(sourceSignals),
          sourceTimestampMs,
          sourceAgeMs: sourceTimestampMs === null ? null : nowMs - sourceTimestampMs,
          dataQualityPct: Math.min(100, sourceSignals.length * 25),
          confidencePct: Math.min(85, 50 + Math.round(Math.abs(meanImbalance) * 100)),
        },
      );
    }
  }

  if (member.id === 4) {
    for (const source of validSources) {
      const fundingRate = metric(source, 'fundingRate');
      if (fundingRate !== null) sourceSignals.push({
        source, value: fundingRate, timestampMs: source.observedAtMs ?? nowMs,
      });
    }
    if (sourceSignals.length >= minIndependentSignals) {
      const meanFunding = sourceSignals.reduce((sum, signal) => sum + signal.value, 0) / sourceSignals.length;
      const vote: CouncilVote = meanFunding >= 0.0005 ? 'SHORT' : meanFunding <= -0.0005 ? 'LONG' : 'NEUTRAL';
      return createVote(
        member,
        vote,
        `رأی مشتقات ${asset} از نرخ funding منابع ثبت‌شده گرفته شد؛ میانگین ${meanFunding.toFixed(7)} از ${sourceSignals.length} بازار. Funding در محدودهٔ عادی جهت خنثی دارد.`,
        [
          { labelFa: 'Funding و OI از بازارهای مستقیم', passed: true, detailFa: sourceSignals.map(({ source, value }) => `${source.sourceId} funding=${value}`).join('؛ ') },
          { labelFa: 'حداقل منابع مستقل', passed: true, detailFa: `${sourceSignals.length} منبع مشتقات معتبر.` },
        ],
        {
          sourceId: sourceSignals[0].source.sourceId,
          fallbackSourceId: fallbackSourceId(sourceSignals),
          sourceTimestampMs,
          sourceAgeMs: sourceTimestampMs === null ? null : nowMs - sourceTimestampMs,
          dataQualityPct: Math.min(100, sourceSignals.length * 25),
          confidencePct: Math.min(80, 50 + Math.round(Math.abs(meanFunding) * 10_000)),
        },
      );
    }
  }

  if (member.id === 5) {
    for (const source of validSources) {
      const putCallRatio = metric(source, 'putCallOpenInterestRatio');
      const ivSpread = metric(source, 'putCallIvSpread');
      const direction = putCallRatio !== null && putCallRatio >= 0
        ? putCallRatio >= 1.2 ? -1 : putCallRatio <= 0.8 ? 1 : 0
        : ivSpread !== null
          ? ivSpread >= 0.02 ? -1 : ivSpread <= -0.02 ? 1 : 0
          : null;
      if (direction !== null) sourceSignals.push({
        source,
        value: direction,
        timestampMs: metric(source, 'optionTimestampMs') ??
          source.observedAtMs ?? nowMs,
      });
    }
    if (sourceSignals.length >= minIndependentSignals) {
      const meanOptionDirection = sourceSignals.reduce((sum, signal) => sum + signal.value, 0) /
        sourceSignals.length;
      const vote: CouncilVote = meanOptionDirection >= 0.25
        ? 'LONG'
        : meanOptionDirection <= -0.25
          ? 'SHORT'
          : 'NEUTRAL';
      return createVote(
        member,
        vote,
        `رأی آپشن از نسبت put/call OI یا IV-skew تفکیک‌شدهٔ ${sourceSignals.length} منبع جهت‌دار گرفته شد؛ امتیاز جهت=${meanOptionDirection.toFixed(3)}.`,
        [
          { labelFa: 'سنجش جهت‌دار آپشن', passed: true, detailFa: sourceSignals.map(({ source, value }) => `${source.sourceId}=${value.toFixed(3)}`).join('؛ ') },
          { labelFa: 'دادهٔ IV/موقعیت', passed: true, detailFa: `IV parity به‌تنهایی جهت‌ساز نیست؛ منبعی بدون OI تفکیک‌شده یا IV skew معنادار کنار گذاشته شد.${sourceSignals.some(({ source }) => source.normalizedData?.timestampProvenance === 'response-received-not-provider') ? ' Binance با زمان دریافت پاسخ، نه زمان منبع، ثبت شد.' : ''}` },
        ],
        {
          sourceId: sourceSignals[0].source.sourceId,
          fallbackSourceId: fallbackSourceId(sourceSignals),
          sourceTimestampMs: sourceSignals[0].timestampMs,
          sourceAgeMs: nowMs - sourceSignals[0].timestampMs,
          dataQualityPct: Math.min(100, sourceSignals.length * 25),
          confidencePct: Math.min(80, 45 + Math.round(Math.abs(meanOptionDirection) * 20)),
        },
      );
    }
  }

  if (member.id === 6) {
    const dexVolumeContext = observedSources.find((source) =>
      source.sourceId === 'council.member6.defillama-dex-volume' &&
      metric(source, 'ethereumDexVolume24hUsd') !== null
    );
    const stablecoinSource = validSources.find((source) =>
      source.sourceId === 'council.member6.defillama' &&
      metric(source, 'stablecoinSupplyChange7dPct') !== null
    );
    const stakingSource = validSources.find((source) =>
      source.sourceId === 'council.member6.staking-deposits' &&
      metric(source, 'stakingDeposits24hEth') !== null
    );
    if (stablecoinSource) {
      const changePct = metric(stablecoinSource, 'stablecoinSupplyChange7dPct')!;
      sourceSignals.push({
        source: stablecoinSource,
        value: changePct > 0.5 ? 1 : changePct < -0.5 ? -1 : 0,
        timestampMs: metric(stablecoinSource, 'observationTimestampMs') ??
          stablecoinSource.observedAtMs ?? nowMs,
      });
    }
    if (stakingSource) {
      const depositsEth = metric(stakingSource, 'stakingDeposits24hEth')!;
      sourceSignals.push({
        source: stakingSource,
        value: depositsEth > 1_000 ? 1 : 0,
        timestampMs: metric(stakingSource, 'observationTimestampMs') ??
          stakingSource.observedAtMs ?? nowMs,
      });
    }
    if (sourceSignals.length >= 2) {
      const agreement = sourceSignals[0].value === sourceSignals[1].value;
      const direction = agreement ? sourceSignals[0].value : 0;
      const vote: CouncilVote = direction > 0 ? 'LONG' : direction < 0 ? 'SHORT' : 'NEUTRAL';
      return createVote(
        member,
        vote,
        `دو سنجهٔ آن‌چین با heuristic غیرقطعی بررسی شدند: stablecoin 7d ${metric(stablecoinSource!, 'stablecoinSupplyChange7dPct')?.toFixed(3)}٪ و واریز ناخالص deposit contract در 24h ${metric(stakingSource!, 'stakingDeposits24hEth')?.toFixed(2)} ETH. ${agreement ? 'هر دو هم‌جهت‌اند.' : 'ناهم‌جهت/خنثی‌اند؛ رأی NEUTRAL.'} واریزها معادل افزایش خالص موجودی نیستند.${dexVolumeContext ? ` حجم DEX روزانه ${metric(dexVolumeContext, 'ethereumDexVolume24hUsd')?.toFixed(0)} USD، تغییر یک‌روزه ${metric(dexVolumeContext, 'ethereumDexVolumeChange1dPct')?.toFixed(2)}٪ و هفت‌روزه ${metric(dexVolumeContext, 'ethereumDexVolumeChange7dPct')?.toFixed(2)}٪ فقط زمینهٔ فعالیت است و جهت رأی را تعیین نمی‌کند.` : 'دادهٔ حجم DEX برای زمینهٔ فعالیت در دسترس نبود.'} سقف اطمینان 40٪ و وزن رأی 40٪ است.`,
        [
          { labelFa: 'تغییر عرضهٔ استیبل‌کوین ۷روزه', passed: stablecoinSource !== undefined, detailFa: stablecoinSource ? `${metric(stablecoinSource, 'stablecoinSupplyChange7dPct')?.toFixed(3)}٪؛ LONG بالای +0.5٪، SHORT زیر -0.5٪، در غیر این صورت NEUTRAL.` : 'داده معتبر موجود نیست.' },
          { labelFa: 'واریزهای ناخالص deposit contract در ۲۴ ساعت', passed: stakingSource !== undefined, detailFa: stakingSource ? `${metric(stakingSource, 'stakingDeposits24hEth')?.toFixed(2)} ETH؛ بیش از 1,000 ETH یک LONG ضعیف می‌دهد؛ واریزها خروج‌ها را کم نمی‌کنند.` : 'دادهٔ رویدادهای واریز در بازهٔ ۲۴ساعته در دسترس نیست یا نامعتبر است.' },
          { labelFa: 'هم‌جهتی heuristicها', passed: agreement, detailFa: agreement ? 'دو سنجه هم‌جهت‌اند.' : 'اختلاف یا مقدار مبهم به NEUTRAL تبدیل شد.' },
          { labelFa: 'حجم DEX اتریوم، زمینهٔ فعالیت', passed: dexVolumeContext !== undefined, detailFa: dexVolumeContext ? `${metric(dexVolumeContext, 'ethereumDexVolume24hUsd')?.toFixed(0)} USD؛ تغییر روزانه ${metric(dexVolumeContext, 'ethereumDexVolumeChange1dPct')?.toFixed(2)}٪ و هفتگی ${metric(dexVolumeContext, 'ethereumDexVolumeChange7dPct')?.toFixed(2)}٪؛ به‌تنهایی جهت قیمت را تعیین نمی‌کند.` : 'دادهٔ معتبر حجم DEX موجود نیست؛ در جهت رأی شمرده نمی‌شود.' },
        ],
        {
          sourceId: sourceSignals[0].source.sourceId,
          fallbackSourceId: fallbackSourceId(sourceSignals),
          sourceTimestampMs: Math.max(...sourceSignals.map(({ timestampMs }) => timestampMs)),
          sourceAgeMs: Math.max(...sourceSignals.map(({ timestampMs }) => nowMs - timestampMs)),
          dataQualityPct: 50,
          confidencePct: Math.min(40, agreement && direction !== 0 ? 40 : 20),
          voteWeightPct: 40,
        },
      );
    }
    return {
      ...abstain(
        member,
        `کمتر از دو سنجهٔ آن‌چین معتبر موجود است (${sourceSignals.length}/2). feeHistory و حجم DEX فقط زمینه‌اند و در رأی جهت‌دار شمرده نمی‌شوند.`,
        [
          { labelFa: 'تعداد سنجه‌های جهت‌دار', passed: false, detailFa: `${sourceSignals.length}/2؛ برای رأی حداقل دو سنجه لازم است.` },
          { labelFa: 'سنجه‌های زمینه‌ای', passed: false, detailFa: 'feeHistory و حجم DEX زمینه‌اند و جایگزین دو سنجهٔ جهت‌دار نمی‌شوند.' },
        ],
        sourceTimestampMs,
        sourceTimestampMs === null ? null : nowMs - sourceTimestampMs,
      ),
      sourceId: sourceSignals[0]?.source.sourceId ??
        checks.find(({ status }) => status === 'HEALTHY')?.sourceId ?? null,
      fallbackSourceId: null,
    };
  }

  if (member.id === 7) {
    for (const source of validSources) {
      if (source.sourceId === 'council.member7.fred-market-series') continue;
      const direction = metric(source, 'macroDirectionValue');
      if (direction !== null) sourceSignals.push({
        source, value: direction, timestampMs: source.observedAtMs ?? nowMs,
      });
    }
    if (sourceSignals.length >= minIndependentSignals) {
      const meanDirection = sourceSignals.reduce((sum, signal) => sum + signal.value, 0) /
        sourceSignals.length;
      const vote: CouncilVote = meanDirection > 0 ? 'LONG' : meanDirection < 0 ? 'SHORT' : 'NEUTRAL';
      return createVote(
        member,
        vote,
        `رأی کلان ${asset} با heuristic غیرقطعی از دلار، S&P 500 و VIX روزانه محاسبه شد؛ امتیاز میانگین ${meanDirection.toFixed(3)} از ${sourceSignals.length} منبع مشترک، نه اختصاصی دارایی. گروه دوم FRED برای تنوع داده است و ارائه‌دهنده مستقل شمرده نمی‌شود؛ سقف اطمینان 40٪.`,
        [
          { labelFa: 'دادهٔ کلان مشترک و تاریخ‌دار', passed: true, detailFa: sourceSignals.map(({ source, value }) => `${source.sourceId}=${value.toFixed(3)}`).join('؛ ') },
          { labelFa: 'حداقل منابع مستقل', passed: true, detailFa: `${sourceSignals.length} منبع با سنجهٔ کلان جهت‌ساز از ${registeredIds.length}.` },
        ],
        {
          sourceId: sourceSignals[0].source.sourceId,
          fallbackSourceId: fallbackSourceId(sourceSignals),
          sourceTimestampMs,
          sourceAgeMs: sourceTimestampMs === null ? null : nowMs - sourceTimestampMs,
          dataQualityPct: Math.min(100, sourceSignals.length * 25),
          confidencePct: Math.min(40, 30 + Math.round(Math.abs(meanDirection) * 5)),
        },
      );
    }
  }

  if (member.id === 8) {
    const publisherFallback = (sourceId: string): string =>
      sourceId.endsWith('.decrypt') ? 'Decrypt'
        : sourceId.endsWith('.the-block') ? 'The Block'
          : sourceId.endsWith('.coindesk') ? 'CoinDesk'
            : sourceId.endsWith('.google-news') ? 'Google News item'
              : sourceId;
    const assetNewsPattern: Readonly<Record<string, RegExp>> = {
      BTC: /\bBTC\b|\bBitcoin\b/i,
      SOL: /\bSOL\b|\bSolana\b/i,
      XRP: /\bXRP\b|\bRipple\b/i,
      BNB: /\bBNB\b|\bBinance Coin\b|\bBNB Chain\b/i,
      ETH: /\bETH\b|\bEthereum\b|\bEther\b/i,
    };
    const isAssetNews = (value: string): boolean =>
      (assetNewsPattern[asset] ??
        new RegExp(`\\b${asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      ).test(value);
    const relatedSources = validSources.filter((source) =>
      (metric(source, 'assetRelevantItemCount24h') ??
        metric(source, 'ethRelevantItemCount24h') ??
        metric(source, 'freshEthItemCount') ?? 0) > 0
    );
    const headlineRows: Array<{
      title: string;
      description: string;
      categories: string[];
      publisher: string;
      publishedAtMs: number;
      sourceId: string;
    }> = [];
    for (const source of relatedSources) {
      const serialized = source.normalizedData?.rssAssetItemsJson ??
        source.normalizedData?.rssEthItemsJson;
      if (typeof serialized !== 'string') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(serialized) as unknown;
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (!isRecord(item)) continue;
        const row = item;
        if (typeof row.title !== 'string' || typeof row.publishedAtMs !== 'number' ||
            !Number.isFinite(row.publishedAtMs)) continue;
        const description = typeof row.description === 'string' ? row.description : '';
        const categories = Array.isArray(row.categories)
          ? row.categories.filter((category): category is string => typeof category === 'string')
          : [];
        if (!isAssetNews(`${row.title} ${description} ${categories.join(' ')}`)) continue;
        const ageMs = nowMs - row.publishedAtMs;
        if (ageMs < 0 || ageMs > 24 * 60 * 60_000) continue;
        const publisher = typeof row.publisher === 'string' && row.publisher.trim()
          ? row.publisher.trim()
          : publisherFallback(source.sourceId);
        headlineRows.push({
          title: row.title,
          description,
          categories,
          publisher,
          publishedAtMs: row.publishedAtMs,
          sourceId: source.sourceId,
        });
      }
    }
    const deduplicatedHeadlines = new Map<string, typeof headlineRows[number]>();
    for (const headline of headlineRows) {
      const key = headline.title.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!deduplicatedHeadlines.has(key)) deduplicatedHeadlines.set(key, headline);
    }
    const freshAssetHeadlines = [...deduplicatedHeadlines.values()];
    const publisherCount = new Set(freshAssetHeadlines.map(({ publisher }) =>
      publisher.toLowerCase()
    )).size;
    const positiveWords = /\b(?:surge|surges|surged|rally|rallies|gain|gains|gained|bullish|approve|approved|approval|adoption|inflow|inflows|record|rise|rises|rose|soar|soars|uptrend|upgrade|breakthrough|strong|growth|positive)\b/gi;
    const negativeWords = /\b(?:crash|crashes|crashed|fall|falls|fell|decline|declines|declined|outflow|outflows|bearish|hack|hacks|hacked|exploit|exploits|lawsuit|ban|bans|drop|drops|dropped|loss|losses|weak|negative|selloff|slump)\b/gi;
    const scoredHeadlines = freshAssetHeadlines.map((headline) => {
      const text = `${headline.title} ${headline.description} ${headline.categories.join(' ')}`;
      const positiveHits = (text.match(positiveWords) ?? []).length;
      const negativeHits = (text.match(negativeWords) ?? []).length;
      const ageMs = nowMs - headline.publishedAtMs;
      return {
        ...headline,
        score: Math.sign(positiveHits - negativeHits),
        weight: ageMs <= 6 * 60 * 60_000 ? 2 : 1,
      };
    });
    const totalWeight = scoredHeadlines.reduce((sum, item) => sum + item.weight, 0);
    const weightedLexiconScore = totalWeight > 0
      ? scoredHeadlines.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
      : 0;
    const latestNewsTimestamp = freshAssetHeadlines.reduce<number | null>((latest, item) =>
      Math.max(latest ?? 0, item.publishedAtMs),
    null);
    const usedSourceIds = [...new Set(scoredHeadlines.map(({ sourceId }) => sourceId))];
    const sourceForVote = relatedSources.find((source) => usedSourceIds.includes(source.sourceId));
    const providerCount = relatedSources.length;
    const publisherQuorum = publisherCount >= 2;
    if (publisherQuorum && sourceForVote) {
      const vote: CouncilVote = weightedLexiconScore >= 0.15
        ? 'LONG'
        : weightedLexiconScore <= -0.15
          ? 'SHORT'
          : 'NEUTRAL';
      const fallbackActive = sourceForVote.sourceId !== registeredIds[0];
      return createVote(
        member,
        vote,
        `امتیازدهی احساسات ${asset} با fallback واژه‌نامه (lexicon) انجام شد؛ ${freshAssetHeadlines.length} خبر از ${publisherCount} ناشر، امتیاز وزنی ${weightedLexiconScore.toFixed(3)}. خبرهای ۶ ساعت اخیر وزن ۲ و خبرهای ۶ تا ۲۴ ساعت وزن ۱ دارند؛ رأی کم‌اطمینان است.`,
        [
          { labelFa: `ناشران مستقل با خبر ${asset} در ۲۴ ساعت`, passed: true, detailFa: `${publisherCount} ناشر واقعی از ${providerCount} فید واجد خبر؛ حداقل ۲ لازم است.` },
          { labelFa: 'فیلتر و بازهٔ زمانی', passed: true, detailFa: `${freshAssetHeadlines.length} خبر یکتا؛ کلیدواژهٔ ${asset} در عنوان/توضیح/دسته؛ پنجره ۲۴ ساعت.` },
          { labelFa: 'مدل احساسات', passed: true, detailFa: `lexicon fallback؛ وزن ۶ساعت اخیر=۲، ۶–۲۴ساعت=۱؛ score=${weightedLexiconScore.toFixed(3)}.` },
        ],
        {
          sourceId: sourceForVote.sourceId,
          fallbackSourceId: fallbackActive ? sourceForVote.sourceId : null,
          sourceTimestampMs: latestNewsTimestamp,
          sourceAgeMs: latestNewsTimestamp === null ? null : nowMs - latestNewsTimestamp,
          dataQualityPct: Math.min(100, publisherCount * 20 + freshAssetHeadlines.length * 5),
          confidencePct: Math.min(40, 25 + Math.round(Math.abs(weightedLexiconScore) * 15)),
        },
      );
    }
    const feedFailures = checks.filter(({ sourceId, status }) =>
      registeredIds.includes(sourceId) && status !== 'HEALTHY'
    ).length;
    const reason = feedFailures === registeredIds.length
      ? 'خرابی فیدها: هیچ‌یک از فیدهای ثبت‌شده سالم نیست.'
      : freshAssetHeadlines.length === 0
        ? `کمبود خبر پس از فیلتر ${asset}: در پنجرهٔ ۲۴ساعت، ${freshAssetHeadlines.length} خبر یکتا پیدا شد.`
        : `فیلتر/پوشش: فقط ${publisherCount} ناشر دارای خبر ${asset} در ۲۴ ساعت است؛ حداقل ۲ ناشر لازم است.`;
    return {
      ...abstain(member, `${reason} ابزار مدل در این محیط لازم نیست؛ fallback واژه‌نامه (lexicon) فعال است.`, [
        { labelFa: 'پوشش ناشران واقعی', passed: publisherQuorum, detailFa: `${publisherCount} ناشر برای ${freshAssetHeadlines.length} خبر یکتا؛ حداقل ۲ لازم است.` },
        { labelFa: 'تعداد فید سالم', passed: feedFailures < registeredIds.length, detailFa: `${registeredIds.length - feedFailures}/${registeredIds.length} فید سالم.` },
        { labelFa: 'امتیاز احساسات', passed: true, detailFa: 'lexicon fallback موجود است؛ نبود torch یا مدل باعث abstain نمی‌شود.' },
      ], latestNewsTimestamp, latestNewsTimestamp === null ? null : nowMs - latestNewsTimestamp),
      sourceId: sourceForVote?.sourceId ??
        checks.find(({ sourceId }) => registeredIds.includes(sourceId))?.sourceId ?? null,
      fallbackSourceId: null,
    };
  }

  const abstention = abstain(
    member,
    member.id === 6
      ? 'سنجه‌های آن‌چین تازه موجودند، اما طبق سیاست اتاق فقط زمینه‌اند و جهت قیمت را اثبات نمی‌کنند؛ منبع Etherscan نیز بدون API key در دسترس نیست.'
      : member.id === 7
        ? `کمتر از ${minIndependentSignals} منبع کلانِ سالم با سنجهٔ جهت‌ساز تازه در اتاق ETH موجود است.`
        : member.id === 8
          ? 'فیلتر خبر ETH در پنجرهٔ تازگی منبع، خبر کافی از دو ناشر پیدا نکرد؛ تا دریافت خبر ETH تازه، رأی abstain است.'
          : `ورودی جهت‌ساز معتبر از حداقل ${minIndependentSignals} منبع ثبت‌شده برای عضو ${member.id} در اتاق ETH موجود نیست؛ رأی از ورودی عمومی/غیرهم‌اتاق ساخته نشد.`,
    [
      { labelFa: 'منابع دادهٔ معتبر', passed: validSources.length >= minIndependentSignals, detailFa: `${validSources.length} منبع داده معتبر از ${registeredIds.length}.` },
      { labelFa: 'سیگنال جهت‌ساز اختصاصی', passed: false, detailFa: member.id >= 6 ? 'داده‌های ثبت‌شده برای این عضو جریان/جهت بازار را به‌تنهایی اثبات نمی‌کنند.' : `فقط ${sourceSignals.length} منبع دارای metric جهت‌ساز قابل‌استفاده است.` },
    ],
    sourceTimestampMs,
    sourceTimestampMs === null ? null : nowMs - sourceTimestampMs,
  );
  const primaryObservedSource = observedSources[0] ??
    checks.find(({ sourceId }) => registeredIds.includes(sourceId));
  return {
    ...abstention,
    sourceId: primaryObservedSource?.sourceId ?? null,
    fallbackSourceId: null,
  };
}

export function evaluateEightMemberCouncil(input: {
  analysis?: Partial<AnalysisResult> | null;
  macroContext?: CouncilMacroContext | null;
  directMacroData?: FreeMacroDataResult;
  optionsData?: CouncilOptionsData | null;
  whaleFlowData?: CouncilWhaleFlowData | null;
  memberSourceChecks?: Readonly<Record<number, readonly CouncilMemberSourceCheck[]>>;
  requireMemberSourceQuorum?: boolean;
  pair?: string;
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
    () => evaluateOptions(members[4], input.optionsData, nowMs, input.pair),
    () => evaluateOnChain(members[5], input.macroContext, nowMs, input.whaleFlowData ?? undefined, input.pair),
    () => evaluateMacro(members[6], input.macroContext, nowMs, input.directMacroData, input.pair),
    () => evaluateNews(members[7], input.macroContext, nowMs, input.pair),
  ];
  const evaluatedVotes = evaluators.map((evaluate, index) => {
    const memberId = index + 1;
    return reuseCachedMemberVote(
      input.previousMemberEvidence?.[memberId],
      input.evidenceFingerprints?.[memberId],
      nowMs,
    ) ?? evaluate();
  });
  const sourceDrivenVotes = input.requireMemberSourceQuorum && input.pair
    ? evaluatedVotes.map((vote) => {
      const sourceChecks = input.memberSourceChecks?.[vote.id];
      return sourceChecks
        ? evaluatePrimaryAssetSourceVote(
          EIGHT_MEMBER_COUNCIL[vote.id - 1],
          sourceChecks,
          nowMs,
          input.macroContext,
          input.pair,
        )
        : vote;
    })
    : evaluatedVotes;
  const attributedVotes = sourceDrivenVotes.map((vote) => ({
    ...vote,
    ...(() => {
      const memberId = vote.id;
      const feed = memberId === 1
        ? input.analysis?.dataQualityReport?.feeds.candles
        : memberId === 2
          ? input.analysis?.dataQualityReport?.feeds.orderFlow
          : memberId === 3
            ? input.analysis?.dataQualityReport?.feeds.orderBook
            : memberId === 4
              ? input.analysis?.dataQualityReport?.feeds.derivatives
              : undefined;
      const directMetric = memberId === 7
        ? [
          input.directMacroData?.dxy,
          input.directMacroData?.sp500,
          input.directMacroData?.broadDollar,
          input.directMacroData?.fedEffectiveRate,
        ].find((metric) => metric?.status === 'LIVE')
        : undefined;
      const provider = memberId <= 4
        ? feed?.source
        : memberId === 5
          ? input.optionsData?.provider
          : memberId === 6
            ? input.whaleFlowData?.provider
            : memberId === 7
              ? directMetric?.provider
              : input.macroContext?.recentHeadlines?.[0]?.source;
      const explicitSourceId = memberId === 5
        ? input.optionsData?.sourceId
        : memberId === 6
          ? input.whaleFlowData?.sourceId
          : undefined;
      const explicitFallbackSourceId = memberId === 5
        ? input.optionsData?.fallbackSourceId
        : memberId === 6
          ? input.whaleFlowData?.fallbackSourceId
          : undefined;
      return {
        sourceId: vote.sourceId ?? explicitSourceId ?? sourceIdForProvider(memberId, provider),
        fallbackSourceId: vote.fallbackSourceId ?? explicitFallbackSourceId ?? null,
      };
    })(),
    supportingEvidence: vote.moduleIds.map((moduleId) => input.supportingModules?.[moduleId] ?? {
      moduleId,
      nameFa: moduleId,
      status: 'UNAVAILABLE' as const,
      sourceTimestampMs: null,
      summaryFa: 'خروجی این ماژول هنوز به شورا نرسیده است؛ در رأی عضو دخالت ندارد.',
    }),
  }));
  const votes = attributedVotes.map((vote) => {
    if (!input.requireMemberSourceQuorum) return vote;

    const asset = getFreqtradePairBaseAsset(input.pair ?? '') ?? 'ETH';
    const registeredSources = getCouncilMemberSources(vote.id, asset);
    const suppliedChecks = input.memberSourceChecks?.[vote.id];
    if (!suppliedChecks) {
      return {
        ...vote,
        healthySourceCount: null,
        sourceChecks: [],
      };
    }
    const checksById = new Map(suppliedChecks.map((check) => [check.sourceId, check]));
    const sourceChecks = registeredSources.map((source): CouncilMemberSourceCheck =>
      checksById.get(source.id) ?? {
        sourceId: source.id,
        status: 'UNTESTED',
        detail: 'No live source check was supplied for this request.',
      }
    );
    const healthySourceCount = sourceChecks.filter(({ status }) => status === 'HEALTHY').length;
    const usedSourceIndex = registeredSources.findIndex(({ id }) => id === vote.sourceId);
    const minimumHealthySources = vote.id === 2 ? 1 : 2;
    const quorumPassed = healthySourceCount >= minimumHealthySources;
    const usedFallback = usedSourceIndex > 0 &&
      sourceChecks.slice(0, usedSourceIndex).some(({ status }) => status !== 'HEALTHY');
    const fallbackSourceId = usedFallback ? vote.sourceId : vote.fallbackSourceId;
    const failedSourceCheck: CouncilQualityCheck = {
      labelFa: 'سلامت منابع عضو',
      passed: quorumPassed,
      detailFa: `${healthySourceCount}/${registeredSources.length} منبع سالم؛ حداقل ${minimumHealthySources} لازم است؛ منبع دادهٔ رأی ${vote.sourceId ?? 'در شواهد خام مشخص نشده است.'}`,
    };
    return {
      ...vote,
      vote: quorumPassed ? vote.vote : 'ABSTAIN',
      rationaleFa: quorumPassed || vote.id === 6 || vote.id === 8
        ? vote.rationaleFa
        : `ABSTAIN: فقط ${healthySourceCount}/${registeredSources.length} منبع عضو سالم است؛ حداقل ${minimumHealthySources} منبع سالم لازم است. وضعیت منابع: ${sourceChecks.map(({ sourceId, status }) => `${sourceId}=${status}`).join(', ')}.`,
      fallbackSourceId,
      healthySourceCount,
      sourceChecks,
      confidencePct: quorumPassed ? vote.confidencePct : null,
      qualityChecks: [...vote.qualityChecks, failedSourceCheck],
    };
  });
  const longVotes = votes.filter(({ vote }) => vote === 'LONG').length;
  const shortVotes = votes.filter(({ vote }) => vote === 'SHORT').length;
  const neutralVotes = votes.filter(({ vote }) => vote === 'NEUTRAL').length;
  const abstentions = votes.filter(({ vote }) => vote === 'ABSTAIN').length;
  const weightedVotes = getCouncilWeightedVoteCounts(votes);
  const selectedDirection: CouncilDirection = weightedVotes.long >= 5
    ? 'LONG'
    : weightedVotes.short >= 5
      ? 'SHORT'
      : null;
  const summaryFa = selectedDirection
    ? `شورا با وزن مؤثر ${selectedDirection === 'LONG' ? weightedVotes.long.toFixed(1) : weightedVotes.short.toFixed(1)} از حدنصاب ۵ جهت ${selectedDirection} را انتخاب کرد (رأی خام LONG: ${longVotes}، SHORT: ${shortVotes})؛ این نتیجه به‌تنهایی مجوز اجرای معامله نیست.`
    : `حدنصاب وزن‌دار ۵ رأی از ۸ عضو حاصل نشد (LONG: ${weightedVotes.long.toFixed(1)}، SHORT: ${weightedVotes.short.toFixed(1)}؛ رأی خام LONG: ${longVotes}، SHORT: ${shortVotes}، خنثی: ${neutralVotes}، ممتنع: ${abstentions})؛ جهت انتخاب نشد.`;

  return {
    evaluatedAtMs: nowMs,
    quorumRequired: 5,
    members: votes,
    longVotes,
    shortVotes,
    weightedLongVotes: weightedVotes.long,
    weightedShortVotes: weightedVotes.short,
    neutralVotes,
    abstentions,
    selectedDirection,
    quorumMet: selectedDirection !== null,
    summaryFa,
  };
}
