import assert from 'node:assert/strict';
import { buildCouncilSourceRegistry } from '../src/services/councilSourceRegistry';

const nowMs = Date.parse('2026-10-22T12:00:00.000Z');
const registry = buildCouncilSourceRegistry({
  'orderbook.binance-depth': {
    responseTimestampMs: nowMs - 1_000,
    receivedAtMs: nowMs - 500,
    status: 'LIVE',
    url: 'https://fapi.binance.com/fapi/v1/depth?symbol=ETHUSDT&limit=20',
    symbol: 'ETHUSDT',
  },
  'macro.fred-broad-dollar': {
    responseTimestampMs: nowMs - 24 * 60 * 60_000,
    receivedAtMs: nowMs - 100,
    status: 'LIVE',
    url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS',
    symbol: 'DTWEXBGS',
  },
  'news.coindesk': {
    responseTimestampMs: nowMs - 7 * 60 * 60_000,
    receivedAtMs: nowMs - 100,
    status: 'LIVE',
  },
  'options.deribit-summary': {
    responseTimestampMs: nowMs + 1,
    receivedAtMs: nowMs - 10,
    status: 'LIVE',
  },
  'derivatives.binance-funding': {
    responseTimestampMs: null,
    receivedAtMs: null,
    status: 'UNAVAILABLE',
    error: 'HTTP 503',
  },
}, nowMs);

const find = (id: string) => {
  const entry = registry.find((candidate) => candidate.id === id);
  assert.ok(entry, `registry entry ${id} exists`);
  return entry;
};

assert.deepEqual(
  [...new Set(registry.map((entry) => entry.group))].sort(),
  ['derivatives', 'macro', 'news', 'onchain', 'options', 'orderbook'],
);
assert.equal(find('orderbook.binance-depth').health, 'LIVE');
assert.equal(find('orderbook.binance-depth').url, 'https://fapi.binance.com/fapi/v1/depth?symbol=ETHUSDT&limit=20');
assert.equal(find('orderbook.binance-depth').symbol, 'ETHUSDT');
assert.equal(find('orderbook.binance-depth').responseTimestampMs, nowMs - 1_000);
assert.equal(find('orderbook.binance-depth').receivedAtMs, nowMs - 500);
assert.equal(find('macro.fred-broad-dollar').health, 'LIVE');
assert.equal(find('macro.fred-broad-dollar').symbol, 'DTWEXBGS');
assert.equal(find('macro.fred-broad-dollar').realtimeEligible, false);
assert.match(find('macro.fred-broad-dollar').dataType, /broad-dollar-index.*not ICE DXY/);
assert.equal(find('news.coindesk').health, 'STALE');
assert.match(find('news.coindesk').reason ?? '', /freshness limit/);
assert.equal(find('options.deribit-summary').health, 'UNAVAILABLE');
assert.match(find('options.deribit-summary').reason ?? '', /future-dated/);
assert.equal(find('derivatives.binance-funding').health, 'UNAVAILABLE');
assert.equal(find('derivatives.binance-funding').reason, 'HTTP 503');
assert.equal(find('onchain.blockstream-transactions').health, 'UNOBSERVED');
assert.match(find('onchain.blockstream-transactions').reason ?? '', /does not expose endpoint-level telemetry/);
assert.equal(find('news.cryptopanic').health, 'DISABLED');
assert.match(find('news.cryptopanic').reason ?? '', /HTTP 410/);
assert.equal(find('options.okx').health, 'DISABLED');
assert.equal(find('derivatives.bybit-funding').enabled, false);
assert.throws(
  () => buildCouncilSourceRegistry({ 'unknown.endpoint': {
    responseTimestampMs: null,
    receivedAtMs: null,
    status: 'UNAVAILABLE',
  } }, nowMs),
  /Unknown council source registry observation IDs/,
);

console.log('Council source registry checks passed.');
