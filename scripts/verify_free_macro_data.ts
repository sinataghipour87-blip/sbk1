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
    if (endpoint.hostname === 'query1.finance.yahoo.com') {
      assert.equal(endpoint.pathname.endsWith('/DX-Y.NYB'), true);
      return Response.json({
        chart: {
          result: [{
            meta: { chartPreviousClose: 104, regularMarketPrice: 104.25 },
            timestamp: [nowMs / 1_000],
            indicators: { quote: [{ close: [104.25] }] },
          }],
          error: null,
        },
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

assert.equal(requestCount, 6);
assert.equal(live.sp500.status, 'LIVE');
assert.equal(live.sp500.value, 6500.25);
assert.equal(live.sp500.changePct, (10 / 6490.25) * 100);
assert.equal(live.sp500.observedAt, today);
assert.ok(live.sp500.latencyMs !== null && live.sp500.latencyMs >= 0);
assert.equal(live.bitcoinActiveAddresses.status, 'LIVE');
assert.equal(live.bitcoinActiveAddresses.value, 650000);
assert.equal(live.sp500.provider, 'FRED public CSV');
assert.equal(live.dxy.status, 'LIVE');
assert.equal(live.dxy.value, 104.25);
assert.match(live.dxy.provider, /Yahoo Finance chart/);
assert.equal(live.fedEffectiveRate.provider, 'FRED public CSV');
assert.ok(!JSON.stringify(live).includes('api_key'));

const nyFedFallbackNowMs = Date.parse('2026-10-21T20:00:00.000Z');
const nyFedFallback = await fetchFreeMacroData({
  nowMs: nyFedFallbackNowMs,
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      return new Response('<html>maintenance</html>', {
        headers: { 'Content-Type': 'text/html' },
      });
    }
    if (endpoint.hostname === 'markets.newyorkfed.org') {
      assert.equal(endpoint.pathname, '/api/rates/unsecured/effr/search.json');
      assert.equal(endpoint.searchParams.get('endDate'), '2026-10-21');
      return Response.json({
        refRates: [
          { effectiveDate: '2026-10-20', type: 'EFFR', percentRate: 3.88 },
          { effectiveDate: '2026-10-19', type: 'EFFR', percentRate: 3.87 },
        ],
      });
    }
    if (endpoint.hostname === 'query1.finance.yahoo.com') {
      if (endpoint.pathname.endsWith('/^GSPC')) {
        return Response.json({
          chart: { result: [{
            meta: { chartPreviousClose: 6500, regularMarketPrice: 6501 },
            timestamp: [nyFedFallbackNowMs / 1_000],
            indicators: { quote: [{ close: [6501] }] },
          }] },
        });
      }
      throw new Error('DXY quote is stale.');
    }
    return Response.json({
      data: [{
        asset: 'btc',
        time: new Date(nyFedFallbackNowMs - 60 * 60_000).toISOString(),
        AdrActCnt: '650000',
      }],
    });
  },
});
assert.equal(nyFedFallback.fedEffectiveRate.status, 'LIVE');
assert.equal(nyFedFallback.fedEffectiveRate.value, 3.88);
assert.equal(nyFedFallback.fedEffectiveRate.observedAt, '2026-10-20');
assert.equal(
  nyFedFallback.fedEffectiveRate.provider,
  'Federal Reserve Bank of New York reference rates API (EFFR)',
);
assert.equal(nyFedFallback.fedEffectiveRate.previousValue, 3.87);
assert.equal(nyFedFallback.fedTargetUpperBound.status, 'UNAVAILABLE');

const staleNowMs = Date.parse('2026-10-21T20:20:00.000Z');
const stale = await fetchFreeMacroData({
  nowMs: staleNowMs,
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

const dxyNowMs = Date.now();
const dxyTimestampMs = Math.floor(dxyNowMs / 1_000) * 1_000;
let dxyRequestCount = 0;
const dxyLive = await fetchFreeMacroData({
  nowMs: dxyNowMs,
  massiveApiKey: 'verification-secret',
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'api.massive.com') {
      dxyRequestCount += 1;
      assert.equal(endpoint.pathname, '/v3/snapshot/indices');
      assert.equal(endpoint.searchParams.get('ticker'), 'I:DXY');
      assert.equal(endpoint.searchParams.get('apiKey'), 'verification-secret');
      return Response.json({
        results: [{
          ticker: 'I:DXY',
          timeframe: 'REAL-TIME',
          value: 104.25,
          last_updated: dxyTimestampMs * 1_000_000,
          session: { previous_close: 104 },
        }],
      });
    }
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      const seriesId = endpoint.searchParams.get('id');
      const date = new Date(dxyNowMs).toISOString().slice(0, 10);
      return new Response(`observation_date,${seriesId}\n${date},100.5\n`, {
        headers: { 'Content-Type': 'text/csv' },
      });
    }
    return Response.json({
      data: [{
        asset: 'btc',
        time: new Date(dxyNowMs - 60 * 60_000).toISOString(),
        AdrActCnt: '650000',
      }],
    });
  },
});
assert.equal(dxyRequestCount, 1);
assert.equal(dxyLive.dxy.status, 'LIVE');
assert.equal(dxyLive.dxy.value, 104.25);
assert.equal(dxyLive.dxy.previousValue, 104);
assert.equal(dxyLive.dxy.changePct, (0.25 / 104) * 100);
assert.ok(dxyLive.dxy.observedAtMs !== null &&
  Math.abs(dxyLive.dxy.observedAtMs - dxyTimestampMs) <= 1);
