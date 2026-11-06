import assert from 'node:assert/strict';
import {
  validateFreqtradeMarketSnapshot,
} from '../src/services/freqtradeMarketDataBridge';

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
  contractVersion: 'sbk1.freqtrade.market-snapshot.v5',
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
    '1h': makeCandles(60 * 60_000, 30),
    '4h': makeCandles(4 * 60 * 60_000, 30),
  },
  ticker: {
    exchangeTimestampMs: null,
    retrievedAtMs: nowMs - 1_000,
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
  openInterest: null,
  tradeFlow: {
    retrievedAtMs: nowMs - 100,
    trades: [
      { timestampMs: nowMs - 300, side: 'buy', price: 60_000, amount: 1, tradeId: 'buy-1' },
      { timestampMs: nowMs - 200, side: 'sell', price: 60_001, amount: 0.25, tradeId: 'sell-1' },
    ],
  },
};

const snapshotWithRepeatedTrades = validateFreqtradeMarketSnapshot({
  ...marketSnapshot,
  tradeFlow: {
    retrievedAtMs: nowMs - 100,
    trades: [
      { timestampMs: nowMs - 300, side: 'buy', price: 60_000, amount: 1, tradeId: '42' },
      { timestampMs: nowMs - 300, side: 'buy', price: 60_000, amount: 1, tradeId: '42' },
      { timestampMs: nowMs - 300, side: 'buy', price: 60_000, amount: 1, tradeId: '43' },
    ],
  },
}, {
  exchange: 'bybit',
  market: 'futures',
  pair: 'BTC/USDT:USDT',
  timeframe: '15m',
}, nowMs);
assert.equal(snapshotWithRepeatedTrades.tradeFlow?.trades.length, 2,
  'same event ids must not double-count in the trade-flow evidence sent to member 2');
assert.equal(snapshotWithRepeatedTrades.tradeFlow?.duplicateCount, 1);
assert.equal(snapshotWithRepeatedTrades.tradeFlow?.trades[0].venue, 'bybit');
assert.equal(snapshotWithRepeatedTrades.tradeFlow?.trades[0].symbol, 'BTC/USDT:USDT');
const snapshotWithConflictingTrades = validateFreqtradeMarketSnapshot({
  ...marketSnapshot,
  tradeFlow: {
    retrievedAtMs: nowMs - 100,
    trades: [
      { timestampMs: nowMs - 300, side: 'buy', price: 60_000, amount: 1, tradeId: '42' },
      { timestampMs: nowMs - 200, side: 'sell', price: 60_001, amount: 2, tradeId: '42' },
    ],
  },
}, {
  exchange: 'bybit',
  market: 'futures',
  pair: 'BTC/USDT:USDT',
  timeframe: '15m',
}, nowMs);
assert.equal(snapshotWithConflictingTrades.tradeFlow, null,
  'conflicting optional trade flow must be unavailable without rejecting valid market candles');

Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
let requestCount = 0;
let responseSnapshot = marketSnapshot;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  assert.equal(String(input), '/api/market/freqtrade-snapshot', 'market data must use only the internal snapshot endpoint');
  requestCount += 1;
  return new Response(JSON.stringify(responseSnapshot), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      Date: new Date(nowMs).toUTCString(),
    },
  });
};

