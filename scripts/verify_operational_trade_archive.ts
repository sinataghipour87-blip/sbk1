import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OperationalTradeArchive } from '../src/services/operationalTradeArchive';
import {
  deriveSbkSignalIds,
  DRY_RUN_FIXTURE_SETUP_PREFIX,
  SBK_SIGNAL_CONTRACT_VERSION,
  validateSbkFreqtradeSignal,
  type SbkFreqtradeSignalRecord,
} from '../src/services/freqtradeSignalAdapter';
import type { FreqtradeTrade } from '../src/services/freqtradeBridge';

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-trade-archive-'));

function makeSignal(nowMs: number, setupType = 'AUDITABLE_SETUP') {
  const referencePrice = 60_000;
  const ids = deriveSbkSignalIds({
    pair: 'BTC/USDT:USDT',
    direction: 'LONG',
    setupType,
    generatedAtMs: nowMs,
    sweptLevelPrice: referencePrice,
    referencePrice,
    stopLoss: 59_000,
    takeProfit: 62_000,
  });
  return validateSbkFreqtradeSignal({
    contractVersion: SBK_SIGNAL_CONTRACT_VERSION,
    ...ids,
    exchange: 'bybit',
    market: 'futures',
    pair: 'BTC/USDT:USDT',
    direction: 'LONG',
    timeframe: '15m',
    generatedAtMs: nowMs,
    expiresAtMs: nowMs + 60_000,
    referencePrice,
    dataQuality: {
      status: 'LIVE',
      source: 'freqtrade.dataprovider.ticker',
      observedAtMs: nowMs,
      maxAgeMs: 5_000,
    },
    entryConditions: {
      setupType,
      stopLoss: 59_000,
      takeProfit: 62_000,
      maxPriceDeviationBps: 100,
    },
    riskLimits: { riskBudgetPct: 0.1, maxStakeQuote: 100, maxLeverage: 1 },
  }, { nowMs });
}

function makeRecord(nowMs: number, status: SbkFreqtradeSignalRecord['status']): SbkFreqtradeSignalRecord {
  const signal = makeSignal(nowMs);
  return {
    signal,
    status,
    receivedAtMs: nowMs,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    lifecycleEvents: [{ status, observedAtMs: nowMs, source: 'SBK1' }],
  };
}

function makeStatusUpdate(
  record: SbkFreqtradeSignalRecord,
  status: SbkFreqtradeSignalRecord['status'],
  updatedAtMs: number,
  details: Partial<Pick<SbkFreqtradeSignalRecord, 'reason' | 'tradeId' | 'filledAmount' | 'averageFillPrice'>> = {},
): SbkFreqtradeSignalRecord {
  return {
    ...record,
    status,
    updatedAtMs,
    ...details,
    lifecycleEvents: [{
      status,
      observedAtMs: updatedAtMs,
      source: 'FREQTRADE',
      ...details,
    }],
  };
}

const trade: FreqtradeTrade = {
  trade_id: 73,
  pair: 'BTC/USDT:USDT',
  is_open: false,
  is_short: false,
  amount: 0.001,
  amount_requested: 0.001,
  open_rate: 60_000,
  stake_amount: 60,
  has_open_orders: false,
  orders: [{
    order_id: 'entry-73',
    status: 'closed',
    amount: 0.001,
    filled: 0.001,
    safe_price: 60_000,
    cost: 60,
    ft_order_side: 'buy',
    is_open: false,
    order_filled_timestamp: 1_800_000_001_000,
  }],
  fee_open_cost: 0.03,
  fee_close_cost: 0.03,
  open_fill_timestamp: 1_800_000_001_000,
  close_timestamp: 1_800_000_601_000,
  close_rate: 61_000,
  close_profit_abs: 0.94,
  close_profit: 0.0156,
  realized_profit: 0.94,
  exit_reason: 'roi',
};

