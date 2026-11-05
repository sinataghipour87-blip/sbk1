import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyMember6ShadowMode,
  evaluateEightMemberCouncil,
  member6ShadowModeEnabled,
} from '../src/services/eightMemberCouncil';
import {
  attributeExchangeTransfer,
  classifyExchangeTransfer,
  createAttributedQuorumCandidate,
  loadExchangeAddressRegistry,
  parseExchangeAddressFile,
  type ExchangeAddressRecord,
} from '../src/services/exchangeAddressRegistry';
import {
  loadQuorumCandidateFlow,
  QUORUM_ASSETS,
  writeQuorumCandidateSnapshot,
  type QuorumCandidateRecord,
  type QuorumObservedTransfer,
} from '../src/services/whaleConsensusCandidateRegistry';
import { trackUnknownWhaleAddresses } from '../src/services/whaleAddressTracker';

const nowMs = Date.now();
const exchangeAddress = '0x1111111111111111111111111111111111111111';
const externalAddress = '0x2222222222222222222222222222222222222222';
const otherExchangeAddress = '0x3333333333333333333333333333333333333333';

function addressRecord(
  address: string,
  exchange = 'Test Exchange',
  confidence: 'HIGH' | 'MEDIUM' = 'HIGH',
): ExchangeAddressRecord {
  return {
    chain: 'ETH',
    address: address.toLowerCase(),
    exchange,
    label: 'TEST_ONLY_SYNTHETIC_ADDRESS',
    sourceName: 'unit-test fixture',
    sourceUrl: 'https://example.invalid/test-fixture',
    retrievedAt: new Date(nowMs).toISOString(),
    confidence,
    note: 'Synthetic test-only address; never add to production data.',
  };
}

