import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, open, readFile, unlink } from 'node:fs/promises';
import { isIP } from 'node:net';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_NODE_PORT = 3000;
const STRATEGY_NAME = 'SbkSignalStrategy';
const FREQTRADE_PROCESS_THROTTLE_SECS = 1;
const FREQTRADE_CONFIG_PATH = path.join(ROOT_DIR, 'freqtrade', 'user_data', 'config.json');
const STRATEGY_PATH = path.join(ROOT_DIR, 'freqtrade_integration', 'strategies');
const LOCK_PATH = path.join(ROOT_DIR, '.sbk1-run.lock');
const STARTUP_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 5_000;

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

interface FreqtradeConfig {
  dry_run?: boolean;
  dry_run_wallet?: number;
  stake_amount?: number | string;
  max_open_trades?: number;
  tradable_balance_ratio?: number;
  margin_mode?: string;
  unfilledtimeout?: {
    entry?: number;
    exit?: number;
    unit?: string;
  };
  order_types?: {
    emergency_exit?: string;
    force_exit?: string;
    stoploss?: string;
    stoploss_on_exchange?: boolean;
  };
  strategy?: string;
  trading_mode?: string;
  timeframe?: string;
  internals?: {
    process_throttle_secs?: number;
  };
  initial_state?: string;
  force_entry_enable?: boolean;
  exchange?: {
    name?: string;
    key?: string;
    secret?: string;
    pair_whitelist?: string[];
  };
  api_server?: {
    enabled?: boolean;
    listen_ip_address?: string;
    listen_port?: number;
    username?: string;
    password?: string;
  };
}

interface RuntimeSettings {
  apiBaseUrl: string;
  bridgeBaseUrl: string;
  exchange: string;
  pair: string;
  timeframe: string;
  market: 'spot' | 'futures';
  apiPort: number;
  apiHost: string;
  nodePort: number;
  liveEnabled: boolean;
}

interface SignalStoreLock {
  pid: number;
  token: string;
}

let settings: RuntimeSettings | undefined;
let lockToken: string | undefined;
let nodeProcess: ChildProcess | undefined;
let freqtradeProcess: ChildProcess | undefined;
let shutdownPromise: Promise<void> | undefined;
let lifetimeResolve: (() => void) | undefined;
let exitCode = 0;

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  return isIP(normalized) === 4 && normalized.split('.')[0] === '127';
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseLocalHttpUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid local HTTP(S) URL.`);
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !isLoopbackHostname(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must target loopback and must not contain credentials, query data, or a fragment.`);
  }
  return url;
}

