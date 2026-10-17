import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FreqtradeSignalAdapter } from '../src/services/freqtradeSignalAdapter';
import type { FreqtradeTrade } from '../src/services/freqtradeBridge';
import {
  ServerSignalRunner,
  type ServerSignalAuditRecord,
} from '../src/services/serverSignalRunner';
import type { FreqtradeMarketSnapshot } from '../src/services/freqtradeMarketDataBridge';
import { OperationalTradeArchive } from '../src/services/operationalTradeArchive';
import type { OperationalTradeArchiveMetadata } from '../src/services/operationalTradeArchive';
import type { SbkFreqtradeSignalRecord } from '../src/services/freqtradeSignalAdapter';

const fixturePath = path.resolve('scripts/fixtures/CONTRACT_TEST_ONLY.json');
const parsedFixture: unknown = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.equal(typeof parsedFixture, 'object');
assert.notEqual(parsedFixture, null);
const fixtureRecord = parsedFixture as Record<string, unknown>;
assert.equal(typeof fixtureRecord.candle, 'object');
assert.notEqual(fixtureRecord.candle, null);
const candleRecord = fixtureRecord.candle as Record<string, unknown>;
for (const field of ['timestampMs', 'open', 'high', 'low', 'close', 'volume']) {
  assert.equal(typeof candleRecord[field], 'number');
}
const candle = {
  timestampMs: candleRecord.timestampMs as number,
  open: candleRecord.open as number,
  high: candleRecord.high as number,
  low: candleRecord.low as number,
  close: candleRecord.close as number,
  volume: candleRecord.volume as number,
};
const timeframeMs = 15 * 60_000;
let currentNowMs = candle.timestampMs + timeframeMs + 1_000;
const snapshot: FreqtradeMarketSnapshot = {
  contractVersion: 'sbk1.freqtrade.market-snapshot.v3',
  source: 'freqtrade.dataprovider',
  exchange: 'bybit',
  market: 'futures',
  pair: 'BTC/USDT:USDT',
  timeframe: '15m',
  generatedAtMs: currentNowMs,
  candles: [candle],
  additionalCandles: {},
  ticker: null,
  orderBook: null,
  fundingRate: null,
};
const status = {
  status: 'running' as const,
  ping: true,
  exchange: 'bybit',
  market: 'futures' as const,
  timeframe: '15m',
  dryRun: true,
  forceEntryEnabled: false,
  openTradesCount: 0,
  maxOpenTrades: 3,
  lastChecked: currentNowMs,
};

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-signal-runner-'));
const originalSignalStore = process.env.SBK1_SIGNAL_STORE_PATH;
const originalPair = process.env.FREQTRADE_PAIR;
const originalExchange = process.env.SBK1_SIGNAL_EXCHANGE;
const originalLiveEnabled = process.env.SBK1_LIVE_ENABLED;
const originalDateNow = Date.now;
process.env.SBK1_SIGNAL_STORE_PATH = path.join(temporaryDirectory, 'signals.json');
process.env.FREQTRADE_PAIR = 'BTC/USDT:USDT';
process.env.SBK1_SIGNAL_EXCHANGE = 'bybit';
Date.now = () => currentNowMs;

