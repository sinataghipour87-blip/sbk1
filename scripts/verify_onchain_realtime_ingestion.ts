import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CouncilWhaleFlowData, CouncilWhaleTransfer } from '../src/services/eightMemberCouncil';

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-onchain-ingestion-'));
const previousLabelPath = process.env.SBK1_ONCHAIN_WALLET_LABELS_FILE;
const previousCandidatePath = process.env.SBK1_ONCHAIN_WALLET_CANDIDATES_FILE;
const labelsPath = path.join(temporaryDirectory, 'wallet-labels.json');
const candidatesPath = path.join(temporaryDirectory, 'wallet-candidates.json');
const nowMs = Date.now();
const exchangeAddress = `bc1q${'a'.repeat(38)}`;
const externalAddress = `bc1q${'b'.repeat(38)}`;
let resetRealtimeState = (): void => {};
let resetWalletDiscovery = (): void => {};

try {
  await writeFile(labelsPath, JSON.stringify({
    schemaVersion: 1,
    labels: [{
      asset: 'BTC',
      address: exchangeAddress,
      exchange: 'Verified Test Exchange',
      walletRole: 'hot',
      labelStatus: 'verified',
      sourceUrl: 'https://example.com/verified-wallet',
      verifiedAt: new Date(nowMs - 60_000).toISOString(),
      reviewBy: new Date(nowMs + 24 * 60 * 60_000).toISOString(),
    }],
  }));
  process.env.SBK1_ONCHAIN_WALLET_LABELS_FILE = labelsPath;
  process.env.SBK1_ONCHAIN_WALLET_CANDIDATES_FILE = candidatesPath;
  const { getOnChainRealtimeWindow, recordOnChainRealtimeFlow, resetOnChainRealtimeStateForTests } =
    await import('../src/services/onChainRealtimeState');
  const {
    discoverOnChainWalletCandidates,
    flushOnChainWalletCandidates,
    getOnChainWalletCandidates,
    ONCHAIN_WALLET_CANDIDATE_CAPACITY_PER_ASSET,
    resetOnChainWalletDiscoveryForTests,
  } = await import('../src/services/onChainWalletDiscovery');
  resetRealtimeState = resetOnChainRealtimeStateForTests;
  resetWalletDiscovery = resetOnChainWalletDiscoveryForTests;

  const sourceIds = ['onchain.mempool-blocks', 'onchain.blockstream-blocks'];
  const confirmedInflow: CouncilWhaleTransfer = {
    transactionHash: 'a'.repeat(64),
    blockchain: 'bitcoin',
    blockHeight: 900_001,
    timestampMs: nowMs - 10_000,
    sourceProvider: 'Independent public BTC feeds',
    asset: 'BTC',
    amount: 12,
    estimatedUsd: null,
    confirmationStatus: 'CONFIRMED',
    transferId: 'vout:0',
    fromAddress: externalAddress,
    toAddress: exchangeAddress,
    providerConfirmations: 2,
    confirmingSourceIds: sourceIds,
  };
  const pendingWhale: CouncilWhaleTransfer = {
    ...confirmedInflow,
    transactionHash: 'b'.repeat(64),
    blockHeight: null,
    timestampMs: nowMs,
    amount: 20,
    confirmationStatus: 'UNCONFIRMED',
  };
  const flow: CouncilWhaleFlowData = {
    pair: 'BTC/USDT:USDT',
    asset: 'BTC',
    status: 'LIVE',
    provider: 'Independent public BTC feeds',
    timestampMs: nowMs - 10_000,
    retrievedAtMs: nowMs,
    ageMs: 10_000,
    qualityPct: 90,
    independentProviderCount: 2,
    independentSourceIds: sourceIds,
    largeTransfers: [confirmedInflow, pendingWhale],
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 2,
    windowStartHeight: 900_001,
    windowEndHeight: 900_001,
  };

  const enriched = await recordOnChainRealtimeFlow(flow, nowMs);
  assert.equal(enriched.networkMetrics?.realtimeWindowMs, 15 * 60_000);
  assert.equal(enriched.networkMetrics?.realtimeWindowTransferCount, 2);
  assert.equal(enriched.networkMetrics?.realtimeConfirmedQuorumTransferCount, 1);
  assert.equal(enriched.networkMetrics?.realtimeUnconfirmedTransferCount, 1);
  assert.equal(enriched.networkMetrics?.realtimeSentimentScore, -1,
    'sentiment is computed from verified, confirmed exchange flow only');
  assert.equal(enriched.networkMetrics?.realtimeVerifiedWalletClusterCount, 1);
  assert.equal(enriched.networkMetrics?.realtimeVerifiedWalletClusterTags, 'Verified Test Exchange:hot');

  await recordOnChainRealtimeFlow(flow, nowMs + 30_000);
  const deduplicated = getOnChainRealtimeWindow('BTC', nowMs + 30_000);
  assert.equal(deduplicated?.transferCount, 2,
    'repeated polling updates the same transaction entries instead of inflating the window');
  assert.equal(deduplicated?.walletClusters[0]?.exchange, 'Verified Test Exchange');

  const expired = getOnChainRealtimeWindow('BTC', nowMs + 16 * 60_000);
  assert.equal(expired?.confirmedQuorumTransferCount, 0,
    'confirmed events expire when they leave the 15-minute window');
  assert.equal(expired?.unconfirmedTransferCount, 0,
    'pending observations expire from the in-memory window');
  assert.equal(expired?.sentimentScore, null,
    'sentiment is unavailable when no verified events remain');

  resetRealtimeState();
  const oneSource = await recordOnChainRealtimeFlow({
    ...flow,
    independentProviderCount: 1,
    independentSourceIds: [sourceIds[0]],
  }, nowMs);
  assert.equal(oneSource.networkMetrics?.realtimeConfirmedQuorumTransferCount, 0,
    'one independent provider cannot contribute to the real-time score');
  assert.equal(oneSource.networkMetrics?.realtimeSentimentScore, null);

  assert.equal(ONCHAIN_WALLET_CANDIDATE_CAPACITY_PER_ASSET, 10_000);
  resetOnChainWalletDiscoveryForTests();
  await discoverOnChainWalletCandidates({
    ...flow,
    largeTransfers: [pendingWhale],
  }, nowMs);
  assert.equal(getOnChainWalletCandidates({ asset: 'BTC', nowMs }).length, 0,
    'unconfirmed mempool transactions cannot seed wallet candidate tags');
  for (let index = 0; index < 3; index += 1) {
    const sourceAddress = `bc1q${String.fromCharCode(99 + index).repeat(38)}`;
    const candidateTransfer: CouncilWhaleTransfer = {
      ...confirmedInflow,
      transactionHash: String(index + 1).repeat(64),
      fromAddress: sourceAddress,
      amount: 12,
      timestampMs: nowMs,
    };
    await discoverOnChainWalletCandidates({
      ...flow,
      timestampMs: nowMs,
      largeTransfers: [candidateTransfer],
    }, nowMs);
  }
  const accumulatorCandidate = getOnChainWalletCandidates({ asset: 'BTC', nowMs })
    .find(({ address }) => address === exchangeAddress);
  assert.ok(accumulatorCandidate);
  assert.equal(accumulatorCandidate.labelStatus, 'candidate-unverified',
    'heuristic discovery never upgrades a candidate into a vote-authorizing verified label');
  assert.ok(accumulatorCandidate.heuristicTags.includes('REPEATED_LARGE_RECEIVER'));
  assert.ok(accumulatorCandidate.heuristicTags.includes('POSSIBLE_ACCUMULATOR'));
  assert.equal(accumulatorCandidate.counterparties.length, 3);
  assert.equal(accumulatorCandidate.quorumVerifiedTransferCount, 3);
  assert.deepEqual(accumulatorCandidate.lastQuorumSourceIds, sourceIds);
  assert.equal(accumulatorCandidate.sourceOverlapCount, 2,
    'candidate overlap records unique independent sources that confirmed its transfers');
  await flushOnChainWalletCandidates(nowMs);
  const persistedCandidates = JSON.parse(await readFile(candidatesPath, 'utf8')) as {
    candidates: Array<{ labelStatus: string }>;
  };
  assert.ok(persistedCandidates.candidates.length > 0, 'discovered wallet candidates persist between restarts');
  assert.ok(persistedCandidates.candidates.every(({ labelStatus }) => labelStatus === 'candidate-unverified'));
  resetOnChainWalletDiscoveryForTests();
  await discoverOnChainWalletCandidates({ ...flow, status: 'UNAVAILABLE' }, nowMs + 1_000);
  assert.ok(getOnChainWalletCandidates({ asset: 'BTC', nowMs: nowMs + 1_000 })
    .some(({ address }) => address === exchangeAddress), 'persisted candidate state reloads after reset');
  assert.equal(getOnChainWalletCandidates({ asset: 'BTC', nowMs: nowMs + 31 * 24 * 60 * 60_000 }).length, 0,
    'candidate addresses are pruned after their inactivity TTL');
  await flushOnChainWalletCandidates(nowMs + 31 * 24 * 60 * 60_000);

  resetRealtimeState();
  await recordOnChainRealtimeFlow({
    ...flow,
    status: 'UNAVAILABLE',
    independentProviderCount: 2,
  }, nowMs);
  assert.equal(getOnChainRealtimeWindow('BTC', nowMs)?.transferCount, 0,
    'unavailable source data is not ingested into the live sliding window');
} finally {
  resetRealtimeState();
  resetWalletDiscovery();
  if (previousCandidatePath === undefined) delete process.env.SBK1_ONCHAIN_WALLET_CANDIDATES_FILE;
  else process.env.SBK1_ONCHAIN_WALLET_CANDIDATES_FILE = previousCandidatePath;
  if (previousLabelPath === undefined) delete process.env.SBK1_ONCHAIN_WALLET_LABELS_FILE;
  else process.env.SBK1_ONCHAIN_WALLET_LABELS_FILE = previousLabelPath;
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log('Real-time on-chain ingestion sliding-window, deduplication, label attribution, and quorum tests passed.');
