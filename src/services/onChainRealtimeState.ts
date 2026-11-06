import type { CouncilWhaleFlowData, CouncilWhaleTransfer } from './eightMemberCouncil';
import type { OnChainAsset } from './onChainFeedRegistry';
import {
  findVerifiedOnChainWalletLabel,
  loadVerifiedOnChainWalletLabels,
  type VerifiedOnChainWalletLabel,
} from './onChainWalletLabels';
import {
  discoverOnChainWalletCandidates,
  getOnChainWalletCandidateCount,
  getOnChainWalletCandidates,
} from './onChainWalletDiscovery';
import type { OnChainProtocolSwap } from './onChainProtocolFlow';
import { ONCHAIN_BEHAVIOR_WINDOW_MS } from './onChainProtocolFlow';

const WINDOW_MS = 15 * 60_000;
const MAX_TRANSFERS_PER_ASSET = 2_000;
const MAX_PROTOCOL_SWAPS_PER_ASSET = 2_000;
const LABEL_CACHE_TTL_MS = 60_000;

interface ProcessedTransfer {
  id: string;
  transfer: CouncilWhaleTransfer;
  direction: 'INFLOW' | 'OUTFLOW' | null;
  exchange: string | null;
  walletRole: VerifiedOnChainWalletLabel['walletRole'] | null;
  observedAtMs: number;
}

export interface OnChainRealtimeWindow {
  asset: OnChainAsset;
  windowStartMs: number;
  observedAtMs: number;
  transferCount: number;
  confirmedQuorumTransferCount: number;
  unconfirmedTransferCount: number;
  confirmedVolumeNative: number;
  inflowNative: number;
  outflowNative: number;
  sentimentScore: number | null;
  independentProviderCount: number;
  sourceIds: readonly string[];
  walletClusters: readonly {
    exchange: string;
    walletRole: VerifiedOnChainWalletLabel['walletRole'];
    transferCount: number;
  }[];
  topology: {
    activeCandidateWalletCount: number;
    possibleAccumulatorCount: number;
    repeatedLargeSenderCount: number;
    repeatedLargeReceiverCount: number;
  };
  candidateFlowPressure: {
    status: 'DIAGNOSTIC' | 'NO_QUALIFYING_ACTIVITY';
    scorePct: number | null;
    accumulationNative: number;
    distributionNative: number;
    qualifyingTransferCount: number;
    distinctCandidateWalletCount: number;
    independentProviderCount: number;
  };
  protocolSwapCount: number;
  protocolLongVolumeNative: number;
  protocolShortVolumeNative: number;
}

const transfersByAsset = new Map<OnChainAsset, Map<string, ProcessedTransfer>>();
const protocolSwapsByAsset = new Map<OnChainAsset, Map<string, OnChainProtocolSwap>>();
const latestWindowByAsset = new Map<OnChainAsset, OnChainRealtimeWindow>();
let cachedLabels: {
  labels: readonly VerifiedOnChainWalletLabel[];
  expiresAtMs: number;
} | null = null;
let labelsLoad: Promise<readonly VerifiedOnChainWalletLabel[]> | null = null;

async function getLabels(nowMs: number): Promise<readonly VerifiedOnChainWalletLabel[]> {
  if (cachedLabels && nowMs < cachedLabels.expiresAtMs) return cachedLabels.labels;
  if (labelsLoad) return labelsLoad;
  const load = loadVerifiedOnChainWalletLabels(nowMs).then(({ labels }) => {
    cachedLabels = { labels, expiresAtMs: nowMs + LABEL_CACHE_TTL_MS };
    return labels;
  });
  labelsLoad = load;
  try {
    return await load;
  } finally {
    if (labelsLoad === load) labelsLoad = null;
  }
}

