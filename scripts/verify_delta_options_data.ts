import assert from 'node:assert/strict';
import {
  fetchDeltaOptionsData,
  resetDeltaOptionsDataCacheForTests,
} from '../src/services/deltaOptionsData';
import { fetchCouncilOptionsData } from '../src/services/councilOptionsData';

console.log('[MOCK VERIFICATION] Delta options adapter tests use injected payloads; this is not live health evidence.');

const nowMs = Date.now();
const settlementTime = new Date(nowMs + 30 * 24 * 60 * 60_000).toISOString();

function fixture(asset: string, options: {
  timestampMs?: number;
  calls?: number;
  puts?: number;
  expired?: boolean;
  emptyQuotes?: boolean;
  badSpread?: boolean;
  emptyProducts?: boolean;
} = {}) {
  const spotPrice = asset === 'BTC' ? 70_000 : 2_000;
  const contractValue = asset === 'BTC' ? '0.001' : '0.01';
  const calls = options.calls ?? 12;
  const puts = options.puts ?? 12;
  const products = Array.from({ length: calls + puts }, (_, index) => {
    const side = index < calls ? 'call_options' : 'put_options';
    const letter = side === 'call_options' ? 'C' : 'P';
    const id = index + 1;
    return {
      id,
      symbol: `${letter}-${asset}-${spotPrice + index}-301226`,
      state: 'live',
      trading_status: 'operational',
      contract_type: side,
      contract_value: contractValue,
      contract_unit_currency: asset,
      underlying_asset: { symbol: asset },
      strike_price: String(spotPrice + index),
      settlement_time: options.expired
        ? new Date(nowMs - 1_000).toISOString()
        : settlementTime,
    };
  });
  const tickers = products.map((product) => {
    const openInterestContracts = 10;
    const openInterestBase = openInterestContracts * Number(contractValue);
    return {
      product_id: product.id,
      symbol: product.symbol,
      underlying_asset_symbol: asset,
      product_trading_status: 'operational',
      contract_type: product.contract_type,
      timestamp: (options.timestampMs ?? nowMs) * 1_000,
      time: new Date(nowMs - 24 * 60 * 60_000).toISOString(),
      spot_price: String(spotPrice),
      strike_price: product.strike_price,
      oi_contracts: String(openInterestContracts),
      oi_value: String(openInterestBase),
      oi_value_usd: String(openInterestBase * spotPrice),
      mark_vol: '0.5',
      turnover_usd: 1_000,
      quotes: {
        best_bid: options.emptyQuotes ? '0' : '10',
        best_ask: options.emptyQuotes ? '0' : options.badSpread ? '20' : '10.2',
        bid_size: options.emptyQuotes ? '0' : '5',
        ask_size: options.emptyQuotes ? '0' : '6',
      },
    };
  });
  return { products, tickers };
}

function mockFetcher(asset: string, config: Parameters<typeof fixture>[1] = {}): typeof fetch {
  const data = fixture(asset, config);
  return async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'api.india.delta.exchange');
    if (url.pathname.endsWith('/products')) {
      return Response.json({ success: true, result: config.emptyProducts ? [] : data.products });
    }
    if (url.pathname.endsWith('/tickers')) {
      return Response.json({ success: true, result: data.tickers });
    }
    const productId = Number(url.pathname.split('/').at(-1));
    const product = data.products.find((candidate) => candidate.id === productId);
    assert.ok(product, `product ${productId} exists for order-book sampling`);
    return Response.json({
      success: true,
      result: {
        symbol: product.symbol,
        buy: [{ price: '10', size: 5 }],
        sell: [{ price: '10.2', size: 6 }],
        last_updated_at: (config.timestampMs ?? nowMs) * 1_000,
      },
    });
  };
}

for (const asset of ['BTC', 'ETH']) {
  resetDeltaOptionsDataCacheForTests();
  const pair = `${asset}/USDT:USDT`;
  const result = await fetchDeltaOptionsData({
    pair,
    nowMs,
    fetcher: mockFetcher(asset),
  });
  assert.equal(result.status, 'LIVE');
  assert.equal(result.asset, asset);
  assert.equal(result.contractsCount, 24);
  assert.equal(result.callContractsCount, 12);
  assert.equal(result.putContractsCount, 12);
  assert.equal(result.bidAskValidatedContracts, 24);
  assert.equal(result.bidAskSizeValidatedContracts, 8);
  assert.equal(result.putCallRatio, 1);
  assert.equal(result.impliedVolatilityPct, 50);
  assert.equal(result.openInterestUnit, 'USD notional (Delta oi_value_usd; contract units checked)');
  assert.equal(result.volumeUnit, 'USD turnover (Delta turnover_usd)');
  assert.equal(result.qualityPct, 100);
}

