import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AnalysisResult, DataQualityReport } from '../src/types/trading';
import {
  fetchPublicMarketFallback,
} from '../src/services/publicMarketDataFallback';
import { applyPublicMarketFallbackToCouncilAnalysis } from '../src/services/serverSignalRunner';
import { runEightMemberCouncilRuntime } from '../src/services/eightMemberCouncilRuntime';
import type { CouncilMacroContext } from '../src/services/eightMemberCouncil';

const realDateNow = Date.now;
const nowMs = Math.floor(realDateNow() / 60_000) * 60_000 + 2_000;
Date.now = () => nowMs;

const latestCloseMs = Math.floor(nowMs / 60_000) * 60_000;
const candleRows = Array.from({ length: 40 }, (_, index) => {
  const openTimestamp = latestCloseMs - (40 - index) * 60_000;
  const open = 100 + index;
  return [
    openTimestamp,
    String(open),
    String(open + 2),
    String(open - 1),
    String(open + 1),
    '10',
  ];
});
const latestOiTimestamp = Math.floor(nowMs / (5 * 60_000)) * 5 * 60_000;
const payloads = new Map<string, unknown>([
  ['/fapi/v1/klines', candleRows],
  ['/fapi/v1/ticker/price', {
    symbol: 'BTCUSDT',
    price: '101',
    time: nowMs - 500,
  }],
  ['/fapi/v1/depth', {
    bids: [['100', '5'], ['99', '3']],
    asks: [['101', '2'], ['102', '2']],
  }],
  ['/fapi/v1/aggTrades', [
    { T: nowMs - 1_500, p: '100', q: '2', m: false },
    { T: nowMs - 1_000, p: '101', q: '1', m: true },
  ]],
  ['/fapi/v1/premiumIndex', {
    lastFundingRate: '-0.0002',
    time: nowMs - 500,
  }],
  ['/futures/data/openInterestHist', [
    { timestamp: latestOiTimestamp - 5 * 60_000, sumOpenInterest: '9000' },
    { timestamp: latestOiTimestamp, sumOpenInterest: '10000' },
  ]],
  ['api.bybit.com/v5/market/tickers', {
    retCode: 0,
    time: nowMs - 400,
    result: { list: [{ symbol: 'BTCUSDT', lastPrice: '100.5' }] },
  }],
  ['www.okx.com/api/v5/market/ticker', {
    code: '0',
    data: [{ instId: 'BTC-USDT-SWAP', last: '100.25', ts: String(nowMs - 300) }],
  }],
]);
let aggTradeRequestCount = 0;
const fixtureFetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === '/fapi/v1/aggTrades' && aggTradeRequestCount++ === 0) {
    return new Response('', { status: 429, headers: { 'retry-after': '0' } });
  }
  const payload = payloads.get(`${url.hostname}${url.pathname}`) ?? payloads.get(url.pathname);
  if (payload === undefined) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const fallback = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: fixtureFetcher,
  timeoutMs: 100,
});
assert.equal(fallback.provider, 'Binance public REST API');
assert.equal(fallback.candles.status, 'LIVE');
assert.equal(fallback.candles.value?.length, 40);
assert.equal(fallback.tradeFlow.status, 'LIVE');
assert.equal(aggTradeRequestCount, 2, '429 responses must receive one bounded retry');
assert.equal(fallback.orderBook.status, 'LIVE');
assert.equal(fallback.fundingRate.status, 'LIVE');
assert.equal(fallback.openInterest.status, 'LIVE');
assert.equal(fallback.exchangeQuotes.status, 'LIVE');
assert.deepEqual(
  fallback.exchangeQuotes.value?.map(({ exchange }) => exchange).sort(),
  ['binance', 'bybit', 'okx'],
);
assert.ok(fallback.exchangeQuotes.value?.every(({ sourceTimestampMs }) =>
  nowMs - sourceTimestampMs <= 5_000
));
const divergentQuoteFetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'fapi.binance.com' && url.pathname === '/fapi/v1/ticker/price') {
    return Response.json({
      symbol: 'BTCUSDT',
      price: '104',
      time: nowMs - 500,
    });
  }
  return fixtureFetcher(input, init);
};
const divergentQuotes = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: divergentQuoteFetcher,
  timeoutMs: 100,
});
assert.equal(divergentQuotes.exchangeQuotes.status, 'UNAVAILABLE');
assert.match(divergentQuotes.exchangeQuotes.error ?? '', /spread .* exceeds/);

const invalidFetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === '/fapi/v1/klines') {
    return new Response(JSON.stringify(candleRows.slice(0, 10)), { status: 200 });
  }
  throw new Error('fixture network failure');
};
const unavailableFallback = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: invalidFetcher,
  timeoutMs: 100,
});
assert.equal(unavailableFallback.candles.status, 'UNAVAILABLE');
assert.equal(unavailableFallback.tradeFlow.status, 'UNAVAILABLE');
assert.equal(unavailableFallback.orderBook.status, 'UNAVAILABLE');
assert.equal(unavailableFallback.fundingRate.status, 'UNAVAILABLE');
assert.equal(unavailableFallback.openInterest.status, 'UNAVAILABLE');

const staleFallback = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs: nowMs + 20 * 60_000,
  fetcher: fixtureFetcher,
  timeoutMs: 100,
});
assert.equal(staleFallback.candles.status, 'UNAVAILABLE');
assert.equal(staleFallback.tradeFlow.status, 'UNAVAILABLE');
assert.equal(staleFallback.orderBook.status, 'UNAVAILABLE');
assert.equal(staleFallback.fundingRate.status, 'UNAVAILABLE');
assert.equal(staleFallback.openInterest.status, 'UNAVAILABLE');

