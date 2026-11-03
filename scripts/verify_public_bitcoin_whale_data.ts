import assert from 'node:assert/strict';
import {
  fetchPublicBitcoinWhaleData,
  fetchOnChainWhaleData,
  resetPublicBitcoinWhaleDataCacheForTests,
} from '../src/services/publicBitcoinWhaleData';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';
import { resetEtherscanWhaleDataCacheForTests } from '../src/services/etherscanWhaleData';
import { resetWhaleAlertFlowCacheForTests } from '../src/services/whaleAlertFlow';

const nowMs = Date.now();
const blockTimestamp = Math.floor((nowMs - 60_000) / 1_000);
const requests: string[] = [];
const blockHash = (height: number) => height.toString(16).padStart(64, '0');
const duplicateTxHash = 'a'.repeat(64);
const blocks = [900_003, 900_002, 900_001].map((height) => ({
  id: blockHash(height),
  height,
  timestamp: blockTimestamp,
  tx_count: 1,
}));

const successfulFetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  requests.push(url.toString());
  if (url.pathname.endsWith('/blocks')) return Response.json(blocks);
  if (url.pathname.endsWith(`/block/${blockHash(900_003)}/txs`)) {
    return Response.json([{
      txid: duplicateTxHash,
      status: { confirmed: true, block_height: 900_003, block_time: blockTimestamp },
      vout: [{ value: 1_200_000_000 }, { value: 50_000_000 }],
    }]);
  }
  if (url.pathname.endsWith(`/block/${blockHash(900_002)}/txs`)) {
    return Response.json([{
      txid: duplicateTxHash,
      status: { confirmed: true, block_height: 900_003, block_time: blockTimestamp },
      vout: [{ value: 1_200_000_000 }],
    }]);
  }
  return Response.json([{
    txid: 'b'.repeat(64),
    status: { confirmed: true, block_height: 900_001, block_time: blockTimestamp },
    vout: [{ value: 100_000_000 }],
  }]);
};

resetPublicBitcoinWhaleDataCacheForTests();
const data = await fetchPublicBitcoinWhaleData({
  nowMs,
  btcPriceUsd: 60_000,
  fetcher: successfulFetcher,
  sleep: async () => {},
});
assert.equal(data.status, 'LIVE');
assert.equal(data.sourceId, 'onchain.mempool-blocks');
assert.equal(typeof data.retrievedAtMs, 'number');
assert.equal(data.provider.includes('mempool.space'), true);
assert.equal(data.coverageStatus, 'SAMPLED');
assert.equal(data.largeTransfers?.length, 1, 'duplicate tx outputs across sampled blocks are deduplicated');
assert.equal(data.largeTransfers?.[0].amount, 12);
assert.equal(data.largeTransfers?.[0].estimatedUsd, 720_000);
assert.equal(data.largeTransfers?.[0].confirmationStatus, 'CONFIRMED');
assert.equal(data.largeTransfers?.[0].blockHeight, 900_003);
assert.equal(data.largeTransfers?.[0].transferId, 'vout:0');
assert.equal(requests.length, 15, 'three fast mempool feeds are queried before confirmed-block fallback');

