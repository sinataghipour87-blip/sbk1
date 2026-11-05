import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CouncilWhaleConsensusCandidate,
  CouncilWhaleFlowData,
  CouncilWhaleQuorumSourceId,
  CouncilWhaleTransfer,
} from './eightMemberCouncil';
import {
  getWhaleSourceOperator,
  QUORUM_ASSETS,
  type QuorumAsset,
} from './whaleConsensusSourceOperators';
export { getWhaleSourceOperator, QUORUM_ASSETS } from './whaleConsensusSourceOperators';
export type { QuorumAsset } from './whaleConsensusSourceOperators';

const REGISTRY_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 5 * 60_000;
const DEFAULT_HISTORICAL_WINDOW_MS = 15 * 24 * 60 * 60_000;
const MAX_HISTORICAL_CANDIDATES_PER_ASSET = 20_000;
const DEFAULT_REGISTRY_PATH = path.resolve(process.cwd(), '.cache/sbk1/quorum-candidates.json');
const BLOCKCHAIN_BY_ASSET: Readonly<Record<QuorumAsset, string>> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binance-smart-chain',
  SOL: 'solana',
  XRP: 'xrpledger',
};

interface QuorumObservation {
  sourceId: CouncilWhaleQuorumSourceId | string;
  evidenceType: 'TRANSFER' | 'ATTRIBUTION';
  blockchain: string;
  transactionHash: string;
  transferId: string;
  direction?: CouncilWhaleConsensusCandidate['direction'];
  amount: number;
  timestampMs: number;
  confirmationStatus: 'CONFIRMED' | 'UNCONFIRMED' | 'UNKNOWN';
  exchangeName?: string;
  exchangeAddress?: string;
}

export interface QuorumCandidateRecord extends CouncilWhaleConsensusCandidate {
  assetSymbol: QuorumAsset;
  amount: number;
  estimatedUsd: number;
  confirmationStatus: 'CONFIRMED';
  observations: QuorumObservation[];
  blockHeight?: number | null;
}

export interface QuorumObservedTransfer {
  assetSymbol: QuorumAsset;
  blockchain: string;
  transactionHash: string;
  transferId: string;
  timestampMs: number;
  amount: number;
  unit: QuorumAsset;
  blockHeight: number;
  sourceIds: string[];
  confirmationStatus: 'CONFIRMED';
  fromAddresses?: string[];
  toAddresses?: string[];
}

export type QuorumCandidateSnapshotInput = Readonly<Record<QuorumAsset, readonly QuorumCandidateRecord[]>>;
export type QuorumObservedTransferInput = Readonly<Record<QuorumAsset, readonly QuorumObservedTransfer[]>>;

interface QuorumCandidateSnapshot {
  version: typeof REGISTRY_VERSION;
  generatedAtMs: number;
  assets: Record<QuorumAsset, QuorumCandidateRecord[]>;
  historicalCandidates: Record<QuorumAsset, QuorumCandidateRecord[]>;
  observedTransfers: Record<QuorumAsset, QuorumObservedTransfer[]>;
}

export interface QuorumCandidateWriteResult {
  path: string;
  persistedByAsset: Record<QuorumAsset, number>;
  rejectedByAsset: Record<QuorumAsset, number>;
  historicalByAsset: Record<QuorumAsset, number>;
}

export function countDistinctWhaleSourceOperators(asset: string, sourceIds: readonly string[]): number {
  return new Set(sourceIds.flatMap((sourceId) => {
    const operator = getWhaleSourceOperator(asset, sourceId);
    return operator ? [operator] : [];
  })).size;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function normalizedAmount(value: unknown): number | null {
  return isFiniteNumber(value) && value > 0 ? value : null;
}

function getObservationAmount(observation: Record<string, unknown>): number | null {
  return normalizedAmount(observation.amount ?? observation.amountBtc);
}

function isValidTransactionHash(asset: QuorumAsset, value: string): boolean {
  switch (asset) {
    case 'BTC':
    case 'XRP':
      return /^[0-9a-f]{64}$/i.test(value);
    case 'ETH':
    case 'BNB':
      return /^0x[0-9a-f]{64}$/i.test(value);
    case 'SOL':
      return /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value);
  }
}

