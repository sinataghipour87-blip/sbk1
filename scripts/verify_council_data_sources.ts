import dotenv from 'dotenv';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fetchDirectNewsHeadlines } from '../src/services/directNewsFeeds';
import { buildCouncilSourceRegistry, type CouncilSourceObservation } from '../src/services/councilSourceRegistry';
import { fetchDeribitOptionsData } from '../src/services/deribitOptionsData';
import { fetchFreeMacroData } from '../src/services/freeMacroData';
import { fetchOnChainWhaleData } from '../src/services/publicBitcoinWhaleData';
import { fetchPublicMarketFallback } from '../src/services/publicMarketDataFallback';
import { openSourceAdvisoryService } from '../src/services/openSourceAdvisoryService';
import type { AnalysisResult } from '../src/types/trading';
import type { CouncilMacroContext, CouncilMemberVote } from '../src/services/eightMemberCouncil';
import { runEightMemberCouncilRuntime } from '../src/services/eightMemberCouncilRuntime';
import { applyPublicMarketFallbackToCouncilAnalysis } from '../src/services/serverSignalRunner';

dotenv.config();
const probeStartedAtMs = Date.now();

const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() ||
  process.env.FREQTRADE_PAIR?.trim() ||
  'BTC/USDT:USDT';
const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() ||
  process.env.FREQTRADE_TIMEFRAME?.trim() ||
  '1m';
