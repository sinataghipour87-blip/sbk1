import assert from 'node:assert/strict';
import {
  FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS,
  FREQTRADE_MARKET_SNAPSHOT_VERSION,
  FreqtradeMarketDataBridge,
  FreqtradeMarketSnapshotValidationError,
  validateFreqtradeMarketSnapshot,
} from '../src/services/freqtradeMarketDataBridge';

const expected = {
  exchange: 'bybit',
  market: 'futures' as const,
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
};
const nowMs = Date.now();
const snapshot = {
  contractVersion: FREQTRADE_MARKET_SNAPSHOT_VERSION,
  source: 'freqtrade.dataprovider',
  ...expected,
  generatedAtMs: nowMs,
  candles: [
    { timestampMs: nowMs - 120_000, open: 60_000, high: 60_100, low: 59_900, close: 60_050, volume: 1 },
    { timestampMs: nowMs - 60_000, open: 60_050, high: 60_200, low: 60_000, close: 60_100, volume: 2 },
  ],
  additionalCandles: {
    '1m': [
      { timestampMs: nowMs - 120_000, open: 60_000, high: 60_100, low: 59_900, close: 60_050, volume: 1 },
      { timestampMs: nowMs - 60_000, open: 60_050, high: 60_200, low: 60_000, close: 60_100, volume: 2 },
    ],
    '5m': null,
    '1h': null,
    '4h': null,
  },
  ticker: {
    exchangeTimestampMs: null,
    retrievedAtMs: nowMs - 500,
    last: 60_100,
    bid: 60_099,
    ask: 60_101,
    markPrice: 60_100,
    indexPrice: 60_098,
  },
  orderBook: {
    timestampMs: nowMs - 500,
    bids: [{ price: 60_099, amount: 1 }],
    asks: [{ price: 60_101, amount: 1 }],
  },
  fundingRate: { retrievedAtMs: nowMs - 500, rate: -0.0001, nextFundingAtMs: nowMs + 3_600_000 },
  openInterest: null,
  tradeFlow: {
    retrievedAtMs: nowMs - 100,
    trades: [{ timestampMs: nowMs - 200, side: 'buy', price: 60_100, amount: 0.01 }],
  },
};

function expectCode(operation: () => unknown, code: string): void {
  assert.throws(
    operation,
    (error: unknown) => error instanceof FreqtradeMarketSnapshotValidationError && error.code === code,
  );
}

const validated = validateFreqtradeMarketSnapshot(snapshot, expected, nowMs);
assert.equal(validated.candles.length, 2);
assert.equal(validated.ticker?.last, 60_100);
assert.equal(validated.ticker?.exchangeTimestampMs, null);
assert.equal(validated.ticker?.retrievedAtMs, nowMs - 500);
const delayedTicker = validateFreqtradeMarketSnapshot({
  ...snapshot,
  ticker: { ...snapshot.ticker, retrievedAtMs: nowMs - 6_000 },
}, expected, nowMs);
assert.equal(delayedTicker.ticker, null, 'ticker retrieval older than five seconds must be unavailable without exchange timestamp');

const bridge = new FreqtradeMarketDataBridge();
bridge.accept(snapshot, expected, nowMs);
assert.equal(bridge.getLatest(expected, nowMs).generatedAtMs, nowMs);
expectCode(() => bridge.accept(snapshot, expected, nowMs), 'OUT_OF_ORDER_SNAPSHOT');
expectCode(
  () => bridge.getLatest(expected, nowMs + FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS + 1),
  'MARKET_SNAPSHOT_UNAVAILABLE',
);

