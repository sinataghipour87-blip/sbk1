import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDryRunFixtureSignal } from '../src/services/freqtradeDryRunFixture';
import { FreqtradeSignalAdapter } from '../src/services/freqtradeSignalAdapter';
import {
  getFreqtradeClosedTrades,
  getFreqtradeDashboardStatus,
} from '../src/services/freqtradeDashboard';

const adminToken = 'dashboard-test-admin-token-that-is-long-enough';
const bridgeToken = 'dashboard-test-bridge-token-that-is-long-enough';
const rpcUsername = 'dashboard-test-user';
const rpcPassword = 'dashboard-test-password';
const rpcAccessToken = 'dashboard-test-rpc-access-token';
const requestPaths: string[] = [];
let rpcDryRun = true;

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

const openTrade = {
  trade_id: 73,
  pair: 'BTC/USDT:USDT',
  is_open: true,
  is_short: false,
  amount: 0.001,
  amount_requested: 0.001,
  open_rate: 62_000,
  open_timestamp: Date.now() - 60_000,
  stake_amount: 62,
  has_open_orders: false,
  orders: [{
    order_id: 'dry-run-open-entry',
    status: 'closed',
    amount: 0.001,
    filled: 0.001,
    safe_price: 62_000,
    cost: 62,
    ft_order_side: 'buy',
    is_open: false,
    order_filled_timestamp: Date.now(),
  }],
  fee_open_cost: null,
  fee_close_cost: null,
  open_fill_timestamp: null,
  close_timestamp: null,
};
const closedTrade = {
  ...openTrade,
  trade_id: 72,
  is_open: false,
  enter_tag: 'sbk1_unmatched_rpc_trade_tag',
  fee_open: 0.001,
  fee_open_cost: 0.02,
  fee_open_currency: 'USDT',
  fee_close: 0.001,
  fee_close_cost: 0.02,
  fee_close_currency: 'USDT',
  close_rate: 62_100,
  close_profit: 0.001,
  close_profit_pct: 0.1,
  close_profit_abs: 0.1,
  exit_reason: 'roi',
  close_timestamp: Date.now(),
};

const mockFreqtrade = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  requestPaths.push(`${request.method} ${url.pathname}`);
  if (url.pathname === '/api/v1/ping') {
    respond(response, 200, { status: 'pong' });
    return;
  }
  if (url.pathname === '/api/v1/token/login') {
    if (request.headers.authorization !== `Basic ${Buffer.from(`${rpcUsername}:${rpcPassword}`).toString('base64')}`) {
      respond(response, 401, { detail: 'invalid credentials' });
      return;
    }
    await readBody(request);
    respond(response, 200, { access_token: rpcAccessToken });
    return;
  }
  if (request.headers.authorization !== `Bearer ${rpcAccessToken}`) {
    respond(response, 401, { detail: 'unauthorized' });
    return;
  }
  if (url.pathname === '/api/v1/show_config') {
    respond(response, 200, {
      strategy: 'SbkSignalStrategy',
      dry_run: rpcDryRun,
      exchange: 'bybit',
      trading_mode: 'futures',
      timeframe: '15m',
      demo_trading: false,
      max_open_trades: 1,
      state: 'running',
      force_entry_enable: false,
    });
    return;
  }
  if (url.pathname === '/api/v1/status') {
    respond(response, 200, [openTrade]);
    return;
  }
  if (url.pathname === '/api/v1/whitelist') {
    respond(response, 200, { whitelist: ['BTC/USDT:USDT'] });
    return;
  }
  if (url.pathname === '/api/v1/trades') {
    respond(response, 200, { trades: [closedTrade, openTrade] });
    return;
  }
  respond(response, 404, { detail: `unexpected route ${url.pathname}` });
});

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local test port.');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForServer(child: ChildProcess, url: string, logs: string[]): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`SBK1 test server exited early: ${logs.join('')}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`SBK1 test server did not become ready: ${logs.join('')}`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('SBK1 test server did not stop gracefully.'));
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-dashboard-e2e-'));
let child: ChildProcess | undefined;
let mockListening = false;
const previousFetch = globalThis.fetch;
const previousLocalStorage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
const clientRequests: Array<{ path: string; token: string | null }> = [];
let serverLogs = '';

