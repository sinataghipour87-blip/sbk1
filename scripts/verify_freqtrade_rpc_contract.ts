import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { freqtradeBridge } from '../src/services/freqtradeBridge';

const contractUsername = 'contract-user';
const contractPassword = 'contract-password';
const contractToken = 'contract-access-token';
const envKeys = [
  'FREQTRADE_BASE_URL',
  'FREQTRADE_USERNAME',
  'FREQTRADE_PASSWORD',
  'FREQTRADE_PAIR',
] as const;
const originalEnvironment = new Map(envKeys.map((key) => [key, process.env[key]]));
const requestPaths: string[] = [];
let loginCount = 0;
let forceWhitelist401 = true;

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
  requestPaths.push(url.pathname);

  if (url.pathname === '/api/v1/ping') {
    respond(response, 200, { status: 'pong' });
    return;
  }

  if (url.pathname === '/api/v1/token/login') {
    loginCount += 1;
    const expectedBasic = `Basic ${Buffer.from(`${contractUsername}:${contractPassword}`).toString('base64')}`;
    if (request.headers.authorization !== expectedBasic) {
      respond(response, 401, { detail: 'invalid credentials' });
      return;
    }
    await readBody(request);
    respond(response, 200, { access_token: contractToken });
    return;
  }

  if (request.headers.authorization !== `Bearer ${contractToken}`) {
    respond(response, 401, { detail: 'unauthorized' });
    return;
  }

  if (url.pathname === '/api/v1/show_config') {
    respond(response, 200, {
      version: 'contract-test',
      strategy: 'SbkSignalStrategy',
      dry_run: true,
      exchange: 'bybit',
      trading_mode: 'futures',
      timeframe: '15m',
      demo_trading: false,
      state: 'running',
      stake_currency: 'USDT',
      force_entry_enable: false,
    });
    return;
  }
  if (url.pathname === '/api/v1/status') {
    respond(response, 200, [{
      trade_id: 7,
      pair: 'BTC/USDT:USDT',
      is_open: true,
      is_short: false,
      amount: 0.001,
      amount_requested: 0.002,
      open_rate: 60_000,
      stake_amount: 60,
      has_open_orders: true,
      orders: [{
        order_id: 'mock-order-7',
        status: 'open',
        amount: 0.002,
        filled: 0.001,
        safe_price: 60_000,
        cost: 60,
        ft_order_side: 'buy',
        is_open: true,
        order_filled_timestamp: null,
      }],
      fee_open_cost: null,
      fee_close_cost: null,
      open_fill_timestamp: null,
      close_timestamp: null,
    }]);
    return;
  }
  if (url.pathname === '/api/v1/trade/700') {
    respond(response, 404, { detail: 'closed trades are available from trade history' });
    return;
  }
  if (url.pathname === '/api/v1/trades') {
    const offset = Number(url.searchParams.get('offset') || 0);
    const page = offset === 0
      ? Array.from({ length: 500 }, (_, index) => ({
          trade_id: index + 1,
          pair: 'BTC/USDT:USDT',
          is_open: false,
          is_short: false,
          amount: 0.001,
          amount_requested: 0.001,
          open_rate: 60_000,
          stake_amount: 60,
          has_open_orders: false,
          orders: [],
          fee_open_cost: 0.03,
          fee_close_cost: 0.03,
          open_fill_timestamp: 1_800_000_001_000,
          close_timestamp: 1_800_000_601_000,
        }))
      : [{
          trade_id: 700,
          pair: 'BTC/USDT:USDT',
          is_open: false,
          is_short: false,
          amount: 0.001,
          amount_requested: 0.001,
          open_rate: 60_000,
          stake_amount: 60,
          has_open_orders: false,
          orders: [],
          fee_open_cost: 0.03,
          fee_close_cost: 0.03,
          open_fill_timestamp: 1_800_000_001_000,
          close_timestamp: 1_800_000_601_000,
          close_rate: 61_000,
          close_profit_abs: 0.94,
        }];
    respond(response, 200, { trades: page });
    return;
  }
  if (url.pathname === '/api/v1/balance') {
    respond(response, 200, {
      total: 125,
      currencies: [{ currency: 'USDT', free: 100, balance: 125 }],
    });
    return;
  }
  if (url.pathname === '/api/v1/whitelist') {
    if (forceWhitelist401) {
      forceWhitelist401 = false;
      respond(response, 401, { detail: 'expired token' });
      return;
    }
    respond(response, 200, { whitelist: ['BTC/USDT:USDT'] });
    return;
  }
  respond(response, 404, { detail: `unexpected contract-test route: ${url.pathname}` });
});

try {
  await new Promise<void>((resolve, reject) => {
    mockFreqtrade.once('error', reject);
    mockFreqtrade.listen(0, '127.0.0.1', resolve);
  });
  const address = mockFreqtrade.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock Freqtrade server did not bind to a TCP port.');
  }
  process.env.FREQTRADE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.FREQTRADE_USERNAME = contractUsername;
  process.env.FREQTRADE_PASSWORD = contractPassword;
  process.env.FREQTRADE_PAIR = 'BTC/USDT:USDT';

  const state = await freqtradeBridge.getStatus();
  assert.equal(state.status, 'running');
  assert.equal(state.dryRun, true);
  assert.equal(state.strategy, 'SbkSignalStrategy');
  assert.equal(state.market, 'futures');
  assert.equal(state.openTradesCount, 1);

  const trades = await freqtradeBridge.getOpenTrades();
  assert.equal(trades[0]?.trade_id, 7);
  assert.equal(trades[0]?.orders[0]?.filled, 0.001);
  const closedTrade = await freqtradeBridge.getTrade(700);
  assert.equal(closedTrade.trade_id, 700, 'closed trades beyond the first page are recoverable');
  assert.equal(closedTrade.close_profit_abs, 0.94);
  const balance = await freqtradeBridge.getBalance();
  assert.deepEqual(balance, { equity: 125, available: 100, currency: 'USDT' });
  assert.deepEqual(await freqtradeBridge.getWhitelist(), ['BTC/USDT:USDT']);
  assert.equal(freqtradeBridge.getConfiguredPair(), 'BTC/USDT:USDT');
  assert.equal(loginCount, 2, 'expired bearer token should trigger one authenticated refresh');
  assert.equal(requestPaths.some((path) => /\/(forceenter|forceexit|forcebuy|forcesell)$/.test(path)), false);
  console.log('Authenticated Freqtrade RPC mock contract checks passed; no order endpoint was called.');
} finally {
  await new Promise<void>((resolve, reject) => {
    mockFreqtrade.close((error) => error ? reject(error) : resolve());
  });
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
