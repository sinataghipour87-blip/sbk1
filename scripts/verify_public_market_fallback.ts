import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AnalysisResult, DataQualityReport } from '../src/types/trading';
import {
  fetchPublicMarketCandles,
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
const makeHigherTimeframeRows = (durationMs: number) => {
  const latestCloseMs = Math.floor(nowMs / durationMs) * durationMs;
  return Array.from({ length: 40 }, (_, index) => {
    const openTimestamp = latestCloseMs - (40 - index) * durationMs;
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
};
const hourlyRows = makeHigherTimeframeRows(60 * 60_000);
const fourHourlyRows = makeHigherTimeframeRows(4 * 60 * 60_000);
const latestOiTimestamp = Math.floor(nowMs / (5 * 60_000)) * 5 * 60_000;
const payloads = new Map<string, unknown>([
  ['/fapi/v1/klines', candleRows],
  ['/fapi/v1/ticker/price', {
    symbol: 'BTCUSDT',
    price: '101',
    time: nowMs - 500,
  }],
  ['/fapi/v1/depth', {
    lastUpdateId: 77,
    bids: [['100', '5'], ['99', '3']],
    asks: [['101', '2'], ['102', '2']],
  }],
  ['/fapi/v1/aggTrades', [
    { a: 1, T: nowMs - 1_500, p: '100', q: '2', m: false },
    { a: 1, T: nowMs - 1_500, p: '100', q: '2', m: false },
    { a: 2, T: nowMs - 1_000, p: '101', q: '1', m: true },
  ]],
  ['/fapi/v1/premiumIndex', {
    symbol: 'BTCUSDT',
    lastFundingRate: '-0.0002',
    time: nowMs - 500,
  }],
  ['/futures/data/openInterestHist', [
    { timestamp: latestOiTimestamp - 5 * 60_000, sumOpenInterest: '9000' },
    { timestamp: latestOiTimestamp, sumOpenInterest: '10000' },
  ]],
  ['/fapi/v1/openInterest', {
    symbol: 'BTCUSDT',
    openInterest: '10025',
    time: nowMs - 100,
  }],
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
const candleRequestLimits: number[] = [];
const fixtureFetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === '/fapi/v1/klines') {
    candleRequestLimits.push(Number(url.searchParams.get('limit')));
    if (url.searchParams.get('interval') === '1h') return Response.json(hourlyRows);
    if (url.searchParams.get('interval') === '4h') return Response.json(fourHourlyRows);
  }
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
assert.equal(fallback.candles.provider, 'Binance public REST API');
assert.equal(fallback.candles.value?.length, 40);
assert.equal(fallback.fastCandles.status, 'LIVE');
const chartFallbackCandles = await fetchPublicMarketCandles({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: fixtureFetcher,
  timeoutMs: 100,
});
assert.equal(chartFallbackCandles.length, 40);
assert.deepEqual(chartFallbackCandles[0], {
  timestampMs: latestCloseMs - 40 * 60_000,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 10,
});
const bybitFallbackCandles = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'fapi.binance.com' && url.pathname === '/fapi/v1/klines') {
      return new Response('unavailable', { status: 503 });
    }
    if (url.hostname === 'api.bybit.com' && url.pathname === '/v5/market/kline') {
      return Response.json({
        retCode: 0,
        result: {
          symbol: 'BTCUSDT',
          list: candleRows.slice().reverse().map((row) => row.map(String)),
        },
      });
    }
    return new Response('unavailable', { status: 503 });
  },
  timeoutMs: 100,
});
assert.equal(bybitFallbackCandles.candles.status, 'LIVE');
assert.equal(bybitFallbackCandles.candles.provider, 'Bybit V5 public REST API');
assert.match(bybitFallbackCandles.candles.endpoint ?? '', /api\.bybit\.com\/v5\/market\/kline/);
assert.equal(bybitFallbackCandles.candles.isPartial, true);
assert.equal(bybitFallbackCandles.candles.value?.length, 40);
assert.deepEqual(bybitFallbackCandles.candles.value?.[0], {
  timestampMs: latestCloseMs - 40 * 60_000,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 10,
});
const okxFallbackCandles = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'fapi.binance.com' && url.pathname === '/fapi/v1/klines') {
      return new Response('unavailable', { status: 503 });
    }
    if (url.hostname === 'api.bybit.com' && url.pathname === '/v5/market/kline') {
      return Response.json({
        retCode: 0,
        result: { symbol: 'ETHUSDT', list: candleRows.slice().reverse().map((row) => row.map(String)) },
      });
    }
    if (url.hostname === 'www.okx.com' && url.pathname === '/api/v5/market/candles') {
      return Response.json({
        code: '0',
        data: candleRows.slice().reverse().map((row) => [
          String(row[0]), String(row[1]), String(row[2]), String(row[3]), String(row[4]),
          '1', '1', '1', '1',
        ]),
      });
    }
    return new Response('unavailable', { status: 503 });
  },
  timeoutMs: 100,
});
assert.equal(okxFallbackCandles.candles.status, 'LIVE');
assert.equal(okxFallbackCandles.candles.provider, 'OKX V5 public REST API');
assert.match(okxFallbackCandles.candles.endpoint ?? '', /www\.okx\.com\/api\/v5\/market\/candles/);
assert.equal(okxFallbackCandles.candles.isPartial, true);
assert.equal(okxFallbackCandles.candles.value?.length, 40);
assert.equal(
  okxFallbackCandles.candles.value?.[0].volume,
  1,
  'OKX futures volume is normalized from base-currency volume, not contract count',
);
assert.equal(fallback.fastCandles.sourceTimestampMs, fallback.candles.sourceTimestampMs);
assert.equal(fallback.higherTimeframeCandles['1h'].status, 'LIVE');
assert.equal(fallback.higherTimeframeCandles['4h'].status, 'LIVE');
assert.ok(candleRequestLimits.includes(500), 'historical candles are capped at 500 rows');
assert.ok(candleRequestLimits.every((limit) => limit <= 500));
assert.equal(fallback.tradeFlow.status, 'LIVE');
assert.equal(aggTradeRequestCount, 2, '429 responses must receive one bounded retry');
assert.match(fallback.tradeFlow.endpoint ?? '', /fapi\.binance\.com\/fapi\/v1\/aggTrades/);
assert.equal(fallback.tradeFlow.receivedAtMs, nowMs);
assert.equal(fallback.tradeFlow.value?.trades[0].side, 'buy');
assert.equal(fallback.tradeFlow.value?.trades[1].side, 'sell');
assert.equal(fallback.tradeFlow.value?.trades.length, 2,
  'aggregate trades with the same Binance event id must contribute only once');
