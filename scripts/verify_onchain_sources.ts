import assert from 'node:assert/strict';
import {
  countDistinctWhaleSourceOperators,
  getWhaleSourceOperator,
} from '../src/services/whaleConsensusCandidateRegistry';
import {
  buildSolanaGetBlockParams,
  collectCompleteBtcTransactionPages,
  filterSourcesByMedianHeight,
  getPublicSourceBackoffUntil,
  getPublicSourceCircuitOpenUntil,
  isAllowedPublicEndpointUrl,
  isHealthySourcePingSet,
  isValidSolanaMainnetGenesisHash,
  isValidXrpMainnetNetworkId,
  listPublicWhaleSources,
  ONCHAIN_SOURCE_CONFIG,
  requestPublicWhaleSourceJson,
  type PublicWhaleSource,
} from '../src/services/publicWhaleObservationPoller';

const sources = listPublicWhaleSources();
const expectedOperators: Record<string, string | null> = {
  'BTC/mempool.space': 'mempool-space',
  'BTC/blockstream': 'blockstream',
  'BTC/mempool-emzy': 'emzy',
  'BTC/mempool-ninja': 'mempool-ninja',
  'BTC/btcscan': 'btcscan',
  'BTC/mempool-bullbitcoin': 'bullbitcoin',
  'BTC/mempool-sweetsats': 'sweetsats',
  'ETH/ethereum-rpc-publicnode': 'publicnode',
  'ETH/ethereum-rpc-mevblocker': 'mevblocker',
  'ETH/ethereum-rpc-blockrazor': 'blockrazor',
  'ETH/ethereum-rpc-flashbots': 'flashbots',
  'ETH/ethereum-rpc-meowrpc': 'meowrpc',
  'ETH/ethereum-rpc-zan': 'zan',
  'ETH/ethereum-rpc-bloxroute': 'bloxroute',
  'ETH/ethereum-rpc-nownodes': 'nownodes',
  'BNB/bsc-rpc-publicnode': 'publicnode',
  'BNB/bsc-rpc-blockrazor': 'blockrazor',
  'BNB/bsc-rpc-meowrpc': 'meowrpc',
  'BNB/bsc-rpc-bloxroute': 'bloxroute',
  'BNB/bsc-rpc-48club': '48club',
  'BNB/bsc-rpc-defibit': null,
  'SOL/solana-rpc-solana-foundation': 'solana-foundation',
  'SOL/solana-rpc-solana-foundation-beta': 'solana-foundation',
  'SOL/solana-rpc-publicnode': 'allnodes-publicnode',
  'SOL/solana-rpc-vibestation': 'solanavibestation',
  'SOL/solana-rpc-pocket': 'pocket-network',
  'SOL/solana-rpc-web3cdn': 'web3cdn',
  'SOL/solana-rpc-tatum': null,
  'XRP/xrp-rpc-xrplcluster': 'infrastructure-xrpl-foundation',
  'XRP/xrp-rpc-xrpl-ws': 'infrastructure-xrpl-foundation',
  'XRP/xrp-rpc-honeycluster': 'honeycluster',
  'XRP/xrp-rpc-ripple-s1': 'ripple',
  'XRP/xrp-rpc-ripple-s2': 'ripple',
  'XRP/xrp-rpc-ankr': 'ankr',
  'XRP/xrp-rpc-unverified-backup': null,
};
const expectedPrimaryUrls: Record<string, string> = {
  'BTC/mempool.space': 'https://mempool.space/api',
  'BTC/blockstream': 'https://blockstream.info/api',
  'BTC/mempool-emzy': 'https://mempool.emzy.de/api',
  'BTC/mempool-ninja': 'https://mempool.ninja/api',
  'BTC/btcscan': 'https://btcscan.org/api',
  'BTC/mempool-bullbitcoin': 'https://mempool.bullbitcoin.com/api',
  'BTC/mempool-sweetsats': 'https://mempool.sweetsats.io/api',
  'ETH/ethereum-rpc-publicnode': 'https://ethereum-rpc.publicnode.com',
  'ETH/ethereum-rpc-mevblocker': 'https://rpc.mevblocker.io',
  'ETH/ethereum-rpc-blockrazor': 'https://eth.blockrazor.xyz',
  'ETH/ethereum-rpc-flashbots': 'https://rpc.flashbots.net',
  'ETH/ethereum-rpc-meowrpc': 'https://eth.meowrpc.com',
  'ETH/ethereum-rpc-zan': 'https://api.zan.top/eth-mainnet',
  'ETH/ethereum-rpc-bloxroute': 'https://eth.rpc.blxrbdn.com',
  'ETH/ethereum-rpc-nownodes': 'https://public-eth.nownodes.io',
  'BNB/bsc-rpc-publicnode': 'https://bsc-rpc.publicnode.com',
  'BNB/bsc-rpc-blockrazor': 'https://bsc.blockrazor.xyz',
  'BNB/bsc-rpc-meowrpc': 'https://bsc.meowrpc.com',
  'BNB/bsc-rpc-bloxroute': 'https://bsc.rpc.blxrbdn.com',
  'BNB/bsc-rpc-48club': 'https://rpc-bsc.48.club',
  'BNB/bsc-rpc-defibit': 'https://bsc-dataseed1.defibit.io',
  'SOL/solana-rpc-solana-foundation': 'https://api.mainnet.solana.com',
  'SOL/solana-rpc-solana-foundation-beta': 'https://api.mainnet-beta.solana.com',
  'SOL/solana-rpc-publicnode': 'https://solana-rpc.publicnode.com',
  'SOL/solana-rpc-vibestation': 'https://public.rpc.solanavibestation.com',
  'SOL/solana-rpc-pocket': 'https://solana.api.pocket.network',
  'SOL/solana-rpc-web3cdn': 'https://solana.web3cdn.rest',
  'SOL/solana-rpc-tatum': 'https://solana-mainnet.gateway.tatum.io',
  'XRP/xrp-rpc-xrplcluster': 'https://xrplcluster.com',
  'XRP/xrp-rpc-xrpl-ws': 'https://xrpl.ws',
  'XRP/xrp-rpc-honeycluster': 'https://honeycluster.io',
  'XRP/xrp-rpc-ripple-s1': 'https://s1.ripple.com',
  'XRP/xrp-rpc-ripple-s2': 'https://s2.ripple.com',
  'XRP/xrp-rpc-ankr': 'https://rpc.ankr.com/xrp_mainnet',
  'XRP/xrp-rpc-unverified-backup': 'https://xrpl.link',
};
const expectedIndependentCounts = { BTC: 7, ETH: 8, BNB: 5, SOL: 5, XRP: 4 } as const;

