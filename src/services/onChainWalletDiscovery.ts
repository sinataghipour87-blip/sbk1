import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CouncilWhaleFlowData, CouncilWhaleTransfer } from './eightMemberCouncil';
import type { OnChainAsset } from './onChainFeedRegistry';
import { isValidOnChainWalletAddress } from './onChainWalletLabels';

const CANDIDATE_TTL_MS = 30 * 24 * 60 * 60_000;
const PERSIST_INTERVAL_MS = 60_000;
const MAX_COUNTERPARTIES_PER_ADDRESS = 32;
const MAX_RECENT_EVIDENCE_IDS = 64;
const MAX_RECORDED_SOURCE_IDS = 8;

export const ONCHAIN_WALLET_CANDIDATE_CAPACITY_PER_ASSET = 10_000;

const MINIMUM_LARGE_TRANSFER_NATIVE: Readonly<Record<OnChainAsset, number>> = {
  BTC: 10,
  ETH: 100,
  SOL: 10,
  BNB: 5,
  XRP: 1_000,
};

export type OnChainWalletCandidateTag =
  | 'REPEATED_LARGE_RECEIVER'
  | 'REPEATED_LARGE_SENDER'
  | 'HIGH_VOLUME_COUNTERPARTY'
  | 'POSSIBLE_ACCUMULATOR'
  | 'POSSIBLE_EXCHANGE_ACTIVITY';

export interface OnChainWalletCandidate {
  asset: OnChainAsset;
  address: string;
  labelStatus: 'candidate-unverified';
  origin: 'historical-seed' | 'realtime-discovery';
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  confirmedTransferCount: number;
  quorumVerifiedTransferCount: number;
  lastQuorumSourceIds: readonly string[];
  sourceOverlapCount: number;
  receivedNative: number;
  sentNative: number;
  sourceIds: readonly string[];
  counterparties: readonly string[];
  recentEvidenceIds: readonly string[];
  heuristicTags: readonly OnChainWalletCandidateTag[];
  activityScore: number;
}

interface CandidateFile {
  schemaVersion: 1;
  candidates: OnChainWalletCandidate[];
  savedAtMs: number;
}

const CANDIDATES_FILE_PATH = process.env.SBK1_ONCHAIN_WALLET_CANDIDATES_FILE?.trim() ||
  path.join(process.cwd(), '.cache', 'sbk1', 'onchain-wallet-candidates.json');
const candidatesByAsset = new Map<OnChainAsset, Map<string, OnChainWalletCandidate>>();
let candidatesLoaded = false;
let candidatesDirty = false;
let lastPersistedAtMs = 0;
let candidateOperation: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAsset(value: unknown): value is OnChainAsset {
  return value === 'BTC' || value === 'ETH' || value === 'SOL' || value === 'BNB' || value === 'XRP';
}

function normalizeAddress(asset: OnChainAsset, address: string): string {
  return asset === 'ETH' || asset === 'BNB' ? address.toLowerCase() : address;
}

function isCandidateTag(value: unknown): value is OnChainWalletCandidateTag {
  return value === 'REPEATED_LARGE_RECEIVER' ||
    value === 'REPEATED_LARGE_SENDER' ||
    value === 'HIGH_VOLUME_COUNTERPARTY' ||
    value === 'POSSIBLE_ACCUMULATOR' ||
    value === 'POSSIBLE_EXCHANGE_ACTIVITY';
}

