import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createDryRunCollectionSignal,
  getDryRunCollectionReadinessError,
  isDryRunCollectionDecisionEligible,
  validateDryRunCollectionMarketEvidence,
} from '../src/services/freqtradeDryRunCollection';
import {
  FREQTRADE_MARKET_SNAPSHOT_VERSION,
  type FreqtradeMarketSnapshot,
} from '../src/services/freqtradeMarketDataBridge';
import type { FreqtradeBotState } from '../src/services/freqtradeBridge';
import {
  DRY_RUN_COLLECTION_MODE,
  FreqtradeSignalAdapter,
  SbkSignalValidationError,
} from '../src/services/freqtradeSignalAdapter';

const nowMs = new Date().setUTCHours(12, 0, 0, 0);
const state: FreqtradeBotState = {
  status: 'running',
  ping: true,
  strategy: 'SbkSignalStrategy',
  exchange: 'bybit',
  market: 'futures',
  timeframe: '15m',
  demoTrading: false,
  dryRun: true,
  forceEntryEnabled: false,
  maxOpenTrades: 1,
  openTradesCount: 0,
  lastChecked: nowMs,
};
const readiness = {
  enabled: true,
  killSwitchActive: false,
  configuredPair: 'BTC/USDT:USDT',
  expectedPair: 'BTC/USDT:USDT',
  expectedExchange: 'bybit',
  expectedTimeframe: '15m',
  whitelist: ['BTC/USDT:USDT'],
};

assert.equal(getDryRunCollectionReadinessError(state, readiness), undefined);
assert.match(getDryRunCollectionReadinessError({ ...state, dryRun: false }, readiness) || '', /dry_run=true/);
assert.match(getDryRunCollectionReadinessError({ ...state, demoTrading: true }, readiness) || '', /demo_trading=false/);
assert.match(getDryRunCollectionReadinessError({ ...state, demoTrading: undefined }, readiness) || '', /demo_trading=false/);
assert.match(getDryRunCollectionReadinessError({ ...state, forceEntryEnabled: true }, readiness) || '', /force-entry/);
assert.match(getDryRunCollectionReadinessError({ ...state, openTradesCount: 1 }, readiness) || '', /existing Freqtrade trades/);
assert.match(getDryRunCollectionReadinessError({ ...state, maxOpenTrades: 2 }, readiness) || '', /max_open_trades=1/);
assert.match(getDryRunCollectionReadinessError({ ...state, maxOpenTrades: undefined }, readiness) || '', /max_open_trades=1/);
assert.match(getDryRunCollectionReadinessError(state, { ...readiness, killSwitchActive: true }) || '', /kill switch/);
assert.match(getDryRunCollectionReadinessError(state, { ...readiness, enabled: false }) || '', /not explicitly enabled/);

const pipelineGates = {
  collectionEligible: true,
  direction: 'LONG',
  hasTradeContract: true,
  stages: [
    { id: 'STAGE_12_EXPECTED_VALUE', passed: true },
    { id: 'STAGE_13_POSITION_SIZE', passed: true },
    { id: 'STAGE_14_EXECUTION', passed: true },
  ],
};
assert.equal(isDryRunCollectionDecisionEligible(pipelineGates, 'LONG'), true);
assert.equal(isDryRunCollectionDecisionEligible({
  ...pipelineGates,
  stages: pipelineGates.stages.map((stage) =>
    stage.id === 'STAGE_13_POSITION_SIZE' ? { ...stage, passed: false } : stage
  ),
}, 'LONG'), false);
assert.equal(isDryRunCollectionDecisionEligible({
  ...pipelineGates,
  stages: pipelineGates.stages.map((stage) =>
    stage.id === 'STAGE_12_EXPECTED_VALUE' ? { ...stage, passed: false } : stage
  ),
}, 'LONG'), false);

const snapshot: FreqtradeMarketSnapshot = {
  contractVersion: FREQTRADE_MARKET_SNAPSHOT_VERSION,
  source: 'freqtrade.dataprovider',
  exchange: 'bybit',
  market: 'futures',
  pair: 'BTC/USDT:USDT',
  timeframe: '1m',
  generatedAtMs: nowMs,
  candles: Array.from({ length: 30 }, (_, index) => ({
    timestampMs: nowMs - (30 - index) * 60_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  })),
  additionalCandles: { '1m': null, '5m': null, '1h': null, '4h': null },
  ticker: {
    exchangeTimestampMs: nowMs - 100,
    retrievedAtMs: nowMs - 100,
    last: 100,
    bid: 99.99,
    ask: 100.01,
    markPrice: 100,
    indexPrice: 100,
  },
  orderBook: {
    timestampMs: nowMs - 100,
    bids: [{ price: 99.99, amount: 1 }],
    asks: [{ price: 100.01, amount: 1 }],
  },
  fundingRate: { retrievedAtMs: nowMs - 100, rate: 0.0001, nextFundingAtMs: nowMs + 3_600_000 },
};
const analysis = {
  dataStatus: 'LIVE',
  dataQualityReport: { status: 'LIVE', isTradeAllowed: true },
  realObiData: { status: 'LIVE', obi: 0, timestamp: nowMs - 100 },
  canonicalSnapshot: { timestampUtc: nowMs - 100 },
  regimeClassification: { probabilityModelValidation: { status: 'CALIBRATED' } },
  noTradePrediction: { isNoTradeTriggered: false },
  atr: 2,
};
assert(Math.abs(validateDryRunCollectionMarketEvidence(analysis, snapshot, 'LONG', nowMs).obi) < 0.01);

