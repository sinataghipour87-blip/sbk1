import assert from 'node:assert/strict';
import { isValidSbk1HealthResponse, validateRuntimeSettings } from './run_sbk1';

assert.equal(isValidSbk1HealthResponse({ status: 'ok', service: 'sbk1' }), true);
assert.equal(isValidSbk1HealthResponse({ status: 'ok', service: 'other' }), false);
assert.equal(isValidSbk1HealthResponse({ status: 'ok' }), false);
assert.equal(isValidSbk1HealthResponse('<html>stale SPA fallback</html>'), false);

const apiPassword = 'freqtrade-api-password-for-runtime-test';
const environment = {
  FREQTRADE_BASE_URL: 'http://127.0.0.1:8080',
  FREQTRADE_USERNAME: 'runtime-test-user',
  FREQTRADE_PASSWORD: apiPassword,
  ADMIN_TOKEN: 'runtime-test-admin-token-that-is-long-enough',
  FREQTRADE_PAIR: 'BTC/USDT:USDT',
  SBK1_FREQTRADE_PAIR: 'BTC/USDT:USDT',
  SBK1_SIGNAL_EXCHANGE: 'BYBIT',
  SBK1_FREQTRADE_TIMEFRAME: '15m',
  SBK1_FREQTRADE_BRIDGE_TOKEN: 'runtime-test-bridge-token-that-is-long-enough',
  SBK1_BRIDGE_URL: 'http://127.0.0.1:3000',
  SBK1_SIGNAL_RISK_PCT: '1',
  SBK1_SIGNAL_MAX_LEVERAGE: '25',
  SBK1_SIGNAL_MAX_STAKE_QUOTE: '1000000000',
};
const config = {
  dry_run: true,
  dry_run_wallet: 1000,
  stake_amount: 'unlimited',
  max_open_trades: 1,
  tradable_balance_ratio: 0.9,
  margin_mode: 'isolated',
  unfilledtimeout: { entry: 15, exit: 15, unit: 'seconds' },
  order_types: {
    emergency_exit: 'market',
    force_exit: 'market',
    stoploss: 'market',
    stoploss_on_exchange: false,
  },
  strategy: 'SbkSignalStrategy',
  trading_mode: 'futures',
  timeframe: '15m',
  internals: { process_throttle_secs: 1 },
  force_entry_enable: false,
  exchange: {
    name: 'bybit',
    pair_whitelist: ['BTC/USDT:USDT'],
  },
  api_server: {
    enabled: true,
    listen_ip_address: '127.0.0.1',
    listen_port: 8080,
    username: 'runtime-test-user',
    password: apiPassword,
  },
};

const settings = validateRuntimeSettings(config, environment);
assert.equal(settings.market, 'futures');
assert.equal(settings.apiBaseUrl, 'http://127.0.0.1:8080/api/v1');
assert.equal(settings.bridgeBaseUrl, 'http://127.0.0.1:3000');
assert.throws(
  () => validateRuntimeSettings({ ...config, freqai: { enabled: true } }, environment),
  /FreqAI integration was removed from SBK1/,
);
assert.throws(
  () => validateRuntimeSettings({
    ...config,
    internals: { process_throttle_secs: 5 },
  }, environment),
  /process_throttle_secs must be 1 second/,
);

const blankBridgeSettings = validateRuntimeSettings(config, {
  ...environment,
  SBK1_PORT: '3002',
  SBK1_BRIDGE_URL: '',
});
assert.equal(blankBridgeSettings.bridgeBaseUrl, 'http://127.0.0.1:3002');

assert.equal(
  validateRuntimeSettings({
    ...config,
    api_server: { ...config.api_server, username: '', password: '' },
  }, {
    ...environment,
    FREQTRADE__API_SERVER__USERNAME: environment.FREQTRADE_USERNAME,
    FREQTRADE__API_SERVER__PASSWORD: environment.FREQTRADE_PASSWORD,
  }).apiPort,
  8080,
);