const unavailableFeed = {
  feedName: 'unavailable primary feed',
  source: 'Freqtrade fixture',
  status: 'UNAVAILABLE' as const,
  timestamp: nowMs,
  ageMs: Number.POSITIVE_INFINITY,
  maxAgeMs: 5_000,
  latencyMs: null,
  score: 0,
  detailsFa: 'primary fixture deliberately unavailable',
};
const dataQualityReport: DataQualityReport = {
  overallScore: 0,
  isTradeAllowed: false,
  status: 'DATA_UNAVAILABLE',
  reasonsFa: ['Primary market snapshot fixture unavailable.'],
  feeds: {
    candles: unavailableFeed,
    orderBook: unavailableFeed,
    derivatives: unavailableFeed,
    futuresPrices: unavailableFeed,
    sentiment: unavailableFeed,
    orderFlow: unavailableFeed,
  },
};
const nominallyLiveQuality: DataQualityReport = {
  ...dataQualityReport,
  overallScore: 100,
  status: 'LIVE',
  feeds: Object.fromEntries(
    Object.entries(dataQualityReport.feeds).map(([name, feed]) => [
      name,
      { ...feed, status: 'LIVE' as const, timestamp: nowMs, ageMs: 0, score: 100 },
    ]),
  ) as DataQualityReport['feeds'],
};
const emptyAnalysis = {
  price: 100,
  direction: 'LONG',
  scoreLong: 0,
  scoreShort: 0,
  candles: [],
  rsi: 60,
  mtf1h: 'BULLISH',
  mtf4h: 'BULLISH',
  funding: null,
  fundingRate: null,
  oi: null,
  dataQualityReport: nominallyLiveQuality,
} as unknown as AnalysisResult;
const councilAnalysis = applyPublicMarketFallbackToCouncilAnalysis(
  emptyAnalysis,
  fallback,
  nowMs,
);
assert.equal(councilAnalysis.candles.length, 40);
assert.equal(councilAnalysis.orderFlowFeatures?.source?.includes('Binance public REST API'), true);
assert.equal(councilAnalysis.realObiData?.source?.includes('Binance public REST API'), true);
assert.equal(councilAnalysis.fundingRate, -0.0002);
assert.equal(councilAnalysis.oi, 10_000);

const macroContext: CouncilMacroContext = {
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
};
const repositoryDir = await mkdtemp(path.join(os.tmpdir(), 'sbk1-market-fallback-'));
try {
  const report = await runEightMemberCouncilRuntime({
    analysis: councilAnalysis,
    macroContext,
    publicMarketFallback: fallback,
    decisionSnapshotTimestampMs: fallback.candles.value!.at(-1)!.timestampMs,
    repositoryDir,
    nowMs,
  });
  assert.equal(report.members[0].vote, 'LONG');
  assert.equal(report.members[1].vote, 'LONG');
  assert.equal(report.members[2].vote, 'LONG');
  assert.equal(report.members[3].vote, 'LONG');
  const expectedEvidence = [
    [1, 'marketFallback.binanceCandles'],
    [2, 'marketFallback.binanceTrades'],
    [3, 'marketFallback.binanceOrderBook'],
    [4, 'marketFallback.binanceDerivatives'],
    [1, 'marketFallback.crossExchangePrices.member1'],
    [2, 'marketFallback.crossExchangePrices.member2'],
    [3, 'marketFallback.crossExchangePrices.member3'],
    [4, 'marketFallback.crossExchangePrices.member4'],
  ] as const;
  for (const [memberId, moduleId] of expectedEvidence) {
    const record = JSON.parse(
      await readFile(path.join(repositoryDir, `member-${String(memberId).padStart(2, '0')}.jsonl`), 'utf8')
        .then((content) => content.trim()),
    ) as {
      memberId: number;
      snapshotId: string;
      vote: string;
      sourceData: {
        marketFallback?: {
          provider: string;
          crossExchangeQuotes?: { status: string; quotes: Array<{ exchange: string }> };
        };
      };
      moduleOutputs: Array<{ moduleId: string; status: string; sourceTimestampMs: number | null }>;
    };
    assert.equal(record.memberId, memberId);
    assert.equal(record.sourceData.marketFallback?.provider, fallback.provider);
    assert.equal(record.sourceData.marketFallback?.crossExchangeQuotes?.status, 'LIVE');
    assert.deepEqual(
      record.sourceData.marketFallback?.crossExchangeQuotes?.quotes.map(({ exchange }) => exchange).sort(),
      ['binance', 'bybit', 'okx'],
    );
    assert.equal(
      record.moduleOutputs.find((item) => item.moduleId === moduleId)?.status,
      'AVAILABLE',
    );
    assert.ok(record.moduleOutputs.find((item) => item.moduleId === moduleId)?.sourceTimestampMs);
    assert.equal(record.vote, report.members[memberId - 1].vote);
  }

  const noSourceCouncil = await runEightMemberCouncilRuntime({
    analysis: {
      ...emptyAnalysis,
      candles: [],
    },
    macroContext,
    publicMarketFallback: unavailableFallback,
    decisionSnapshotTimestampMs: nowMs - 60_000,
    repositoryDir: path.join(repositoryDir, 'all-sources-down'),
    nowMs,
  });
  assert.deepEqual(
    noSourceCouncil.members.slice(0, 4).map(({ vote }) => vote),
    ['ABSTAIN', 'ABSTAIN', 'ABSTAIN', 'ABSTAIN'],
    'all four market members must fail closed when both primary and fallback feeds are unavailable',
  );
} finally {
  await rm(repositoryDir, { recursive: true, force: true });
  Date.now = realDateNow;
}

console.log('Public market fallback, retry, freshness, council voting, and member repository checks passed.');
