import assert from 'node:assert/strict';
import { fetchFreeMacroData } from '../src/services/freeMacroData';

const nowMs = Date.parse('2026-10-17T20:00:00.000Z');
const today = new Date(nowMs).toISOString().slice(0, 10);
const yesterday = new Date(nowMs - 24 * 60 * 60_000).toISOString().slice(0, 10);
let requestCount = 0;

const live = await fetchFreeMacroData({
  nowMs,
  fetcher: async (input, init) => {
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
      assert.match(new Headers(init?.headers).get('user-agent') ?? '', /Mozilla\/5\.0/);
      assert.match(new Headers(init?.headers).get('accept-language') ?? '', /en-US/);
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
assert.equal(stale.sp500.status, 'LIVE', 'weekly macro series remain usable within the 14-day freshness window');
assert.equal(stale.sp500.observedAt, '2026-10-16');
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
assert.equal(dxyUnavailable.dxyProxy?.status, 'UNAVAILABLE');

const tradingViewNowMs = Date.now();
const tradingViewProxy = await fetchFreeMacroData({
  nowMs: tradingViewNowMs,
  massiveApiKey: '',
  fetcher: async (input, init) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      const seriesId = endpoint.searchParams.get('id');
      const date = new Date(tradingViewNowMs).toISOString().slice(0, 10);
      return new Response(`observation_date,${seriesId}\n${date},100.5\n`, {
        headers: { 'Content-Type': 'text/csv' },
      });
    }
    if (endpoint.hostname === 'query1.finance.yahoo.com') {
      throw new Error('Yahoo DXY is rate-limited.');
    }
    if (endpoint.hostname === 'scanner.tradingview.com') {
      assert.equal(init?.method, 'POST');
      assert.match(new Headers(init?.headers).get('user-agent') ?? '', /Mozilla\/5\.0/);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        symbols: { tickers: ['TVC:DXY'], query: { types: [] } },
        columns: ['close', 'change', 'update_mode', 'type', 'subtype'],
      });
      return Response.json({
        totalCount: 1,
        data: [{
          s: 'TVC:DXY',
          d: [101.616, -0.07375, 'streaming', 'index', 'cfd'],
        }],
      });
    }
    return Response.json({
      data: [{
        asset: 'btc',
        time: new Date(tradingViewNowMs - 60 * 60_000).toISOString(),
        AdrActCnt: '650000',
      }],
    });
  },
});
assert.equal(tradingViewProxy.dxy.status, 'UNAVAILABLE', 'a CFD proxy must never be reported as exact DXY');
assert.equal(tradingViewProxy.dxyProxy?.status, 'LIVE');
assert.equal(tradingViewProxy.dxyProxy?.value, 101.616);
assert.equal(tradingViewProxy.dxyProxy?.changePct, -0.07375);
assert.match(tradingViewProxy.dxyProxy?.provider ?? '', /TVC:DXY CFD/);
assert.match(tradingViewProxy.dxyProxy?.metric ?? '', /not official ICE DXY/);
assert.equal(tradingViewProxy.dxyProxy?.observedAtMs, tradingViewProxy.dxyProxy?.retrievedAtMs,
  'proxy timestamp explicitly means scanner retrieval time, not exchange observation time');

const invalidTradingViewResponses: Array<{ payload: unknown; error: RegExp }> = [
  { payload: { totalCount: 0, data: [] }, error: /malformed or incomplete/ },
  {
    payload: { totalCount: 1, data: [{ s: 'TVC:EURUSD', d: [1.08, 0.1, 'streaming', 'index', 'cfd'] }] },
    error: /unexpected DXY symbol or schema/,
  },
  {
    payload: { totalCount: 1, data: [{ s: 'TVC:DXY', d: [101.616, -0.07375, 'delayed', 'index', 'cfd'] }] },
    error: /not marked streaming/,
  },
  {
    payload: { totalCount: 1, data: [{ s: 'TVC:DXY', d: [101.616, -0.07375, 'streaming', 'index', 'spot'] }] },
    error: /not marked streaming/,
  },
];
for (const invalidResponse of invalidTradingViewResponses) {
  const tradingViewUnavailable = await fetchFreeMacroData({
    nowMs: tradingViewNowMs + 10_000,
    massiveApiKey: '',
    fetcher: async (input) => {
      const endpoint = new URL(String(input));
      if (endpoint.hostname === 'scanner.tradingview.com') {
        return Response.json(invalidResponse.payload);
      }
      if (endpoint.hostname === 'fred.stlouisfed.org') {
        const seriesId = endpoint.searchParams.get('id');
        const date = new Date(tradingViewNowMs).toISOString().slice(0, 10);
        return new Response(`observation_date,${seriesId}\n${date},100.5\n`, {
          headers: { 'Content-Type': 'text/csv' },
        });
      }
      throw new Error('No usable DXY source.');
    },
  });
  assert.equal(tradingViewUnavailable.dxyProxy?.status, 'UNAVAILABLE');
  assert.match(tradingViewUnavailable.dxyProxy?.error ?? '', invalidResponse.error);
}

