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

// Helper for fetching JSON with timeout and measured latency
async function safeFetchJson<T>(url: string, timeoutMs = 6000): Promise<{ data: T; latencyMs: number }> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    const latencyMs = Math.round(performance.now() - start);
    return { data, latencyMs };
  } finally {
    clearTimeout(id);
  }
}

export interface BybitCandlesResult {
  candles: Candle[];
  latencyMs: number;
  sourceStartTimeMs: number;
  sourceCloseTimeMs: number;
  receivedTimestampMs: number;
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
        throw new Error(`Freqtrade market snapshot is unavailable (HTTP ${response.status}).`);
      }
      const payload: unknown = await response.json();
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
      const value = payload as Record<string, unknown>;
      const snapshot = validateFreqtradeMarketSnapshot(value, {
        exchange: String(value.exchange),
        market: value.market === 'futures' ? 'futures' : 'spot',
        pair: String(value.pair),
        timeframe: String(value.timeframe),
      });
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
    throw new Error(`Freqtrade DataProvider has no fresh completed ${timeframe} candles.`);
  }
  return rows.map((row) => [row.open, row.high, row.low, row.close, row.volume]);
}

// Compatibility name: candles now come exclusively from the configured Freqtrade DataProvider.
export async function fetchBybit(interval = '15', limit = 150, forceRefresh = false): Promise<BybitCandlesResult> {
  if (!Number.isInteger(limit) || limit < 20 || limit > 500) {
    throw new Error('Freqtrade candle limit must be between 20 and 500.');
  }
  const timeframe = timeframeForMinuteInterval(interval);
  if (!timeframe) throw new Error('Unsupported candle interval for the Freqtrade market snapshot.');
  const snapshot = await getFreqtradeMarketSnapshot(forceRefresh);
  if (snapshot.market !== 'futures' || !snapshot.pair.startsWith('BTC/')) {
    throw new Error('This analysis requires a configured BTC futures Freqtrade pair.');
  }
  if (snapshot.timeframe !== timeframe && !snapshot.additionalCandles[timeframe]) {
    throw new Error(`Freqtrade snapshot does not contain ${timeframe} data.`);
  }
  const candles = candleDataForTimeframe(snapshot, timeframe).slice(-limit);
  if (candles.length < 20 || candles.some((candle) => !isValidMarketCandle(candle))) {
    throw new Error(`Freqtrade returned insufficient or invalid completed ${timeframe} candles.`);
  }
  const intervalMs = Number(interval) * 60_000;
  const sourceCandles = snapshot.timeframe === timeframe
    ? snapshot.candles
    : snapshot.additionalCandles[timeframe];
  const lastSourceCandle = sourceCandles?.at(-1);
  if (!lastSourceCandle) {
    throw new Error(`Freqtrade DataProvider has no ${timeframe} candle timestamp.`);
  }
  const sourceStartTimeMs = lastSourceCandle.timestampMs;
  const sourceCloseTimeMs = sourceStartTimeMs + intervalMs;
  const receivedTimestampMs = Date.now();

  return {
    candles,
    latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
    sourceStartTimeMs,
    sourceCloseTimeMs,
    receivedTimestampMs,
  };
}

function isValidMarketCandle(candle: Candle): boolean {
  const [open, high, low, close, volume] = candle;
  return [open, high, low, close, volume].every(Number.isFinite) &&
    open > 0 && high > 0 && low > 0 && close > 0 && volume >= 0 &&
    high >= Math.max(open, close) && low <= Math.min(open, close) && high >= low;
}