function parseCandidate(value: unknown): OnChainWalletCandidate {
  if (!isRecord(value) ||
      !isAsset(value.asset) ||
      typeof value.address !== 'string' ||
      !isValidOnChainWalletAddress(value.asset, value.address) ||
      value.labelStatus !== 'candidate-unverified' ||
      typeof value.firstSeenAtMs !== 'number' || !Number.isSafeInteger(value.firstSeenAtMs) ||
      typeof value.lastSeenAtMs !== 'number' || !Number.isSafeInteger(value.lastSeenAtMs) ||
      value.firstSeenAtMs > value.lastSeenAtMs ||
      typeof value.confirmedTransferCount !== 'number' ||
      !Number.isSafeInteger(value.confirmedTransferCount) || value.confirmedTransferCount < 0 ||
      (value.quorumVerifiedTransferCount !== undefined &&
        (typeof value.quorumVerifiedTransferCount !== 'number' ||
          !Number.isSafeInteger(value.quorumVerifiedTransferCount) ||
          value.quorumVerifiedTransferCount < 0 ||
          value.quorumVerifiedTransferCount > value.confirmedTransferCount)) ||
      (value.lastQuorumSourceIds !== undefined &&
        (!Array.isArray(value.lastQuorumSourceIds) ||
          value.lastQuorumSourceIds.some((sourceId) => typeof sourceId !== 'string'))) ||
      (value.sourceOverlapCount !== undefined &&
        (typeof value.sourceOverlapCount !== 'number' ||
          !Number.isSafeInteger(value.sourceOverlapCount) ||
          value.sourceOverlapCount < 0 ||
          value.sourceOverlapCount > MAX_RECORDED_SOURCE_IDS)) ||
      typeof value.receivedNative !== 'number' || !Number.isFinite(value.receivedNative) || value.receivedNative < 0 ||
      typeof value.sentNative !== 'number' || !Number.isFinite(value.sentNative) || value.sentNative < 0 ||
      !Array.isArray(value.sourceIds) || value.sourceIds.some((sourceId) => typeof sourceId !== 'string') ||
      !Array.isArray(value.counterparties) || value.counterparties.some((address) =>
        typeof address !== 'string' || !isValidOnChainWalletAddress(value.asset as OnChainAsset, address)
      ) ||
      !Array.isArray(value.recentEvidenceIds) ||
      value.recentEvidenceIds.some((id) => typeof id !== 'string') ||
      !Array.isArray(value.heuristicTags) || value.heuristicTags.some((tag) => !isCandidateTag(tag)) ||
      typeof value.activityScore !== 'number' ||
      !Number.isFinite(value.activityScore) || value.activityScore < 0 || value.activityScore > 100) {
    throw new Error('Persistent on-chain wallet candidate has invalid fields.');
  }
  return {
    asset: value.asset,
    address: normalizeAddress(value.asset, value.address),
    labelStatus: 'candidate-unverified',
    origin: value.origin === 'historical-seed' ? 'historical-seed' : 'realtime-discovery',
    firstSeenAtMs: value.firstSeenAtMs,
    lastSeenAtMs: value.lastSeenAtMs,
    confirmedTransferCount: value.confirmedTransferCount,
    quorumVerifiedTransferCount: typeof value.quorumVerifiedTransferCount === 'number'
      ? value.quorumVerifiedTransferCount
      : 0,
    lastQuorumSourceIds: Array.isArray(value.lastQuorumSourceIds)
      ? [...new Set(value.lastQuorumSourceIds as string[])].slice(-MAX_RECORDED_SOURCE_IDS)
      : [],
    sourceOverlapCount: typeof value.sourceOverlapCount === 'number'
      ? value.sourceOverlapCount
      : Math.min(MAX_RECORDED_SOURCE_IDS, new Set(value.sourceIds as string[]).size),
    receivedNative: value.receivedNative,
    sentNative: value.sentNative,
    sourceIds: [...new Set(value.sourceIds as string[])].slice(-MAX_RECORDED_SOURCE_IDS),
    counterparties: [...new Set((value.counterparties as string[])
      .map((address) => normalizeAddress(value.asset as OnChainAsset, address)))]
      .slice(-MAX_COUNTERPARTIES_PER_ADDRESS),
    recentEvidenceIds: [...new Set(value.recentEvidenceIds as string[])].slice(-MAX_RECENT_EVIDENCE_IDS),
    heuristicTags: [...new Set(value.heuristicTags as OnChainWalletCandidateTag[])],
    activityScore: value.activityScore,
  };
}