const market = process.env.SBK1_MARKET?.trim() === 'spot' ? 'spot' : 'futures';
const [macro, options, onChainData, news, publicMarketFallback] = await Promise.all([
  fetchFreeMacroData(),
  fetchDeribitOptionsData(),
  fetchOnChainWhaleData(),
  fetchDirectNewsHeadlines(),
  fetchPublicMarketFallback({ pair, timeframe, market, nowMs: probeStartedAtMs }),
]);
const checkedAtMs = Date.now();
const sourceObservations: Record<string, CouncilSourceObservation> = {};
const recordObservation = (
  id: string,
  observation: CouncilSourceObservation,
): void => {
  sourceObservations[id] = observation;
};
const recordMetric = (
  id: string,
  metric: (typeof macro)[keyof typeof macro],
  symbol: string,
): void => {
  if (metric.error?.includes('Not requested because a direct DXY source is available.')) return;
  recordObservation(id, {
    responseTimestampMs: id === 'macro.tradingview-dxy-proxy' ? null : metric.observedAtMs,
    receivedAtMs: metric.retrievedAtMs,
    status: metric.status,
    url: metric.endpoint,
    symbol,
    error: metric.status === 'UNAVAILABLE' ? metric.error : undefined,
  });
};
recordMetric(
  macro.sp500.provider.includes('FRED') ? 'macro.fred-sp500' : 'macro.yahoo-sp500',
  macro.sp500,
  macro.sp500.provider.includes('FRED') ? 'SP500' : '^GSPC',
);
recordMetric(
  macro.dxy.provider.includes('Massive') ? 'macro.massive-dxy' : 'macro.yahoo-dxy',
  macro.dxy,
  macro.dxy.provider.includes('Massive') ? 'I:DXY' : 'DX-Y.NYB',
);
if (macro.dxy.error?.includes('Primary Massive Indices API:')) {
  recordObservation('macro.massive-dxy', {
    responseTimestampMs: null,
    receivedAtMs: null,
    status: 'UNAVAILABLE',
    error: macro.dxy.error,
  });
}
if (macro.dxyProxy) recordMetric('macro.tradingview-dxy-proxy', macro.dxyProxy, 'TVC:DXY');
recordMetric('macro.fred-broad-dollar', macro.broadDollar, 'DTWEXBGS');
recordMetric(
  macro.fedEffectiveRate.provider.includes('New York Fed')
    ? 'macro.nyfed-effr'
    : 'macro.fred-effective-rate',
  macro.fedEffectiveRate,
  'EFFR',
);
recordMetric('macro.fred-target-upper', macro.fedTargetUpperBound, 'DFEDTARU');
recordMetric('onchain.coinmetrics-active-addresses', macro.bitcoinActiveAddresses, 'BTC');
for (const source of news.sources) {
  const sourceId = source.publisher === 'Federal Reserve'
    ? 'news.federal-reserve'
    : source.publisher === 'U.S. Securities and Exchange Commission'
      ? 'news.sec'
      : source.publisher === 'Bitcoin Magazine'
        ? 'news.bitcoin-magazine'
        : source.publisher === 'The Guardian'
          ? 'news.guardian'
        : source.publisher === 'The Wall Street Journal'
          ? 'news.wsj'
          : `news.${source.publisher.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const timestampMs = news.headlines
    .filter((headline) => headline.publisher === source.publisher)
    .reduce((latest, headline) => Math.max(latest, Date.parse(headline.publishedAt)), 0);
  recordObservation(sourceId, {
    responseTimestampMs: timestampMs || null,
    receivedAtMs: source.retrievedAtMs,
    status: source.status,
    url: source.endpoint,
    error: source.error,
  });
}
recordObservation('options.deribit-summary', {
  responseTimestampMs: options.timestampMs,
  receivedAtMs: options.retrievedAtMs ?? null,
  status: options.status,
  error: options.status === 'UNAVAILABLE' ? 'No valid, fresh Deribit option contracts were returned.' : undefined,
});
const onChainProviderId = onChainData.provider.includes('Blockstream')
  ? 'onchain.blockstream-blocks'
  : 'onchain.mempool-blocks';
recordObservation(onChainProviderId, {
  responseTimestampMs: onChainData.timestampMs,
  receivedAtMs: onChainData.retrievedAtMs ?? null,
  status: onChainData.status,
  error: onChainData.unavailableReason,
});
const marketSymbol = `${pair.match(/^([A-Z0-9]+)\/USDT/i)?.[1] ?? 'BTC'}USDT`;
const recordMarketFeed = (
  id: string,
  feed: {
    status: 'LIVE' | 'UNAVAILABLE';
    sourceTimestampMs: number | null;
    endpoint?: string;
    receivedAtMs?: number | null;
    error?: string;
  },
): void => {
  if (!feed.endpoint) return;
  recordObservation(id, {
    responseTimestampMs: feed.sourceTimestampMs,
    receivedAtMs: feed.receivedAtMs ?? null,
    status: feed.status,
    url: feed.endpoint,
    symbol: marketSymbol,
    error: feed.status === 'UNAVAILABLE' ? feed.error : undefined,
  });
};
recordMarketFeed('orderbook.binance-depth', publicMarketFallback.orderBook);
recordMarketFeed('orderbook.binance-trades', publicMarketFallback.tradeFlow);
recordMarketFeed('derivatives.binance-funding', publicMarketFallback.fundingRate);
recordMarketFeed('derivatives.binance-open-interest-history', publicMarketFallback.openInterest);
recordMarketFeed('derivatives.binance-open-interest-live', publicMarketFallback.liveOpenInterest);
for (const source of publicMarketFallback.exchangeQuoteSources) {
  const sourceId = `orderbook.exchange-${source.exchange}-price`;
  recordObservation(sourceId, {
    responseTimestampMs: source.responseTimestampMs,
    receivedAtMs: source.receivedAtMs,
    status: source.status,
    url: source.endpoint,
    symbol: source.symbol,
    error: source.status === 'UNAVAILABLE' ? source.error : undefined,
  });
}
if (!process.env.ETHERSCAN_API_KEY?.trim() ||
    !process.env.SBK1_ETHERSCAN_WATCH_ADDRESSES?.trim()) {
  recordObservation('onchain.etherscan-transfers', {
    responseTimestampMs: null,
    receivedAtMs: null,
    status: 'UNAVAILABLE',
    error: 'Optional source is inactive: ETHERSCAN_API_KEY and SBK1_ETHERSCAN_WATCH_ADDRESSES are both required.',
  });
}
if (!process.env.WHALE_ALERT_API_KEY?.trim()) {
  recordObservation('onchain.whale-alert', {
    responseTimestampMs: null,
    receivedAtMs: null,
    status: 'UNAVAILABLE',
    error: 'Optional fallback is inactive: WHALE_ALERT_API_KEY is not configured.',
  });
}
const sourceRegistry = buildCouncilSourceRegistry(sourceObservations, checkedAtMs);
let newsAdvisoryReport: Awaited<ReturnType<typeof openSourceAdvisoryService.analyze>> | null = null;
let newsAdvisoryError: string | null = null;
if (news.headlines.length > 0 && publicMarketFallback.candles.value) {
  try {
    newsAdvisoryReport = await openSourceAdvisoryService.analyze(
      publicMarketFallback.candles.value.slice(-500),
      news.headlines,
    );
  } catch (error) {
    newsAdvisoryError = error instanceof Error ? error.message : String(error);
  }
}
const marketAnalysis = await applyPublicMarketFallbackToCouncilAnalysis(
  {
    price: publicMarketFallback.candles.value?.at(-1)?.close ?? 0,
    candles: publicMarketFallback.candles.value?.map((candle) => [
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ]) ?? [],
    timeframe,
    openSourceAdvisories: newsAdvisoryReport ?? undefined,
  } as unknown as AnalysisResult,
  publicMarketFallback,
  checkedAtMs,
);
marketAnalysis.htfCandles = {
  ...marketAnalysis.htfCandles,
  '1m': publicMarketFallback.fastCandles.value?.map((candle) => [
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ]) ?? [],
  '1h': publicMarketFallback.higherTimeframeCandles['1h'].value?.map((candle) => [
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ]) ?? [],
  '4h': publicMarketFallback.higherTimeframeCandles['4h'].value?.map((candle) => [
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ]) ?? [],
};
marketAnalysis.signalDataTimestamps = {
  ...marketAnalysis.signalDataTimestamps,
  mtf1mMs: publicMarketFallback.fastCandles.sourceTimestampMs,
  mtf1hMs: publicMarketFallback.higherTimeframeCandles['1h'].sourceTimestampMs,
  mtf4hMs: publicMarketFallback.higherTimeframeCandles['4h'].sourceTimestampMs,
};
const repositoryDir = await mkdtemp(path.join(os.tmpdir(), 'sbk1-live-council-source-'));
let whaleMemberVote: CouncilMemberVote;
let memberVotes: Array<{
  id: number;
  name: string;
  vote: CouncilMemberVote['vote'];
  sourceAgeMs: number | null;
  dataQualityPct: number | null;
  reason: string;
  evidence: Array<{ moduleId: string; status: string; sourceTimestampMs: number | null }>;
}> = [];
try {
  const runtimeReport = await runEightMemberCouncilRuntime({
    analysis: marketAnalysis,
    macroContext: {
      overallDataStatus: 'UNAVAILABLE',
      lastUpdatedTime: null,
      sp500Status: 'UNAVAILABLE',
      sp500DailyChangePct: null,
      dxyStatus: 'UNAVAILABLE',
      dxyDailyChangePct: null,
      etfFlowStatus: 'UNAVAILABLE',
      spotEtfNetInflowMillionUsd: null,
      newsSentimentStatus: 'UNAVAILABLE',
      newsSentimentScore: null,
      newsHeadlinesStatus: 'UNAVAILABLE',
      recentHeadlines: [],
      whaleFlowStatus: 'UNKNOWN',
      whaleNetflowBtc: null,
      whalePressureIndex: null,
      whaleSentiment: 'UNKNOWN',
      fundamentalBias: 'UNAVAILABLE',
    } satisfies CouncilMacroContext,
    freeMacroData: macro,
    optionsData: options,
    whaleFlowData: onChainData,
    publicMarketFallback,
    decisionSnapshotTimestampMs: publicMarketFallback.candles.sourceTimestampMs ?? checkedAtMs,
    repositoryDir,
    nowMs: checkedAtMs,
  });
  whaleMemberVote = runtimeReport.members[5];
  memberVotes = runtimeReport.members.map((member) => ({
    id: member.id,
    name: member.nameFa,
    vote: member.vote,
    sourceAgeMs: member.sourceAgeMs,
    dataQualityPct: member.dataQualityPct,
    reason: member.rationaleFa,
    evidence: member.supportingEvidence.map(({ moduleId, status, sourceTimestampMs }) => ({
      moduleId,
      status,
      sourceTimestampMs,
    })),
  }));
} finally {
  await rm(repositoryDir, { recursive: true, force: true });
  await openSourceAdvisoryService.stop();
}
const onChainFresh = onChainData.timestampMs !== null &&
  checkedAtMs >= onChainData.timestampMs &&
  checkedAtMs - onChainData.timestampMs <= 5 * 60_000;
const onChainRecordsValid = onChainData.coverageStatus === 'SAMPLED' &&
  Array.isArray(onChainData.largeTransfers) &&
  onChainData.largeTransfers.every((transfer) =>
    transfer.transactionHash.length > 0 &&
    transfer.blockchain.length > 0 &&
    transfer.amount > 0 &&
    Number.isFinite(transfer.timestampMs) &&
    ['CONFIRMED', 'UNCONFIRMED', 'UNKNOWN'].includes(transfer.confirmationStatus)
  ) &&
  new Set(onChainData.largeTransfers.map((transfer) =>
    `${transfer.blockchain}:${transfer.transactionHash}:${transfer.transferId ?? ''}`
  )).size === onChainData.largeTransfers.length;
const onChainMemberVerified = onChainRecordsValid &&
  onChainData.status === 'LIVE' &&
  onChainFresh &&
  ['NEUTRAL', 'ABSTAIN'].includes(whaleMemberVote.vote);

const report = {
  checkedAt: new Date(checkedAtMs).toISOString(),
  credentials: {
    fredApiKeyRequired: false,
    massiveApiKeyConfigured: Boolean(process.env.MASSIVE_API_KEY?.trim()),
    whaleAlertApiKeyConfigured: Boolean(process.env.WHALE_ALERT_API_KEY?.trim()),
  },
  macro: Object.fromEntries(
    Object.entries(macro).map(([name, result]) => [name, {
      status: result.status,
      provider: result.provider,
      endpoint: result.endpoint,
      observedAt: result.observedAt,
      observedAtMs: result.observedAtMs,
      retrievedAtMs: result.retrievedAtMs,
      ageMs: result.ageMs,
      error: result.status === 'UNAVAILABLE' ? result.error : undefined,
    }]),
  ),
  sourceRegistry: {
    generatedAt: new Date(checkedAtMs).toISOString(),
    entries: sourceRegistry,
    counts: Object.fromEntries(
      ['onchain', 'macro', 'news', 'derivatives', 'options', 'orderbook'].map((group) => [
        group,
        {
          total: sourceRegistry.filter((entry) => entry.group === group).length,
          enabled: sourceRegistry.filter((entry) => entry.group === group && entry.enabled).length,
          disabled: sourceRegistry.filter((entry) => entry.group === group && !entry.enabled).length,
          byHealth: Object.fromEntries(
            ['LIVE', 'STALE', 'UNAVAILABLE', 'DISABLED', 'UNOBSERVED'].map((health) => [
              health,
              sourceRegistry.filter((entry) => entry.group === group && entry.health === health).length,
            ]),
          ),
        },
      ]),
    ),
  },
  options: {
    status: options.status,
    provider: options.provider,
    observedAtMs: options.timestampMs,
    ageMs: options.ageMs,
    contractsCount: options.contractsCount,
    qualityPct: options.qualityPct,
  },
  onChainEvidence: {
    status: onChainData.status,
    provider: onChainData.provider,
    coverageStatus: onChainData.coverageStatus ?? 'UNKNOWN',
    observedAtMs: onChainData.timestampMs,
    ageMs: onChainData.ageMs,
    retrievedAtMs: onChainData.retrievedAtMs ?? null,
    requestAgeMs: onChainData.retrievedAtMs === null || onChainData.retrievedAtMs === undefined
      ? null
      : Math.max(0, checkedAtMs - onChainData.retrievedAtMs),
    observedOutputCount: onChainData.transactionCount,
    unavailableReason: onChainData.unavailableReason,
    fresh: onChainFresh,
    fieldsValidAndDeduplicated: onChainRecordsValid,
    memberVote: whaleMemberVote.vote,
    memberRationale: whaleMemberVote.rationaleFa,
    memberVerified: onChainMemberVerified,
  },
  councilMemberProbe: {
    note: 'The probe uses live public market fallback data, not the configured Freqtrade DataProvider snapshot, and never executes orders.',
    members: memberVotes,
  },
  market: {
    provider: publicMarketFallback.provider,
    venue: publicMarketFallback.venue,
    market: publicMarketFallback.market,
    pair: publicMarketFallback.pair,
    timeframe: publicMarketFallback.timeframe,
    feeds: Object.fromEntries(
      Object.entries({
        exchangeQuotes: publicMarketFallback.exchangeQuotes,
        candles: publicMarketFallback.candles,
        trades: publicMarketFallback.tradeFlow,
        orderBook: publicMarketFallback.orderBook,
        funding: publicMarketFallback.fundingRate,
        openInterest: publicMarketFallback.openInterest,
        liveOpenInterest: publicMarketFallback.liveOpenInterest,
        fastCandles: publicMarketFallback.fastCandles,
        oneHourCandles: publicMarketFallback.higherTimeframeCandles['1h'],
        fourHourCandles: publicMarketFallback.higherTimeframeCandles['4h'],
      }).map(([name, feed]) => [name, {
        status: feed.status,
        sourceTimestampMs: feed.sourceTimestampMs,
        ageMs: feed.sourceTimestampMs === null ? null : checkedAtMs - feed.sourceTimestampMs,
        isPartial: feed.isPartial === true,
        error: feed.error,
      }]),
    ),
  },
  news: {
    status: news.status,
    headlineCount: news.headlines.length,
    publisherCount: new Set(news.headlines.map(({ publisher }) => publisher)).size,
    sentimentStatus: newsAdvisoryReport?.modules.newsSentiment.status ?? 'UNAVAILABLE',
    sentimentHeadlineCount: newsAdvisoryReport?.modules.newsSentiment.headlineCount ?? 0,
    sentimentScore: newsAdvisoryReport?.modules.newsSentiment.aggregateSentiment ?? null,
    sentimentError: newsAdvisoryError,
    memberEightVote: memberVotes[7]?.vote ?? 'UNKNOWN',
    sources: news.sources.map(({ publisher, status, responseTimestampMs, retrievedAtMs, ageMs, headlineCount, error }) => ({
      publisher,
      status,
      responseTimestampMs,
      retrievedAtMs,
      ageMs,
      headlineCount,
      ...(error ? { error } : {}),
    })),
  },
};

const dxySourceStatus = macro.dxy.status === 'LIVE'
  ? 'OFFICIAL'
  : macro.dxyProxy?.status === 'LIVE'
    ? 'CFD_PROXY'
    : 'UNAVAILABLE';

const macroFeedsWithoutDxy = Object.entries(macro)
  .filter(([name]) => name !== 'dxy' && name !== 'dxyProxy')
  .map(([, result]) => result);
const registryEntry = (id: string) => sourceRegistry.find((entry) => entry.id === id);
const selectedDxySourceId = macro.dxy.status === 'LIVE'
  ? macro.dxy.provider.includes('Massive') ? 'macro.massive-dxy' : 'macro.yahoo-dxy'
  : 'macro.tradingview-dxy-proxy';
const selectedOnchainSourceId = onChainData.provider.includes('Blockstream')
  ? 'onchain.blockstream-blocks'
  : 'onchain.mempool-blocks';
const freshCrossExchangePriceCount = publicMarketFallback.exchangeQuoteSources.filter((source) =>
  source.status === 'LIVE' &&
  registryEntry(`orderbook.exchange-${source.exchange}-price`)?.health === 'LIVE'
).length;
const requiredFreshRegistryIds = [
  'orderbook.binance-depth',
  'orderbook.binance-trades',
  'options.deribit-summary',
  selectedOnchainSourceId,
  selectedDxySourceId,
  ...(market === 'futures'
    ? [
        'derivatives.binance-funding',
        'derivatives.binance-open-interest-history',
        'derivatives.binance-open-interest-live',
      ]
    : []),
];
const registrySourcesFresh =
  requiredFreshRegistryIds.every((id) => registryEntry(id)?.health === 'LIVE') &&
  freshCrossExchangePriceCount >= 2 &&
  sourceRegistry.filter((entry) => entry.group === 'news' && entry.health === 'LIVE').length >= 2;
const requiredMarketFeeds = [
  publicMarketFallback.exchangeQuotes,
  publicMarketFallback.candles,
  publicMarketFallback.tradeFlow,
  publicMarketFallback.orderBook,
  ...(market === 'futures'
    ? [
        publicMarketFallback.fundingRate,
        publicMarketFallback.openInterest,
        publicMarketFallback.liveOpenInterest,
      ]
    : []),
  publicMarketFallback.fastCandles,
  publicMarketFallback.higherTimeframeCandles['1h'],
  publicMarketFallback.higherTimeframeCandles['4h'],
];
const readinessReasons = [
  ...requiredFreshRegistryIds
    .filter((id) => registryEntry(id)?.health !== 'LIVE')
    .map((id) => {
      const entry = registryEntry(id);
      return `${id}: ${entry?.health ?? 'UNOBSERVED'} - ${entry?.reason ?? 'No registry entry.'}`;
    }),
  ...(freshCrossExchangePriceCount < 2
    ? [`Cross-exchange price evidence: only ${freshCrossExchangePriceCount} fresh normalized venues; minimum is 2.`]
    : []),
  ...(macroFeedsWithoutDxy.some((result) => result.status !== 'LIVE')
    ? ['One or more required macro-context metrics are unavailable or stale.']
    : []),
  ...(macro.dxy.status !== 'LIVE' && macro.dxyProxy?.status !== 'LIVE'
    ? ['Neither official DXY nor the explicitly labeled CFD proxy is currently available.']
    : []),
  ...(requiredMarketFeeds.some((feed) => feed.status !== 'LIVE')
    ? ['One or more required public market feeds are unavailable or stale.']
    : []),
  ...(options.status !== 'LIVE' ? ['Fresh valid options evidence is unavailable.'] : []),
  ...(!onChainMemberVerified ? ['Member 6 lacks fresh, valid on-chain evidence and must abstain.'] : []),
  ...(news.status !== 'LIVE' || news.headlines.length < 3 ||
      new Set(news.headlines.map(({ publisher }) => publisher)).size < 2
    ? ['Fresh news coverage does not meet the minimum headline and publisher requirements.']
    : []),
  ...(memberVotes[7]?.vote === 'ABSTAIN' ? ['Member 8 abstained.'] : []),
];
const ready =
  registrySourcesFresh &&
  macroFeedsWithoutDxy.every((result) => result.status === 'LIVE') &&
  (macro.dxy.status === 'LIVE' || macro.dxyProxy?.status === 'LIVE') &&
  requiredMarketFeeds.every((feed) => feed.status === 'LIVE') &&
  options.status === 'LIVE' &&
  onChainMemberVerified &&
  news.status === 'LIVE' &&
  news.headlines.length >= 3 &&
  new Set(news.headlines.map(({ publisher }) => publisher)).size >= 2 &&
  memberVotes[7]?.vote !== 'ABSTAIN';

console.log(JSON.stringify({
  ready,
  readinessReasons,
  ...report,
  macro: { ...report.macro, dxySourceStatus },
}, null, 2));
if (!ready) process.exitCode = 1;