assert.deepEqual(
  Object.fromEntries(sources.map(({ asset, sourceId, operatorId }) => [`${asset}/${sourceId}`, operatorId])),
  expectedOperators,
  'sources must be limited to the approved primary endpoints and explicit backups',
);
assert.deepEqual(
  Object.fromEntries(sources.map(({ asset, sourceId, urls }) => {
    const url = new URL(urls[0]);
    return [`${asset}/${sourceId}`, `${url.origin}${url.pathname.replace(/\/$/, '')}`];
  })),
  expectedPrimaryUrls,
  'primary URLs must match the reviewed public endpoint list',
);
for (const [asset, expectedCount] of Object.entries(expectedIndependentCounts)) {
  const assetSources = sources.filter((source) => source.asset === asset);
  const independentOperators = new Set(assetSources
    .filter(({ independent }) => independent)
    .map(({ operatorId }) => operatorId));
  assert.equal(independentOperators.size, expectedCount, `${asset} independent operator count`);
  assert.equal(new Set(assetSources.map(({ sourceId }) => sourceId)).size, assetSources.length,
    `${asset} source IDs must be unique`);
  for (const source of assetSources) {
    assert.equal(source.operatorId, getWhaleSourceOperator(asset, source.sourceId));
    assert.ok(source.urls.every((url) => isAllowedPublicEndpointUrl(url)));
  }
}

for (const backupId of ['bsc-rpc-defibit', 'solana-rpc-tatum', 'xrp-rpc-unverified-backup']) {
  const source = sources.find(({ sourceId }) => sourceId === backupId);
  assert.ok(source);
  assert.equal(source.independent, false);
  assert.equal(source.operatorId, null);
  assert.equal(getWhaleSourceOperator(source.asset, backupId), null);
  assert.equal(countDistinctWhaleSourceOperators(source.asset, [backupId]), 0);
}
assert.equal(getWhaleSourceOperator('SOL', 'solana-rpc-solana-foundation-beta'), 'solana-foundation',
  'Solana mainnet and mainnet-beta endpoints share one operator');
assert.equal(countDistinctWhaleSourceOperators('SOL', [
  'solana-rpc-solana-foundation',
  'solana-rpc-solana-foundation-beta',
]), 1);
assert.equal(countDistinctWhaleSourceOperators('XRP', [
  'xrp-rpc-ripple-s1',
  'xrp-rpc-ripple-s2',
]), 1, 'Ripple S1 and S2 endpoints count as one operator');
assert.equal(countDistinctWhaleSourceOperators('XRP', [
  'xrp-rpc-xrplcluster',
  'xrp-rpc-xrpl-ws',
]), 1, 'XRPLCluster and xrpl.ws endpoints count as one operator');
assert.equal(countDistinctWhaleSourceOperators('BTC', ['mempool.space', 'blockstream']), 2);
assert.equal(getWhaleSourceOperator('BTC', 'unlisted-source'), null,
  'unknown source IDs must not count toward quorum');
