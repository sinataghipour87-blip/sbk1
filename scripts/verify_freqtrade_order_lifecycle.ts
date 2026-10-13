import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDryRunFixtureSignal } from '../src/services/freqtradeDryRunFixture';
import {
  FreqtradeSignalAdapter,
  type SbkFreqtradeSignal,
} from '../src/services/freqtradeSignalAdapter';
import type { FreqtradeTrade } from '../src/services/freqtradeBridge';
import { orderExecutionLifecycleService } from '../src/services/orderExecutionLifecycleEngine';

const username = 'lifecycle-test-user';
const password = 'lifecycle-test-password';
const accessToken = 'lifecycle-test-access-token';
const originalEnvironment = new Map(
  ['FREQTRADE_BASE_URL', 'FREQTRADE_USERNAME', 'FREQTRADE_PASSWORD', 'FREQTRADE_PAIR', 'SBK1_SIGNAL_STORE_PATH']
    .map((key) => [key, process.env[key]]),
);
const tradeById = new Map<number, FreqtradeTrade>();
const orderMutationPaths: string[] = [];
let rpcDryRun = true;
let rpcForceEntryEnabled = false;

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function makeTrade(
  id: number,
  orders: FreqtradeTrade['orders'],
  isOpen = true,
  amount = 0.002,
): FreqtradeTrade {
  return {
    trade_id: id,
    pair: 'BTC/USDT:USDT',
    is_open: isOpen,
    is_short: false,
    amount,
    amount_requested: 0.002,
    open_rate: 62_100,
    stake_amount: 124.2,
    has_open_orders: orders.some((order) => order.is_open),
    orders,
    fee_open_cost: null,
    fee_close_cost: null,
    open_fill_timestamp: null,
    close_timestamp: isOpen ? null : Date.now(),
  };
}

const mockFreqtrade = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api/v1/ping') {
    respond(response, 200, { status: 'pong' });
    return;
  }
  if (url.pathname === '/api/v1/token/login') {
    if (request.headers.authorization !== `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`) {
      respond(response, 401, { detail: 'invalid credentials' });
      return;
    }
    await readBody(request);
    respond(response, 200, { access_token: accessToken });
    return;
  }
  if (request.headers.authorization !== `Bearer ${accessToken}`) {
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
      state: 'running',
      force_entry_enable: rpcForceEntryEnabled,
    });
    return;
  }
  if (url.pathname === '/api/v1/status') {
    respond(response, 200, [...tradeById.values()].filter((trade) => trade.is_open));
    return;
  }
  const tradeMatch = url.pathname.match(/^\/api\/v1\/trade\/(\d+)$/);
  if (tradeMatch) {
    const trade = tradeById.get(Number(tradeMatch[1]));
    if (!trade || !trade.is_open) respond(response, 404, { detail: 'trade not found' });
    else respond(response, 200, trade);
    return;
  }
  if (url.pathname === '/api/v1/trades') {
    respond(response, 200, { trades: [...tradeById.values()] });
    return;
  }
  if (url.pathname === '/api/v1/forceexit') {
    orderMutationPaths.push(url.pathname);
    await readBody(request);
    const trade = tradeById.get(4);
    assert.ok(trade);
    tradeById.set(4, makeTrade(4, [
      {
        order_id: 'entry-4',
        status: 'closed',
        amount: 0.002,
        filled: 0.002,
        safe_price: 62_100,
        cost: 124.2,
        ft_order_side: 'buy',
        is_open: false,
        order_filled_timestamp: Date.now(),
      },
      {
        order_id: 'exit-4',
        status: 'closed',
        amount: 0.002,
        filled: 0.002,
        safe_price: 62_000,
        cost: 124,
        ft_order_side: 'sell',
        is_open: false,
        order_filled_timestamp: Date.now(),
      },
    ], false));
    respond(response, 200, { result: ' dry-run exit accepted' });
    return;
  }
  respond(response, 404, { detail: `unexpected route ${url.pathname}` });
});

