import assert from 'node:assert/strict';

const nowMs = Date.now();
const makeCandles = (timeframeMs: number, count: number) => {
  const lastTimestampMs = nowMs - timeframeMs - 1_000;
  return Array.from({ length: count }, (_, index) => ({
    timestampMs: lastTimestampMs - (count - index - 1) * timeframeMs,
    open: 60_000,
    high: 60_010,
    low: 59_990,
    close: 60_001,
    volume: 1,
  }));
};

const marketSnapshot = {
  contractVersion: 'sbk1.freqtrade.market-snapshot.v3',
  source: 'freqtrade.dataprovider',
  exchange: 'bybit',
  market: 'futures',
  pair: 'BTC/USDT:USDT',
  timeframe: '15m',
  generatedAtMs: nowMs,
  candles: makeCandles(15 * 60_000, 500),
  additionalCandles: {
    '1m': makeCandles(60_000, 30),
    '5m': makeCandles(5 * 60_000, 30),
    '1h': makeCandles(60 * 60_000, 10),
    '4h': makeCandles(4 * 60 * 60_000, 10),
  },
  ticker: {
    exchangeTimestampMs: null,
    retrievedAtMs: nowMs - 6_000,
    last: 60_001,
    bid: 60_000,
    ask: 60_002,
    markPrice: 60_003,
    indexPrice: 59_999,
  },
  orderBook: {
    timestampMs: nowMs - 500,
    bids: [
      { price: 60_000, amount: 1 },
      { price: 59_999, amount: 1 },
    ],
    asks: [
      { price: 60_002, amount: 1 },
      { price: 60_003, amount: 1 },
    ],
  },
  fundingRate: { retrievedAtMs: nowMs - 500, rate: -0.0001, nextFundingAtMs: null },
};

Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
let requestCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  if (
    String(input).startsWith('https://api.bybit.com/') ||
    String(input).startsWith('/api/market/bybit/')
  ) {
    throw new Error('Public Bybit network access is disabled in this focused adapter check.');
  }
  requestCount += 1;
  return new Response(JSON.stringify(marketSnapshot), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      Date: new Date(nowMs).toUTCString(),
    },
  });
};

try {
const marketData = await import('../src/services/marketData');
const originalDateNow = Date.now;
try {
  Date.now = () => nowMs + 60_000;
  await marketData.getFreqtradeMarketSnapshot();
} finally {
  Date.now = originalDateNow;
}
const candles = await marketData.fetchCandles();
  assert.equal(candles.candles.length, 500);
  assert.equal(candles.status, 'LIVE');
  assert.match(candles.source, /freqtrade\.dataprovider/);
  assert.equal(marketData.validateMarketDataLiveSafety(candles.candles, candles.status).isLiveSafe, true);
  assert.equal(marketData.validateMarketDataLiveSafety(candles.candles.slice(-299), candles.status).isLiveSafe, false);

  const htf = await marketData.fetchHtf();
  assert.equal(htf['Freqtrade 1h']?.length, 10);
  assert.equal(htf['Freqtrade 4h']?.length, 10);
  assert.equal(requestCount, 1, 'snapshot consumers should share the in-memory snapshot');

  const futuresPrices = await marketData.fetchFuturesPrices();
  assert.equal(futuresPrices.lastPrice, 60_001);
  assert.equal(futuresPrices.markPrice, 60_003);
  assert.equal(futuresPrices.indexPrice, 59_999);
  assert.equal(futuresPrices.status, 'UNAVAILABLE', 'recent retrieval older than the trading freshness limit cannot authorize use');
  assert.equal(futuresPrices.timestampSource, 'FREQTRADE_RECEIVED');
  assert.equal(futuresPrices.exchangeTimestampUtc, null);

  const orderBook = await marketData.fetchRealOrderBookImbalance();
  assert.equal(orderBook.status, 'LIVE');
  assert.ok(orderBook.obi !== null);
  assert.equal(orderBook.obiVelocity, null, 'temporal metrics are not fabricated without history');

  const derivatives = await marketData.fetchDerivatives();
  assert.equal(derivatives.status, 'UNAVAILABLE', 'funding/OI feature stays unavailable without OI');
  assert.equal(derivatives.oi, null);
  assert.equal(derivatives.funding, -0.0001, 'verified funding is retained even when open interest is unavailable');

  const tradeFlow = await marketData.fetchRealTradeFlowCvd();
  assert.equal(tradeFlow.status, 'UNAVAILABLE');
  assert.equal(tradeFlow.cvdDelta, null);

  const canonical = await marketData.getCanonicalMarketSnapshot();
  assert.equal(canonical.primaryIndexPrice, 59_999);
  assert.equal(canonical.feeds[0].status, 'STALE');
  assert.equal(canonical.feeds[0].timestampSource, 'FREQTRADE_RECEIVED');
  assert.equal(canonical.feeds[0].exchangeTimestampUtc, null);
  assert.equal(canonical.basisSpreadUsd, null);
  assert.equal(canonical.crossExchangeSpreadUsd, null);

  const crossExchange = await (await import('../src/services/crossExchangeCorrelationEngine'))
    .crossExchangeCorrelationEngine.analyzeRealCrossExchangeMetrics();
  assert.equal(crossExchange.available, false);
  assert.equal(crossExchange.exchanges.length, 0);

  await assert.rejects(
    () => marketData.fetchBybit('7', 30),
    /Unsupported Bybit candle request/,
  );
  await assert.rejects(
    () => marketData.fetchKucoin(),
    /venue fallback is disabled/,
  );
  assert.equal(requestCount, 1, 'Freqtrade snapshot consumers should reuse the cached verified snapshot');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Freqtrade market data adapter checks passed.');
