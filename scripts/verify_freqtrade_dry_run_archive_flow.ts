import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveSbkSignalIds,
  SBK_ENTRY_AUTHORIZATION_VERSION,
  FreqtradeSignalAdapter,
  SBK_SIGNAL_CONTRACT_VERSION,
} from '../src/services/freqtradeSignalAdapter';
import type { FreqtradeTrade } from '../src/services/freqtradeBridge';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-dry-run-archive-flow-'));
const adminToken = 'dry-run-archive-flow-admin-token';
const bridgeToken = 'dry-run-archive-flow-bridge-token';
const rpcUsername = 'dry-run-archive-flow-user';
const rpcPassword = 'dry-run-archive-flow-password';
const pair = 'BTC/USDT:USDT';
const timeframe = '15m';
const tradeId = 731;
let open = true;
let filledAmount = 0;
let averageFillPrice = 60_000;
let forceExitRequests = 0;
let child: ChildProcess | undefined;
let serverOutput = '';

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function listenOnLoopback(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  const port = await listenOnLoopback(server);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

function currentTrade(): FreqtradeTrade {
  const isEntryPartial = filledAmount > 0 && filledAmount < 0.001;
  const entryOrder = {
    order_id: 'dry-run-entry-731',
    status: isEntryPartial ? 'open' : 'closed',
    amount: 0.001,
    filled: filledAmount,
    safe_price: averageFillPrice,
    cost: averageFillPrice * filledAmount,
    ft_order_side: 'buy',
    is_open: isEntryPartial,
    order_timestamp: 1_800_000_000_000,
    order_filled_timestamp: filledAmount > 0 ? 1_800_000_001_000 : null,
  };
  const orders: FreqtradeTrade['orders'] = [entryOrder];
  if (!open) {
    orders.push({
      order_id: 'dry-run-exit-731',
      status: 'closed',
      amount: filledAmount,
      filled: filledAmount,
      safe_price: averageFillPrice + 100,
      cost: (averageFillPrice + 100) * filledAmount,
      ft_order_side: 'sell',
      is_open: false,
      order_timestamp: 1_800_000_002_000,
      order_filled_timestamp: 1_800_000_003_000,
    });
  }
  return {
    trade_id: tradeId,
    pair,
    enter_tag: signal.signalId,
    is_open: open,
    is_short: false,
    amount: filledAmount,
    amount_requested: 0.001,
    open_rate: averageFillPrice,
    stake_amount: averageFillPrice * filledAmount,
    has_open_orders: isEntryPartial,
    orders,
    fee_open_cost: filledAmount > 0 ? 0.03 : null,
    fee_close_cost: open ? null : 0.03,
    open_fill_timestamp: filledAmount > 0 ? 1_800_000_001_000 : null,
    close_timestamp: open ? null : 1_800_000_003_000,
    close_rate: open ? null : averageFillPrice + 100,
    close_profit_abs: open ? null : filledAmount * 100 - 0.06,
    close_profit: open ? null : 0.0016,
    realized_profit: open ? undefined : filledAmount * 100 - 0.06,
    exit_reason: open ? null : 'force_exit',
    strategy: 'SbkSignalStrategy',
  };
}

const mockFreqtrade = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api/v1/ping') {
    respond(response, 200, { status: 'pong' });
    return;
  }
  if (url.pathname === '/api/v1/token/login') {
    const expected = `Basic ${Buffer.from(`${rpcUsername}:${rpcPassword}`).toString('base64')}`;
    if (request.headers.authorization !== expected) {
      respond(response, 401, { detail: 'invalid credentials' });
      return;
    }
    respond(response, 200, { access_token: 'dry-run-archive-flow-access-token' });
    return;
  }
  if (request.headers.authorization !== 'Bearer dry-run-archive-flow-access-token') {
    respond(response, 401, { detail: 'unauthorized' });
    return;
  }
  if (url.pathname === '/api/v1/show_config') {
    respond(response, 200, {
      strategy: 'SbkSignalStrategy',
      dry_run: true,
      demo_trading: false,
      state: 'running',
      exchange: 'bybit',
      trading_mode: 'futures',
      timeframe,
      force_entry_enable: false,
    });
    return;
  }
  if (url.pathname === '/api/v1/status') {
    respond(response, 200, open ? [currentTrade()] : []);
    return;
  }
  if (url.pathname === `/api/v1/trade/${tradeId}`) {
    respond(response, 200, currentTrade());
    return;
  }
  if (url.pathname === '/api/v1/forceexit' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request)) as { tradeid?: string };
    assert.equal(body.tradeid, String(tradeId));
    assert.equal(open, true);
    forceExitRequests += 1;
    open = false;
    respond(response, 200, { result: 'Dry-run exit request sent.' });
    return;
  }
  respond(response, 404, { detail: `unexpected mock RPC path ${url.pathname}` });
});