assert.equal(dxyLive.dxy.provider, 'Massive Indices Snapshot (I:DXY)');
assert.ok(!JSON.stringify(dxyLive).includes('verification-secret'));

const dxyStale = await fetchFreeMacroData({
  nowMs: dxyNowMs + 3 * 60_000,
  massiveApiKey: 'verification-secret',
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'api.massive.com') {
      return Response.json({
        results: [{
          ticker: 'I:DXY',
          timeframe: 'REAL-TIME',
          value: 104.25,
          last_updated: dxyTimestampMs * 1_000_000,
          session: { previous_close: 104 },
        }],
      });
    }
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      const seriesId = endpoint.searchParams.get('id');
      const date = new Date(dxyNowMs).toISOString().slice(0, 10);
      return new Response(`observation_date,${seriesId}\n${date},100.5\n`, {
        headers: { 'Content-Type': 'text/csv' },
      });
    }
    return Response.json({
      data: [{
        asset: 'btc',
        time: new Date(dxyNowMs).toISOString(),
        AdrActCnt: '650000',
      }],
    });
  },
});
assert.equal(dxyStale.dxy.status, 'UNAVAILABLE');
assert.match(dxyStale.dxy.error ?? '', /stale/);

const dxyUnavailable = await fetchFreeMacroData({
  nowMs: dxyNowMs,
  massiveApiKey: '',
  fetcher: async () => {
    throw new Error('Yahoo DXY fallback unavailable.');
  },
});
assert.equal(dxyUnavailable.dxy.status, 'UNAVAILABLE');
assert.match(dxyUnavailable.dxy.error ?? '', /Yahoo DXY fallback unavailable/);

const delayedDxy = await fetchFreeMacroData({
  nowMs: dxyNowMs + 60_000,
  massiveApiKey: 'verification-secret',
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    assert.equal(endpoint.hostname, 'api.massive.com');
    return Response.json({
      results: [{
        ticker: 'I:DXY',
        timeframe: 'DELAYED',
        value: 104.25,
        last_updated: (dxyTimestampMs + 60_000) * 1_000_000,
        session: { previous_close: 104 },
      }],
    });
  },
});
assert.equal(delayedDxy.dxy.status, 'UNAVAILABLE');
assert.match(delayedDxy.dxy.error ?? '', /no entitled real-time/);

const dxyRequestFailed = await fetchFreeMacroData({
  nowMs: dxyNowMs + 120_000,
  massiveApiKey: 'verification-secret',
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'api.massive.com') {
      throw new Error('request failed: https://api.massive.com/?apiKey=verification-secret');
    }
    if (endpoint.hostname === 'query1.finance.yahoo.com') {
      throw new Error('Yahoo fallback unavailable.');
    }
    throw new Error('cached non-DXY data unexpectedly missed cache');
  },
});
assert.equal(dxyRequestFailed.dxy.status, 'UNAVAILABLE');
assert.ok(!JSON.stringify(dxyRequestFailed).includes('verification-secret'));

const maintenanceNowMs = Date.now() + 24 * 60 * 60_000;
const fredMaintenance = await fetchFreeMacroData({
  nowMs: maintenanceNowMs,
  massiveApiKey: '',
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      return new Response('<!doctype html><title>Site Maintenance</title>');
    }
    return Response.json({
      data: [{
        asset: 'btc',
        time: new Date(maintenanceNowMs - 60 * 60_000).toISOString(),
        AdrActCnt: '650000',
      }],
    });
  },
});
assert.equal(fredMaintenance.sp500.status, 'UNAVAILABLE');
assert.match(fredMaintenance.sp500.error ?? '', /HTML maintenance\/access page/);

console.log('Free macro and live DXY provider schema, freshness, provenance, and secret-isolation checks passed.');