function classifyTransfer(
  transfer: CouncilWhaleTransfer,
  asset: OnChainAsset,
  labels: readonly VerifiedOnChainWalletLabel[],
): Pick<ProcessedTransfer, 'direction' | 'exchange' | 'walletRole'> {
  const sourceLabels = (transfer.fromAddresses ?? (transfer.fromAddress ? [transfer.fromAddress] : []))
    .map((address) => findVerifiedOnChainWalletLabel(labels, asset, address))
    .filter((label): label is VerifiedOnChainWalletLabel => label !== null);
  const sourceExchanges = new Set(sourceLabels.map(({ exchange }) => exchange.toLowerCase()));
  const destinationLabel = findVerifiedOnChainWalletLabel(labels, asset, transfer.toAddress);
  if (sourceExchanges.size > 1 ||
      (sourceLabels.length > 0 && destinationLabel &&
        sourceLabels[0].exchange.toLowerCase() !== destinationLabel.exchange.toLowerCase()) ||
      (sourceLabels.length > 0 && destinationLabel)) {
    return { direction: null, exchange: null, walletRole: null };
  }
  if (destinationLabel) {
    return {
      direction: 'INFLOW',
      exchange: destinationLabel.exchange,
      walletRole: destinationLabel.walletRole,
    };
  }
  if (sourceLabels.length > 0) {
    return {
      direction: 'OUTFLOW',
      exchange: sourceLabels[0].exchange,
      walletRole: sourceLabels[0].walletRole,
    };
  }
  return { direction: null, exchange: null, walletRole: null };
}

