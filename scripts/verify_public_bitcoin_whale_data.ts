import assert from 'node:assert/strict';
import {
  fetchPublicBitcoinWhaleData,
  fetchOnChainWhaleData,
  resetPublicBitcoinWhaleDataCacheForTests,
} from '../src/services/publicBitcoinWhaleData';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';
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
  if (url.pathname.endsWith('/v1/blocks')) return Response.json(blocks);
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
assert.equal(data.provider.includes('mempool.space'), true);
assert.equal(data.coverageStatus, 'SAMPLED');
assert.equal(data.largeTransfers?.length, 1, 'duplicate tx outputs across sampled blocks are deduplicated');
assert.equal(data.largeTransfers?.[0].amount, 12);
assert.equal(data.largeTransfers?.[0].estimatedUsd, 720_000);
assert.equal(data.largeTransfers?.[0].confirmationStatus, 'CONFIRMED');
assert.equal(data.largeTransfers?.[0].blockHeight, 900_003);
assert.equal(data.largeTransfers?.[0].transferId, 'vout:0');
assert.equal(requests.length, 4);

const report = evaluateEightMemberCouncil({ whaleFlowData: data, nowMs });
assert.equal(report.members.length, 8);
assert.equal(report.quorumRequired, 5);
assert.equal(report.members[5].vote, 'NEUTRAL');
assert.equal(report.members.filter((member) => member.id === 6).length, 1);
assert.match(report.members[5].rationaleFa, /به‌تنهایی هویت مالک/);

const staleForCouncil = {
  ...data,
  timestampMs: nowMs - 6 * 60_000,
  ageMs: 6 * 60_000,
};
assert.equal(
  evaluateEightMemberCouncil({ whaleFlowData: staleForCouncil, nowMs }).members[5].vote,
  'ABSTAIN',
  'the on-chain member abstains when sampled block evidence exceeds five minutes',
);

resetPublicBitcoinWhaleDataCacheForTests();
let activeBlockRequests = 0;
let maximumConcurrentBlockRequests = 0;
const concurrentBlockFetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/v1/blocks')) return Response.json(blocks);
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
  'NEUTRAL',
  'fresh sampled blocks without large transfers produce a conservative neutral vote',
);
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
assert.equal(retryDelays[0], 1_000, 'Retry-After seconds are respected');

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
assert.equal(timeoutAttempts, 3, 'timeouts receive bounded exponential retries');

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
const stale = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: async (input) => new URL(String(input)).pathname.endsWith('/v1/blocks')
    ? Response.json(blocks.map((block) => ({ ...block, timestamp: Math.floor((nowMs - 21 * 60_000) / 1_000) })))
    : Response.json([]),
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(stale.status, 'STALE');
assert.match(stale.unavailableReason ?? '', /stale/);
assert.equal(
  evaluateEightMemberCouncil({ whaleFlowData: stale, nowMs }).members[5].vote,
  'ABSTAIN',
);

resetPublicBitcoinWhaleDataCacheForTests();
const nearFreshnessBoundary = await fetchPublicBitcoinWhaleData({
  nowMs,
  fetcher: async (input) => new URL(String(input)).pathname.endsWith('/v1/blocks')
    ? Response.json(blocks.map((block) => ({
        ...block,
        timestamp: Math.floor((nowMs - 299_000) / 1_000),
      })))
    : Response.json([]),
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(nearFreshnessBoundary.status, 'LIVE');
const cacheCrossingFreshnessBoundary = await fetchPublicBitcoinWhaleData({
  nowMs: nowMs + 2_000,
  fetcher: async () => {
    throw new Error('The still-valid request cache should prevent a new fetch.');
  },
  sleep: async () => {},
});
assert.equal(
  cacheCrossingFreshnessBoundary.status,
  'STALE',
  'a cached response becomes stale as soon as its source timestamp crosses five minutes',
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
assert.match(cachedOnProviderError.unavailableReason ?? '', /using the last successful sample/);
assert.equal(
  evaluateEightMemberCouncil({ whaleFlowData: cachedOnProviderError, nowMs: nowMs + 2 * 60_000 }).members[5].vote,
  'NEUTRAL',
);
const cachedTooOldForVote = await fetchPublicBitcoinWhaleData({
  nowMs: nowMs + 6 * 60_000,
  fetcher: async () => new Response('', { status: 503 }),
  sleep: async () => {},
  forceRefresh: true,
});
assert.equal(cachedTooOldForVote.status, 'STALE');
assert.equal(
  evaluateEightMemberCouncil({ whaleFlowData: cachedTooOldForVote, nowMs: nowMs + 6 * 60_000 }).members[5].vote,
  'ABSTAIN',
  'the retained cache never makes on-chain evidence older than five minutes vote-eligible',
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
  nowMs,
  sleep: async () => {},
  forceRefresh: true,
  fetcher: async (input) => {
    fallbackCalls.push(new URL(String(input)).hostname);
    return new Response('', { status: 503 });
  },
});
assert.equal(failedFallback.status, 'UNAVAILABLE');
assert.equal(fallbackCalls.length, 3, 'the public source makes bounded retries after HTTP 503');
assert.equal(fallbackCalls.every((hostname) => hostname === 'mempool.space'), true,
  'Whale Alert remains untouched when its optional API key is absent');
if (previousWhaleAlertKey === undefined) delete process.env.WHALE_ALERT_API_KEY;
else process.env.WHALE_ALERT_API_KEY = previousWhaleAlertKey;

resetPublicBitcoinWhaleDataCacheForTests();
console.log('Public Bitcoin sampled-output validation, threshold, deduplication, freshness, retry, and council tests passed.');
