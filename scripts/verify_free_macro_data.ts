import assert from 'node:assert/strict';
import { fetchFreeMacroData } from '../src/services/freeMacroData';

const nowMs = Date.parse('2026-10-17T20:00:00.000Z');
const today = new Date(nowMs).toISOString().slice(0, 10);
const yesterday = new Date(nowMs - 24 * 60 * 60_000).toISOString().slice(0, 10);
let requestCount = 0;

const unconfigured = await fetchFreeMacroData({
  nowMs,
  fredApiKey: '',
  fetcher: async () => {
    throw new Error('FRED must not be called without an API key.');
  },
});
assert.equal(unconfigured.sp500.status, 'UNAVAILABLE');
assert.equal(unconfigured.sp500.error, 'FRED_API_KEY_NOT_CONFIGURED');

const live = await fetchFreeMacroData({
  nowMs,
  fredApiKey: 'test-key-not-a-secret',
  fetcher: async (input) => {
    requestCount += 1;
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'api.stlouisfed.org') {
      assert.equal(endpoint.searchParams.get('api_key'), 'test-key-not-a-secret');
      return Response.json({
        observations: [
          { date: today, value: '6500.25' },
          { date: yesterday, value: '6490.25' },
        ],
      });
    }
    assert.equal(endpoint.hostname, 'community-api.coinmetrics.io');
    return Response.json({
      data: [{
        asset: 'btc',
        time: new Date(nowMs - 60 * 60_000).toISOString(),
        AdrActCnt: '650000',
      }],
    });
  },
});

assert.equal(requestCount, 5);
assert.equal(live.sp500.status, 'LIVE');
assert.equal(live.sp500.value, 6500.25);
assert.equal(live.sp500.changePct, (10 / 6490.25) * 100);
assert.equal(live.sp500.observedAt, today);
assert.ok(live.sp500.latencyMs !== null && live.sp500.latencyMs >= 0);
assert.equal(live.bitcoinActiveAddresses.status, 'LIVE');
assert.equal(live.bitcoinActiveAddresses.value, 650000);
assert.ok(!JSON.stringify(live).includes('test-key-not-a-secret'));

const stale = await fetchFreeMacroData({
  nowMs: nowMs + 20 * 60_000,
  fredApiKey: 'test-key-not-a-secret',
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'api.stlouisfed.org') {
      return Response.json({
        observations: [{
          date: new Date(nowMs - 8 * 24 * 60 * 60_000).toISOString().slice(0, 10),
          value: '6500.25',
        }],
      });
    }
    return Response.json({
      data: [{
        asset: 'btc',
        time: new Date(nowMs - 4 * 24 * 60 * 60_000).toISOString(),
        AdrActCnt: '650000',
      }],
    });
  },
});
assert.equal(stale.sp500.status, 'UNAVAILABLE');
assert.equal(stale.bitcoinActiveAddresses.status, 'UNAVAILABLE');

console.log('Free macro provider schema, freshness, provenance, and secret-isolation checks passed.');