resetPublicBitcoinWhaleDataCacheForTests();
const pendingTxHash = 'f'.repeat(64);
const mempoolRequests: string[] = [];
const pendingMempool = await fetchPublicBitcoinWhaleData({
  nowMs,
  btcPriceUsd: 60_000,
  fetcher: async (input) => {
    const url = new URL(String(input));
    mempoolRequests.push(`${url.hostname}${url.pathname}`);
    if (url.pathname.endsWith('/mempool/recent')) {
      return Response.json([{ txid: pendingTxHash, fee: 1000, vsize: 200, value: 1_200_000_000 }]);
    }
    if (url.pathname === `/api/tx/${pendingTxHash}`) {
      return Response.json({
        txid: pendingTxHash,
        status: { confirmed: false },
        vin: [{ prevout: { scriptpubkey_address: 'bc1qsource', value: 1_300_000_000 } }],
        vout: [{ value: 1_200_000_000, scriptpubkey_address: 'bc1qdestination' }],
      });
    }
    if (url.pathname.endsWith('/blocks')) return new Response('', { status: 503 });
    throw new Error(`Unexpected mempool request ${url.toString()}`);
  },
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(pendingMempool.status, 'LIVE');
assert.equal(pendingMempool.largeTransfers?.length, 1);
assert.equal(pendingMempool.largeTransfers?.[0].confirmationStatus, 'UNCONFIRMED');
assert.equal(pendingMempool.largeTransfers?.[0].amount, 12);
assert.equal(pendingMempool.largeTransfers?.[0].providerConfirmations, 3,
  'pending whale output is reported only after agreement from independent mempool operators');
assert.equal(pendingMempool.networkMetrics?.pendingMempoolScanSources, 3);
assert.equal(mempoolRequests.slice(0, 3).every((request) => request.endsWith('/mempool/recent')), true,
  'all rapid mempool checks complete before confirmed-block sampling begins');
assert.equal(
  evaluateEightMemberCouncil({ whaleFlowData: pendingMempool, nowMs }).members[5].vote,
  'ABSTAIN',
  'unconfirmed mempool volume is monitored but cannot cast a Member 6 directional vote',
);

resetPublicBitcoinWhaleDataCacheForTests();
const liveSourceNowMs = Date.now();
const freshBlockTimestamp = Math.floor((liveSourceNowMs - 1_000) / 1_000);
const requestStartClockMs = liveSourceNowMs - 10_000;
const callerClockFetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/blocks')) {
    return Response.json(blocks.map((block) => ({ ...block, timestamp: freshBlockTimestamp })));
  }
  return Response.json([]);
};
const clockSkewData = await fetchPublicBitcoinWhaleData({
  nowMs: requestStartClockMs,
  fetcher: callerClockFetcher,
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(clockSkewData.status, 'LIVE',
  'a block timestamp newer than the caller start time but valid at response time must not be marked stale');
assert.ok((clockSkewData.ageMs ?? Infinity) >= 0);

const report = evaluateEightMemberCouncil({ whaleFlowData: data, nowMs });
assert.equal(report.members.length, 8);
assert.equal(report.quorumRequired, 5);
assert.equal(report.members[5].vote, 'ABSTAIN');
assert.equal(report.members.filter((member) => member.id === 6).length, 1);
assert.match(report.members[5].rationaleFa, /دادهٔ خامِ بدون تطبیق CEX Watchlist جهت معامله را ثابت نمی‌کند/);

const staleForCouncil = {
  ...data,
  timestampMs: nowMs - 21 * 60_000,
  ageMs: 21 * 60_000,
};
assert.equal(
  evaluateEightMemberCouncil({ whaleFlowData: staleForCouncil, nowMs }).members[5].vote,
  'ABSTAIN',
  'the on-chain member abstains when sampled block evidence exceeds twenty minutes',
);

resetPublicBitcoinWhaleDataCacheForTests();
let activeBlockRequests = 0;
let maximumConcurrentBlockRequests = 0;
const concurrentBlockFetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/blocks')) return Response.json(blocks);
  activeBlockRequests += 1;
  maximumConcurrentBlockRequests = Math.max(maximumConcurrentBlockRequests, activeBlockRequests);
  await new Promise((resolve) => setTimeout(resolve, 20));
  activeBlockRequests -= 1;
  return Response.json([{
    txid: 'c'.repeat(64),
    status: { confirmed: true, block_height: 900_003, block_time: blockTimestamp },
    vout: [{ value: 1_200_000_000 }],
  }]);
};
const concurrentlySampled = await fetchPublicBitcoinWhaleData({
  nowMs,
  btcPriceUsd: 60_000,
  fetcher: concurrentBlockFetcher,
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(concurrentlySampled.status, 'LIVE');
assert.ok(maximumConcurrentBlockRequests > 1, 'sampled block transaction pages are requested concurrently');

resetPublicBitcoinWhaleDataCacheForTests();
let singleFlightRequests = 0;
const singleFlightFetcher: typeof fetch = async (input) => {
  singleFlightRequests += 1;
  const url = new URL(String(input));
  if (url.pathname.endsWith('/blocks')) return Response.json(blocks);
  return Response.json([{
    txid: duplicateTxHash,
    status: { confirmed: true, block_height: 900_003, block_time: blockTimestamp },
    vout: [{ value: 1_200_000_000 }],
  }]);
};
const [firstSingleFlight, secondSingleFlight] = await Promise.all([
  fetchPublicBitcoinWhaleData({
    nowMs,
    btcPriceUsd: 60_000,
    fetcher: singleFlightFetcher,
    sleep: async () => {},
    forceRefresh: true,
  }),
  fetchPublicBitcoinWhaleData({
    nowMs,
    btcPriceUsd: 70_000,
    fetcher: singleFlightFetcher,
    sleep: async () => {},
    forceRefresh: true,
  }),
]);
assert.equal(singleFlightRequests, 15, 'foreground council reads share the background in-flight refresh');
assert.equal(firstSingleFlight.largeTransfers?.[0].estimatedUsd, 720_000);
assert.equal(secondSingleFlight.largeTransfers?.[0].estimatedUsd, 840_000,
  'shared prefetched transfers use the current caller price for optional USD estimates');

resetPublicBitcoinWhaleDataCacheForTests();
const noPrice = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: successfulFetcher,
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(noPrice.largeTransfers?.[0].estimatedUsd, null);

const priorThreshold = process.env.SBK1_WHALE_MIN_TRANSFER_BTC;
process.env.SBK1_WHALE_MIN_TRANSFER_BTC = '13';
resetPublicBitcoinWhaleDataCacheForTests();
const configuredThreshold = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: successfulFetcher,
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(configuredThreshold.status, 'LIVE');
assert.equal(configuredThreshold.largeTransfers?.length, 0);
assert.equal(
  evaluateEightMemberCouncil({ whaleFlowData: configuredThreshold, nowMs }).members[5].vote,
  'ABSTAIN',
  'fresh sampled blocks without independently confirmed whale transfers do not vote',
);
if (priorThreshold === undefined) delete process.env.SBK1_WHALE_MIN_TRANSFER_BTC;
else process.env.SBK1_WHALE_MIN_TRANSFER_BTC = priorThreshold;

const typicalBitcoinBlockInterval = {
  ...data,
  pair: 'BTC/USDT:USDT',
  status: 'LIVE' as const,
  asset: 'BTC',
  timestampMs: nowMs - 6 * 60_000,
  ageMs: 6 * 60_000,
  largeTransfers: [],
};
assert.equal(
  evaluateEightMemberCouncil({
    pair: 'BTC/USDT:USDT',
    whaleFlowData: typicalBitcoinBlockInterval,
    nowMs,
  }).members[5].vote,
  'ABSTAIN',
  'a fresh Bitcoin block without CEX-attributed direction remains an abstention',
);
process.env.SBK1_WHALE_MIN_TRANSFER_BTC = '1';
resetPublicBitcoinWhaleDataCacheForTests();
const belowFloorBitcoin = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/blocks')) return Response.json(blocks);
    return Response.json([{
      txid: duplicateTxHash,
      status: { confirmed: true, block_height: 900_003, block_time: blockTimestamp },
      vout: [{ value: 900_000_000 }],
    }]);
  },
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(belowFloorBitcoin.status, 'LIVE');
assert.deepEqual(belowFloorBitcoin.largeTransfers, [], 'a low override cannot lower the BTC floor below 10');
if (priorThreshold === undefined) delete process.env.SBK1_WHALE_MIN_TRANSFER_BTC;
else process.env.SBK1_WHALE_MIN_TRANSFER_BTC = priorThreshold;

resetPublicBitcoinWhaleDataCacheForTests();
let attempts = 0;
const retryDelays: number[] = [];
const rateLimitedFetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/v1/blocks')) {
    attempts += 1;
    if (attempts === 1) return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
    return Response.json(blocks);
  }
  if (url.pathname.includes('/block/')) return Response.json([]);
  throw new Error('Unexpected request.');
};
const rateLimited = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: rateLimitedFetcher,
  sleep: async (ms) => { retryDelays.push(ms); },
  forceRefresh: true,
});
assert.equal(rateLimited.status, 'LIVE');
assert.equal(attempts, 2);
assert.ok(retryDelays.includes(500), 'Retry-After is capped to keep source recovery bounded');

