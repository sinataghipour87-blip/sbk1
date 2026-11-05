import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deriveSbkExitSignalId,
  deriveSbkSignalIds,
  SBK_ENTRY_AUTHORIZATION_VERSION,
  FreqtradeSignalAdapter,
  isValidBridgeToken,
  SBK_SIGNAL_CONTRACT_VERSION,
  SbkSignalValidationError,
  validateSbkFreqtradeSignal,
  validateSbkFreqtradeExitSignal,
} from '../src/services/freqtradeSignalAdapter';

const nowMs = Date.now();
const ids = deriveSbkSignalIds({
  pair: 'BTC/USDT:USDT',
  direction: 'LONG',
  setupType: 'BULLISH_LIQUIDITY_SWEEP',
  generatedAtMs: nowMs,
  sweptLevelPrice: 62_000,
  referencePrice: 62_100,
  stopLoss: 61_800,
  takeProfit: 62_700,
});
const requiredGateIds = [
  'COUNCIL_REPORT',
  'LIVE_DATA',
  'REFERENCE_PRICE',
  'VOLATILITY',
  'EXECUTION_SPREAD',
  'TRADE_LEVELS',
  'STOP_AND_TARGET',
  'PORTFOLIO_RISK',
  'DAILY_LOSS',
  'RISK_ALLOCATION',
  'HOLDING_HORIZON',
];
const signal = {
  contractVersion: SBK_SIGNAL_CONTRACT_VERSION,
  ...ids,
  exchange: 'bybit',
  market: 'futures',
  pair: 'BTC/USDT:USDT',
  direction: 'LONG',
  timeframe: '15m',
  generatedAtMs: nowMs,
  expiresAtMs: nowMs + 45_000,
  referencePrice: 62_100,
  engineScore: 84,
  dataQuality: {
    status: 'LIVE',
    source: 'freqtrade.dataprovider',
    observedAtMs: nowMs,
    maxAgeMs: 5_000,
  },
  entryConditions: {
    setupType: 'BULLISH_LIQUIDITY_SWEEP',
    entryPrice: 62_100,
    stopLoss: 61_800,
    takeProfit: 62_700,
    maxPriceDeviationBps: 50,
    maxHoldingMinutes: 30,
  },
  riskLimits: {
    riskBudgetPct: 1,
    maxStakeQuote: 100,
    maxLeverage: 1,
  },
  authorization: {
    contractVersion: SBK_ENTRY_AUTHORIZATION_VERSION,
    decision: 'APPROVE_ENTRY',
    decisionId: ids.decisionId,
    snapshotId: `SNP_${nowMs}_1`,
    snapshotTimestampMs: nowMs,
    evaluatedAtMs: nowMs,
    timeframe: '15m',
    direction: 'LONG',
    gates: requiredGateIds.map((id) => ({ id, status: 'PASSED', reason: 'CONTRACT_TEST_ONLY named isolated policy evidence.' })),
    models: [],
    disagreementVeto: false,
    ensembleProbabilityPct: null,
    riskRewardRatio: 2,
    allocatedRiskUsd: 0.4,
    holdingHorizonMinutes: 30,
  },
} as const;

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-freqtrade-signal-'));
process.env.SBK1_SIGNAL_STORE_PATH = path.join(temporaryDirectory, 'signals.json');

