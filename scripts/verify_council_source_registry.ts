import assert from 'node:assert/strict';
import {
  buildCouncilSourceRegistry,
  COUNCIL_MEMBER_SOURCES,
  getCouncilMemberSources,
} from '../src/services/councilSourceRegistry';

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
  'council.member7.stooq': {
    responseTimestampMs: null,
    receivedAtMs: nowMs,
    status: 'REGION_RESTRICTED',
    error: 'HTTP 403 (regional/access restriction)',
  },
}, nowMs);

const find = (id: string) => {
  const entry = registry.find((candidate) => candidate.id === id);
  assert.ok(entry, `registry entry ${id} exists`);
  return entry;
};

assert.deepEqual(
  [...new Set(registry.map((entry) => entry.group))].sort(),
  ['derivatives', 'macro', 'news', 'onchain', 'options', 'orderbook', 'tradeflow', 'trend'],
);
assert.equal(COUNCIL_MEMBER_SOURCES.length, 32);
for (let memberId = 1; memberId <= 8; memberId += 1) {
  assert.deepEqual(
    getCouncilMemberSources(memberId).map(({ priority }) => priority),
    [1, 2, 3, 4],
    `member ${memberId} has four ordered source slots`,
  );
}
assert.deepEqual(
  getCouncilMemberSources(2).map(({ id }) => id),
  [
    'council.member2.coinbase-trades',
    'council.member2.kraken-trades',
    'council.member2.okx-trades',
    'council.member2.bitfinex-trades',
  ],
);
assert.equal(getCouncilMemberSources(2)[0].maxAgeMs, 60_000);
assert.equal(getCouncilMemberSources(5)[3].url, 'https://eapi.binance.com/eapi/v1/mark');
assert.match(getCouncilMemberSources(5)[3].dataType, /response-received time/);
assert.deepEqual(
  getCouncilMemberSources(7).map(({ id }) => id),
  [
    'council.member7.fred',
    'council.member7.cboe-vix',
    'council.member7.yahoo-chart',
    'council.member7.fred-market-series',
  ],
);
assert.match(getCouncilMemberSources(7)[3].provider, /not independent/);
assert.equal(
  COUNCIL_MEMBER_SOURCES.some(({ id }) => id === 'council.member7.stooq'),
  false,
  'Stooq is excluded from member voting sources',
);
assert.deepEqual(
  getCouncilMemberSources(8).map(({ id }) => id),
  [
    'council.member8.decrypt',
    'council.member8.the-block',
    'council.member8.coindesk',
    'council.member8.google-news',
  ],
);
assert.match(getCouncilMemberSources(8)[3].provider, /aggregator.*unofficial/);
for (const asset of ['BTC', 'SOL', 'XRP', 'BNB'] as const) {
  for (const memberId of [1, 2, 3, 4]) {
    const sources = getCouncilMemberSources(memberId, asset);
    assert.equal(sources.length, 4, `${asset} member ${memberId} has four checked market sources`);
    assert.deepEqual(
      sources.map(({ priority }) => priority),
      [1, 2, 3, 4],
      `${asset} member ${memberId} source priority is stable`,
    );
    assert.ok(
      sources.every(({ assets }) => assets?.includes(asset)),
      `${asset} member ${memberId} sources are scoped to that asset`,
    );
  }
  assert.ok(
    getCouncilMemberSources(4, asset).some(({ id }) => id.endsWith('.hyperliquid')),
    `${asset} member 4 includes the asset-specific Hyperliquid context`,
  );
}
const expectedOptionSourceCounts = { BTC: 4, SOL: 3, XRP: 2, BNB: 1 } as const;
const expectedOnChainSourceCounts = { BTC: 2, SOL: 3, XRP: 1, BNB: 3 } as const;
const googleNewsTerms = { BTC: 'Bitcoin', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB' } as const;
for (const [asset, expectedCount] of Object.entries(expectedOptionSourceCounts)) {
  const sources = getCouncilMemberSources(5, asset);
  assert.equal(sources.length, expectedCount, `${asset} has only verified member 5 option sources`);
  assert.deepEqual(
    sources.map(({ priority }) => priority),
    Array.from({ length: expectedCount }, (_, index) => index + 1),
    `${asset} member 5 options preserve verified source priority`,
  );
  assert.ok(
    sources.every(({ assets }) => assets?.includes(asset)),
    `${asset} member 5 option sources are asset-specific`,
  );
}
for (const [asset, expectedCount] of Object.entries(expectedOnChainSourceCounts)) {
  const sources = getCouncilMemberSources(6, asset);
  assert.equal(sources.length, expectedCount, `${asset} has only catalogued member 6 on-chain providers`);
  assert.deepEqual(
    sources.map(({ priority }) => priority),
    Array.from({ length: expectedCount }, (_, index) => index + 1),
    `${asset} member 6 on-chain provider priority is explicit`,
  );
  assert.ok(
    sources.every(({ assets }) => assets?.includes(asset)),
    `${asset} member 6 on-chain providers are scoped to that asset`,
  );
}
for (const asset of ['BTC', 'SOL', 'XRP', 'BNB']) {
  const macroSources = getCouncilMemberSources(7, asset);
  assert.equal(macroSources.length, 4, `${asset} has four shared member 7 macro source slots`);
  assert.ok(
    macroSources.every(({ dataType }) => dataType.startsWith('shared macro; not asset-specific.')),
    `${asset} member 7 sources are explicitly marked shared`,
  );
  const newsSources = getCouncilMemberSources(8, asset);
  assert.equal(newsSources.length, 4, `${asset} has four asset-filtered member 8 news sources`);
  assert.deepEqual(
    newsSources.map(({ priority }) => priority),
    [1, 2, 3, 4],
    `${asset} member 8 news priority is stable`,
  );
  assert.ok(
    newsSources.every(({ assets }) => assets?.includes(asset)),
    `${asset} member 8 news sources are scoped to that asset`,
  );
  assert.match(
    newsSources[3].url,
    new RegExp(`q=${googleNewsTerms[asset]}`),
    `${asset} Google News RSS query is asset-specific`,
  );
}
assert.equal(find('orderbook.binance-depth').health, 'LIVE');
assert.equal(find('orderbook.binance-depth').url, 'https://fapi.binance.com/fapi/v1/depth?symbol=ETHUSDT&limit=20');
assert.equal(find('orderbook.binance-depth').symbol, 'ETHUSDT');
assert.equal(find('orderbook.binance-depth').responseTimestampMs, nowMs - 1_000);
assert.equal(find('orderbook.binance-depth').receivedAtMs, nowMs - 500);
assert.equal(find('orderbook.bybit-depth').enabled, true);
assert.equal(find('orderbook.bybit-trades').fallbackGroup, 'market.trades');
assert.equal(find('market.candles-bybit').enabled, true);
assert.equal(find('market.candles-bybit').priority, 2);
assert.equal(find('market.candles-bybit').fallbackGroup, 'market.closed-15m');
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
assert.equal(find('council.member7.stooq').health, 'REGION_RESTRICTED');
assert.equal(find('onchain.blockstream-transactions').health, 'UNOBSERVED');
assert.match(find('onchain.blockstream-transactions').reason ?? '', /does not expose endpoint-level telemetry/);
assert.equal(find('onchain.ethereum-public-rpc').enabled, true);
assert.match(find('onchain.ethereum-public-rpc').dataType, /no key/);
assert.equal(find('onchain.solana-public-rpc').enabled, true);
assert.match(find('onchain.solana-public-rpc').dataType, /public RPC limits apply/);
assert.equal(find('onchain.bsc-public-rpc').enabled, true);
assert.match(find('onchain.bsc-public-rpc').symbol, /chainid=56/);
assert.equal(find('news.u-today').enabled, true);
assert.equal(find('news.cryptonews').enabled, true);
assert.equal(find('news.cryptopanic').health, 'DISABLED');
assert.match(find('news.cryptopanic').reason ?? '', /HTTP 410/);
assert.equal(find('news.ripple-insights').enabled, false);
assert.equal(find('news.bnb-chain-blog').enabled, false);
assert.equal(find('news.solana').enabled, true);
assert.equal(find('news.solana-status').enabled, true);
assert.equal(find('options.okx').health, 'DISABLED');
assert.equal(find('options.binance-european').enabled, true);
assert.match(find('options.binance-european').dataType, /fallback only/);
assert.equal(find('options.bybit').enabled, true);
assert.equal(find('options.bybit').priority, 3);
assert.equal(find('options.bybit').fallbackGroup, 'options.btc-eth');
assert.equal(find('derivatives.bybit-funding').enabled, false);
assert.equal(find('council.member5.okx-opt-summary').url, 'https://www.okx.com/api/v5/public/opt-summary?uly=ETH-USD');
assert.equal(find('council.member7.stooq').enabled, true);
assert.throws(
  () => buildCouncilSourceRegistry({ 'unknown.endpoint': {
    responseTimestampMs: null,
    receivedAtMs: null,
    status: 'UNAVAILABLE',
  } }, nowMs),
  /Unknown council source registry observation IDs/,
);

console.log('Council source registry checks passed.');
