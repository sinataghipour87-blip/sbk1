import type {
  FreqtradeMarketCandle,
  FreqtradeMarketOpenInterest,
  FreqtradeMarketOrderBook,
  FreqtradeMarketTradeFlow,
} from './freqtradeMarketDataBridge';
import { binancePublicMarketDataStream } from './publicMarketDataStream';
import { deduplicateQuotes, deduplicateTrades } from './councilEvidenceDeduplication';

export interface PublicMarketFallbackFeed<T> {
  status: 'LIVE' | 'UNAVAILABLE';
  provider?: string;
  sourceTimestampMs: number | null;
  endpoint?: string;
  receivedAtMs?: number | null;
  value: T | null;
  error?: string;
  isPartial?: boolean;
}

export interface PublicExchangeQuote {
  exchange: 'binance' | 'bybit' | 'okx';
  market: MarketKind;
  symbol: string;
  baseAsset: string;
  quoteAsset: 'USDT';
  priceUnit: string;
  price: number;
  sourceTimestampMs: number;
  retrievedAtMs: number;
  endpoint: string;
}

export interface PublicExchangeQuoteSource {
  exchange: 'binance' | 'bybit' | 'okx';
  symbol: string;
  endpoint: string;
  status: 'LIVE' | 'UNAVAILABLE';
  responseTimestampMs: number | null;
  receivedAtMs: number | null;
  error?: string;
}

export interface PublicMarketFallbackData {
  provider: 'Binance public REST API';
  venue: 'binance';
  market: 'spot' | 'futures';
  pair: string;
  timeframe: string;
  retrievedAtMs: number;
  exchangeQuotes: PublicMarketFallbackFeed<PublicExchangeQuote[]>;
  exchangeQuoteSources: PublicExchangeQuoteSource[];
  candles: PublicMarketFallbackFeed<FreqtradeMarketCandle[]>;
  fastCandles: PublicMarketFallbackFeed<FreqtradeMarketCandle[]>;
  higherTimeframeCandles: {
    '1h': PublicMarketFallbackFeed<FreqtradeMarketCandle[]>;
    '4h': PublicMarketFallbackFeed<FreqtradeMarketCandle[]>;
  };
  orderBook: PublicMarketFallbackFeed<FreqtradeMarketOrderBook>;
  tradeFlow: PublicMarketFallbackFeed<FreqtradeMarketTradeFlow>;
  fundingRate: PublicMarketFallbackFeed<{ retrievedAtMs: number; rate: number }>;
  openInterest: PublicMarketFallbackFeed<FreqtradeMarketOpenInterest>;
  liveOpenInterest: PublicMarketFallbackFeed<{ timestampMs: number; amount: number }>;
}

const MAX_FEED_AGE_MS = {
  orderBook: 5_000,
  tradeFlow: 5_000,
  fundingRate: 60_000,
  openInterest: 10 * 60_000,
  liveOpenInterest: 10_000,
  exchangeQuotes: 5_000,
} as const;
const MAX_CROSS_EXCHANGE_PRICE_SPREAD_PCT = 2;
const MAX_EXCHANGE_CLOCK_SKEW_MS = 10_000;
const MAX_HISTORICAL_CANDLE_LIMIT = {
  spot: 500,
  futures: 500,
} as const;
const FAST_CANDLE_LIMIT = 100;

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

function providerForEndpoint(endpoint: string): string {
  const host = new URL(endpoint).hostname;
  if (host === 'api.bybit.com') return 'Bybit V5 public REST API';
  if (host === 'www.okx.com') return 'OKX V5 public REST API';
  if (host === 'fapi.binance.com' || host === 'api.binance.com') return 'Binance public REST API';
  return 'Public market data provider';
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

function parseNormalizedCandles(
  candles: FreqtradeMarketCandle[],
  nowMs: number,
  intervalMs: number,
  candleMaxAge: number,
  provider: string,
): { candles: FreqtradeMarketCandle[]; latestCloseMs: number } {
  const parsed = candles
    .filter((candle) =>
      Number.isSafeInteger(candle.timestampMs) &&
      [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) &&
      Math.min(candle.open, candle.high, candle.low, candle.close) > 0 &&
      candle.volume >= 0 &&
      candle.high >= Math.max(candle.open, candle.close, candle.low) &&
      candle.low <= Math.min(candle.open, candle.close, candle.high) &&
      candle.timestampMs + intervalMs <= nowMs
    )
    .sort((left, right) => left.timestampMs - right.timestampMs);
  if (parsed.length < 30) {
    throw new Error(`${provider} returned fewer than 30 valid completed candles.`);
  }
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index].timestampMs - parsed[index - 1].timestampMs !== intervalMs) {
      throw new Error(`${provider} candle timestamps are not contiguous.`);
    }
  }
  const latestCloseMs = parsed.at(-1)!.timestampMs + intervalMs;
  if (nowMs - latestCloseMs > candleMaxAge) {
    throw new Error(`${provider} latest completed candle is stale.`);
  }
  return { candles: parsed, latestCloseMs };
}