try {
  const adapter = new FreqtradeSignalAdapter();
  const archive = new OperationalTradeArchive(path.join(temporaryDirectory, 'operational-trades.json'));
  const audit: ServerSignalAuditRecord[] = [];
  const rpcOpenTrades: FreqtradeTrade[] = [];
  const mockFreqtradeRpc = {
    getOpenTrades: async (): Promise<FreqtradeTrade[]> => [...rpcOpenTrades],
  };
  let analysisCalls = 0;
  let exitEvaluationCalls = 0;
  async function namedArchiveSignalMock(
    record: SbkFreqtradeSignalRecord,
    metadata: OperationalTradeArchiveMetadata,
  ): Promise<void> {
    await archive.recordSignalLifecycle(record, metadata);
  }
  const dependencies = {
    getFreqtradeStatus: async () => status,
    getOpenTrades: () => mockFreqtradeRpc.getOpenTrades(),
    getFreqtradeBalance: async () => ({ equity: 1_000, available: 100, currency: 'USDT' }),
    getSnapshot: () => snapshot,
    isKillSwitchActive: () => false,
    submitSignal: (signal: Parameters<FreqtradeSignalAdapter['submit']>[0], expected: {
      expectedPair: string;
      expectedExchange: string;
      expectedTimeframe: string;
    }) => adapter.submit(signal, { nowMs: currentNowMs, ...expected }),
    recordSignalArchive: namedArchiveSignalMock,
    getSignal: (signalId: string) => adapter.get(signalId),
    submitExitSignal: (signal: Parameters<typeof adapter.submitExitSignal>[0], at: number) =>
      adapter.submitExitSignal(signal, at),
    evaluateExit: async () => {
      exitEvaluationCalls += 1;
      return { shouldExit: true, reason: 'CONTRACT_TEST_ONLY thesis invalidation' };
    },
    analyze: async () => {
      analysisCalls += 1;
      return {
        candidate: {
          direction: 'SHORT' as const,
          entryPrice: candle.close,
          stopLoss: candle.high,
          takeProfit: candle.low,
          engineScore: 75,
          setupType: 'CONTRACT_TEST_ONLY',
        },
        reason: 'CONTRACT_TEST_ONLY decision candidate.',
      };
    },
    appendAudit: async (record: ServerSignalAuditRecord) => {
      audit.push(record);
    },
    now: () => currentNowMs,
    minimumCandles: 1,
  };

  const firstRunner = new ServerSignalRunner(dependencies);
  await firstRunner.runOnce();
  await firstRunner.runOnce();
  assert.equal(analysisCalls, 1, 'the same closed candle must only be analyzed once per runner instance');

  const restartedRunner = new ServerSignalRunner(dependencies);
  await restartedRunner.runOnce();
  const stored = await adapter.getForStrategy(snapshot.pair, snapshot.timeframe);
  assert.equal(stored.length, 1, 'a restarted runner must not queue a second signal for the same candle');
  assert.equal(stored[0]?.signal.direction, 'SHORT');
  assert.equal(stored[0]?.signal.referencePrice, candle.close);
  assert.equal(stored[0]?.signal.entryConditions.stopLoss, candle.high);
  assert.equal(stored[0]?.signal.entryConditions.takeProfit, candle.low);
  assert.equal(stored[0]?.signal.engineScore, 75);
  const archivedDecision = await archive.getBySignalId(stored[0]!.signal.signalId);
  assert.ok(archivedDecision, 'accepted dry-run decision is archived');
  assert.equal(archivedDecision.decision.decisionId, stored[0]?.signal.decisionId);
  assert.equal(archivedDecision.featureSnapshot?.entryPrice, candle.close);
  assert.equal(archivedDecision.featureSnapshot?.candleClose, candle.close);
  assert.equal(archivedDecision.featureVersion, 'server-signal-features-v1');
  assert.equal(archivedDecision.modelVersion, 'server-signal-runner-current');
  assert.equal(archivedDecision.codeVersion, 'unversioned');
  assert.equal(audit.filter((entry) => entry.signalId === stored[0]?.signal.signalId).length, 2);
  assert.equal(audit.filter((entry) => entry.duplicate === true).length, 1);

  assert.equal(candle.close, 92_378.82);
  const entryRecord = stored[0]!;
  for (const update of [
    { status: 'STRATEGY_ACCEPTED' as const },
    { status: 'ORDER_SUBMITTED' as const, tradeId: 73 },
    { status: 'FILLED' as const, tradeId: 73 },
  ]) {
    await archive.recordSignalLifecycle(await adapter.updateStatus(entryRecord.signal.signalId, update));
  }

  rpcOpenTrades.push({
    trade_id: 73,
    pair: snapshot.pair,
    enter_tag: entryRecord.signal.signalId,
    is_open: true,
    is_short: true,
    amount: 0.01,
    amount_requested: 0.01,
    open_rate: candle.close,
    stake_amount: 100,
    has_open_orders: false,
    orders: [],
    fee_open_cost: null,
    fee_close_cost: null,
    open_fill_timestamp: currentNowMs,
    close_timestamp: null,
    leverage: 1,
  });
  assert.equal((await mockFreqtradeRpc.getOpenTrades()).length, 1);
  const closedTrade: FreqtradeTrade = {
    ...rpcOpenTrades[0]!,
    is_open: false,
    fee_open_cost: 0.03,
    fee_close_cost: 0.04,
    close_timestamp: currentNowMs + 60_000,
    close_rate: candle.close - 100,
    close_profit_abs: 0.93,
    realized_profit: 0.93,
    exit_reason: 'stop_loss',
  };
  await archive.recordFreqtradeTrade(entryRecord.signal.signalId, closedTrade, 'DRY_RUN', currentNowMs + 60_000);
  const completedArchiveRecord = await archive.getBySignalId(entryRecord.signal.signalId);
  assert.equal(completedArchiveRecord?.outcome?.source, 'FREQTRADE_RPC');
  assert.equal(completedArchiveRecord?.outcome?.tradeId, 73);
  assert.equal(completedArchiveRecord?.outcome?.pnlUsd, 0.93);
  assert.equal(completedArchiveRecord?.outcome?.feesUsd, 0.07);
  assert.equal(completedArchiveRecord?.outcome?.exitReason, 'stop_loss');
  status.openTradesCount = 1;
  status.maxOpenTrades = 1;
  currentNowMs += timeframeMs + 1_000;
  const nextCandle = { ...candle, timestampMs: candle.timestampMs + timeframeMs };
  const exitSnapshot: FreqtradeMarketSnapshot = {
    ...snapshot,
    generatedAtMs: currentNowMs,
    candles: [candle, nextCandle],
  };
  const exitRunner = new ServerSignalRunner({
    ...dependencies,
    getSnapshot: () => exitSnapshot,
    now: () => currentNowMs,
  });
  await exitRunner.runOnce();
  assert.equal(exitEvaluationCalls, 1, 'exit engine runs only for an RPC-reported open trade');
  const pendingExits = await adapter.getPendingExitSignals(snapshot.pair);
  assert.equal(pendingExits.length, 1);
  assert.equal(pendingExits[0]?.tradeId, 73);
  assert.equal(pendingExits[0]?.entryTag, entryRecord.signal.signalId);
  const repeatedExit = await adapter.submitExitSignal(pendingExits[0]!, currentNowMs);
  assert.equal(repeatedExit.duplicate, true, 'repeated exit submissions must be idempotent');
  await adapter.updateExitSignalStatus(pendingExits[0]!.exitId, 'CONFIRMED');
  await adapter.updateExitSignalStatus(pendingExits[0]!.exitId, 'CLOSED');
  assert.equal((await adapter.submitExitSignal(pendingExits[0]!, currentNowMs)).status, 'CLOSED');

  rpcOpenTrades.splice(0);
  let liveSubmissions = 0;
  async function namedLiveSignalSubmitMock(
    signal: Parameters<FreqtradeSignalAdapter['submit']>[0],
    expected: { expectedPair: string; expectedExchange: string; expectedTimeframe: string },
  ): Promise<SbkFreqtradeSignalRecord> {
    liveSubmissions += 1;
    return adapter.submit(signal, { nowMs: currentNowMs, ...expected });
  }
  const liveStatus = { ...status, dryRun: false, openTradesCount: 0, maxOpenTrades: 3 };
  const liveSnapshot: FreqtradeMarketSnapshot = {
    ...snapshot,
    generatedAtMs: currentNowMs,
    candles: [{ ...candle, timestampMs: currentNowMs - timeframeMs - 1 }],
  };
  process.env.SBK1_LIVE_ENABLED = 'false';
  const liveDisabledRunner = new ServerSignalRunner({
    ...dependencies,
    getFreqtradeStatus: async () => liveStatus,
    getSnapshot: () => liveSnapshot,
    submitSignal: namedLiveSignalSubmitMock,
    now: () => currentNowMs,
  });
  await liveDisabledRunner.runOnce();
  assert.equal(liveSubmissions, 0, 'a live Freqtrade config is rejected while the named live flag mock is false');

  process.env.SBK1_LIVE_ENABLED = 'true';
  const liveEnabledRunner = new ServerSignalRunner({
    ...dependencies,
    getFreqtradeStatus: async () => liveStatus,
    getSnapshot: () => liveSnapshot,
    submitSignal: namedLiveSignalSubmitMock,
    now: () => currentNowMs,
  });
  await liveEnabledRunner.runOnce();
  assert.equal(liveSubmissions, 1, 'explicitly enabled live mode can queue signals with guarded Freqtrade settings');

  rpcOpenTrades.splice(0);
  status.openTradesCount = 0;
  currentNowMs += timeframeMs + 1_000;
  const closedSnapshot: FreqtradeMarketSnapshot = {
    ...exitSnapshot,
    generatedAtMs: currentNowMs,
    candles: [candle, nextCandle, { ...nextCandle, timestampMs: nextCandle.timestampMs + timeframeMs }],
  };
  const closedRunner = new ServerSignalRunner({
    ...dependencies,
    getSnapshot: () => closedSnapshot,
    isKillSwitchActive: () => true,
    now: () => currentNowMs,
  });
  await closedRunner.runOnce();
  assert.equal(exitEvaluationCalls, 1, 'a closed trade must not be evaluated or receive another exit');
  assert.equal((await adapter.getPendingExitSignals(snapshot.pair)).length, 0);
  console.log('Named Freqtrade RPC mock verified entry, one-shot exit signal, and closed-trade idempotency.');
} finally {
  if (originalSignalStore === undefined) delete process.env.SBK1_SIGNAL_STORE_PATH;
  else process.env.SBK1_SIGNAL_STORE_PATH = originalSignalStore;
  if (originalPair === undefined) delete process.env.FREQTRADE_PAIR;
  else process.env.FREQTRADE_PAIR = originalPair;
  if (originalExchange === undefined) delete process.env.SBK1_SIGNAL_EXCHANGE;
  else process.env.SBK1_SIGNAL_EXCHANGE = originalExchange;
  if (originalLiveEnabled === undefined) delete process.env.SBK1_LIVE_ENABLED;
  else process.env.SBK1_LIVE_ENABLED = originalLiveEnabled;
  Date.now = originalDateNow;
  await rm(temporaryDirectory, { recursive: true, force: true });
}
