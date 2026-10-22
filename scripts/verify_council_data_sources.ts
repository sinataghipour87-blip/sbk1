import dotenv from 'dotenv';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fetchDirectNewsHeadlines } from '../src/services/directNewsFeeds';
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
const onChainRecordsValid = onChainData.status === 'LIVE' &&
  onChainData.coverageStatus === 'SAMPLED' &&
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
  onChainFresh &&
  ['NEUTRAL', 'ABSTAIN'].includes(whaleMemberVote.vote);

const report = {
  checkedAt: new Date().toISOString(),
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
      error: result.status === 'UNAVAILABLE' ? result.error : undefined,
    }]),
  ),
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
    sources: news.sources.map(({ publisher, status, headlineCount, error }) => ({
      publisher,
      status,
      headlineCount,
      ...(error ? { error } : {}),
    })),
  },
};

const macroFeedsWithoutDxy = Object.entries(macro)
  .filter(([name]) => name !== 'dxy' && name !== 'dxyProxy')
  .map(([, result]) => result);
const ready =
  macroFeedsWithoutDxy.every((result) => result.status === 'LIVE') &&
  (macro.dxy.status === 'LIVE' || macro.dxyProxy?.status === 'LIVE') &&
  [
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
  ].every((feed) => feed.status === 'LIVE') &&
  options.status === 'LIVE' &&
  onChainMemberVerified &&
  news.status === 'LIVE' &&
  news.headlines.length >= 3 &&
  new Set(news.headlines.map(({ publisher }) => publisher)).size >= 2 &&
  memberVotes[7]?.vote !== 'ABSTAIN';

console.log(JSON.stringify({ ready, ...report }, null, 2));
if (!ready) process.exitCode = 1;