assert.equal(getWhaleSourceOperator('BNB', 'local-exchange-address-list'), null,
  'BNB exchange attribution remains intentionally outside this task');

assert.equal(countDistinctWhaleSourceOperators('ETH', ['ethereum-rpc-blockrazor', 'ethereum-rpc-bloxroute']), 2);
assert.equal(countDistinctWhaleSourceOperators('BNB', ['bsc-rpc-blockrazor', 'bsc-rpc-bloxroute']), 2,
  'operator IDs are counted per chain, not across chains');

assert.equal(isAllowedPublicEndpointUrl('https://api.mainnet.solana.com'), true);
assert.equal(isAllowedPublicEndpointUrl('https://example.invalid/devnet'), false);
assert.equal(isAllowedPublicEndpointUrl('https://example.invalid/testnet'), false);
assert.equal(isAllowedPublicEndpointUrl('https://user:pass@example.invalid'), false);
assert.equal(isValidSolanaMainnetGenesisHash('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'), true);
assert.equal(isValidSolanaMainnetGenesisHash('wrong-genesis'), false);
assert.equal(isValidXrpMainnetNetworkId(0), true);
assert.equal(isValidXrpMainnetNetworkId('0'), true);
assert.equal(isValidXrpMainnetNetworkId(1), false);
assert.equal(isHealthySourcePingSet([2_999, 2_999, 2_999, 2_999, 2_999]), true);
assert.equal(isHealthySourcePingSet([3_000, 3_000, 3_000, 3_000, 3_000]), false);
assert.equal(isHealthySourcePingSet([1, 1, 1, 1, 5_001]), false);
assert.equal(isHealthySourcePingSet([1, 1, 1, 1]), false);
assert.equal(ONCHAIN_SOURCE_CONFIG.requestTimeoutMs, 5_000);
assert.equal(ONCHAIN_SOURCE_CONFIG.healthPingTimeoutMs, 5_000);
assert.equal(ONCHAIN_SOURCE_CONFIG.maxConcurrentRequests, 4);
assert.equal(ONCHAIN_SOURCE_CONFIG.circuitBreakerFailureCount, 3);
assert.equal(ONCHAIN_SOURCE_CONFIG.circuitBreakerCooldownMs, 300_000);
const web3cdn = sources.find(({ sourceId }) => sourceId === 'solana-rpc-web3cdn');
assert.ok(web3cdn);
assert.equal(web3cdn.timeoutMs, ONCHAIN_SOURCE_CONFIG.requestTimeoutMs);
assert.equal(web3cdn.blockTimeoutMs, ONCHAIN_SOURCE_CONFIG.solanaWeb3CdnBlockTimeoutMs);
assert.equal(web3cdn.blockTimeoutMs, 15_000);
const blockParams = buildSolanaGetBlockParams(42);
assert.equal(blockParams[0], 42);
assert.equal(
  (blockParams[1] as { maxSupportedTransactionVersion: number }).maxSupportedTransactionVersion,
  1,
);

const filteredBtc = filterSourcesByMedianHeight('BTC', [
  { sourceId: 'a', operatorId: 'a', height: 100 },
  { sourceId: 'b', operatorId: 'b', height: 101 },
  { sourceId: 'c', operatorId: 'c', height: 102 },
  { sourceId: 'outlier', operatorId: 'outlier', height: 110 },
]);
assert.deepEqual(filteredBtc.map(({ sourceId }) => sourceId), ['a', 'b', 'c']);
assert.deepEqual(
  filterSourcesByMedianHeight('SOL', [
    { sourceId: 'a', operatorId: 'a', height: 1_000 },
    { sourceId: 'b', operatorId: 'b', height: 1_001 },
    { sourceId: 'c', operatorId: 'c', height: 1_002 },
    { sourceId: 'd', operatorId: 'd', height: 1_151 },
  ], 150).map(({ sourceId }) => sourceId),
  ['a', 'b', 'c', 'd'],
);
assert.deepEqual(
  filterSourcesByMedianHeight('SOL', [
    { sourceId: 'a', operatorId: 'a', height: 1_000 },
    { sourceId: 'b', operatorId: 'b', height: 1_001 },
    { sourceId: 'c', operatorId: 'c', height: 1_002 },
    { sourceId: 'outlier', operatorId: 'outlier', height: 1_152 },
  ], 150).map(({ sourceId }) => sourceId),
  ['a', 'b', 'c'],
);
assert.deepEqual(
  filterSourcesByMedianHeight('XRP', [
    { sourceId: 'a', operatorId: 'a', height: 10 },
    { sourceId: 'b', operatorId: 'b', height: 11 },
    { sourceId: 'c', operatorId: 'c', height: 13 },
    { sourceId: 'outlier', operatorId: 'outlier', height: 18 },
  ], 3).map(({ sourceId }) => sourceId),
  ['a', 'b', 'c'],
);