export function validateRuntimeSettings(config: FreqtradeConfig, env: NodeJS.ProcessEnv): RuntimeSettings {
  const nodePort = Number(env.SBK1_PORT || DEFAULT_NODE_PORT);
  if (!Number.isInteger(nodePort) || nodePort < 1 || nodePort > 65535) {
    throw new Error('SBK1_PORT must be an integer between 1 and 65535.');
  }
  const pair = requireEnv(env, 'FREQTRADE_PAIR');
  const sbkPair = requireEnv(env, 'SBK1_FREQTRADE_PAIR');
  const exchange = requireEnv(env, 'SBK1_SIGNAL_EXCHANGE').toLowerCase();
  const timeframe = requireEnv(env, 'SBK1_FREQTRADE_TIMEFRAME');
  const bridgeToken = requireEnv(env, 'SBK1_FREQTRADE_BRIDGE_TOKEN');
  const adminToken = requireEnv(env, 'ADMIN_TOKEN');
  requireEnv(env, 'FREQTRADE_USERNAME');
  requireEnv(env, 'FREQTRADE_PASSWORD');

  if (adminToken.length < 32) {
    throw new Error('ADMIN_TOKEN must contain at least 32 characters.');
  }
  if (bridgeToken.length < 32) {
    throw new Error('SBK1_FREQTRADE_BRIDGE_TOKEN must contain at least 32 characters.');
  }
  if (pair !== sbkPair) {
    throw new Error('FREQTRADE_PAIR and SBK1_FREQTRADE_PAIR must match exactly.');
  }
  if (config.strategy !== STRATEGY_NAME) {
    throw new Error(`Freqtrade config must select ${STRATEGY_NAME}.`);
  }
  if (config.force_entry_enable !== false) {
    throw new Error('برای اجرا، force_entry_enable باید false باشد؛ ورودها فقط از مسیر سیگنال SBK1 انجام می‌شوند.');
  }
  const liveEnabled = env.SBK1_LIVE_ENABLED?.trim().toLowerCase() === 'true';
  if (config.dry_run !== true && config.dry_run !== false) {
    throw new Error('مقدار dry_run در تنظیم خصوصی Freqtrade باید صریحاً true یا false باشد.');
  }
  if (config.dry_run === false) {
    if (!liveEnabled) {
      throw new Error('اجرای لایو مسدود است؛ مالک باید ابتدا SBK1_LIVE_ENABLED=true را صریحاً در محیط سرور تنظیم کند.');
    }
    if (!config.exchange?.key?.trim() || !config.exchange?.secret?.trim()) {
      throw new Error('اجرای لایو مسدود است؛ کلید و secret صرافی باید در تنظیم خصوصی Freqtrade پر باشند.');
    }
  }
  if (
    config.exchange?.name?.toLowerCase() !== exchange ||
    !Array.isArray(config.exchange.pair_whitelist) ||
    !config.exchange.pair_whitelist.includes(pair)
  ) {
    throw new Error('Freqtrade exchange and pair whitelist must match the SBK1 signal settings.');
  }
  if (config.timeframe !== timeframe) {
    throw new Error('Freqtrade timeframe and SBK1_FREQTRADE_TIMEFRAME must match.');
  }
  if (config.internals?.process_throttle_secs !== FREQTRADE_PROCESS_THROTTLE_SECS) {
    throw new Error(
      `Freqtrade internals.process_throttle_secs must be ${FREQTRADE_PROCESS_THROTTLE_SECS} second to keep SBK1 market data fresh.`,
    );
  }
  if (config.trading_mode !== 'spot' && config.trading_mode !== 'futures') {
    throw new Error('Freqtrade trading_mode must be spot or futures.');
  }
  if (config.trading_mode === 'futures' && config.margin_mode !== 'isolated') {
    throw new Error('Freqtrade futures margin_mode must be isolated for the reviewed DEMO risk profile.');
  }
  if (
    typeof config.stake_amount !== 'number' ||
    !Number.isFinite(config.stake_amount) ||
    config.stake_amount <= 0 ||
    config.stake_amount > 100
  ) {
    throw new Error('Freqtrade stake_amount must be a finite fixed amount between 0 and 100 USDT; unlimited sizing is prohibited.');
  }
  if (config.max_open_trades !== 1) {
    throw new Error('Freqtrade max_open_trades must be exactly 1 for the reviewed DEMO risk profile.');
  }
  if (!Number.isFinite(config.dry_run_wallet) || (config.dry_run_wallet ?? 0) <= 0) {
    throw new Error('Freqtrade dry_run_wallet must be a finite positive virtual balance.');
  }
  if (
    !Number.isFinite(config.tradable_balance_ratio) ||
    (config.tradable_balance_ratio ?? 0) <= 0 ||
    (config.tradable_balance_ratio ?? 1) > 0.9
  ) {
    throw new Error('Freqtrade tradable_balance_ratio must be positive and no greater than 0.9.');
  }
  const unfilledTimeout = config.unfilledtimeout;
  if (
    !unfilledTimeout ||
    unfilledTimeout.entry !== 15 ||
    unfilledTimeout.exit !== 15 ||
    unfilledTimeout.unit !== 'seconds'
  ) {
    throw new Error('Freqtrade entry and exit unfilled timeouts must both be 15 seconds.');
  }
  const orderTypes = config.order_types;
  if (
    !orderTypes ||
    orderTypes.emergency_exit !== 'market' ||
    orderTypes.force_exit !== 'market' ||
    orderTypes.stoploss !== 'market' ||
    typeof orderTypes.stoploss_on_exchange !== 'boolean' ||
    (config.dry_run && orderTypes.stoploss_on_exchange !== false)
  ) {
    throw new Error('Freqtrade must use market stoploss and emergency/force exits; dry-run must keep stoploss_on_exchange disabled.');
  }
  const riskPctRaw = env.SBK1_SIGNAL_RISK_PCT?.trim();
  const maxStakeRaw = env.SBK1_SIGNAL_MAX_STAKE_QUOTE?.trim();
  const maxLeverageRaw = env.SBK1_SIGNAL_MAX_LEVERAGE?.trim();
  const riskPct = riskPctRaw ? Number(riskPctRaw) : undefined;
  const maxStake = maxStakeRaw ? Number(maxStakeRaw) : undefined;
  const maxLeverage = maxLeverageRaw ? Number(maxLeverageRaw) : undefined;
  const fixtureEnabled = env.SBK1_DRY_RUN_FIXTURE_ENABLED === 'true';
  if (
    (fixtureEnabled && (riskPct === undefined || maxStake === undefined || maxLeverage === undefined)) ||
    (riskPct !== undefined && (!Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 1)) ||
    (maxStake !== undefined &&
      (!Number.isFinite(maxStake) || maxStake <= 0 || maxStake > config.stake_amount)) ||
    (maxLeverage !== undefined && (!Number.isFinite(maxLeverage) || maxLeverage <= 0 || maxLeverage > 1))
  ) {
    throw new Error('Fixture risk limits must be finite, bounded (risk <= 1%, leverage <= 1x), and max stake must not exceed Freqtrade stake_amount.');
  }

  const api = config.api_server;
  const apiUsername = env.FREQTRADE__API_SERVER__USERNAME?.trim() || api?.username;
  const apiPassword = env.FREQTRADE__API_SERVER__PASSWORD || api?.password;
  if (
    api?.enabled !== true ||
    !Number.isInteger(api.listen_port) ||
    (api.listen_port ?? 0) < 1 ||
    (api.listen_port ?? 0) > 65535 ||
    !api.listen_ip_address ||
    !isLoopbackHostname(api.listen_ip_address) ||
    !apiUsername ||
    !apiPassword ||
    apiUsername !== env.FREQTRADE_USERNAME?.trim() ||
    apiPassword !== env.FREQTRADE_PASSWORD
  ) {
    throw new Error('Freqtrade API must use the configured credentials and be bound to a loopback address.');
  }

  const apiUrl = parseLocalHttpUrl(
    env.FREQTRADE_BASE_URL?.trim() || 'http://127.0.0.1:8080',
    'FREQTRADE_BASE_URL',
  );
  if (Number(apiUrl.port || (apiUrl.protocol === 'https:' ? 443 : 80)) !== api.listen_port) {
    throw new Error('FREQTRADE_BASE_URL port must match api_server.listen_port.');
  }

  const bridgeUrl = parseLocalHttpUrl(
    env.SBK1_BRIDGE_URL?.trim() || `http://127.0.0.1:${nodePort}`,
    'SBK1_BRIDGE_URL',
  );
  if (Number(bridgeUrl.port || (bridgeUrl.protocol === 'https:' ? 443 : 80)) !== nodePort) {
    throw new Error(`SBK1_BRIDGE_URL must use the SBK1 server port ${nodePort}.`);
  }

  return {
    apiBaseUrl: normalizeApiBaseUrl(apiUrl),
    bridgeBaseUrl: bridgeUrl.toString().replace(/\/$/, ''),
    exchange,
    pair,
    timeframe,
    market: config.trading_mode,
    apiPort: api.listen_port,
    apiHost: api.listen_ip_address,
    nodePort,
    liveEnabled,
  };
}