assert.equal(fallback.tradeFlow.value?.duplicateCount, 1);
assert.equal(fallback.tradeFlow.value?.trades[0].tradeId, 1);
assert.equal(fallback.orderBook.status, 'LIVE');
assert.match(fallback.orderBook.endpoint ?? '', /fapi\.binance\.com\/fapi\/v1\/depth/);
assert.equal(fallback.orderBook.receivedAtMs, nowMs);
assert.deepEqual(fallback.orderBook.value?.bids[0], { price: 100, amount: 5 });
assert.equal(fallback.orderBook.value?.sequenceId, 77);
const bybitDepthTimestamp = nowMs - 100;
const bybitTradeTimestamp = nowMs - 200;
const bybitBookAndTradeFallback = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: async (input, init) => {
    const url = new URL(String(input));
    if (
      url.hostname === 'fapi.binance.com' &&
      ['/fapi/v1/depth', '/fapi/v1/aggTrades'].includes(url.pathname)
    ) return new Response('unavailable', { status: 503 });
    if (url.hostname === 'api.bybit.com' && url.pathname === '/v5/market/orderbook') {
      return Response.json({
        retCode: 0,
        time: bybitDepthTimestamp,
        result: {
          s: 'BTCUSDT',
          ts: bybitDepthTimestamp,
          seq: 88,
          b: [['100', '2'], ['99', '3']],
          a: [['101', '4'], ['102', '5']],
        },
      });
    }
    if (url.hostname === 'api.bybit.com' && url.pathname === '/v5/market/recent-trade') {
      return Response.json({
        retCode: 0,
        time: nowMs,
        result: {
          category: 'linear',
          list: [
            {
              execId: 'bybit-exec-2',
              symbol: 'BTCUSDT',
              price: '101',
              size: '0.5',
              side: 'Sell',
              time: String(bybitTradeTimestamp),
            },
            {
              execId: 'bybit-exec-1',
              symbol: 'BTCUSDT',
              price: '100',
              size: '0.25',
              side: 'Buy',
              time: String(bybitTradeTimestamp - 50),
            },
          ],
        },
      });
    }
    return fixtureFetcher(input, init);
  },
  timeoutMs: 100,
});
assert.equal(bybitBookAndTradeFallback.orderBook.status, 'LIVE');
assert.equal(bybitBookAndTradeFallback.orderBook.provider, 'Bybit V5 public REST API');
assert.match(bybitBookAndTradeFallback.orderBook.endpoint ?? '', /api\.bybit\.com\/v5\/market\/orderbook/);
assert.equal(bybitBookAndTradeFallback.orderBook.value?.venue, 'bybit');
assert.equal(bybitBookAndTradeFallback.orderBook.value?.sequenceId, 88);
assert.equal(bybitBookAndTradeFallback.tradeFlow.status, 'LIVE');
assert.equal(bybitBookAndTradeFallback.tradeFlow.provider, 'Bybit V5 public REST API');
assert.match(bybitBookAndTradeFallback.tradeFlow.endpoint ?? '', /api\.bybit\.com\/v5\/market\/recent-trade/);
assert.equal(bybitBookAndTradeFallback.tradeFlow.value?.trades.length, 2);
assert.equal(bybitBookAndTradeFallback.tradeFlow.value?.trades[0].side, 'buy');
assert.equal(bybitBookAndTradeFallback.tradeFlow.value?.trades[0].venue, 'bybit');
assert.equal(fallback.fundingRate.status, 'LIVE');
assert.match(fallback.fundingRate.endpoint ?? '', /fapi\.binance\.com\/fapi\/v1\/premiumIndex/);
assert.equal(fallback.openInterest.status, 'LIVE');
assert.match(fallback.openInterest.endpoint ?? '', /fapi\.binance\.com\/futures\/data\/openInterestHist/);
assert.equal(fallback.liveOpenInterest.status, 'LIVE');
assert.match(fallback.liveOpenInterest.endpoint ?? '', /fapi\.binance\.com\/fapi\/v1\/openInterest/);
assert.equal(fallback.liveOpenInterest.value?.amount, 10_025);
assert.equal(fallback.exchangeQuotes.status, 'LIVE');
assert.deepEqual(
  fallback.exchangeQuotes.value?.map(({ exchange }) => exchange).sort(),
  ['binance', 'bybit', 'okx'],
);
assert.ok(fallback.exchangeQuotes.value?.every(({ sourceTimestampMs }) =>
  nowMs - sourceTimestampMs <= 5_000
));
assert.ok(fallback.exchangeQuotes.value?.every((quote) =>
  quote.market === 'futures' &&
  quote.baseAsset === 'BTC' &&
  quote.quoteAsset === 'USDT' &&
  quote.priceUnit === 'USDT per BTC' &&
  quote.price > 0 &&
  quote.retrievedAtMs <= nowMs &&
  quote.endpoint.startsWith('https://') &&
  quote.symbol.length > 0
));
assert.deepEqual(
  fallback.exchangeQuoteSources.map(({ exchange, status }) => [exchange, status]),
  [['binance', 'LIVE'], ['bybit', 'LIVE'], ['okx', 'LIVE']],
);
const fiveMinuteCloseMs = Math.floor(nowMs / (5 * 60_000)) * 5 * 60_000;
const fiveMinuteRows = Array.from({ length: 40 }, (_, index) => {
  const openTimestamp = fiveMinuteCloseMs - (40 - index) * 5 * 60_000;
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
const requestedIntervals: string[] = [];
const fasterTimeframeFallback = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '5m',
  market: 'futures',
  nowMs,
  fetcher: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/fapi/v1/klines') {
      requestedIntervals.push(url.searchParams.get('interval') ?? '');
      if (url.searchParams.get('interval') === '5m') {
        return Response.json(fiveMinuteRows);
      }
    }
    return fixtureFetcher(input, init);
  },
  timeoutMs: 100,
});
assert.equal(fasterTimeframeFallback.candles.status, 'LIVE');
assert.equal(fasterTimeframeFallback.candles.value?.length, 40);
assert.equal(fasterTimeframeFallback.fastCandles.status, 'LIVE');
assert.equal(fasterTimeframeFallback.fastCandles.value?.length, 40);
assert.deepEqual(requestedIntervals.sort(), ['1h', '1m', '4h', '5m']);
const smallClockSkewFetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const response = await fixtureFetcher(input, init);
  if (url.hostname === 'fapi.binance.com' && url.pathname === '/fapi/v1/ticker/price') {
    return Response.json({
      symbol: 'BTCUSDT',
      price: '101',
      time: nowMs + 2_000,
    });
  }
  if (url.hostname === 'api.bybit.com' && url.pathname === '/v5/market/tickers') {
    return Response.json({
      retCode: 0,
      time: nowMs + 2_000,
      result: { list: [{ symbol: 'BTCUSDT', lastPrice: '100.5' }] },
    });
  }
  if (url.hostname === 'www.okx.com' && url.pathname === '/api/v5/market/ticker') {
    return Response.json({
      code: '0',
      data: [{ instId: 'BTC-USDT-SWAP', last: '100.25', ts: String(nowMs + 2_000) }],
    });
  }
  return response;
};
const smallClockSkewQuotes = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: smallClockSkewFetcher,
  timeoutMs: 100,
});
assert.equal(smallClockSkewQuotes.exchangeQuotes.status, 'LIVE');
assert.equal(smallClockSkewQuotes.exchangeQuotes.sourceTimestampMs, nowMs);
assert.ok(smallClockSkewQuotes.exchangeQuotes.value?.every(({ sourceTimestampMs }) =>
  sourceTimestampMs === nowMs + 2_000
));
const excessiveClockSkewFetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'fapi.binance.com' && url.pathname === '/fapi/v1/ticker/price') {
    return Response.json({
      symbol: 'BTCUSDT',
      price: '101',
      time: nowMs + 11_000,
    });
  }
  return fixtureFetcher(input, init);
};
const excessiveClockSkewQuotes = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: excessiveClockSkewFetcher,
  timeoutMs: 100,
});
assert.equal(excessiveClockSkewQuotes.exchangeQuotes.status, 'LIVE');
assert.equal(excessiveClockSkewQuotes.exchangeQuotes.value?.length, 2);
assert.equal(
  excessiveClockSkewQuotes.exchangeQuoteSources.find(({ exchange }) => exchange === 'binance')?.status,
  'UNAVAILABLE',
);
const staleClockSkewFetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'fapi.binance.com' && url.pathname === '/fapi/v1/ticker/price') {
    return Response.json({
      symbol: 'BTCUSDT',
      price: '101',
      time: nowMs - 11_000,
    });
  }
  return fixtureFetcher(input, init);
};
const staleClockSkewQuotes = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: staleClockSkewFetcher,
  timeoutMs: 100,
});
assert.equal(staleClockSkewQuotes.exchangeQuotes.status, 'LIVE');
assert.equal(staleClockSkewQuotes.exchangeQuotes.value?.length, 2);
assert.equal(
  staleClockSkewQuotes.exchangeQuoteSources.find(({ exchange }) => exchange === 'binance')?.status,
  'UNAVAILABLE',
);
const missingTimestampQuotes = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'fapi.binance.com' && url.pathname === '/fapi/v1/ticker/price') {
      return Response.json({ symbol: 'BTCUSDT', price: '101' });
    }
    return fixtureFetcher(input, init);
  },
  timeoutMs: 100,
});
assert.equal(missingTimestampQuotes.exchangeQuotes.status, 'LIVE');
assert.equal(
  missingTimestampQuotes.exchangeQuoteSources.find(({ exchange }) => exchange === 'binance')?.status,
  'UNAVAILABLE',
);
assert.match(
  missingTimestampQuotes.exchangeQuoteSources.find(({ exchange }) => exchange === 'binance')?.error ?? '',
  /timestamp is invalid/,
);