// Read futures prices only from the authenticated Freqtrade DataProvider snapshot.
export async function fetchFuturesPrices(forceRefresh = false): Promise<FuturesPrices> {
  const now = Date.now();
  try {
    const snapshot = await getFreqtradeMarketSnapshot(forceRefresh);
    const ticker = snapshot.ticker;
    if (!ticker) throw new Error('Freqtrade DataProvider ticker is unavailable.');
    const ageMs = now - ticker.retrievedAtMs;
    const pricesAvailable = ticker.markPrice !== null && ticker.indexPrice !== null;
    const timestampUtc = ticker.exchangeTimestampMs ?? ticker.retrievedAtMs;
    const result: FuturesPrices = {
      lastPrice: ticker.last,
      markPrice: ticker.markPrice ?? 0,
      indexPrice: ticker.indexPrice ?? 0,
      timestampUtc,
      exchangeTimestampUtc: ticker.exchangeTimestampMs,
      timestampSource: ticker.exchangeTimestampMs === null ? 'FREQTRADE_RECEIVED' : 'EXCHANGE',
      receivedTimestampMs: Date.now(),
      isoTimeUtc: new Date(timestampUtc).toISOString(),
      ageMs,
      latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
      source: `${snapshot.source} ticker (${snapshot.exchange} ${snapshot.market} ${snapshot.pair})`,
      status: ageMs >= 0 && ageMs <= FREQTRADE_TICKER_MAX_AGE_MS && pricesAvailable ? 'LIVE' : 'UNAVAILABLE',
    };
    dataProvenanceLayerService.registerAndAuditFeedProvenance({
      feedKey: 'TICKER_FUTURES',
      source: result.source,
      exchange: snapshot.exchange.toUpperCase(),
      symbol: snapshot.pair,
      marketType: snapshot.market === 'futures' ? 'LINEAR_PERPETUAL' : 'SPOT',
      timeframe: 'TICK',
      sourceTimestampMs: ticker.exchangeTimestampMs ?? undefined,
      receivedTimestampMs: ticker.retrievedAtMs,
      networkLatencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? undefined,
      customStatus: result.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : undefined,
      rawPriceValues: {
        lastPrice: ticker.last,
        markPrice: ticker.markPrice,
        indexPrice: ticker.indexPrice,
      },
    });
    return result;
  } catch (error) {
    console.warn('[Freqtrade market data] Futures ticker unavailable:', error instanceof Error ? error.message : String(error));
  }

  dataProvenanceLayerService.registerAndAuditFeedProvenance({
    feedKey: 'TICKER_FUTURES',
    source: 'Freqtrade DataProvider unavailable',
    exchange: 'FREQTRADE',
    symbol: 'CONFIGURED_PAIR',
    marketType: 'LINEAR_PERPETUAL',
    timeframe: 'TICK',
    customStatus: 'UNAVAILABLE',
    rawPriceValues: {
      lastPrice: null,
      markPrice: null,
      indexPrice: null,
    },
  });

  return {
    lastPrice: 0,
    markPrice: 0,
    indexPrice: 0,
    timestampUtc: now,
    exchangeTimestampUtc: null,
    timestampSource: 'UNAVAILABLE',
    receivedTimestampMs: now,
    isoTimeUtc: new Date(now).toISOString(),
    ageMs: Infinity,
    latencyMs: 0,
    source: 'DATA_UNAVAILABLE',
    status: 'UNAVAILABLE'
  };
}

export interface KucoinCandlesResult {
  candles: Candle[];
  latencyMs: number;
  sourceStartTimeMs: number;
  sourceCloseTimeMs: number;
  receivedTimestampMs: number;
}

// Alternate-exchange data requires its own Freqtrade instance and is never a fallback.
export async function fetchKucoin(type = '15min'): Promise<KucoinCandlesResult> {
  throw new Error(`KuCoin ${type} data requires a separately configured Freqtrade instance; venue fallback is disabled.`);
}

// ۴۷. حائل ایمنی نفوذناپذیر داده‌های مصنوعی (Synthetic Data Safety Barrier)
export const SYNTHETIC_DATA_FLAG = '__isSyntheticUnsafeForLive__';

export interface MarketDataSafetyCheckResult {
  isLiveSafe: boolean;
  status: 'LIVE_DATA_VALID' | 'LIVE_DATA_INVALID';
  reasonFa: string;
  isSyntheticDetected: boolean;
}

// 3. Isolated Sandbox Mock Generator ONLY for non-trading UI previews (NEVER injected into live execution)
export function generateSandboxDemoCandlesOnly(count = 150, basePrice = 88450.0): Candle[] {
  const candles: Candle[] = [];
  let current = basePrice;

  for (let i = count; i >= 0; i--) {
    const volatility = current * 0.003;
    const change = (Math.random() - 0.49) * volatility;
    const open = current;
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * (volatility * 0.5);
    const low = Math.min(open, close) - Math.random() * (volatility * 0.5);
    const volume = 20 + Math.random() * 85;
    candles.push([open, high, low, close, volume]);
    current = close;
  }

  // علامت‌گذاری غیرقابل جعل کاندل‌های مصنوعی جهت مسدودسازی قطعی ورود به لایو (Item 47)
  Object.defineProperty(candles, SYNTHETIC_DATA_FLAG, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false
  });
  (candles as any).__isSynthetic = true;
  (candles as any).__isLiveSafe = false;

  return candles;
}