export function isValidSbk1HealthResponse(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    body.status === 'ok' &&
    'service' in body &&
    body.service === 'sbk1'
  );
}

function normalizeApiBaseUrl(url: URL): string {
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = basePath.endsWith('/api/v1') ? basePath : `${basePath}/api/v1`;
  return url.toString().replace(/\/$/, '');
}

async function loadRuntimeSettings(): Promise<RuntimeSettings> {
  let config: FreqtradeConfig;
  try {
    config = JSON.parse(await readFile(FREQTRADE_CONFIG_PATH, 'utf8')) as FreqtradeConfig;
  } catch (error) {
    const reason = error instanceof Error && 'code' in error && error.code === 'ENOENT'
      ? 'file is missing'
      : 'file is not valid JSON';
    throw new Error(`Freqtrade config ${path.relative(ROOT_DIR, FREQTRADE_CONFIG_PATH)} ${reason}.`);
  }
  settings = validateRuntimeSettings(config, process.env);
  return settings;
}

function freqtradeExecutable(): string {
  return process.platform === 'win32'
    ? path.join(ROOT_DIR, '.venv', 'Scripts', 'freqtrade.exe')
    : path.join(ROOT_DIR, '.venv', 'bin', 'freqtrade');
}

async function validatePrerequisites(): Promise<void> {
  for (const [filePath, description] of [
    [freqtradeExecutable(), 'Freqtrade executable in .venv'],
    [path.join(STRATEGY_PATH, 'SbkSignalStrategy.py'), 'SBK1 Freqtrade strategy'],
  ]) {
    try {
      await access(filePath, fsConstants.R_OK | (description.includes('executable') ? fsConstants.X_OK : 0));
    } catch {
      throw new Error(`${description} is unavailable at ${path.relative(ROOT_DIR, filePath)}.`);
    }
  }
}