try {
  const storePath = path.join(temporaryDirectory, 'archive.json');
  const archive = new OperationalTradeArchive(storePath);
  const initialRecord = makeRecord(1_800_000_000_000, 'ACCEPTED');
  await archive.recordSignalLifecycle(initialRecord);
  await archive.recordSignalLifecycle(makeStatusUpdate(
    initialRecord,
    'ORDER_SUBMITTED',
    initialRecord.updatedAtMs + 1,
  ));
  await archive.recordSignalLifecycle(makeStatusUpdate(initialRecord, 'PARTIALLY_FILLED', initialRecord.updatedAtMs + 2, {
    tradeId: 73,
    filledAmount: 0.0004,
    averageFillPrice: 59_900,
  }));
  await archive.recordSignalLifecycle(makeStatusUpdate(initialRecord, 'PARTIALLY_FILLED', initialRecord.updatedAtMs + 3, {
    tradeId: 73,
    filledAmount: 0.00075,
    averageFillPrice: 60_000,
  }));
  const filledRecord = makeStatusUpdate(initialRecord, 'FILLED', initialRecord.updatedAtMs + 4, {
    tradeId: 73,
    filledAmount: 0.001,
    averageFillPrice: 60_000,
  });
  await archive.recordSignalLifecycle(filledRecord);
  await archive.recordFreqtradeTrade(initialRecord.signal.signalId, trade, 'DRY_RUN', 1_800_000_602_000);
  await archive.recordFreqtradeTrade(initialRecord.signal.signalId, trade, 'DRY_RUN', 1_800_000_603_000);

  const recovered = await new OperationalTradeArchive(storePath).getBySignalId(initialRecord.signal.signalId);
  assert.ok(recovered, 'record survives service restart');
  assert.equal(recovered.decisionId, initialRecord.signal.decisionId);
  assert.equal(recovered.featureSnapshot, null);
  assert.equal(recovered.modelVersion, null);
  assert.equal(recovered.lifecycleEvents.length, 5, 'partial-fill updates with the same status are retained');
  assert.equal(recovered.lifecycleEvents[2]?.source, 'FREQTRADE');
  assert.equal(recovered.lifecycleEvents[2]?.tradeId, 73);
  assert.equal(recovered.lifecycleEvents[2]?.filledAmount, 0.0004);
  assert.equal(recovered.lifecycleEvents[3]?.filledAmount, 0.00075);
  assert.equal(recovered.lifecycleEvents[4]?.averageFillPrice, 60_000);
  assert.equal(recovered.freqtradeTrades.length, 1, 'identical authoritative trade snapshot is idempotent');
  assert.equal(recovered.freqtradeTrades[0]?.source, 'FREQTRADE_RPC');
  assert.equal(recovered.freqtradeTrades[0]?.executionMode, 'DRY_RUN');
  assert.equal(recovered.freqtradeTrades[0]?.trade.orders[0]?.order_id, 'entry-73');
  assert.equal(recovered.freqtradeTrades[0]?.trade.fee_close_cost, 0.03);
  assert.equal(recovered.freqtradeTrades[0]?.trade.close_profit_abs, 0.94);

  const restartedArchive = new OperationalTradeArchive(storePath);
  await restartedArchive.recordSignalLifecycle(filledRecord);
  const afterDuplicateReplay = await restartedArchive.getBySignalId(initialRecord.signal.signalId);
  assert.equal(afterDuplicateReplay?.lifecycleEvents.length, 5, 'lifecycle replay after restart is idempotent');

  const fixtureSignal = makeSignal(1_800_000_000_000, `${DRY_RUN_FIXTURE_SETUP_PREFIX}archive-test`);
  await archive.recordSignalLifecycle({
    ...initialRecord,
    signal: fixtureSignal,
  });
  assert.equal(await archive.getBySignalId(fixtureSignal.signalId), null, 'dry-run fixture is excluded');

  const secondSignal = makeSignal(1_800_000_000_001, 'ANOTHER_AUDITABLE_SETUP');
  await archive.recordSignalLifecycle({
    ...initialRecord,
    signal: secondSignal,
  });
  await assert.rejects(
    archive.recordFreqtradeTrade(secondSignal.signalId, trade, 'DRY_RUN'),
    /already linked to signal/,
  );
  await assert.rejects(
    archive.recordFreqtradeTrade(initialRecord.signal.signalId, { ...trade, pair: 'ETH/USDT:USDT' }, 'DRY_RUN'),
    /does not match signal/,
  );
  console.log('Operational trade archive persistence, idempotency, source separation, and linkage checks passed.');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