const rpcPort = await listenOnLoopback(mockFreqtrade);
const sbk1Port = await getAvailablePort();
const signalStorePath = path.join(temporaryDirectory, 'signals.json');
const archivePath = path.join(temporaryDirectory, 'archive.json');
const baseUrl = `http://127.0.0.1:${sbk1Port}`;
const nowMs = Date.now();
const ids = deriveSbkSignalIds({
  pair,
  direction: 'LONG',
  setupType: 'CONTRACT_E2E_TEST_ONLY',
  generatedAtMs: nowMs,
  sweptLevelPrice: 60_000,
  referencePrice: 60_000,
  stopLoss: 59_000,
  takeProfit: 62_000,
});
const authorizationGateIds = [
  'COUNCIL_REPORT',
  'LIVE_DATA',
  'REFERENCE_PRICE',
  'VOLATILITY',
  'EXECUTION_SPREAD',
  'TRADE_LEVELS',
  'STOP_AND_TARGET',
  'PORTFOLIO_RISK',
  'DAILY_LOSS',
  'RISK_ALLOCATION',
  'HOLDING_HORIZON',
];
const signal = {
  contractVersion: SBK_SIGNAL_CONTRACT_VERSION,
  ...ids,
  exchange: 'bybit',
  market: 'futures' as const,
  pair,
  direction: 'LONG' as const,
  timeframe,
  generatedAtMs: nowMs,
  expiresAtMs: nowMs + 60_000,
  referencePrice: 60_000,
  engineScore: 80,
  dataQuality: {
    status: 'LIVE' as const,
    source: 'dry-run-contract-test',
    observedAtMs: nowMs,
    maxAgeMs: 5_000,
  },
  entryConditions: {
    setupType: 'CONTRACT_E2E_TEST_ONLY',
    entryPrice: 60_000,
    stopLoss: 59_000,
    takeProfit: 62_000,
    maxPriceDeviationBps: 100,
    maxHoldingMinutes: 30,
  },
  riskLimits: { riskBudgetPct: 0.1, maxStakeQuote: 100, maxLeverage: 1 },
  authorization: {
    contractVersion: SBK_ENTRY_AUTHORIZATION_VERSION,
    decision: 'APPROVE_ENTRY',
    decisionId: ids.decisionId,
    snapshotId: `SNP_${nowMs}_archive`,
    snapshotTimestampMs: nowMs,
    evaluatedAtMs: nowMs,
    timeframe,
    direction: 'LONG',
    gates: authorizationGateIds.map((id) => ({
      id,
      status: 'PASSED',
      reason: 'CONTRACT_E2E_TEST_ONLY isolated authorization.',
    })),
    models: [],
    disagreementVeto: false,
    ensembleProbabilityPct: null,
    riskRewardRatio: 2,
    allocatedRiskUsd: 0.4,
    holdingHorizonMinutes: 30,
  },
};