/**
 * ۴۷. اعتبارسنجی حائل ایمنی زنده: ردگیری هرگونه داده مصنوعی یا تصادفی
 * اگر حتی یک فیچر یا کاندل از نوع Synthetic باشد: LIVE_DATA_INVALID و NO TRADE
 */
export function validateMarketDataLiveSafety(
  candles?: Candle[] | any,
  feedStatus?: string
): MarketDataSafetyCheckResult {
  if (!candles || !Array.isArray(candles) || candles.length === 0) {
    return {
      isLiveSafe: false,
      status: 'LIVE_DATA_INVALID',
      reasonFa: 'کاندل‌های بازار خالی یا تعریف‌نشده هستند (DATA_UNAVAILABLE).',
      isSyntheticDetected: false
    };
  }

  // بررسی تگ و حائل داده‌های مصنوعی
  if ((candles as any)[SYNTHETIC_DATA_FLAG] === true || (candles as any).__isSynthetic === true || (candles as any).__isLiveSafe === false) {
    return {
      isLiveSafe: false,
      status: 'LIVE_DATA_INVALID',
      reasonFa: '🛑 [LIVE_DATA_INVALID]: داده‌های بازار از مولد مصنوعی/تصادفی (Synthetic) نشأت گرفته‌اند؛ ورود به معامله لایو اکیداً ممنوع است (NO TRADE).',
      isSyntheticDetected: true
    };
  }

  if (feedStatus === 'SIMULATED' || feedStatus === 'DATA_UNAVAILABLE') {
    return {
      isLiveSafe: false,
      status: 'LIVE_DATA_INVALID',
      reasonFa: `🛑 وضعیت فید داده (${feedStatus}) در حالت لایو مجاز نیست.`,
      isSyntheticDetected: true
    };
  }

  return {
    isLiveSafe: true,
    status: 'LIVE_DATA_VALID',
    reasonFa: '✅ داده‌های بازار از snapshot معتبر Freqtrade تایید شدند.',
    isSyntheticDetected: false
  };
}

// Keep backwards compatibility alias but explicitly mark deprecated for live trading
export const generateRealisticCandles = generateSandboxDemoCandlesOnly;

