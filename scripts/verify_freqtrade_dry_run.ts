import dotenv from 'dotenv';
import process from 'node:process';
import { freqtradeBridge } from '../src/services/freqtradeBridge';
import { getDryRunFixtureReadinessError } from '../src/services/freqtradeDryRunFixture';

dotenv.config();

try {
  const [botState, whitelist] = await Promise.all([
    freqtradeBridge.getStatus(),
    freqtradeBridge.getWhitelist(),
  ]);
  const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() || '';
  const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim() || '';
  const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() || '';
  const readinessError = getDryRunFixtureReadinessError(botState, {
    enabled: process.env.SBK1_DRY_RUN_FIXTURE_ENABLED === 'true',
    killSwitchActive: false,
    configuredPair: freqtradeBridge.getConfiguredPair(),
    expectedPair: pair,
    expectedExchange: exchange,
    expectedTimeframe: timeframe,
    whitelist,
  });
  const bridgeConfigured = (process.env.SBK1_FREQTRADE_BRIDGE_TOKEN?.length ?? 0) >= 32;
  const configReady = !readinessError && bridgeConfigured;

  console.log(JSON.stringify({
    authenticatedRpc: true,
    botStatus: botState.status,
    dryRun: botState.dryRun,
    forceEntryEnabled: botState.forceEntryEnabled,
    strategy: botState.strategy,
    exchange: botState.exchange,
    market: botState.market,
    timeframe: botState.timeframe,
    pair,
    pairWhitelisted: whitelist.includes(pair),
    fixtureEnabled: process.env.SBK1_DRY_RUN_FIXTURE_ENABLED === 'true',
    bridgeConfigured,
    freqtradeDryRunConfigReady: configReady,
    readinessError: readinessError || (!bridgeConfigured ? 'A bridge token of at least 32 characters is required.' : undefined),
    ordersPlaced: 0,
  }, null, 2));

  if (!configReady) process.exitCode = 1;
} catch (error) {
  console.error(`Freqtrade dry-run readiness check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