function buildWindow(
  asset: OnChainAsset,
  nowMs: number,
  transfers: Map<string, ProcessedTransfer>,
  independentProviderCount: number,
  sourceIds: readonly string[],
  protocolSwaps: readonly OnChainProtocolSwap[],
  candidates: ReturnType<typeof getOnChainWalletCandidates>,
): OnChainRealtimeWindow {
  const recent = [...transfers.values()].filter((item) =>
    item.observedAtMs >= nowMs - WINDOW_MS && item.observedAtMs <= nowMs
  );
  const trustedSources = new Set(sourceIds);
  const confirmed = recent.filter(({ transfer, direction, exchange }) =>
    independentProviderCount >= 2 &&
    transfer.confirmationStatus === 'CONFIRMED' &&
    (transfer.providerConfirmations ?? 0) >= 2 &&
    new Set(transfer.confirmingSourceIds ?? []).size >= 2 &&
    (transfer.confirmingSourceIds ?? []).every((sourceId) => trustedSources.has(sourceId)) &&
    direction !== null && exchange !== null
  );
  const inflowNative = confirmed
    .filter(({ direction }) => direction === 'INFLOW')
    .reduce((sum, { transfer }) => sum + transfer.amount, 0);
  const outflowNative = confirmed
    .filter(({ direction }) => direction === 'OUTFLOW')
    .reduce((sum, { transfer }) => sum + transfer.amount, 0);
  const totalAttributedVolume = inflowNative + outflowNative;
  const activeCandidates = candidates.filter((candidate) =>
    candidate.lastSeenAtMs >= nowMs - WINDOW_MS && candidate.lastSeenAtMs <= nowMs
  );
  const candidateAddresses = new Set(candidates
    .filter((candidate) => candidate.firstSeenAtMs <= nowMs - WINDOW_MS)
    .map((candidate) => candidate.address.toLowerCase()));
  const flowSources = new Set(sourceIds);
  let accumulationNative = 0;
  let distributionNative = 0;
  let qualifyingTransferCount = 0;
  const involvedCandidates = new Set<string>();
  for (const { transfer } of recent) {
    if (
      independentProviderCount < 2 ||
      transfer.confirmationStatus !== 'CONFIRMED' ||
      (transfer.providerConfirmations ?? 0) < 2 ||
      new Set(transfer.confirmingSourceIds ?? []).size < 2 ||
      !(transfer.confirmingSourceIds ?? []).every((sourceId) => flowSources.has(sourceId)) ||
      transfer.amount <= 0 ||
      transfer.asset !== asset
    ) continue;
    const sourceCandidates = (transfer.fromAddresses ??
      (transfer.fromAddress ? [transfer.fromAddress] : []))
      .filter((address) => candidateAddresses.has(address.toLowerCase()));
    const destinationIsCandidate = transfer.toAddress !== undefined &&
      candidateAddresses.has(transfer.toAddress.toLowerCase());
    if ((sourceCandidates.length > 0) === destinationIsCandidate) continue;
    if (sourceCandidates.length > 0) {
      distributionNative += transfer.amount;
      sourceCandidates.forEach((address) => involvedCandidates.add(address.toLowerCase()));
    } else if (transfer.toAddress) {
      accumulationNative += transfer.amount;
      involvedCandidates.add(transfer.toAddress.toLowerCase());
    }
    qualifyingTransferCount += 1;
  }
  const candidateFlowVolume = accumulationNative + distributionNative;
  const recentSwaps = protocolSwaps.filter((swap) =>
    swap.timestampMs >= nowMs - ONCHAIN_BEHAVIOR_WINDOW_MS &&
    swap.timestampMs <= nowMs
  );
  const clusterCounts = new Map<string, {
    exchange: string;
    walletRole: VerifiedOnChainWalletLabel['walletRole'];
    transferCount: number;
  }>();
  for (const { exchange, walletRole } of confirmed) {
    if (!exchange || !walletRole) continue;
    const key = `${exchange.toLowerCase()}:${walletRole}`;
    const current = clusterCounts.get(key);
    if (current) current.transferCount += 1;
    else clusterCounts.set(key, { exchange, walletRole, transferCount: 1 });
  }
  return {
    asset,
    windowStartMs: nowMs - WINDOW_MS,
    observedAtMs: nowMs,
    transferCount: recent.length,
    confirmedQuorumTransferCount: confirmed.length,
    unconfirmedTransferCount: recent.filter(({ transfer }) =>
      transfer.confirmationStatus === 'UNCONFIRMED'
    ).length,
    confirmedVolumeNative: totalAttributedVolume,
    inflowNative,
    outflowNative,
    sentimentScore: totalAttributedVolume > 0
      ? (outflowNative - inflowNative) / totalAttributedVolume
      : null,
    independentProviderCount,
    sourceIds,
    walletClusters: [...clusterCounts.values()],
    topology: {
      activeCandidateWalletCount: activeCandidates.length,
      possibleAccumulatorCount: activeCandidates.filter(({ heuristicTags }) =>
        heuristicTags.includes('POSSIBLE_ACCUMULATOR')
      ).length,
      repeatedLargeSenderCount: activeCandidates.filter(({ heuristicTags }) =>
        heuristicTags.includes('REPEATED_LARGE_SENDER')
      ).length,
      repeatedLargeReceiverCount: activeCandidates.filter(({ heuristicTags }) =>
        heuristicTags.includes('REPEATED_LARGE_RECEIVER')
      ).length,
    },
    candidateFlowPressure: {
      status: candidateFlowVolume > 0 ? 'DIAGNOSTIC' : 'NO_QUALIFYING_ACTIVITY',
      scorePct: candidateFlowVolume > 0
        ? Math.round(((accumulationNative - distributionNative) / candidateFlowVolume) * 100)
        : null,
      accumulationNative,
      distributionNative,
      qualifyingTransferCount,
      distinctCandidateWalletCount: involvedCandidates.size,
      independentProviderCount: candidateFlowVolume > 0 ? independentProviderCount : 0,
    },
    protocolSwapCount: recentSwaps.length,
    protocolLongVolumeNative: recentSwaps
      .filter(({ direction }) => direction === 'LONG')
      .reduce((sum, { amountNative }) => sum + amountNative, 0),
    protocolShortVolumeNative: recentSwaps
      .filter(({ direction }) => direction === 'SHORT')
      .reduce((sum, { amountNative }) => sum + amountNative, 0),
  };
}