assert.throws(
  () => validateRuntimeSettings({ ...config, dry_run: false }, environment),
  /LIVE در این یکپارچه‌سازی غیرفعال است/,
);
const liveEnabledEnvironment = { ...environment, SBK1_LIVE_ENABLED: 'true' };
assert.throws(
  () => validateRuntimeSettings({ ...config, dry_run: false }, liveEnabledEnvironment),
  /LIVE در این یکپارچه‌سازی غیرفعال است/,
);
const liveConfigWithNamedCredentials = {
  ...config,
  dry_run: false,
  exchange: { ...config.exchange, key: 'private-test-key', secret: 'private-test-secret' },
};
assert.throws(
  () => validateRuntimeSettings(liveConfigWithNamedCredentials, liveEnabledEnvironment),
  /LIVE در این یکپارچه‌سازی غیرفعال است/,
);
assert.throws(
  () => validateRuntimeSettings({
    ...liveConfigWithNamedCredentials,
    force_entry_enable: true,
  }, liveEnabledEnvironment),
  /force_entry_enable باید false/,
);
assert.throws(
  () => validateRuntimeSettings({ ...config, stake_amount: 100 }, environment),
  /stake_amount must be unlimited/,
);
assert.throws(
  () => validateRuntimeSettings({ ...config, max_open_trades: 2 }, environment),
  /max_open_trades must be exactly 1/,
);
assert.throws(
  () => validateRuntimeSettings({ ...config, tradable_balance_ratio: 0.91 }, environment),
  /no greater than 0.9/,
);
assert.throws(
  () => validateRuntimeSettings({ ...config, margin_mode: 'cross' }, environment),
  /margin_mode must be isolated/,
);
assert.throws(
  () => validateRuntimeSettings({
    ...config,
    order_types: { ...config.order_types, emergency_exit: 'limit' },
  }, environment),
  /market stoploss and emergency\/force exits/,
);
assert.throws(
  () => validateRuntimeSettings(config, {
    ...environment,
    SBK1_DRY_RUN_FIXTURE_ENABLED: 'true',
    SBK1_SIGNAL_RISK_PCT: '1.01',
  }),
  /Fixture risk limits must be finite and no greater than 1%/,
);
assert.throws(
  () => validateRuntimeSettings({ ...config, force_entry_enable: true }, environment),
  /force_entry_enable باید false/,
);
assert.throws(
  () => validateRuntimeSettings({
    ...config,
    exchange: { ...config.exchange, pair_whitelist: ['ETH/USDT:USDT'] },
  }, environment),
  /exchange and pair whitelist/,
);
assert.throws(
  () => validateRuntimeSettings({
    ...config,
    api_server: { ...config.api_server, username: 'different-user' },
  }, environment),
  /configured credentials/,
);
assert.throws(
  () => validateRuntimeSettings(config, {
    ...environment,
    FREQTRADE__API_SERVER__USERNAME: 'different-user',
    FREQTRADE__API_SERVER__PASSWORD: apiPassword,
  }),
  /configured credentials/,
);
assert.throws(
  () => validateRuntimeSettings(config, { ...environment, FREQTRADE_PAIR: 'ETH/USDT:USDT' }),
  /must match exactly/,
);
assert.throws(
  () => validateRuntimeSettings(config, {
    ...environment,
    FREQTRADE_BASE_URL: 'http://freqtrade.internal:8080',
  }),
  /must target loopback/,
);
assert.throws(
  () => validateRuntimeSettings(config, {
    ...environment,
    SBK1_FREQTRADE_BRIDGE_TOKEN: 'too-short',
  }),
  /at least 32 characters/,
);
assert.throws(
  () => validateRuntimeSettings(config, {
    ...environment,
    ADMIN_TOKEN: 'too-short',
  }),
  /ADMIN_TOKEN must contain at least 32 characters/,
);

console.log('SBK1 runtime configuration and fail-closed startup checks passed.');
