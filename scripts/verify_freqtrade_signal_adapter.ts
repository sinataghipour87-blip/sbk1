import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deriveSbkSignalIds,
  FreqtradeSignalAdapter,
  isValidBridgeToken,
  SBK_SIGNAL_CONTRACT_VERSION,
  SbkSignalValidationError,
  validateSbkFreqtradeSignal,
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
  dataQuality: {
    status: 'LIVE',
    source: 'Bybit Linear Futures Ticker (BTCUSDT)',
    observedAtMs: nowMs,
    maxAgeMs: 5_000,
  },
  entryConditions: {
    setupType: 'BULLISH_LIQUIDITY_SWEEP',
    stopLoss: 61_800,
    takeProfit: 62_700,
    maxPriceDeviationBps: 50,
  },
  riskLimits: {
    riskBudgetPct: 1,
    maxStakeQuote: 100,
    maxLeverage: 1,
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
  assert.equal(isValidBridgeToken('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(isValidBridgeToken('a'.repeat(31), 'a'.repeat(32)), false);
  assert.equal(isValidBridgeToken('a'.repeat(32), 'short'), false);
  assert.throws(
    () => validateSbkFreqtradeSignal({ ...signal, riskLimits: { ...signal.riskLimits, riskBudgetPct: true } }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'INVALID_RISK_LIMITS',
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

  const adapter = new FreqtradeSignalAdapter();
  const concurrentSubmissions = await Promise.all(
    Array.from({ length: 4 }, () => adapter.submit(signal, { nowMs, expectedPair: signal.pair })),
  );
  assert.equal(concurrentSubmissions.filter((record) => !record.duplicate).length, 1);
  assert.equal(concurrentSubmissions.filter((record) => record.duplicate).length, 3);
  assert.equal(concurrentSubmissions[0].status, 'ACCEPTED');
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
  const lateLink = await adapter.submit({ ...signal, ...lateLinkIds }, { nowMs, expectedPair: signal.pair });
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
  }, { nowMs, expectedPair: signal.pair });
  await adapter.updateStatus(cancellable.signal.signalId, { status: 'STRATEGY_ACCEPTED' });
  await adapter.updateStatus(cancellable.signal.signalId, { status: 'ORDER_SUBMITTED', tradeId: 43 });
  assert.equal((await adapter.updateStatus(cancellable.signal.signalId, { status: 'CANCELLED' })).status, 'CANCELLED');

  const persisted = JSON.parse(await readFile(process.env.SBK1_SIGNAL_STORE_PATH, 'utf8'));
  assert.equal(persisted.records.find((record: { signal: { signalId: string } }) =>
    record.signal.signalId === signal.signalId).tradeId, 42);
  const restored = await new FreqtradeSignalAdapter().get(signal.signalId);
  assert.equal(restored?.status, 'FILLED');
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
    input: JSON.stringify([
      { name: 'valid', signal, nowMs, valid: true },
      { name: 'expired', signal: { ...signal, expiresAtMs: nowMs - 1 }, nowMs, valid: false },
      {
        name: 'expiry precedes future generation time',
        signal: { ...signal, generatedAtMs: nowMs + 500, expiresAtMs: nowMs + 100 },
        nowMs,
        valid: false,
      },
      { name: 'pair mismatch', signal: { ...signal, pair: 'ETH/USDT:USDT' }, nowMs, valid: false },
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
