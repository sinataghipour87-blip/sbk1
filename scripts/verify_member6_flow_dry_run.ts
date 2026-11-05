import assert from 'node:assert/strict';
import {
  evaluateEightMemberCouncil,
  type CouncilWhaleFlowData,
  type CouncilWhaleTransfer,
} from '../src/services/eightMemberCouncil';
import {
  evaluateOnChainFlowHeuristicForDryRun,
  type OnChainFlowBaselineEvent,
} from '../src/services/onChainFlowHeuristic';
import type { VerifiedOnChainWalletLabel } from '../src/services/onChainWalletLabels';
import type { OnChainAsset } from '../src/services/onChainFeedRegistry';

const WINDOW_MS = 5 * 60_000;
const nowMs = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS + 2 * 60_000;
const currentBucket = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
const observedBuckets = Array.from({ length: 288 }, (_unused, index) =>
  currentBucket - (index + 1) * WINDOW_MS
);
const exchangeAddress = 'bc1qtestexchangeaddress000000000000000000000000000000';
const externalAddress = 'bc1qtestexternaladdress000000000000000000000000000000';
const sourceIds = ['onchain.mempool-blocks', 'onchain.blockstream-blocks'];
const labels: readonly VerifiedOnChainWalletLabel[] = [{
  asset: 'BTC',
  address: exchangeAddress,
  exchange: 'Dry-run Exchange',
  walletRole: 'deposit',
  labelStatus: 'verified',
  sourceUrl: 'https://example.com/verified-wallet',
  verifiedAt: new Date(nowMs - 24 * 60 * 60_000).toISOString(),
  reviewBy: new Date(nowMs + 24 * 60 * 60_000).toISOString(),
}];

function priorEvents(directions: readonly ('INFLOW' | 'OUTFLOW')[]): OnChainFlowBaselineEvent[] {
  return directions.flatMap((direction) =>
    Array.from({ length: 6 }, (_unused, index) => {
      const bucket = observedBuckets[index * 48 + 5];
      return {
        id: `baseline-${direction}-${index}`,
        asset: 'BTC' as const,
        direction,
        exchange: 'Dry-run Exchange',
        amount: 10,
        timestampMs: bucket + 60_000,
        sourceIds,
      };
    })
  );
}

function transfer(direction: 'INFLOW' | 'OUTFLOW', amount = 12): CouncilWhaleTransfer {
  return {
    transactionHash: direction === 'INFLOW' ? 'a'.repeat(64) : 'b'.repeat(64),
    blockchain: 'bitcoin',
    blockHeight: 900_000,
    timestampMs: nowMs - 10_000,
    sourceProvider: 'Bitcoin public block feeds',
    asset: 'BTC',
    amount,
    estimatedUsd: null,
    confirmationStatus: 'CONFIRMED',
    transferId: 'vout:1',
    fromAddress: direction === 'INFLOW' ? externalAddress : exchangeAddress,
    toAddress: direction === 'INFLOW' ? exchangeAddress : externalAddress,
    providerConfirmations: 2,
    confirmingSourceIds: sourceIds,
  };
}

function flow(transfers: CouncilWhaleTransfer[] = [transfer('INFLOW')]): CouncilWhaleFlowData {
  return {
    pair: 'BTC/USDT:USDT',
    asset: 'BTC',
    status: 'LIVE',
    provider: 'Bitcoin public block feeds',
    sourceId: sourceIds[0],
    fallbackSourceId: sourceIds[1],
    timestampMs: nowMs - 10_000,
    retrievedAtMs: nowMs,
    ageMs: 10_000,
    qualityPct: 90,
    independentProviderCount: 2,
    independentSourceIds: sourceIds,
    coverageStatus: 'SAMPLED',
    largeTransfers: transfers,
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: transfers.length,
    windowStartHeight: 899_998,
    windowEndHeight: 900_000,
  };
}

async function evaluateVote(options: {
  currentFlow?: CouncilWhaleFlowData;
  walletLabels?: readonly VerifiedOnChainWalletLabel[];
  prior?: readonly OnChainFlowBaselineEvent[];
  buckets?: readonly number[];
  sourceChecks?: boolean;
} = {}): Promise<{ vote: string; signalStatus: string; signalDirection: string | null }> {
  const currentFlow = options.currentFlow ?? flow();
  const signal = await evaluateOnChainFlowHeuristicForDryRun({
    flow: currentFlow,
    labels: options.walletLabels ?? labels,
    priorEvents: options.prior ?? priorEvents(['INFLOW']),
    observedBuckets: options.buckets ?? observedBuckets,
    nowMs,
  });
  const vote = evaluateEightMemberCouncil({
    pair: 'BTC/USDT:USDT',
    nowMs,
    requireMemberSourceQuorum: options.sourceChecks,
    memberSourceChecks: options.sourceChecks ? { 6: [] } : undefined,
    whaleFlowData: { ...currentFlow, flowSignal: signal },
  }).members.find(({ id }) => id === 6);
  assert.ok(vote, 'member 6 vote exists');
  return {
    vote: vote.vote,
    signalStatus: signal.status,
    signalDirection: signal.direction,
  };
}

const inflow = await evaluateVote({ sourceChecks: true });
assert.deepEqual(inflow, { vote: 'SHORT', signalStatus: 'CONFIRMED', signalDirection: 'SHORT' });