function validateCandidate(
  value: unknown,
  asset: QuorumAsset,
  nowMs: number,
  maxAgeMs: number,
): value is QuorumCandidateRecord {
  if (!isRecord(value) ||
      value.assetSymbol !== asset ||
      value.blockchain !== BLOCKCHAIN_BY_ASSET[asset] ||
      typeof value.transactionHash !== 'string' || !isValidTransactionHash(asset, value.transactionHash) ||
      typeof value.transferId !== 'string' || value.transferId.trim().length === 0 ||
      !isSafeTimestamp(value.timestampMs) || value.timestampMs > nowMs ||
      nowMs - value.timestampMs > maxAgeMs ||
      !['EXCHANGE_INFLOW', 'EXCHANGE_OUTFLOW'].includes(String(value.direction)) ||
      value.confirmationStatus !== 'CONFIRMED' ||
      normalizedAmount(value.amount) === null ||
      !isFiniteNumber(value.estimatedUsd) || value.estimatedUsd <= 0 ||
      !Array.isArray(value.observations)) {
    return false;
  }

  const operators = new Set<string>();
  const transferOperators = new Set<string>();
  let hasMatchingAttribution = false;
  const amount = value.amount as number;
  const normalizeIdentifier = (identifier: string) =>
    asset === 'SOL' ? identifier : identifier.toLowerCase();
  for (const rawObservation of value.observations) {
    if (!isRecord(rawObservation) ||
        typeof rawObservation.sourceId !== 'string' ||
        typeof rawObservation.blockchain !== 'string' ||
        rawObservation.blockchain.toLowerCase() !== (value.blockchain as string).toLowerCase() ||
        typeof rawObservation.transactionHash !== 'string' ||
        normalizeIdentifier(rawObservation.transactionHash) !== normalizeIdentifier(value.transactionHash as string) ||
        typeof rawObservation.transferId !== 'string' ||
        normalizeIdentifier(rawObservation.transferId) !== normalizeIdentifier(value.transferId as string) ||
        !['TRANSFER', 'ATTRIBUTION'].includes(String(rawObservation.evidenceType)) ||
        rawObservation.confirmationStatus !== 'CONFIRMED' ||
        !isSafeTimestamp(rawObservation.timestampMs) ||
        rawObservation.timestampMs > nowMs ||
        nowMs - rawObservation.timestampMs > maxAgeMs) continue;
    const operator = getWhaleSourceOperator(asset, rawObservation.sourceId);
    if (!operator) continue;
    const observationAmount = getObservationAmount(rawObservation);
    if (
      observationAmount === null ||
      Math.abs(observationAmount - amount) > Math.max(1e-8, amount * 1e-8)
    ) return false;
    if (rawObservation.evidenceType === 'TRANSFER') {
      if (rawObservation.direction !== undefined) return false;
      transferOperators.add(operator);
    } else if (rawObservation.direction === value.direction) {
      hasMatchingAttribution = true;
    } else {
      return false;
    }
    operators.add(operator);
  }
  return operators.size >= 2 && transferOperators.size >= 2 && hasMatchingAttribution;
}

function emptyAssets(): Record<QuorumAsset, QuorumCandidateRecord[]> {
  return { BTC: [], ETH: [], BNB: [], SOL: [], XRP: [] };
}

function emptyObservedTransfers(): Record<QuorumAsset, QuorumObservedTransfer[]> {
  return { BTC: [], ETH: [], BNB: [], SOL: [], XRP: [] };
}

