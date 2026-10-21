import type {
  FreqtradeMarketCandle,
  FreqtradeMarketOpenInterest,
  FreqtradeMarketOrderBook,
  FreqtradeMarketTradeFlow,
} from './freqtradeMarketDataBridge';

export interface PublicMarketFallbackFeed<T> {
  status: 'LIVE' | 'UNAVAILABLE';
  sourceTimestampMs: number | null;
  value: T | null;
  error?: string;
}

export interface PublicMarketFallbackData {
  provider: 'Binance public REST API';
  venue: 'binance';
  market: 'spot' | 'futures';
  pair: string;
  timeframe: string;
  retrievedAtMs: number;
  candles: PublicMarketFallbackFeed<FreqtradeMarketCandle[]>;
  orderBook: PublicMarketFallbackFeed<FreqtradeMarketOrderBook>;
  tradeFlow: PublicMarketFallbackFeed<FreqtradeMarketTradeFlow>;
  fundingRate: PublicMarketFallbackFeed<{ retrievedAtMs: number; rate: number }>;
  openInterest: PublicMarketFallbackFeed<FreqtradeMarketOpenInterest>;
}

const MAX_FEED_AGE_MS = {
  orderBook: 5_000,
  tradeFlow: 5_000,
  fundingRate: 60_000,
  openInterest: 10 * 60_000,
} as const;

type MarketKind = 'spot' | 'futures';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeSymbol(pair: string): string {
  const match = /^([A-Z0-9]+)\/USDT(?::USDT)?$/i.exec(pair.trim());
  if (!match) {
    throw new Error(`Binance fallback supports USDT-quoted spot or perpetual pairs; received ${pair}.`);
  }
  return `${match[1].toUpperCase()}USDT`;
}

function timeframeInterval(timeframe: string): string {
  if (!/^\d+[mhdw]$/.test(timeframe)) {
    throw new Error(`Unsupported Binance fallback timeframe: ${timeframe}.`);
  }
  return timeframe;
}

function timeframeMs(timeframe: string): number {
  const match = /^(\d+)([mhdw])$/.exec(timeframe);
  if (!match) throw new Error(`Unsupported Binance fallback timeframe: ${timeframe}.`);
  const factor: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return Number(match[1]) * factor[match[2]];
}

function candleMaxAgeMs(timeframe: string): number {
  return timeframeMs(timeframe) + 60_000;
}

function unavailable<T>(error: unknown): PublicMarketFallbackFeed<T> {
  return {
    status: 'UNAVAILABLE',
    sourceTimestampMs: null,
    value: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

function freshFeed<T>(
  value: T,
  sourceTimestampMs: number,
  nowMs: number,
  maxAgeMs: number,
): PublicMarketFallbackFeed<T> {
  const evaluatedAtMs = Math.max(nowMs, Date.now());
  if (
    !Number.isSafeInteger(sourceTimestampMs) ||
    sourceTimestampMs > evaluatedAtMs ||
    evaluatedAtMs - sourceTimestampMs > maxAgeMs
  ) {
    throw new Error(`Binance fallback response is stale or future-dated (limit ${maxAgeMs}ms).`);
  }
  return { status: 'LIVE', sourceTimestampMs, value };
}

async function requestJson(
  url: string,
  fetcher: typeof fetch,
  nowMs: number,
  timeoutMs: number,
): Promise<{ payload: unknown; retrievedAtMs: number }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if ((response.status === 429 || response.status >= 500) && attempt === 0) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await new Promise((resolve) =>
          setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1_000, 1_000)
            : 200),
        );
        continue;
      }
      if (!response.ok) throw new Error(`Binance public API returned HTTP ${response.status}.`);
      const payload: unknown = await response.json();
      return { payload, retrievedAtMs: Date.now() || nowMs };
    } catch (error) {
      lastError = error;
      if (attempt === 0 && !(error instanceof Error && error.message.startsWith('Binance public API returned HTTP'))) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Binance public API request failed.');
}

async function fetchJsonEndpoint(
  url: string,
  fetcher: typeof fetch,
  nowMs: number,
  timeoutMs: number,
): Promise<{ payload: unknown; retrievedAtMs: number }> {
  return requestJson(url, fetcher, nowMs, timeoutMs);
}

