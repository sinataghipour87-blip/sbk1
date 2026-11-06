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
  EXCHANGE_ADDRESS_MAX_AGE_MS,
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
import {
  getWhaleBehavior,
  ingestWalletHistory,
  readWalletProfileSnapshot,
  trackObservedWalletProfiles,
  type WalletHistoryActivity,
} from '../src/services/whaleAddressTracker';

const nowMs = Date.now();
const exchangeAddress = '0x1111111111111111111111111111111111111111';
const externalAddress = '0x2222222222222222222222222222222222222222';
const otherExchangeAddress = '0x3333333333333333333333333333333333333333';
const addressChains = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'] as const;

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
  for (const chain of addressChains) {
    const assetFile = path.resolve(process.cwd(), 'data', 'whale-addresses', `${chain}.json`);
    const assetRegistry = JSON.parse(await readFile(assetFile, 'utf8')) as {
      version: number;
      addresses: ExchangeAddressRecord[];
    };
    assert.equal(assetRegistry.version, 1, `${chain} address file version`);
    assert.ok(assetRegistry.addresses.every((record) => record.chain === chain),
      `${chain} address file must contain only ${chain} records`);
    const parsedAssetAddresses = parseExchangeAddressFile(assetRegistry).addresses;
    assert.deepEqual(
      verifiedAddresses.filter((record) => record.chain === chain),
      parsedAssetAddresses,
      `${chain} address file must be included in the default registry`,
    );
  }
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
  const freshRecord = addressRecord(exchangeAddress);
  assert.throws(() => parseExchangeAddressFile({
    version: 1,
    addresses: [{ ...freshRecord, retrievedAt: new Date(nowMs - EXCHANGE_ADDRESS_MAX_AGE_MS - 1).toISOString() }],
  }, undefined, nowMs), /invalid address record/i, 'expired address labels are rejected');
  assert.throws(() => parseExchangeAddressFile({
    version: 1,
    addresses: [{ ...freshRecord, retrievedAt: new Date(nowMs + 1).toISOString() }],
  }, undefined, nowMs), /invalid address record/i, 'future-dated address labels are rejected');
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
  const profiledCandidate: QuorumCandidateRecord = {
    ...candidate,
    senderAddress: externalAddress,
    receiverAddress: binanceEthereum.address,
    senderIsExchange: false,
    receiverIsExchange: true,
    senderProfile: {
      isWhale: true,
      behaviorTag: 'ACCUMULATOR',
      confidenceScore: 0.9,
    },
    receiverProfile: {
      isWhale: false,
      behaviorTag: 'UNKNOWN',
      confidenceScore: 0,
    },
  };
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
      amount: 200,
      fromAddresses: [unknownWhaleAddress],
      toAddresses: [binanceEthereum.address],
    }),
    transfer({
      transactionHash: `0x${String(1).padStart(64, '0')}`,
      transferId: 'native:1',
      timestampMs: nowMs - 5_000,
      amount: 200,
      fromAddresses: [unknownWhaleAddress],
      toAddresses: [binanceEthereum.address],
    }),
    ...Array.from({ length: 4 }, (_, index) => transfer({
      transactionHash: `0x${String(index + 2).padStart(64, '0')}`,
      timestampMs: nowMs - (4 - index) * 1_000,
      amount: 400,
      fromAddresses: [unknownWhaleAddress],
      toAddresses: [binanceEthereum.address],
    })),
  ];
  const emptyObservedTransfers = { BTC: [], ETH: [], BNB: [], SOL: [], XRP: [] } as const;
  const whaleObservedTransfers = {
    ...emptyObservedTransfers,
    ETH: whaleTransfers,
  };
  const trackingResult = await trackObservedWalletProfiles({
    observedTransfers: whaleObservedTransfers,
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: { ETH: 50_000 },
    nowMs,
    filePath: whaleAddressPath,
  });
  assert.equal(trackingResult.newEvents, 12, 'both sender and recipient wallets are profiled for each observed transfer');
  assert.equal(trackingResult.flaggedWhales, 0,
    'fewer than 15 large transactions must not be classified as an analysis-qualified whale');
  const trackedRegistry = JSON.parse(await readFile(whaleAddressPath, 'utf8')) as {
    addresses: Array<{
      address: string;
      chain: string;
      analysis_activity_count: number;
      analysis_eligible: boolean;
      tx_count: number;
      total_volume_usd: number;
      is_whale: boolean;
      known_exchange_address: boolean;
      behavior_label: string;
      trading_behavior: string;
      behavior_score: number;
      exchange_names: string[];
      window_90d: {
        transfer_count: number;
        transaction_count: number;
        native_volume: number;
        exchange_interaction_count: number;
      };
    }>;
  };
  assert.equal(trackedRegistry.addresses.length, 2, 'known exchange wallets must not be excluded from profiling');
  const unknownWalletProfile = trackedRegistry.addresses.find(({ address }) => address === unknownWhaleAddress)!;
  assert.equal(unknownWalletProfile.tx_count, 5);
  assert.equal(unknownWalletProfile.total_volume_usd, 100_000_000);
  assert.equal(unknownWalletProfile.is_whale, false);
  assert.equal(unknownWalletProfile.behavior_label, 'EXCHANGE_FLOW');
  assert.equal(unknownWalletProfile.trading_behavior, 'UNOBSERVED',
    'native transfer evidence must not be misrepresented as proof of trading');
  assert.ok(unknownWalletProfile.behavior_score > 0 && unknownWalletProfile.behavior_score <= 100);
  assert.equal(unknownWalletProfile.window_90d.transfer_count, 6);
  assert.equal(unknownWalletProfile.window_90d.transaction_count, 5);
  assert.equal(unknownWalletProfile.window_90d.native_volume, 2_000);
  assert.equal(unknownWalletProfile.window_90d.exchange_interaction_count, 6);
  assert.equal(unknownWalletProfile.analysis_activity_count, 5);
  assert.equal(unknownWalletProfile.analysis_eligible, false);
  const exchangeWalletProfile = trackedRegistry.addresses.find(({ address }) =>
    address === binanceEthereum.address)!;
  assert.equal(exchangeWalletProfile.known_exchange_address, true);
  assert.equal(exchangeWalletProfile.behavior_label, 'EXCHANGE_FLOW');
  assert.deepEqual(exchangeWalletProfile.exchange_names, ['Binance']);
  const profilePage = await readWalletProfileSnapshot({ filePath: whaleAddressPath, limit: 1 });
  assert.equal(profilePage.totalWallets, 2);
  assert.equal(profilePage.wallets.length, 1);
  assert.equal(profilePage.updatedAtMs, nowMs);
  await assert.rejects(
    readWalletProfileSnapshot({ filePath: whaleAddressPath, limit: 101 }),
    /pagination settings are invalid/,
  );
  const unlabeledStorePath = path.join(directory, 'unlabeled-wallet-profiles.json');
  await writeFile(unlabeledStorePath, JSON.stringify({
    version: 1,
    addresses: [],
    processed_transfer_ids: [],
  }), 'utf8');
  const unlabeledFrom = '0x5555555555555555555555555555555555555555';
  const unlabeledTo = '0x6666666666666666666666666666666666666666';
  const unlabeledTransfer = transfer({
    transactionHash: `0x${String(10).padStart(64, '0')}`,
    fromAddresses: [unlabeledFrom],
    toAddresses: [unlabeledTo],
  });
  const unlabeledTracking = await trackObservedWalletProfiles({
    observedTransfers: { ...emptyObservedTransfers, ETH: [unlabeledTransfer] },
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: {},
    nowMs,
    filePath: unlabeledStorePath,
  });
  assert.equal(unlabeledTracking.trackedAddresses, 2,
    'sender and recipient must be captured even without labels or a USD price');
  const unlabeledRegistry = JSON.parse(await readFile(unlabeledStorePath, 'utf8')) as {
    addresses: Array<{ address: string; known_exchange_address: boolean; window_90d: { estimated_volume_usd: number } }>;
  };
  assert.ok(unlabeledRegistry.addresses.every(({ known_exchange_address, window_90d }) =>
    !known_exchange_address && window_90d.estimated_volume_usd === 0));
  const historicalActivities: WalletHistoryActivity[] = Array.from({ length: 14 }, (_, index) => ({
    address: unlabeledFrom,
    chain: 'ETH' as const,
    transactionHash: `0x${String(index + 200).padStart(64, '0')}`,
    transferId: `token:0x${'a'.repeat(40)}:${index}`,
    timestampMs: nowMs - 20_000 + index,
    role: 'OUTGOING' as const,
    activityType: 'TOKEN_TRANSFER' as const,
    tokenAmount: index + 1,
    tokenSymbol: 'TEST',
    tokenAddress: `0x${'a'.repeat(40)}`,
    counterpartyAddresses: [unlabeledTo],
  }));
  historicalActivities.push({
    address: unlabeledFrom,
    chain: 'ETH',
    transactionHash: `0x${String(200).padStart(64, '0')}`,
    transferId: 'history:swap-pattern',
    timestampMs: nowMs - 20_000,
    role: 'PARTICIPANT',
    activityType: 'SWAP_PATTERN',
    counterpartyAddresses: [unlabeledTo],
  });
  historicalActivities.push({
    address: unlabeledFrom,
    chain: 'ETH',
    transactionHash: unlabeledTransfer.transactionHash,
    transferId: 'native:0',
    timestampMs: unlabeledTransfer.timestampMs,
    role: 'OUTGOING',
    activityType: 'NATIVE_TRANSFER',
    amountNative: unlabeledTransfer.amount,
    counterpartyAddresses: [unlabeledTo],
  });
  const largeHistoricalActivities: WalletHistoryActivity[] = Array.from({ length: 14 }, (_, index) => ({
    address: unlabeledFrom,
    chain: 'ETH',
    transactionHash: `0x${String(index + 300).padStart(64, '0')}`,
    transferId: 'native:0',
    timestampMs: nowMs - 19_000 + index,
    role: 'OUTGOING',
    activityType: 'NATIVE_TRANSFER',
    amountNative: 200,
    estimatedVolumeUsd: 400_000,
    counterpartyAddresses: [unlabeledTo],
  }));
  const tokenOnlyEligibility = await ingestWalletHistory({
    activities: historicalActivities,
    syncResults: [],
    nowMs,
    filePath: unlabeledStorePath,
  });
  assert.equal(tokenOnlyEligibility.newEvents, 15);
  const tokenOnlyProfile = (await readWalletProfileSnapshot({ filePath: unlabeledStorePath }))
    .wallets.find(({ address }) => address === unlabeledFrom)!;
  assert.equal(tokenOnlyProfile.analysis_activity_count, 1,
    'small token transfers and swap markers must not count toward whale eligibility');
  assert.equal(tokenOnlyProfile.analysis_eligible, false);
  const historyIngest = await ingestWalletHistory({
    activities: largeHistoricalActivities,
    syncResults: [{
      address: unlabeledFrom,
      chain: 'ETH',
      status: 'COMPLETE',
      source: 'Blockscout (Ethereum)',
      coverageFromMs: nowMs - 90 * 24 * 60 * 60_000,
    }],
    nowMs,
    filePath: unlabeledStorePath,
  });
  assert.equal(historyIngest.newEvents, 14);
  const historiedWallet = (await readWalletProfileSnapshot({ filePath: unlabeledStorePath }))
    .wallets.find(({ address }) => address === unlabeledFrom)!;
  assert.equal(historiedWallet.analysis_activity_count, 15);
  assert.equal(historiedWallet.analysis_eligible, true,
    'historical distinct transactions count toward behavior-analysis eligibility');
  assert.equal(historiedWallet.window_90d.token_transfer_count, 14);
  assert.equal(historiedWallet.window_90d.swap_pattern_count, 1);
  assert.equal(historiedWallet.window_90d.large_transaction_count, 15);
  assert.equal(historiedWallet.window_90d.large_activity_count, 15);
  assert.equal(historiedWallet.window_90d.large_native_volume, unlabeledTransfer.amount + 14 * 200,
    'historical source overlap must not double-count native transfers already observed by the live scanner');
  assert.equal(historiedWallet.trading_behavior, 'UNOBSERVED',
    'a small-token swap pattern must not classify large-wallet trading behavior');
  assert.equal(historiedWallet.history_sync_status, 'COMPLETE');
  assert.equal(historiedWallet.history_source, 'Blockscout (Ethereum)');
  assert.equal(historiedWallet.recent_activity.length, 10,
    'profile snapshot exposes a bounded recent activity timeline');
  assert.ok(historiedWallet.recent_activity.some(({ large_activity }) => large_activity),
    'the activity timeline distinguishes qualifying large activity');
  const smallTransferPath = path.join(directory, 'small-transfers-not-discovered.json');
  await writeFile(smallTransferPath, JSON.stringify({
    version: 1,
    addresses: [],
    processed_transfer_ids: [],
  }), 'utf8');
  const smallTransferResult = await trackObservedWalletProfiles({
    observedTransfers: {
      ...emptyObservedTransfers,
      ETH: [transfer({ amount: 99, fromAddresses: [unlabeledFrom], toAddresses: [unlabeledTo] })],
    },
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: { ETH: 50_000 },
    nowMs,
    filePath: smallTransferPath,
  });
  assert.equal(smallTransferResult.trackedAddresses, 0,
    'below-threshold transfers do not create or score whale profiles');
  const duplicateTrackingResult = await trackObservedWalletProfiles({
    observedTransfers: whaleObservedTransfers,
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: { ETH: 50_000 },
    nowMs,
    filePath: whaleAddressPath,
  });
  assert.equal(duplicateTrackingResult.newEvents, 0, 're-polling the same transfers must not inflate whale volume');
  const expiredWindowResult = await trackObservedWalletProfiles({
    observedTransfers: emptyObservedTransfers,
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: {},
    nowMs: nowMs + 91 * 24 * 60 * 60_000,
    filePath: whaleAddressPath,
  });
  assert.equal(expiredWindowResult.flaggedWhales, 0, 'events older than 90 days must leave the rolling behavior profile');
  const expiredRegistry = JSON.parse(await readFile(whaleAddressPath, 'utf8')) as {
    addresses: unknown[];
    activity_events: unknown[];
  };
  assert.equal(expiredRegistry.activity_events.length, 0, 'raw wallet activity is retained for at most 90 days');
  assert.equal(expiredRegistry.addresses.length, 0,
    'profiles below the 15-transaction analysis threshold must be deleted after 90 days');

  const lifecyclePath = path.join(directory, 'wallet-lifecycle.sqlite');
  const lifecycleAddress = '0x7777777777777777777777777777777777777777';
  const qualifyingTransfers = Array.from({ length: 15 }, (_, index) => transfer({
    transactionHash: `0x${String(index + 100).padStart(64, '0')}`,
    transferId: 'native:0',
    fromAddresses: [lifecycleAddress],
    toAddresses: [externalAddress],
  }));
  await trackObservedWalletProfiles({
    observedTransfers: { ...emptyObservedTransfers, ETH: qualifyingTransfers },
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: {},
    nowMs,
    filePath: lifecyclePath,
  });
  const eligibleSnapshot = await readWalletProfileSnapshot({ filePath: lifecyclePath });
  const eligibleProfile = eligibleSnapshot.wallets.find(({ address }) => address === lifecycleAddress)!;
  assert.equal(eligibleProfile.analysis_activity_count, 15);
  assert.equal(eligibleProfile.analysis_eligible, true,
    '15 distinct confirmed transactions within the discovery period enable behavior analysis');
  const exposedBehavior = getWhaleBehavior(lifecycleAddress, 'ETH', lifecyclePath);
  assert.equal(exposedBehavior.isWhale, true,
    'read-only SQLite lookup exposes profiles that meet whale analysis eligibility');
  assert.equal(exposedBehavior.behaviorTag, 'DISTRIBUTOR',
    'profile lookup summarizes predominantly outgoing wallet behavior');
  assert.ok(exposedBehavior.confidenceScore >= 0 && exposedBehavior.confidenceScore <= 1);
  await trackObservedWalletProfiles({
    observedTransfers: emptyObservedTransfers,
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: {},
    nowMs: nowMs + 179 * 24 * 60 * 60_000,
    filePath: lifecyclePath,
  });
  const inactiveSnapshot = await readWalletProfileSnapshot({ filePath: lifecyclePath });
  assert.equal(inactiveSnapshot.totalWallets, 2,
    'analysis-eligible profiles remain stored while inactive');
  assert.ok(inactiveSnapshot.wallets.every(({ activity_status }) => activity_status === 'INACTIVE'),
    '90 days without a large transfer marks profiles inactive without deleting them');
  await trackObservedWalletProfiles({
    observedTransfers: emptyObservedTransfers,
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: {},
    nowMs: nowMs + 364 * 24 * 60 * 60_000,
    filePath: lifecyclePath,
  });
  assert.equal((await readWalletProfileSnapshot({ filePath: lifecyclePath })).totalWallets, 2,
    'analysis-eligible profiles remain until one full year without a large transfer');
  await trackObservedWalletProfiles({
    observedTransfers: emptyObservedTransfers,
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: {},
    nowMs: nowMs + 365 * 24 * 60 * 60_000,
    filePath: lifecyclePath,
  });
  assert.equal((await readWalletProfileSnapshot({ filePath: lifecyclePath })).totalWallets, 0,
    'analysis-eligible profiles are deleted after one year without a large transfer');

  const sharedAddressPath = path.join(directory, 'shared-asset-wallet-profiles.json');
  await writeFile(sharedAddressPath, JSON.stringify({
    version: 1,
    addresses: [],
    processed_transfer_ids: [],
  }), 'utf8');
  const sharedEvmAddress = '0x8888888888888888888888888888888888888888';
  await trackObservedWalletProfiles({
    observedTransfers: {
      ...emptyObservedTransfers,
      ETH: [transfer({
        amount: 150,
        fromAddresses: [sharedEvmAddress],
        toAddresses: [externalAddress],
      })],
    },
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: {},
    nowMs,
    filePath: sharedAddressPath,
  });
  await trackObservedWalletProfiles({
    observedTransfers: {
      ...emptyObservedTransfers,
      BNB: [transfer({
        assetSymbol: 'BNB',
        blockchain: 'binance-smart-chain',
        amount: 1_000,
        unit: 'BNB',
        fromAddresses: [sharedEvmAddress],
        toAddresses: [externalAddress],
      })],
    },
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: {},
    nowMs,
    filePath: sharedAddressPath,
  });
  const sharedAddressProfiles = (await readWalletProfileSnapshot({ filePath: sharedAddressPath }))
    .wallets.filter(({ address }) => address === sharedEvmAddress);
  assert.equal(sharedAddressProfiles.length, 2,
    'the same EVM address remains a separate profile on each chain');
  assert.deepEqual(new Set(sharedAddressProfiles[0].related_assets), new Set(['ETH', 'BNB']),
    'matching ETH/BNB addresses are grouped as a possible cross-chain address, not merged');

  const sqliteMigrationJsonPath = path.join(directory, 'wallet-profiles-to-migrate.json');
  const sqliteMigrationPath = path.join(directory, 'wallet-profiles-to-migrate.sqlite');
  const migrationAddress = '0x9999999999999999999999999999999999999999';
  await trackObservedWalletProfiles({
    observedTransfers: {
      ...emptyObservedTransfers,
      ETH: [transfer({
        fromAddresses: [migrationAddress],
        toAddresses: [externalAddress],
      })],
    },
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: {},
    nowMs,
    filePath: sqliteMigrationJsonPath,
  });
  const migratedWalletSnapshot = await readWalletProfileSnapshot({
    filePath: sqliteMigrationPath,
  });
  assert.equal(migratedWalletSnapshot.totalWallets, 2,
    'legacy JSON profile data is migrated to the SQLite store on first access');
  await trackObservedWalletProfiles({
    observedTransfers: {
      ...emptyObservedTransfers,
      ETH: [transfer({
        transactionHash: `0x${'b'.repeat(64)}`,
        fromAddresses: [migrationAddress],
        toAddresses: [externalAddress],
      })],
    },
    exchangeAddresses: parsedVerifiedAddresses,
    pricesUsd: {},
    nowMs: nowMs + 1_000,
    filePath: sqliteMigrationPath,
  });
  assert.equal((await readWalletProfileSnapshot({ filePath: sqliteMigrationPath })).totalWallets, 2,
    'subsequent activity persists and reloads through SQLite');

  const registryPath = path.join(directory, 'quorum-candidates.json');
  const candidates = Object.fromEntries(QUORUM_ASSETS.map((asset) =>
    [asset, asset === 'ETH' ? [profiledCandidate] : []])) as Record<
      typeof QUORUM_ASSETS[number],
      QuorumCandidateRecord[]
    >;
  const feeSources = {
    BTC: 'mempool.space,blockstream',
    ETH: 'ethereum-rpc-publicnode,ethereum-rpc-blockrazor',
    BNB: 'bsc-rpc-publicnode,bsc-rpc-blockrazor',
    SOL: 'solana-rpc-solana-foundation,solana-rpc-publicnode',
    XRP: 'xrp-rpc-xrplcluster,xrp-rpc-honeycluster',
  } as const;
  const feeMetrics = {
    BTC: { fee_metric: 'mempool_median_fee_rate', fee_unit: 'sat_vbyte' },
    ETH: { fee_metric: 'priority_fee_gwei', fee_unit: 'gwei' },
    BNB: { fee_metric: 'priority_fee_gwei', fee_unit: 'gwei' },
    SOL: {
      fee_metric: 'prioritization_fee_micro_lamports',
      fee_unit: 'micro_lamports_per_compute_unit',
    },
    XRP: { fee_metric: 'validated_base_fee_xrp', fee_unit: 'XRP' },
  } as const;
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
    networkMetricsByAsset: {
      BTC: {
        ...feeMetrics.BTC,
        fee_status: 'QUORUM',
        fee_value: 1,
        fee_operator_count: 2,
        fee_source_ids: feeSources.BTC,
        fee_observed_at_ms: nowMs,
      },
      ETH: {
        ...feeMetrics.ETH,
        fee_status: 'QUORUM',
        fee_value: 1,
        fee_operator_count: 2,
        fee_source_ids: feeSources.ETH,
        fee_observed_at_ms: nowMs,
      },
      BNB: {
        ...feeMetrics.BNB,
        fee_status: 'QUORUM',
        fee_value: 1,
        fee_operator_count: 2,
        fee_source_ids: feeSources.BNB,
        fee_observed_at_ms: nowMs,
      },
      SOL: {
        ...feeMetrics.SOL,
        fee_status: 'QUORUM',
        fee_value: 1,
        fee_operator_count: 2,
        fee_source_ids: feeSources.SOL,
        fee_observed_at_ms: nowMs,
      },
      XRP: {
        ...feeMetrics.XRP,
        fee_status: 'QUORUM',
        fee_value: 1,
        fee_operator_count: 2,
        fee_source_ids: feeSources.XRP,
        fee_observed_at_ms: nowMs,
      },
    },
  });
  const flow = await loadQuorumCandidateFlow('ETH', { nowMs, filePath: registryPath });
  assert.equal(flow.status, 'LIVE');
  const actualReport = evaluateEightMemberCouncil({ whaleFlowData: flow, nowMs });
  assert.equal(actualReport.members[5].vote, 'SHORT');
  const channelOneCandidate = flow.consensusMatrix!.candidates[0];
  const channelOneTransfer = flow.largeTransfers![0];
  const evaluateChannelOneVariant = (
    candidateOverrides: Partial<QuorumCandidateRecord>,
    transferOverrides: Partial<typeof channelOneTransfer> = {},
  ) => {
    const observations = channelOneCandidate.observations.map((observation) =>
      observation.evidenceType === 'ATTRIBUTION' && candidateOverrides.direction
        ? { ...observation, direction: candidateOverrides.direction }
        : observation);
    return evaluateEightMemberCouncil({
      whaleFlowData: {
        ...flow,
        consensusMatrix: {
          candidates: [{
            ...channelOneCandidate,
            ...candidateOverrides,
            observations,
          }],
        },
        largeTransfers: [{
          ...channelOneTransfer,
          ...candidateOverrides,
          ...transferOverrides,
        }],
      },
      nowMs,
    }).members[5].vote;
  };
  assert.equal(evaluateChannelOneVariant({
    senderProfile: { isWhale: false, behaviorTag: 'UNKNOWN', confidenceScore: 0 },
  }), 'ABSTAIN', 'unknown sender to exchange is rejected by Channel 1');
  assert.equal(evaluateChannelOneVariant({
    senderIsExchange: true,
    receiverIsExchange: true,
  }), 'ABSTAIN', 'exchange-to-exchange activity is rejected by Channel 1');
  assert.equal(evaluateChannelOneVariant({
    direction: 'EXCHANGE_OUTFLOW',
    senderAddress: binanceEthereum.address,
    receiverAddress: externalAddress,
    senderIsExchange: true,
    receiverIsExchange: false,
    senderProfile: { isWhale: false, behaviorTag: 'UNKNOWN', confidenceScore: 0 },
    receiverProfile: { isWhale: true, behaviorTag: 'ACCUMULATOR', confidenceScore: 0.9 },
  }), 'LONG', 'exchange to accumulator whale votes LONG');
  const reducedThresholdCandidate: QuorumCandidateRecord = {
    ...profiledCandidate,
    amount: 100,
    estimatedUsd: 3_000_000,
    observations: profiledCandidate.observations.map((observation) => ({
      ...observation,
      amount: 100,
    })),
  };
  const reducedThresholdFlow = {
    ...flow,
    consensusMatrix: { candidates: [{
      ...channelOneCandidate,
      amount: 100,
      estimatedUsd: 3_000_000,
      observations: reducedThresholdCandidate.observations,
    }] },
    largeTransfers: [{
      ...channelOneTransfer,
      amount: 100,
      estimatedUsd: 3_000_000,
    }],
  };
  assert.equal(evaluateEightMemberCouncil({
    whaleFlowData: reducedThresholdFlow,
    nowMs,
  }).members[5].vote, 'SHORT',
  'high-confidence accumulator activity lowers the Channel 1 volume and net-flow thresholds');
  const lowConfidenceFlow = {
    ...reducedThresholdFlow,
    consensusMatrix: { candidates: [{
      ...reducedThresholdFlow.consensusMatrix.candidates[0],
      senderProfile: { ...profiledCandidate.senderProfile!, confidenceScore: 0.8 },
    }] },
    largeTransfers: [{
      ...reducedThresholdFlow.largeTransfers[0],
      senderProfile: { ...profiledCandidate.senderProfile!, confidenceScore: 0.8 },
    }],
  };
  assert.equal(evaluateEightMemberCouncil({
    whaleFlowData: lowConfidenceFlow,
    nowMs,
  }).members[5].vote, 'ABSTAIN',
  'confidence must be strictly greater than 0.8 to receive reduced thresholds');
  assert.equal(
    evaluateEightMemberCouncil({
      whaleFlowData: { ...flow, networkMetrics: undefined },
      nowMs,
    }).members[5].vote,
    'SHORT',
    'the configured-address channel must not depend on fee telemetry',
  );

  const macroOutflowCandidate = createAttributedQuorumCandidate(
    transfer({
      fromAddresses: [binanceEthereum.address],
      toAddresses: [externalAddress],
    }),
    [binanceEthereum],
    { value: 30_000, sourceTimestampMs: nowMs, retrievedAtMs: nowMs },
    nowMs,
  );
  assert.ok(macroOutflowCandidate);
  const macroOutflow = {
    blockchain: macroOutflowCandidate.blockchain,
    transactionHash: macroOutflowCandidate.transactionHash,
    transferId: macroOutflowCandidate.transferId,
    timestampMs: macroOutflowCandidate.timestampMs,
    direction: macroOutflowCandidate.direction,
    amount: macroOutflowCandidate.amount,
    estimatedUsd: macroOutflowCandidate.estimatedUsd,
    exchangeName: binanceEthereum.exchange,
    exchangeAddress: binanceEthereum.address,
    attributionSourceId: 'local-exchange-address-list',
    sourceIds: [...new Set(macroOutflowCandidate.observations
      .filter(({ evidenceType }) => evidenceType === 'TRANSFER')
      .map(({ sourceId }) => sourceId))],
  } as const;
  const macroRegistryPath = path.join(directory, 'macro-only-candidates.json');
  const macroFeeMetrics = {
    fee_status: 'QUORUM',
    fee_metric: 'priority_fee_gwei',
    fee_value: 1,
    fee_unit: 'gwei',
    fee_operator_count: 2,
    fee_source_ids: feeSources.ETH,
    fee_observed_at_ms: nowMs,
    fee_spike_status: 'SPIKE',
    fee_spike_ratio: 2,
    fee_baseline_value: 0.5,
    fee_baseline_source_ids: feeSources.ETH,
    fee_baseline_operator_count: 2,
    fee_baseline_sample_count: 10,
    fee_baseline_span_ms: 10 * 60_000,
  } as const;
  await writeQuorumCandidateSnapshot(
    Object.fromEntries(QUORUM_ASSETS.map((asset) => [asset, []])) as Record<
      typeof QUORUM_ASSETS[number],
      QuorumCandidateRecord[]
    >,
    {
      nowMs,
      filePath: macroRegistryPath,
      aggregateExchangeFlowsByAsset: {
        BTC: [],
        ETH: [macroOutflow],
        BNB: [],
        SOL: [],
        XRP: [],
      },
      networkMetricsByAsset: {
        BTC: {},
        ETH: macroFeeMetrics,
        BNB: {},
        SOL: {},
        XRP: {},
      },
    },
  );
  const macroOnlyFlow = await loadQuorumCandidateFlow('ETH', {
    nowMs,
    filePath: macroRegistryPath,
  });
  assert.equal(macroOnlyFlow.status, 'LIVE',
    'verified aggregate flow must be loadable without a watchlist candidate');
  assert.equal(macroOnlyFlow.consensusMatrix?.candidates.length, 0);
  assert.equal(
    evaluateEightMemberCouncil({ whaleFlowData: macroOnlyFlow, nowMs }).members[5].vote,
    'LONG',
    'aggregate exchange flow plus a validated fee spike must vote independently',
  );

  const conflictingMacroRegistryPath = path.join(directory, 'conflicting-macro-only-candidates.json');
  await writeQuorumCandidateSnapshot(
    Object.fromEntries(QUORUM_ASSETS.map((asset) => [asset, []])) as Record<
      typeof QUORUM_ASSETS[number],
      QuorumCandidateRecord[]
    >,
    {
      nowMs,
      filePath: conflictingMacroRegistryPath,
      aggregateExchangeFlowsByAsset: {
        BTC: [],
        ETH: [macroOutflow, { ...macroOutflow, direction: 'EXCHANGE_INFLOW' as const }],
        BNB: [],
        SOL: [],
        XRP: [],
      },
      networkMetricsByAsset: {
        BTC: {},
        ETH: macroFeeMetrics,
        BNB: {},
        SOL: {},
        XRP: {},
      },
    },
  );
  const conflictingMacroFlow = await loadQuorumCandidateFlow('ETH', {
    nowMs,
    filePath: conflictingMacroRegistryPath,
  });
  assert.equal(
    evaluateEightMemberCouncil({ whaleFlowData: conflictingMacroFlow, nowMs }).members[5].vote,
    'ABSTAIN',
    'contradictory duplicate macro evidence must not be silently deduplicated into a vote',
  );

  const conflictingRegistryPath = path.join(directory, 'conflicting-candidates.json');
  await writeQuorumCandidateSnapshot(candidates, {
    nowMs,
    filePath: conflictingRegistryPath,
    observedTransfersByAsset: {
      BTC: [],
      ETH: [transfer()],
      BNB: [],
      SOL: [],
      XRP: [],
    },
    aggregateExchangeFlowsByAsset: {
      BTC: [],
      ETH: [macroOutflow],
      BNB: [],
      SOL: [],
      XRP: [],
    },
    networkMetricsByAsset: {
      BTC: {},
      ETH: macroFeeMetrics,
      BNB: {},
      SOL: {},
      XRP: {},
    },
  });
  const conflictingFlow = await loadQuorumCandidateFlow('ETH', {
    nowMs,
    filePath: conflictingRegistryPath,
  });
  assert.equal(
    evaluateEightMemberCouncil({ whaleFlowData: conflictingFlow, nowMs }).members[5].vote,
    'ABSTAIN',
    'opposing eligible channel directions must fail closed',
  );

  const shadowReport = applyMember6ShadowMode(actualReport);
  assert.equal(shadowReport.members[5].vote, 'ABSTAIN');
  assert.equal(shadowReport.abstentions, actualReport.abstentions + 1);
  assert.equal(shadowReport.selectedDirection, null);

  const originalShadowSetting = process.env.SBK1_MEMBER6_SHADOW_MODE;
  delete process.env.SBK1_MEMBER6_SHADOW_MODE;
  assert.equal(member6ShadowModeEnabled(), false, 'shadow mode is disabled by default');
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