export async function recordOnChainRealtimeFlow(
  flow: CouncilWhaleFlowData,
  nowMs = Date.now(),
): Promise<CouncilWhaleFlowData> {
  const asset = flow.asset;
  if (asset !== 'BTC' && asset !== 'ETH' && asset !== 'SOL' && asset !== 'BNB' && asset !== 'XRP') {
    return flow;
  }
  await discoverOnChainWalletCandidates(flow, nowMs);
  let protocolSwaps = protocolSwapsByAsset.get(asset);
  if (!protocolSwaps) {
    protocolSwaps = new Map();
    protocolSwapsByAsset.set(asset, protocolSwaps);
  }
  if (flow.status === 'LIVE' &&
      flow.timestampMs !== null &&
      nowMs - flow.timestampMs < 5 * 60_000 &&
      (flow.independentProviderCount ?? 0) >= 2 &&
      new Set(flow.independentSourceIds ?? []).size >= 2) {
    for (const swap of flow.protocolSwaps ?? []) {
      if (swap.asset === asset &&
          swap.timestampMs <= nowMs &&
          nowMs - swap.timestampMs <= ONCHAIN_BEHAVIOR_WINDOW_MS &&
          swap.providerConfirmations >= 2 &&
          swap.blockConfirmations >= 12 &&
          new Set(swap.confirmingSourceIds).size >= 2) {
        protocolSwaps.set(swap.evidenceId, { ...swap });
      }
    }
  }
  for (const [id, swap] of protocolSwaps) {
    if (swap.timestampMs < nowMs - ONCHAIN_BEHAVIOR_WINDOW_MS || swap.timestampMs > nowMs) {
      protocolSwaps.delete(id);
    }
  }
  while (protocolSwaps.size > MAX_PROTOCOL_SWAPS_PER_ASSET) {
    const oldestId = [...protocolSwaps.values()]
      .sort((left, right) => left.timestampMs - right.timestampMs)[0]?.evidenceId;
    if (!oldestId) break;
    protocolSwaps.delete(oldestId);
  }
  const labels = await getLabels(nowMs);
  let transfers = transfersByAsset.get(asset);
  if (!transfers) {
    transfers = new Map();
    transfersByAsset.set(asset, transfers);
  }
  const sourceIds = [...new Set(flow.independentSourceIds ?? [])];
  for (const transfer of flow.largeTransfers ?? []) {
    if (!Number.isFinite(transfer.timestampMs) || transfer.timestampMs > nowMs ||
        transfer.timestampMs < nowMs - WINDOW_MS) continue;
    if (flow.status !== 'LIVE' ||
        flow.timestampMs === null ||
        flow.timestampMs > nowMs ||
        nowMs - flow.timestampMs >= WINDOW_MS) continue;
    const id = `${asset}:${transfer.blockchain}:${transfer.transactionHash.toLowerCase()}:${transfer.transferId ?? ''}`;
    const classification = classifyTransfer(transfer, asset, labels);
    const current = transfers.get(id);
    const replaceConfirmed = transfer.confirmationStatus === 'CONFIRMED' &&
      current?.transfer.confirmationStatus !== 'CONFIRMED';
    const replaceWithMoreQuorum = transfer.confirmationStatus === current?.transfer.confirmationStatus &&
      (transfer.providerConfirmations ?? 0) > (current?.transfer.providerConfirmations ?? 0);
    transfers.set(id, {
      id,
      transfer: current && !replaceConfirmed && !replaceWithMoreQuorum
        ? { ...current.transfer, estimatedUsd: transfer.estimatedUsd }
        : { ...transfer },
      ...(current && !replaceConfirmed && !replaceWithMoreQuorum
        ? {
            direction: current.direction,
            exchange: current.exchange,
            walletRole: current.walletRole,
          }
        : classification),
      observedAtMs: transfer.confirmationStatus === 'UNCONFIRMED'
        ? nowMs
        : replaceConfirmed
          ? transfer.timestampMs
          : current?.observedAtMs ?? transfer.timestampMs,
    });
  }
  for (const [id, item] of transfers) {
    if (item.observedAtMs < nowMs - WINDOW_MS) transfers.delete(id);
  }
  while (transfers.size > MAX_TRANSFERS_PER_ASSET) {
    const oldestId = [...transfers.values()]
      .sort((left, right) => left.observedAtMs - right.observedAtMs)[0]?.id;
    if (!oldestId) break;
    transfers.delete(oldestId);
  }
  const window = buildWindow(
    asset,
    nowMs,
    transfers,
    flow.independentProviderCount ?? 0,
    sourceIds,
    [...protocolSwaps.values()],
    getOnChainWalletCandidates({ asset, nowMs, limit: 10_000 }),
  );
  latestWindowByAsset.set(asset, window);
  return {
    ...flow,
    networkMetrics: {
      ...flow.networkMetrics,
      realtimeWindowMs: WINDOW_MS,
      realtimeWindowTransferCount: window.transferCount,
      realtimeConfirmedQuorumTransferCount: window.confirmedQuorumTransferCount,
      realtimeUnconfirmedTransferCount: window.unconfirmedTransferCount,
      realtimeConfirmedVolumeNative: window.confirmedVolumeNative,
      realtimeSentimentScore: window.sentimentScore,
      realtimeVerifiedWalletClusterCount: window.walletClusters.length,
      realtimeVerifiedWalletClusterTags: window.walletClusters.length > 0
        ? window.walletClusters
          .map(({ exchange, walletRole }) => `${exchange}:${walletRole}`)
          .join(',')
        : null,
      realtimeWalletCandidateCount: getOnChainWalletCandidateCount(asset, nowMs),
      realtimeWindowObservedAtMs: window.observedAtMs,
      realtimeTopologyActiveCandidateWalletCount: window.topology.activeCandidateWalletCount,
      realtimeTopologyPossibleAccumulatorCount: window.topology.possibleAccumulatorCount,
      realtimeTopologyRepeatedLargeSenderCount: window.topology.repeatedLargeSenderCount,
      realtimeTopologyRepeatedLargeReceiverCount: window.topology.repeatedLargeReceiverCount,
      realtimeCandidateFlowPressureScorePct: window.candidateFlowPressure.scorePct,
      realtimeCandidateFlowPressureStatus: window.candidateFlowPressure.status,
      realtimeCandidateFlowAccumulationNative: window.candidateFlowPressure.accumulationNative,
      realtimeCandidateFlowDistributionNative: window.candidateFlowPressure.distributionNative,
      realtimeCandidateFlowTransferCount: window.candidateFlowPressure.qualifyingTransferCount,
      realtimeCandidateFlowWalletCount: window.candidateFlowPressure.distinctCandidateWalletCount,
      realtimeProtocolSwapCount: window.protocolSwapCount,
      realtimeProtocolLongVolumeNative: window.protocolLongVolumeNative,
      realtimeProtocolShortVolumeNative: window.protocolShortVolumeNative,
    },
    protocolSwaps: [...protocolSwaps.values()],
  };
}

export function getOnChainRealtimeWindow(
  asset: OnChainAsset,
  nowMs = Date.now(),
): OnChainRealtimeWindow | null {
  const cached = latestWindowByAsset.get(asset);
  if (!cached) return null;
  const transfers = transfersByAsset.get(asset);
  if (!transfers) return cached;
  const recent = new Map([...transfers].filter(([, item]) =>
    item.observedAtMs >= nowMs - WINDOW_MS && item.observedAtMs <= nowMs
  ));
  return buildWindow(
    asset,
    nowMs,
    recent,
    cached.independentProviderCount,
    cached.sourceIds,
    [...(protocolSwapsByAsset.get(asset)?.values() ?? [])],
    getOnChainWalletCandidates({ asset, nowMs, limit: 10_000 }),
  );
}

export function resetOnChainRealtimeStateForTests(): void {
  transfersByAsset.clear();
  protocolSwapsByAsset.clear();
  latestWindowByAsset.clear();
  cachedLabels = null;
  labelsLoad = null;
}
