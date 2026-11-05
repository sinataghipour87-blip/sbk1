export type DeribitBlockTradesStatus = 'LIVE' | 'UNAVAILABLE' | 'REGION_RESTRICTED';

export interface DeribitBlockTrade {
  tradeId: string;
  timestampMs: number;
  direction: 'buy' | 'sell';
  amount: number;
  price: number;
  blockTradeId: string;
}

export interface DeribitBlockTradeData {
  status: DeribitBlockTradesStatus;
  provider: 'Deribit public market data API';
  sourceId: 'whale.deribit-block-trades';
  timestampMs: number | null;
  blockTradeCount: number;
  buyEth: number;
  sellEth: number;
  trades: DeribitBlockTrade[];
  coverage: 'RECENT_REPORTED_BLOCK_TRADES' | 'NO_BLOCK_TRADES' | 'UNAVAILABLE';
  error?: string;
}

const ENDPOINT =
  'https://www.deribit.com/api/v2/public/get_last_trades_by_currency?currency=ETH&kind=future&count=100';
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5_000;
const MAX_AGE_MS = 5 * 60_000;
let cachedAtMs = 0;
let cachedValue: DeribitBlockTradeData | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unavailable(error: string, status: DeribitBlockTradesStatus = 'UNAVAILABLE'): DeribitBlockTradeData {
  return {
    status,
    provider: 'Deribit public market data API',
    sourceId: 'whale.deribit-block-trades',
    timestampMs: null,
    blockTradeCount: 0,
    buyEth: 0,
    sellEth: 0,
    trades: [],
    coverage: 'UNAVAILABLE',
    error,
  };
}

export async function fetchDeribitBlockTrades(options: {
  nowMs?: number;
  fetcher?: typeof fetch;
} = {}): Promise<DeribitBlockTradeData> {
  const nowMs = options.nowMs ?? Date.now();
  if (cachedValue && nowMs >= cachedAtMs && nowMs - cachedAtMs < CACHE_TTL_MS) {
    return structuredClone(cachedValue);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (options.fetcher ?? fetch)(ENDPOINT, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 403 || response.status === 451) {
      return unavailable(`Deribit HTTP ${response.status} (regional/access restriction).`, 'REGION_RESTRICTED');
    }
    if (response.status === 429) return unavailable('Deribit HTTP 429 (rate limit).');
    if (!response.ok) return unavailable(`Deribit returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.result) || !Array.isArray(payload.result.trades)) {
      return unavailable('Deribit returned a malformed ETH futures trades response.');
    }
    const trades = payload.result.trades.flatMap((value): DeribitBlockTrade[] => {
      if (!isRecord(value)) return [];
      const blockTradeId = typeof value.block_trade_id === 'string' || typeof value.block_trade_id === 'number'
        ? String(value.block_trade_id)
        : '';
      if (
        !blockTradeId ||
        typeof value.trade_id !== 'string' ||
        (value.direction !== 'buy' && value.direction !== 'sell') ||
        typeof value.timestamp !== 'number' ||
        !Number.isFinite(value.timestamp) ||
        typeof value.amount !== 'number' ||
        !Number.isFinite(value.amount) ||
        value.amount <= 0 ||
        typeof value.price !== 'number' ||
        !Number.isFinite(value.price) ||
        value.price <= 0 ||
        typeof value.instrument_name !== 'string' ||
        !value.instrument_name.startsWith('ETH-')
      ) return [];
      return [{
        tradeId: value.trade_id,
        timestampMs: value.timestamp,
        direction: value.direction,
        amount: value.amount,
        price: value.price,
        blockTradeId,
      }];
    }).filter((trade) =>
      trade.timestampMs <= nowMs + 1_000 &&
      nowMs - trade.timestampMs <= MAX_AGE_MS
    );
    const timestampMs = trades.length > 0
      ? Math.max(...trades.map((trade) => trade.timestampMs))
      : Date.now();
    const result: DeribitBlockTradeData = {
      status: 'LIVE',
      provider: 'Deribit public market data API',
      sourceId: 'whale.deribit-block-trades',
      timestampMs,
      blockTradeCount: trades.length,
      buyEth: trades.reduce((sum, trade) => sum + (trade.direction === 'buy' ? trade.amount : 0), 0),
      sellEth: trades.reduce((sum, trade) => sum + (trade.direction === 'sell' ? trade.amount : 0), 0),
      trades,
      coverage: trades.length > 0 ? 'RECENT_REPORTED_BLOCK_TRADES' : 'NO_BLOCK_TRADES',
    };
    cachedAtMs = nowMs;
    cachedValue = result;
    return structuredClone(result);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

export function resetDeribitBlockTradesCacheForTests(): void {
  cachedAtMs = 0;
  cachedValue = null;
}