function deriveTags(candidate: OnChainWalletCandidate): OnChainWalletCandidateTag[] {
  const tags: OnChainWalletCandidateTag[] = [];
  const floor = MINIMUM_LARGE_TRANSFER_NATIVE[candidate.asset];
  if (candidate.receivedNative >= floor * 3 && candidate.confirmedTransferCount >= 3) {
    tags.push('REPEATED_LARGE_RECEIVER');
  }
  if (candidate.sentNative >= floor * 3 && candidate.confirmedTransferCount >= 3) {
    tags.push('REPEATED_LARGE_SENDER');
  }
  if (candidate.receivedNative + candidate.sentNative >= floor * 5) {
    tags.push('HIGH_VOLUME_COUNTERPARTY');
  }
  if (
    candidate.receivedNative >= floor * 3 &&
    candidate.receivedNative >= Math.max(candidate.sentNative * 2, floor * 2) &&
    candidate.counterparties.length >= 3
  ) {
    tags.push('POSSIBLE_ACCUMULATOR');
  }
  if (
    candidate.confirmedTransferCount >= 5 &&
    candidate.counterparties.length >= 5 &&
    candidate.receivedNative + candidate.sentNative >= floor * 10
  ) {
    tags.push('POSSIBLE_EXCHANGE_ACTIVITY');
  }
  return tags;
}

function scoreActivity(candidate: OnChainWalletCandidate): number {
  const floor = MINIMUM_LARGE_TRANSFER_NATIVE[candidate.asset];
  const volumeScore = Math.min(40, ((candidate.receivedNative + candidate.sentNative) / floor) * 2);
  const transferScore = Math.min(30, candidate.confirmedTransferCount * 3);
  const counterpartyScore = Math.min(30, candidate.counterparties.length * 3);
  return Math.round(volumeScore + transferScore + counterpartyScore);
}

function isPersistedFile(value: unknown): value is CandidateFile {
  return isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.savedAtMs === 'number' && Number.isSafeInteger(value.savedAtMs) &&
    Array.isArray(value.candidates);
}