function isValidObservedTransfer(
  value: unknown,
  asset: QuorumAsset,
  nowMs: number,
  maxAgeMs: number,
): value is QuorumObservedTransfer {
  if (!isRecord(value) ||
      value.assetSymbol !== asset ||
      value.blockchain !== BLOCKCHAIN_BY_ASSET[asset] ||
      typeof value.transactionHash !== 'string' ||
      !isValidTransactionHash(asset, value.transactionHash) ||
      typeof value.transferId !== 'string' || value.transferId.trim().length === 0 ||
      !isSafeTimestamp(value.timestampMs) || value.timestampMs > nowMs ||
      nowMs - value.timestampMs > maxAgeMs ||
      !isFiniteNumber(value.amount) || value.amount <= 0 ||
      value.unit !== asset ||
      !Number.isSafeInteger(value.blockHeight) || (value.blockHeight as number) <= 0 ||
      value.confirmationStatus !== 'CONFIRMED' ||
      !Array.isArray(value.sourceIds) ||
      (value.fromAddresses !== undefined && (!Array.isArray(value.fromAddresses) ||
        !value.fromAddresses.every((address) => typeof address === 'string' && address.length > 0))) ||
      (value.toAddresses !== undefined && (!Array.isArray(value.toAddresses) ||
        !value.toAddresses.every((address) => typeof address === 'string' && address.length > 0)))) return false;
  const operators = new Set(value.sourceIds.flatMap((sourceId) => {
    if (typeof sourceId !== 'string') return [];
    const operator = getWhaleSourceOperator(asset, sourceId);
    return operator ? [operator] : [];
  }));
  return operators.size >= 2;
}

function observedTransferKey(transfer: QuorumObservedTransfer): string {
  const hash = transfer.assetSymbol === 'SOL'
    ? transfer.transactionHash
    : transfer.transactionHash.toLowerCase();
  const transferId = transfer.assetSymbol === 'SOL'
    ? transfer.transferId
    : transfer.transferId.toLowerCase();
  return `${transfer.assetSymbol}:${hash}:${transferId}`;
}

function candidateKey(candidate: QuorumCandidateRecord): string {
  const hash = candidate.assetSymbol === 'SOL'
    ? candidate.transactionHash
    : candidate.transactionHash.toLowerCase();
  const transferId = candidate.assetSymbol === 'SOL'
    ? candidate.transferId
    : candidate.transferId.toLowerCase();
  return `${candidate.assetSymbol}:${hash}:${transferId}`;
}

function unavailable(asset: QuorumAsset, reason: string): CouncilWhaleFlowData {
  return {
    status: 'UNAVAILABLE',
    provider: 'Local quorum candidate registry',
    assetSymbol: asset,
    timestampMs: null,
    retrievedAtMs: null,
    ageMs: null,
    qualityPct: 0,
    coverageStatus: 'UNAVAILABLE',
    unavailableReason: reason,
    largeTransfers: [],
    consensusMatrix: { candidates: [] },
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 0,
    windowStartHeight: null,
    windowEndHeight: null,
  };
}

function snapshotFrom(value: unknown): QuorumCandidateSnapshot {
  if (!isRecord(value) ||
      value.version !== REGISTRY_VERSION ||
      !isSafeTimestamp(value.generatedAtMs) ||
      !isRecord(value.assets)) {
    throw new Error('Quorum candidate registry has an unsupported or malformed snapshot.');
  }
  const assets = emptyAssets();
  const historicalCandidates = isRecord(value.historicalCandidates)
    ? value.historicalCandidates
    : emptyAssets();
  const observedTransfers = isRecord(value.observedTransfers)
    ? value.observedTransfers
    : emptyObservedTransfers();
  for (const asset of QUORUM_ASSETS) {
    const candidates = value.assets[asset];
    const history = historicalCandidates[asset];
    const observations = observedTransfers[asset];
    if (!Array.isArray(candidates) || !Array.isArray(history) || !Array.isArray(observations)) {
      throw new Error(`Quorum candidate registry is missing the ${asset} candidate list.`);
    }
    assets[asset] = candidates as QuorumCandidateRecord[];
    historicalCandidates[asset] = history as QuorumCandidateRecord[];
    observedTransfers[asset] = observations as QuorumObservedTransfer[];
  }
  return {
    version: REGISTRY_VERSION,
    generatedAtMs: value.generatedAtMs,
    assets,
    historicalCandidates: historicalCandidates as Record<QuorumAsset, QuorumCandidateRecord[]>,
    observedTransfers: observedTransfers as Record<QuorumAsset, QuorumObservedTransfer[]>,
  };
}