function parseCandles(
  payload: unknown,
  nowMs: number,
  intervalMs: number,
  candleMaxAge: number,
): { candles: FreqtradeMarketCandle[]; latestCloseMs: number } {
  if (!Array.isArray(payload) || payload.length < 30) {
    throw new Error('Binance klines response has fewer than 30 candles.');
  }
  const parsed = payload.flatMap((row): FreqtradeMarketCandle[] => {
    if (!Array.isArray(row) || row.length < 6) return [];
    const [timestamp, open, high, low, close, volume] = row.map(Number);
    if (
      !Number.isSafeInteger(timestamp) ||
      ![open, high, low, close, volume].every(Number.isFinite) ||
      Math.min(open, high, low, close) <= 0 ||
      volume < 0 ||
      high < Math.max(open, close, low) ||
      low > Math.min(open, close, high) ||
      timestamp + intervalMs > nowMs
    ) return [];
    return [{ timestampMs: timestamp, open, high, low, close, volume }];
  });
  if (parsed.length < 30) {
    throw new Error('Binance klines response has fewer than 30 valid completed candles.');
  }
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index].timestampMs - parsed[index - 1].timestampMs !== intervalMs) {
      throw new Error('Binance kline timestamps are not contiguous.');
    }
  }
  const latestCloseMs = parsed.at(-1)!.timestampMs + intervalMs;
  if (nowMs - latestCloseMs > candleMaxAge) {
    throw new Error('Binance latest completed candle is stale.');
  }
  return { candles: parsed, latestCloseMs };
}

function parseOrderBook(payload: unknown, retrievedAtMs: number): FreqtradeMarketOrderBook {
  if (!isRecord(payload) || !Array.isArray(payload.bids) || !Array.isArray(payload.asks)) {
    throw new Error('Binance depth response is malformed.');
  }
  const parseLevels = (levels: unknown[]): Array<{ price: number; amount: number }> =>
    levels.slice(0, 20).map((level) => {
      if (!Array.isArray(level) || level.length < 2) throw new Error('Binance depth level is malformed.');
      const price = Number(level[0]);
      const amount = Number(level[1]);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('Binance depth level has invalid price or size.');
      }
      return { price, amount };
    });
  const bids = parseLevels(payload.bids);
  const asks = parseLevels(payload.asks);
  if (bids.length === 0 || asks.length === 0 || bids[0].price >= asks[0].price) {
    throw new Error('Binance depth has empty or crossed bid/ask levels.');
  }
  return { timestampMs: retrievedAtMs, bids, asks };
}

function parseTrades(payload: unknown, retrievedAtMs: number, nowMs: number): FreqtradeMarketTradeFlow {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Binance recent trades response is empty.');
  }
  const trades = payload.flatMap((trade: unknown) => {
    if (!isRecord(trade) || !finiteNumber(Number(trade.T)) ||
        !finiteNumber(Number(trade.p)) || !finiteNumber(Number(trade.q)) ||
        typeof trade.m !== 'boolean') return [];
    const timestampMs = Number(trade.T);
    const price = Number(trade.p);
    const amount = Number(trade.q);
    if (
      !Number.isSafeInteger(timestampMs) ||
      timestampMs > nowMs ||
      Math.max(nowMs, Date.now()) - timestampMs > MAX_FEED_AGE_MS.tradeFlow ||
      price <= 0 ||
      amount <= 0
    ) return [];
    return [{
      timestampMs,
      side: trade.m ? 'sell' as const : 'buy' as const,
      price,
      amount,
    }];
  }).sort((left, right) => left.timestampMs - right.timestampMs);
  if (trades.length === 0) throw new Error('Binance has no fresh, valid recent trades.');
  return { retrievedAtMs, trades };
}