async function acquireLock(): Promise<void> {
  const token = randomUUID();
  const contents: SignalStoreLock = { pid: process.pid, token };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(LOCK_PATH, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(contents));
      } finally {
        await handle.close();
      }
      lockToken = token;
      return;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      let existing: SignalStoreLock;
      try {
        existing = JSON.parse(await readFile(LOCK_PATH, 'utf8')) as SignalStoreLock;
      } catch {
        throw new Error('SBK1 startup lock exists but is unreadable; inspect it before removing it.');
      }
      if (!Number.isSafeInteger(existing.pid) || existing.pid < 1) {
        throw new Error('SBK1 startup lock has an invalid process ID; inspect it before removing it.');
      }
      try {
        process.kill(existing.pid, 0);
        throw new Error(`SBK1 is already managed by process ${existing.pid}.`);
      } catch (processError) {
        if (processError instanceof Error && 'code' in processError && processError.code === 'ESRCH') {
          await unlink(LOCK_PATH);
          continue;
        }
        throw processError;
      }
    }
  }
  throw new Error('Could not acquire the SBK1 startup lock.');
}

async function releaseLock(): Promise<void> {
  if (!lockToken) return;
  try {
    const existing = JSON.parse(await readFile(LOCK_PATH, 'utf8')) as SignalStoreLock;
    if (existing.pid === process.pid && existing.token === lockToken) await unlink(LOCK_PATH);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      console.error('[sbk1] Could not release the startup lock.');
      exitCode = 1;
    }
  } finally {
    lockToken = undefined;
  }
}

function isPortOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => socket.destroy(), 750);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

interface PortListener {
  pid: number;
  owner: string;
  command: string;
}

function findPortListeners(port: number): PortListener[] {
  if (process.platform !== 'linux') return [];
  const sockets = spawnSync('ss', ['-ltnp'], { encoding: 'utf8', timeout: 2_000 });
  if (sockets.error || sockets.status !== 0) return [];

  const pids = new Set<number>();
  for (const line of sockets.stdout.split('\n')) {
    const columns = line.trim().split(/\s+/);
    if (!columns.includes('LISTEN') || !columns[3]?.endsWith(`:${port}`)) continue;
    for (const match of line.matchAll(/pid=(\d+)/g)) pids.add(Number(match[1]));
  }

  return [...pids].map((pid) => {
    const processInfo = spawnSync('ps', ['-o', 'user=', '-o', 'args=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2_000,
    });
    const [owner = 'unknown', ...commandParts] = (processInfo.stdout || '').trim().split(/\s+/);
    return {
      pid,
      owner: owner || 'unknown',
      command: commandParts.join(' ') || 'unavailable',
    };
  });
}

function describePortListeners(port: number): string {
  const listeners = findPortListeners(port);
  if (listeners.length === 0) {
    return `port ${port} has a listener, but its PID, owner, and command could not be read`;
  }
  return listeners
    .map(({ pid, owner, command }) => `port ${port}: PID ${pid}, owner ${owner}, command "${command}"`)
    .join('; ');
}