resetDeltaOptionsDataCacheForTests();
const stale = await fetchDeltaOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: mockFetcher('BTC', { timestampMs: nowMs - 120_000 }),
});
assert.equal(stale.status, 'UNAVAILABLE');
assert.equal(stale.timestampMs, null);
assert.match(stale.unavailableReason ?? '', /fresh liquid/);

resetDeltaOptionsDataCacheForTests();
const futureDated = await fetchDeltaOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: mockFetcher('BTC', { timestampMs: nowMs + 120_000 }),
});
assert.equal(futureDated.status, 'UNAVAILABLE');
assert.equal(futureDated.timestampMs, null);
assert.match(futureDated.unavailableReason ?? '', /fresh liquid/);

resetDeltaOptionsDataCacheForTests();
const missingPuts = await fetchDeltaOptionsData({
  pair: 'ETH/USDT:USDT',
  nowMs,
  fetcher: mockFetcher('ETH', { calls: 24, puts: 0 }),
});
assert.equal(missingPuts.status, 'UNAVAILABLE');
assert.match(missingPuts.unavailableReason ?? '', /four each side/);

resetDeltaOptionsDataCacheForTests();
const emptyQuotes = await fetchDeltaOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: mockFetcher('BTC', { emptyQuotes: true }),
});
assert.equal(emptyQuotes.status, 'UNAVAILABLE');
assert.match(emptyQuotes.unavailableReason ?? '', /no complete timestamped/);

resetDeltaOptionsDataCacheForTests();
const wideSpread = await fetchDeltaOptionsData({
  pair: 'ETH/USDT:USDT',
  nowMs,
  fetcher: mockFetcher('ETH', { badSpread: true }),
});
assert.equal(wideSpread.status, 'UNAVAILABLE');
assert.match(wideSpread.unavailableReason ?? '', /fresh liquid/);

resetDeltaOptionsDataCacheForTests();
const emptyResponse = await fetchDeltaOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: mockFetcher('BTC', { emptyProducts: true }),
});
assert.equal(emptyResponse.status, 'UNAVAILABLE');
assert.match(emptyResponse.unavailableReason ?? '', /no operational BTC options/);

resetDeltaOptionsDataCacheForTests();
const expired = await fetchDeltaOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: mockFetcher('BTC', { expired: true }),
});
assert.equal(expired.status, 'UNAVAILABLE');
assert.match(expired.unavailableReason ?? '', /expiry window/);

resetDeltaOptionsDataCacheForTests();
const missingAsset = await fetchDeltaOptionsData({
  pair: 'XRP/USDT:USDT',
  nowMs,
  fetcher: mockFetcher('XRP'),
});
assert.equal(missingAsset.status, 'UNAVAILABLE');
assert.match(missingAsset.unavailableReason ?? '', /only for BTC and ETH/);

resetDeltaOptionsDataCacheForTests();
const rateLimited = await fetchDeltaOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: async () => new Response(null, { status: 429 }),
});
assert.equal(rateLimited.status, 'UNAVAILABLE');
assert.match(rateLimited.unavailableReason ?? '', /HTTP 429/);

resetDeltaOptionsDataCacheForTests();
const deltaFallback = await fetchCouncilOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'www.deribit.com') {
      return Response.json({ jsonrpc: '2.0', result: [] });
    }
    if (url.hostname === 'api.bybit.com') {
      return Response.json({ retCode: 0, time: nowMs, result: { list: [] } });
    }
    if (url.hostname === 'eapi.binance.com') {
      return Response.json({ optionSymbols: [], optionContracts: [] });
    }
    return mockFetcher('BTC')(input);
  },
});
assert.equal(deltaFallback.status, 'LIVE');
assert.equal(deltaFallback.sourceId, 'council.member5.BTC.delta-options');
assert.equal(deltaFallback.fallbackSourceId, 'council.member5.BTC.binance-eapi');

resetDeltaOptionsDataCacheForTests();
console.log('Delta options mock checks passed: units, stale/future timestamps, missing sides, empty/wide quotes, empty/expired markets, unsupported assets and rate limits.');
