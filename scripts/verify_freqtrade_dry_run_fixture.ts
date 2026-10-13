import assert from 'node:assert/strict';
import {
  createDryRunFixtureSignal,
  DRY_RUN_FIXTURE_SETUP_PREFIX,
  getDryRunFixtureReadinessError,
} from '../src/services/freqtradeDryRunFixture';
import type { FreqtradeBotState } from '../src/services/freqtradeBridge';
import { SbkSignalValidationError } from '../src/services/freqtradeSignalAdapter';

const nowMs = Date.now();
const botState: FreqtradeBotState = {
  status: 'running',
  ping: true,
  strategy: 'SbkSignalStrategy',
  exchange: 'bybit',
  market: 'futures',
  timeframe: '15m',
  demoTrading: false,
  dryRun: true,
  forceEntryEnabled: false,
  openTradesCount: 0,
  lastChecked: nowMs,
};
const configuration = {
  enabled: true,
  killSwitchActive: false,
  configuredPair: 'BTC/USDT:USDT',
  expectedPair: 'BTC/USDT:USDT',
  expectedExchange: 'bybit',
  expectedTimeframe: '15m',
  whitelist: ['BTC/USDT:USDT'],
};

assert.equal(getDryRunFixtureReadinessError(botState, configuration), undefined);
assert.equal(
  getDryRunFixtureReadinessError({ ...botState, demoTrading: true }, configuration),
  undefined,
  'the existing fixture readiness behavior remains unchanged when collection mode is not requested',
);
assert.match(
  getDryRunFixtureReadinessError({ ...botState, dryRun: false }, configuration) || '',
  /dry_run=true/,
);
assert.match(
  getDryRunFixtureReadinessError(botState, { ...configuration, enabled: false }) || '',
  /not explicitly enabled/,
);
assert.match(
  getDryRunFixtureReadinessError(botState, { ...configuration, killSwitchActive: true }) || '',
  /kill switch is engaged/,
);
assert.match(
  getDryRunFixtureReadinessError({ ...botState, forceEntryEnabled: true }, configuration) || '',
  /force-entry must remain disabled/,
);
assert.match(
  getDryRunFixtureReadinessError({ ...botState, openTradesCount: 1 }, configuration) || '',
  /existing Freqtrade trades/,
);
assert.equal(
  getDryRunFixtureReadinessError(
    { ...botState, openTradesCount: 1 },
    configuration,
    { requireNoOpenTrades: false },
  ),
  undefined,
);
assert.match(
  getDryRunFixtureReadinessError(botState, { ...configuration, whitelist: [] }) || '',
  /configured and whitelisted/,
);

const signal = createDryRunFixtureSignal({
  nowMs,
  exchange: 'bybit',
  pair: 'BTC/USDT:USDT',
  timeframe: '15m',
  referencePrice: 62_000,
  observedAtMs: nowMs,
  source: 'Bybit Linear Futures Ticker (BTCUSDT)',
  maxStakeQuote: 100,
});
assert.equal(signal.market, 'futures');
assert.equal(signal.direction, 'LONG');
assert.equal(signal.entryConditions.setupType.startsWith(DRY_RUN_FIXTURE_SETUP_PREFIX), true);
assert.equal(signal.expiresAtMs - signal.generatedAtMs, 60_000);
assert.equal(signal.riskLimits.maxStakeQuote, 100);
assert.equal(signal.riskLimits.riskBudgetPct, 0.1);
assert.equal(signal.riskLimits.maxLeverage, 1);

const cappedSignal = createDryRunFixtureSignal({
  nowMs,
  exchange: 'bybit',
  pair: 'BTC/USDT:USDT',
  timeframe: '15m',
  referencePrice: 62_000,
  observedAtMs: nowMs,
  source: 'Bybit Linear Futures Ticker (BTCUSDT)',
  maxStakeQuote: 10,
});
assert.equal(cappedSignal.riskLimits.maxStakeQuote, 10);

assert.throws(
  () => createDryRunFixtureSignal({
    nowMs,
    exchange: 'bybit',
    pair: 'BTC/USDT:USDT',
    timeframe: '15m',
    referencePrice: 0,
    observedAtMs: nowMs,
    source: 'Bybit Linear Futures Ticker (BTCUSDT)',
    maxStakeQuote: 100,
  }),
  (error: unknown) => error instanceof SbkSignalValidationError,
);
assert.throws(
  () => createDryRunFixtureSignal({
    nowMs,
    exchange: 'bybit',
    pair: 'BTC/USDT:USDT',
    timeframe: '15m',
    referencePrice: 62_000,
    observedAtMs: nowMs - 56_000,
    source: 'Bybit Linear Futures Ticker (BTCUSDT)',
    maxStakeQuote: 100,
  }),
  (error: unknown) => error instanceof SbkSignalValidationError,
);

console.log('Dry-run fixture gates and signal contract checks passed.');