async function ensurePortsAvailable(healthDiagnostics: string[]): Promise<void> {
  const nodeBusy = await isPortOpen(settings!.nodePort);
  const freqtradeBusy = await isPortOpen(settings!.apiPort, settings!.apiHost);
  if (nodeBusy || freqtradeBusy) {
    const listeners = [
      ...(nodeBusy ? [describePortListeners(settings!.nodePort)] : []),
      ...(freqtradeBusy ? [describePortListeners(settings!.apiPort)] : []),
    ];
    const health = healthDiagnostics.length > 0 ? `Health checks: ${healthDiagnostics.join('; ')}. ` : '';
    throw new Error(`${health}Existing services occupy the required ports (${listeners.join('; ')}); refusing to stop or replace them.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function apiUrl(endpoint: string): string {
  return `${settings!.apiBaseUrl}${endpoint}`;
}

async function requestJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try {
      return await response.json() as unknown;
    } catch {
      throw new Error('invalid JSON response');
    }
  } finally {
    clearTimeout(timer);
  }
}

async function checkFreqtradeReady(): Promise<void> {
  const ping = await requestJson(apiUrl('/ping'));
  if (!isRecord(ping) || ping.status !== 'pong') {
    throw new Error('RPC ping did not return a valid pong response.');
  }

  const username = process.env.FREQTRADE_USERNAME!.trim();
  const password = process.env.FREQTRADE_PASSWORD!;
  const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
  const login = await requestJson(apiUrl('/token/login'), {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
  });
  if (!isRecord(login) || typeof login.access_token !== 'string' || !login.access_token) {
    throw new Error('RPC authentication did not return an access token.');
  }
  const headers = { Authorization: `Bearer ${login.access_token}` };
  const config = await requestJson(apiUrl('/show_config'), { headers });
  const whitelist = await requestJson(apiUrl('/whitelist'), { headers });
  const status = await requestJson(apiUrl('/status'), { headers });
  if (
    !isRecord(config) ||
    !isRecord(whitelist) ||
    config.strategy !== STRATEGY_NAME ||
    config.dry_run !== true ||
    config.state !== 'running' ||
    String(config.exchange).toLowerCase() !== settings!.exchange ||
    config.trading_mode !== settings!.market ||
    config.timeframe !== settings!.timeframe ||
    !Array.isArray(whitelist.whitelist) ||
    !whitelist.whitelist.includes(settings!.pair) ||
    !Array.isArray(status)
  ) {
    throw new Error('Authenticated RPC state does not match the validated SBK1 execution configuration.');
  }
}

async function waitFor(
  label: string,
  check: () => Promise<void>,
  child?: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError = 'not ready';
  while (Date.now() < deadline) {
    if (shutdownPromise) throw new Error(`${label} startup was interrupted.`);
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`${label} exited before becoming ready.`);
    }
    try {
      await check();
      console.log(`[sbk1] ${label} is ready.`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`${label} did not become ready within ${STARTUP_TIMEOUT_MS / 1_000}s (last check: ${lastError}).`);
}

function verifyStrategyDiscovery(): void {
  const result = spawnSync(
    freqtradeExecutable(),
    [
      'list-strategies',
      '--userdir',
      'freqtrade/user_data',
      '--strategy-path',
      'freqtrade_integration/strategies',
    ],
    { cwd: ROOT_DIR, env: process.env, encoding: 'utf8', timeout: 45_000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error('Freqtrade strategy discovery failed; check the Python environment and configuration.');
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!new RegExp(`\\b${STRATEGY_NAME}\\b`).test(output) || !/\bOK\b/.test(output)) {
    throw new Error(`Freqtrade did not load ${STRATEGY_NAME} successfully.`);
  }
  console.log(`[sbk1] Freqtrade discovered ${STRATEGY_NAME} successfully.`);
}

function spawnManaged(
  command: string,
  args: string[],
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): ChildProcess {
  const child = spawn(command, args, { cwd: ROOT_DIR, env, stdio: 'inherit' });
  child.once('error', (error) => {
    console.error(`[sbk1] Could not start ${label}: ${error.message}`);
    void requestShutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (shutdownPromise) return;
    console.error(`[sbk1] ${label} exited unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`);
    void requestShutdown(code && code > 0 ? code : 1);
  });
  return child;
}

function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    forceTimer.unref();
    child.once('close', () => {
      clearTimeout(forceTimer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

function requestShutdown(code = 0): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  exitCode = code;
  shutdownPromise = (async () => {
    console.log('[sbk1] Stopping managed services...');
    await stopChild(freqtradeProcess);
    await stopChild(nodeProcess);
    await releaseLock();
    lifetimeResolve?.();
  })();
  return shutdownPromise;
}

async function checkSbk1Ready(): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${settings!.nodePort}/api/health`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Health endpoint did not return JSON; the SBK1 process may be an older version.');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Health endpoint returned invalid JSON.');
  }
  if (!isValidSbk1HealthResponse(body)) {
    throw new Error('Health endpoint returned an invalid response.');
  }
}

