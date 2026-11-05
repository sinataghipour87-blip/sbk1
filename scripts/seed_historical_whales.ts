import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OnChainAsset } from '../src/services/onChainFeedRegistry';
import { fetchOnChainWhaleData } from '../src/services/publicBitcoinWhaleData';
import {
  flushOnChainWalletCandidates,
  getOnChainWalletCandidateCounts,
  getOnChainWalletCandidates,
  loadOnChainWalletCandidates,
  seedConfirmedOnChainTransfers,
} from '../src/services/onChainWalletDiscovery';

const ASSETS: readonly OnChainAsset[] = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'];

const results: Array<{
  asset: OnChainAsset;
  status: string;
  ageMs: number | null;
  independentProviderCount: number;
  qualifyingTransfers: number;
  newlySeededAddresses: number;
  newlyStoredAddresses: number;
  storedCandidates: number;
  quorumVerifiedCandidates: number;
  unverifiedCandidates: number;
  quorumCompliancePct: number | null;
  sourceOverlap: {
    zero: number;
    one: number;
    two: number;
    three: number;
    fourOrMore: number;
  };
  providers: NonNullable<import('../src/services/eightMemberCouncil').CouncilWhaleFlowData['providerParticipation']>;
  reason: string | null;
}> = [];

const candidateAudit: Array<{
  asset: OnChainAsset;
  address: string;
  origin: string;
  quorumVerified: boolean;
  quorumVerifiedTransferCount: number;
  lastQuorumSourceIds: readonly string[];
  sourceIds: readonly string[];
  sourceOverlapCount: number;
}> = [];

