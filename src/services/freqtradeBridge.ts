export interface FreqtradeBotState {
  status: 'running' | 'stopped';
  ping: boolean;
  version?: string;
  strategy?: string;
  exchange?: string;
  market?: 'spot' | 'futures';
  timeframe?: string;
  demoTrading?: boolean;
  dryRun: boolean;
  forceEntryEnabled: boolean;
  maxOpenTrades?: number;
  openTradesCount: number;
  lastChecked: number;
}

export interface FreqtradeOrder {
  order_id: string;
  status: string;
  amount: number;
  filled: number | null;
  safe_price: number;
  cost: number;
  ft_order_side: string;
  is_open: boolean;
  order_filled_timestamp: number | null;
}

export interface FreqtradeTrade {
  trade_id: number;
  pair: string;
  is_open: boolean;
  is_short: boolean;
  enter_tag?: string | null;
  amount: number;
  amount_requested: number | null;
  open_rate: number;
  open_timestamp?: number;
  stake_amount: number;
  has_open_orders: boolean;
  orders: FreqtradeOrder[];
  fee_open?: number | null;
  fee_open_cost: number | null;
  fee_open_currency?: string | null;
  fee_close?: number | null;
  fee_close_cost: number | null;
  fee_close_currency?: string | null;
  open_fill_timestamp: number | null;
  close_rate?: number | null;
  close_profit?: number | null;
  close_profit_pct?: number | null;
  close_profit_abs?: number | null;
  exit_reason?: string | null;
  funding_fees?: number | null;
  close_timestamp: number | null;
}

export interface FreqtradeBalance {
  equity: number;
  available: number;
  currency: string;
}

export class FreqtradeRpcError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'FreqtradeRpcError';
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalizedHostname === 'localhost' || normalizedHostname === '::1') {
    return true;
  }

  const ipv4Parts = normalizedHostname.split('.');
  return ipv4Parts.length === 4 &&
    ipv4Parts[0] === '127' &&
    ipv4Parts.slice(1).every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function getFreqtradeApiBaseUrl(): string {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const configuredBaseUrl = runtime.process?.env?.FREQTRADE_BASE_URL?.trim() || 'http://127.0.0.1:8080';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredBaseUrl);
  } catch {
    throw new FreqtradeRpcError('FREQTRADE_BASE_URL must be a valid HTTP(S) URL.');
  }
  if (
    (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new FreqtradeRpcError('FREQTRADE_BASE_URL must be an HTTP(S) URL without embedded credentials or query parameters.');
  }
  if (parsedUrl.protocol === 'http:' && !isLoopbackHostname(parsedUrl.hostname)) {
    throw new FreqtradeRpcError('FREQTRADE_BASE_URL must use HTTPS unless it targets a loopback host.');
  }

  const basePath = parsedUrl.pathname.replace(/\/+$/, '');
  parsedUrl.pathname = basePath.endsWith('/api/v1') ? basePath : `${basePath}/api/v1`;
  return parsedUrl.toString().replace(/\/$/, '');
}

interface FreqtradeConfig {
  version?: string;
  strategy?: string;
  dry_run?: boolean;
  exchange?: string;
  trading_mode?: string;
  timeframe?: string;
  demo_trading?: boolean;
  state?: string;
  stake_currency?: string;
  force_entry_enable?: boolean;
  max_open_trades?: number;
}

interface FreqtradeWhitelistResponse {
  whitelist: string[];
}

interface FreqtradeBalanceResponse {
  total: number;
  currencies: Array<{ currency: string; free: number; balance: number }>;
}

interface FreqtradeTradesResponse {
  trades: FreqtradeTrade[];
}

interface FreqtradeForceExitResponse {
  result: string;
}

interface FreqtradeCredentials {
  username: string;
  password: string;
}

class FreqtradeBridge {
  private readonly requestTimeoutMs = 5000;
  private accessToken: string | null = null;
  private loginRequest: Promise<string> | null = null;