function transfer(overrides: Partial<QuorumObservedTransfer> = {}): QuorumObservedTransfer {
  return {
    assetSymbol: 'ETH',
    blockchain: 'ethereum',
    transactionHash: `0x${'a'.repeat(64)}`,
    transferId: 'native:0',
    timestampMs: nowMs - 1_000,
    amount: 400,
    unit: 'ETH',
    blockHeight: 20_000_000,
    sourceIds: ['ethereum-rpc-publicnode', 'ethereum-rpc-blockrazor'],
    confirmationStatus: 'CONFIRMED',
    fromAddresses: [externalAddress],
    toAddresses: [exchangeAddress],
    ...overrides,
  };
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-member6-attribution-'));
const verifiedAddresses = await loadExchangeAddressRegistry();
try {
  assert.deepEqual(new Set(verifiedAddresses.map(({ chain }) => chain)), new Set(['BTC', 'ETH', 'BNB', 'SOL', 'XRP']));
  const highConfidenceAddresses = [
    addressRecord(exchangeAddress),
    addressRecord(otherExchangeAddress, 'Other Test Exchange'),
  ];

  assert.equal(classifyExchangeTransfer(highConfidenceAddresses, {
    chain: 'ETH',
    fromAddresses: [externalAddress],
    toAddresses: [exchangeAddress],
  })?.direction, 'EXCHANGE_INFLOW');
  assert.equal(classifyExchangeTransfer(highConfidenceAddresses, {
    chain: 'ETH',
    fromAddresses: [exchangeAddress],
    toAddresses: [externalAddress],
  })?.direction, 'EXCHANGE_OUTFLOW');
  assert.equal(classifyExchangeTransfer(highConfidenceAddresses, {
    chain: 'ETH',
    fromAddresses: [exchangeAddress],
    toAddresses: [otherExchangeAddress],
  }).direction, 'UNKNOWN', 'exchange-to-exchange transfers are not attributed');
  assert.equal(classifyExchangeTransfer([
    addressRecord(exchangeAddress),
    addressRecord(otherExchangeAddress),
  ], {
    chain: 'ETH',
    fromAddresses: [exchangeAddress],
    toAddresses: [otherExchangeAddress],
  }).direction, 'UNKNOWN', 'transfers between two addresses of the same exchange are ignored');
  assert.equal(classifyExchangeTransfer(highConfidenceAddresses, {
    chain: 'ETH',
    fromAddresses: [externalAddress],
    toAddresses: [otherExchangeAddress],
  })?.direction, 'EXCHANGE_INFLOW');
  assert.equal(classifyExchangeTransfer([], {
    chain: 'ETH',
    fromAddresses: [externalAddress],
    toAddresses: [externalAddress],
  }).direction, 'UNKNOWN', 'transfers with no exchange attribution are ignored');
  assert.equal(classifyExchangeTransfer(highConfidenceAddresses, {
    chain: 'ETH',
    fromAddresses: [externalAddress],
    toAddresses: [externalAddress],
  }).direction, 'UNKNOWN', 'transfers with neither endpoint attributed are ignored');
  assert.equal(classifyExchangeTransfer([
    ...highConfidenceAddresses,
    addressRecord(exchangeAddress, 'Ambiguous Test Exchange'),
  ], {
    chain: 'ETH',
    fromAddresses: [externalAddress],
    toAddresses: [exchangeAddress],
  }).direction, 'UNKNOWN', 'ambiguous address ownership is rejected');
  assert.equal(classifyExchangeTransfer([
    addressRecord(exchangeAddress, 'Test Exchange', 'MEDIUM'),
  ], {
    chain: 'ETH',
    fromAddresses: [externalAddress],
    toAddresses: [exchangeAddress],
  }).direction, 'UNKNOWN', 'medium-confidence addresses cannot create voting attribution');
  assert.equal(classifyExchangeTransfer(highConfidenceAddresses, {
    chain: 'ETH',
    fromAddresses: [externalAddress, externalAddress],
    toAddresses: [exchangeAddress],
  }).direction, 'UNKNOWN', 'repeated address parties are rejected as ambiguous');

  const parsedVerifiedAddresses = parseExchangeAddressFile({ version: 1, addresses: verifiedAddresses }).addresses;
  assert.deepEqual(new Set(parsedVerifiedAddresses.map(({ chain }) => chain)), new Set(['BTC', 'ETH', 'BNB', 'SOL', 'XRP']));
  for (const knownAddress of parsedVerifiedAddresses) {
    const unknownParty = `unknown-${knownAddress.chain}`;
    assert.deepEqual(attributeExchangeTransfer(parsedVerifiedAddresses, {
      chain: knownAddress.chain,
      fromAddress: unknownParty,
      toAddress: knownAddress.address,
    }), { direction: 'INFLOW', exchange: knownAddress.exchange });
    assert.deepEqual(attributeExchangeTransfer(parsedVerifiedAddresses, {
      chain: knownAddress.chain,
      fromAddress: knownAddress.address,
      toAddress: unknownParty,
    }), { direction: 'OUTFLOW', exchange: knownAddress.exchange });
    assert.deepEqual(attributeExchangeTransfer(parsedVerifiedAddresses, {
      chain: knownAddress.chain,
      fromAddress: unknownParty,
      toAddress: `other-${knownAddress.chain}`,
    }), { direction: 'UNKNOWN', exchange: null });
    const inflow = classifyExchangeTransfer(parsedVerifiedAddresses, {
      chain: knownAddress.chain,
      fromAddresses: [unknownParty],
      toAddresses: [knownAddress.address],
    });
    assert.equal(inflow.direction, 'EXCHANGE_INFLOW', `${knownAddress.chain} recognized recipient should be an inflow`);
    assert.equal(inflow.exchange?.exchange, knownAddress.exchange);
    const outflow = classifyExchangeTransfer(parsedVerifiedAddresses, {
      chain: knownAddress.chain,
      fromAddresses: [knownAddress.address],
      toAddresses: [unknownParty],
    });
    assert.equal(outflow.direction, 'EXCHANGE_OUTFLOW', `${knownAddress.chain} recognized sender should be an outflow`);
    assert.equal(outflow.exchange?.exchange, knownAddress.exchange);
    assert.deepEqual(classifyExchangeTransfer(parsedVerifiedAddresses, {
      chain: knownAddress.chain,
      fromAddresses: [unknownParty],
      toAddresses: [`other-${knownAddress.chain}`],
    }), { direction: 'UNKNOWN', exchange: null });
  }

  const issues: string[] = [];
  const parsedDuplicates = parseExchangeAddressFile({
    version: 1,
    addresses: [
      addressRecord(exchangeAddress),
      addressRecord(exchangeAddress, 'Conflicting Test Exchange'),
    ],
  }, (message) => issues.push(message));
  assert.equal(parsedDuplicates.addresses.length, 0);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Ambiguous exchange address removed/);

  const malformedPath = path.join(directory, 'malformed.json');
  await writeFile(malformedPath, '{invalid json', 'utf8');
  const loadErrors: string[] = [];
  assert.deepEqual(await loadExchangeAddressRegistry({
    filePath: malformedPath,
    onIssue: (message) => loadErrors.push(message),
  }), []);
  assert.equal(loadErrors.length, 1);
  assert.deepEqual(await loadExchangeAddressRegistry({
    filePath: path.join(directory, 'missing.json'),
    onIssue: (message) => loadErrors.push(message),
  }), []);

  const binanceEthereum = parsedVerifiedAddresses.find(({ chain, exchange }) => chain === 'ETH' && exchange === 'Binance')!;
  const candidate = createAttributedQuorumCandidate(
    transfer({ toAddresses: [binanceEthereum.address] }),
    [binanceEthereum],
    { value: 30_000, sourceTimestampMs: nowMs, retrievedAtMs: nowMs },
    nowMs,
  );
  assert.ok(candidate);
  assert.equal(candidate.direction, 'EXCHANGE_INFLOW');
  assert.equal(candidate.estimatedUsd, 12_000_000);
  assert.equal(candidate.observations.filter(({ evidenceType }) => evidenceType === 'TRANSFER').length, 2);
  assert.equal(candidate.observations.filter(({ evidenceType }) => evidenceType === 'ATTRIBUTION').length, 1);
  assert.equal(createAttributedQuorumCandidate(
    transfer({ toAddresses: [externalAddress] }),
    highConfidenceAddresses,
    { value: 30_000, sourceTimestampMs: nowMs, retrievedAtMs: nowMs },
    nowMs,
  ), null, 'unmatched exchange address must not produce a candidate');
  assert.equal(createAttributedQuorumCandidate(
    transfer({ sourceIds: ['ethereum-rpc-publicnode'] }),
    highConfidenceAddresses,
    { value: 30_000, sourceTimestampMs: nowMs, retrievedAtMs: nowMs },
    nowMs,
  ), null, 'a single transfer operator must not produce a candidate');

  const whaleAddressPath = path.join(directory, 'whale-addresses.json');
  await writeFile(whaleAddressPath, JSON.stringify({
    version: 1,
    addresses: [],
    processed_transfer_ids: [],
  }), 'utf8');
  const unknownWhaleAddress = '0x4444444444444444444444444444444444444444';
  const whaleTransfers = [
    transfer({
      transactionHash: `0x${String(1).padStart(64, '0')}`,
      transferId: 'native:0',
      timestampMs: nowMs - 5_000,
      amount: 2,
      fromAddresses: [unknownWhaleAddress],
      toAddresses: [binanceEthereum.address],
    }),
    transfer({
      transactionHash: `0x${String(1).padStart(64, '0')}`,
      transferId: 'native:1',
      timestampMs: nowMs - 5_000,
      amount: 2,
      fromAddresses: [unknownWhaleAddress],
      toAddresses: [binanceEthereum.address],
    }),
    ...Array.from({ length: 4 }, (_, index) => transfer({
      transactionHash: `0x${String(index + 2).padStart(64, '0')}`,
      timestampMs: nowMs - (4 - index) * 1_000,
      amount: 4,
      fromAddresses: [unknownWhaleAddress],
      toAddresses: [binanceEthereum.address],
    })),
  ];
  const emptyObservedTransfers = { BTC: [], ETH: [], BNB: [], SOL: [], XRP: [] } as const;
  const whaleObservedTransfers = {
    ...emptyObservedTransfers,
    ETH: whaleTransfers,
  };
  const trackingResult = await trackUnknownWhaleAddresses({
    observedTransfers: whaleObservedTransfers,
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: { ETH: 50_000 },
    nowMs,
    filePath: whaleAddressPath,
  });
  assert.equal(trackingResult.newEvents, 5);
  assert.equal(trackingResult.flaggedWhales, 1);
  const trackedRegistry = JSON.parse(await readFile(whaleAddressPath, 'utf8')) as {
    addresses: Array<{ address: string; chain: string; tx_count: number; total_volume_usd: number; is_whale: boolean }>;
  };
  assert.deepEqual(trackedRegistry.addresses, [{
    address: unknownWhaleAddress,
    chain: 'ETH',
    first_seen: new Date(nowMs - 5_000).toISOString(),
    last_seen: new Date(nowMs - 1_000).toISOString(),
    tx_count: 5,
    total_volume_usd: 1_000_000,
    is_whale: true,
  }]);
  const duplicateTrackingResult = await trackUnknownWhaleAddresses({
    observedTransfers: whaleObservedTransfers,
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: { ETH: 50_000 },
    nowMs,
    filePath: whaleAddressPath,
  });
  assert.equal(duplicateTrackingResult.newEvents, 0, 're-polling the same transfers must not inflate whale volume');

  const registryPath = path.join(directory, 'quorum-candidates.json');
  const candidates = Object.fromEntries(QUORUM_ASSETS.map((asset) =>
    [asset, asset === 'ETH' ? [candidate] : []])) as Record<
      typeof QUORUM_ASSETS[number],
      QuorumCandidateRecord[]
    >;
  await writeQuorumCandidateSnapshot(candidates, {
    nowMs,
    filePath: registryPath,
    observedTransfersByAsset: {
      BTC: [],
      ETH: [transfer()],
      BNB: [],
      SOL: [],
      XRP: [],
    },
  });
  const flow = await loadQuorumCandidateFlow('ETH', { nowMs, filePath: registryPath });
  assert.equal(flow.status, 'LIVE');
  const actualReport = evaluateEightMemberCouncil({ whaleFlowData: flow, nowMs });
  assert.equal(actualReport.members[5].vote, 'SHORT');
  const shadowReport = applyMember6ShadowMode(actualReport);
  assert.equal(shadowReport.members[5].vote, 'ABSTAIN');
  assert.equal(shadowReport.abstentions, actualReport.abstentions + 1);
  assert.equal(shadowReport.selectedDirection, null);

  const originalShadowSetting = process.env.SBK1_MEMBER6_SHADOW_MODE;
  process.env.SBK1_MEMBER6_SHADOW_MODE = 'true';
  assert.equal(member6ShadowModeEnabled(), true);
  process.env.SBK1_MEMBER6_SHADOW_MODE = 'false';
  assert.equal(member6ShadowModeEnabled(), false);
  if (originalShadowSetting === undefined) delete process.env.SBK1_MEMBER6_SHADOW_MODE;
  else process.env.SBK1_MEMBER6_SHADOW_MODE = originalShadowSetting;

  assert.equal(
    evaluateEightMemberCouncil({ nowMs }).members[5].vote,
    'ABSTAIN',
    'missing verified flow remains fail-closed',
  );
  console.info('Member 6 exchange attribution, quorum, fail-closed, and shadow checks passed.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
