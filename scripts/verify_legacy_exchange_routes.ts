import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const adminToken = 'legacy-route-test-admin-token-long-enough';

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const { port } = address;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return port;
}

async function waitForServer(baseUrl: string, child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = new Error(`Health endpoint returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 200));
  }
  throw new Error(`SBK1 test server did not become healthy: ${String(lastError)}`);
}

const port = await findAvailablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    '--import',
    resolve('scripts/block_external_fetch.ts'),
    'server.ts',
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SBK1_PORT: String(port),
      ADMIN_TOKEN: adminToken,
      FREQTRADE_BASE_URL: 'http://127.0.0.1:1',
      FREQTRADE_USERNAME: 'legacy-route-test-user',
      FREQTRADE_PASSWORD: 'legacy-route-test-password',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let output = '';
child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });

try {
  await waitForServer(baseUrl, child);
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.match(healthResponse.headers.get('content-type') || '', /application\/json/);
  assert.equal((await healthResponse.json() as { status?: string }).status, 'ok');
  const unknownApiResponse = await fetch(`${baseUrl}/api/v1/ping`);
  assert.equal(unknownApiResponse.status, 404);
  assert.match(unknownApiResponse.headers.get('content-type') || '', /application\/json/);
  const unknownApiBody = await unknownApiResponse.json() as { code?: string };
  assert.equal(unknownApiBody.code, 'API_ROUTE_NOT_FOUND');

  const blockedRequests: Array<{ method: string; path: string; body?: object }> = [
    { method: 'POST', path: '/api/exchange/credentials', body: { apiKey: 'test', apiSecret: 'test' } },
    { method: 'DELETE', path: '/api/exchange/credentials' },
    { method: 'POST', path: '/api/exchange/simulated-order', body: { qty: 1 } },
    { method: 'POST', path: '/api/exchange/order', body: { qty: 1 } },
    { method: 'GET', path: '/api/exchange/order-status' },
    { method: 'POST', path: '/api/exchange/update-stop-loss', body: { id: '1', stopLoss: 1 } },
    { method: 'POST', path: '/api/exchange/close-position', body: { id: '1' } },
    { method: 'POST', path: '/api/exchange/partial-close', body: { id: '1' } },
    { method: 'POST', path: '/api/exchange/unhedge', body: { id: '1' } },
    { method: 'POST', path: '/api/exchange/hedge-chip', body: { id: '1' } },
    { method: 'POST', path: '/api/exchange/dca-position', body: { id: '1' } },
    { method: 'POST', path: '/api/live/check-api-permissions' },
    { method: 'POST', path: '/API/EXCHANGE/ORDER', body: { qty: 1 } },
  ];

  for (const request of blockedRequests) {
    const response = await fetch(`${baseUrl}${request.path}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: request.body ? JSON.stringify(request.body) : undefined,
    });
    const body = await response.json() as { code?: string; success?: boolean; error?: string };
    assert.equal(response.status, 409, `${request.method} ${request.path}: ${JSON.stringify(body)}`);
    assert.equal(body.code, 'FREQTRADE_EXECUTION_OWNER');
  }

  const readinessResponse = await fetch(`${baseUrl}/api/live/run-readiness-tests`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(readinessResponse.status, 503);
  const readinessBody = await readinessResponse.json() as {
    readinessTests?: Record<string, { status?: string }>;
  };
  assert.equal(readinessBody.readinessTests?.['Freqtrade RPC']?.status, 'FAIL');
  assert.equal(readinessBody.readinessTests?.['Freqtrade Snapshot Freshness']?.status, 'FAIL');
  assert.equal(readinessBody.readinessTests?.['Order Testnet Test']?.status, 'NOT_RUN');

  const statusResponse = await fetch(`${baseUrl}/api/exchange/status`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(statusResponse.status, 503, 'The sole exchange status route must pass through to Freqtrade RPC.');
  const statusBody = await statusResponse.json() as { executionAuthority?: string };
  assert.equal(statusBody.executionAuthority, 'freqtrade');

  const profileResponse = await fetch(`${baseUrl}/api/execution/settings`, { cache: 'no-store' });
  const profileBody = await profileResponse.json() as { mode?: string; selectedProfile?: string };
  assert.equal(profileBody.mode, 'DRY_RUN');
  assert.equal(profileBody.selectedProfile, 'DEMO');

  const liveSelectionResponse = await fetch(`${baseUrl}/api/execution/mode`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mode: 'LIVE' }),
  });
  assert.equal(liveSelectionResponse.status, 409, 'browser/server mode selection cannot switch the Freqtrade profile to LIVE');

  const protectedDashboardResponse = await fetch(`${baseUrl}/api/execution/dashboard`, {
    headers: { authorization: `Bearer ${adminToken}` },
    cache: 'no-store',
  });
  assert.equal(protectedDashboardResponse.status, 503, 'missing RPC must not produce a fabricated wallet or connected state');
  const protectedDashboard = await protectedDashboardResponse.json() as {
    freqtradeMode?: string;
    balance?: { kind?: string; equity?: number | null };
    modeMatchesSelection?: boolean;
  };
  assert.equal(protectedDashboard.freqtradeMode, 'UNKNOWN');
  assert.equal(protectedDashboard.modeMatchesSelection, false);
  assert.equal(protectedDashboard.balance?.kind, 'UNAVAILABLE');
  assert.equal(protectedDashboard.balance?.equity, null);

  const unauthorizedActivationResponse = await fetch(`${baseUrl}/api/execution/live/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation: 'ACTIVATE_LIVE' }),
  });
  assert.equal(unauthorizedActivationResponse.status, 404, 'SBK1 must not expose a live-activation endpoint');

  const activationResponse = await fetch(`${baseUrl}/api/execution/live/activate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ confirmation: 'ACTIVATE_LIVE' }),
  });
  assert.equal(activationResponse.status, 404, 'SBK1 must not expose a live-activation endpoint');
  assert.doesNotMatch(output, /WS_CONNECT|wss:\/\/stream\./);

  const toggleResponse = await fetch(`${baseUrl}/api/live/toggle-auto-trade`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ enable: true }),
  });
  const toggleBody = await toggleResponse.json() as { liveAutoTradeEnabled?: boolean };
  assert.equal(toggleResponse.status, 409);
  assert.equal(toggleBody.liveAutoTradeEnabled, false);

  console.log(`${blockedRequests.length} legacy exchange routes and live auto-trading fail closed; external fetches were blocked.`);
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\nServer output:\n${output}`);
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolveExit) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolveExit();
      }, 12_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolveExit();
      });
    });
  }
}
