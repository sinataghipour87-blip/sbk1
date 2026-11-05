import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadQuorumCandidateFlow,
  QUORUM_ASSETS,
  writeQuorumCandidateSnapshot,
  type QuorumAsset,
  type QuorumCandidateRecord,
} from '../src/services/whaleConsensusCandidateRegistry';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';

const nowMs = Date.now();
const blockchainByAsset: Record<QuorumAsset, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binance-smart-chain',
  SOL: 'solana',
  XRP: 'xrpledger',
};
const independentSources: Record<QuorumAsset, [string, string]> = {
  BTC: ['mempool.space', 'blockstream'],
  ETH: ['ethereum-rpc-publicnode', 'ethereum-rpc-blockrazor'],
  BNB: ['bsc-rpc-publicnode', 'bsc-rpc-blockrazor'],
  SOL: ['solana-rpc-solana-foundation', 'solana-rpc-publicnode'],
  XRP: ['xrp-rpc-xrplcluster', 'xrp-rpc-honeycluster'],
};

function candidate(asset: QuorumAsset, sourceIds = independentSources[asset]): QuorumCandidateRecord {
  const amount = asset === 'BTC' ? 125 : 10_000;
  const transactionHash = asset === 'BTC' || asset === 'XRP'
    ? 'a'.repeat(64)
    : asset === 'SOL'
      ? '5'.repeat(44)
      : `0x${'a'.repeat(64)}`;
  return {
    assetSymbol: asset,
    blockchain: blockchainByAsset[asset],
    transactionHash,
    transferId: `${asset.toLowerCase()}-transfer`,
    timestampMs: nowMs - 1_000,
    amount,
    amountBtc: asset === 'BTC' ? amount : undefined,
    estimatedUsd: 12_000_000,
    direction: 'EXCHANGE_OUTFLOW',
    confirmationStatus: 'CONFIRMED',
    observations: [
      ...sourceIds.map((sourceId) => ({
        sourceId,
        evidenceType: 'TRANSFER' as const,
        blockchain: blockchainByAsset[asset],
        transactionHash,
        transferId: `${asset.toLowerCase()}-transfer`,
        amount,
        timestampMs: nowMs - 1_000,
        confirmationStatus: 'CONFIRMED' as const,
      })),
      {
        sourceId: asset === 'BNB' ? 'etherscan-metadata' : 'whale-alert',
        evidenceType: 'ATTRIBUTION',
        blockchain: blockchainByAsset[asset],
        transactionHash,
        transferId: `${asset.toLowerCase()}-transfer`,
        direction: 'EXCHANGE_OUTFLOW',
        amount,
        timestampMs: nowMs - 1_000,
        confirmationStatus: 'CONFIRMED',
      },
    ],
  };
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-quorum-registry-'));
const registryPath = path.join(directory, 'quorum-candidates.json');
try {
  const snapshot = Object.fromEntries(
    QUORUM_ASSETS.map((asset) => [asset, [candidate(asset)]]),
  ) as Record<QuorumAsset, QuorumCandidateRecord[]>;
  snapshot.BTC.push(candidate('BTC', ['unlisted-source', 'blockstream']));
  snapshot.BNB.push(candidate('BNB', ['bscscan', 'etherscan']));
  const conflictingXrp = candidate('XRP');
  conflictingXrp.observations[2].direction = 'EXCHANGE_INFLOW';
  snapshot.XRP.push(conflictingXrp);
  const mismatchedTransferEth = candidate('ETH');
  mismatchedTransferEth.observations[1].transferId = 'different-log';
  snapshot.ETH.push(mismatchedTransferEth);
  const unconfirmedEth = candidate('ETH');
  unconfirmedEth.observations[1].confirmationStatus = 'UNCONFIRMED';
  snapshot.ETH.push(unconfirmedEth);
  const writeResult = await writeQuorumCandidateSnapshot(snapshot, { nowMs, filePath: registryPath });
  assert.deepEqual(writeResult.persistedByAsset, { BTC: 1, ETH: 1, BNB: 1, SOL: 1, XRP: 1 });
  assert.equal(writeResult.rejectedByAsset.BTC, 1,
    'unknown source IDs must not satisfy the two-transfer-operator requirement');
  assert.equal(writeResult.rejectedByAsset.BNB, 1,
    'BscScan and Etherscan share the same operator and must count as one source');
  assert.equal(writeResult.rejectedByAsset.XRP, 1,
    'contradictory confirmed observations must not enter the registry');
  assert.equal(writeResult.rejectedByAsset.ETH, 2,
    'unconfirmed or mismatched-transfer observations must not count toward quorum');

  for (const asset of QUORUM_ASSETS) {
    const flow = await loadQuorumCandidateFlow(asset, { nowMs, filePath: registryPath });
    assert.equal(flow.status, 'LIVE', `${asset} candidate should load from the local registry`);
    assert.equal(flow.assetSymbol, asset);
    assert.equal(flow.consensusMatrix?.candidates.length, 1);
    assert.equal(flow.largeTransfers?.[0]?.confirmationStatus, 'CONFIRMED');
    assert.equal(
      evaluateEightMemberCouncil({ whaleFlowData: flow, nowMs }).members[5].vote,
      'LONG',
      `${asset} cache evidence should reach Member 6's quorum evaluator`,
    );
  }

  const disabledAssetWrite = await writeQuorumCandidateSnapshot(
    { BTC: [], ETH: [], BNB: [], SOL: [], XRP: [] },
    {
      nowMs: nowMs + 1_000,
      filePath: registryPath,
      clearAssetCandidates: ['BNB', 'SOL', 'XRP'],
    },
  );
  assert.equal(disabledAssetWrite.persistedByAsset.BTC, 1);
  assert.equal(disabledAssetWrite.persistedByAsset.ETH, 1);
  assert.deepEqual(
    { BNB: disabledAssetWrite.persistedByAsset.BNB, SOL: disabledAssetWrite.persistedByAsset.SOL, XRP: disabledAssetWrite.persistedByAsset.XRP },
    { BNB: 0, SOL: 0, XRP: 0 },
    'disabled assets must not retain active vote candidates from an earlier snapshot',
  );
  assert.equal(
    (await loadQuorumCandidateFlow('BNB', { nowMs: nowMs + 1_000, filePath: registryPath })).status,
    'UNAVAILABLE',
  );

  assert.equal(
    (await loadQuorumCandidateFlow('ETH', { nowMs: nowMs + 6 * 60_000, filePath: registryPath })).status,
    'UNAVAILABLE',
    'stale registry snapshots must fail closed',
  );
  assert.equal(
    (await loadQuorumCandidateFlow('ETH', { nowMs, filePath: path.join(directory, 'missing.json') })).status,
    'UNAVAILABLE',
    'a missing registry must fail closed',
  );

  await writeQuorumCandidateSnapshot(
    { BTC: [], ETH: [], BNB: [], SOL: [], XRP: [] },
    { nowMs: nowMs + 6 * 60_000, filePath: registryPath },
  );
  const emptyFlow = await loadQuorumCandidateFlow('XRP', { nowMs: nowMs + 6 * 60_000, filePath: registryPath });
  assert.equal(emptyFlow.status, 'UNAVAILABLE', 'empty asset lists must fail closed');
  assert.match(emptyFlow.unavailableReason ?? '', /no fresh, confirmed candidate/i);

  const observedTimestampMs = nowMs + 6 * 60_000 - 1_000;
  const observedTransfer = {
    assetSymbol: 'BTC' as const,
    blockchain: 'bitcoin',
    transactionHash: 'b'.repeat(64),
    transferId: 'vout:4',
    timestampMs: observedTimestampMs,
    amount: 125,
    unit: 'BTC' as const,
    blockHeight: 900_001,
    sourceIds: ['mempool.space', 'blockstream'],
    confirmationStatus: 'CONFIRMED' as const,
  };
  await writeQuorumCandidateSnapshot(
    { BTC: [], ETH: [], BNB: [], SOL: [], XRP: [] },
    {
      nowMs: nowMs + 6 * 60_000,
      filePath: registryPath,
      observedTransfersByAsset: {
        BTC: [observedTransfer],
        ETH: [],
        BNB: [],
        SOL: [],
        XRP: [],
      },
    },
  );
  const observationSnapshot = JSON.parse(await readFile(registryPath, 'utf8')) as {
    observedTransfers: Record<QuorumAsset, unknown[]>;
  };
  assert.equal(observationSnapshot.observedTransfers.BTC.length, 1);
  assert.equal(
    (await loadQuorumCandidateFlow('BTC', { nowMs: nowMs + 6 * 60_000, filePath: registryPath })).status,
    'UNAVAILABLE',
    'independently verified raw transfers must not become directional voting candidates',
  );

  const historicalCandidates = Object.fromEntries(
    QUORUM_ASSETS.map((asset) => {
      const historicalCandidate = candidate(asset);
      historicalCandidate.timestampMs = nowMs - 24 * 60 * 60_000;
      historicalCandidate.observations = historicalCandidate.observations.map((observation) => ({
        ...observation,
        timestampMs: historicalCandidate.timestampMs,
      }));
      return [asset, [historicalCandidate]];
    }),
  ) as Record<QuorumAsset, QuorumCandidateRecord[]>;
  const historyWrite = await writeQuorumCandidateSnapshot(
    { BTC: [], ETH: [], BNB: [], SOL: [], XRP: [] },
    {
      nowMs: nowMs + 6 * 60_000,
      filePath: registryPath,
      historicalCandidatesByAsset: historicalCandidates,
    },
  );
  assert.equal(historyWrite.historicalByAsset.BTC, 1, 'historical candidates should be stored separately');
  const historyFlow = await loadQuorumCandidateFlow('BTC', { nowMs: nowMs + 6 * 60_000, filePath: registryPath });
  assert.equal(historyFlow.status, 'UNAVAILABLE', 'historical records must never be exposed as vote-eligible flow');
  assert.equal(evaluateEightMemberCouncil({ whaleFlowData: historyFlow, nowMs: nowMs + 6 * 60_000 }).members[5].vote, 'ABSTAIN');

  await writeFile(registryPath, '{"version":1,"assets":', 'utf8');
  assert.equal(
    (await loadQuorumCandidateFlow('BTC', { nowMs, filePath: registryPath })).status,
    'UNAVAILABLE',
    'malformed local data must fail closed',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Local multi-asset quorum candidate registry checks passed.');
