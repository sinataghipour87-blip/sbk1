import assert from 'node:assert/strict';
import { getCouncilMemberSources } from '../src/services/councilSourceRegistry';
import { checkCouncilMemberSources } from '../src/services/councilSourceHealth';
import { getOnChainMonitoringFeeds } from '../src/services/onChainFeedRegistry';

const assets = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'] as const;
const registeredFeeds = assets.flatMap((asset) => {
  const feeds = getOnChainMonitoringFeeds(asset);
  assert.equal(feeds.length, 6, `${asset} has exactly six registered transaction/RPC feeds`);
  return feeds;
});
assert.equal(registeredFeeds.length, 30, 'Member 6 has 30 registered public on-chain feeds');
assert.ok(registeredFeeds.every(({ apiKeyRequired }) => apiKeyRequired === false),
  'all 30 monitoring feeds are keyless');
assert.ok(registeredFeeds.some((feed) =>
  feed.asset === 'ETH' && feed.url === 'https://ethereum.publicnode.com/'
), 'ETH includes the public keyless PublicNode alias');
assert.ok(registeredFeeds.some((feed) =>
  feed.asset === 'ETH' && feed.url === 'https://eth.drpc.org/'
), 'ETH includes the public keyless dRPC gateway');
assert.ok(registeredFeeds.filter((feed) => feed.asset === 'BTC' && feed.url.endsWith('/mempool/recent')).length === 3,
  'BTC has three keyless recent-mempool feeds');
assert.ok(registeredFeeds.some((feed) =>
  feed.asset === 'BNB' && feed.url === 'https://bsc-dataseed.binance.org'
), 'BNB includes Binance Official DataSeed');
assert.ok(registeredFeeds.every(({ url }) =>
  !/\/(?:[a-f0-9]{32,}|[^/]*api.?key[^/]*)\/?$/i.test(new URL(url.replace(/\{[^}]+\}/g, 'placeholder')).pathname)
), 'registered feed URLs do not contain path-embedded credentials');

const expectedSources = {
  BTC: [
    'onchain.mempool-blocks',
    'onchain.blockstream-blocks',
    'onchain.blockchair-bitcoin',
    'onchain.blockcypher-bitcoin',
    'onchain.btcscan-bitcoin',
    'onchain.blockchain-com-bitcoin',
  ],
  ETH: [
    'onchain.ethereum-public-rpc',
    'onchain.ethereum-flashbots',
    'onchain.ethereum-routescan',
    'onchain.ethereum-blockscout',
    'onchain.ethereum-blockchair',
    'onchain.ethereum-drpc',
  ],
  SOL: [
    'onchain.solana-public-rpc',
    'onchain.solana-publicnode',
    'onchain.dexscreener-solana',
    'onchain.solana-status',
    'onchain.jupiter-solana',
    'onchain.geckoterminal-solana',
  ],
  BNB: [
    'onchain.bsc-publicnode',
    'onchain.bsc-binance-dataseed',
    'onchain.bsc-defibit',
    'onchain.bsc-bloxroute',
    'onchain.bsc-blastapi',
    'onchain.bsc-public-rpc',
  ],
  XRP: [
    'onchain.xrpscan-xrp',
    'onchain.xrplcluster-xrp',
    'onchain.xrpl-ws-xrp',
    'onchain.ripple-s2-xrp',
    'onchain.blockchair-xrp',
    'onchain.ripple-s1-xrp',
  ],
} as const;

let healthySourceCount = 0;
for (const [asset, sourceIds] of Object.entries(expectedSources)) {
  const definitions = getCouncilMemberSources(6, asset);
  assert.equal(definitions.length, 6, `${asset} has exactly six registered sources`);
  assert.deepEqual(definitions.map(({ id }) => id), sourceIds);
  assert.ok(definitions.every(({ apiKeyRequired }) => apiKeyRequired === false));
  assert.ok(definitions.every(({ maxAgeMs }) =>
    maxAgeMs === (asset === 'BTC' ? 20 * 60_000 : 5 * 60_000)
  ));

  const checkedAtMs = Date.now();
  const checks = await checkCouncilMemberSources(
    checkedAtMs,
    fetch,
    asset,
    null,
    [6],
  );
  const results = checks[6] ?? [];
  assert.equal(results.length, 6, `${asset} has six registered source health results`);
  assert.deepEqual(results.map(({ sourceId }) => sourceId), sourceIds);
  assert.ok(results.every(({ status }) => status !== 'MISSING_API_KEY'));
  assert.ok(results.every(({ voteValue }) => voteValue === 'LOW_VALUE'));

  console.log(`\n${asset} Member 6 live public-source checks:`);
  const healthyCount = results.filter(({ status }) => status === 'HEALTHY').length;
  healthySourceCount += healthyCount;
  for (const result of results) {
    const ageMs = result.sourceTimestampMs === null
      ? 'provider timestamp unavailable'
      : `${Math.max(0, checkedAtMs - result.sourceTimestampMs)}ms`;
    console.log(`- ${result.provider}: ${result.status}; age=${ageMs}; ${result.detail}`);
  }
  console.log(`${asset}: ${healthyCount}/${results.length} sources HEALTHY.`);
}

console.log(`\nMember 6 live public-source checks completed: ${healthySourceCount}/30 HEALTHY.`);