export async function writeQuorumCandidateSnapshot(
  candidatesByAsset: QuorumCandidateSnapshotInput,
  options: {
    nowMs?: number;
    filePath?: string;
    maxAgeMs?: number;
    historicalCandidatesByAsset?: QuorumCandidateSnapshotInput;
    observedTransfersByAsset?: QuorumObservedTransferInput;
    clearAssetCandidates?: readonly QuorumAsset[];
  } = {},
): Promise<QuorumCandidateWriteResult> {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error('Quorum candidate registry time settings are invalid.');
  }
  const assets = emptyAssets();
  const historicalCandidates = emptyAssets();
  const observedTransfers = emptyObservedTransfers();
  const persistedByAsset = emptyAssetsCount();
  const rejectedByAsset = emptyAssetsCount();
  const historicalByAsset = emptyAssetsCount();
  const clearAssetCandidates = new Set(options.clearAssetCandidates ?? []);
  const filePath = options.filePath ?? process.env.SBK1_QUORUM_CANDIDATES_PATH ?? DEFAULT_REGISTRY_PATH;
  let previousSnapshot: QuorumCandidateSnapshot | null = null;
  try {
    previousSnapshot = snapshotFrom(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') throw error;
  }

  for (const asset of QUORUM_ASSETS) {
    const candidates = candidatesByAsset[asset];
    if (!Array.isArray(candidates)) {
      throw new Error(`Quorum candidate snapshot requires a list for ${asset}.`);
    }
    const liveByKey = new Map<string, QuorumCandidateRecord>();
    for (const candidate of clearAssetCandidates.has(asset) ? [] : previousSnapshot?.assets[asset] ?? []) {
      if (validateCandidate(candidate, asset, nowMs, maxAgeMs)) {
        liveByKey.set(candidateKey(candidate), candidate);
      }
    }
    for (const candidate of candidates) {
      if (validateCandidate(candidate, asset, nowMs, maxAgeMs)) {
        liveByKey.set(candidateKey(candidate), candidate);
      } else {
        rejectedByAsset[asset] += 1;
      }
    }
    assets[asset] = [...liveByKey.values()];
    persistedByAsset[asset] = assets[asset].length;

    const historicalInput = options.historicalCandidatesByAsset?.[asset] ?? [];
    const historicalByKey = new Map<string, QuorumCandidateRecord>();
    for (const candidate of previousSnapshot?.historicalCandidates[asset] ?? []) {
      if (validateCandidate(candidate, asset, nowMs, DEFAULT_HISTORICAL_WINDOW_MS)) {
        historicalByKey.set(candidateKey(candidate), candidate);
      }
    }
    for (const candidate of historicalInput) {
      if (validateCandidate(candidate, asset, nowMs, DEFAULT_HISTORICAL_WINDOW_MS)) {
        historicalByKey.set(candidateKey(candidate), candidate);
      } else {
        rejectedByAsset[asset] += 1;
      }
    }
    historicalCandidates[asset] = [...historicalByKey.values()]
      .sort((left, right) => right.timestampMs - left.timestampMs)
      .slice(0, MAX_HISTORICAL_CANDIDATES_PER_ASSET);
    historicalByAsset[asset] = historicalCandidates[asset].length;

    const observedByKey = new Map<string, QuorumObservedTransfer>();
    for (const transfer of previousSnapshot?.observedTransfers[asset] ?? []) {
      if (isValidObservedTransfer(transfer, asset, nowMs, DEFAULT_HISTORICAL_WINDOW_MS)) {
        observedByKey.set(observedTransferKey(transfer), transfer);
      }
    }
    for (const transfer of options.observedTransfersByAsset?.[asset] ?? []) {
      if (isValidObservedTransfer(transfer, asset, nowMs, DEFAULT_HISTORICAL_WINDOW_MS)) {
        observedByKey.set(observedTransferKey(transfer), transfer);
      } else {
        rejectedByAsset[asset] += 1;
      }
    }
    observedTransfers[asset] = [...observedByKey.values()]
      .sort((left, right) => right.timestampMs - left.timestampMs)
      .slice(0, MAX_HISTORICAL_CANDIDATES_PER_ASSET);
  }

  const snapshot: QuorumCandidateSnapshot = {
    version: REGISTRY_VERSION,
    generatedAtMs: nowMs,
    assets,
    historicalCandidates,
    observedTransfers,
  };
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return { path: filePath, persistedByAsset, rejectedByAsset, historicalByAsset };
}

function emptyAssetsCount(): Record<QuorumAsset, number> {
  return { BTC: 0, ETH: 0, BNB: 0, SOL: 0, XRP: 0 };
}