const oneExchangeUnavailable = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.bybit.com') return new Response('unavailable', { status: 503 });
    return fixtureFetcher(input, init);
  },
  timeoutMs: 100,
});
assert.equal(oneExchangeUnavailable.exchangeQuotes.status, 'LIVE');
assert.equal(oneExchangeUnavailable.exchangeQuotes.value?.length, 2);
assert.equal(oneExchangeUnavailable.exchangeQuotes.isPartial, true);
assert.equal(
  oneExchangeUnavailable.exchangeQuoteSources.find(({ exchange }) => exchange === 'bybit')?.status,
  'UNAVAILABLE',
);

let binanceTickerRequests = 0;
const websocketReferenceQuotes = await fetchPublicMarketFallback({
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  market: 'futures',
  nowMs,
  fetcher: async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'fapi.binance.com' && url.pathname === '/fapi/v1/ticker/price') {
      binanceTickerRequests += 1;
    }
    return fixtureFetcher(input, init);
  },
  marketDataStream: {
    getSnapshot: () => ({
      price: { sourceTimestampMs: nowMs - 100, retrievedAtMs: nowMs - 100, price: 100.4 },
      tradeFlow: null,
      orderBook: null,
      partialFastCandle: null,
    }),
  },
  timeoutMs: 100,
});
assert.equal(websocketReferenceQuotes.exchangeQuotes.status, 'LIVE');
assert.equal(binanceTickerRequests, 0, 'a fresh Binance WebSocket price replaces the REST ticker request');
assert.equal(websocketReferenceQuotes.exchangeQuotes.value?.find(({ exchange }) => exchange === 'binance')?.price, 100.4);
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
const councilAnalysis = await applyPublicMarketFallbackToCouncilAnalysis(
  emptyAnalysis,
  fallback,
  nowMs,
);
assert.equal(councilAnalysis.candles.length, 40);
assert.equal(councilAnalysis.orderFlowFeatures?.source?.includes('Binance public REST API'), true);
assert.equal(councilAnalysis.realObiData?.source?.includes('Binance public REST API'), true);
assert.equal(councilAnalysis.fundingRate, -0.0002);
assert.equal(councilAnalysis.oi, 10_025);
assert.equal(councilAnalysis.signalDataTimestamps?.openInterestMs, nowMs - 100);
assert.equal(councilAnalysis.signalDataTimestamps?.mtf1mMs, fallback.fastCandles.sourceTimestampMs);
assert.equal(
  councilAnalysis.signalDataTimestamps?.mtf1hMs,
  fallback.higherTimeframeCandles['1h'].sourceTimestampMs,
);
assert.equal(
  councilAnalysis.signalDataTimestamps?.mtf4hMs,
  fallback.higherTimeframeCandles['4h'].sourceTimestampMs,
);
assert.equal(councilAnalysis.htfCandles?.['1m']?.length, 40);
assert.equal(councilAnalysis.htfCandles?.['1h']?.length, 40);
assert.equal(councilAnalysis.htfCandles?.['4h']?.length, 40);
assert.equal(councilAnalysis.mtf1h, 'BULLISH');
assert.equal(councilAnalysis.mtf4h, 'BULLISH');

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
    [1, 'marketFallback.binanceFastCandles'],
    [1, 'marketFallback.binance1hCandles'],
    [1, 'marketFallback.binance4hCandles'],
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