function parseBybitCandles(
  payload: unknown,
  symbol: string,
  nowMs: number,
  interval: string,
): { candles: FreqtradeMarketCandle[]; latestCloseMs: number } {
  if (
    !isRecord(payload) ||
    Number(payload.retCode) !== 0 ||
    !isRecord(payload.result) ||
    payload.result.symbol !== symbol ||
    !Array.isArray(payload.result.list)
  ) {
    throw new Error('Bybit kline response is malformed or does not match the requested symbol.');
  }
  const candles = payload.result.list.flatMap((row): FreqtradeMarketCandle[] => {
    if (!Array.isArray(row) || row.length < 6) return [];
    const [timestamp, open, high, low, close, volume] = row.map(Number);
    return [{
      timestampMs: timestamp,
      open,
      high,
      low,
      close,
      volume,
    }];
  });
  return parseNormalizedCandles(
    candles,
    nowMs,
    timeframeMs(interval),
    candleMaxAgeMs(interval),
    'Bybit',
  );
}

function okxBar(timeframe: string): string {
  if (timeframe === '1h') return '1Hutc';
  if (timeframe === '4h') return '4Hutc';
  return timeframe;
}

function parseOkxCandles(
  payload: unknown,
  instrument: string,
  market: MarketKind,
  timeframe: string,
  nowMs: number,
): { candles: FreqtradeMarketCandle[]; latestCloseMs: number } {
  if (!isRecord(payload) || payload.code !== '0' || !Array.isArray(payload.data)) {
    throw new Error('OKX candle response is malformed or unsuccessful.');
  }
  const candles = payload.data.flatMap((row): FreqtradeMarketCandle[] => {
    if (!Array.isArray(row) || row.length < 9 || String(row[8]) !== '1') return [];
    const [timestamp, open, high, low, close] = row.map(Number);
    const volumeIndex = market === 'futures' ? 6 : 5;
    const volume = Number(row[volumeIndex]);
    return [{
      timestampMs: timestamp,
      open,
      high,
      low,
      close,
      volume,
    }];
  });
  return parseNormalizedCandles(
    candles,
    nowMs,
    timeframeMs(timeframe),
    candleMaxAgeMs(timeframe),
    `OKX ${instrument}`,
  );
}

function publicCandleRequests(
  symbol: string,
  timeframe: string,
  limit: number,
  market: MarketKind,
): Array<{ provider: string; url: string; parse: (payload: unknown, nowMs: number) => FreqtradeMarketCandle[] }> {
  const bybitCategory = market === 'futures' ? 'linear' : 'spot';
  const bybitInterval = timeframe === '1h' ? '60' : timeframe === '4h' ? '240' : timeframe;
  const bybitUrl = new URL('https://api.bybit.com/v5/market/kline');
  bybitUrl.searchParams.set('category', bybitCategory);
  bybitUrl.searchParams.set('symbol', symbol);
  bybitUrl.searchParams.set('interval', bybitInterval);
  bybitUrl.searchParams.set('limit', String(Math.min(limit, 1000)));

  const baseAsset = symbol.slice(0, -4);
  const instrument = market === 'futures' ? `${baseAsset}-USDT-SWAP` : `${baseAsset}-USDT`;
  const okxUrl = new URL('https://www.okx.com/api/v5/market/candles');
  okxUrl.searchParams.set('instId', instrument);
  okxUrl.searchParams.set('bar', okxBar(timeframe));
  okxUrl.searchParams.set('limit', String(Math.min(limit, 300)));

  return [
    {
      provider: 'Binance',
      url: `https://${market === 'futures' ? 'fapi.binance.com' : 'api.binance.com'}${market === 'futures' ? '/fapi/v1' : '/api/v3'}/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`,
      parse(payload, nowMs) {
        return parseCandles(payload, nowMs, timeframeMs(timeframe), candleMaxAgeMs(timeframe)).candles;
      },
    },
    {
      provider: 'Bybit',
      url: bybitUrl.toString(),
      parse(payload, nowMs) {
        return parseBybitCandles(payload, symbol, nowMs, timeframe).candles;
      },
    },
    {
      provider: 'OKX',
      url: okxUrl.toString(),
      parse(payload, nowMs) {
        return parseOkxCandles(payload, instrument, market, timeframe, nowMs).candles;
      },
    },
  ];
}