async function loadCandidates(nowMs: number): Promise<void> {
  if (candidatesLoaded) return;
  try {
    const contents = await readFile(CANDIDATES_FILE_PATH, 'utf8');
    let decoded: unknown;
    try {
      decoded = JSON.parse(contents);
    } catch (error) {
      throw new Error(`Wallet candidate database is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isPersistedFile(decoded)) {
      throw new Error('Wallet candidate database has an unsupported or malformed schema.');
    }
    for (const rawCandidate of decoded.candidates) {
      const candidate = parseCandidate(rawCandidate);
      if (nowMs - candidate.lastSeenAtMs < CANDIDATE_TTL_MS &&
          candidate.lastSeenAtMs <= nowMs) {
        let assetCandidates = candidatesByAsset.get(candidate.asset);
        if (!assetCandidates) {
          assetCandidates = new Map();
          candidatesByAsset.set(candidate.asset, assetCandidates);
        }
        assetCandidates.set(candidate.address, candidate);
      }
    }
    pruneCandidates(nowMs);
    candidatesDirty = decoded.candidates.length !== listAllCandidates().length;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      candidatesLoaded = true;
      return;
    }
    throw error;
  }
  candidatesLoaded = true;
}

function listAllCandidates(): OnChainWalletCandidate[] {
  return [...candidatesByAsset.values()].flatMap((assetCandidates) => [...assetCandidates.values()]);
}

function pruneCandidates(nowMs: number): boolean {
  let changed = false;
  for (const [asset, assetCandidates] of candidatesByAsset) {
    for (const [address, candidate] of assetCandidates) {
      if (candidate.lastSeenAtMs > nowMs || nowMs - candidate.lastSeenAtMs >= CANDIDATE_TTL_MS) {
        assetCandidates.delete(address);
        changed = true;
      }
    }
    while (assetCandidates.size > ONCHAIN_WALLET_CANDIDATE_CAPACITY_PER_ASSET) {
      const oldest = assetCandidates.keys().next().value as string | undefined;
      if (!oldest) break;
      assetCandidates.delete(oldest);
      changed = true;
    }
    if (assetCandidates.size === 0) {
      candidatesByAsset.delete(asset);
      changed = true;
    }
  }
  return changed;
}

function updateCandidate(options: {
  asset: OnChainAsset;
  address: string;
  counterparty: string;
  direction: 'IN' | 'OUT';
  amount: number;
  nowMs: number;
  sourceIds: readonly string[];
  evidenceId: string;
  observationTimeMs?: number;
  origin?: OnChainWalletCandidate['origin'];
}): boolean {
  const quorumSourceIds = [...new Set(options.sourceIds)];
  if (quorumSourceIds.length < 2) return false;
  const observationTimeMs = options.observationTimeMs ?? options.nowMs;
  if (!Number.isSafeInteger(observationTimeMs) ||
      observationTimeMs > options.nowMs ||
      options.nowMs - observationTimeMs >= CANDIDATE_TTL_MS) return false;
  const normalizedAddress = normalizeAddress(options.asset, options.address);
  const normalizedCounterparty = normalizeAddress(options.asset, options.counterparty);
  let assetCandidates = candidatesByAsset.get(options.asset);
  if (!assetCandidates) {
    assetCandidates = new Map();
    candidatesByAsset.set(options.asset, assetCandidates);
  }
  const previous = assetCandidates.get(normalizedAddress);
  if (previous?.recentEvidenceIds.includes(options.evidenceId)) return false;
  const evidenceIds = [...(previous?.recentEvidenceIds ?? []), options.evidenceId]
    .slice(-MAX_RECENT_EVIDENCE_IDS);
  const counterparties = [...new Set([
    ...(previous?.counterparties ?? []),
    normalizedCounterparty,
  ])].slice(-MAX_COUNTERPARTIES_PER_ADDRESS);
  const observedSourceIds = [...new Set([...(previous?.sourceIds ?? []), ...quorumSourceIds])]
    .slice(-MAX_RECORDED_SOURCE_IDS);
  const updated: OnChainWalletCandidate = {
    asset: options.asset,
    address: normalizedAddress,
    labelStatus: 'candidate-unverified',
    origin: options.origin ?? previous?.origin ?? 'realtime-discovery',
    firstSeenAtMs: Math.min(previous?.firstSeenAtMs ?? observationTimeMs, observationTimeMs),
    lastSeenAtMs: Math.max(previous?.lastSeenAtMs ?? observationTimeMs, observationTimeMs),
    confirmedTransferCount: (previous?.confirmedTransferCount ?? 0) + 1,
    quorumVerifiedTransferCount: (previous?.quorumVerifiedTransferCount ?? 0) + 1,
    lastQuorumSourceIds: quorumSourceIds.slice(-MAX_RECORDED_SOURCE_IDS),
    sourceOverlapCount: observedSourceIds.length,
    receivedNative: (previous?.receivedNative ?? 0) + (options.direction === 'IN' ? options.amount : 0),
    sentNative: (previous?.sentNative ?? 0) + (options.direction === 'OUT' ? options.amount : 0),
    sourceIds: observedSourceIds,
    counterparties,
    recentEvidenceIds: evidenceIds,
    heuristicTags: [],
    activityScore: 0,
  };
  updated.heuristicTags = deriveTags(updated);
  updated.activityScore = scoreActivity(updated);
  assetCandidates.delete(normalizedAddress);
  assetCandidates.set(normalizedAddress, updated);
  while (assetCandidates.size > ONCHAIN_WALLET_CANDIDATE_CAPACITY_PER_ASSET) {
    const oldest = assetCandidates.keys().next().value as string | undefined;
    if (!oldest) break;
    assetCandidates.delete(oldest);
  }
  return true;
}

async function persistCandidates(nowMs: number, force = false): Promise<void> {
  if (!candidatesDirty || (!force && nowMs - lastPersistedAtMs < PERSIST_INTERVAL_MS)) return;
  const file: CandidateFile = {
    schemaVersion: 1,
    candidates: listAllCandidates(),
    savedAtMs: nowMs,
  };
  const directory = path.dirname(CANDIDATES_FILE_PATH);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${CANDIDATES_FILE_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, CANDIDATES_FILE_PATH);
  lastPersistedAtMs = nowMs;
  candidatesDirty = false;
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = candidateOperation.then(operation);
  candidateOperation = result.then(() => undefined, () => undefined);
  return result;
}

function transferCounterparties(transfer: CouncilWhaleTransfer): {
  sources: string[];
  destination: string | null;
} {
  const sources = [...new Set(transfer.fromAddresses ?? (transfer.fromAddress ? [transfer.fromAddress] : []))];
  const destination = transfer.toAddress ?? null;
  return { sources, destination };
}

function hasValidHistoricalTransferIdentity(
  asset: OnChainAsset,
  transfer: CouncilWhaleTransfer,
): boolean {
  const expectedBlockchain: Readonly<Record<OnChainAsset, string>> = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    SOL: 'solana',
    BNB: 'binance_smart_chain',
    XRP: 'xrp',
  };
  const validTransactionHash = asset === 'SOL'
    ? /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(transfer.transactionHash)
    : /^[0-9a-f]{64}$/i.test(transfer.transactionHash);
  return transfer.blockchain === expectedBlockchain[asset] &&
    validTransactionHash &&
    Number.isSafeInteger(transfer.blockHeight) &&
    transfer.blockHeight > 0 &&
    typeof transfer.transferId === 'string' &&
    transfer.transferId.length > 0 &&
    transfer.transferId.length <= 256;
}

export function discoverOnChainWalletCandidates(
  flow: CouncilWhaleFlowData,
  nowMs = Date.now(),
): Promise<void> {
  return serialize(async () => {
    const asset = flow.asset;
    if (!isAsset(asset)) return;
    await loadCandidates(nowMs);
    if (pruneCandidates(nowMs)) candidatesDirty = true;
    const hasIndependentQuorum = flow.status === 'LIVE' &&
      flow.timestampMs !== null &&
      flow.timestampMs <= nowMs &&
      nowMs - flow.timestampMs < 5 * 60_000 &&
      (flow.independentProviderCount ?? 0) >= 2 &&
      new Set(flow.independentSourceIds ?? []).size >= 2;
    const flowSourceIds = new Set(flow.independentSourceIds ?? []);
    if (hasIndependentQuorum) {
      for (const transfer of flow.largeTransfers ?? []) {
        if (
          transfer.confirmationStatus !== 'CONFIRMED' ||
          (transfer.providerConfirmations ?? 0) < 2 ||
          new Set(transfer.confirmingSourceIds ?? []).size < 2 ||
          !(transfer.confirmingSourceIds ?? []).every((sourceId) => flowSourceIds.has(sourceId)) ||
          transfer.asset !== asset ||
          transfer.amount < MINIMUM_LARGE_TRANSFER_NATIVE[asset] ||
          !Number.isSafeInteger(transfer.timestampMs) ||
          transfer.timestampMs > nowMs ||
          nowMs - transfer.timestampMs >= 5 * 60_000
        ) continue;
        const { sources, destination } = transferCounterparties(transfer);
        const validSources = sources.filter((address) => isValidOnChainWalletAddress(asset, address));
        const validDestination = destination && isValidOnChainWalletAddress(asset, destination)
          ? destination
          : null;
        const evidenceId = `${asset}:${transfer.blockchain}:${transfer.transactionHash.toLowerCase()}:${transfer.transferId ?? ''}`;
        for (const source of validSources) {
          for (const counterparty of [...validSources.filter((address) => address !== source), ...(validDestination ? [validDestination] : [])]) {
            if (source !== counterparty) {
              if (updateCandidate({
                asset,
                address: source,
                counterparty,
                direction: 'OUT',
                amount: transfer.amount,
                nowMs,
                sourceIds: transfer.confirmingSourceIds ?? [],
                evidenceId: `${evidenceId}:${source}:out`,
              })) candidatesDirty = true;
            }
          }
        }
        if (validDestination) {
          for (const source of validSources) {
            if (updateCandidate({
              asset,
              address: validDestination,
              counterparty: source,
              direction: 'IN',
              amount: transfer.amount,
              nowMs,
              sourceIds: transfer.confirmingSourceIds ?? [],
              evidenceId: `${evidenceId}:${validDestination}:in`,
            })) candidatesDirty = true;
          }
        }
      }
    }
    await persistCandidates(nowMs);
  });
}

export interface HistoricalCandidateSeedResult {
  newlySeededAddresses: number;
  newlyStoredAddresses: number;
  importedTransfers: number;
}

export async function seedConfirmedOnChainTransfers(
  asset: OnChainAsset,
  flow: CouncilWhaleFlowData,
  nowMs = Date.now(),
): Promise<HistoricalCandidateSeedResult> {
  return serialize(async () => {
    await loadCandidates(nowMs);
    if (pruneCandidates(nowMs)) candidatesDirty = true;
    if (
      flow.asset !== asset ||
      flow.status !== 'LIVE' ||
      flow.timestampMs === null ||
      flow.timestampMs > nowMs ||
      nowMs - flow.timestampMs >= 5 * 60_000
    ) {
      return { newlySeededAddresses: 0, newlyStoredAddresses: 0, importedTransfers: 0 };
    }
    const sourceIds = new Set(flow.independentSourceIds ?? []);
    if ((flow.independentProviderCount ?? 0) < 2 || sourceIds.size < 2) {
      return { newlySeededAddresses: 0, newlyStoredAddresses: 0, importedTransfers: 0 };
    }
    const assetCandidates = candidatesByAsset.get(asset) ?? new Map<string, OnChainWalletCandidate>();
    candidatesByAsset.set(asset, assetCandidates);
    const addressesBefore = new Set(assetCandidates.keys());
    const seededBefore = new Set([...assetCandidates.values()]
      .filter(({ origin }) => origin === 'historical-seed')
      .map(({ address }) => address));
    let importedTransfers = 0;
    for (const transfer of flow.largeTransfers ?? []) {
      if (
        transfer.asset !== asset ||
        transfer.confirmationStatus !== 'CONFIRMED' ||
        (transfer.providerConfirmations ?? 0) < 2 ||
        new Set(transfer.confirmingSourceIds ?? []).size < 2 ||
        !(transfer.confirmingSourceIds ?? []).every((sourceId) => sourceIds.has(sourceId)) ||
        !Number.isFinite(transfer.amount) ||
        transfer.amount < MINIMUM_LARGE_TRANSFER_NATIVE[asset] ||
        !hasValidHistoricalTransferIdentity(asset, transfer) ||
        !Number.isSafeInteger(transfer.timestampMs) ||
        transfer.timestampMs > nowMs ||
        nowMs - transfer.timestampMs >= CANDIDATE_TTL_MS
      ) continue;
      const { sources, destination } = transferCounterparties(transfer);
      const validSources = sources.filter((address) => isValidOnChainWalletAddress(asset, address));
      const validDestination = destination && isValidOnChainWalletAddress(asset, destination)
        ? destination
        : null;
      if (validSources.length === 0 && !validDestination) continue;
      const evidenceId = `historical-seed:${asset}:${transfer.blockchain}:${transfer.transactionHash.toLowerCase()}:${transfer.transferId}`;
      let updated = false;
      for (const source of validSources) {
        for (const counterparty of [...validSources.filter((address) => address !== source),
          ...(validDestination ? [validDestination] : [])]) {
          if (source !== counterparty) {
            updated = updateCandidate({
              asset,
              address: source,
              counterparty,
              direction: 'OUT',
              amount: transfer.amount,
              nowMs,
              observationTimeMs: transfer.timestampMs,
              sourceIds: transfer.confirmingSourceIds ?? [],
              evidenceId: `${evidenceId}:${source}:out`,
              origin: 'historical-seed',
            }) || updated;
          }
        }
      }
      if (validDestination) {
        for (const source of validSources) {
          updated = updateCandidate({
            asset,
            address: validDestination,
            counterparty: source,
            direction: 'IN',
            amount: transfer.amount,
            nowMs,
            observationTimeMs: transfer.timestampMs,
            sourceIds: transfer.confirmingSourceIds ?? [],
            evidenceId: `${evidenceId}:${validDestination}:in`,
            origin: 'historical-seed',
          }) || updated;
        }
      }
      if (updated) importedTransfers += 1;
    }
    const newlyStoredAddresses = [...assetCandidates.keys()]
      .filter((address) => !addressesBefore.has(address)).length;
    const newlySeededAddresses = [...assetCandidates.values()]
      .filter(({ address, origin }) => origin === 'historical-seed' && !seededBefore.has(address))
      .length;
    if (importedTransfers > 0) candidatesDirty = true;
    await persistCandidates(nowMs, true);
    return { newlySeededAddresses, newlyStoredAddresses, importedTransfers };
  });
}

export function getOnChainWalletCandidates(options: {
  asset?: OnChainAsset;
  nowMs?: number;
  limit?: number;
} = {}): readonly OnChainWalletCandidate[] {
  const nowMs = options.nowMs ?? Date.now();
  if (pruneCandidates(nowMs)) candidatesDirty = true;
  const candidates = options.asset
    ? [...(candidatesByAsset.get(options.asset)?.values() ?? [])]
    : listAllCandidates();
  return candidates
    .sort((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)
    .slice(0, Math.min(ONCHAIN_WALLET_CANDIDATE_CAPACITY_PER_ASSET, Math.max(0, options.limit ?? 100)))
    .map((candidate) => ({ ...candidate }));
}

export interface OnChainWalletCandidateCounts {
  stored: number;
  active: number;
  seeded: number;
  dynamicallyDiscovered: number;
  activeSeeded: number;
  activeDynamicallyDiscovered: number;
}

export function getOnChainWalletCandidateCounts(
  asset: OnChainAsset,
  nowMs = Date.now(),
): OnChainWalletCandidateCounts {
  if (pruneCandidates(nowMs)) candidatesDirty = true;
  const candidates = [...(candidatesByAsset.get(asset)?.values() ?? [])];
  const active = candidates.filter((candidate) =>
    candidate.lastSeenAtMs <= nowMs && nowMs - candidate.lastSeenAtMs < 15 * 60_000
  );
  const seeded = candidates.filter((candidate) => candidate.origin === 'historical-seed');
  const dynamicallyDiscovered = candidates.filter((candidate) =>
    candidate.origin === 'realtime-discovery'
  );
  return {
    stored: candidates.length,
    active: active.length,
    seeded: seeded.length,
    dynamicallyDiscovered: dynamicallyDiscovered.length,
    activeSeeded: active.filter((candidate) => candidate.origin === 'historical-seed').length,
    activeDynamicallyDiscovered: active.filter((candidate) =>
      candidate.origin === 'realtime-discovery'
    ).length,
  };
}

export async function markOnChainWalletCandidatesSeeded(
  asset: OnChainAsset,
  addresses: readonly string[],
  nowMs = Date.now(),
): Promise<number> {
  return serialize(async () => {
    await loadCandidates(nowMs);
    const assetCandidates = candidatesByAsset.get(asset);
    if (!assetCandidates) return 0;
    let updated = 0;
    for (const address of addresses) {
      const candidate = assetCandidates.get(normalizeAddress(asset, address));
      if (candidate && candidate.origin !== 'historical-seed') {
        candidate.origin = 'historical-seed';
        updated += 1;
        candidatesDirty = true;
      }
    }
    await persistCandidates(nowMs, true);
    return updated;
  });
}

export async function loadOnChainWalletCandidates(
  asset: OnChainAsset,
  nowMs = Date.now(),
): Promise<readonly OnChainWalletCandidate[]> {
  await serialize(async () => {
    await loadCandidates(nowMs);
    if (pruneCandidates(nowMs)) candidatesDirty = true;
    await persistCandidates(nowMs);
  });
  return getOnChainWalletCandidates({ asset, nowMs, limit: ONCHAIN_WALLET_CANDIDATE_CAPACITY_PER_ASSET });
}

export function getOnChainWalletCandidateCount(
  asset: OnChainAsset,
  nowMs = Date.now(),
): number {
  if (pruneCandidates(nowMs)) candidatesDirty = true;
  return candidatesByAsset.get(asset)?.size ?? 0;
}

export async function flushOnChainWalletCandidates(nowMs = Date.now()): Promise<void> {
  await serialize(async () => {
    if (!candidatesLoaded) await loadCandidates(nowMs);
    if (pruneCandidates(nowMs)) candidatesDirty = true;
    await persistCandidates(nowMs, true);
  });
}

export function resetOnChainWalletDiscoveryForTests(): void {
  candidatesByAsset.clear();
  candidatesLoaded = false;
  candidatesDirty = false;
  lastPersistedAtMs = 0;
  candidateOperation = Promise.resolve();
}
