import assert from 'node:assert/strict';
import { fetchCouncilOptionsData } from '../src/services/councilOptionsData';
import { fetchBybitOptionsData, resetBybitOptionsDataCacheForTests } from '../src/services/bybitOptionsData';

const nowMs = Date.now();
const expiry = new Date(nowMs + 20 * 24 * 60 * 60_000);
const expiryName = `${String(expiry.getUTCDate()).padStart(2, '0')}${
  expiry.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()
}${String(expiry.getUTCFullYear()).slice(-2)}`;
const instruments = Array.from({ length: 24 }, (_, index) => {
  const side = index % 2 === 0 ? 'C' : 'P';
  const strike = 76_000 + Math.floor(index / 2) * 1_000;
  return {
    symbol: `BTC-${expiryName}-${strike}-${side}-USDT`,
    status: 'Trading',
    baseCoin: 'BTC',
    quoteCoin: 'USDT',
    optionsType: side === 'C' ? 'Call' : 'Put',
    deliveryTime: String(expiry.getTime()),
    priceFilter: { minPrice: '1', maxPrice: '1000000', tickSize: '1' },
  };
});
const tickers = instruments.map((instrument, index) => ({
  symbol: instrument.symbol,
  bid1Price: '100',
  bid1Size: '1',
  ask1Price: '101',
  ask1Size: '1',
  markPrice: '100.5',
  markIv: index % 2 === 0 ? '0.4' : '0.5',
  underlyingPrice: '80000',
  openInterest: index % 2 === 0 ? '10' : '20',
  turnover24h: '1000',
}));

const fixtureFetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  assert.equal(url.searchParams.get('category'), 'option');
  assert.equal(url.searchParams.get('baseCoin'), 'BTC');
  if (url.pathname.endsWith('/instruments-info')) {
    const cursor = url.searchParams.get('cursor');
    if (cursor === 'page-2') {
      return Response.json({ retCode: 0, time: nowMs, result: { list: instruments.slice(12) } });
    }
    return Response.json({
      retCode: 0,
      time: nowMs,
      result: { list: instruments.slice(0, 12), nextPageCursor: 'page-2' },
    });
  }
  assert.ok(url.pathname.endsWith('/tickers'));
  return Response.json({ retCode: 0, time: nowMs, result: { list: tickers } });
};

resetBybitOptionsDataCacheForTests();
const options = await fetchBybitOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: fixtureFetcher,
});
assert.equal(options.status, 'LIVE');
assert.equal(options.asset, 'BTC');
assert.equal(options.contractsCount, 24);
assert.equal(options.provider, 'Bybit V5 public options API');
assert.equal(options.callOpenInterest, 120);
assert.equal(options.putOpenInterest, 240);
assert.equal(options.putCallRatio, 2);
assert.equal(options.underlyingPrice, 80_000);

resetBybitOptionsDataCacheForTests();
let fallbackEndpoints: string[] = [];
const fallback = await fetchCouncilOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    fallbackEndpoints.push(`${url.hostname}${url.pathname}`);
    if (url.hostname === 'www.deribit.com' || url.hostname === 'eapi.binance.com') {
      return new Response('', { status: 503 });
    }
    return fixtureFetcher(input);
  },
});
assert.equal(fallback.status, 'LIVE');
assert.equal(fallback.provider, 'Bybit V5 public options API');
assert.equal(fallbackEndpoints.some((endpoint) => endpoint.startsWith('www.deribit.com')), true);
assert.equal(fallbackEndpoints.some((endpoint) => endpoint.startsWith('eapi.binance.com')), true);
assert.equal(fallbackEndpoints.some((endpoint) => endpoint.startsWith('api.bybit.com')), true);

resetBybitOptionsDataCacheForTests();
let unsupportedPairRequested = false;
const unsupported = await fetchBybitOptionsData({
  pair: 'SOL/USDT:USDT',
  nowMs,
  fetcher: async () => {
    unsupportedPairRequested = true;
    throw new Error('Unsupported asset must not request BTC/ETH options.');
  },
});
assert.equal(unsupported.status, 'UNAVAILABLE');
assert.equal(unsupportedPairRequested, false);

resetBybitOptionsDataCacheForTests();
const stale = await fetchBybitOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/instruments-info')) {
      return Response.json({ retCode: 0, time: nowMs, result: { list: instruments } });
    }
    return Response.json({
      retCode: 0,
      time: nowMs - 61_000,
      result: { list: tickers },
    });
  },
});
assert.equal(stale.status, 'UNAVAILABLE');
assert.match(stale.unavailableReason ?? '', /stale or future-dated/);

console.log('Bybit V5 options schema, pair isolation, freshness and ordered fallback checks passed.');