  private getCredentials(): FreqtradeCredentials {
    const runtime = globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    };
    const username = runtime.process?.env?.FREQTRADE_USERNAME?.trim();
    const password = runtime.process?.env?.FREQTRADE_PASSWORD;
    if (!username || !password) {
      throw new FreqtradeRpcError('FREQTRADE_USERNAME and FREQTRADE_PASSWORD are required for authenticated Freqtrade RPC access.');
    }
    return { username, password };
  }

  private async fetchJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(`${getFreqtradeApiBaseUrl()}${endpoint}`, {
        ...options,
        signal: controller.signal,
      });
      const responseText = await response.text();
      let body: unknown;
      try {
        body = responseText ? JSON.parse(responseText) : undefined;
      } catch {
        throw new FreqtradeRpcError(`Freqtrade RPC returned invalid JSON for ${endpoint}.`, response.status);
      }
      if (!response.ok) {
        const detail =
          typeof body === 'object' && body !== null && 'detail' in body
            ? String((body as { detail: unknown }).detail)
            : `HTTP ${response.status}`;
        throw new FreqtradeRpcError(`Freqtrade RPC ${endpoint} failed: ${detail}`, response.status);
      }
      if (body === undefined) {
        throw new FreqtradeRpcError(`Freqtrade RPC returned an empty response for ${endpoint}.`, response.status);
      }
      return body as T;
    } catch (error) {
      if (error instanceof FreqtradeRpcError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new FreqtradeRpcError(`Freqtrade RPC request to ${endpoint} failed: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async login({ username, password }: FreqtradeCredentials): Promise<string> {
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
    const response = await this.fetchJson<{ access_token?: string }>('/token/login', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
    });
    if (typeof response.access_token !== 'string' || response.access_token.length === 0) {
      throw new FreqtradeRpcError('Freqtrade RPC authentication did not return an access token.');
    }
    this.accessToken = response.access_token;
    return response.access_token;
  }

  private async getAccessToken(credentials: FreqtradeCredentials): Promise<string> {
    if (this.accessToken) return this.accessToken;
    if (!this.loginRequest) {
      const loginRequest = this.login(credentials);
      this.loginRequest = loginRequest;
      try {
        return await loginRequest;
      } finally {
        if (this.loginRequest === loginRequest) this.loginRequest = null;
      }
    }
    return this.loginRequest;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const credentials = this.getCredentials();
    const token = await this.getAccessToken(credentials);
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');

    try {
      return await this.fetchJson<T>(endpoint, { ...options, headers });
    } catch (error) {
      if (!(error instanceof FreqtradeRpcError) || error.statusCode !== 401 || options.method === 'POST') {
        throw error;
      }

      if (this.accessToken === token) this.accessToken = null;
      const refreshedToken = await this.getAccessToken(credentials);
      headers.set('Authorization', `Bearer ${refreshedToken}`);
      return this.fetchJson<T>(endpoint, { ...options, headers });
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.fetchJson<{ status?: string }>('/ping');
      return result.status === 'pong';
    } catch {
      return false;
    }
  }

  private async getConfig(): Promise<FreqtradeConfig> {
    return this.request<FreqtradeConfig>('/show_config');
  }

  getConfiguredPair(): string {
    const runtime = globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    };
    const pair = runtime.process?.env?.FREQTRADE_PAIR?.trim();
    if (!pair) {
      throw new FreqtradeRpcError('FREQTRADE_PAIR is not configured on the server.');
    }
    return pair;
  }

  async getStatus(): Promise<FreqtradeBotState> {
    const isPingOk = await this.ping();
    if (!isPingOk) {
      throw new FreqtradeRpcError('Freqtrade RPC is offline or did not return pong.');
    }

    const [config, trades] = await Promise.all([
      this.getConfig(),
      this.request<FreqtradeTrade[]>('/status'),
    ]);
    if (
      typeof config.dry_run !== 'boolean' ||
      typeof config.state !== 'string' ||
      typeof config.exchange !== 'string' ||
      typeof config.trading_mode !== 'string' ||
      typeof config.timeframe !== 'string' ||
      typeof config.demo_trading !== 'boolean' ||
      typeof config.force_entry_enable !== 'boolean' ||
      !Array.isArray(trades)
    ) {
      throw new FreqtradeRpcError('Freqtrade RPC status response is incomplete.');
    }
    return {
      status: config.state.toLowerCase() === 'running' ? 'running' : 'stopped',
      ping: true,
      version: config.version,
      strategy: config.strategy,
      exchange: config.exchange,
      market: config.trading_mode === 'futures' ? 'futures' : config.trading_mode === 'spot' ? 'spot' : undefined,
      timeframe: config.timeframe,
      demoTrading: config.demo_trading,
      dryRun: config.dry_run,
      forceEntryEnabled: config.force_entry_enable,
      maxOpenTrades: config.max_open_trades,
      openTradesCount: trades.length,
      lastChecked: Date.now(),
    };
  }

  async getWhitelist(): Promise<string[]> {
    const response = await this.request<FreqtradeWhitelistResponse>('/whitelist');
    if (!Array.isArray(response.whitelist) || !response.whitelist.every((pair) => typeof pair === 'string')) {
      throw new FreqtradeRpcError('Freqtrade RPC returned an invalid pair whitelist.');
    }
    return response.whitelist;
  }

  async getBalance(): Promise<FreqtradeBalance> {
    const [config, balance] = await Promise.all([
      this.getConfig(),
      this.request<FreqtradeBalanceResponse>('/balance'),
    ]);
    const currency = config.stake_currency;
    const stakeBalance = currency
      ? balance.currencies.find((item) => item.currency === currency)
      : undefined;
    if (
      !currency ||
      !stakeBalance ||
      !Number.isFinite(balance.total) ||
      !Number.isFinite(stakeBalance.free) ||
      balance.total < 0 ||
      stakeBalance.free < 0
    ) {
      throw new FreqtradeRpcError('Freqtrade RPC returned invalid or incomplete balance data.');
    }
    return { equity: balance.total, available: stakeBalance.free, currency };
  }

  async getOpenTrades(): Promise<FreqtradeTrade[]> {
    const trades = await this.request<FreqtradeTrade[]>('/status');
    if (!Array.isArray(trades)) {
      throw new FreqtradeRpcError('Freqtrade RPC returned an invalid open-trades response.');
    }
    return trades;
  }

  async getTrades(limit = 500, offset = 0): Promise<FreqtradeTrade[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 ||
      !Number.isSafeInteger(offset) || offset < 0) {
      throw new FreqtradeRpcError('Freqtrade trade-history limit must be an integer between 1 and 500.');
    }
    const history = await this.request<FreqtradeTradesResponse>(
      `/trades?limit=${limit}&offset=${offset}&order_by_id=true`,
    );
    if (!Array.isArray(history.trades)) {
      throw new FreqtradeRpcError('Freqtrade RPC returned an invalid trade-history response.');
    }
    return history.trades.map((trade) => {
      if (!trade || !Number.isSafeInteger(trade.trade_id) || trade.trade_id <= 0) {
        throw new FreqtradeRpcError('Freqtrade trade history contains an invalid trade ID.');
      }
      return this.validateTrade(trade, trade.trade_id);
    });
  }

  async getClosedTrades(limit = 50): Promise<FreqtradeTrade[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new FreqtradeRpcError('Closed-trade history limit must be an integer between 1 and 500.');
    }
    const trades = await this.getTrades(500);
    return trades.filter((trade) => !trade.is_open).slice(-limit).reverse();
  }

  async getAllClosedTrades(): Promise<FreqtradeTrade[]> {
    const closedTrades: FreqtradeTrade[] = [];
    const seenTradeIds = new Set<number>();
    let offset = 0;
    while (true) {
      const page = await this.getTrades(500, offset);
      for (const trade of page) {
        if (seenTradeIds.has(trade.trade_id)) {
          throw new FreqtradeRpcError(`Freqtrade trade history repeated trade ID ${trade.trade_id} across pages.`);
        }
        seenTradeIds.add(trade.trade_id);
        if (!trade.is_open) closedTrades.push(trade);
      }
      if (page.length < 500) return closedTrades;
      offset += page.length;
    }
  }

  async getTrade(tradeId: string | number): Promise<FreqtradeTrade> {
    const normalizedId = String(tradeId);
    if (!/^\d+$/.test(normalizedId)) {
      throw new FreqtradeRpcError('A numeric Freqtrade trade ID is required.');
    }
    try {
      return this.validateTrade(
        await this.request<FreqtradeTrade>(`/trade/${normalizedId}`),
        Number(normalizedId),
      );
    } catch (error) {
      if (!(error instanceof FreqtradeRpcError) || error.statusCode !== 404) {
        throw error;
      }
      const history = await this.request<FreqtradeTradesResponse>('/trades?limit=500&order_by_id=true');
      const trade = history.trades?.find((item) => item.trade_id === Number(normalizedId));
      if (!trade) throw error;
      return this.validateTrade(trade, Number(normalizedId));
    }
  }

  private validateTrade(trade: FreqtradeTrade, expectedId: number): FreqtradeTrade {
    const nullableFinite = (value: unknown): boolean =>
      value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value));
    const nullableTimestamp = (value: unknown): boolean =>
      value === null || value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0);
    if (
      !trade ||
      trade.trade_id !== expectedId ||
      expectedId <= 0 ||
      typeof trade.is_open !== 'boolean' ||
      typeof trade.is_short !== 'boolean' ||
      typeof trade.pair !== 'string' ||
      !trade.pair.trim() ||
      !Array.isArray(trade.orders) ||
      !trade.orders.every((order) =>
        typeof order.ft_order_side === 'string' &&
        typeof order.status === 'string' &&
        typeof order.is_open === 'boolean' &&
        Number.isFinite(order.amount) &&
        (order.filled === null || Number.isFinite(order.filled)) &&
        Number.isFinite(order.safe_price)
      ) ||
      !Number.isFinite(trade.amount) ||
      !Number.isFinite(trade.open_rate) ||
      !nullableFinite(trade.fee_open) ||
      !nullableFinite(trade.fee_open_cost) ||
      !nullableFinite(trade.fee_close) ||
      !nullableFinite(trade.fee_close_cost) ||
      !nullableFinite(trade.close_rate) ||
      !nullableFinite(trade.close_profit) ||
      !nullableFinite(trade.close_profit_pct) ||
      !nullableFinite(trade.close_profit_abs) ||
      !nullableFinite(trade.funding_fees) ||
      !nullableTimestamp(trade.open_timestamp) ||
      !nullableTimestamp(trade.open_fill_timestamp) ||
      !nullableTimestamp(trade.close_timestamp) ||
      (trade.enter_tag !== undefined && trade.enter_tag !== null && typeof trade.enter_tag !== 'string') ||
      (trade.exit_reason !== undefined && trade.exit_reason !== null && typeof trade.exit_reason !== 'string') ||
      (trade.fee_open_currency !== undefined && trade.fee_open_currency !== null && typeof trade.fee_open_currency !== 'string') ||
      (trade.fee_close_currency !== undefined && trade.fee_close_currency !== null && typeof trade.fee_close_currency !== 'string')
    ) {
      throw new FreqtradeRpcError(`Freqtrade returned invalid order state for trade ${expectedId}.`);
    }
    return trade;
  }

  async forceEntry(_params: {
    pair: string;
    side: 'long' | 'short';
    orderType: 'limit' | 'market';
    stakeAmount: number;
    leverage: number;
    entryTag: string;
  }): Promise<{ trade_id?: number; status?: string }> {
    throw new FreqtradeRpcError(
      'Manual Freqtrade force-entry is disabled. Entries must pass through SbkSignalStrategy.',
      410,
    );
  }

  async forceExit(tradeId: string | number): Promise<FreqtradeForceExitResponse> {
    const normalizedId = String(tradeId);
    if (!/^\d+$/.test(normalizedId)) {
      throw new FreqtradeRpcError('A numeric Freqtrade trade ID is required for force exit.');
    }
    const response = await this.request<FreqtradeForceExitResponse>('/forceexit', {
      method: 'POST',
      body: JSON.stringify({ tradeid: normalizedId }),
    });
    if (typeof response.result !== 'string' || response.result.length === 0) {
      throw new FreqtradeRpcError('Freqtrade did not acknowledge the force-exit request.');
    }
    return response;
  }
}

export const freqtradeBridge = new FreqtradeBridge();
