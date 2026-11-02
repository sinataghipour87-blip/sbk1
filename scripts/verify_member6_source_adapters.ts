import assert from 'node:assert/strict';
import { getCouncilMemberSources } from '../src/services/councilSourceRegistry';
import { checkCouncilMemberSources } from '../src/services/councilSourceHealth';

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
    'onchain.ethereum-1rpc',
    'onchain.ethereum-routescan',
    'onchain.ethereum-blockscout',
    'onchain.ethereum-blockchair',
    'onchain.defillama-ethereum',
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
    'onchain.bsc-1rpc',
    'onchain.bsc-meowrpc',
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
    'onchain.coinpaprika-xrp',
  ],
} as const;

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
  assert.equal(results.length, 6, `${asset} has six independent health results`);
  assert.deepEqual(results.map(({ sourceId }) => sourceId), sourceIds);
  assert.ok(results.every(({ status }) => status !== 'MISSING_API_KEY'));
  assert.ok(results.every(({ voteValue }) => voteValue === 'LOW_VALUE'));

  console.log(`\n${asset} Member 6 live public-source checks:`);
  for (const result of results) {
    const ageMs = result.sourceTimestampMs === null
      ? 'provider timestamp unavailable'
      : `${Math.max(0, checkedAtMs - result.sourceTimestampMs)}ms`;
    console.log(`- ${result.provider}: ${result.status}; age=${ageMs}; ${result.detail}`);
  }
}

console.log('\nMember 6 live public-source checks completed.');
