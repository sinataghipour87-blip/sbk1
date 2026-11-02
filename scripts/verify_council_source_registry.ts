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
assert.equal(COUNCIL_MEMBER_SOURCES.length, 37);
for (let memberId = 1; memberId <= 8; memberId += 1) {
  const expectedSourceCount = memberId === 2 ? 7 : memberId === 5 ? 11 : memberId === 6 ? 6 : 4;
  assert.deepEqual(
    getCouncilMemberSources(memberId).map(({ priority }) => priority),
    Array.from({ length: expectedSourceCount }, (_, index) => index + 1),
    `member ${memberId} has ordered source slots`,
  );
}
assert.deepEqual(
  getCouncilMemberSources(2).map(({ id }) => id),
  [
    'council.member2.coinbase-trades',
    'council.member2.kraken-trades',
    'council.member2.okx-trades',
    'council.member2.bitfinex-trades',
    'council.member2.binance-trades',
    'council.member2.bybit-trades',
    'council.member2.gateio-trades',
  ],
);
assert.equal(getCouncilMemberSources(2)[0].maxAgeMs, 60_000);
assert.equal(getCouncilMemberSources(2)[6].marketType, 'spot');
assert.equal(getCouncilMemberSources(2)[6].independenceGroup, 'gateio');
assert.match(getCouncilMemberSources(2)[6].url, /spot\/trades\?currency_pair=ETH_USDT&limit=100/);
assert.equal(getCouncilMemberSources(5)[3].url, 'https://eapi.binance.com/eapi/v1/exchangeInfo');
assert.match(getCouncilMemberSources(5)[3].dataType, /timestamped index\/OI\/ticker and sampled depth/);
assert.equal(getCouncilMemberSources(5)[4].id, 'council.member5.delta-options');
assert.equal(getCouncilMemberSources(5)[4].apiKeyRequired, false);
assert.equal(getCouncilMemberSources(5)[4].independenceGroup, 'delta-india-options');
assert.match(getCouncilMemberSources(5)[4].url, /api\.india\.delta\.exchange\/v2\/products/);
assert.equal(getCouncilMemberSources(5)[5].id, 'council.member5.gateio-options');
assert.equal(getCouncilMemberSources(5)[5].apiKeyRequired, false);
assert.equal(getCouncilMemberSources(5)[5].independenceGroup, 'gateio-options');
assert.match(getCouncilMemberSources(5)[5].url, /options\/contracts\?underlying=ETH_USDT/);
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
    const expectedCount = memberId === 2 ? asset === 'BNB' ? 5 : 6 : 4;
    assert.equal(sources.length, expectedCount, `${asset} member ${memberId} has registered checked market sources`);
    assert.deepEqual(
      sources.map(({ priority }) => priority),
      Array.from({ length: expectedCount }, (_, index) => index + 1),
      `${asset} member ${memberId} source priority is stable`,
    );
    assert.ok(
      sources.every(({ assets }) => assets?.includes(asset)),
      `${asset} member ${memberId} sources are scoped to that asset`,
    );
  }
  const memberTwoSources = getCouncilMemberSources(2, asset);
  const binanceTradeSource = memberTwoSources.find(({ id }) => id.endsWith('.binance-trades'));
  assert.ok(binanceTradeSource);
  assert.equal(binanceTradeSource.apiKeyRequired, false);
  assert.match(binanceTradeSource.url, /fapi\/v1\/aggTrades\?symbol=.*&limit=1000/);
  const gateTradeSource = memberTwoSources.find(({ id }) => id.endsWith('.gateio-trades'));
  assert.ok(gateTradeSource);
  assert.equal(gateTradeSource.marketType, 'spot');
  assert.equal(gateTradeSource.independenceGroup, 'gateio');
  assert.equal(gateTradeSource.apiKeyRequired, false);
  assert.equal(
    gateTradeSource.url,
    `https://api.gateio.ws/api/v4/spot/trades?currency_pair=${asset}_USDT&limit=100`,
  );
  if (asset === 'BNB') {
    assert.equal(memberTwoSources[0].id, 'council.member2.BNB.bybit-trades');
    assert.equal(memberTwoSources[0].apiKeyRequired, false);
    assert.match(memberTwoSources[0].url, /v5\/market\/recent-trade\?category=linear&symbol=BNBUSDT&limit=1000/);
  }
  assert.ok(
    getCouncilMemberSources(4, asset).some(({ id }) => id.endsWith('.hyperliquid')),
    `${asset} member 4 includes the asset-specific Hyperliquid context`,
  );
}
const expectedOptionSourceCounts = { BTC: 6, ETH: 6, SOL: 3, XRP: 2, BNB: 1 } as const;
const expectedOnChainSourceCounts = { BTC: 6, ETH: 6, SOL: 6, XRP: 6, BNB: 6 } as const;
const googleNewsTerms = { BTC: 'Bitcoin', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB' } as const;
for (const [asset, expectedCount] of Object.entries(expectedOptionSourceCounts)) {
  const sources = getCouncilMemberSources(5, asset);
  assert.equal(sources.length, expectedCount + 5, `${asset} has verified Options and five futures proxy sources`);
  assert.deepEqual(
    sources.map(({ priority }) => priority),
    Array.from({ length: expectedCount + 5 }, (_, index) => index + 1),
    `${asset} member 5 direct and proxy sources preserve priority`,
  );
  assert.ok(
    sources.every(({ assets }) => assets?.includes(asset)),
    `${asset} member 5 sources are asset-specific`,
  );
  const proxySources = sources.filter(({ id }) => id.includes('.proxy.'));
  assert.deepEqual(
    proxySources.map(({ provider }) => provider),
    [
      'Binance USD-M Futures',
      'Bybit V5 Linear Futures',
      'OKX V5 Swap',
      'KuCoin Futures',
      'Gate.io USDT Futures',
    ],
    `${asset} has independently identified futures proxy venues`,
  );
  assert.ok(proxySources.every(({ marketType, maxAgeMs, independenceGroup }) =>
    marketType === 'futures' && maxAgeMs === 6 * 60_000 && Boolean(independenceGroup)
  ), `${asset} futures proxy sources declare market, freshness, and independence`);
  assert.match(proxySources[0].url, /fapi\.binance\.com\/fapi\/v1\/premiumIndex/);
  assert.match(proxySources[1].url, /api\.bybit\.com\/v5\/market\/tickers/);
  assert.match(proxySources[2].url, /www\.okx\.com\/api\/v5\/public\/funding-rate/);
  assert.match(proxySources[3].url, /api-futures\.kucoin\.com\/api\/v1\/contracts\//);
  assert.match(proxySources[4].url, /api\.gateio\.ws\/api\/v4\/futures\/usdt\/contract_stats/);
}
const btcGateOptions = getCouncilMemberSources(5, 'BTC').find(({ id }) =>
  id.endsWith('.gateio-options'),
);
assert.equal(btcGateOptions?.id, 'council.member5.BTC.gateio-options');
assert.equal(btcGateOptions?.independenceGroup, 'gateio-options');
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
assert.deepEqual(
  getCouncilMemberSources(6, 'BTC').map(({ id }) => id),
  [
    'onchain.mempool-blocks',
    'onchain.blockstream-blocks',
    'onchain.blockchair-bitcoin',
    'onchain.blockcypher-bitcoin',
    'onchain.btcscan-bitcoin',
    'onchain.blockchain-com-bitcoin',
  ],
  'BTC has six public, keyless independent block-health sources',
);
assert.deepEqual(
  getCouncilMemberSources(6, 'ETH').map(({ id }) => id),
  [
    'onchain.ethereum-public-rpc',
    'onchain.ethereum-1rpc',
    'onchain.ethereum-routescan',
    'onchain.ethereum-blockscout',
    'onchain.ethereum-blockchair',
    'onchain.defillama-ethereum',
  ],
  'ETH has six public, keyless infrastructure/context sources',
);
assert.deepEqual(
  getCouncilMemberSources(6, 'SOL').map(({ id }) => id),
  [
    'onchain.solana-public-rpc',
    'onchain.solana-publicnode',
    'onchain.dexscreener-solana',
    'onchain.solana-status',
    'onchain.jupiter-solana',
    'onchain.geckoterminal-solana',
  ],
  'SOL has six public, keyless infrastructure/context sources',
);
assert.deepEqual(
  getCouncilMemberSources(6, 'BNB').map(({ id }) => id),
  [
    'onchain.bsc-publicnode',
    'onchain.bsc-1rpc',
    'onchain.bsc-defibit',
    'onchain.bsc-bloxroute',
    'onchain.bsc-blastapi',
    'onchain.bsc-public-rpc',
  ],
  'BNB has six public, keyless BSC RPC sources',
);
assert.deepEqual(
  getCouncilMemberSources(6, 'XRP').map(({ id }) => id),
  [
    'onchain.xrpscan-xrp',
    'onchain.xrplcluster-xrp',
    'onchain.xrpl-ws-xrp',
    'onchain.ripple-s2-xrp',
    'onchain.blockchair-xrp',
    'onchain.coinpaprika-xrp',
  ],
  'XRP has six public, keyless ledger/market-health sources',
);
for (const asset of ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'] as const) {
  const sources = getCouncilMemberSources(6, asset);
  assert.ok(
    sources.every(({ apiKeyRequired }) => apiKeyRequired === false),
    `${asset} Member 6 has no API-key-required sources`,
  );
  assert.ok(
    sources.every(({ url }) => url.startsWith('https://') && !url.includes('{apiKey}')),
    `${asset} Member 6 endpoints are public HTTPS URLs without embedded credentials`,
  );
}
assert.ok(
  getCouncilMemberSources(6, 'BTC').every(({ maxAgeMs }) => maxAgeMs === 20 * 60_000),
  'BTC Member 6 providers have a 20-minute freshness limit',
);
assert.ok(
  getCouncilMemberSources(6, 'SOL').every(({ maxAgeMs }) => maxAgeMs === 5 * 60_000),
  'SOL Member 6 providers have a five-minute freshness limit',
);
assert.ok(
  getCouncilMemberSources(6, 'ETH').every(({ maxAgeMs }) => maxAgeMs === 5 * 60_000),
  'ETH on-chain providers have a five-minute freshness limit',
);
for (const asset of ['BNB', 'XRP'] as const) {
  const sources = getCouncilMemberSources(6, asset);
  assert.ok(
    sources.every(({ maxAgeMs }) => maxAgeMs === 5 * 60_000),
    `${asset} Member 6 providers have a five-minute freshness limit`,
  );
  assert.ok(
    sources.every(({ apiKeyRequired, url }) =>
      apiKeyRequired === false && url.startsWith('https://') && !url.includes('{apiKey}')
    ),
    `${asset} Member 6 sources are public HTTPS endpoints without API keys`,
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
assert.match(find('onchain.solana-public-rpc').dataType, /public RPC/);
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
assert.equal(
  find('council.member5.okx-opt-summary').url,
  'https://www.okx.com/api/v5/public/instruments?instType=OPTION&uly=ETH-USD',
);
assert.ok(
  find('council.member5.okx-opt-summary').additionalHealthUrls?.includes(
    'https://www.okx.com/api/v5/public/opt-summary?uly=ETH-USD',
  ),
  'OKX active instruments are discovered separately from the option-summary endpoint',
);
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
