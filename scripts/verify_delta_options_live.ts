import assert from 'node:assert/strict';
import { getCouncilMemberSources } from '../src/services/councilSourceRegistry';
import { fetchDeltaOptionsData } from '../src/services/deltaOptionsData';

const startedAtMs = Date.now();
const apiRoot = 'https://api.india.delta.exchange/v2';
const productsResponse = await fetch(`${apiRoot}/products?contract_types=call_options,put_options`, {
  cache: 'no-store',
  headers: { Accept: 'application/json' },
});
assert.equal(productsResponse.ok, true, `Delta India products HTTP ${productsResponse.status}`);
const productsPayload: unknown = await productsResponse.json();
assert.ok(
  typeof productsPayload === 'object' &&
  productsPayload !== null &&
  'success' in productsPayload &&
  productsPayload.success === true &&
  'result' in productsPayload &&
  Array.isArray(productsPayload.result),
  'Delta India products response is successful and contains a result array.',
);

const nowMs = Date.now();
const products = productsPayload.result.filter((product) =>
  typeof product === 'object' &&
  product !== null &&
  'underlying_asset' in product &&
  typeof product.underlying_asset === 'object' &&
  product.underlying_asset !== null &&
  'symbol' in product.underlying_asset &&
  'state' in product &&
  product.state === 'live' &&
  'trading_status' in product &&
  product.trading_status === 'operational' &&
  'contract_type' in product &&
  (product.contract_type === 'call_options' || product.contract_type === 'put_options') &&
  'settlement_time' in product &&
  typeof product.settlement_time === 'string' &&
  Date.parse(product.settlement_time) > nowMs,
);

const contractCoverage = Object.fromEntries(
  ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'].map((asset) => {
    const contracts = products.filter((product) =>
      typeof product.underlying_asset === 'object' &&
      product.underlying_asset !== null &&
      'symbol' in product.underlying_asset &&
      product.underlying_asset.symbol === asset,
    );
    return [asset, {
      activeContracts: contracts.length,
      calls: contracts.filter((product) => product.contract_type === 'call_options').length,
      puts: contracts.filter((product) => product.contract_type === 'put_options').length,
    }];
  }),
);

const results = [];
for (const asset of ['BTC', 'ETH'] as const) {
  const pair = `${asset}/USDT:USDT`;
  const result = await fetchDeltaOptionsData({ pair });
  assert.equal(result.status, 'LIVE', `${asset} Delta options source: ${result.unavailableReason ?? result.status}`);
  assert.ok(result.timestampMs !== null && result.timestampMs <= Date.now() + 1_000);
  assert.ok(result.ageMs !== null && result.ageMs >= 0 && result.ageMs <= 60_000);
  assert.ok(result.qualityPct >= 80, `${asset} quality ${result.qualityPct}% is below 80%.`);
  assert.ok((result.contractsCount ?? 0) >= 20);
  assert.ok((result.callContractsCount ?? 0) >= 4);
  assert.ok((result.putContractsCount ?? 0) >= 4);
  assert.ok((result.bidAskSizeValidatedContracts ?? 0) >= 8);
  assert.ok((result.callOpenInterest ?? 0) > 0 && (result.putOpenInterest ?? 0) > 0);
  const source = getCouncilMemberSources(5, asset).find(({ id }) => id.endsWith('.delta-options'));
  assert.ok(source, `${asset} Delta options source is registered.`);
  assert.equal(source.apiKeyRequired, false);
  results.push({
    asset,
    sourceId: source.id,
    endpoint: source.url,
    status: result.status,
    receivedAt: result.retrievedAtMs === null ? null : new Date(result.retrievedAtMs).toISOString(),
    dataTimestamp: result.timestampMs === null ? null : new Date(result.timestampMs).toISOString(),
    ageMs: result.ageMs,
    qualityPct: result.qualityPct,
    contracts: result.contractsCount,
    calls: result.callContractsCount,
    puts: result.putContractsCount,
    sampledOrderBooks: result.bidAskSizeValidatedContracts,
    medianSpreadPct: result.medianBidAskSpreadPct,
    callOpenInterestUsd: result.callOpenInterest,
    putOpenInterestUsd: result.putOpenInterest,
    putCallRatio: result.putCallRatio,
    impliedVolatilityPct: result.impliedVolatilityPct,
    turnover24hUsd: result.volume24h,
  });
}

for (const asset of ['SOL', 'XRP', 'BNB']) {
  const coverage = contractCoverage[asset];
  assert.equal(coverage.activeContracts, 0, `Unexpected live Delta India ${asset} options; registry scope needs review.`);
}

console.log(JSON.stringify({
  test: 'DELTA_OPTIONS_LIVE',
  startedAt: new Date(startedAtMs).toISOString(),
  completedAt: new Date().toISOString(),
  apiKeyRequired: false,
  endpoints: [
    `${apiRoot}/products?contract_types=call_options,put_options`,
    `${apiRoot}/tickers?contract_types=call_options,put_options`,
    `${apiRoot}/l2orderbook/{product_id}`,
  ],
  activeContractCoverage: contractCoverage,
  results,
}, null, 2));