for (const asset of ASSETS) {
  const pair = `${asset}/USDT:USDT`;
  const nowMs = Date.now();
  try {
    const flow = await fetchOnChainWhaleData({
      pair,
      nowMs,
      forceRefresh: true,
      historicalBackfill: true,
    });
    const seedResult = await seedConfirmedOnChainTransfers(asset, flow, Date.now());
    await flushOnChainWalletCandidates(Date.now());
    await loadOnChainWalletCandidates(asset);
    const auditNowMs = Date.now();
    const counts = getOnChainWalletCandidateCounts(asset, auditNowMs);
    const candidates = getOnChainWalletCandidates({ asset, nowMs: auditNowMs, limit: 10_000 });
    const verifiedCandidates = candidates.filter((candidate) =>
      candidate.quorumVerifiedTransferCount > 0 &&
      new Set(candidate.lastQuorumSourceIds).size >= 2 &&
      candidate.lastQuorumSourceIds.every((sourceId) => candidate.sourceIds.includes(sourceId))
    );
    candidateAudit.push(...candidates.map((candidate) => ({
      asset,
      address: candidate.address,
      origin: candidate.origin,
      quorumVerified: verifiedCandidates.includes(candidate),
      quorumVerifiedTransferCount: candidate.quorumVerifiedTransferCount,
      lastQuorumSourceIds: candidate.lastQuorumSourceIds,
      sourceIds: candidate.sourceIds,
      sourceOverlapCount: candidate.sourceOverlapCount,
    })));
    const sourceOverlap = candidates.reduce((overlap, candidate) => {
      if (candidate.sourceOverlapCount >= 4) overlap.fourOrMore += 1;
      else if (candidate.sourceOverlapCount === 3) overlap.three += 1;
      else if (candidate.sourceOverlapCount === 2) overlap.two += 1;
      else if (candidate.sourceOverlapCount === 1) overlap.one += 1;
      else overlap.zero += 1;
      return overlap;
    }, { zero: 0, one: 0, two: 0, three: 0, fourOrMore: 0 });
    results.push({
      asset,
      status: flow.status,
      ageMs: flow.timestampMs === null ? null : Math.max(0, Date.now() - flow.timestampMs),
      independentProviderCount: flow.independentProviderCount ?? 0,
      qualifyingTransfers: flow.largeTransfers?.filter((transfer) =>
        transfer.asset === asset &&
        transfer.confirmationStatus === 'CONFIRMED' &&
        (transfer.providerConfirmations ?? 0) >= 2 &&
        new Set(transfer.confirmingSourceIds ?? []).size >= 2
      ).length ?? 0,
      newlySeededAddresses: seedResult.newlySeededAddresses,
      newlyStoredAddresses: seedResult.newlyStoredAddresses,
      storedCandidates: counts.stored,
      quorumVerifiedCandidates: verifiedCandidates.length,
      unverifiedCandidates: counts.stored - verifiedCandidates.length,
      quorumCompliancePct: counts.stored === 0
        ? null
        : Number(((verifiedCandidates.length / counts.stored) * 100).toFixed(2)),
      sourceOverlap,
      providers: flow.providerParticipation ?? [],
      reason: flow.unavailableReason ?? null,
    });
  } catch (error) {
    const candidates = await loadOnChainWalletCandidates(asset);
    const fullCandidateList = getOnChainWalletCandidates({ asset, limit: 10_000 });
    const verifiedCandidates = fullCandidateList.filter((candidate) =>
      candidate.quorumVerifiedTransferCount > 0 &&
      new Set(candidate.lastQuorumSourceIds).size >= 2 &&
      candidate.lastQuorumSourceIds.every((sourceId) => candidate.sourceIds.includes(sourceId))
    );
    candidateAudit.push(...fullCandidateList.map((candidate) => ({
      asset,
      address: candidate.address,
      origin: candidate.origin,
      quorumVerified: verifiedCandidates.includes(candidate),
      quorumVerifiedTransferCount: candidate.quorumVerifiedTransferCount,
      lastQuorumSourceIds: candidate.lastQuorumSourceIds,
      sourceIds: candidate.sourceIds,
      sourceOverlapCount: candidate.sourceOverlapCount,
    })));
    const sourceOverlap = fullCandidateList.reduce((overlap, candidate) => {
      if (candidate.sourceOverlapCount >= 4) overlap.fourOrMore += 1;
      else if (candidate.sourceOverlapCount === 3) overlap.three += 1;
      else if (candidate.sourceOverlapCount === 2) overlap.two += 1;
      else if (candidate.sourceOverlapCount === 1) overlap.one += 1;
      else overlap.zero += 1;
      return overlap;
    }, { zero: 0, one: 0, two: 0, three: 0, fourOrMore: 0 });
    results.push({
      asset,
      status: 'ERROR',
      ageMs: null,
      independentProviderCount: 0,
      qualifyingTransfers: 0,
      newlySeededAddresses: 0,
      newlyStoredAddresses: 0,
      storedCandidates: candidates.length,
      quorumVerifiedCandidates: verifiedCandidates.length,
      unverifiedCandidates: candidates.length - verifiedCandidates.length,
      quorumCompliancePct: candidates.length === 0
        ? null
        : Number(((verifiedCandidates.length / candidates.length) * 100).toFixed(2)),
      sourceOverlap,
      providers: [],
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

const auditPath = path.join(
  process.cwd(),
  '.cache',
  'sbk1',
  'member6-candidate-quorum-audit.json',
);
await mkdir(path.dirname(auditPath), { recursive: true });
await writeFile(auditPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  verificationRule: 'sourceOverlapCount is the number of unique independent source IDs observed in quorum-confirmed transfer evidence retained for the candidate. quorumVerified requires at least one stored transfer confirmed by 2+ independent source IDs.',
  summary: results,
  candidates: candidateAudit,
}, null, 2), { encoding: 'utf8', mode: 0o600 });

console.log('Mode: MANUAL_BOUNDED_HISTORICAL_BACKFILL_NO_ORDERS');
console.log(`Generated: ${new Date().toISOString()}`);
console.log('Limits: BTC=144 blocks (all tx pages), ETH=1,000 blocks, BNB=1,000 blocks, SOL=200 finalized slots, XRP=10 validated ledgers.');
console.log('Fresh chain heads and two-operator transfer quorum are required; candidate labels remain unverified.');
console.table(results);
console.log('Consensus matrix (candidate count by independent source overlap):');
console.table(results.map(({ asset, storedCandidates, sourceOverlap }) => ({
  asset,
  candidates: storedCandidates,
  zero: sourceOverlap.zero,
  oneSource: sourceOverlap.one,
  twoSources: sourceOverlap.two,
  threeSources: sourceOverlap.three,
  fourOrMoreSources: sourceOverlap.fourOrMore,
})));
console.log('Provider participation (VALID means the adapter accepted a fresh, schema-valid response; THROTTLED includes HTTP 429/503; FAILED includes other adapter failures):');
console.table(results.flatMap(({ asset, providers }) =>
  providers.map(({ provider, sourceId, status, error }) => ({
    asset,
    provider,
    sourceId,
    status,
    error: error ?? '',
  }))
));
console.log(`Per-candidate quorum audit: ${auditPath}`);

if (results.some(({ status, independentProviderCount }) =>
  status !== 'LIVE' || independentProviderCount < 2
)) process.exitCode = 1;