async function startSbk1(): Promise<ChildProcess> {
  const server = spawn(
    process.execPath,
    ['--import', 'tsx', 'server.ts'],
    {
      cwd: rootDirectory,
      env: {
        ...process.env,
        ADMIN_TOKEN: adminToken,
        SBK1_FREQTRADE_BRIDGE_TOKEN: bridgeToken,
        SBK1_PORT: String(sbk1Port),
        SBK1_SIGNAL_STORE_PATH: signalStorePath,
        SBK1_TRADE_ARCHIVE_PATH: archivePath,
        FREQTRADE_BASE_URL: `http://127.0.0.1:${rpcPort}`,
        FREQTRADE_USERNAME: rpcUsername,
        FREQTRADE_PASSWORD: rpcPassword,
        FREQTRADE_PAIR: pair,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  server.stdout.setEncoding('utf8').on('data', (chunk: string) => { serverOutput += chunk; });
  server.stderr.setEncoding('utf8').on('data', (chunk: string) => { serverOutput += chunk; });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return server;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Isolated SBK1 server did not become healthy. Output: ${serverOutput}`);
}

async function stopSbk1(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  const exit = new Promise<void>((resolve, reject) => {
    server.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM') resolve();
      else reject(new Error(`Isolated SBK1 exited with code ${code}, signal ${signal}.`));
    });
  });
  server.kill('SIGTERM');
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exit,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out stopping isolated SBK1.')), 10_000);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function postLifecycle(
  status: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/freqtrade/signals/${signal.signalId}/status`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bridgeToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ status, ...details }),
  });
  const body = await response.json() as { status?: string; signalId?: string; error?: string };
  assert.equal(response.status, 200, `${status} callback: ${JSON.stringify(body)}`);
  assert.equal(body.signalId, signal.signalId);
  assert.equal(body.status, status);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const archiveResponse = await fetch(`${baseUrl}/api/hunter/trade-archive/${signal.signalId}`, {
      headers: { 'x-admin-token': adminToken },
    });
    if (archiveResponse.ok) {
      const archived = await archiveResponse.json() as {
        lifecycleEvents?: Array<{ status: string; filledAmount?: number }>;
      };
      if (archived.lifecycleEvents?.some((event) =>
        event.status === status &&
        (details.filledAmount === undefined || event.filledAmount === details.filledAmount)
      )) return;
    }
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 25));
  }
  throw new Error(`Signal lifecycle event ${status} was not persisted to the archive.`);
}

