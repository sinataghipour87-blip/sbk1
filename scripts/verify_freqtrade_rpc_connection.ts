import dotenv from 'dotenv';
import process from 'node:process';
import { freqtradeBridge } from '../src/services/freqtradeBridge';

dotenv.config();

try {
  const [botState, balance, whitelist] = await Promise.all([
    freqtradeBridge.getStatus(),
    freqtradeBridge.getBalance(),
    freqtradeBridge.getWhitelist(),
  ]);
  const pair = freqtradeBridge.getConfiguredPair();
  const pairWhitelisted = whitelist.includes(pair);
  const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim();
  const signalBridgeConfigured = (process.env.SBK1_FREQTRADE_BRIDGE_TOKEN?.length ?? 0) >= 32;
  const liveExecutionReady =
    botState.status === 'running' &&
    !botState.dryRun &&
    !botState.forceEntryEnabled &&
    botState.strategy === 'SbkSignalStrategy' &&
    botState.exchange?.toLowerCase() === process.env.SBK1_SIGNAL_EXCHANGE?.trim().toLowerCase() &&
    botState.market === 'futures' &&
    botState.timeframe === timeframe &&
    pairWhitelisted &&
    signalBridgeConfigured;

  console.log(`Freqtrade RPC ping: ${JSON.stringify({ status: 'pong' })}`);
  console.log(
    JSON.stringify(
      {
        authenticatedRpc: true,
        botStatus: botState.status,
        dryRun: botState.dryRun,
        forceEntryEnabled: botState.forceEntryEnabled,
        strategy: botState.strategy,
        exchange: botState.exchange,
        market: botState.market,
        timeframe: botState.timeframe,
        openTradesCount: botState.openTradesCount,
        stakeCurrency: balance.currency,
        configuredPair: pair,
        pairWhitelisted,
        signalBridgeConfigured,
        liveExecutionReady,
        ordersPlaced: 0,
      },
      null,
      2,
    ),
  );

  if (!liveExecutionReady) {
    console.error('Freqtrade RPC is reachable, but live execution prerequisites are not satisfied.');
    process.exitCode = 1;
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Freqtrade RPC readiness check failed: ${reason}`);
  process.exitCode = 1;
}
