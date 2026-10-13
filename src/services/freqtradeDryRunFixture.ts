import {
  deriveSbkSignalIds,
  DRY_RUN_FIXTURE_SETUP_PREFIX,
  SBK_SIGNAL_CONTRACT_VERSION,
  validateSbkFreqtradeSignal,
  type SbkFreqtradeSignal,
} from './freqtradeSignalAdapter';
import type { FreqtradeBotState } from './freqtradeBridge';

export { DRY_RUN_FIXTURE_SETUP_PREFIX };

export interface DryRunFixtureConfiguration {
  enabled: boolean;
  killSwitchActive: boolean;
  configuredPair: string;
  expectedPair: string;
  expectedExchange: string;
  expectedTimeframe: string;
  whitelist: string[];
}

export function getDryRunFixtureReadinessError(
  state: FreqtradeBotState,
  configuration: DryRunFixtureConfiguration,
  options: { requireNoOpenTrades?: boolean; requireDemoTradingOff?: boolean } = {},
): string | undefined {
  if (!configuration.enabled) return 'Dry-run fixture mode is not explicitly enabled.';
  if (configuration.killSwitchActive) return 'The SBK1 kill switch is engaged.';
  if (state.status !== 'running') return 'Freqtrade is not running.';
  if (!state.dryRun) return 'Freqtrade RPC did not confirm dry_run=true.';
  if (options.requireDemoTradingOff === true && state.demoTrading !== false) {
    return 'Freqtrade RPC did not confirm demo_trading=false.';
  }
  if (options.requireNoOpenTrades !== false && state.openTradesCount !== 0) {
    return 'Close or reconcile existing Freqtrade trades before starting a dry-run fixture test.';
  }
  if (state.forceEntryEnabled) return 'Freqtrade force-entry must remain disabled.';
  if (state.strategy !== 'SbkSignalStrategy') return 'Freqtrade is not running SbkSignalStrategy.';
  if (state.exchange?.toLowerCase() !== configuration.expectedExchange.toLowerCase()) {
    return 'Freqtrade exchange does not match the fixture exchange.';
  }
  if (state.market !== 'futures') return 'Dry-run fixtures require futures trading mode.';
  if (state.timeframe !== configuration.expectedTimeframe) {
    return 'Freqtrade timeframe does not match the fixture timeframe.';
  }
  if (
    configuration.expectedExchange.toLowerCase() !== 'bybit' ||
    configuration.expectedPair !== 'BTC/USDT:USDT'
  ) {
    return 'Dry-run fixtures are limited to the configured Bybit BTC/USDT futures feed.';
  }
  if (
    !configuration.expectedPair ||
    configuration.configuredPair !== configuration.expectedPair ||
    !configuration.whitelist.includes(configuration.expectedPair)
  ) {
    return 'The configured and whitelisted Freqtrade pair must match the fixture pair.';
  }
  return undefined;
}

export function createDryRunFixtureSignal(input: {
  nowMs: number;
  exchange: string;
  pair: string;
  timeframe: string;
  referencePrice: number;
  observedAtMs: number;
  source: string;
  maxStakeQuote: number;
}): SbkFreqtradeSignal {
  const stopLoss = input.referencePrice * 0.99;
  const takeProfit = input.referencePrice * 1.02;
  const setupType = `${DRY_RUN_FIXTURE_SETUP_PREFIX}${input.nowMs}`;
  const ids = deriveSbkSignalIds({
    pair: input.pair,
    direction: 'LONG',
    setupType,
    generatedAtMs: input.nowMs,
    sweptLevelPrice: input.referencePrice,
    referencePrice: input.referencePrice,
    stopLoss,
    takeProfit,
  });

  return validateSbkFreqtradeSignal(
    {
      contractVersion: SBK_SIGNAL_CONTRACT_VERSION,
      ...ids,
      exchange: input.exchange,
      market: 'futures',
      pair: input.pair,
      direction: 'LONG',
      timeframe: input.timeframe,
      generatedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + 60_000,
      referencePrice: input.referencePrice,
      dataQuality: {
        status: 'LIVE',
        source: input.source,
        observedAtMs: input.observedAtMs,
        maxAgeMs: 55_000,
      },
      entryConditions: {
        setupType,
        stopLoss,
        takeProfit,
        maxPriceDeviationBps: 100,
      },
      riskLimits: {
        riskBudgetPct: 0.1,
        maxStakeQuote: input.maxStakeQuote,
        maxLeverage: 1,
      },
    },
    {
      nowMs: input.nowMs,
      expectedPair: input.pair,
      expectedExchange: input.exchange,
      expectedTimeframe: input.timeframe,
    },
  );
}