async function statusCommand(): Promise<void> {
  try {
    settings = await loadRuntimeSettings();
  } catch (error) {
    console.error(`[sbk1] Runtime configuration check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  let nodeReady = false;
  try {
    await checkSbk1Ready();
    nodeReady = true;
  } catch (error) {
    console.error(`[sbk1] SBK1 API health check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  let freqtradeReady = false;
  try {
    await checkFreqtradeReady();
    freqtradeReady = true;
  } catch (error) {
    console.error(`[sbk1] Freqtrade RPC health check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`[sbk1] SBK1 API: ${nodeReady ? 'ready' : 'unavailable'}`);
  console.log(`[sbk1] Freqtrade RPC: ${freqtradeReady ? 'ready' : 'unavailable'}`);
  if (!nodeReady || !freqtradeReady) process.exitCode = 1;
}

async function checkExistingStack(): Promise<{ ready: boolean; details: string[] }> {
  const checks = await Promise.all([
    checkSbk1Ready().then(
      () => ({ service: 'SBK1 API', ready: true as const }),
      (error: unknown) => ({
        service: 'SBK1 API',
        ready: false as const,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
    checkFreqtradeReady().then(
      () => ({ service: 'Freqtrade RPC', ready: true as const }),
      (error: unknown) => ({
        service: 'Freqtrade RPC',
        ready: false as const,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
  ]);
  return {
    ready: checks.every((check) => check.ready),
    details: checks.flatMap((check) => {
      if (!('error' in check)) return [];
      return [`${check.service}: ${check.error}`];
    }),
  };
}

async function runStack(): Promise<void> {
  process.once('SIGINT', () => void requestShutdown(130));
  process.once('SIGTERM', () => void requestShutdown(143));
  const lifetime = new Promise<void>((resolve) => {
    lifetimeResolve = resolve;
  });
  try {
    settings = await loadRuntimeSettings();
    if (shutdownPromise) return;
    const existingStack = await checkExistingStack();
    if (existingStack.ready) {
      console.log('[sbk1] SBK1 API and authenticated Freqtrade RPC are already healthy; no duplicate services were started.');
      return;
    }
    await validatePrerequisites();
    if (shutdownPromise) return;
    await ensurePortsAvailable(existingStack.details);
    verifyStrategyDiscovery();
    if (shutdownPromise) return;
    await acquireLock();
    if (shutdownPromise) {
      await releaseLock();
      return;
    }

    nodeProcess = spawnManaged(
      process.execPath,
      ['--import', 'tsx', 'server.ts'],
      'SBK1 server',
    );
    await waitFor('SBK1 API', checkSbk1Ready, nodeProcess);

    freqtradeProcess = spawnManaged(
      freqtradeExecutable(),
      [
        'trade',
        '--userdir',
        'freqtrade/user_data',
        '--config',
        'freqtrade/user_data/config.json',
        '--strategy-path',
        'freqtrade_integration/strategies',
        '--strategy',
        STRATEGY_NAME,
      ],
      'Freqtrade',
      { ...process.env, SBK1_BRIDGE_URL: settings.bridgeBaseUrl },
    );
    await waitFor('Freqtrade RPC and strategy', checkFreqtradeReady, freqtradeProcess);
    console.log('[sbk1] Both services are healthy. Press Ctrl+C to stop the managed stack.');
  } catch (error) {
    await requestShutdown(1);
    throw error;
  }

  await lifetime;
  process.exitCode = exitCode;
}

async function main(): Promise<void> {
  const [mode] = process.argv.slice(2);
  if (mode === '--status') {
    await statusCommand();
    return;
  }
  if (mode === '--check') {
    settings = await loadRuntimeSettings();
    await validatePrerequisites();
    verifyStrategyDiscovery();
    console.log('[sbk1] Startup configuration checks passed; no services were started.');
    return;
  }
  if (mode) throw new Error(`Unknown option: ${mode}`);
  await runStack();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(async (error: unknown) => {
    await requestShutdown(1);
    console.error(`[sbk1] Startup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