function expectEvidenceRejection(value: unknown, market = snapshot): void {
  assert.throws(() => validateDryRunCollectionMarketEvidence(value, market, 'LONG', nowMs));
}

expectEvidenceRejection({ ...analysis, dataStatus: 'STALE' });
expectEvidenceRejection({
  ...analysis,
  dataQualityReport: { status: 'LIVE', isTradeAllowed: false },
});
expectEvidenceRejection({
  ...analysis,
  realObiData: { status: 'LIVE', obi: 0.8, timestamp: nowMs - 100 },
});
expectEvidenceRejection({
  ...analysis,
  canonicalSnapshot: { timestampUtc: nowMs - 6_000 },
});
expectEvidenceRejection(analysis, {
  ...snapshot,
  fundingRate: { ...snapshot.fundingRate!, rate: 0.04 },
});
expectEvidenceRejection(analysis, {
  ...snapshot,
  fundingRate: { ...snapshot.fundingRate!, retrievedAtMs: nowMs - 16_000 },
});
expectEvidenceRejection({
  ...analysis,
  regimeClassification: { probabilityModelValidation: { status: 'UNCALIBRATED' } },
});
expectEvidenceRejection({ ...analysis, noTradePrediction: { isNoTradeTriggered: true } });
expectEvidenceRejection({ ...analysis, atr: 20 });
expectEvidenceRejection(analysis, { ...snapshot, candles: snapshot.candles.slice(0, 29) });

const signalInput = {
  nowMs,
  exchange: 'bybit',
  pair: 'BTC/USDT:USDT',
  timeframe: '15m',
  direction: 'LONG' as const,
  setupType: 'LIVE_SBK1_SETUP',
  sweptLevelPrice: 100,
  referencePrice: 100,
  stopLoss: 99,
  takeProfit: 102,
  observedAtMs: nowMs,
  maxStakeQuote: 25,
};
const signal = createDryRunCollectionSignal(signalInput);
const sameDecision = createDryRunCollectionSignal(signalInput);
assert.equal(signal.signalId, sameDecision.signalId);
assert.equal(signal.decisionId, signal.signalId);
assert.equal(signal.collectionMode, DRY_RUN_COLLECTION_MODE);
assert.equal(signal.riskLimits.maxStakeQuote, 25);
assert.equal(signal.riskLimits.maxLeverage, 1);
assert.equal(signal.expiresAtMs - signal.generatedAtMs, 60_000);

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-dry-run-collection-'));
const previousStorePath = process.env.SBK1_SIGNAL_STORE_PATH;
try {
  process.env.SBK1_SIGNAL_STORE_PATH = path.join(temporaryDirectory, 'signals.json');
  const adapter = new FreqtradeSignalAdapter();
  const limits = {
    expectedPair: signal.pair,
    expectedExchange: signal.exchange,
    expectedTimeframe: signal.timeframe,
    maxSignalsPerDay: 10,
    minimumSpacingMs: 5 * 60 * 1000,
    nowMs,
  };
  const submitted = await adapter.submitDryRunCollection(signal, limits);
  assert.equal(submitted.signal.signalId, signal.signalId);
  assert.equal(submitted.signal.collectionMode, DRY_RUN_COLLECTION_MODE);
  assert.equal((await adapter.submitDryRunCollection(signal, limits)).duplicate, true);

  const nextSignal = createDryRunCollectionSignal({
    ...signalInput,
    nowMs: nowMs + 60_000,
    generatedAtMs: nowMs + 60_000,
    observedAtMs: nowMs + 60_000,
    sweptLevelPrice: 101,
  });
  await assert.rejects(
    adapter.submitDryRunCollection(nextSignal, { ...limits, nowMs: nowMs + 60_000 }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'COLLECTION_SIGNAL_ALREADY_ACTIVE',
  );
  await adapter.updateStatus(signal.signalId, { status: 'REJECTED' });
  await assert.rejects(
    adapter.submitDryRunCollection(nextSignal, { ...limits, nowMs: nowMs + 60_000 }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'COLLECTION_SPACING_NOT_ELAPSED',
  );
  const dailyLimitSignal = createDryRunCollectionSignal({
    ...signalInput,
    nowMs: nowMs + 6 * 60_000,
    generatedAtMs: nowMs + 6 * 60_000,
    observedAtMs: nowMs + 6 * 60_000,
    sweptLevelPrice: 102,
  });
  await assert.rejects(
    adapter.submitDryRunCollection(dailyLimitSignal, {
      ...limits,
      nowMs: nowMs + 6 * 60_000,
      maxSignalsPerDay: 1,
    }),
    (error: unknown) => error instanceof SbkSignalValidationError && error.code === 'COLLECTION_DAILY_LIMIT_REACHED',
  );
} finally {
  if (previousStorePath === undefined) delete process.env.SBK1_SIGNAL_STORE_PATH;
  else process.env.SBK1_SIGNAL_STORE_PATH = previousStorePath;
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log('Dry-run collection readiness, market evidence, signal contract, and limits checks passed.');
