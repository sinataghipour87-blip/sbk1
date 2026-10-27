import assert from 'node:assert/strict';
import {
  fetchEtherscanWhaleTransfers,
  resetEtherscanWhaleDataCacheForTests,
} from '../src/services/etherscanWhaleData';
import {
  fetchOnChainWhaleData,
  resetPublicBitcoinWhaleDataCacheForTests,
} from '../src/services/publicBitcoinWhaleData';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';

const address = '0x0000000000000000000000000000000000000001';
const token = '0x0000000000000000000000000000000000000002';
const nowMs = Date.now();
const timestamp = String(Math.floor((nowMs - 60_000) / 1_000));
const previousEnv = {
  key: process.env.ETHERSCAN_API_KEY,
  addresses: process.env.SBK1_ETHERSCAN_WATCH_ADDRESSES,
  ethThreshold: process.env.SBK1_WHALE_MIN_ETH,
  tokenThresholds: process.env.SBK1_WHALE_ERC20_THRESHOLDS,
};

process.env.ETHERSCAN_API_KEY = 'fixture-only-key';
process.env.SBK1_ETHERSCAN_WATCH_ADDRESSES = address;
process.env.SBK1_WHALE_MIN_ETH = '100';
process.env.SBK1_WHALE_ERC20_THRESHOLDS = JSON.stringify({ [token]: 500 });

const requestedActions: string[] = [];
const fetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  assert.equal(url.searchParams.get('apikey'), 'fixture-only-key');
  const action = url.searchParams.get('action') ?? '';
  requestedActions.push(action);
  if (action === 'eth_blockNumber') return Response.json({ result: '0x1000' });
  if (action === 'txlist') {
    return Response.json({
      status: '1',
      message: 'OK',
      result: [{
        hash: `0x${'a'.repeat(64)}`,
        timeStamp: timestamp,
        blockNumber: '4080',
        value: String(101 * 1e18),
        isError: '0',
      }],
    });
  }
  assert.equal(action, 'tokentx');
  return Response.json({
    status: '1',
    message: 'OK',
    result: [{
      hash: `0x${'b'.repeat(64)}`,
      timeStamp: timestamp,
      blockNumber: '4080',
      value: '600000000',
      isError: '0',
      tokenName: 'Fixture token',
      tokenSymbol: 'FIX',
      tokenDecimal: '6',
      contractAddress: token,
      logIndex: '0',
    }],
  });
};

resetEtherscanWhaleDataCacheForTests();
const transfers = await fetchEtherscanWhaleTransfers({
  nowMs,
  ethPriceUsd: 3_000,
  fetcher,
});
assert.deepEqual(requestedActions, ['eth_blockNumber', 'txlist', 'tokentx']);
assert.equal(transfers.length, 2);
assert.equal(transfers[0].asset, 'ETH');
assert.equal(transfers[0].amount, 101);
assert.equal(transfers[0].estimatedUsd, 303_000);
assert.equal(transfers[1].asset, 'FIX');
assert.equal(transfers[1].amount, 600);
assert.equal(transfers[1].estimatedUsd, null);
assert.equal(transfers.every((transfer) => transfer.confirmationStatus === 'CONFIRMED'), true);

const updatedPrice = await fetchEtherscanWhaleTransfers({
  nowMs: nowMs + 1_000,
  ethPriceUsd: 2_500,
  fetcher,
});
assert.equal(updatedPrice[0].estimatedUsd, 252_500);
assert.equal(requestedActions.length, 3, 'fresh watchlist results are cached for one minute');

resetPublicBitcoinWhaleDataCacheForTests();
const combined = await fetchOnChainWhaleData({
  pair: 'BTC/USDT:USDT',
  nowMs: nowMs + 2_000,
  priceUsd: 60_000,
  fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'mempool.space' && url.pathname.endsWith('/v1/blocks')) {
      return Response.json([{
        id: 'c'.repeat(64),
        height: 900_003,
        timestamp: Math.floor((nowMs + 2_000) / 1_000),
        tx_count: 1,
      }, {
        id: 'd'.repeat(64),
        height: 900_002,
        timestamp: Math.floor((nowMs + 2_000) / 1_000),
        tx_count: 1,
      }, {
        id: 'e'.repeat(64),
        height: 900_001,
        timestamp: Math.floor((nowMs + 2_000) / 1_000),
        tx_count: 1,
      }]);
    }
    if (url.hostname === 'mempool.space') {
      return Response.json([{
        txid: 'f'.repeat(64),
        status: { confirmed: true, block_height: 900_003, block_time: Math.floor((nowMs + 2_000) / 1_000) },
        vout: [{ value: 1_100_000_000 }],
      }]);
    }
    throw new Error('cached Etherscan response should avoid a credential-bearing HTTP request');
  },
});
assert.equal(combined.status, 'LIVE');
assert.equal(combined.largeTransfers?.some((transfer) => transfer.blockchain === 'bitcoin'), true);
assert.equal(combined.largeTransfers?.some((transfer) => transfer.blockchain === 'ethereum'), false,
  'Bitcoin room must not receive Ethereum watchlist transfers');