resetPublicBitcoinWhaleDataCacheForTests();
const mirrorRequests: string[] = [];
const mirrorData = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    mirrorRequests.push(`${url.hostname}${url.pathname}`);
    if (url.hostname === 'mempool.space') return new Response('', { status: 503 });
    if (url.pathname === '/api/blocks') return Response.json(blocks);
    if (url.pathname.includes('/api/block/')) {
      return Response.json([{
        txid: 'd'.repeat(64),
        status: { confirmed: true, block_height: 900_003, block_time: blockTimestamp },
        vout: [{ value: 1_500_000_000 }],
      }]);
    }
    throw new Error(`Unexpected mirror request ${url.toString()}`);
  },
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(mirrorData.status, 'LIVE');
assert.equal(mirrorData.sourceId, 'onchain.blockstream-blocks');
assert.equal(mirrorData.fallbackSourceId, 'onchain.btcscan-bitcoin');
assert.match(mirrorData.provider, /Blockstream/);
assert.equal(mirrorData.largeTransfers?.[0].sourceProvider, 'Blockstream Esplora');
assert.equal(mirrorData.largeTransfers?.[0].amount, 15);
assert.equal(mirrorRequests.filter((request) => request.startsWith('mempool.space')).length, 4,
  'the failed mempool and block endpoints each get one fast retry before switching to mirrors');