function asCouncilCandidate(candidate: QuorumCandidateRecord): CouncilWhaleConsensusCandidate {
  return {
    blockchain: candidate.blockchain,
    transactionHash: candidate.transactionHash,
    transferId: candidate.transferId,
    timestampMs: candidate.timestampMs,
    assetSymbol: candidate.assetSymbol,
    amount: candidate.amount,
    estimatedUsd: candidate.estimatedUsd,
    direction: candidate.direction,
    observations: candidate.observations.map((observation) => ({
      sourceId: observation.sourceId as CouncilWhaleQuorumSourceId,
      evidenceType: observation.evidenceType,
      blockchain: observation.blockchain,
      transactionHash: observation.transactionHash,
      transferId: observation.transferId,
      direction: observation.direction,
      amount: observation.amount,
      timestampMs: observation.timestampMs,
      confirmationStatus: observation.confirmationStatus,
      exchangeName: observation.exchangeName,
      exchangeAddress: observation.exchangeAddress,
    })),
  };
}

function asCouncilTransfer(candidate: QuorumCandidateRecord): CouncilWhaleTransfer {
  return {
    transactionHash: candidate.transactionHash,
    blockchain: candidate.blockchain,
    blockHeight: candidate.blockHeight ?? null,
    timestampMs: candidate.timestampMs,
    sourceProvider: `Local quorum registry (${[...new Set(candidate.observations.map(({ sourceId }) => sourceId))].join(', ')})`,
    asset: candidate.assetSymbol,
    amount: candidate.amount,
    estimatedUsd: candidate.estimatedUsd,
    confirmationStatus: 'CONFIRMED',
    transferId: candidate.transferId,
  };
}

export async function loadQuorumCandidateFlow(
  asset: QuorumAsset,
  options: { nowMs?: number; filePath?: string; maxAgeMs?: number } = {},
): Promise<CouncilWhaleFlowData> {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const filePath = options.filePath ?? process.env.SBK1_QUORUM_CANDIDATES_PATH ?? DEFAULT_REGISTRY_PATH;
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    return unavailable(asset, 'Local quorum candidate registry time settings are invalid.');
  }
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return unavailable(asset, 'Local quorum candidate registry does not exist yet.');
    }
    console.error('[WhaleConsensusCandidateRegistry] Failed to read registry:', error);
    return unavailable(asset, 'Local quorum candidate registry could not be read.');
  }

  try {
    const snapshot = snapshotFrom(JSON.parse(raw) as unknown);
    const snapshotAgeMs = nowMs - snapshot.generatedAtMs;
    if (snapshotAgeMs < 0 || snapshotAgeMs > maxAgeMs) {
      return unavailable(
        asset,
        `Poller heartbeat is stale or future-dated (${Math.round(snapshotAgeMs / 1_000)}s); the poller may be stopped or unable to write.`,
      );
    }
    const candidates = snapshot.assets[asset]
      .filter((candidate) => validateCandidate(candidate, asset, nowMs, maxAgeMs));
    if (candidates.length === 0) {
      return unavailable(
        asset,
        `Poller heartbeat is current (${Math.round(snapshotAgeMs / 1_000)}s old), but no fresh, confirmed candidate with two independent sources and high-confidence exchange attribution is available.`,
      );
    }
    const timestampMs = Math.max(...candidates.map(({ timestampMs: candidateTimestamp }) => candidateTimestamp));
    const councilCandidates = candidates.map(asCouncilCandidate);
    return {
      status: 'LIVE',
      provider: 'Local quorum candidate registry',
      assetSymbol: asset,
      timestampMs,
      retrievedAtMs: nowMs,
      ageMs: nowMs - timestampMs,
      qualityPct: 100,
      coverageStatus: 'COMPLETE',
      largeTransfers: candidates.map(asCouncilTransfer),
      consensusMatrix: { candidates: councilCandidates },
      exchangeInflowsBtc: null,
      exchangeOutflowsBtc: null,
      netExchangeFlowBtc: null,
      transactionCount: candidates.length,
      windowStartHeight: null,
      windowEndHeight: null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[WhaleConsensusCandidateRegistry] Registry data is invalid:', reason);
    return unavailable(asset, 'Local quorum candidate registry is malformed.');
  }
}
