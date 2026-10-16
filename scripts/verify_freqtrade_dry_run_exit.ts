import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { orderExecutionLifecycleService } from '../src/services/orderExecutionLifecycleEngine';

const username = 'dry-run-exit-test-user';
const password = 'dry-run-exit-test-password';
const token = 'dry-run-exit-contract-token';
const envKeys = ['FREQTRADE_BASE_URL', 'FREQTRADE_USERNAME', 'FREQTRADE_PASSWORD'] as const;
const originalEnvironment = new Map(envKeys.map((key) => [key, process.env[key]]));
const requestPaths: string[] = [];
let dryRun = true;
let demoTrading = false;
let tradeOpen = true;
let forceExitCount = 0;

const entryOrder = {
  order_id: 'entry-1',
  status: 'closed',
  amount: 0.001,
  filled: 0.001,
  safe_price: 60_000,
  cost: 60,
  ft_order_side: 'buy',
  is_open: false,
  order_timestamp: 1_800_000_000_000,
  order_filled_timestamp: 1_800_000_001_000,
  ft_fee_base: null,
};

const exitOrder = {
  order_id: 'exit-1',
  status: 'closed',
  amount: 0.001,
  filled: 0.001,
  safe_price: 60_100,
  cost: 60.1,
  ft_order_side: 'sell',
  is_open: false,
  order_timestamp: 1_800_000_002_000,
  order_filled_timestamp: 1_800_000_003_000,
  ft_fee_base: null,
};

function makeTrade() {
  return {
    trade_id: 1,
    pair: 'BTC/USDT:USDT',
    is_open: tradeOpen,
    is_short: false,
    amount: 0.001,
    amount_requested: 0.001,
    open_rate: 60_000,
    stake_amount: 60,
    has_open_orders: false,
    orders: tradeOpen ? [entryOrder] : [entryOrder, exitOrder],
    fee_open_cost: null,
    fee_close_cost: tradeOpen ? null : 0.03,
    open_fill_timestamp: 1_800_000_001_000,
    close_timestamp: tradeOpen ? null : 1_800_000_003_000,
    close_rate: tradeOpen ? null : 60_100,
    close_profit_abs: tradeOpen ? null : 0.1,
    close_profit: tradeOpen ? null : 0.001,
    realized_profit: tradeOpen ? null : 0.1,
    exit_reason: tradeOpen ? null : 'force_exit',
  };
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

const mockFreqtrade = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  requestPaths.push(`${request.method} ${url.pathname}`);

  if (url.pathname === '/api/v1/ping') {
    respond(response, 200, { status: 'pong' });
    return;
  }
  if (url.pathname === '/api/v1/token/login') {
    const expectedBasic = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    if (request.headers.authorization !== expectedBasic) {
      respond(response, 401, { detail: 'invalid credentials' });
      return;
    }
    respond(response, 200, { access_token: token });
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    respond(response, 401, { detail: 'unauthorized' });
    return;
  }
  if (url.pathname === '/api/v1/show_config') {
    respond(response, 200, {
      strategy: 'SbkSignalStrategy',
      dry_run: dryRun,
      demo_trading: demoTrading,
      state: 'running',
      exchange: 'bybit',
      trading_mode: 'futures',
      timeframe: '15m',
      force_entry_enable: false,
    });
    return;
  }
  if (url.pathname === '/api/v1/status') {
    respond(response, 200, tradeOpen ? [makeTrade()] : []);
    return;
  }
  if (url.pathname === '/api/v1/trade/1') {
    respond(response, 200, makeTrade());
    return;
  }
  if (url.pathname === '/api/v1/forceexit' && request.method === 'POST') {
    const payload = JSON.parse(await readBody(request)) as { tradeid?: string };
    assert.equal(payload.tradeid, '1');
    forceExitCount += 1;
    tradeOpen = false;
    respond(response, 200, { result: 'Dry-run exit request sent.' });
    return;
  }
  respond(response, 404, { detail: 'not found' });
});

await new Promise<void>((resolve, reject) => {
  mockFreqtrade.once('error', reject);
  mockFreqtrade.listen(0, '127.0.0.1', resolve);
});

const address = mockFreqtrade.address();
assert.ok(address && typeof address !== 'string');
process.env.FREQTRADE_BASE_URL = `http://127.0.0.1:${address.port}`;
process.env.FREQTRADE_USERNAME = username;
process.env.FREQTRADE_PASSWORD = password;

try {
  const demoExit = await orderExecutionLifecycleService.forceExitFreqtradeTrade(1);
  assert.equal(demoExit.success, true);
  assert.equal(demoExit.state, 'FILLED');
  assert.equal(forceExitCount, 1, 'dry-run exits must be delegated to Freqtrade');

  dryRun = false;
  tradeOpen = true;
  const liveExit = await orderExecutionLifecycleService.forceExitFreqtradeTrade(1);
  assert.equal(liveExit.success, false);
  assert.equal(liveExit.state, 'REJECTED');
  assert.equal(forceExitCount, 1, 'live exit requests must not reach Freqtrade');

  dryRun = true;
  demoTrading = true;
  const testnetExit = await orderExecutionLifecycleService.forceExitFreqtradeTrade(1);
  assert.equal(testnetExit.success, false);
  assert.equal(testnetExit.state, 'REJECTED');
  assert.equal(forceExitCount, 1, 'testnet exit requests must not reach Freqtrade');

  demoTrading = false;
  tradeOpen = false;
  const closedTradeExit = await orderExecutionLifecycleService.forceExitFreqtradeTrade(1);
  assert.equal(closedTradeExit.success, false);
  assert.equal(closedTradeExit.state, 'REJECTED');
  assert.equal(forceExitCount, 1, 'closed trades must not trigger another exit');
  assert.equal(requestPaths.filter((entry) => entry === 'POST /api/v1/forceexit').length, 1);
} finally {
  for (const key of envKeys) {
    const original = originalEnvironment.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  await new Promise<void>((resolve, reject) => {
    mockFreqtrade.close((error) => error ? reject(error) : resolve());
  });
}

console.log('Freqtrade exits are delegated only to authenticated local dry-run RPC.');
