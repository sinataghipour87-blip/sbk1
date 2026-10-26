import assert from 'node:assert/strict';
import {
  fetchBinanceEuropeanOptionsData,
  resetBinanceEuropeanOptionsDataCacheForTests,
} from '../src/services/binanceEuropeanOptionsData';
import { fetchCouncilOptionsData } from '../src/services/councilOptionsData';
import { resetOkxOptionsDataCacheForTests } from '../src/services/okxOptionsData';

const nowMs = Date.now();
const expiryMs = nowMs + 20 * 24 * 60 * 60_000;
const expiryCode = new Date(expiryMs).toISOString().slice(2, 10).replaceAll('-', '');

function fixtures(asset: string, sourceTimestampMs = Date.now()) {
  const instruments = Array.from({ length: 20 }, (_, index) => {
    const side = index % 2 === 0 ? 'CALL' : 'PUT';
    const symbol = `${asset}-${expiryCode}-${100 + index}-${side === 'CALL' ? 'C' : 'P'}`;
    return {
      symbol,
      underlying: `${asset}USDT`,
      quoteAsset: 'USDT',
      unit: asset === 'XRP' ? 100 : 1,
      expiryDate: expiryMs,
      side,
      strikePrice: String(140 + index),
      status: 'TRADING',
    };
  });
  const marks = instruments.map(({ symbol }) => ({
    symbol,
    markPrice: asset === 'BNB' ? '600' : asset === 'XRP' ? '0.5' : '150',
    markIV: '0.5',
  }));
  const openInterest = instruments.map(({ symbol }) => ({
    symbol,
    sumOpenInterest: '10',
    sumOpenInterestUsd: '1000',
    timestamp: sourceTimestampMs,
  }));
  return { instruments, marks, openInterest };
}

function mockBinance(asset: string, openInterestTimestampMs = Date.now()): typeof fetch {
  const data = fixtures(asset, openInterestTimestampMs);
  return async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'eapi.binance.com');
    if (url.pathname.endsWith('/exchangeInfo')) {
      return Response.json({ optionSymbols: data.instruments, optionContracts: [] });
    }
    if (url.pathname.endsWith('/index')) {
      assert.equal(url.searchParams.get('underlying'), `${asset}USDT`);
      return Response.json({
        indexPrice: asset === 'BNB' ? '600' : asset === 'XRP' ? '0.5' : '150',
        time: String(Date.now()),
      });
    }
    if (url.pathname.endsWith('/mark')) return Response.json(data.marks);
    if (url.pathname.endsWith('/openInterest')) {
      assert.equal(url.searchParams.get('underlyingAsset'), asset);
      assert.equal(url.searchParams.get('expiration'), expiryCode);
      return Response.json(data.openInterest);
    }
    throw new Error(`Unexpected Binance options endpoint: ${url.pathname}`);
  };
}

for (const [asset, pair] of [
  ['SOL', 'SOL/USDT:USDT'],
  ['XRP', 'XRP/USDT:USDT'],
  ['BNB', 'BNB/USDT:USDT'],
] as const) {
  resetBinanceEuropeanOptionsDataCacheForTests();
  const result = await fetchBinanceEuropeanOptionsData({
    pair,
    nowMs,
    fetcher: mockBinance(asset),
  });
  assert.equal(result.status, 'LIVE');
  assert.equal(result.pair, pair);
  assert.equal(result.asset, asset);
  assert.equal(
    result.provider,
    'Binance European Options public API (timestamped index/OI; OI-weighted USD open interest)',
  );
  assert.equal(result.contractsCount, 20);
  assert.equal(result.putCallRatio, 1);
  assert.equal(result.impliedVolatilityPct, 50);
  assert.equal(result.callOpenInterest, 10_000);
  assert.equal(result.putOpenInterest, 10_000);
}

resetBinanceEuropeanOptionsDataCacheForTests();
resetOkxOptionsDataCacheForTests();
const fallback = await fetchCouncilOptionsData({
  pair: 'SOL/USDT:USDT',
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'www.okx.com') {
      assert.equal(url.pathname.endsWith('/public/instruments'), true);
      return Response.json({ code: '0', data: [], msg: '' });
    }
    return mockBinance('SOL')(input);
  },
});
assert.equal(fallback.status, 'LIVE');
assert.match(fallback.provider, /Binance European Options/);

resetBinanceEuropeanOptionsDataCacheForTests();
const stale = await fetchBinanceEuropeanOptionsData({
  pair: 'SOL/USDT:USDT',
  nowMs,
  fetcher: mockBinance('SOL', nowMs - 120_000),
});
assert.equal(stale.status, 'UNAVAILABLE');
assert.equal(stale.timestampMs, null);
assert.match(stale.unavailableReason ?? '', /20 fresh/);

resetBinanceEuropeanOptionsDataCacheForTests();
const noOptions = await fetchCouncilOptionsData({
  pair: 'XRP/USDT:USDT',
  nowMs: nowMs + 30_000,
  fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'www.okx.com') return Response.json({ code: '0', data: [], msg: '' });
    if (url.pathname.endsWith('/exchangeInfo')) {
      return Response.json({ optionSymbols: [], optionContracts: [] });
    }
    throw new Error('No secondary market metrics should be requested without contracts.');
  },
});
assert.equal(noOptions.status, 'UNAVAILABLE');
assert.equal(noOptions.timestampMs, null);
assert.match(noOptions.unavailableReason ?? '', /either OKX.*Binance European Options/);

console.log('Binance European Options freshness, pair isolation, USD OI normalization, fallback and abstention checks passed.');