const closedSessionNowMs = Date.now() + 3 * 60_000;
const closedSessionDxyTimestampMs =
  Math.floor((closedSessionNowMs - 3 * 24 * 60 * 60_000) / 1_000) * 1_000;
const closedSessionDxy = await fetchFreeMacroData({
  nowMs: closedSessionNowMs,
  massiveApiKey: '',
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'query1.finance.yahoo.com') {
      assert.match(endpoint.search, /range=5d/);
      return Response.json({
        chart: { result: [{
          meta: {
            chartPreviousClose: 104,
            regularMarketPrice: 104.25,
            currentTradingPeriod: {
              regular: {
                start: Math.floor((closedSessionNowMs - 6 * 60 * 60_000) / 1_000),
                end: Math.floor((closedSessionNowMs - 60 * 60_000) / 1_000),
              },
            },
          },
          timestamp: [Math.floor(closedSessionDxyTimestampMs / 1_000)],
          indicators: { quote: [{ close: [104.25] }] },
        }] },
      });
    }
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      const seriesId = endpoint.searchParams.get('id');
      return new Response(`observation_date,${seriesId}\n2026-10-16,100.5\n`, {
        headers: { 'Content-Type': 'text/csv' },
      });
    }
    return Response.json({ data: [] });
  },
});
assert.equal(closedSessionDxy.dxy.status, 'LIVE');
assert.equal(closedSessionDxy.dxy.observedAtMs, closedSessionDxyTimestampMs);
assert.match(closedSessionDxy.dxy.provider, /Yahoo Finance chart/);

const closedSessionCacheFallback = await fetchFreeMacroData({
  nowMs: closedSessionNowMs + 31_000,
  massiveApiKey: '',
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'query1.finance.yahoo.com') {
      throw new Error('Yahoo temporary outage.');
    }
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      const seriesId = endpoint.searchParams.get('id');
      return new Response(`observation_date,${seriesId}\n2026-10-16,100.5\n`, {
        headers: { 'Content-Type': 'text/csv' },
      });
    }
    return Response.json({ data: [] });
  },
});
assert.equal(closedSessionCacheFallback.dxy.status, 'LIVE');
assert.match(closedSessionCacheFallback.dxy.provider, /cached last close/);

const openSessionNowMs = closedSessionNowMs + 62_000;
const staleOpenSessionDxy = await fetchFreeMacroData({
  nowMs: openSessionNowMs,
  massiveApiKey: '',
  fetcher: async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === 'query1.finance.yahoo.com') {
      return Response.json({
        chart: { result: [{
          meta: {
            chartPreviousClose: 104,
            regularMarketPrice: 104.25,
            currentTradingPeriod: {
              regular: {
                start: Math.floor((openSessionNowMs - 60_000) / 1_000),
                end: Math.floor((openSessionNowMs + 6 * 60 * 60_000) / 1_000),
              },
            },
          },
          timestamp: [Math.floor(closedSessionDxyTimestampMs / 1_000)],
          indicators: { quote: [{ close: [104.25] }] },
        }] },
      });
    }
    if (endpoint.hostname === 'fred.stlouisfed.org') {
      const seriesId = endpoint.searchParams.get('id');
      return new Response(`observation_date,${seriesId}\n2026-10-16,100.5\n`, {
        headers: { 'Content-Type': 'text/csv' },
      });
    }
    return Response.json({ data: [] });
  },
});
assert.equal(staleOpenSessionDxy.dxy.status, 'UNAVAILABLE');
assert.match(staleOpenSessionDxy.dxy.error ?? '', /live limit/);

const delayedDxy = await fetchFreeMacroData({
  nowMs: dxyNowMs + 24 * 60 * 60_000,
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
  nowMs: dxyNowMs + 24 * 60 * 60_000 + 60_000,
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