try {
  process.env.SBK1_SIGNAL_STORE_PATH = signalStorePath;
  const adapter = new FreqtradeSignalAdapter();
  const firstSubmit = await adapter.submit(signal, { expectedPair: pair, nowMs });
  const duplicateSubmit = await adapter.submit(signal, { expectedPair: pair, nowMs });
  assert.equal(firstSubmit.duplicate, undefined);
  assert.equal(duplicateSubmit.duplicate, true, 'repeated signal ID is idempotent');

  child = await startSbk1();
  const archiveUrl = `${baseUrl}/api/hunter/trade-archive/${signal.signalId}`;
  const beforeLifecycleResponse = await fetch(archiveUrl, { headers: { 'x-admin-token': adminToken } });
  assert.equal(beforeLifecycleResponse.status, 404, 'an accepted queue item is not archived before a lifecycle callback');
  const missingArchive = await beforeLifecycleResponse.json() as { error?: string };
  assert.equal(missingArchive.error, 'Operational trade archive record was not found.');

  await postLifecycle('STRATEGY_ACCEPTED');
  await postLifecycle('ORDER_SUBMITTED', { tradeId });

  filledAmount = 0.0004;
  averageFillPrice = 59_900;
  await postLifecycle('PARTIALLY_FILLED', {
    tradeId,
    filledAmount,
    averageFillPrice,
  });
  filledAmount = 0.00075;
  averageFillPrice = 60_000;
  await postLifecycle('PARTIALLY_FILLED', {
    tradeId,
    filledAmount,
    averageFillPrice,
  });
  filledAmount = 0.001;
  await postLifecycle('FILLED', {
    tradeId,
    filledAmount,
    averageFillPrice,
  });

  const archiveResponse = await fetch(archiveUrl, { headers: { 'x-admin-token': adminToken } });
  assert.equal(archiveResponse.status, 200, `trade archive returned ${archiveResponse.status}`);
  const archivedBeforeRestart = await archiveResponse.json() as {
    signalId: string;
    lifecycleEvents: Array<{ status: string; filledAmount?: number; tradeId?: number }>;
    freqtradeTrades: Array<{ executionMode?: string; trade: FreqtradeTrade }>;
    outcome?: {
      source: string;
      tradeId: number;
      outcome: string;
      pnlUsd: number;
      feesUsd: number;
      exitReason: string;
      closedAtMs: number;
    };
  };
  assert.equal(archivedBeforeRestart.signalId, signal.signalId);
  assert.deepEqual(
    archivedBeforeRestart.lifecycleEvents
      .filter((event) => event.status === 'PARTIALLY_FILLED')
      .map((event) => event.filledAmount),
    [0.0004, 0.00075],
  );
  assert.equal(archivedBeforeRestart.lifecycleEvents.at(-1)?.tradeId, tradeId);
  assert.equal(archivedBeforeRestart.freqtradeTrades.length, 0, 'lifecycle persistence does not make an extra RPC call or delay the Freqtrade callback');

  const exitResponse = await fetch(`${baseUrl}/api/hunter/exit`, {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tradeId }),
  });
  const exitBody = await exitResponse.json() as { success?: boolean; state?: string; trade?: FreqtradeTrade };
  assert.equal(exitResponse.status, 200, JSON.stringify(exitBody));
  assert.equal(exitBody.success, true);
  assert.equal(exitBody.state, 'FILLED');
  assert.equal(exitBody.trade?.is_open, false);
  assert.equal(forceExitRequests, 1, 'only the authenticated local dry-run Freqtrade force-exit endpoint was called');

  await stopSbk1(child);
  child = await startSbk1();
  const archiveAfterRestartResponse = await fetch(archiveUrl, { headers: { 'x-admin-token': adminToken } });
  assert.equal(archiveAfterRestartResponse.status, 200, 'archive record survives SBK1 process restart');
  const archivedAfterRestart = await archiveAfterRestartResponse.json() as typeof archivedBeforeRestart;
  assert.equal(archivedAfterRestart.signalId, signal.signalId);
  assert.equal(archivedAfterRestart.freqtradeTrades.at(-1)?.executionMode, 'DRY_RUN');
  assert.equal(archivedAfterRestart.freqtradeTrades.at(-1)?.trade.is_open, false);
  assert.equal(archivedAfterRestart.freqtradeTrades.at(-1)?.trade.exit_reason, 'force_exit');
  assert.equal(archivedAfterRestart.outcome?.source, 'FREQTRADE_RPC');
  assert.equal(archivedAfterRestart.outcome?.tradeId, tradeId);
  assert.equal(archivedAfterRestart.outcome?.outcome, 'WIN');
  assert.ok(Math.abs((archivedAfterRestart.outcome?.pnlUsd ?? 0) - 0.04) < 1e-12);
  assert.equal(archivedAfterRestart.outcome?.feesUsd, 0.06);
  assert.equal(archivedAfterRestart.outcome?.exitReason, 'force_exit');
  assert.equal(archivedAfterRestart.outcome?.closedAtMs, 1_800_000_003_000);
  assert.equal(forceExitRequests, 1, 'restart/archive refresh never submits another exit');

  const storedArchive = JSON.parse(await readFile(archivePath, 'utf8')) as {
    records: Array<{ signalId: string }>;
  };
  assert.equal(storedArchive.records.length, 1);
  assert.equal(storedArchive.records[0]?.signalId, signal.signalId);
  console.log(
    'Isolated DRY_RUN archive flow passed: pre-lifecycle 404 cause reproduced, lifecycle archive creation, duplicate signal, Freqtrade trade ID, two partial fills, full fill, exit, closed-trade refresh, and restart recovery; no live order endpoint was used.',
  );
} catch (error) {
  if (serverOutput) console.error(`Isolated SBK1 server output: ${serverOutput}`);
  throw error;
} finally {
  if (child) await stopSbk1(child);
  await new Promise<void>((resolve, reject) => {
    mockFreqtrade.close((error) => error ? reject(error) : resolve());
  });
  await rm(temporaryDirectory, { recursive: true, force: true });
}