async function fetchPublicCandlesWithFallback(options: {
  pair: string;
  timeframe: string;
  market: MarketKind;
  limit: number;
  nowMs: number;
  fetcher: typeof fetch;
  timeoutMs: number;
}): Promise<PublicMarketFallbackFeed<FreqtradeMarketCandle[]>> {
  const symbol = normalizeSymbol(options.pair);
  const interval = timeframeInterval(options.timeframe);
  const errors: string[] = [];
  const providers = publicCandleRequests(symbol, interval, options.limit, options.market);
  for (const source of providers) {
    try {
      const { payload, retrievedAtMs } = await fetchJsonEndpoint(
        source.url,
        options.fetcher,
        options.nowMs,
        options.timeoutMs,
      );
      const evaluatedAtMs = Math.max(options.nowMs, Date.now());
      const candles = source.parse(payload, evaluatedAtMs);
      const latestCloseMs = candles.at(-1)!.timestampMs + timeframeMs(interval);
      const feed = freshFeed(candles, latestCloseMs, evaluatedAtMs, candleMaxAgeMs(interval));
      return {
        ...feed,
        provider: `${source.provider} public REST API`,
        endpoint: source.url,
        receivedAtMs: retrievedAtMs,
        ...(errors.length > 0
          ? { isPartial: true, error: `${source.provider} fallback used after: ${errors.join('; ')}` }
          : {}),
      };
    } catch (error) {
      errors.push(`${source.provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    ...unavailable<FreqtradeMarketCandle[]>(`All public candle providers failed: ${errors.join('; ')}`),
    provider: 'Multi-venue public REST APIs',
    endpoint: providers[0]?.url,
    receivedAtMs: null,
  };
}

export async function fetchPublicMarketCandles(options: {
  pair: string;
  timeframe: string;
  market: MarketKind;
  nowMs?: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<FreqtradeMarketCandle[]> {
  const nowMs = options.nowMs ?? Date.now();
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const result = await fetchPublicCandlesWithFallback({
    pair: options.pair,
    timeframe: options.timeframe,
    market: options.market,
    limit: MAX_HISTORICAL_CANDLE_LIMIT[options.market],
    nowMs,
    fetcher,
    timeoutMs,
  });
  if (result.status !== 'LIVE' || !result.value) {
    throw new Error(result.error ?? 'No fresh public candle provider was available.');
  }
  return result.value;
}

function parseOrderBook(
  payload: unknown,
  retrievedAtMs: number,
  symbol: string,
): FreqtradeMarketOrderBook {
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
  const sequenceId = Number(payload.lastUpdateId);
  return {
    timestampMs: retrievedAtMs,
    venue: 'binance',
    symbol,
    ...(Number.isSafeInteger(sequenceId) && sequenceId >= 0 ? { sequenceId } : {}),
    bids,
    asks,
  };
}

function parseBybitOrderBook(
  payload: unknown,
  nowMs: number,
  symbol: string,
): FreqtradeMarketOrderBook {
  if (
    !isRecord(payload) ||
    Number(payload.retCode) !== 0 ||
    !isRecord(payload.result) ||
    payload.result.s !== symbol ||
    !Array.isArray(payload.result.b) ||
    !Array.isArray(payload.result.a)
  ) {
    throw new Error('Bybit order-book response is malformed or has the wrong symbol.');
  }
  const timestampMs = Number(payload.result.ts);
  if (
    !Number.isSafeInteger(timestampMs) ||
    timestampMs <= 0 ||
    Math.abs(timestampMs - nowMs) > MAX_FEED_AGE_MS.orderBook
  ) {
    throw new Error('Bybit order-book timestamp is stale or future-dated.');
  }
  const parseLevels = (levels: unknown[]): Array<{ price: number; amount: number }> =>
    levels.slice(0, 20).map((level) => {
      if (!Array.isArray(level) || level.length < 2) {
        throw new Error('Bybit order-book level is malformed.');
      }
      const price = Number(level[0]);
      const amount = Number(level[1]);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('Bybit order-book level has invalid price or base-asset size.');
      }
      return { price, amount };
    });
  const bids = parseLevels(payload.result.b);
  const asks = parseLevels(payload.result.a);
  if (bids.length === 0 || asks.length === 0 || bids[0].price >= asks[0].price) {
    throw new Error('Bybit order book has empty or crossed bid/ask levels.');
  }
  const sequenceId = Number(payload.result.seq ?? payload.result.u);
  return {
    timestampMs,
    venue: 'bybit',
    symbol,
    ...(Number.isSafeInteger(sequenceId) && sequenceId >= 0 ? { sequenceId } : {}),
    bids,
    asks,
  };
}

function parseTrades(
  payload: unknown,
  retrievedAtMs: number,
  nowMs: number,
  symbol: string,
): FreqtradeMarketTradeFlow {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Binance recent trades response is empty.');
  }
  const trades = payload.flatMap((trade: unknown) => {
    if (!isRecord(trade) || !finiteNumber(Number(trade.T)) ||
        !Number.isSafeInteger(Number(trade.a)) ||
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
      venue: 'binance',
      symbol,
      tradeId: Number(trade.a),
    }];
  }).sort((left, right) => left.timestampMs - right.timestampMs);
  if (trades.length === 0) throw new Error('Binance has no fresh, valid recent trades.');
  const uniqueTrades = deduplicateTrades(trades);
  if (uniqueTrades.conflictingIdentity) {
    throw new Error('Binance returned conflicting aggregate trades for the same trade id.');
  }
  return {
    retrievedAtMs,
    duplicateCount: uniqueTrades.duplicateCount,
    trades: uniqueTrades.values,
  };
}

function parseBybitTrades(
  payload: unknown,
  retrievedAtMs: number,
  nowMs: number,
  symbol: string,
): FreqtradeMarketTradeFlow {
  if (
    !isRecord(payload) ||
    Number(payload.retCode) !== 0 ||
    !isRecord(payload.result) ||
    payload.result.category !== undefined && !['spot', 'linear'].includes(String(payload.result.category)) ||
    !Array.isArray(payload.result.list)
  ) {
    throw new Error('Bybit recent-trades response is malformed or unsuccessful.');
  }
  const trades = payload.result.list.flatMap((trade: unknown) => {
    if (
      !isRecord(trade) ||
      trade.symbol !== symbol ||
      typeof trade.execId !== 'string' ||
      !trade.execId ||
      !['Buy', 'Sell'].includes(String(trade.side))
    ) return [];
    const timestampMs = Number(trade.time);
    const price = Number(trade.price);
    const amount = Number(trade.size);
    if (
      !Number.isSafeInteger(timestampMs) ||
      timestampMs > nowMs ||
      Math.max(nowMs, Date.now()) - timestampMs > MAX_FEED_AGE_MS.tradeFlow ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) return [];
    return [{
      timestampMs,
      side: trade.side === 'Buy' ? 'buy' as const : 'sell' as const,
      price,
      amount,
      venue: 'bybit',
      symbol,
      tradeId: trade.execId,
      exchangeEventId: trade.execId,
    }];
  }).sort((left, right) => left.timestampMs - right.timestampMs);
  if (trades.length === 0) throw new Error('Bybit has no fresh, valid recent trades for the requested symbol.');
  const uniqueTrades = deduplicateTrades(trades);
  if (uniqueTrades.conflictingIdentity) {
    throw new Error('Bybit returned conflicting trades for the same execution id.');
  }
  return {
    retrievedAtMs,
    duplicateCount: uniqueTrades.duplicateCount,
    trades: uniqueTrades.values,
  };
}

async function fetchCrossExchangeQuotes(options: {
  symbol: string;
  market: MarketKind;
  nowMs: number;
  fetcher: typeof fetch;
  timeoutMs: number;
  liveBinancePrice: {
    sourceTimestampMs: number;
    retrievedAtMs: number;
    price: number;
  } | null;
}): Promise<{
  feed: PublicMarketFallbackFeed<PublicExchangeQuote[]>;
  sources: PublicExchangeQuoteSource[];
}> {
  const baseAsset = options.symbol.slice(0, -4);
  const okxSymbol = options.market === 'futures'
    ? `${baseAsset}-USDT-SWAP`
    : `${baseAsset}-USDT`;
  const normalizeQuote = (
    exchange: PublicExchangeQuote['exchange'],
    symbol: string,
    price: number,
    sourceTimestampMs: number,
    retrievedAtMs: number,
    endpoint: string,
  ): PublicExchangeQuote => ({
    exchange,
    market: options.market,
    symbol,
    baseAsset,
    quoteAsset: 'USDT',
    priceUnit: `USDT per ${baseAsset}`,
    price,
    sourceTimestampMs,
    retrievedAtMs,
    endpoint,
  });
  const requests = [
    {
      exchange: 'binance' as const,
      symbol: options.symbol,
      url: `https://${options.market === 'futures' ? 'fapi.binance.com' : 'api.binance.com'}${options.market === 'futures' ? '/fapi/v1' : '/api/v3'}/ticker/price?symbol=${options.symbol}`,
      parse(payload: unknown, retrievedAtMs: number, endpoint: string): PublicExchangeQuote {
        if (!isRecord(payload) || payload.symbol !== options.symbol) {
          throw new Error('Binance ticker response is malformed or has the wrong symbol.');
        }
        const price = Number(payload.price);
        const timestamp = Number(payload.time);
        if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isFinite(price) || price <= 0) {
          throw new Error('Binance ticker price or exchange timestamp is invalid.');
        }
        return normalizeQuote('binance', options.symbol, price, timestamp, retrievedAtMs, endpoint);
      },
    },
    {
      exchange: 'bybit' as const,
      symbol: options.symbol,
      url: `https://api.bybit.com/v5/market/tickers?category=${options.market === 'futures' ? 'linear' : 'spot'}&symbol=${options.symbol}`,
      parse(payload: unknown, retrievedAtMs: number, endpoint: string): PublicExchangeQuote {
        if (!isRecord(payload) || Number(payload.retCode) !== 0 ||
            !isRecord(payload.result) || !Array.isArray(payload.result.list)) {
          throw new Error('Bybit ticker response is malformed or unsuccessful.');
        }
        const ticker = payload.result.list.find((item: unknown) =>
          isRecord(item) && item.symbol === options.symbol
        );
        if (!isRecord(ticker)) throw new Error('Bybit returned no ticker for the requested symbol.');
        const price = Number(ticker.lastPrice);
        const timestamp = Number(payload.time);
        if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isFinite(price) || price <= 0) {
          throw new Error('Bybit ticker price or exchange timestamp is invalid.');
        }
        return normalizeQuote('bybit', options.symbol, price, timestamp, retrievedAtMs, endpoint);
      },
    },
    {
      exchange: 'okx' as const,
      symbol: okxSymbol,
      url: `https://www.okx.com/api/v5/market/ticker?instId=${okxSymbol}`,
      parse(payload: unknown, retrievedAtMs: number, endpoint: string): PublicExchangeQuote {
        if (!isRecord(payload) || payload.code !== '0' || !Array.isArray(payload.data)) {
          throw new Error('OKX ticker response is malformed or unsuccessful.');
        }
        const ticker = payload.data.find((item: unknown) =>
          isRecord(item) && item.instId === okxSymbol
        );
        if (!isRecord(ticker)) throw new Error('OKX returned no ticker for the requested instrument.');
        const price = Number(ticker.last);
        const sourceTimestampMs = Number(ticker.ts);
        if (!Number.isSafeInteger(sourceTimestampMs) || !Number.isFinite(price) || price <= 0) {
          throw new Error('OKX ticker price or exchange timestamp is invalid.');
        }
        return normalizeQuote('okx', okxSymbol, price, sourceTimestampMs, retrievedAtMs, endpoint);
      },
    },
  ].filter((request) => !(request.exchange === 'binance' && options.liveBinancePrice));
  const sources: PublicExchangeQuoteSource[] = [];
  const quotes: PublicExchangeQuote[] = [];
  if (options.liveBinancePrice) {
    const endpoint = `wss://${options.market === 'futures' ? 'fstream.binance.com' : 'stream.binance.com:9443'}/ws/${options.symbol.toLowerCase()}@trade`;
    const quote = normalizeQuote(
      'binance',
      options.symbol,
      options.liveBinancePrice.price,
      options.liveBinancePrice.sourceTimestampMs,
      options.liveBinancePrice.retrievedAtMs,
      endpoint,
    );
    const error = validateQuoteFreshness(quote, options.nowMs);
    sources.push({
      exchange: 'binance',
      symbol: options.symbol,
      endpoint,
      status: error ? 'UNAVAILABLE' : 'LIVE',
      responseTimestampMs: quote.sourceTimestampMs,
      receivedAtMs: quote.retrievedAtMs,
      ...(error ? { error } : {}),
    });
    if (!error) quotes.push(quote);
  }

  await Promise.all(requests.map(async (request) => {
    try {
      const { payload, retrievedAtMs } = await requestJson(
        request.url,
        options.fetcher,
        options.nowMs,
        options.timeoutMs,
      );
      const quote = request.parse(payload, retrievedAtMs, request.url);
      const error = validateQuoteFreshness(quote, options.nowMs);
      if (error) throw new Error(error);
      quotes.push(quote);
      sources.push({
        exchange: request.exchange,
        symbol: request.symbol,
        endpoint: request.url,
        status: 'LIVE',
        responseTimestampMs: quote.sourceTimestampMs,
        receivedAtMs: retrievedAtMs,
      });
    } catch (error) {
      sources.push({
        exchange: request.exchange,
        symbol: request.symbol,
        endpoint: request.url,
        status: 'UNAVAILABLE',
        responseTimestampMs: null,
        receivedAtMs: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));
  sources.sort((left, right) => left.exchange.localeCompare(right.exchange));
  const uniqueQuotes = deduplicateQuotes(quotes);
  if (uniqueQuotes.conflictingIdentity) {
    return {
      feed: unavailable<PublicExchangeQuote[]>(
        'A venue returned conflicting quote values for the same symbol and source timestamp.',
      ),
      sources,
    };
  }
  quotes.splice(0, quotes.length, ...uniqueQuotes.values);

  if (quotes.length < 2) {
    return {
      feed: {
        ...unavailable<PublicExchangeQuote[]>(
          `Fewer than two fresh normalized exchange prices are available (${quotes.length}/2 minimum).`,
        ),
        isPartial: sources.some((source) => source.status === 'LIVE'),
      },
      sources,
    };
  }
  const sortedPrices = quotes.map(({ price }) => price).sort((left, right) => left - right);
  const medianPrice = sortedPrices.length === 2
    ? (sortedPrices[0] + sortedPrices[1]) / 2
    : sortedPrices[Math.floor(sortedPrices.length / 2)];
  const spreadPct = ((sortedPrices.at(-1)! - sortedPrices[0]) / medianPrice) * 100;
  if (spreadPct > MAX_CROSS_EXCHANGE_PRICE_SPREAD_PCT) {
    return {
      feed: {
        ...unavailable<PublicExchangeQuote[]>(
          `Cross-exchange ticker spread ${spreadPct.toFixed(3)}% exceeds the ${MAX_CROSS_EXCHANGE_PRICE_SPREAD_PCT}% quality limit.`,
        ),
      },
      sources,
    };
  }
  const evaluatedAtMs = Math.max(options.nowMs, Date.now());
  return {
    feed: {
      ...freshFeed(
        quotes,
        Math.min(evaluatedAtMs, ...quotes.map(({ retrievedAtMs }) => retrievedAtMs)),
        evaluatedAtMs,
        MAX_FEED_AGE_MS.exchangeQuotes,
      ),
      isPartial: sources.some((source) => source.status === 'UNAVAILABLE'),
    },
    sources,
  };
}

function validateQuoteFreshness(quote: PublicExchangeQuote, nowMs: number): string | null {
  const evaluatedAtMs = Math.max(nowMs, Date.now());
  const ageMs = evaluatedAtMs - quote.retrievedAtMs;
  if (
    !Number.isSafeInteger(quote.sourceTimestampMs) ||
    Math.abs(quote.sourceTimestampMs - quote.retrievedAtMs) > MAX_EXCHANGE_CLOCK_SKEW_MS ||
    ageMs < 0 ||
    ageMs > MAX_FEED_AGE_MS.exchangeQuotes
  ) {
    return `${quote.exchange} ticker is stale or future-dated.`;
  }
  return null;
}

export async function fetchPublicMarketFallback(options: {
  pair: string;
  timeframe: string;
  market: MarketKind;
  nowMs?: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  marketDataStream?: Pick<typeof binancePublicMarketDataStream, 'getSnapshot'>;
}): Promise<PublicMarketFallbackData> {
  const nowMs = options.nowMs ?? Date.now();
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const symbol = normalizeSymbol(options.pair);
  const interval = timeframeInterval(options.timeframe);
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
      return {
        ...parse(payload, retrievedAtMs),
        provider: providerForEndpoint(url),
        endpoint: url,
        receivedAtMs: retrievedAtMs,
      };
    } catch (error) {
      return {
        ...unavailable<T>(error),
        provider: providerForEndpoint(url),
        endpoint: url,
        receivedAtMs: null,
      };
    }
  };

  const fundingRateRequest = options.market === 'futures'
    ? fetchFeed(endpoint('/fapi/v1/premiumIndex', { symbol }), (payload, retrievedAtMs) => {
      if (!isRecord(payload) || payload.symbol !== symbol ||
          !finiteNumber(Number(payload.lastFundingRate))) {
        throw new Error('Binance premium-index response has no valid symbol or funding rate.');
      }
      const sourceTimestampMs = Number(payload.time);
      if (!Number.isSafeInteger(sourceTimestampMs) || sourceTimestampMs <= 0) {
        throw new Error('Binance premium-index response has no valid exchange timestamp.');
      }
      return freshFeed(
        { retrievedAtMs, rate: Number(payload.lastFundingRate) },
        sourceTimestampMs,
        nowMs,
        MAX_FEED_AGE_MS.fundingRate,
      );
    })
    : Promise.resolve(unavailable<{ retrievedAtMs: number; rate: number }>(
      'Funding is unavailable for spot markets.',
    ));
  const openInterestRequest = options.market === 'futures'
    ? fetchFeed(endpoint('/futures/data/openInterestHist', { symbol, period: '5m', limit: '2' }), (payload, retrievedAtMs) => {
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
    })
    : Promise.resolve(unavailable<FreqtradeMarketOpenInterest>(
      'Open interest is unavailable for spot markets.',
    ));
  const liveOpenInterestRequest = options.market === 'futures'
    ? fetchFeed(endpoint('/fapi/v1/openInterest', { symbol }), (payload, retrievedAtMs) => {
      if (!isRecord(payload) || payload.symbol !== symbol) {
        throw new Error('Binance current open-interest response is malformed or has the wrong symbol.');
      }
      const timestampMs = Number(payload.time);
      const amount = Number(payload.openInterest);
      if (!Number.isSafeInteger(timestampMs) || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('Binance current open-interest timestamp or amount is invalid.');
      }
      return freshFeed(
        { timestampMs, amount },
        timestampMs,
        retrievedAtMs,
        MAX_FEED_AGE_MS.liveOpenInterest,
      );
    })
    : Promise.resolve(unavailable<{ timestampMs: number; amount: number }>(
      'Open interest is unavailable for spot markets.',
    ));

  const fetchCandleFeed = (timeframe: string, limit: number) =>
    fetchPublicCandlesWithFallback({
      pair: options.pair,
      timeframe,
      market: options.market,
      limit,
      nowMs,
      fetcher,
      timeoutMs,
    });
  const candlesRequest = fetchCandleFeed(interval, MAX_HISTORICAL_CANDLE_LIMIT[options.market]);
  const fastCandlesRequest = interval === '1m'
    ? candlesRequest
    : fetchCandleFeed('1m', FAST_CANDLE_LIMIT);
  const hourlyCandlesRequest = interval === '1h'
    ? candlesRequest
    : fetchCandleFeed('1h', FAST_CANDLE_LIMIT);
  const fourHourlyCandlesRequest = interval === '4h'
    ? candlesRequest
    : fetchCandleFeed('4h', FAST_CANDLE_LIMIT);

  const liveStream = (options.marketDataStream ?? binancePublicMarketDataStream)
    .getSnapshot(Math.max(nowMs, Date.now()));
  let [
    candles,
    fastCandles,
    hourlyCandles,
    fourHourlyCandles,
    orderBook,
    tradeFlow,
    exchangeQuoteResult,
    fundingRate,
    openInterest,
    liveOpenInterest,
  ] = await Promise.all([
    candlesRequest,
    fastCandlesRequest,
    hourlyCandlesRequest,
    fourHourlyCandlesRequest,
    fetchFeed(endpoint(options.market === 'futures' ? '/fapi/v1/depth' : '/api/v3/depth', {
      symbol, limit: '20',
    }), (payload, retrievedAtMs) =>
      freshFeed(      parseOrderBook(payload, retrievedAtMs, symbol), retrievedAtMs, nowMs, MAX_FEED_AGE_MS.orderBook)),
    fetchFeed(endpoint(options.market === 'futures' ? '/fapi/v1/aggTrades' : '/api/v3/aggTrades', {
      symbol,
      startTime: String(tradeQueryNowMs - MAX_FEED_AGE_MS.tradeFlow),
      endTime: String(tradeQueryNowMs),
      limit: '1000',
    }), (payload, retrievedAtMs) => {
      const tradeFlow = parseTrades(payload, retrievedAtMs, tradeQueryNowMs, symbol);
      const sourceTimestampMs = tradeFlow.trades.at(-1)!.timestampMs;
      return freshFeed(
        tradeFlow,
        sourceTimestampMs,
        retrievedAtMs,
        MAX_FEED_AGE_MS.tradeFlow,
      );
    }),
    fetchCrossExchangeQuotes({
      symbol,
      market: options.market,
      nowMs,
      fetcher,
      timeoutMs,
      liveBinancePrice: liveStream.price,
    }),
    fundingRateRequest,
    openInterestRequest,
    liveOpenInterestRequest,
  ]);
  if (orderBook.status !== 'LIVE') {
    const bybitUrl = new URL('https://api.bybit.com/v5/market/orderbook');
    bybitUrl.searchParams.set('category', options.market === 'futures' ? 'linear' : 'spot');
    bybitUrl.searchParams.set('symbol', symbol);
    bybitUrl.searchParams.set('limit', '20');
    const bybitOrderBook = await fetchFeed(bybitUrl.toString(), (payload, retrievedAtMs) => {
      const book = parseBybitOrderBook(payload, Math.max(nowMs, Date.now()), symbol);
      return freshFeed(book, book.timestampMs, retrievedAtMs, MAX_FEED_AGE_MS.orderBook);
    });
    if (bybitOrderBook.status === 'LIVE') {
      orderBook = {
        ...bybitOrderBook,
        isPartial: true,
        error: `Bybit fallback used after Binance failed: ${orderBook.error ?? 'unavailable.'}`,
      };
    }
  }
  if (tradeFlow.status !== 'LIVE') {
    const bybitUrl = new URL('https://api.bybit.com/v5/market/recent-trade');
    bybitUrl.searchParams.set('category', options.market === 'futures' ? 'linear' : 'spot');
    bybitUrl.searchParams.set('symbol', symbol);
    bybitUrl.searchParams.set('limit', '100');
    const bybitTradeFlow = await fetchFeed(bybitUrl.toString(), (payload, retrievedAtMs) => {
      const trades = parseBybitTrades(payload, retrievedAtMs, Math.max(nowMs, Date.now()), symbol);
      const sourceTimestampMs = trades.trades.at(-1)!.timestampMs;
      return freshFeed(
        trades,
        sourceTimestampMs,
        retrievedAtMs,
        MAX_FEED_AGE_MS.tradeFlow,
      );
    });
    if (bybitTradeFlow.status === 'LIVE') {
      tradeFlow = {
        ...bybitTradeFlow,
        isPartial: true,
        error: `Bybit fallback used after Binance failed: ${tradeFlow.error ?? 'unavailable.'}`,
      };
    }
  }
  const exchangeQuotes = exchangeQuoteResult.feed;
  if (liveStream.orderBook) {
    orderBook = {
      status: 'LIVE',
      provider: 'Binance public WebSocket',
      sourceTimestampMs: liveStream.orderBook.timestampMs,
      endpoint: `wss://${options.market === 'futures' ? 'fstream.binance.com' : 'stream.binance.com:9443'}/ws/${symbol.toLowerCase()}@depth20@100ms`,
      receivedAtMs: liveStream.orderBook.timestampMs,
      value: liveStream.orderBook,
    };
  }
  if (liveStream.tradeFlow) {
    tradeFlow = {
      status: 'LIVE',
      provider: 'Binance public WebSocket',
      sourceTimestampMs: liveStream.tradeFlow.trades.at(-1)!.timestampMs,
      endpoint: `wss://${options.market === 'futures' ? 'fstream.binance.com' : 'stream.binance.com:9443'}/ws/${symbol.toLowerCase()}@trade`,
      receivedAtMs: liveStream.tradeFlow.retrievedAtMs,
      value: liveStream.tradeFlow,
    };
  }
  const partialCandle = liveStream.partialFastCandle;
  const completedFastCandles = fastCandles.value;
  if (
    partialCandle &&
    completedFastCandles &&
    completedFastCandles.length >= 29 &&
    partialCandle.candle.timestampMs === completedFastCandles.at(-1)!.timestampMs + 60_000
  ) {
    fastCandles = {
      status: 'LIVE',
      provider: 'Binance public WebSocket',
      sourceTimestampMs: partialCandle.sourceTimestampMs,
      endpoint: `wss://${options.market === 'futures' ? 'fstream.binance.com' : 'stream.binance.com:9443'}/ws/${symbol.toLowerCase()}@kline_1m`,
      receivedAtMs: partialCandle.sourceTimestampMs,
      value: [
        ...completedFastCandles,
        partialCandle.candle,
      ],
      isPartial: true,
    };
  }

  return {
    provider: 'Binance public REST API',
    venue: 'binance',
    market: options.market,
    pair: options.pair,
    timeframe: options.timeframe,
    retrievedAtMs: nowMs,
    exchangeQuotes,
    exchangeQuoteSources: exchangeQuoteResult.sources,
    candles,
    fastCandles,
    higherTimeframeCandles: {
      '1h': hourlyCandles,
      '4h': fourHourlyCandles,
    },
    orderBook,
    tradeFlow,
    fundingRate,
    openInterest,
    liveOpenInterest,
  };
}