assert.equal(mirrorRequests.some((request) => request.startsWith('blockstream.info/api/blocks')), true);

resetPublicBitcoinWhaleDataCacheForTests();
let timeoutAttempts = 0;
const timeoutData = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: async () => {
    timeoutAttempts += 1;
    throw new DOMException('request timed out', 'AbortError');
  },
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(timeoutData.status, 'UNAVAILABLE');
assert.equal(timeoutAttempts, 12, 'each pending-mempool and confirmed-block source gets one bounded retry');

resetPublicBitcoinWhaleDataCacheForTests();
const malformed = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: async () => Response.json([{ id: 'bad' }]),
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(malformed.status, 'UNAVAILABLE');
assert.match(malformed.unavailableReason ?? '', /malformed or incomplete/);

resetPublicBitcoinWhaleDataCacheForTests();
const failed = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: async () => new Response('', { status: 503 }),
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(failed.status, 'UNAVAILABLE');
assert.match(failed.unavailableReason ?? '', /HTTP 503/);

resetPublicBitcoinWhaleDataCacheForTests();
let staleTransactionRequests = 0;
const stale = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/mempool/recent')) return new Response('', { status: 503 });
    if (url.pathname.endsWith('/blocks')) {
      return Response.json(blocks.map((block) => ({
        ...block,
        timestamp: Math.floor((nowMs - 21 * 60_000) / 1_000),
      })));
    }
    staleTransactionRequests += 1;
    return Response.json([]);
  },
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(stale.status, 'STALE');
assert.match(stale.unavailableReason ?? '', /stale/);
assert.equal(staleTransactionRequests, 0, 'stale BTC blocks are rejected before transaction-volume requests');
assert.equal(
  evaluateEightMemberCouncil({ whaleFlowData: stale, nowMs }).members[5].vote,
  'ABSTAIN',
);