try {
  const validated = validateSbkFreqtradeSignal(signal, {
    nowMs,
    expectedPair: 'BTC/USDT:USDT',
    expectedExchange: 'BYBIT',
    expectedTimeframe: '15m',
  });
  assert.equal(validated.signalId, ids.signalId);
  assert.equal(validated.authorization.decision, 'APPROVE_ENTRY');
  assert.throws(
    () => validateSbkFreqtradeSignal({
      ...signal,
      timeframe: '1h',
      authorization: { ...signal.authorization, timeframe: '1h' },
    }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'TIMEFRAME_MISMATCH',
    'higher timeframes must not authorize independent entry signals',
  );
  const maxBoundedRiskSignal = validateSbkFreqtradeSignal({
    ...signal,
    riskLimits: { ...signal.riskLimits, riskBudgetPct: 10, maxLeverage: 25 },
  }, { nowMs });
  assert.equal(maxBoundedRiskSignal.riskLimits.riskBudgetPct, 10);
  assert.equal(maxBoundedRiskSignal.riskLimits.maxLeverage, 25);
  assert.throws(
    () => validateSbkFreqtradeSignal({
      ...signal,
      riskLimits: { ...signal.riskLimits, riskBudgetPct: 10.01 },
    }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_RISK_LIMITS',
  );
  assert.throws(
    () => validateSbkFreqtradeSignal({
      ...signal,
      riskLimits: { ...signal.riskLimits, maxLeverage: 25.01 },
    }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_RISK_LIMITS',
  );
  const unscoredSignal = validateSbkFreqtradeSignal({
    ...signal,
    engineScore: null,
  }, { nowMs });
  assert.equal(unscoredSignal.engineScore, null, 'an unavailable heuristic score must stay explicitly unavailable');
  assert.equal(unscoredSignal.authorization.decision, 'APPROVE_ENTRY');
  assert.equal(isValidBridgeToken('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(isValidBridgeToken('a'.repeat(31), 'a'.repeat(32)), false);
  assert.equal(isValidBridgeToken('a'.repeat(32), 'short'), false);
  assert.throws(
    () => validateSbkFreqtradeSignal({ ...signal, riskLimits: { ...signal.riskLimits, riskBudgetPct: true } }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_RISK_LIMITS',
  );
  assert.throws(
    () => validateSbkFreqtradeSignal({
      ...signal,
      authorization: { ...signal.authorization, allocatedRiskUsd: 0.5 },
    }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError &&
      error.code === 'AUTHORIZATION_RISK_MISMATCH',
    'authorization may not allocate more risk than the stake cap and stop distance can justify',
  );

  assert.throws(
    () => validateSbkFreqtradeSignal({ ...signal, expiresAtMs: nowMs - 1 }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'SIGNAL_EXPIRED',
  );
  assert.throws(
    () => validateSbkFreqtradeSignal({
      ...signal,
      generatedAtMs: nowMs + 500,
      expiresAtMs: nowMs + 100,
    }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'SIGNAL_EXPIRED',
  );
  assert.throws(
    () => validateSbkFreqtradeSignal({
      ...signal,
      dataQuality: { ...signal.dataQuality, observedAtMs: nowMs - 3_000, maxAgeMs: 1_000 },
    }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_DATA_QUALITY',
  );
  assert.throws(
    () => validateSbkFreqtradeSignal(signal, { nowMs, expectedPair: 'ETH/USDT:USDT' }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'PAIR_MISMATCH',
  );
  assert.throws(
    () => validateSbkFreqtradeSignal({
      ...signal,
      entryConditions: { ...signal.entryConditions, stopLoss: 63_000 },
    }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_RISK_REWARD',
  );
  assert.throws(
    () => validateSbkFreqtradeSignal({ ...signal, authorization: undefined }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_AUTHORIZATION',
  );
  assert.equal(signal.authorization.models.length, 0, 'entry authorization does not require separate predictive models');
  assert.equal(signal.authorization.ensembleProbabilityPct, null);
  assert.equal(
    validateSbkFreqtradeSignal({
      ...signal,
      authorization: { ...signal.authorization, disagreementVeto: true },
    }, { nowMs }).authorization.decision,
    'APPROVE_ENTRY',
    'an independent model veto must not override the council direction',
  );
  assert.throws(
    () => validateSbkFreqtradeSignal({
      ...signal,
      authorization: {
        ...signal.authorization,
        gates: signal.authorization.gates.map((gate) => gate.id === 'TRADE_LEVELS'
          ? { ...gate, status: 'UNAVAILABLE' }
          : gate),
      },
    }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_AUTHORIZATION_GATES',
  );
  assert.throws(
    () => validateSbkFreqtradeSignal({
      ...signal,
      authorization: {
        ...signal.authorization,
        gates: signal.authorization.gates.filter((gate) => gate.id !== 'EXECUTION_SPREAD'),
      },
    }, { nowMs }),
    (error: unknown) => error instanceof SbkSignalValidationError &&
      error.code === 'INCOMPLETE_AUTHORIZATION_GATES',
  );
  const exitSignal = {
    contractVersion: SBK_SIGNAL_CONTRACT_VERSION,
    signalType: 'EXIT' as const,
    exitId: deriveSbkExitSignalId({
      tradeId: 42,
      entryTag: ids.signalId,
      reason: 'CONTRACT_TEST_ONLY exit',
      generatedAtMs: nowMs,
    }),
    pair: signal.pair,
    tradeId: 42,
    entryTag: ids.signalId,
    direction: signal.direction,
    reason: 'CONTRACT_TEST_ONLY exit',
    generatedAtMs: nowMs,
    expiresAtMs: nowMs + 30_000,
  };
  assert.deepEqual(validateSbkFreqtradeExitSignal(exitSignal, nowMs), exitSignal);
  assert.throws(
    () => validateSbkFreqtradeExitSignal({ ...exitSignal, tradeId: 0 }, nowMs),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_EXIT_TARGET',
  );

  const adapter = new FreqtradeSignalAdapter();
  const concurrentSubmissions = await Promise.all(
    Array.from({ length: 4 }, () => adapter.submit(signal, { nowMs, expectedPair: signal.pair })),
  );
  assert.equal(concurrentSubmissions.filter((record) => !record.duplicate).length, 1);
  assert.equal(concurrentSubmissions.filter((record) => record.duplicate).length, 3);
  assert.equal(concurrentSubmissions[0].status, 'ACCEPTED');
  assert.equal(concurrentSubmissions[0].lifecycleEvents.length, 1);
  assert.equal(concurrentSubmissions[0].lifecycleEvents[0]?.status, 'ACCEPTED');
  assert.equal(concurrentSubmissions[0].lifecycleEvents[0]?.source, 'SBK1');
  assert.equal(concurrentSubmissions[0].receivedAtMs, concurrentSubmissions[0].createdAtMs);
  await assert.rejects(
    adapter.submit({
      ...signal,
      riskLimits: { ...signal.riskLimits, riskBudgetPct: 1.1 },
    }, { nowMs, expectedPair: signal.pair }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal((await adapter.getPending(signal.pair, signal.timeframe)).length, 1);
  assert.equal((await adapter.getForStrategy(signal.pair, signal.timeframe))[0]?.status, 'ACCEPTED');

  await assert.rejects(
    adapter.updateStatus(signal.signalId, { status: 'FILLED' }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_STATUS_TRANSITION',
  );
  await adapter.updateStatus(signal.signalId, { status: 'STRATEGY_ACCEPTED' });
  assert.equal((await adapter.getForStrategy(signal.pair, signal.timeframe))[0]?.status, 'STRATEGY_ACCEPTED');
  await adapter.updateStatus(signal.signalId, { status: 'ORDER_SUBMITTED', tradeId: 42 });
  await adapter.updateStatus(signal.signalId, {
    status: 'PARTIALLY_FILLED',
    tradeId: 42,
    filledAmount: 0.001,
    averageFillPrice: 62_105,
  });
  const filled = await adapter.updateStatus(signal.signalId, {
    status: 'FILLED',
    tradeId: 42,
    filledAmount: 0.002,
    averageFillPrice: 62_106,
  });
  assert.equal(filled.status, 'FILLED');
  assert.deepEqual(
    filled.lifecycleEvents.map((event) => event.status),
    ['ACCEPTED', 'STRATEGY_ACCEPTED', 'ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'FILLED'],
  );
  assert.equal(filled.lifecycleEvents.at(-1)?.tradeId, 42);
  assert.equal(filled.lifecycleEvents.at(-1)?.source, 'FREQTRADE');
  const queuedExit = await adapter.submitExitSignal(exitSignal, nowMs);
  assert.equal(queuedExit.status, 'PENDING');
  assert.equal((await adapter.getPendingExitSignals(signal.pair)).length, 1);
  const duplicateExit = await adapter.submitExitSignal(exitSignal, nowMs);
  assert.equal(duplicateExit.duplicate, true, 'repeated exit submissions must be idempotent');
  const confirmedExit = await adapter.updateExitSignalStatus(
    exitSignal.exitId,
    'CONFIRMED',
    'CONTRACT_TEST_ONLY accepted by named RPC mock',
  );
  assert.equal(confirmedExit.status, 'CONFIRMED');
  assert.deepEqual(
    (await new FreqtradeSignalAdapter().getPendingExitSignals(signal.pair)).map((pending) => pending.exitId),
    [exitSignal.exitId],
    'confirmed exit intent is replayable from persisted adapter state after restart',
  );
  const closedExit = await adapter.updateExitSignalStatus(exitSignal.exitId, 'CLOSED');
  assert.equal(closedExit.status, 'CLOSED');
  assert.equal((await adapter.getPendingExitSignals(signal.pair)).length, 0);
  assert.equal((await adapter.submitExitSignal(exitSignal, nowMs)).status, 'CLOSED');
  await assert.rejects(
    adapter.updateStatus(signal.signalId, { status: 'FILLED', tradeId: 43 }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'TRADE_ID_CONFLICT',
  );

  const lateLinkIds = deriveSbkSignalIds({
    pair: signal.pair,
    direction: signal.direction,
    setupType: signal.entryConditions.setupType,
    generatedAtMs: nowMs,
    sweptLevelPrice: 62_400,
    referencePrice: signal.referencePrice,
    stopLoss: signal.entryConditions.stopLoss,
    takeProfit: signal.entryConditions.takeProfit,
  });
  const lateLink = await adapter.submit({
    ...signal,
    ...lateLinkIds,
    authorization: { ...signal.authorization, decisionId: lateLinkIds.decisionId },
  }, { nowMs, expectedPair: signal.pair });
  await adapter.updateStatus(lateLink.signal.signalId, { status: 'STRATEGY_ACCEPTED' });
  await adapter.updateStatus(lateLink.signal.signalId, { status: 'ORDER_SUBMITTED' });
  await adapter.updateStatus(lateLink.signal.signalId, { status: 'FILLED' });
  const linkedAfterFill = await adapter.updateStatus(lateLink.signal.signalId, {
    status: 'FILLED',
    tradeId: 44,
  });
  assert.equal(linkedAfterFill.tradeId, 44, 'same-state callback can add a late authoritative trade link');

  const uncertainIds = deriveSbkSignalIds({
    pair: signal.pair,
    direction: signal.direction,
    setupType: signal.entryConditions.setupType,
    generatedAtMs: nowMs,
    sweptLevelPrice: 62_200,
    referencePrice: signal.referencePrice,
    stopLoss: signal.entryConditions.stopLoss,
    takeProfit: signal.entryConditions.takeProfit,
  });
  const uncertain = await adapter.submit({
    ...signal,
    ...uncertainIds,
    entryConditions: { ...signal.entryConditions, setupType: 'DRY_RUN_E2E_FIXTURE_UNCERTAIN' },
    authorization: { ...signal.authorization, decisionId: uncertainIds.decisionId },
  }, { nowMs, expectedPair: signal.pair });
  await adapter.updateStatus(uncertain.signal.signalId, { status: 'STRATEGY_ACCEPTED' });
  const quarantined = await adapter.updateStatus(uncertain.signal.signalId, {
    status: 'UNKNOWN_IN_FLIGHT',
    reason: 'No matching persisted Freqtrade trade after restart.',
  });
  assert.equal(quarantined.status, 'UNKNOWN_IN_FLIGHT');
  assert.equal((await adapter.getForStrategy(signal.pair, signal.timeframe)).some((record) =>
    record.signal.signalId === uncertain.signal.signalId), true, 'unknown signals remain visible for Freqtrade reconciliation');
  await assert.rejects(
    adapter.updateStatus(uncertain.signal.signalId, { status: 'ACCEPTED' }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_STATUS_TRANSITION',
  );
  const reconciledUnknown = await adapter.updateStatus(uncertain.signal.signalId, {
    status: 'ORDER_SUBMITTED',
    tradeId: 45,
  });
  assert.equal(reconciledUnknown.status, 'ORDER_SUBMITTED');
  assert.equal(reconciledUnknown.tradeId, 45);

  const cancelledIds = deriveSbkSignalIds({
    pair: signal.pair,
    direction: signal.direction,
    setupType: signal.entryConditions.setupType,
    generatedAtMs: nowMs,
    sweptLevelPrice: 62_300,
    referencePrice: signal.referencePrice,
    stopLoss: signal.entryConditions.stopLoss,
    takeProfit: signal.entryConditions.takeProfit,
  });
  const cancellable = await adapter.submit({
    ...signal,
    ...cancelledIds,
    entryConditions: { ...signal.entryConditions, setupType: 'DRY_RUN_E2E_FIXTURE_CANCELLED' },
    authorization: { ...signal.authorization, decisionId: cancelledIds.decisionId },
  }, { nowMs, expectedPair: signal.pair });
  await adapter.updateStatus(cancellable.signal.signalId, { status: 'STRATEGY_ACCEPTED' });
  await adapter.updateStatus(cancellable.signal.signalId, { status: 'ORDER_SUBMITTED', tradeId: 43 });
  assert.equal((await adapter.updateStatus(cancellable.signal.signalId, { status: 'CANCELLED' })).status, 'CANCELLED');

  const persisted = JSON.parse(await readFile(process.env.SBK1_SIGNAL_STORE_PATH, 'utf8'));
  assert.equal(persisted.records.find((record: { signal: { signalId: string } }) =>
    record.signal.signalId === signal.signalId).tradeId, 42);
  const restored = await new FreqtradeSignalAdapter().get(signal.signalId);
  assert.equal(restored?.status, 'FILLED');
  assert.equal(restored?.lifecycleEvents.length, 5, 'signal history survives process restart');
  assert.equal((await new FreqtradeSignalAdapter().get(uncertain.signal.signalId))?.status, 'ORDER_SUBMITTED');

  const pythonContractCheck = spawnSync('python3', ['-c', `
import json
import sys
sys.path.insert(0, "freqtrade_integration/strategies")
from sbk_signal_contract import is_valid_sbk_signal

cases = json.load(sys.stdin)
for case in cases:
    payload = case["signal"]
    actual = is_valid_sbk_signal(
        payload,
        now_ms=case["nowMs"],
        expected_exchange="bybit",
        expected_market="futures",
        expected_pair="BTC/USDT:USDT",
        expected_timeframe="15m",
    )
    if actual is not case["valid"]:
        raise SystemExit(f"Contract disagreement for {case['name']}: expected {case['valid']}, got {actual}")
print("Python signal contract checks passed.")
`], {
    cwd: process.cwd(),
    env: { ...process.env, SBK1_DRY_RUN_FIXTURE_ENABLED: 'true' },
    input: JSON.stringify([
      { name: 'valid', signal, nowMs, valid: true },
      { name: 'explicitly unscored heuristic signal', signal: { ...signal, engineScore: null }, nowMs, valid: true },
      { name: 'expired', signal: { ...signal, expiresAtMs: nowMs - 1 }, nowMs, valid: false },
      {
        name: 'expiry precedes future generation time',
        signal: { ...signal, generatedAtMs: nowMs + 500, expiresAtMs: nowMs + 100 },
        nowMs,
        valid: false,
      },
      { name: 'pair mismatch', signal: { ...signal, pair: 'ETH/USDT:USDT' }, nowMs, valid: false },
      { name: 'unsupported evidence level', signal: { ...signal, evidenceLevel: 'CALIBRATED' }, nowMs, valid: false },
      {
        name: 'wrong-side stop',
        signal: { ...signal, entryConditions: { ...signal.entryConditions, stopLoss: 63_000 } },
        nowMs,
        valid: false,
      },
      {
        name: 'stale source evidence',
        signal: { ...signal, dataQuality: { ...signal.dataQuality, observedAtMs: nowMs - 3_000, maxAgeMs: 1_000 } },
        nowMs,
        valid: false,
      },
      {
        name: 'dry-run fixture polling latency',
        signal: {
          ...signal,
          generatedAtMs: nowMs - 40_000,
          expiresAtMs: nowMs + 20_000,
          entryConditions: { ...signal.entryConditions, setupType: 'DRY_RUN_E2E_FIXTURE_TEST' },
          dataQuality: { ...signal.dataQuality, observedAtMs: nowMs - 40_000, maxAgeMs: 55_000 },
          authorization: {
            ...signal.authorization,
            decision: 'DRY_RUN_TEST_ONLY',
            snapshotId: `SNP_${nowMs - 40_000}_test`,
            snapshotTimestampMs: nowMs - 40_000,
            evaluatedAtMs: nowMs - 40_000,
            models: [],
            ensembleProbabilityPct: null,
          },
        },
        nowMs,
        valid: true,
      },
    ]),
    encoding: 'utf8',
  });
  assert.equal(pythonContractCheck.status, 0, pythonContractCheck.stderr || pythonContractCheck.stdout);
  console.log(pythonContractCheck.stdout.trim());
  console.log('Freqtrade signal adapter checks passed.');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