const outflow = await evaluateVote({
  currentFlow: flow([transfer('OUTFLOW')]),
  prior: priorEvents(['OUTFLOW']),
});
assert.deepEqual(outflow, { vote: 'LONG', signalStatus: 'CONFIRMED', signalDirection: 'LONG' });

const unknownAddress = await evaluateVote({ walletLabels: [] });
assert.deepEqual(unknownAddress, { vote: 'ABSTAIN', signalStatus: 'ABSTAIN', signalDirection: null });

const oneProviderFlow = flow([{
  ...transfer('INFLOW'),
  providerConfirmations: 1,
  confirmingSourceIds: [sourceIds[0]],
}]);
oneProviderFlow.independentProviderCount = 1;
oneProviderFlow.independentSourceIds = [sourceIds[0]];
const oneProvider = await evaluateVote({ currentFlow: oneProviderFlow });
assert.deepEqual(oneProvider, { vote: 'ABSTAIN', signalStatus: 'ABSTAIN', signalDirection: null });

const incompleteBaseline = await evaluateVote({
  buckets: observedBuckets.slice(1),
});
assert.deepEqual(incompleteBaseline, { vote: 'ABSTAIN', signalStatus: 'ABSTAIN', signalDirection: null });

const conflictingDirection = await evaluateVote({
  currentFlow: flow([transfer('INFLOW'), transfer('OUTFLOW')]),
  prior: priorEvents(['INFLOW', 'OUTFLOW']),
});
assert.deepEqual(conflictingDirection, { vote: 'ABSTAIN', signalStatus: 'ABSTAIN', signalDirection: null });

const staleFlow = flow();
staleFlow.status = 'STALE';
staleFlow.timestampMs = nowMs - 6 * 60_000;
staleFlow.ageMs = 6 * 60_000;
const stale = await evaluateVote({ currentFlow: staleFlow });
assert.equal(stale.vote, 'ABSTAIN');

const assetThresholds: ReadonlyArray<{
  asset: OnChainAsset;
  blockchain: string;
  threshold: number;
  sourceIds: readonly [string, string];
  walletAddress: string;
}> = [
  { asset: 'BTC', blockchain: 'bitcoin', threshold: 10, sourceIds: ['onchain.mempool-blocks', 'onchain.blockstream-blocks'], walletAddress: exchangeAddress },
  { asset: 'ETH', blockchain: 'ethereum', threshold: 100, sourceIds: ['onchain.ethereum-public-rpc', 'onchain.monitor.eth.drpc'], walletAddress: `0x${'1'.repeat(40)}` },
  { asset: 'SOL', blockchain: 'solana', threshold: 10, sourceIds: ['onchain.solana-public-rpc', 'onchain.solana-publicnode'], walletAddress: '11111111111111111111111111111111' },
  { asset: 'BNB', blockchain: 'binance_smart_chain', threshold: 5, sourceIds: ['onchain.bsc-public-rpc', 'onchain.bsc-publicnode'], walletAddress: `0x${'2'.repeat(40)}` },
  { asset: 'XRP', blockchain: 'xrp', threshold: 1_000, sourceIds: ['onchain.xrpscan-xrp', 'onchain.ripple-s2-xrp'], walletAddress: `r${'1'.repeat(25)}` },
];

for (const item of assetThresholds) {
  const assetLabel: VerifiedOnChainWalletLabel = {
    ...labels[0],
    asset: item.asset,
    address: item.walletAddress,
  };
  const baseTransfer: CouncilWhaleTransfer = {
    ...transfer('INFLOW'),
    blockchain: item.blockchain,
    asset: item.asset,
    toAddress: item.walletAddress,
    amount: item.threshold,
    confirmingSourceIds: [...item.sourceIds],
  };
  const baseline: OnChainFlowBaselineEvent[] = Array.from({ length: 6 }, (_unused, index) => ({
    id: `${item.asset}-baseline-${index}`,
    asset: item.asset,
    direction: 'INFLOW',
    exchange: 'Dry-run Exchange',
    amount: item.threshold,
    timestampMs: observedBuckets[index * 48 + 5] + 60_000,
    sourceIds: [...item.sourceIds],
  }));
  const assetFlow: CouncilWhaleFlowData = {
    ...flow([baseTransfer]),
    asset: item.asset,
    independentSourceIds: [...item.sourceIds],
  };
  const atFloor = await evaluateOnChainFlowHeuristicForDryRun({
    flow: assetFlow,
    labels: [assetLabel],
    priorEvents: baseline,
    observedBuckets,
    nowMs,
  });
  assert.equal(atFloor.status, 'CONFIRMED', `${item.asset} native threshold is inclusive`);
  assert.equal(atFloor.direction, 'SHORT', `${item.asset} exchange inflow maps to SHORT`);

  const belowFloor = await evaluateOnChainFlowHeuristicForDryRun({
    flow: {
      ...assetFlow,
      largeTransfers: [{ ...baseTransfer, amount: item.threshold - 0.01 }],
    },
    labels: [assetLabel],
    priorEvents: baseline,
    observedBuckets,
    nowMs,
  });
  assert.equal(belowFloor.status, 'ABSTAIN', `${item.asset} transfer below floor is excluded`);
}

console.log('Member 6 flow dry-run scenarios passed: directions, fail-closed cases, freshness, and inclusive native floors for all five assets.');