const ethereumRoom = await fetchOnChainWhaleData({
  pair: 'ETH/USDT:USDT',
  nowMs: nowMs + 2_000,
  priceUsd: 2_500,
  fetcher,
});
assert.equal(ethereumRoom.pair, 'ETH/USDT:USDT');
assert.equal(ethereumRoom.asset, 'ETH');
assert.equal(ethereumRoom.status, 'LIVE');
assert.equal(ethereumRoom.largeTransfers?.length, 2);
assert.equal(ethereumRoom.largeTransfers?.[0].estimatedUsd, 252_500);
assert.equal(ethereumRoom.largeTransfers?.some((transfer) =>
  transfer.blockchain === 'ethereum' && transfer.asset === 'ETH'
), true, 'Ethereum native transfers remain visible');
assert.equal(ethereumRoom.largeTransfers?.some((transfer) =>
  transfer.blockchain === 'ethereum' && transfer.asset === 'FIX' &&
  transfer.transferId?.startsWith('erc20:')
), true, 'Ethereum ERC-20 transfers remain separately identifiable');
assert.equal(ethereumRoom.sourceId, 'onchain.etherscan-v2');
const ethereumEvidenceVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  whaleFlowData: ethereumRoom,
  nowMs: nowMs + 2_000,
}).members[5];
assert.equal(ethereumEvidenceVote.vote, 'NEUTRAL');
assert.equal(ethereumEvidenceVote.sourceId, 'onchain.etherscan-v2');
assert.match(ethereumEvidenceVote.rationaleFa, /FIX/);

resetEtherscanWhaleDataCacheForTests();
resetPublicBitcoinWhaleDataCacheForTests();
process.env.ETHERSCAN_API_KEY = 'fixture-only-key';
process.env.SBK1_ETHERSCAN_WATCH_ADDRESSES = address;
const fallbackSourceIds: string[] = [];
const emptyEtherscanFallback = await fetchOnChainWhaleData({
  pair: 'ETH/USDT:USDT',
  nowMs: nowMs + 4_000,
  fetcher: async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.etherscan.io') {
      const action = url.searchParams.get('action');
      if (action === 'eth_blockNumber') return Response.json({ status: '1', result: '0x100' });
      return Response.json({ status: '1', message: 'OK', result: [] });
    }
    assert.equal(init?.method, 'POST');
    const payload = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    fallbackSourceIds.push(url.hostname);
    if (payload.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: 1, result: '0x1' });
    if (payload.method === 'eth_blockNumber') return Response.json({ jsonrpc: '2.0', id: 1, result: '0x100' });
    const height = Number.parseInt(String(payload.params[0]), 16);
    const blockTimestamp = Math.floor(Date.now() / 1_000) - 2;
    return Response.json({
      jsonrpc: '2.0',
      id: 1,
      result: {
        number: `0x${height.toString(16)}`,
        timestamp: `0x${blockTimestamp.toString(16)}`,
        transactions: [],
      },
    });
  },
});
assert.equal(emptyEtherscanFallback.status, 'LIVE');
assert.equal(emptyEtherscanFallback.sourceId, 'onchain.ethereum-publicnode');
assert.equal(emptyEtherscanFallback.fallbackSourceId, 'onchain.etherscan-v2');
assert.equal(fallbackSourceIds.every((hostname) => hostname === 'ethereum-rpc.publicnode.com'), true,
  'empty Etherscan data falls back to PublicNode before 1RPC');
const fallbackVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  whaleFlowData: emptyEtherscanFallback,
  nowMs: nowMs + 4_000,
}).members[5];
assert.equal(fallbackVote.sourceId, 'onchain.ethereum-publicnode');
assert.equal(fallbackVote.fallbackSourceId, 'onchain.etherscan-v2');

let unsupportedChainRequested = false;
for (const [pair, asset] of [
  ['SOL/USDT:USDT', 'SOL'],
  ['XRP/USDT:USDT', 'XRP'],
  ['BNB/USDT:USDT', 'BNB'],
] as const) {
  const unsupportedRoom = await fetchOnChainWhaleData({
    pair,
    nowMs,
    priceUsd: 150,
    fetcher: async () => {
      unsupportedChainRequested = true;
      throw new Error(`No ${asset} provider is configured.`);
    },
  });
  assert.equal(unsupportedRoom.status, 'UNAVAILABLE');
  assert.equal(unsupportedRoom.pair, pair);
  assert.equal(unsupportedRoom.asset, asset);
}
assert.equal(unsupportedChainRequested, false,
  'unsupported chains must abstain rather than request BTC/ETH data');

resetEtherscanWhaleDataCacheForTests();
await assert.rejects(
  fetchEtherscanWhaleTransfers({
    nowMs: nowMs + 3_000,
    fetcher: async (input) => {
      const action = new URL(String(input)).searchParams.get('action');
      if (action === 'eth_blockNumber') return Response.json({ result: '0x1000' });
      return Response.json({ status: '1', message: 'OK', result: [{}] });
    },
  }),
  /malformed rows/,
);

resetEtherscanWhaleDataCacheForTests();
resetPublicBitcoinWhaleDataCacheForTests();
process.env.ETHERSCAN_API_KEY = '';
process.env.SBK1_ETHERSCAN_WATCH_ADDRESSES = '';
let requestedWithoutCredentials = false;
const noCredentials = await fetchEtherscanWhaleTransfers({
  nowMs,
  fetcher: async () => {
    requestedWithoutCredentials = true;
    throw new Error('must not request without explicit credentials and watchlist');
  },
});
assert.deepEqual(noCredentials, []);
assert.equal(requestedWithoutCredentials, false);

for (const [key, value] of Object.entries({
  ETHERSCAN_API_KEY: previousEnv.key,
  SBK1_ETHERSCAN_WATCH_ADDRESSES: previousEnv.addresses,
  SBK1_WHALE_MIN_ETH: previousEnv.ethThreshold,
  SBK1_WHALE_ERC20_THRESHOLDS: previousEnv.tokenThresholds,
})) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
resetEtherscanWhaleDataCacheForTests();
console.log('Etherscan optional-key/watchlist, confirmation, native/ ERC-20 threshold, cache, and valuation tests passed.');