// Client-Side Market Data Cache with TTL to prevent API overuse & speed up initial load
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const marketCache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string, ttlMs: number): T | null {
  const entry = marketCache.get(key);
  if (!entry) {
    try {
      const stored = sessionStorage.getItem(`cache_${key}`);
      if (stored) {
        const parsed: CacheEntry<T> = JSON.parse(stored);
        if (Date.now() - parsed.timestamp < ttlMs) {
          marketCache.set(key, parsed);
          return parsed.data;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }
  if (Date.now() - entry.timestamp > ttlMs) {
    marketCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  marketCache.set(key, entry);
  try {
    sessionStorage.setItem(`cache_${key}`, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

export interface FetchCandlesResult {
  candles: Candle[];
  rawCandles: Candle[];
  source: string;
  status: 'LIVE' | 'STALE' | 'DATA_UNAVAILABLE' | 'SIMULATED';
  timestamp?: number;
  candleStartTimeMs?: number;    // True exchange origin time of latest candle
  candleCloseTimeMs?: number;    // Scheduled close timestamp of latest candle
  receivedTimestampMs?: number;  // API response reception time at client
  lastUpdateTimestampMs?: number;// Last modification timestamp
  ageMs?: number;
  latencyMs?: number;
}

// Global market data health flag
let isCurrentMarketDataLive = false;
export function isLiveMarketDataActive(): boolean {
  return isCurrentMarketDataLive;
}

// Fetch 15m candles from the configured Freqtrade futures snapshot.
export async function fetchCandles(forceRefresh = false): Promise<FetchCandlesResult> {
  const now = Date.now();
  try {
    const bybitRes = await fetchBybit('15', 150, forceRefresh);
    if (bybitRes.candles.length < 20) {
      throw new Error(`Freqtrade returned only ${bybitRes.candles.length} candles; at least 20 are required.`);
    }
    const snapshot = await getFreqtradeMarketSnapshot();
    const rawCandles = bybitRes.candles;
    const ageMs = Math.max(0, now - bybitRes.sourceCloseTimeMs);
    const status = ageMs <= 30_000 ? 'LIVE' : 'STALE';
    const result: FetchCandlesResult = {
      candles: rawCandles,
      rawCandles,
      source: `${snapshot.source} (${snapshot.exchange} ${snapshot.market} ${snapshot.pair})`,
      status,
      timestamp: bybitRes.receivedTimestampMs,
      candleStartTimeMs: bybitRes.sourceStartTimeMs,
      candleCloseTimeMs: bybitRes.sourceCloseTimeMs,
      receivedTimestampMs: bybitRes.receivedTimestampMs,
      lastUpdateTimestampMs: now,
      ageMs,
      latencyMs: bybitRes.latencyMs,
    };
    isCurrentMarketDataLive = status === 'LIVE';
    dataProvenanceLayerService.registerAndAuditFeedProvenance({
      feedKey: 'CANDLES_PRIMARY',
      source: result.source,
      exchange: snapshot.exchange.toUpperCase(),
      symbol: snapshot.pair,
      marketType: snapshot.market === 'futures' ? 'LINEAR_PERPETUAL' : 'SPOT',
      timeframe: '15m',
      sourceTimestampMs: bybitRes.sourceCloseTimeMs,
      receivedTimestampMs: bybitRes.receivedTimestampMs,
      networkLatencyMs: bybitRes.latencyMs,
      candles: rawCandles,
    });
    return result;
  } catch (error) {
    isCurrentMarketDataLive = false;
    console.warn('[Freqtrade market data] Primary candles unavailable:', error instanceof Error ? error.message : String(error));
  }

  dataProvenanceLayerService.registerAndAuditFeedProvenance({
    feedKey: 'CANDLES_PRIMARY',
    source: 'Freqtrade DataProvider unavailable',
    exchange: 'FREQTRADE',
    symbol: 'CONFIGURED_PAIR',
    marketType: 'LINEAR_PERPETUAL',
    timeframe: '15m',
    customStatus: 'UNAVAILABLE',
    candles: [],
  });
  return {
    candles: [],
    rawCandles: [],
    source: 'Freqtrade DataProvider unavailable',
    status: 'DATA_UNAVAILABLE',
    timestamp: now,
    ageMs: Infinity,
    latencyMs: 0
  };
}

/**
 * Clean & Immutable Market Data Layer (Item 30):
 * Preserves raw market wicks, flash crashes, and liquidity sweeps 100% untouched.
 * Raw Market Data MUST remain immutable. Returns raw candles with optional derived metadata.
 */
export function filterCandleNoise(candles: Candle[]): Candle[] {
  if (!candles || candles.length === 0) return [];
  // Return exact immutable candle clone without truncating wicks or erasing liquidity sweeps
  return candles.map(c => [...c] as Candle);
}

// Fetch Fear & Greed Index (TTL: 5 minutes)
export async function fetchFearGreed(): Promise<FearAndGreed> {
  const cached = getCached<FearAndGreed>('fear_greed', 300000);
  if (cached) return cached;

  try {
    interface FngResp {
      data?: Array<{ value: string; value_classification: string }>;
    }
    const { data } = await safeFetchJson<FngResp>('https://api.alternative.me/fng/?limit=1', 4000);
    if (data?.data && data.data.length > 0) {
      const res: FearAndGreed = {
        value: parseInt(data.data[0].value, 10),
        sent: data.data[0].value_classification,
        status: 'LIVE'
      };
      setCache('fear_greed', res);
      return res;
    }
  } catch {
    // ignore
  }
  const fallback: FearAndGreed = {
    value: null,
    sent: 'شاخص احساسات در دسترس نیست (DATA_UNAVAILABLE)',
    status: 'UNAVAILABLE'
  };
  setCache('fear_greed', fallback);
  return fallback;
}

// Fetch Futures Derivatives (Funding Rate, 3-Period History, Funding Trend & Open Interest) (Item 31 & 34)
export async function fetchDerivatives(): Promise<DerivativesData> {
  const now = Date.now();
  try {
    const snapshot = await getFreqtradeMarketSnapshot();
    const funding = snapshot.fundingRate;
    if (!funding || snapshot.market !== 'futures') throw new Error('Freqtrade funding data is unavailable for the configured market.');
    const ageMs = now - funding.retrievedAtMs;
    return {
      funding: null,
      oi: null,
      status: ageMs < 0 || ageMs > 15_000 ? 'STALE' : 'UNAVAILABLE',
      timestampUtc: funding.retrievedAtMs,
      isoTimeUtc: new Date(funding.retrievedAtMs).toISOString(),
      ageMs,
      latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
      source: `${snapshot.source} funding received, but open interest is unavailable`,
    };
  } catch (error) {
    console.warn('[Freqtrade market data] Derivatives unavailable:', error instanceof Error ? error.message : String(error));
  }

  return {
    funding: null,
    oi: null,
    fundingHistory: [],
    fundingTrend: 'STABLE',
    status: 'UNAVAILABLE',
    timestampUtc: now,
    isoTimeUtc: new Date(now).toISOString(),
    ageMs: Infinity,
    latencyMs: 0,
    source: 'Freqtrade DataProvider unavailable'
  };
}

// Snapshot-derived order-book metrics; temporal dynamics require a real history feed.
export async function fetchRealOrderBookImbalance(): Promise<RealOrderBookImbalance> {
  const now = Date.now();
  try {
    const snapshot = await getFreqtradeMarketSnapshot();
    const book = snapshot.orderBook;
    if (!book) throw new Error('Freqtrade DataProvider order book is unavailable.');
    const bidDepthUsd = book.bids.reduce((total, level) => total + level.price * level.amount, 0);
    const askDepthUsd = book.asks.reduce((total, level) => total + level.price * level.amount, 0);
    const totalDepthUsd = bidDepthUsd + askDepthUsd;
    if (totalDepthUsd <= 0) throw new Error('Freqtrade order book has no usable depth.');
    const bestBid = book.bids[0].price;
    const bestAsk = book.asks[0].price;
    const ageMs = now - book.timestampMs;
    return {
      obi: (bidDepthUsd - askDepthUsd) / totalDepthUsd,
      bidDepthUsd,
      askDepthUsd,
      bestBid,
      bestAsk,
      spreadUsd: bestAsk - bestBid,
      levelsCount: Math.min(book.bids.length, book.asks.length),
      status: ageMs >= 0 && ageMs <= 10_000 ? 'LIVE' : 'STALE',
      timestamp: book.timestampMs,
      ageMs,
      snapshotAgeMs: ageMs,
      latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
      source: `${snapshot.source} order book (${snapshot.exchange} ${snapshot.pair})`,
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
  } catch (error) {
    console.warn('[Freqtrade market data] Order book unavailable:', error instanceof Error ? error.message : String(error));
    return {
      obi: null,
      bidDepthUsd: 0,
      askDepthUsd: 0,
      levelsCount: 0,
      status: 'UNAVAILABLE',
      timestamp: now,
      ageMs: Infinity,
      snapshotAgeMs: Infinity,
      latencyMs: 0,
      source: 'Freqtrade DataProvider unavailable',
    };
  }
}

// Fetch Order Book Imbalance (OBI) backward-compatible wrapper (returns null if unavailable, never masks with fake 0.0)
export async function fetchOrderBookImbalance(): Promise<number | null> {
  const res = await fetchRealOrderBookImbalance();
  return res.obi;
}

// The v2 snapshot does not include trades, so trade-derived features stay unavailable.
export async function fetchRealTradeFlowCvd(): Promise<OrderFlowFeatures> {
  return {
    cvdDelta: null,
    cvdDeltaUsd: null,
    cvdDivergence: 'UNAVAILABLE: Freqtrade market snapshot does not include trades',
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
    timestampUtc: Date.now(),
    ageMs: Infinity,
  };
}

export function calculateOrderFlowFeatures(candles: Candle[]): OrderFlowFeatures {
  // If only candle estimation without real trade feed, mark clearly as unavailable/estimated
  if (!candles || candles.length < 5) {
    return {
      cvdDelta: null,
      cvdDeltaUsd: null,
      cvdDivergence: 'داده‌های جریان سفارش در دسترس نیست (UNAVAILABLE)',
      takerBuyVol: null,
      takerSellVol: null,
      takerRatio: null,
      takerDelta: null,
      delta: null,
      cumulativeDelta: null,
      deltaVelocity: null,
      isRealTradeFlow: false,
      status: 'UNAVAILABLE'
    };
  }

  // Return unavailable status when real trade flow is not injected
  return {
    cvdDelta: null,
    cvdDeltaUsd: null,
    cvdDivergence: 'جریان واقعی سفارشات (CVD) نیازمند استعلام از فید تریدهای زنده است (UNAVAILABLE)',
    takerBuyVol: null,
    takerSellVol: null,
    takerRatio: null,
    takerDelta: null,
    delta: null,
    cumulativeDelta: null,
    deltaVelocity: null,
    isRealTradeFlow: false,
    status: 'UNAVAILABLE'
  };
}

// 6. Data Quality Governor: Assesses freshness, latency, and source reliability for all Futures feeds (Item 35)
export function evaluateMarketDataQuality(
  candleResult: FetchCandlesResult,
  orderBookResult: RealOrderBookImbalance,
  derivResult: DerivativesData,
  fngResult: FearAndGreed,
  futuresPricesResult?: FuturesPrices
): DataQualityReport {
  const now = Date.now();
  const reasonsFa: string[] = [];
  let isVitalFeatureStale = false;

  // 1. Futures Ticker Prices Quality Check (Last Price, Mark Price, Index Price)
  const fpAgeMs = futuresPricesResult ? (futuresPricesResult.ageMs ?? (now - futuresPricesResult.timestampUtc)) : 0;
  const fpLatency = futuresPricesResult?.latencyMs || 0;
  let fpScore = 100;
  let fpStatus: FeedStatus = futuresPricesResult?.status || 'LIVE';

  if (
    !futuresPricesResult ||
    futuresPricesResult.status !== 'LIVE' ||
    ![futuresPricesResult.lastPrice, futuresPricesResult.markPrice, futuresPricesResult.indexPrice]
      .every(value => Number.isFinite(value) && value > 0)
  ) {
    fpScore = 0;
    fpStatus = 'UNAVAILABLE';
    isVitalFeatureStale = true;
    reasonsFa.push('🛑 قیمت‌های زنده فیوچرز (Futures Last/Mark Price) قطع می‌باشند -> معامله مسدود شد');
  } else if (fpAgeMs < 0 || fpAgeMs > 5000 || fpStatus !== 'LIVE') {
    fpScore = 40;
    fpStatus = 'STALE';
    isVitalFeatureStale = true;
    reasonsFa.push(`🛑 قیمت فیوچرز کهنه است (سن: ${Math.round(fpAgeMs / 1000)}s - حداکثر مجاز: 5s) -> معامله مسدود شد`);
  }

  // 2. Futures Candles Quality Check (Weight: 30%)
  const candleAgeMs = candleResult.ageMs ?? (now - (candleResult.timestamp || now));
  const candleLatency = candleResult.latencyMs || 0;
  let candleScore = 100;
  let candleStatus: FeedStatus = candleResult.status === 'LIVE' ? 'LIVE' : candleResult.status === 'STALE' ? 'STALE' : 'UNAVAILABLE';

  if (candleResult.status === 'DATA_UNAVAILABLE' || candleResult.candles.length < 20) {
    candleScore = 0;
    candleStatus = 'UNAVAILABLE';
    isVitalFeatureStale = true;
    reasonsFa.push('🛑 کندل‌های فیوچرز ناموجود یا قطع می‌باشند (توقف کامل معامله)');
  } else if (candleAgeMs > 30000 || candleStatus === 'STALE') {
    candleScore = 50;
    candleStatus = 'STALE';
    isVitalFeatureStale = true;
    reasonsFa.push(`🛑 کندل‌های فیوچرز کهنه می‌باشند (سن: ${Math.round(candleAgeMs / 1000)}s - حداکثر مجاز: 30s)`);
  }

  // 3. Futures Order Book L2 Depth Check (Weight: 25%) (Item 32 & 35)
  const obAgeMs = orderBookResult.ageMs ?? (now - (orderBookResult.timestamp || now));
  const obLatency = orderBookResult.latencyMs || 0;
  let obScore = 100;
  let obStatus: FeedStatus = orderBookResult.status;

  if (orderBookResult.status === 'UNAVAILABLE' || orderBookResult.obi === null) {
    obScore = 0;
    obStatus = 'UNAVAILABLE';
    isVitalFeatureStale = true;
    reasonsFa.push('🛑 دفتر سفارشات فیوچرز (Futures OrderBook L2) در دسترس نیست');
  } else if (obAgeMs > 10000 || obStatus === 'STALE') {
    obScore = 40;
    obStatus = 'STALE';
    isVitalFeatureStale = true;
    reasonsFa.push(`🛑 عمق دفتر سفارشات فیوچرز کهنه است (سن: ${Math.round(obAgeMs / 1000)}s - حداکثر مجاز: 10s) -> معامله مسدود شد`);
  }

  // 4. Futures Derivatives / Funding & Open Interest Check (Weight: 25%) (Item 34 & 35)
  const derivAgeMs = derivResult.ageMs ?? 0;
  let derivScore = 100;
  let derivStatus: FeedStatus = derivResult.status || 'LIVE';
  if (derivResult.status === 'UNAVAILABLE' || derivResult.funding === null || derivResult.oi === null) {
    derivScore = 0;
    derivStatus = 'UNAVAILABLE';
    isVitalFeatureStale = true;
    reasonsFa.push('🛑 نرخ فاندینگ و سود باز (Funding/OI) فیوچرز قطع است -> معامله مسدود شد');
  } else if (derivAgeMs > 60000) {
    derivScore = 40;
    derivStatus = 'STALE';
    isVitalFeatureStale = true;
    reasonsFa.push(`🛑 نرخ فاندینگ و سود باز کهنه است (سن: ${Math.round(derivAgeMs / 1000)}s) -> معامله مسدود شد`);
  }

  // 5. Sentiment / Macro Check (Weight: 20%)
  let sentimentScore = 100;
  let sentimentStatus: FeedStatus = fngResult.status || 'LIVE';
  if (fngResult.status === 'UNAVAILABLE') {
    sentimentScore = 40;
    sentimentStatus = 'UNAVAILABLE';
  }

  // Overall Score Calculation (0 - 100)
  const overallScore = Math.round(
    (fpScore * 0.25) +
    (candleScore * 0.25) + 
    (obScore * 0.25) + 
    (derivScore * 0.15) + 
    (sentimentScore * 0.10)
  );

  // STRICT CIRCUIT BREAKER (Item 35): If ANY vital feature is stale or unavailable, isTradeAllowed MUST BE FALSE!
  const isTradeAllowed = !isVitalFeatureStale && overallScore >= 70 && candleStatus === 'LIVE' && obStatus === 'LIVE';
  const finalStatus: 'LIVE' | 'STALE' | 'DATA_UNAVAILABLE' = 
    (candleStatus === 'UNAVAILABLE' || fpStatus === 'UNAVAILABLE') ? 'DATA_UNAVAILABLE' :
    (isVitalFeatureStale || overallScore < 70) ? 'STALE' : 'LIVE';

  return {
    overallScore,
    isTradeAllowed,
    status: finalStatus,
    reasonsFa: reasonsFa.length > 0 ? reasonsFa : ['تمام فیدهای زنده بازار فیوچرز (Prices/OrderBook/Funding/OI) معتبر و بدون تاخیر تایید شدند'],
    feeds: {
      candles: {
        feedName: 'Futures Candles 15m Feed',
        source: candleResult.source,
        status: candleStatus,
        timestamp: candleResult.timestamp || now,
        ageMs: candleAgeMs,
        latencyMs: candleLatency,
        score: candleScore,
        detailsFa: `تعداد کندل: ${candleResult.candles.length} | وضعیت: ${candleStatus}`
      },
      orderBook: {
        feedName: 'Futures Order Book (Real OBI)',
        source: orderBookResult.source,
        status: obStatus,
        timestamp: orderBookResult.timestamp,
        ageMs: obAgeMs,
        latencyMs: obLatency,
        score: obScore,
        detailsFa: orderBookResult.obi !== null ? `OBI فیوچرز: ${(orderBookResult.obi * 100).toFixed(1)}% | سطوح: ${orderBookResult.levelsCount}` : 'دفتر سفارشات غیرفعال'
      },
      derivatives: {
        feedName: 'Futures Derivatives & Funding',
        source: derivResult.source || 'Freqtrade futures funding',
        status: derivStatus,
        timestamp: derivResult.timestampUtc || now,
        ageMs: derivAgeMs,
        latencyMs: derivResult.latencyMs || 0,
        score: derivScore,
        detailsFa: derivStatus === 'LIVE' ? `Funding: ${(derivResult.funding || 0).toFixed(4)}% | OI: ${derivResult.oi || 0}` : 'فاندینگ غیرفعال'
      },
      futuresPrices: {
        feedName: 'Futures Prices (Last/Mark/Index)',
        source: futuresPricesResult?.source || 'Freqtrade futures ticker',
        status: fpStatus,
        timestamp: futuresPricesResult?.timestampUtc || now,
        ageMs: fpAgeMs,
        latencyMs: fpLatency,
        score: fpScore,
        detailsFa: fpStatus === 'LIVE'
          ? `Last: $${futuresPricesResult?.lastPrice.toFixed(1)} | Mark: $${futuresPricesResult?.markPrice.toFixed(1)} | Index: $${futuresPricesResult?.indexPrice.toFixed(1)} | ${futuresPricesResult?.timestampSource === 'FREQTRADE_RECEIVED' ? 'زمان دریافت Freqtrade؛ timestamp رویداد صرافی ناموجود' : 'زمان رویداد صرافی'}`
          : 'قیمت زنده غیرفعال'
      },
      sentiment: {
        feedName: 'Fear & Greed Index',
        source: 'Alternative.me',
        status: sentimentStatus,
        timestamp: now,
        ageMs: 0,
        latencyMs: 0,
        score: sentimentScore,
        detailsFa: `مقدار: ${fngResult.value} (${fngResult.sent})`
      }
    }
  };
}

// Canonical view currently reports only the configured Freqtrade market; cross-venue
// spread and latency remain unavailable until separate Freqtrade instances are aggregated.
export async function getCanonicalMarketSnapshot(): Promise<CanonicalMarketSnapshot> {
  const now = Date.now();
  const feeds: CanonicalExchangeFeed[] = [];
  const feedStatuses: Record<string, FeedStatus> = {};
  let primaryIndexPrice: number | null = null;
  try {
    const snapshot = await getFreqtradeMarketSnapshot();
    if (!snapshot.pair.startsWith('BTC/USDT')) {
      throw new Error(`Canonical BTC market data requires a BTC/USDT Freqtrade pair, received ${snapshot.pair}.`);
    }
    const ticker = snapshot.ticker;
    if (!ticker) throw new Error('Freqtrade DataProvider ticker is unavailable.');
    const ageMs = now - ticker.retrievedAtMs;
    const status: FeedStatus = ageMs >= 0 && ageMs <= FREQTRADE_TICKER_MAX_AGE_MS ? 'LIVE' : 'STALE';
    const timestampUtc = ticker.exchangeTimestampMs ?? ticker.retrievedAtMs;
    const spreadUsd = ticker.bid !== null && ticker.ask !== null ? ticker.ask - ticker.bid : undefined;
    const marketType = snapshot.market === 'futures' ? 'PERPETUAL_FUTURES' : 'SPOT';
    const exchangeNames: Record<string, CanonicalExchangeFeed['exchange']> = {
      BYBIT: 'BYBIT',
      KUCOIN: 'KUCOIN',
      BINANCE: 'BINANCE',
      COINBASE: 'COINBASE',
      OKX: 'OKX',
    };
    const exchange = exchangeNames[snapshot.exchange.toUpperCase()];
    if (!exchange) {
      throw new Error(`Freqtrade exchange ${snapshot.exchange} is not supported by the canonical market feed contract.`);
    }
    feeds.push({
      exchange,
      marketType,
      symbol: snapshot.pair,
      contract: snapshot.market === 'futures' ? snapshot.pair : undefined,
      timestampUtc,
      exchangeTimestampUtc: ticker.exchangeTimestampMs,
      timestampSource: ticker.exchangeTimestampMs === null ? 'FREQTRADE_RECEIVED' : 'EXCHANGE',
      isoTimeUtc: new Date(timestampUtc).toISOString(),
      lastPrice: ticker.last,
      bestBid: ticker.bid ?? undefined,
      bestAsk: ticker.ask ?? undefined,
      spreadUsd,
      spreadBps: spreadUsd === undefined ? undefined : (spreadUsd / ticker.last) * 10_000,
      latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
      status,
    });
    primaryIndexPrice = ticker.indexPrice;
    feedStatuses[snapshot.exchange] = status;
    feedStatuses.CROSS_EXCHANGE = 'UNAVAILABLE';
  } catch (error) {
    console.warn('[Freqtrade market data] Canonical market data unavailable:', error instanceof Error ? error.message : String(error));
    feedStatuses.FREQTRADE = 'UNAVAILABLE';
    feedStatuses.CROSS_EXCHANGE = 'UNAVAILABLE';
  }
  const activeFeed = feeds[0];
  return {
    timestampUtc: activeFeed?.timestampUtc ?? now,
    isoTimeUtc: activeFeed?.isoTimeUtc ?? new Date(now).toISOString(),
    symbol: 'BTC/USDT',
    primaryIndexPrice,
    basisSpreadUsd: null,
    basisSpreadBps: null,
    crossExchangeSpreadUsd: null,
    crossExchangeLatencyMs: null,
    overallQualityScore: activeFeed?.status === 'LIVE' ? 100 : 0,
    feedStatuses,
    feeds,
  };
}

// Fetch additional timeframes from the same Freqtrade DataProvider snapshot.
export async function fetchHtf(): Promise<Record<string, Candle[]>> {
  const result: Record<string, Candle[]> = {};
  try {
    const snapshot = await getFreqtradeMarketSnapshot();
    for (const timeframe of ['1m', '5m', '1h', '4h']) {
      const rows = snapshot.additionalCandles[timeframe];
      if (rows?.length) {
        result[`Freqtrade ${timeframe}`] = rows.map((row) => [row.open, row.high, row.low, row.close, row.volume]);
      }
    }
  } catch (error) {
    console.warn('[Freqtrade market data] Additional timeframes unavailable:', error instanceof Error ? error.message : String(error));
  }
  return result;
}