try {
  await new Promise<void>((resolve, reject) => {
    mockFreqtrade.once('error', reject);
    mockFreqtrade.listen(0, '127.0.0.1', resolve);
  });
  mockListening = true;
  const rpcAddress = mockFreqtrade.address();
  if (!rpcAddress || typeof rpcAddress === 'string') throw new Error('Mock Freqtrade failed to bind.');

  const sbkPort = await reservePort();
  const baseUrl = `http://127.0.0.1:${sbkPort}`;
  const storePath = path.join(temporaryDirectory, 'signals.json');
  const killSwitchPath = path.join(temporaryDirectory, 'kill-switch.json');
  await writeFile(killSwitchPath, JSON.stringify({ active: false, updatedAt: Date.now() }), { mode: 0o600 });
  process.env.SBK1_SIGNAL_STORE_PATH = storePath;
  const queueSignal = createDryRunFixtureSignal({
    nowMs: Date.now(),
    exchange: 'bybit',
    pair: 'BTC/USDT:USDT',
    timeframe: '15m',
    referencePrice: 62_000,
    observedAtMs: Date.now(),
    source: 'Freqtrade DataProvider dashboard test fixture',
    maxStakeQuote: 100,
  });
  await new FreqtradeSignalAdapter().submit(queueSignal);

  const childEnvironment = {
    ...process.env,
    SBK1_PORT: String(sbkPort),
    SBK1_LISTEN_HOST: '127.0.0.1',
    SBK1_SIGNAL_STORE_PATH: storePath,
    SBK1_PREDICTION_ARCHIVE_PATH: path.join(temporaryDirectory, 'prediction-archive.sqlite'),
    SBK1_KILL_SWITCH_STATE_PATH: killSwitchPath,
    ADMIN_TOKEN: adminToken,
    SBK1_FREQTRADE_BRIDGE_TOKEN: bridgeToken,
    FREQTRADE_BASE_URL: `http://127.0.0.1:${rpcAddress.port}`,
    FREQTRADE_USERNAME: rpcUsername,
    FREQTRADE_PASSWORD: rpcPassword,
    FREQTRADE_PAIR: 'BTC/USDT:USDT',
    SBK1_FREQTRADE_PAIR: 'BTC/USDT:USDT',
    SBK1_SIGNAL_EXCHANGE: 'bybit',
    SBK1_FREQTRADE_TIMEFRAME: '15m',
    SBK1_DRY_RUN_FIXTURE_ENABLED: 'false',
    SBK1_DRY_RUN_COLLECTION_ENABLED: 'false',
  };
  child = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'server.ts'], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => { serverLogs += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { serverLogs += chunk.toString(); });
  await waitForServer(child, baseUrl, [serverLogs]);

  const unauthenticatedStatus = await fetch(`${baseUrl}/api/live/status`);
  assert.equal(unauthenticatedStatus.status, 403);
  const unauthenticatedHistory = await fetch(`${baseUrl}/api/live/closed-trades`);
  assert.equal(unauthenticatedHistory.status, 403);
  const unauthenticatedArchiveStatus = await fetch(`${baseUrl}/api/prediction-archive/status`);
  assert.equal(unauthenticatedArchiveStatus.status, 403);

  const backtestResponse = await fetch(`${baseUrl}/api/backtest/run`, { cache: 'no-store' });
  assert.equal(backtestResponse.status, 409, serverLogs);
  const backtest = await backtestResponse.json() as {
    code: string;
    label: string;
    counts: {
      archivedDecisions: number;
      replayableDecisions: number;
      requiredReplayableDecisions: number;
      additionalReplayableDecisionsNeeded: number;
    };
  };
  assert.equal(backtest.code, 'HISTORICAL_SIGNALS_UNAVAILABLE');
  assert.equal(backtest.label, 'REPLAY_SIMULATED');
  assert.equal(backtest.counts.archivedDecisions, 0);
  assert.equal(backtest.counts.replayableDecisions, 0);
  assert.equal(backtest.counts.requiredReplayableDecisions, 30);
  assert.equal(backtest.counts.additionalReplayableDecisionsNeeded, 30);

  const headers = { 'x-admin-token': adminToken };
  const statusResponse = await fetch(`${baseUrl}/api/live/status`, { headers, cache: 'no-store' });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json() as {
    killSwitchActive: boolean;
    activePositions: Array<{ tradeId: number }>;
  };
  assert.equal(status.activePositions.length, 1);
  assert.equal(status.activePositions[0]?.tradeId, openTrade.trade_id);

  const historyResponse = await fetch(`${baseUrl}/api/live/closed-trades`, { headers, cache: 'no-store' });
  assert.equal(historyResponse.status, 200);
  assert.equal(historyResponse.headers.get('cache-control'), 'no-store');
  const history = await historyResponse.json() as { trades: Array<{ trade_id: number; is_open: boolean }> };
  assert.equal(history.trades.length, 1);
  assert.equal(history.trades[0]?.trade_id, closedTrade.trade_id);
  assert.equal(history.trades[0]?.is_open, false);

  const archiveStatusResponse = await fetch(`${baseUrl}/api/prediction-archive/status`, {
    headers,
    cache: 'no-store',
  });
  assert.equal(archiveStatusResponse.status, 200);
  const archiveStatus = await archiveStatusResponse.json() as {
    decisions: number;
    confirmedOutcomes: number;
    wins: number;
    losses: number;
    unmatchedOutcomes: Array<{ freqtradeTradeId: number; reason: string }>;
  };
  assert.equal(archiveStatus.decisions, 0);
  assert.equal(archiveStatus.confirmedOutcomes, 1, 'startup sync must archive the RPC-returned closed trade');
  assert.equal(archiveStatus.wins, 1);
  assert.equal(archiveStatus.losses, 0);
  assert.deepEqual(archiveStatus.unmatchedOutcomes, [{
    freqtradeTradeId: closedTrade.trade_id,
    signalTag: closedTrade.enter_tag,
    reason: 'SIGNAL_NOT_ARCHIVED',
  }]);
  assert(requestPaths.includes('GET /api/v1/trades'), 'startup outcome sync must read through authenticated Freqtrade RPC');

  const repeatSyncResponse = await fetch(`${baseUrl}/api/prediction-archive/sync-freqtrade`, {
    method: 'POST',
    headers,
    cache: 'no-store',
  });
  assert.equal(repeatSyncResponse.status, 200);
  const repeatSync = await repeatSyncResponse.json() as { insertedCount: number; processedCount: number };
  assert.equal(repeatSync.processedCount, 1);
  assert.equal(repeatSync.insertedCount, 0, 'repeated RPC synchronization must be idempotent');

  const killResponse = await fetch(`${baseUrl}/api/live/kill-switch`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: true }),
  });
  assert.equal(killResponse.status, 200);
  const killResult = await killResponse.json() as {
    cancelledSignals: number;
    existingExchangeOrdersAffected: boolean;
    existingPositionsAffected: boolean;
    positionAuthority: string;
  };
  assert.equal(killResult.cancelledSignals, 1);
  assert.equal(killResult.existingExchangeOrdersAffected, false);
  assert.equal(killResult.existingPositionsAffected, false);
  assert.equal(killResult.positionAuthority, 'freqtrade');

  const activeStatus = await fetch(`${baseUrl}/api/live/status`, { headers });
  const activeStatusBody = await activeStatus.json() as { killSwitchActive: boolean; activePositions: unknown[] };
  assert.equal(activeStatusBody.killSwitchActive, true);
  assert.equal(activeStatusBody.activePositions.length, 1, 'kill switch must report, not close, the open Freqtrade position');

  const recoveredQueueRecord = await new FreqtradeSignalAdapter().get(queueSignal.signalId);
  assert.equal(recoveredQueueRecord?.status, 'CANCELLED');

  const disarmResponse = await fetch(`${baseUrl}/api/live/kill-switch`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(disarmResponse.status, 200);

  const disabledCollectionResponse = await fetch(`${baseUrl}/api/hunter/dry-run-collection`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(disabledCollectionResponse.status, 404, 'collection submission must remain unavailable by default');

  const blockedPollResponse = await fetch(
    `${baseUrl}/api/freqtrade/signals?pair=BTC%2FUSDT%3AUSDT&timeframe=15m`,
    { headers: { Authorization: `Bearer ${bridgeToken}` } },
  );
  assert.equal(blockedPollResponse.status, 503);
  const blockedPoll = await blockedPollResponse.json() as { code: string };
  assert.equal(blockedPoll.code, 'CALIBRATED_CONFIDENCE_UNAVAILABLE');

  const productionResponse = await fetch(`${baseUrl}/api/hunter/execute`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signal: { direction: 'LONG', setupType: 'TEST', timestamp: Date.now() },
      marketData: { status: 'LIVE', qualityAllowed: true, dataTimestamp: Date.now() },
    }),
  });
  assert.equal(productionResponse.status, 503);
  const productionResult = await productionResponse.json() as { code: string };
  assert.equal(productionResult.code, 'CALIBRATED_CONFIDENCE_UNAVAILABLE');

  await stopServer(child);
  child = undefined;
  rpcDryRun = false;
  childEnvironment.SBK1_DRY_RUN_COLLECTION_ENABLED = 'true';
  serverLogs = '';
  child = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'server.ts'], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => { serverLogs += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { serverLogs += chunk.toString(); });
  await waitForServer(child, baseUrl, [serverLogs]);

  const unsafeCollectionPoll = await fetch(
    `${baseUrl}/api/freqtrade/signals?pair=BTC%2FUSDT%3AUSDT&timeframe=15m`,
    { headers: { Authorization: `Bearer ${bridgeToken}` } },
  );
  assert.equal(unsafeCollectionPoll.status, 503);
  const unsafeCollectionResult = await unsafeCollectionPoll.json() as { code: string; stage: string };
  assert.equal(unsafeCollectionResult.code, 'CALIBRATED_CONFIDENCE_UNAVAILABLE');
  assert.equal(unsafeCollectionResult.stage, 'CALIBRATION');

  const unsafeProductionResponse = await fetch(`${baseUrl}/api/hunter/execute`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signal: { direction: 'LONG', setupType: 'TEST', timestamp: Date.now() },
      marketData: { status: 'LIVE', qualityAllowed: true, dataTimestamp: Date.now() },
    }),
  });
  assert.equal(unsafeProductionResponse.status, 503);
  const unsafeProductionResult = await unsafeProductionResponse.json() as { code: string };
  assert.equal(unsafeProductionResult.code, 'CALIBRATED_CONFIDENCE_UNAVAILABLE');

  rpcDryRun = true;
  const memoryStorage = new Map([['admin_token', adminToken]]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memoryStorage.get(key) ?? null,
      setItem: (key: string, value: string) => memoryStorage.set(key, value),
      removeItem: (key: string) => memoryStorage.delete(key),
      clear: () => memoryStorage.clear(),
      key: (index: number) => [...memoryStorage.keys()][index] ?? null,
      get length() { return memoryStorage.size; },
    } satisfies Storage,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, baseUrl);
    const requestHeaders = new Headers(init?.headers);
    clientRequests.push({ path: url.pathname, token: requestHeaders.get('x-admin-token') });
    return previousFetch(url, init);
  }) as typeof fetch;
  const dashboardStatus = await getFreqtradeDashboardStatus();
  const dashboardTrades = await getFreqtradeClosedTrades();
  assert.equal(dashboardStatus.freqtrade.dryRun, true);
  assert.equal(dashboardStatus.activePositions.length, 1);
  assert.equal(dashboardTrades[0]?.trade_id, closedTrade.trade_id);
  assert.deepEqual(
    clientRequests.map(({ path: requestPath, token }) => [requestPath, token]),
    [
      ['/api/live/status', adminToken],
      ['/api/live/closed-trades', adminToken],
    ],
  );
  assert.equal(requestPaths.some((requestPath) => /\/(forceenter|forceexit|forcebuy|forcesell)$/.test(requestPath)), false);
  console.log('Admin-authenticated dashboard status/history and queued-kill-switch behavior passed against local mock Freqtrade RPC.');
} finally {
  globalThis.fetch = previousFetch;
  if (previousLocalStorage === undefined) delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousLocalStorage });
  if (child) await stopServer(child);
  if (mockListening) {
    await new Promise<void>((resolve, reject) => mockFreqtrade.close((error) => error ? reject(error) : resolve()));
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