function createSignal(nowMs: number, suffix: number): SbkFreqtradeSignal {
  const signal = createDryRunFixtureSignal({
    nowMs,
    exchange: 'bybit',
    pair: 'BTC/USDT:USDT',
    timeframe: '15m',
    referencePrice: 62_100 + suffix,
    observedAtMs: nowMs,
    source: 'Freqtrade DataProvider test fixture',
    maxStakeQuote: 100,
  });
  return signal;
}

const entryOrder = (id: string, status: string, amount: number, filled: number, open: boolean) => ({
  order_id: id,
  status,
  amount,
  filled,
  safe_price: 62_100,
  cost: 62_100 * filled,
  ft_order_side: 'buy',
  is_open: open,
  order_filled_timestamp: filled > 0 ? Date.now() : null,
});

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-order-lifecycle-'));
process.env.SBK1_SIGNAL_STORE_PATH = path.join(temporaryDirectory, 'signals.json');

try {
  await new Promise<void>((resolve, reject) => {
    mockFreqtrade.once('error', reject);
    mockFreqtrade.listen(0, '127.0.0.1', resolve);
  });
  const address = mockFreqtrade.address();
  if (!address || typeof address === 'string') throw new Error('Mock Freqtrade failed to bind.');
  process.env.FREQTRADE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.FREQTRADE_USERNAME = username;
  process.env.FREQTRADE_PASSWORD = password;
  process.env.FREQTRADE_PAIR = 'BTC/USDT:USDT';

  tradeById.set(1, makeTrade(1, [entryOrder('entry-1', 'closed', 0.002, 0.002, false)]));
  tradeById.set(2, makeTrade(2, [entryOrder('entry-2', 'canceled', 0.002, 0.001, false)], true, 0.001));
  tradeById.set(3, makeTrade(3, [entryOrder('entry-3', 'rejected', 0.002, 0, false)], false, 0));
  tradeById.set(4, makeTrade(4, [entryOrder('entry-4', 'closed', 0.002, 0.002, false)]));
  tradeById.set(5, makeTrade(5, [
    entryOrder('entry-5', 'closed', 0.002, 0.002, false),
    {
      ...entryOrder('stop-5', 'closed', 0.002, 0.002, false),
      ft_order_side: 'stoploss',
    },
    {
      ...entryOrder('exit-5', 'closed', 0.002, 0.002, false),
      ft_order_side: 'sell',
    },
  ], false));

  const fullFill = await orderExecutionLifecycleService.queryFreqtradeOrderStatus(1);
  assert.equal(fullFill.state, 'FILLED');
  assert.equal(fullFill.positionOpen, true);

  const partialFill = await orderExecutionLifecycleService.queryFreqtradeOrderStatus(2);
  assert.equal(partialFill.state, 'PARTIALLY_FILLED', 'a cancelled remainder does not erase a partial fill');
  assert.equal(partialFill.positionOpen, true);

  const rejection = await orderExecutionLifecycleService.queryFreqtradeOrderStatus(3);
  assert.equal(rejection.state, 'REJECTED');

  const stopLossClosure = await orderExecutionLifecycleService.queryFreqtradeOrderStatus(5);
  assert.equal(stopLossClosure.state, 'FILLED', 'entry fill state excludes exit and stop-loss quantities');
  assert.equal(stopLossClosure.positionOpen, false, 'closed stop-loss position follows Freqtrade state');

  rpcDryRun = false;
  const liveModeExit = await orderExecutionLifecycleService.forceExitFreqtradeTrade(4);
  assert.equal(liveModeExit.success, false, 'live Freqtrade state must fail closed');
  assert.equal(liveModeExit.state, 'REJECTED');
  assert.deepEqual(orderMutationPaths, [], 'live-mode checks must not send an exit request');
  rpcDryRun = true;
  rpcForceEntryEnabled = true;
  const unsafeEntryConfiguration = await orderExecutionLifecycleService.forceExitFreqtradeTrade(4);
  assert.equal(unsafeEntryConfiguration.success, false);
  assert.deepEqual(orderMutationPaths, [], 'force-entry enabled must also fail closed');
  rpcForceEntryEnabled = false;
  const dryRunExit = await orderExecutionLifecycleService.forceExitFreqtradeTrade(4);
  assert.equal(dryRunExit.success, true);
  assert.equal(dryRunExit.positionOpen, false);
  assert.equal(dryRunExit.state, 'FILLED');
  assert.deepEqual(orderMutationPaths, ['/api/v1/forceexit']);

  const adapter = new FreqtradeSignalAdapter();
  const restartStates = [
    { status: 'ACCEPTED' as const },
    { status: 'STRATEGY_ACCEPTED' as const },
    { status: 'ORDER_SUBMITTED' as const, tradeId: 1 },
    { status: 'FILLED' as const, tradeId: 1, filledAmount: 0.002, averageFillPrice: 62_100 },
  ];
  for (const [index, state] of restartStates.entries()) {
    const signal = createSignal(Date.now() + index, 10 + index);
    await adapter.submit(signal);
    if (state.status !== 'ACCEPTED') {
      await adapter.updateStatus(signal.signalId, { status: 'STRATEGY_ACCEPTED' });
      if (state.status !== 'STRATEGY_ACCEPTED') {
        await adapter.updateStatus(signal.signalId, {
          status: 'ORDER_SUBMITTED',
          tradeId: state.tradeId,
        });
        if (state.status === 'FILLED') {
          await adapter.updateStatus(signal.signalId, {
            status: 'FILLED',
            tradeId: state.tradeId,
            filledAmount: state.filledAmount,
            averageFillPrice: state.averageFillPrice,
          });
        }
      }
    }

    const restartedAdapter = new FreqtradeSignalAdapter();
    const recovered = await restartedAdapter.get(signal.signalId);
    assert.equal(recovered?.status, state.status, `recovery preserves ${state.status} state`);
    const duplicateDelivery = await restartedAdapter.submit(signal);
    assert.equal(duplicateDelivery.duplicate, true, `${state.status} record must not be duplicated`);
    assert.equal(duplicateDelivery.status, state.status);
  }

  const expiringSignal = createSignal(Date.now(), 30);
  const expiredRecord = await adapter.submit({
    ...expiringSignal,
    expiresAtMs: Date.now() + 150,
  });
  await new Promise((resolve) => setTimeout(resolve, 175));
  const pendingAfterExpiry = await adapter.getPending(expiredRecord.signal.pair, expiredRecord.signal.timeframe);
  assert.equal(pendingAfterExpiry.some((record) => record.signal.signalId === expiredRecord.signal.signalId), false);
  assert.equal((await adapter.get(expiredRecord.signal.signalId))?.status, 'EXPIRED');

  const queueSignal = createSignal(Date.now(), 31);
  const queuedRecord = await adapter.submit(queueSignal);
  assert.equal(await adapter.cancelPending('Kill switch test: cancel queued signals only.'), 2);
  assert.equal((await adapter.get(queuedRecord.signal.signalId))?.status, 'CANCELLED');

  const stored = JSON.parse(await readFile(process.env.SBK1_SIGNAL_STORE_PATH!, 'utf8')) as {
    records: Array<{ signal: { signalId: string } }>;
  };
  assert.equal(
    new Set(stored.records.map((record) => record.signal.signalId)).size,
    stored.records.length,
    'restart recovery must preserve exactly one record per signal ID',
  );
  console.log('Dry-run order lifecycle, reconciliation, expiry, kill-switch queue, and restart recovery checks passed against authenticated mock RPC.');
} finally {
  await new Promise<void>((resolve, reject) => {
    mockFreqtrade.close((error) => error ? reject(error) : resolve());
  });
  await rm(temporaryDirectory, { recursive: true, force: true });
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
