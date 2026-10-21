import assert from 'node:assert/strict';
import { fetchFreeMacroData } from '../src/services/freeMacroData';

const nowMs = Date.parse('2026-10-17T20:00:00.000Z');
const today = new Date(nowMs).toISOString().slice(0, 10);
const yesterday = new Date(nowMs - 24 * 60 * 60_000).toISOString().slice(0, 10);
let requestCount = 0;

const live = await fetchFreeMacroData({
  nowMs,
  fetcher: async (input) => {
    requestCount += 1;
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      assert.equal(endpoint.pathname, '/graph/fredgraph.csv');
      assert.ok(['SP500', 'DTWEXBGS', 'DFF', 'DFEDTARU'].includes(endpoint.searchParams.get('id') ?? ''));
      assert.equal(endpoint.searchParams.has('api_key'), false);
      return new Response(`observation_date,${endpoint.searchParams.get('id')}\n${yesterday},6490.25\n${today},6500.25\n`, {
        headers: { 'Content-Type': 'text/csv' },
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
assert.equal(live.sp500.provider, 'FRED public CSV');
assert.ok(!JSON.stringify(live).includes('api_key'));

const stale = await fetchFreeMacroData({
  nowMs: Date.parse('2026-10-21T20:00:00.000Z'),
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      const publishedDate = '2026-10-16';
      return new Response(`observation_date,${endpoint.searchParams.get('id')}\n${publishedDate},6500.25\n`, {
        headers: { 'Content-Type': 'text/csv' },
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
assert.match(stale.sp500.error ?? '', /latest finite observation is 2026-10-16/);
assert.match(stale.sp500.error ?? '', /exceeding the 7200-minute freshness limit/);
assert.equal(stale.bitcoinActiveAddresses.status, 'UNAVAILABLE');

const freshnessBoundaryNowMs = Date.parse('2026-10-21T00:00:00.000Z');
const freshnessBoundary = await fetchFreeMacroData({
  nowMs: freshnessBoundaryNowMs,
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      const seriesId = endpoint.searchParams.get('id');
      assert.equal(endpoint.searchParams.get('cosd'), '2026-10-07');
      assert.equal(endpoint.searchParams.get('coed'), '2026-10-21');
      return new Response(
        `observation_date,${seriesId}\n2026-10-15,6490.25\n2026-10-16,6500.25\n`,
        { headers: { 'Content-Type': 'text/csv' } },
      );
    }
    return Response.json({
      data: [{
        asset: 'btc',
        time: new Date(freshnessBoundaryNowMs - 60 * 60_000).toISOString(),
        AdrActCnt: '650000',
      }],
    });
  },
});
assert.equal(freshnessBoundary.sp500.status, 'LIVE');
assert.equal(freshnessBoundary.sp500.ageMs, 5 * 24 * 60 * 60_000);

console.log('Free macro provider schema, freshness, provenance, and secret-isolation checks passed.');