expectCode(
  () => validateFreqtradeMarketSnapshot({ ...snapshot, exchange: 'binance' }, expected, nowMs),
  'EXCHANGE_MISMATCH',
);
expectCode(
  () => validateFreqtradeMarketSnapshot({ ...snapshot, pair: 'ETH/USDT:USDT' }, expected, nowMs),
  'MARKET_CONFIGURATION_MISMATCH',
);
expectCode(
  () => validateFreqtradeMarketSnapshot({ ...snapshot, generatedAtMs: nowMs - 16_000 }, expected, nowMs),
  'STALE_SNAPSHOT',
);
expectCode(
  () => validateFreqtradeMarketSnapshot({
    ...snapshot,
    candles: [{ ...snapshot.candles[0], high: snapshot.candles[0].open - 1 }],
  }, expected, nowMs),
  'INVALID_CANDLES',
);
expectCode(
  () => validateFreqtradeMarketSnapshot({
    ...snapshot,
    orderBook: { ...snapshot.orderBook, asks: [{ price: 60_098, amount: 1 }] },
  }, expected, nowMs),
  'INVALID_ORDER_BOOK',
);
const staleOptionalFeeds = validateFreqtradeMarketSnapshot({
  ...snapshot,
  ticker: { ...snapshot.ticker, retrievedAtMs: nowMs - 16_000 },
  orderBook: { ...snapshot.orderBook, timestampMs: nowMs - 10_001 },
  fundingRate: { ...snapshot.fundingRate, retrievedAtMs: nowMs - 16_000 },
  tradeFlow: {
    retrievedAtMs: nowMs - 6_000,
    trades: [{ ...snapshot.tradeFlow.trades[0], timestampMs: nowMs - 6_100 }],
  },
}, expected, nowMs);
assert.equal(staleOptionalFeeds.candles.length, snapshot.candles.length);
assert.equal(staleOptionalFeeds.ticker, null, 'stale ticker must not invalidate otherwise fresh candles');
assert.equal(staleOptionalFeeds.orderBook, null, 'stale order book must not invalidate otherwise fresh candles');
assert.equal(staleOptionalFeeds.fundingRate, null, 'stale funding must not invalidate otherwise fresh candles');
assert.equal(staleOptionalFeeds.tradeFlow, null, 'stale trade flow must not authorize CVD features');
const staleTradesInFreshBatch = validateFreqtradeMarketSnapshot({
  ...snapshot,
  tradeFlow: {
    retrievedAtMs: nowMs - 100,
    trades: [{ ...snapshot.tradeFlow.trades[0], timestampMs: nowMs - 6_100 }],
  },
}, expected, nowMs);
assert.equal(staleTradesInFreshBatch.tradeFlow, null, 'old trades must make only the optional trade feed unavailable');
expectCode(
  () => validateFreqtradeMarketSnapshot({
    ...snapshot,
    tradeFlow: {
      ...snapshot.tradeFlow,
      trades: [{ ...snapshot.tradeFlow.trades[0], side: 'unknown' }],
    },
  }, expected, nowMs),
  'INVALID_TRADE_FLOW',
);
const partialBridge = new FreqtradeMarketDataBridge();
const acceptedPartial = partialBridge.accept({
  ...snapshot,
  ticker: { ...snapshot.ticker, retrievedAtMs: nowMs - 16_000 },
  orderBook: { ...snapshot.orderBook, timestampMs: nowMs - 10_001 },
  fundingRate: { ...snapshot.fundingRate, retrievedAtMs: nowMs - 16_000 },
  tradeFlow: {
    retrievedAtMs: nowMs - 6_000,
    trades: [{ ...snapshot.tradeFlow.trades[0], timestampMs: nowMs - 6_100 }],
  },
}, expected, nowMs);
assert.equal(partialBridge.getLatest(expected, nowMs).candles.length, snapshot.candles.length);
assert.equal(acceptedPartial.orderBook, null);
assert.equal(acceptedPartial.ticker, null);
assert.equal(acceptedPartial.fundingRate, null);
assert.equal(acceptedPartial.tradeFlow, null);
expectCode(
  () => validateFreqtradeMarketSnapshot({
    ...snapshot,
    generatedAtMs: nowMs - 1_000,
    ticker: { ...snapshot.ticker, retrievedAtMs: nowMs + 500 },
  }, expected, nowMs),
  'INVALID_TICKER',
);
const staleExchangeTicker = validateFreqtradeMarketSnapshot({
  ...snapshot,
  ticker: { ...snapshot.ticker, exchangeTimestampMs: nowMs - 6_000 },
}, expected, nowMs);
assert.equal(staleExchangeTicker.candles.length, snapshot.candles.length);
assert.equal(staleExchangeTicker.ticker, null, 'stale exchange timestamps must not invalidate otherwise fresh candles');
expectCode(
  () => validateFreqtradeMarketSnapshot({
    ...snapshot,
    additionalCandles: { ...snapshot.additionalCandles, '5m': [{ ...snapshot.candles[0] }] },
  }, expected, nowMs),
  'INVALID_CANDLES',
);

const unavailableOptionalFeeds = validateFreqtradeMarketSnapshot({
  ...snapshot,
  additionalCandles: { '1m': null, '5m': null, '1h': null, '4h': null },
  ticker: null,
  orderBook: null,
  fundingRate: null,
  tradeFlow: null,
}, expected, nowMs);
assert.equal(unavailableOptionalFeeds.ticker, null);
assert.equal(unavailableOptionalFeeds.orderBook, null);
assert.equal(unavailableOptionalFeeds.fundingRate, null);
assert.equal(unavailableOptionalFeeds.tradeFlow, null);
expectCode(
  () => validateFreqtradeMarketSnapshot({
    ...snapshot,
    candles: [snapshot.candles[0], { ...snapshot.candles[1], timestampMs: snapshot.candles[1].timestampMs + 1_000 }],
  }, expected, nowMs),
  'INVALID_CANDLES',
);

console.log('Freqtrade market snapshot contract checks passed.');