const btcTransaction = (txid: string) => ({
  txid: `${'a'.repeat(63)}${txid.slice(-1)}`,
  status: { confirmed: true, block_height: 100, block_time: 1_700_000_000 },
  vin: [],
  vout: [],
});
const completePages = await collectCompleteBtcTransactionPages(
  'block',
  2,
  async (startIndex) => [btcTransaction(`tx-${startIndex}`)],
  'btcscan',
);
assert.equal(completePages.length, 2);
await assert.rejects(
  collectCompleteBtcTransactionPages(
    'block',
    2,
    async (startIndex) => startIndex === 0 ? [btcTransaction('tx-0')] : [],
    'btcscan',
  ),
  /invalid or incomplete/,
  'a partial BTC pagination result must be rejected in full',
);

const rateLimitedSource = sources.find(({ asset, sourceId }) =>
  asset === 'BTC' && sourceId === 'mempool-emzy');
assert.ok(rateLimitedSource);
let rateLimitRequests = 0;
const beforeRateLimit = Date.now();
await assert.rejects(
  requestPublicWhaleSourceJson(
    rateLimitedSource,
    undefined,
    async () => {
      rateLimitRequests += 1;
      return new Response('', { status: 429, headers: { 'retry-after': '60' } });
    },
    { retries: false },
  ),
  /HTTP 429/,
);
assert.equal(rateLimitRequests, 1, 'HTTP 429 must not cause an immediate retry');
assert.ok((getPublicSourceBackoffUntil(rateLimitedSource.sourceId) ?? 0) > beforeRateLimit);
await assert.rejects(
  requestPublicWhaleSourceJson(
    rateLimitedSource,
    undefined,
    async () => {
      rateLimitRequests += 1;
      return new Response('1', { status: 200 });
    },
    { retries: false },
  ),
  /temporarily disabled/,
);
assert.equal(rateLimitRequests, 1, 'a 429 source must stay disabled during its backoff window');

const timeoutSource: PublicWhaleSource = {
  asset: 'BTC',
  sourceId: 'verify-timeout',
  operatorId: null,
  independent: false,
  urls: ['https://example.invalid'],
  timeoutMs: ONCHAIN_SOURCE_CONFIG.requestTimeoutMs,
};
await assert.rejects(
  requestPublicWhaleSourceJson(
    timeoutSource,
    undefined,
    async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('request timed out')), { once: true });
    }),
    { timeoutMs: 20, retries: false },
  ),
  /request timed out/,
  'the configured per-request timeout must abort a hanging request',
);

const circuitSource: PublicWhaleSource = {
  asset: 'BTC',
  sourceId: 'verify-circuit-breaker',
  operatorId: null,
  independent: false,
  urls: ['https://example.invalid'],
  timeoutMs: ONCHAIN_SOURCE_CONFIG.requestTimeoutMs,
};
let circuitRequests = 0;
const failingFetcher: typeof fetch = async () => {
  circuitRequests += 1;
  return new Response('', { status: 503 });
};
for (let failure = 0; failure < 3; failure += 1) {
  await assert.rejects(
    requestPublicWhaleSourceJson(circuitSource, undefined, failingFetcher, { retries: false }),
    /HTTP 503/,
  );
}
assert.ok(getPublicSourceCircuitOpenUntil(circuitSource.sourceId));
await assert.rejects(
  requestPublicWhaleSourceJson(circuitSource, undefined, failingFetcher, { retries: false }),
  /circuit is open/,
);
assert.equal(circuitRequests, 3, 'three consecutive failures must trigger a five-minute cooldown');

const concurrentSource = sources.find(({ asset, sourceId }) =>
  asset === 'BTC' && sourceId === 'mempool-ninja');
assert.ok(concurrentSource);
let activeRequests = 0;
let maximumConcurrentRequests = 0;
await Promise.all(Array.from({ length: 10 }, () =>
  requestPublicWhaleSourceJson(concurrentSource, undefined, async () => {
    activeRequests += 1;
    maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeRequests -= 1;
    return new Response('1', { status: 200 });
  }),
));
assert.ok(maximumConcurrentRequests <= 4, 'public source requests must obey the global concurrency limit');

console.info('[verify_onchain_sources] source maps, operator quorum, health gates, timeouts, breaker, pagination, and 429 backoff passed.');