class FakeEventSource {
  static OPEN = 1;
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    assert.equal(url, '/api/market/freqtrade-snapshot/stream');
    FakeEventSource.instances.push(this);
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  send(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close(): void {
    this.readyState = 2;
  }
}
Object.defineProperty(globalThis, 'EventSource', { value: FakeEventSource, configurable: true });

try {
const marketData = await import('../src/services/marketData');
await marketData.getFreqtradeMarketSnapshot();
const { setupFreqtradeMarketFeed } = await import('../src/services/freqtradeMarketFeed');
let feedMessage: { price: number; source: string } | null = null;
let feedState = 'DISCONNECTED';
const feed = setupFreqtradeMarketFeed((price, message) => {
  feedMessage = { price, source: message.source };
}, (state) => {
  feedState = state;
});
const activeFeedSource = FakeEventSource.instances.at(-1);
assert.ok(activeFeedSource);
activeFeedSource.open();
activeFeedSource.send({ serverTimeMs: nowMs, snapshot: marketSnapshot });
assert.equal(feedState, 'LIVE');
assert.deepEqual(feedMessage, { price: 60_001, source: 'freqtrade.dataprovider' });
feed.close();

const candles = await marketData.fetchCandles();
  assert.equal(candles.candles.length, 500);
  assert.equal(candles.status, 'LIVE');
  assert.equal(candles.source, 'freqtrade.dataprovider');
  assert.equal(marketData.validateMarketDataLiveSafety(candles.candles, candles.status).isLiveSafe, true);
  assert.equal(marketData.validateMarketDataLiveSafety(candles.candles.slice(-299), candles.status).isLiveSafe, false);

for (const interval of ['1', '5', '60', '240']) {
  const result = await marketData.fetchBybit(interval, 20);
  assert.equal(result.candles.length, 20, `${interval}m chart timeframe should use validated Freqtrade snapshot candles`);
}
await assert.rejects(
  marketData.fetchBybit('1440', 20),
  /Unsupported Bybit candle request/,
  'unsupported daily chart timeframe must not be advertised or silently mapped',
);

const htf = await marketData.fetchHtf();
  assert.equal(htf['Freqtrade 1h']?.length, 30);
  assert.equal(htf['Freqtrade 4h']?.length, 30);
  assert.equal(requestCount, 1, 'snapshot consumers should share the in-memory snapshot');

  const originalDateNow = Date.now;
  Date.now = () => nowMs + 6_000;
  const futuresPrices = await marketData.fetchFuturesPrices();
  Date.now = originalDateNow;
  assert.equal(futuresPrices.lastPrice, 60_001);
  assert.equal(futuresPrices.markPrice, 60_003);
  assert.equal(futuresPrices.indexPrice, 59_999);
  assert.equal(futuresPrices.status, 'STALE', 'recent retrieval older than the trading freshness limit cannot authorize use');
  assert.equal(futuresPrices.timestampSource, 'FREQTRADE_RECEIVED');
  assert.equal(futuresPrices.exchangeTimestampUtc, null);
  assert.equal(futuresPrices.source, 'freqtrade.dataprovider');

  const orderBook = await marketData.fetchRealOrderBookImbalance();
  assert.equal(orderBook.status, 'LIVE');
  assert.ok(orderBook.obi !== null);
  assert.equal(orderBook.source, 'freqtrade.dataprovider');
  assert.equal(orderBook.obiVelocity, null, 'temporal metrics are not fabricated without history');

  const derivatives = await marketData.fetchDerivatives();
  assert.equal(derivatives.status, 'UNAVAILABLE', 'funding/OI feature stays unavailable without OI');
  assert.equal(derivatives.oi, null);
  assert.equal(derivatives.funding, -0.0001, 'verified funding is retained even when open interest is unavailable');

  const tradeFlow = await marketData.fetchRealTradeFlowCvd();
  assert.equal(tradeFlow.status, 'LIVE');
  assert.equal(tradeFlow.isRealTradeFlow, true);
  assert.equal(tradeFlow.takerBuyVol, 1);
  assert.equal(tradeFlow.takerSellVol, 0.25);
  assert.equal(tradeFlow.cvdDelta, 0.75);
  assert.equal(tradeFlow.cvdDeltaUsd, 44_999.75);
  assert.equal(tradeFlow.uniqueTradeCount, 2);

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

  responseSnapshot = { ...marketSnapshot, ticker: null };
  const noTickerMessages: number[] = [];
  let noTickerState = 'DISCONNECTED';
  Date.now = () => nowMs + 8_000;
  const noTickerFeed = setupFreqtradeMarketFeed((price) => {
    noTickerMessages.push(price);
  }, (state) => {
    noTickerState = state;
  });
  try {
    const noTickerSource = FakeEventSource.instances.at(-1);
    assert.ok(noTickerSource);
    noTickerSource.open();
    noTickerSource.send({
      serverTimeMs: nowMs + 8_000,
      snapshot: { ...marketSnapshot, generatedAtMs: nowMs + 8_000, ticker: null },
    });
    assert.equal(noTickerState, 'DEGRADED');
    assert.deepEqual(noTickerMessages, [], 'a missing ticker must not produce a synthetic price');
    const unavailableTradeFlow = await marketData.fetchRealTradeFlowCvd();
    assert.equal(unavailableTradeFlow.status, 'UNAVAILABLE');
    assert.equal(unavailableTradeFlow.cvdDelta, null);
  } finally {
    noTickerFeed.close();
    Date.now = originalDateNow;
  }

  await assert.rejects(
    () => marketData.fetchBybit('7', 30),
    /Unsupported Bybit candle request/,
  );
  responseSnapshot = marketSnapshot;
  const insufficientSnapshot = {
    ...marketSnapshot,
    candles: makeCandles(15 * 60_000, 19),
  };
  responseSnapshot = insufficientSnapshot;
  await assert.rejects(
    () => marketData.fetchBybit('15', 30, true),
    /داده از فریکترید در دسترس نیست/,
    'insufficient snapshot candles must fail without a fallback',
  );
  responseSnapshot = {
    ...marketSnapshot,
    generatedAtMs: nowMs - 16_000,
  };
  await assert.rejects(
    () => marketData.fetchBybit('15', 30, true),
    /داده از فریکترید در دسترس نیست/,
    'stale snapshots must fail without a fallback',
  );
  await assert.rejects(
    () => marketData.fetchKucoin(),
    /venue fallback is disabled/,
  );
  assert.equal(requestCount, 3, 'SSE snapshots are cached; only the initial and forced adapter requests fetch the snapshot endpoint');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Freqtrade market data adapter checks passed.');
