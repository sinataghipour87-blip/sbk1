import { 
  Candle, 
  DerivativesData, 
  FearAndGreed, 
  FeedStatus, 
  FuturesPrices,
  RealOrderBookImbalance, 
  OrderFlowFeatures, 
  DataQualityReport, 
  CanonicalMarketSnapshot, 
  CanonicalExchangeFeed 
} from '../types/trading';
import { dataProvenanceLayerService } from './dataProvenanceLayer';
import {
  FREQTRADE_MARKET_SNAPSHOT_VERSION,
  FREQTRADE_TICKER_MAX_AGE_MS,
  validateFreqtradeMarketSnapshot,
  type FreqtradeMarketSnapshot,
} from './freqtradeMarketDataBridge';

async function safeFetchJson<T>(url: string, timeoutMs = 6000): Promise<{ data: T; latencyMs: number }> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  try {
    const requestUrl = new URL(url);
    const requestTarget = typeof window !== 'undefined' && requestUrl.hostname === 'api.bybit.com'
      ? `/api/market/bybit${requestUrl.pathname}${requestUrl.search}`
      : url;
    const res = await fetch(requestTarget, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      throw new Error(`سرویس در دسترس نیست (پاسخ HTML دریافت شد).`);
    }
    const data = JSON.parse(text) as T;
    const latencyMs = Math.round(performance.now() - start);
    return { data, latencyMs };
  } finally {
    clearTimeout(id);
  }
}

export interface BybitCandlesResult {
  candles: Candle[];
  systemCandles?: Candle[];
  latencyMs: number;
  sourceStartTimeMs: number;
  sourceCloseTimeMs: number;
  receivedTimestampMs: number;
  source: string;
}

let cachedFreqtradeSnapshot: { data: FreqtradeMarketSnapshot; fetchedAtMs: number } | null = null;
let freqtradeSnapshotRequest: Promise<FreqtradeMarketSnapshot> | null = null;
const freqtradeSnapshotLatencyMs = new WeakMap<FreqtradeMarketSnapshot, number>();

function getSnapshotNetworkLatencyMs(snapshot: FreqtradeMarketSnapshot): number | null {
  return freqtradeSnapshotLatencyMs.get(snapshot) ?? null;
}

export async function getFreqtradeMarketSnapshot(forceRefresh = false): Promise<FreqtradeMarketSnapshot> {
  if (typeof window === 'undefined') {
    throw new Error('Freqtrade market snapshots are available only through the SBK1 browser API.');
  }
  const nowMs = Date.now();
  if (!forceRefresh && cachedFreqtradeSnapshot && nowMs - cachedFreqtradeSnapshot.fetchedAtMs <= 1_000) {
    return cachedFreqtradeSnapshot.data;
  }
  if (freqtradeSnapshotRequest) return freqtradeSnapshotRequest;

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const startedAt = performance.now();
    try {
      const response = await fetch('/api/market/freqtrade-snapshot', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `Freqtrade market snapshot is unavailable (HTTP ${response.status}).`);
      }
      const text = await response.text();
      if (text.trim().startsWith('<')) {
        throw new Error(`Freqtrade market snapshot is unavailable (non-JSON response).`);
      }
      const payload: unknown = JSON.parse(text);
      if (
        typeof payload !== 'object' ||
        payload === null ||
        Array.isArray(payload) ||
        !('exchange' in payload) ||
        !('market' in payload) ||
        !('pair' in payload) ||
        !('timeframe' in payload)
      ) {
        throw new Error('Freqtrade market snapshot response is malformed.');
      }
      const serverNowHeader = response.headers.get('X-SBK1-Server-Time');
      const serverNowMs = serverNowHeader === null
        ? Date.parse(response.headers.get('Date') ?? '')
        : Number(serverNowHeader);
      const validationNowMs = Number.isSafeInteger(serverNowMs) && serverNowMs > 0
        ? serverNowMs
        : Date.now();
      const value = payload as Record<string, unknown>;
      const snapshot = validateFreqtradeMarketSnapshot(value, {
        exchange: String(value.exchange),
        market: value.market === 'futures' ? 'futures' : 'spot',
        pair: String(value.pair),
        timeframe: String(value.timeframe),
      }, validationNowMs);
      if (snapshot.contractVersion !== FREQTRADE_MARKET_SNAPSHOT_VERSION) {
        throw new Error('Freqtrade market snapshot contract version is not supported.');
      }
      freqtradeSnapshotLatencyMs.set(snapshot, Math.round(performance.now() - startedAt));
      cachedFreqtradeSnapshot = { data: snapshot, fetchedAtMs: Date.now() };
      return snapshot;
    } finally {
      clearTimeout(timeout);
    }
  })();
  freqtradeSnapshotRequest = request;
  try {
    return await request;
  } finally {
    if (freqtradeSnapshotRequest === request) freqtradeSnapshotRequest = null;
  }
}

function timeframeForMinuteInterval(interval: string): string {
  if (!/^\d+$/.test(interval)) return '';
  const minutes = Number(interval);
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return '';
  if (minutes < 60) return `${minutes}m`;
  return minutes % 60 === 0 ? `${minutes / 60}h` : '';
}

function candleDataForTimeframe(snapshot: FreqtradeMarketSnapshot, timeframe: string): Candle[] {
  const rows = timeframe === snapshot.timeframe
    ? snapshot.candles
    : snapshot.additionalCandles[timeframe];
  if (!rows?.length) {
    throw new Error(`Freqtrade snapshot does not contain ${timeframe} data (fresh candles unavailable).`);
  }
  return rows.map((row) => [row.open, row.high, row.low, row.close, row.volume]);
}

const bybitIntervals = new Set(['1', '3', '5', '15', '30', '60', '120', '240', '360', '720']);