resetPublicBitcoinWhaleDataCacheForTests();
const freshnessBoundaryNowMs = Date.now();
const nearFreshnessBoundary = await fetchPublicBitcoinWhaleData({
  nowMs: freshnessBoundaryNowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/mempool/recent')) return new Response('', { status: 503 });
    if (url.pathname.endsWith('/blocks')) {
      return Response.json(blocks.map((block) => ({
        ...block,
        timestamp: Math.floor((freshnessBoundaryNowMs - (5 * 60_000 - 10_000)) / 1_000),
      })));
    }
    return Response.json([]);
  },
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(nearFreshnessBoundary.status, 'LIVE');
const cacheCrossingFreshnessBoundary = await fetchPublicBitcoinWhaleData({
  nowMs: freshnessBoundaryNowMs + 15_000,
  fetcher: async () => {
    throw new Error('The still-valid request cache should prevent a new fetch.');
  },
  sleep: async () => {},
});
assert.equal(
  cacheCrossingFreshnessBoundary.status,
  'STALE',
  'cached Member 6 evidence becomes stale once it exceeds the five-minute TTL',
);

resetPublicBitcoinWhaleDataCacheForTests();
const cachedFreshSample = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: successfulFetcher,
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(cachedFreshSample.status, 'LIVE');
const cachedOnProviderError = await fetchPublicBitcoinWhaleData({
  nowMs: nowMs + 2 * 60_000,
  fetcher: async () => new Response('', { status: 503 }),
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(cachedOnProviderError.status, 'LIVE');
assert.equal(cachedOnProviderError.retrievedAtMs, cachedFreshSample.retrievedAtMs,
  'a failed refresh retains the timestamp of the successful source retrieval');
assert.match(cachedOnProviderError.unavailableReason ?? '', /using the last successful sample/);
assert.equal(
  evaluateEightMemberCouncil({ whaleFlowData: cachedOnProviderError, nowMs: nowMs + 2 * 60_000 }).members[5].vote,
  'ABSTAIN',
);
const cachedTooOldForVote = await fetchPublicBitcoinWhaleData({
  nowMs: nowMs + 21 * 60_000,
  fetcher: async () => new Response('', { status: 503 }),
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(cachedTooOldForVote.status, 'UNAVAILABLE');
assert.equal(
  evaluateEightMemberCouncil({ whaleFlowData: cachedTooOldForVote, nowMs: nowMs + 21 * 60_000 }).members[5].vote,
  'ABSTAIN',
  'an expired last-successful cache never makes unavailable on-chain evidence vote-eligible',
);

resetPublicBitcoinWhaleDataCacheForTests();
const missingKey = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: successfulFetcher,
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(missingKey.status, 'LIVE', 'the public source does not depend on Whale Alert credentials');

resetPublicBitcoinWhaleDataCacheForTests();
resetWhaleAlertFlowCacheForTests();
const previousWhaleAlertKey = process.env.WHALE_ALERT_API_KEY;
process.env.WHALE_ALERT_API_KEY = '';
const fallbackCalls: string[] = [];
const failedFallback = await fetchOnChainWhaleData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  sleep: async () => {},
  forceRefresh: true,
  fetcher: async (input) => {
    fallbackCalls.push(new URL(String(input)).hostname);
    return new Response('', { status: 503 });
  },
});
assert.equal(failedFallback.status, 'UNAVAILABLE');
assert.equal(fallbackCalls.length, 12, 'all pending-mempool and confirmed-block sources make bounded retries after HTTP 503');
assert.equal(fallbackCalls.filter((hostname) => hostname === 'mempool.space').length, 4);
assert.equal(fallbackCalls.filter((hostname) => hostname === 'blockstream.info').length, 4);
assert.equal(fallbackCalls.filter((hostname) => hostname === 'btcscan.org').length, 4);
if (previousWhaleAlertKey === undefined) delete process.env.WHALE_ALERT_API_KEY;
else process.env.WHALE_ALERT_API_KEY = previousWhaleAlertKey;

resetEtherscanWhaleDataCacheForTests();
const originalEthEnv = {
  apiKey: process.env.ETHERSCAN_API_KEY,
  addresses: process.env.SBK1_ETHERSCAN_WATCH_ADDRESSES,
  minimum: process.env.SBK1_WHALE_MIN_ETH,
  tokenThresholds: process.env.SBK1_WHALE_ERC20_THRESHOLDS,
};
process.env.ETHERSCAN_API_KEY = 'test-key';
process.env.SBK1_ETHERSCAN_WATCH_ADDRESSES = `0x${'a'.repeat(40)}`;
process.env.SBK1_WHALE_MIN_ETH = '100';
process.env.SBK1_WHALE_ERC20_THRESHOLDS = '{}';
const staleEth = await fetchOnChainWhaleData({
  pair: 'ETH/USDT:USDT',
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get('action') === 'eth_blockNumber') {
      return Response.json({ status: '1', message: 'OK', result: '0x1388' });
    }
    if (url.searchParams.get('action') === 'txlist') {
      return Response.json({
        status: '1',
        message: 'OK',
        result: [{
          hash: `0x${'c'.repeat(64)}`,
          timeStamp: String(Math.floor((nowMs - 6 * 60_000) / 1_000)),
          blockNumber: '4000',
          value: String(100n * 10n ** 18n),
          isError: '0',
        }],
      });
    }
    assert.equal(url.searchParams.get('action'), 'tokentx');
    return Response.json({ status: '1', message: 'OK', result: [] });
  },
});
assert.equal(staleEth.status, 'STALE');
assert.equal(
  evaluateEightMemberCouncil({ pair: 'ETH/USDT:USDT', whaleFlowData: staleEth, nowMs }).members[5].vote,
  'ABSTAIN',
  'Etherscan evidence older than the five-minute vote freshness limit must abstain',
);
if (originalEthEnv.apiKey === undefined) delete process.env.ETHERSCAN_API_KEY;
else process.env.ETHERSCAN_API_KEY = originalEthEnv.apiKey;
if (originalEthEnv.addresses === undefined) delete process.env.SBK1_ETHERSCAN_WATCH_ADDRESSES;
else process.env.SBK1_ETHERSCAN_WATCH_ADDRESSES = originalEthEnv.addresses;
if (originalEthEnv.minimum === undefined) delete process.env.SBK1_WHALE_MIN_ETH;
else process.env.SBK1_WHALE_MIN_ETH = originalEthEnv.minimum;
if (originalEthEnv.tokenThresholds === undefined) delete process.env.SBK1_WHALE_ERC20_THRESHOLDS;
else process.env.SBK1_WHALE_ERC20_THRESHOLDS = originalEthEnv.tokenThresholds;
resetEtherscanWhaleDataCacheForTests();

resetPublicBitcoinWhaleDataCacheForTests();
console.log('Public Bitcoin/Ethereum on-chain validation, threshold, deduplication, freshness, retry, and council tests passed.');