export async function fetchPublicMarketFallback(options: {
  pair: string;
  timeframe: string;
  market: MarketKind;
  nowMs?: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<PublicMarketFallbackData> {
  const nowMs = options.nowMs ?? Date.now();
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const symbol = normalizeSymbol(options.pair);
  const interval = timeframeInterval(options.timeframe);
  const intervalMs = timeframeMs(interval);
  const tradeQueryNowMs = Math.max(nowMs, Date.now());
  const baseUrl = options.market === 'futures'
    ? 'https://fapi.binance.com'
    : 'https://api.binance.com';
  const endpoint = (pathname: string, params: Record<string, string>) => {
    const url = new URL(`${baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  };

  const fetchFeed = async <T>(
    url: string,
    parse: (payload: unknown, retrievedAtMs: number) => PublicMarketFallbackFeed<T>,
  ): Promise<PublicMarketFallbackFeed<T>> => {
    try {
      const { payload, retrievedAtMs } = await fetchJsonEndpoint(url, fetcher, nowMs, timeoutMs);
      return parse(payload, retrievedAtMs);
    } catch (error) {
      return unavailable<T>(error);
    }
  };

  const [candles, orderBook, tradeFlow] = await Promise.all([
    fetchFeed(endpoint(options.market === 'futures' ? '/fapi/v1/klines' : '/api/v3/klines', {
      symbol, interval, limit: '500',
    }), (payload) => {
      const maxAgeMs = candleMaxAgeMs(options.timeframe);
      const result = parseCandles(payload, nowMs, intervalMs, maxAgeMs);
      return freshFeed(result.candles, result.latestCloseMs, nowMs, maxAgeMs);
    }),
    fetchFeed(endpoint(options.market === 'futures' ? '/fapi/v1/depth' : '/api/v3/depth', {
      symbol, limit: '20',
    }), (payload, retrievedAtMs) =>
      freshFeed(parseOrderBook(payload, retrievedAtMs), retrievedAtMs, nowMs, MAX_FEED_AGE_MS.orderBook)),
    fetchFeed(endpoint(options.market === 'futures' ? '/fapi/v1/aggTrades' : '/api/v3/aggTrades', {
      symbol,
      startTime: String(tradeQueryNowMs - MAX_FEED_AGE_MS.tradeFlow),
      endTime: String(tradeQueryNowMs),
      limit: '1000',
    }), (payload, retrievedAtMs) => {
      const tradeFlow = parseTrades(payload, retrievedAtMs, tradeQueryNowMs);
      const sourceTimestampMs = tradeFlow.trades.at(-1)!.timestampMs;
      return freshFeed(
        tradeFlow,
        sourceTimestampMs,
        retrievedAtMs,
        MAX_FEED_AGE_MS.tradeFlow,
      );
    }),
  ]);

  let fundingRate: PublicMarketFallbackFeed<{ retrievedAtMs: number; rate: number }> = unavailable(
    options.market === 'futures' ? 'Funding endpoint was not queried.' : 'Funding is unavailable for spot markets.',
  );
  let openInterest: PublicMarketFallbackFeed<FreqtradeMarketOpenInterest> = unavailable(
    options.market === 'futures' ? 'Open-interest endpoint was not queried.' : 'Open interest is unavailable for spot markets.',
  );
  if (options.market === 'futures') {
    [fundingRate, openInterest] = await Promise.all([
      fetchFeed(endpoint('/fapi/v1/premiumIndex', { symbol }), (payload, retrievedAtMs) => {
        if (!isRecord(payload) || !finiteNumber(Number(payload.lastFundingRate))) {
          throw new Error('Binance premium-index response has no valid funding rate.');
        }
        const sourceTimestampMs = finiteNumber(Number(payload.time)) ? Number(payload.time) : retrievedAtMs;
        return freshFeed(
          { retrievedAtMs, rate: Number(payload.lastFundingRate) },
          sourceTimestampMs,
          nowMs,
          MAX_FEED_AGE_MS.fundingRate,
        );
      }),
      fetchFeed(endpoint('/futures/data/openInterestHist', { symbol, period: '5m', limit: '2' }), (payload, retrievedAtMs) => {
        if (!Array.isArray(payload) || payload.length < 2) {
          throw new Error('Binance open-interest history returned fewer than two records.');
        }
        const records = payload.filter(isRecord).map((record) => ({
          timestampMs: Number(record.timestamp),
          amount: Number(record.sumOpenInterest),
        })).filter((record) =>
          Number.isSafeInteger(record.timestampMs) &&
          record.timestampMs > 0 &&
          Number.isFinite(record.amount) &&
          record.amount > 0
        ).sort((left, right) => left.timestampMs - right.timestampMs);
        if (records.length < 2) throw new Error('Binance open-interest history is malformed.');
        const previous = records.at(-2)!;
        const latest = records.at(-1)!;
        if (
          latest.timestampMs - previous.timestampMs !== 5 * 60_000 ||
          latest.timestampMs > nowMs ||
          nowMs - latest.timestampMs > MAX_FEED_AGE_MS.openInterest
        ) throw new Error('Binance open-interest records are not adjacent, fresh five-minute observations.');
        const value: FreqtradeMarketOpenInterest = {
          retrievedAtMs,
          previousTimestampMs: previous.timestampMs,
          latestTimestampMs: latest.timestampMs,
          previousAmount: previous.amount,
          latestAmount: latest.amount,
        };
        return freshFeed(value, latest.timestampMs, nowMs, MAX_FEED_AGE_MS.openInterest);
      }),
    ]);
  }

  return {
    provider: 'Binance public REST API',
    venue: 'binance',
    market: options.market,
    pair: options.pair,
    timeframe: options.timeframe,
    retrievedAtMs: nowMs,
    candles,
    orderBook,
    tradeFlow,
    fundingRate,
    openInterest,
  };
}