async function fetchSystemBybitCandles(interval: string, limit: number): Promise<BybitCandlesResult> {
  if (!bybitIntervals.has(interval) || !Number.isInteger(limit) || limit < 20 || limit > 1000) {
    throw new Error(`Unsupported Bybit candle request: interval=${interval}, limit=${limit}.`);
  }
  const timeframeMs = Number(interval) * 60_000;
  const { data, latencyMs } = await safeFetchJson<{
    retCode?: number;
    retMsg?: string;
    result?: { list?: unknown };
  }>(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=${interval}&limit=${limit}`,
  );
  if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
    throw new Error(`Bybit candles are unavailable: ${data.retMsg || 'invalid response'}.`);
  }
  const receivedTimestampMs = Date.now();
  const rows = data.result.list
    .map((row) => {
      if (!Array.isArray(row) || row.length < 6) {
        throw new Error('Bybit returned a malformed candle row.');
      }
      const [rawTimestamp, rawOpen, rawHigh, rawLow, rawClose, rawVolume] = row;
      const timestampMs = Number(rawTimestamp);
      const open = Number(rawOpen);
      const high = Number(rawHigh);
      const low = Number(rawLow);
      const close = Number(rawClose);
      const volume = Number(rawVolume);
      if (
        !Number.isSafeInteger(timestampMs) ||
        ![open, high, low, close, volume].every(Number.isFinite) ||
        open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 ||
        high < Math.max(open, close, low) ||
        low > Math.min(open, close, high)
      ) {
        throw new Error('Bybit returned invalid OHLCV candle data.');
      }
      if (timestampMs > receivedTimestampMs + 1_000) {
        throw new Error('Bybit returned a future-dated candle.');
      }
      return { timestampMs, candle: [open, high, low, close, volume] as Candle };
    })
    .filter(({ timestampMs }) => timestampMs + timeframeMs <= receivedTimestampMs)
    .sort((left, right) => left.timestampMs - right.timestampMs);
  const completedRows = rows.slice(-limit);
  if (completedRows.length < 20) {
    throw new Error(`Bybit returned only ${completedRows.length} completed ${interval}m candles.`);
  }
  const lastRow = completedRows[completedRows.length - 1];
  return {
    candles: completedRows.map(({ candle }) => candle),
    latencyMs,
    sourceStartTimeMs: lastRow.timestampMs,
    sourceCloseTimeMs: lastRow.timestampMs + timeframeMs,
    receivedTimestampMs,
    source: 'sbk1.bybit.public-market',
  };
}

export async function fetchBybit(interval = '15', limit = 150, forceRefresh = false): Promise<BybitCandlesResult> {
  if (!bybitIntervals.has(interval) || !Number.isInteger(limit) || limit < 20 || limit > 1000) {
    throw new Error(`Unsupported Bybit candle request: interval=${interval}, limit=${limit}.`);
  }
  const timeframe = timeframeForMinuteInterval(interval) || '15m';
  const [freqtradeResult, systemResult] = await Promise.allSettled([
    getFreqtradeMarketSnapshot(forceRefresh),
    fetchSystemBybitCandles(interval, limit),
  ]);
  const freqtradeError = freqtradeResult.status === 'rejected'
    ? (freqtradeResult.reason instanceof Error ? freqtradeResult.reason.message : String(freqtradeResult.reason))
    : null;
  const systemError = systemResult.status === 'rejected'
    ? (systemResult.reason instanceof Error ? systemResult.reason.message : String(systemResult.reason))
    : null;

  if (freqtradeResult.status === 'fulfilled') {
    const snapshot = freqtradeResult.value;
    const sourceCandles = timeframe === snapshot.timeframe
      ? snapshot.candles
      : snapshot.additionalCandles[timeframe];
    const candles = candleDataForTimeframe(snapshot, timeframe).slice(-limit);
    if (candles.length < 20 || !sourceCandles?.length) {
      if (systemResult.status === 'fulfilled') return systemResult.value;
      throw new Error(`Freqtrade DataProvider returned insufficient fresh ${timeframe} candles; ${systemError}`);
    }
    const lastSourceCandle = sourceCandles.at(-1)!;
    return {
      candles,
      ...(systemResult.status === 'fulfilled' ? { systemCandles: systemResult.value.candles } : {}),
      latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
      sourceStartTimeMs: lastSourceCandle.timestampMs,
      sourceCloseTimeMs: lastSourceCandle.timestampMs + Number(interval) * 60_000,
      receivedTimestampMs: snapshot.generatedAtMs,
      source: systemResult.status === 'fulfilled'
        ? 'freqtrade.dataprovider + sbk1.bybit.public-market'
        : `freqtrade.dataprovider (system Bybit feed unavailable: ${systemError})`,
    };
  }
  if (systemResult.status === 'fulfilled') return systemResult.value;
  throw new Error(`Market data unavailable from Freqtrade (${freqtradeError}) and SBK1 Bybit feed (${systemError}).`);
}

function isValidMarketCandle(candle: Candle): boolean {
  const [open, high, low, close, volume] = candle;
  return [open, high, low, close, volume].every(Number.isFinite) &&
    open > 0 && high > 0 && low > 0 && close > 0 && volume >= 0;
}

interface BybitTickerPayload {
  retCode?: number;
  retMsg?: string;
  time?: number;
  result?: { list?: Array<Record<string, unknown>> };
}

let bybitTickerCache: { data: BybitTickerPayload; latencyMs: number; fetchedAtMs: number } | null = null;
let bybitTickerRequest: Promise<{ data: BybitTickerPayload; latencyMs: number }> | null = null;

async function getBybitTicker(forceRefresh = false): Promise<{ data: BybitTickerPayload; latencyMs: number }> {
  if (!forceRefresh && bybitTickerCache && Date.now() - bybitTickerCache.fetchedAtMs <= 1_000) {
    return bybitTickerCache;
  }
  if (bybitTickerRequest) return bybitTickerRequest;
  const request = safeFetchJson<BybitTickerPayload>(
    'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT',
  );
  bybitTickerRequest = request;
  try {
    const result = await request;
    bybitTickerCache = { ...result, fetchedAtMs: Date.now() };
    return result;
  } finally {
    if (bybitTickerRequest === request) bybitTickerRequest = null;
  }
}

export async function fetchFuturesPrices(forceRefresh = false): Promise<FuturesPrices> {
  const now = Date.now();
  const [freqtradeResult, systemResult] = await Promise.allSettled([
    getFreqtradeMarketSnapshot(forceRefresh),
    getBybitTicker(forceRefresh),
  ]);
  let systemTicker: {
    lastPrice: number;
    markPrice: number;
    indexPrice: number;
    timestampUtc: number;
    exchangeTimestampUtc: number | null;
    receivedTimestampMs: number;
    isoTimeUtc: string;
    ageMs: number;
    latencyMs: number;
    openInterest: number | null;
    fundingRate: number | null;
  } | null = null;
  if (systemResult.status === 'fulfilled' && systemResult.value.data.retCode === 0) {
    const data = systemResult.value.data;
    const ticker = data.result?.list?.[0];
    const lastPrice = Number(ticker?.lastPrice);
    const markPrice = Number(ticker?.markPrice ?? lastPrice);
    const indexPrice = Number(ticker?.indexPrice ?? lastPrice);
    const openInterestValue = Number(ticker?.openInterest);
    const fundingRateValue = Number(ticker?.fundingRate);
    const exchangeTimestampUtc = Number.isSafeInteger(data.time) && Number(data.time) > 0
      ? Number(data.time)
      : null;
    if ([lastPrice, markPrice, indexPrice].every((price) => Number.isFinite(price) && price > 0)) {
      const receivedTimestampMs = Date.now();
      systemTicker = {
        lastPrice,
        markPrice,
        indexPrice,
        timestampUtc: exchangeTimestampUtc ?? receivedTimestampMs,
        exchangeTimestampUtc,
        receivedTimestampMs,
        isoTimeUtc: new Date(receivedTimestampMs).toISOString(),
        ageMs: exchangeTimestampUtc === null ? 0 : receivedTimestampMs - exchangeTimestampUtc,
        latencyMs: systemResult.value.latencyMs,
        openInterest: Number.isFinite(openInterestValue) && openInterestValue > 0 ? openInterestValue : null,
        fundingRate: Number.isFinite(fundingRateValue) ? fundingRateValue : null,
      };
    }
  }

  if (freqtradeResult.status === 'fulfilled') {
    const snapshot = freqtradeResult.value;
    const ticker = snapshot.ticker;
    if (ticker && ticker.last > 0) {
      const ageMs = Date.now() - ticker.retrievedAtMs;
      const isFresh = ageMs >= 0 && ageMs <= FREQTRADE_TICKER_MAX_AGE_MS;
      if (isFresh) return {
        lastPrice: ticker.last,
        markPrice: ticker.markPrice ?? ticker.last,
        indexPrice: ticker.indexPrice ?? ticker.last,
        timestampUtc: ticker.exchangeTimestampMs ?? ticker.retrievedAtMs,
        exchangeTimestampUtc: ticker.exchangeTimestampMs,
        timestampSource: ticker.exchangeTimestampMs === null ? 'FREQTRADE_RECEIVED' : 'EXCHANGE',
        receivedTimestampMs: Date.now(),
        isoTimeUtc: new Date(ticker.retrievedAtMs).toISOString(),
        ageMs,
        latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 5,
        ...(systemTicker ? {
          systemLastPrice: systemTicker.lastPrice,
          systemOpenInterest: systemTicker.openInterest,
          systemPriceStatus: systemTicker.ageMs >= 0 && systemTicker.ageMs <= FREQTRADE_TICKER_MAX_AGE_MS
            ? 'LIVE' as const
            : 'STALE' as const,
        } : { systemLastPrice: null, systemPriceStatus: 'UNAVAILABLE' as const }),
        source: systemTicker
          ? 'Freqtrade DataProvider + SBK1 Bybit public ticker'
          : 'Bybit Freqtrade Snapshot',
        status: 'LIVE',
      };
    }
  }

  if (systemTicker && systemTicker.ageMs >= 0 && systemTicker.ageMs <= FREQTRADE_TICKER_MAX_AGE_MS) {
    return {
      ...systemTicker,
      timestampSource: systemTicker.exchangeTimestampUtc === null ? 'FREQTRADE_RECEIVED' : 'EXCHANGE',
      systemLastPrice: systemTicker.lastPrice,
      systemOpenInterest: systemTicker.openInterest,
      systemPriceStatus: 'LIVE',
      source: 'SBK1 Bybit public ticker',
      status: 'LIVE',
    };
  }

  if (freqtradeResult.status === 'fulfilled' && freqtradeResult.value.ticker) {
    const ticker = freqtradeResult.value.ticker;
    const ageMs = now - ticker.retrievedAtMs;
    return {
      lastPrice: ticker.last,
      markPrice: ticker.markPrice ?? ticker.last,
      indexPrice: ticker.indexPrice ?? ticker.last,
      timestampUtc: ticker.exchangeTimestampMs ?? ticker.retrievedAtMs,
      exchangeTimestampUtc: ticker.exchangeTimestampMs,
      timestampSource: ticker.exchangeTimestampMs === null ? 'FREQTRADE_RECEIVED' : 'EXCHANGE',
      receivedTimestampMs: now,
      isoTimeUtc: new Date(ticker.retrievedAtMs).toISOString(),
      ageMs,
      latencyMs: getSnapshotNetworkLatencyMs(freqtradeResult.value) ?? 0,
      systemLastPrice: systemTicker?.lastPrice ?? null,
      systemOpenInterest: systemTicker?.openInterest ?? null,
      systemPriceStatus: systemTicker ? 'STALE' : 'UNAVAILABLE',
      source: 'Stale Freqtrade ticker; SBK1 Bybit ticker unavailable',
      status: 'UNAVAILABLE',
      error: 'No fresh price is available from either data source.',
    };
  }

  const freqtradeError = freqtradeResult.status === 'rejected'
    ? (freqtradeResult.reason instanceof Error ? freqtradeResult.reason.message : String(freqtradeResult.reason))
    : 'Freqtrade snapshot has no valid ticker.';
  const systemError = systemResult.status === 'rejected'
    ? (systemResult.reason instanceof Error ? systemResult.reason.message : String(systemResult.reason))
    : systemTicker ? 'SBK1 Bybit ticker is stale.' : systemResult.value.data.retMsg || 'SBK1 Bybit ticker is invalid.';
  return {
    lastPrice: 0,
    markPrice: 0,
    indexPrice: 0,
    timestampUtc: 0,
    exchangeTimestampUtc: null,
    timestampSource: 'UNAVAILABLE',
    receivedTimestampMs: now,
    isoTimeUtc: '',
    ageMs: Number.POSITIVE_INFINITY,
    latencyMs: 0,
    systemLastPrice: systemTicker?.lastPrice ?? null,
    systemOpenInterest: systemTicker?.openInterest ?? null,
    systemPriceStatus: systemTicker ? 'STALE' : 'UNAVAILABLE',
    source: 'Freqtrade and SBK1 Bybit public ticker unavailable',
    status: 'UNAVAILABLE',
    error: `Freqtrade: ${freqtradeError}; SBK1 Bybit: ${systemError}`,
  };
}

export interface KucoinCandlesResult {
  candles: Candle[];
  latencyMs: number;
  sourceStartTimeMs: number;
  sourceCloseTimeMs: number;
  receivedTimestampMs: number;
}

export async function fetchKucoin(type = '15min'): Promise<KucoinCandlesResult> {
  throw new Error(`Freqtrade venue fallback is disabled; KuCoin ${type} data requires a separate verified integration.`);
}

export const SYNTHETIC_DATA_FLAG = '__isSyntheticUnsafeForLive__';

export interface MarketDataSafetyCheckResult {
  isLiveSafe: boolean;
  status: 'LIVE_DATA_VALID' | 'LIVE_DATA_INVALID';
  reasonFa: string;
  isSyntheticDetected: boolean;
}

export function validateMarketDataLiveSafety(candles?: Candle[], feedStatus?: string): MarketDataSafetyCheckResult {
  const isSyntheticDetected = !!candles && Object.prototype.hasOwnProperty.call(candles, SYNTHETIC_DATA_FLAG);
  const isLiveSafe = feedStatus === 'LIVE' &&
    Array.isArray(candles) &&
    candles.length >= 300 &&
    !isSyntheticDetected &&
    candles.every(isValidMarketCandle);
  return {
    isLiveSafe,
    status: isLiveSafe ? 'LIVE_DATA_VALID' : 'LIVE_DATA_INVALID',
    reasonFa: isLiveSafe ? 'دادهٔ زندهٔ تاییدشدهٔ Freqtrade معتبر است.' : 'دادهٔ زندهٔ معتبر Freqtrade موجود نیست.',
    isSyntheticDetected,
  };
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const marketCache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string, ttlMs: number): T | null {
  const entry = marketCache.get(key);
  if (!entry || Date.now() - entry.timestamp > ttlMs) return null;
  return entry.data;
}

function setCache<T>(key: string, data: T): void {
  marketCache.set(key, { data, timestamp: Date.now() });
}

export interface FetchCandlesResult {
  candles: Candle[];
  rawCandles: Candle[];
  systemCandles?: Candle[];
  source: string;
  status: 'LIVE' | 'STALE' | 'DATA_UNAVAILABLE' | 'SIMULATED';
  error?: string;
  timestamp?: number;
  candleStartTimeMs?: number;
  candleCloseTimeMs?: number;
  receivedTimestampMs?: number;
  lastUpdateTimestampMs?: number;
  ageMs?: number;
  latencyMs?: number;
}

let isCurrentMarketDataLive = true;
export function isLiveMarketDataActive(): boolean {
  return isCurrentMarketDataLive;
}

export async function fetchCandles(forceRefresh = false): Promise<FetchCandlesResult> {
  try {
    const bybitRes = await fetchBybit('15', 500, forceRefresh);
    const rawCandles = bybitRes.candles;
    const result: FetchCandlesResult = {
      candles: rawCandles,
      rawCandles,
      ...(bybitRes.systemCandles ? { systemCandles: bybitRes.systemCandles } : {}),
      source: bybitRes.source,
      status: 'LIVE',
      timestamp: bybitRes.receivedTimestampMs,
      candleStartTimeMs: bybitRes.sourceStartTimeMs,
      candleCloseTimeMs: bybitRes.sourceCloseTimeMs,
      receivedTimestampMs: bybitRes.receivedTimestampMs,
      lastUpdateTimestampMs: bybitRes.receivedTimestampMs,
      ageMs: Date.now() - bybitRes.receivedTimestampMs,
      latencyMs: bybitRes.latencyMs,
    };
    isCurrentMarketDataLive = true;
    return result;
  } catch (error) {
    isCurrentMarketDataLive = false;
    return {
      candles: [],
      rawCandles: [],
      source: 'Freqtrade DataProvider unavailable',
      status: 'DATA_UNAVAILABLE',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function filterCandleNoise(candles: Candle[]): Candle[] {
  if (!candles || candles.length === 0) return [];
  return candles.map(c => [...c] as Candle);
}

export async function fetchFearGreed(): Promise<FearAndGreed> {
  try {
    const { data, latencyMs } = await safeFetchJson<{
      data?: Array<{ value?: string; value_classification?: string; timestamp?: string }>;
    }>('https://api.alternative.me/fng/?limit=1&format=json');
    const latest = data.data?.[0];
    const value = Number(latest?.value);
    const timestampUtc = Number(latest?.timestamp) * 1_000;
    const ageMs = Date.now() - timestampUtc;
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > 100 ||
      !Number.isSafeInteger(timestampUtc) ||
      timestampUtc <= 0 ||
      ageMs < -60_000
    ) {
      throw new Error('Fear & Greed API returned invalid or future-dated data.');
    }
    return {
      value,
      sent: `Fear & Greed ${value}/100 (${latest?.value_classification || 'unclassified'})`,
      status: ageMs <= 36 * 60 * 60 * 1_000 ? 'LIVE' : 'STALE',
      timestampUtc,
      ageMs,
      latencyMs,
      source: 'Alternative.me Fear & Greed Index',
    };
  } catch (error) {
    return {
      value: null,
      sent: error instanceof Error
        ? `Fear & Greed unavailable: ${error.message}`
        : `Fear & Greed unavailable: ${String(error)}`,
      status: 'UNAVAILABLE',
      timestampUtc: 0,
      ageMs: Number.POSITIVE_INFINITY,
      latencyMs: 0,
      source: 'Alternative.me Fear & Greed Index',
    };
  }
}

export async function fetchDerivatives(): Promise<DerivativesData> {
  const [snapshotResult, tickerResult] = await Promise.allSettled([
    getFreqtradeMarketSnapshot(),
    getBybitTicker(),
  ]);
  const nowMs = Date.now();
  const data = tickerResult.status === 'fulfilled' ? tickerResult.value.data : null;
  const ticker = data?.result?.list?.[0];
  const observedAtMs = data && Number.isSafeInteger(data.time) && Number(data.time) > 0
    ? Number(data.time)
    : null;
  const ageMs = observedAtMs === null ? Number.POSITIVE_INFINITY : nowMs - observedAtMs;
  const tickerFresh = ageMs >= -1_000 && ageMs <= 15_000;
  const openInterestValue = Number(ticker?.openInterest);
  const fundingRateValue = Number(ticker?.fundingRate);
  let snapshotFunding: { rate: number; retrievedAtMs: number } | null = null;
  if (snapshotResult.status === 'fulfilled' && snapshotResult.value.fundingRate) {
    const candidate = snapshotResult.value.fundingRate;
    if (nowMs - candidate.retrievedAtMs >= -1_000 && nowMs - candidate.retrievedAtMs <= 15_000) {
      snapshotFunding = candidate;
    }
  }
  const funding = Number.isFinite(fundingRateValue) ? fundingRateValue : snapshotFunding?.rate ?? null;
  const openInterest = Number.isFinite(openInterestValue) && openInterestValue > 0
    ? openInterestValue
    : null;
  const validFunding = funding !== null && Number.isFinite(funding);
  const live = tickerFresh && validFunding && openInterest !== null;
  const source = data
    ? 'Bybit public market ticker (funding and open interest)'
    : snapshotFunding
      ? 'Freqtrade DataProvider funding; Bybit open interest unavailable'
      : 'Bybit and Freqtrade derivatives unavailable';
  return {
    funding,
    oi: openInterest,
    fundingHistory: [],
    status: live ? 'LIVE' : openInterest === null || !validFunding ? 'UNAVAILABLE' : 'STALE',
    timestampUtc: observedAtMs ?? snapshotFunding?.retrievedAtMs ?? 0,
    isoTimeUtc: observedAtMs || snapshotFunding
      ? new Date(observedAtMs ?? snapshotFunding!.retrievedAtMs).toISOString()
      : '',
    ageMs: observedAtMs === null && snapshotFunding
      ? nowMs - snapshotFunding.retrievedAtMs
      : ageMs,
    latencyMs: tickerResult.status === 'fulfilled'
      ? tickerResult.value.latencyMs
      : snapshotResult.status === 'fulfilled'
        ? getSnapshotNetworkLatencyMs(snapshotResult.value) ?? 0
        : 0,
    source,
  };
}

interface BybitOrderBookPayload {
  retCode?: number;
  retMsg?: string;
  time?: number;
  result?: { ts?: number; b?: unknown; a?: unknown };
}

let bybitOrderBookCache: { data: BybitOrderBookPayload; latencyMs: number; fetchedAtMs: number } | null = null;
let bybitOrderBookRequest: Promise<{ data: BybitOrderBookPayload; latencyMs: number }> | null = null;

async function getBybitOrderBook(): Promise<{ data: BybitOrderBookPayload; latencyMs: number }> {
  if (bybitOrderBookCache && Date.now() - bybitOrderBookCache.fetchedAtMs <= 1_000) {
    return bybitOrderBookCache;
  }
  if (bybitOrderBookRequest) return bybitOrderBookRequest;
  const request = safeFetchJson<BybitOrderBookPayload>(
    'https://api.bybit.com/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=20',
  );
  bybitOrderBookRequest = request;
  try {
    const result = await request;
    bybitOrderBookCache = { ...result, fetchedAtMs: Date.now() };
    return result;
  } finally {
    if (bybitOrderBookRequest === request) bybitOrderBookRequest = null;
  }
}

function validBybitLevels(value: unknown, descending: boolean): value is Array<[unknown, unknown]> {
  if (!Array.isArray(value) || value.length === 0) return false;
  let previousPrice: number | undefined;
  for (const level of value) {
    if (!Array.isArray(level) || level.length < 2) return false;
    const price = Number(level[0]);
    const amount = Number(level[1]);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) return false;
    if (previousPrice !== undefined && (descending ? price > previousPrice : price < previousPrice)) return false;
    previousPrice = price;
  }
  return true;
}

export async function fetchRealOrderBookImbalance(): Promise<RealOrderBookImbalance> {
  const [snapshotResult, systemResult] = await Promise.allSettled([
    getFreqtradeMarketSnapshot(),
    getBybitOrderBook(),
  ]);
  const nowMs = Date.now();
  const candidates: Array<{
    bids: Array<{ price: number; amount: number }>;
    asks: Array<{ price: number; amount: number }>;
    timestampMs: number;
    latencyMs: number;
    source: string;
    snapshotAgeMs?: number;
  }> = [];

  if (snapshotResult.status === 'fulfilled' && snapshotResult.value.orderBook) {
    const snapshot = snapshotResult.value;
    const orderBook = snapshot.orderBook!;
    candidates.push({
      bids: orderBook.bids,
      asks: orderBook.asks,
      timestampMs: orderBook.timestampMs,
      latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
      source: 'Freqtrade DataProvider order book',
      snapshotAgeMs: nowMs - snapshot.generatedAtMs,
    });
  }
  if (systemResult.status === 'fulfilled') {
    const { data } = systemResult.value;
    const result = data.result;
    const timestampMs = Number.isSafeInteger(result?.ts) && Number(result?.ts) > 0
      ? Number(result?.ts)
      : Number(data.time);
    if (
      data.retCode === 0 &&
      Number.isSafeInteger(timestampMs) &&
      timestampMs > 0 &&
      validBybitLevels(result?.b, true) &&
      validBybitLevels(result?.a, false) &&
      result.b[0].length >= 2 &&
      result.a[0].length >= 2 &&
      Number(result.b[0][0]) < Number(result.a[0][0])
    ) {
      candidates.push({
        bids: result.b.map((level) => ({ price: Number(level[0]), amount: Number(level[1]) })),
        asks: result.a.map((level) => ({ price: Number(level[0]), amount: Number(level[1]) })),
        timestampMs,
        latencyMs: systemResult.value.latencyMs,
        source: 'SBK1 Bybit public order book',
      });
    }
  }

  const freshCandidates = candidates
    .map((candidate) => ({ ...candidate, ageMs: nowMs - candidate.timestampMs }))
    .filter((candidate) => candidate.ageMs >= -1_000 && candidate.ageMs <= 10_000)
    .sort((left, right) => left.ageMs - right.ageMs);
  const selected = freshCandidates[0];
  if (!selected) {
    const snapshotError = snapshotResult.status === 'rejected'
      ? snapshotResult.reason instanceof Error ? snapshotResult.reason.message : String(snapshotResult.reason)
      : 'No fresh Freqtrade order book is available.';
    const systemError = systemResult.status === 'rejected'
      ? systemResult.reason instanceof Error ? systemResult.reason.message : String(systemResult.reason)
      : systemResult.value.data.retMsg || 'No fresh Bybit order book is available.';
    return {
      obi: null,
      bidDepthUsd: 0,
      askDepthUsd: 0,
      bestBid: null,
      bestAsk: null,
      spreadUsd: null,
      levelsCount: 0,
      status: 'UNAVAILABLE',
      timestamp: 0,
      ageMs: Number.POSITIVE_INFINITY,
      snapshotAgeMs: Number.POSITIVE_INFINITY,
      latencyMs: 0,
      source: `Order book unavailable; Freqtrade: ${snapshotError}; SBK1 Bybit: ${systemError}`,
      obiVelocity: null,
      obiAcceleration: null,
      bidWallPersistence: null,
      askWallPersistence: null,
      wallCancellationRatio: null,
      absorptionRate: null,
      liquidityInflowUsd: null,
      liquidityWithdrawalUsd: null,
      spoofingSuspicion: null,
      wallCancellationObserved: null,
      liquidityMigration: 'UNKNOWN',
    };
  }

  const bidDepthUsd = selected.bids.reduce((total, level) => total + level.price * level.amount, 0);
  const askDepthUsd = selected.asks.reduce((total, level) => total + level.price * level.amount, 0);
  const totalDepthUsd = bidDepthUsd + askDepthUsd;
  return {
    obi: totalDepthUsd > 0 ? (bidDepthUsd - askDepthUsd) / totalDepthUsd : null,
    bidDepthUsd,
    askDepthUsd,
    bestBid: selected.bids[0]?.price ?? null,
    bestAsk: selected.asks[0]?.price ?? null,
    spreadUsd: selected.asks[0] && selected.bids[0] ? selected.asks[0].price - selected.bids[0].price : null,
    levelsCount: selected.bids.length + selected.asks.length,
    status: 'LIVE',
    timestamp: selected.timestampMs,
    ageMs: selected.ageMs,
    snapshotAgeMs: selected.snapshotAgeMs ?? selected.ageMs,
    latencyMs: selected.latencyMs,
    source: selected.source,
    obiVelocity: null,
    obiAcceleration: null,
    bidWallPersistence: null,
    askWallPersistence: null,
    wallCancellationRatio: null,
    absorptionRate: null,
    liquidityInflowUsd: null,
    liquidityWithdrawalUsd: null,
    spoofingSuspicion: null,
    wallCancellationObserved: null,
    liquidityMigration: 'UNKNOWN',
  };
}

export async function fetchOrderBookImbalance(): Promise<number | null> {
  return (await fetchRealOrderBookImbalance()).obi;
}

let cachedTradeFlow: { data: OrderFlowFeatures; fetchedAtMs: number } | null = null;
let tradeFlowRequest: Promise<OrderFlowFeatures> | null = null;

export async function fetchRealTradeFlowCvd(): Promise<OrderFlowFeatures> {
  if (cachedTradeFlow && Date.now() - cachedTradeFlow.fetchedAtMs <= 1_000) {
    return cachedTradeFlow.data;
  }
  if (tradeFlowRequest) return tradeFlowRequest;
  const request = (async (): Promise<OrderFlowFeatures> => {
    try {
    const { data, latencyMs } = await safeFetchJson<{
      retCode?: number;
      retMsg?: string;
      time?: number;
      result?: { list?: unknown };
    }>('https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=BTCUSDT&limit=1000');
    if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
      throw new Error(`Bybit recent trades are unavailable: ${data.retMsg || 'invalid response'}.`);
    }
    const trades = data.result.list.map((rawTrade) => {
      if (typeof rawTrade !== 'object' || rawTrade === null || Array.isArray(rawTrade)) {
        throw new Error('Bybit returned a malformed recent trade.');
      }
      const trade = rawTrade as Record<string, unknown>;
      const timestampMs = Number(trade.time);
      const price = Number(trade.price);
      const size = Number(trade.size);
      if (
        trade.symbol !== 'BTCUSDT' ||
        (trade.side !== 'Buy' && trade.side !== 'Sell') ||
        !Number.isSafeInteger(timestampMs) ||
        timestampMs <= 0 ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isFinite(size) ||
        size <= 0
      ) {
        throw new Error('Bybit returned invalid trade side, symbol, timestamp, price, or size.');
      }
      return { timestampMs, price, size, side: trade.side };
    }).sort((left, right) => left.timestampMs - right.timestampMs);

    const nowMs = Date.now();
    const timestampUtc = trades.at(-1)?.timestampMs ?? 0;
    const ageMs = nowMs - timestampUtc;
    if (trades.length < 20 || ageMs < -1_000 || ageMs > 5_000) {
      throw new Error(`Bybit recent trades are insufficient or stale (${trades.length} trades, ${ageMs}ms age).`);
    }
    const firstTrade = trades[0];
    const lastTrade = trades[trades.length - 1];
    const takerBuyVol = trades.reduce((sum, trade) => sum + (trade.side === 'Buy' ? trade.size : 0), 0);
    const takerSellVol = trades.reduce((sum, trade) => sum + (trade.side === 'Sell' ? trade.size : 0), 0);
    const takerDelta = takerBuyVol - takerSellVol;
    const totalVolume = takerBuyVol + takerSellVol;
    const cvdDeltaUsd = trades.reduce(
      (sum, trade) => sum + (trade.side === 'Buy' ? 1 : -1) * trade.price * trade.size,
      0,
    );
    const tradePriceChangePct = ((lastTrade.price - firstTrade.price) / firstTrade.price) * 100;
    const elapsedSeconds = Math.max((lastTrade.timestampMs - firstTrade.timestampMs) / 1_000, 1);
    const cvdDivergence = takerDelta > 0 && tradePriceChangePct < 0
      ? 'Bullish divergence'
      : takerDelta < 0 && tradePriceChangePct > 0
        ? 'Bearish divergence'
        : takerDelta * tradePriceChangePct > 0
          ? 'Confirmed'
          : 'Mixed';
    return {
      cvdDelta: takerDelta,
      cvdDeltaUsd,
      cvdDivergence,
      takerBuyVol,
      takerSellVol,
      takerRatio: totalVolume > 0 ? takerBuyVol / totalVolume : null,
      takerDelta,
      tradePriceChangePct,
      delta: takerDelta,
      cumulativeDelta: takerDelta,
      deltaVelocity: takerDelta / elapsedSeconds,
      isRealTradeFlow: true,
      status: 'LIVE',
      timestampUtc,
      ageMs,
      latencyMs,
      source: 'Bybit recent trades (latest 1000 trade window)',
    };
    } catch (error) {
      return {
      cvdDelta: null,
      cvdDeltaUsd: null,
      cvdDivergence: 'UNAVAILABLE',
      takerBuyVol: null,
      takerSellVol: null,
      takerRatio: null,
      takerDelta: null,
      tradePriceChangePct: null,
      delta: null,
      cumulativeDelta: null,
      deltaVelocity: null,
      isRealTradeFlow: false,
      status: 'UNAVAILABLE',
      timestampUtc: 0,
      ageMs: Number.POSITIVE_INFINITY,
      source: 'Bybit recent trades',
      error: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  tradeFlowRequest = request;
  try {
    const data = await request;
    cachedTradeFlow = { data, fetchedAtMs: Date.now() };
    return data;
  } finally {
    if (tradeFlowRequest === request) tradeFlowRequest = null;
  }
}

export function calculateOrderFlowFeatures(candles: Candle[]): OrderFlowFeatures {
  void candles;
  return {
    cvdDelta: null,
    cvdDeltaUsd: null,
    cvdDivergence: 'UNAVAILABLE',
    takerBuyVol: null,
    takerSellVol: null,
    takerRatio: null,
    takerDelta: null,
    delta: null,
    cumulativeDelta: null,
    deltaVelocity: null,
    isRealTradeFlow: false,
    status: 'UNAVAILABLE',
    timestampUtc: 0,
    ageMs: Number.POSITIVE_INFINITY,
  };
}

export function evaluateMarketDataQuality(
  candleResult: FetchCandlesResult,
  orderBookResult: RealOrderBookImbalance,
  derivResult: DerivativesData,
  fngResult: FearAndGreed,
  futuresPricesResult?: FuturesPrices,
  orderFlowResult?: OrderFlowFeatures
): DataQualityReport {
  const now = Date.now();
  const candleLive = candleResult.status === 'LIVE' && candleResult.candles.length >= 300;
  const orderBookLive = orderBookResult.status === 'LIVE' && orderBookResult.obi !== null;
  const derivativesLive = derivResult.status === 'LIVE' && derivResult.funding !== null && derivResult.oi !== null;
  const pricesLive = futuresPricesResult?.status === 'LIVE' && futuresPricesResult.lastPrice > 0;
  const orderFlowAgeMs = orderFlowResult?.ageMs ?? Number.POSITIVE_INFINITY;
  const orderFlowLive = orderFlowResult?.isRealTradeFlow === true &&
    orderFlowResult.status === 'LIVE' &&
    orderFlowAgeMs >= 0 &&
    orderFlowAgeMs <= 5_000 &&
    orderFlowResult.takerDelta !== null &&
    orderFlowResult.takerBuyVol !== null &&
    orderFlowResult.takerSellVol !== null;
  const orderFlowStatus: FeedStatus = orderFlowLive
    ? 'LIVE'
    : orderFlowResult?.status === 'LIVE' && (orderFlowAgeMs < 0 || orderFlowAgeMs > 5_000)
      ? 'STALE'
      : 'UNAVAILABLE';
  const feedStatus = (live: boolean, ageMs: number): FeedStatus =>
    live && ageMs <= 15_000 ? 'LIVE' : live ? 'STALE' : 'UNAVAILABLE';
  const feeds = {
    candles: {
      feedName: 'Futures Candles 15m Feed',
      source: candleResult.source,
      status: feedStatus(candleLive, candleResult.ageMs ?? Number.POSITIVE_INFINITY),
      timestamp: candleResult.timestamp ?? 0,
      ageMs: candleResult.ageMs ?? Number.POSITIVE_INFINITY,
      latencyMs: candleResult.latencyMs ?? 0,
      score: candleLive ? 100 : 0,
      detailsFa: candleLive
        ? `کندل‌های زنده و کامل از ${candleResult.source} دریافت شد.`
        : candleResult.error ?? 'کندل معتبر دریافت نشد.',
    },
    orderBook: {
      feedName: 'Futures Order Book',
      source: orderBookResult.source,
      status: feedStatus(orderBookLive, orderBookResult.ageMs),
      timestamp: orderBookResult.timestamp,
      ageMs: orderBookResult.ageMs,
      latencyMs: orderBookResult.latencyMs,
      score: orderBookLive ? 100 : 0,
      detailsFa: orderBookLive
        ? `دفتر سفارش معتبر از ${orderBookResult.source} دریافت شد.`
        : 'دفتر سفارش معتبر در دسترس نیست.',
    },
    derivatives: {
      feedName: 'Futures Derivatives',
      source: derivResult.source ?? 'Freqtrade',
      status: feedStatus(derivativesLive, derivResult.ageMs ?? Number.POSITIVE_INFINITY),
      timestamp: derivResult.timestampUtc ?? 0,
      ageMs: derivResult.ageMs ?? Number.POSITIVE_INFINITY,
      latencyMs: derivResult.latencyMs ?? 0,
      score: derivativesLive ? 100 : 0,
      detailsFa: derivativesLive ? 'Funding و Open Interest معتبرند.' : 'Funding یا Open Interest موجود نیست.',
    },
    futuresPrices: {
      feedName: 'Futures Prices',
      source: futuresPricesResult?.source ?? 'Freqtrade',
      status: feedStatus(pricesLive, futuresPricesResult?.ageMs ?? Number.POSITIVE_INFINITY),
      timestamp: futuresPricesResult?.timestampUtc ?? 0,
      ageMs: futuresPricesResult?.ageMs ?? Number.POSITIVE_INFINITY,
      latencyMs: futuresPricesResult?.latencyMs ?? 0,
      score: pricesLive ? 100 : 0,
      detailsFa: pricesLive
        ? `قیمت Futures تازه از ${futuresPricesResult?.source ?? 'منبع بازار'} دریافت شد.`
        : 'قیمت معتبر در دسترس نیست.',
    },
    sentiment: {
      feedName: 'Fear & Greed Index',
      source: fngResult.source ?? 'Alternative.me Fear & Greed Index',
      status: fngResult.status === 'LIVE' ? 'LIVE' as const : fngResult.status === 'STALE' ? 'STALE' as const : 'UNAVAILABLE' as const,
      timestamp: fngResult.timestampUtc ?? now,
      ageMs: fngResult.ageMs ?? (fngResult.status === 'LIVE' ? 0 : Number.POSITIVE_INFINITY),
      latencyMs: fngResult.latencyMs ?? 0,
      score: fngResult.status === 'LIVE' ? 100 : 0,
      detailsFa: fngResult.sent,
    },
    orderFlow: {
      feedName: 'Real trade-level CVD',
      source: orderFlowResult?.source ?? 'Bybit recent trades',
      status: orderFlowStatus,
      timestamp: orderFlowResult?.timestampUtc ?? 0,
      ageMs: orderFlowAgeMs,
      latencyMs: orderFlowResult?.latencyMs ?? 0,
      score: orderFlowLive ? 100 : 0,
      detailsFa: orderFlowLive
        ? `جریان واقعی معاملات Bybit تازه است؛ دلتا ${orderFlowResult?.takerDelta?.toFixed(4)} BTC.`
        : orderFlowResult?.error ?? 'جریان معاملات واقعی CVD در دسترس نیست.',
    },
  };
  const requiredFeedsLive = candleLive && orderBookLive && derivativesLive && pricesLive && orderFlowLive;
  const primaryFeedsUnavailable = !candleLive || !pricesLive;
  const liveFeedCount = Object.values(feeds).filter((feed) => feed.status === 'LIVE').length;
  return {
    overallScore: Math.round((liveFeedCount / Object.keys(feeds).length) * 100),
    isTradeAllowed: requiredFeedsLive,
    status: primaryFeedsUnavailable ? 'DATA_UNAVAILABLE' : requiredFeedsLive ? 'LIVE' : 'STALE',
    reasonsFa: requiredFeedsLive
      ? ['فیدهای ضروری بازار معتبرند؛ این وضعیت به‌تنهایی مجوز اجرای معامله نیست.']
      : [
          ...(!candleLive ? ['کندل معتبر از منابع بازار موجود نیست.'] : []),
          ...(!pricesLive ? ['قیمت Futures تازه از منابع بازار موجود نیست.'] : []),
          ...(!orderBookLive ? ['دفتر سفارش معتبر موجود نیست.'] : []),
          ...(!derivativesLive ? ['Funding و Open Interest معتبر هم‌زمان در دسترس نیستند.'] : []),
          ...(!orderFlowLive ? ['جریان واقعی معاملات CVD موجود یا تازه نیست.'] : []),
        ],
    feeds,
  };
}

export async function getCanonicalMarketSnapshot(): Promise<CanonicalMarketSnapshot> {
  const snapshot = await getFreqtradeMarketSnapshot();
  const now = Date.now();
  const ticker = snapshot.ticker;
  if (!ticker) {
    return {
      timestampUtc: now,
      isoTimeUtc: new Date(now).toISOString(),
      symbol: 'BTC/USDT',
      primaryIndexPrice: null,
      basisSpreadUsd: null,
      basisSpreadBps: null,
      crossExchangeSpreadUsd: null,
      crossExchangeLatencyMs: null,
      overallQualityScore: 0,
      feedStatuses: { BYBIT: 'UNAVAILABLE' },
      feeds: [],
    };
  }
  const ageMs = now - ticker.retrievedAtMs;
  const status: FeedStatus = ageMs <= FREQTRADE_TICKER_MAX_AGE_MS && ticker.exchangeTimestampMs !== null
    ? 'LIVE'
    : 'STALE';
  const basisSpreadUsd = ticker.indexPrice === null || ticker.exchangeTimestampMs === null
    ? null
    : ticker.last - ticker.indexPrice;
  const spreadUsd = ticker.bid === null || ticker.ask === null ? null : ticker.ask - ticker.bid;
  const spreadBps = spreadUsd === null || ticker.last <= 0 ? null : spreadUsd / ticker.last * 10_000;
  const feed: CanonicalExchangeFeed = {
    exchange: 'BYBIT',
    marketType: 'PERPETUAL_FUTURES',
    symbol: 'BTCUSDT',
    timestampUtc: ticker.exchangeTimestampMs ?? ticker.retrievedAtMs,
    exchangeTimestampUtc: ticker.exchangeTimestampMs,
    timestampSource: ticker.exchangeTimestampMs === null ? 'FREQTRADE_RECEIVED' : 'EXCHANGE',
    isoTimeUtc: new Date(ticker.retrievedAtMs).toISOString(),
    lastPrice: ticker.last,
    ...(ticker.bid !== null ? { bestBid: ticker.bid } : {}),
    ...(ticker.ask !== null ? { bestAsk: ticker.ask } : {}),
    ...(spreadUsd !== null ? { spreadUsd } : {}),
    ...(spreadBps !== null ? { spreadBps } : {}),
    latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
    status,
  };
  return {
    timestampUtc: ticker.exchangeTimestampMs ?? ticker.retrievedAtMs,
    isoTimeUtc: new Date(ticker.retrievedAtMs).toISOString(),
    symbol: 'BTC/USDT',
    primaryIndexPrice: ticker.indexPrice,
    basisSpreadUsd,
    basisSpreadBps: basisSpreadUsd === null || ticker.indexPrice === null || ticker.indexPrice <= 0
      ? null
      : basisSpreadUsd / ticker.indexPrice * 10_000,
    crossExchangeSpreadUsd: null,
    crossExchangeLatencyMs: null,
    overallQualityScore: status === 'LIVE' ? 100 : 50,
    feedStatuses: { BYBIT: status },
    feeds: [feed],
  };
}

export async function fetchHtf(): Promise<Record<string, Candle[]>> {
  const snapshot = await getFreqtradeMarketSnapshot();
  return Object.fromEntries(
    ['1m', '5m', '1h', '4h'].map((timeframe) => {
      try {
        return [`Freqtrade ${timeframe}`, candleDataForTimeframe(snapshot, timeframe)];
      } catch {
        return [`Freqtrade ${timeframe}`, []];
      }
    }),
  );
}