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

// 1. Fetch candles from Bybit Linear Futures Market (Item 31)
export async function fetchBybit(interval = '15', limit = 150): Promise<BybitCandlesResult> {
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
  interface BybitResp {
    result?: {
      list?: string[][];
    };
  }
  const { data, latencyMs } = await safeFetchJson<BybitResp>(url);
  const receivedTimestampMs = Date.now();
  if (!data?.result?.list || data.result.list.length < 20) {
    throw new Error('Invalid Bybit Futures data');
  }
  // Bybit returns list descending: [startTime, open, high, low, close, volume, turnover]
  const reversed = [...data.result.list].reverse();
  const candles: Candle[] = reversed.map(item => [
    parseFloat(item[1]),
    parseFloat(item[2]),
    parseFloat(item[3]),
    parseFloat(item[4]),
    parseFloat(item[5]),
  ]);
  if (!candles.every(isValidMarketCandle)) {
    throw new Error('Bybit returned invalid futures candles');
  }

  const lastRaw = reversed[reversed.length - 1];
  const sourceStartTimeMs = parseInt(lastRaw[0], 10);
  const intervalMinutes = parseInt(interval, 10) || 15;
  const sourceCloseTimeMs = sourceStartTimeMs + (intervalMinutes * 60 * 1000);

  return {
    candles,
    latencyMs,
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

// Fetch Futures Ticker Prices (Last Price for Entry, Mark Price for Stop/Liquidation, Index Price for Benchmark) (Item 31 & 33)
export async function fetchFuturesPrices(forceRefresh = false): Promise<FuturesPrices> {
  const cacheKey = 'futures_prices_bybit';
  const cached = forceRefresh ? null : getCached<FuturesPrices>(cacheKey, 3000);
  const now = Date.now();
  if (
    cached &&
    Number.isFinite(cached.lastPrice) && cached.lastPrice > 0 &&
    Number.isFinite(cached.markPrice) && cached.markPrice > 0 &&
    Number.isFinite(cached.indexPrice) && cached.indexPrice > 0
  ) {
    const ageMs = now - cached.timestampUtc;
    return {
      ...cached,
      ageMs,
      status: ageMs < 0 || ageMs > 3000 || cached.status !== 'LIVE' ? 'STALE' : 'LIVE'
    };
  }

  try {
    interface BybitTickerResp {
      result?: {
        list?: Array<{
          lastPrice?: string;
          markPrice?: string;
          indexPrice?: string;
        }>;
      };
    }
    const url = 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT';
    const { data, latencyMs } = await safeFetchJson<BybitTickerResp>(url, 3000);
    const item = data?.result?.list?.[0];
    if (item?.lastPrice && item.markPrice && item.indexPrice) {
      const lastPrice = parseFloat(item.lastPrice);
      const markPrice = parseFloat(item.markPrice);
      const indexPrice = parseFloat(item.indexPrice);

      if (![lastPrice, markPrice, indexPrice].every(value => Number.isFinite(value) && value > 0)) {
        throw new Error('Bybit returned invalid live futures prices');
      }

      const result: FuturesPrices = {
        lastPrice,   // Used for Entry Execution & Order Fill
        markPrice,   // Used for Stop Loss Trigger, Liquidation Engine & Risk Evaluation
        indexPrice,  // Spot Underlying Index Benchmark
        timestampUtc: Date.now(),
        isoTimeUtc: new Date().toISOString(),
        ageMs: Date.now() - now,
        latencyMs,
        source: 'Bybit Linear Futures Ticker (BTCUSDT)',
        status: 'LIVE'
      };
      dataProvenanceLayerService.registerAndAuditFeedProvenance({
        feedKey: 'TICKER_FUTURES',
        source: 'Bybit Linear Futures Ticker (BTCUSDT)',
        exchange: 'BYBIT',
        symbol: 'BTCUSDT',
        marketType: 'LINEAR_PERPETUAL',
        timeframe: 'TICK',
        sourceTimestampMs: result.timestampUtc,
        receivedTimestampMs: Date.now(),
        networkLatencyMs: latencyMs,
        rawPriceValues: {
          lastPrice,
          markPrice,
          indexPrice,
        },
      });
      setCache(cacheKey, result);
      return result;
    }
  } catch {
    // ignore
  }

  dataProvenanceLayerService.registerAndAuditFeedProvenance({
    feedKey: 'TICKER_FUTURES',
    source: 'DATA_UNAVAILABLE',
    exchange: 'BYBIT',
    symbol: 'BTCUSDT',
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

// 2. Fetch candles from KuCoin Linear Futures (Secondary Fallback) (Item 31)
export async function fetchKucoin(type = '15min'): Promise<KucoinCandlesResult> {
  // KuCoin Futures kline query for XBTUSDTM
  const granularityMap: Record<string, number> = { '1min': 1, '5min': 5, '15min': 15, '1hour': 60, '4hour': 240 };
  const gran = granularityMap[type] || 15;
  const url = `https://api-futures.kucoin.com/api/v1/kline/query?symbol=XBTUSDTM&granularity=${gran}`;
  interface KucoinFuturesResp {
    data?: number[][];
  }
  try {
    const { data, latencyMs } = await safeFetchJson<KucoinFuturesResp>(url);
    const receivedTimestampMs = Date.now();
    if (data?.data && data.data.length >= 20) {
      // KuCoin Futures returns: [time, open, high, low, close, volume]
      const reversed = [...data.data].reverse();
      const candles: Candle[] = reversed.map(item => [
        item[1], // open
        item[2], // high
        item[3], // low
        item[4], // close
        item[5], // volume
      ]);
      if (!candles.every(isValidMarketCandle)) {
        throw new Error('KuCoin returned invalid futures candles');
      }

      const lastRaw = reversed[reversed.length - 1];
      // KuCoin time is in seconds or milliseconds
      const rawTime = lastRaw[0];
      const sourceStartTimeMs = rawTime < 1e11 ? rawTime * 1000 : rawTime;
      const sourceCloseTimeMs = sourceStartTimeMs + (gran * 60 * 1000);

      return {
        candles,
        latencyMs,
        sourceStartTimeMs,
        sourceCloseTimeMs,
        receivedTimestampMs,
      };
    }
  } catch {
    // Fallback if KuCoin futures API endpoint fails
  }
  throw new Error('Invalid KuCoin Futures data');
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
    reasonFa: '✅ تمامی داده‌های بازار از فیدهای مستقیم و اصیل صرافی (Bybit Futures) تایید شدند.',
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
let lastKnownLiveCandles: FetchCandlesResult | null = null;

export function isLiveMarketDataActive(): boolean {
  return isCurrentMarketDataLive;
}

// Fetch 15m Candles from Primary Futures Feed (Bybit Linear Futures BTCUSDT)
// KuCoin Spot is strictly excluded as a direct fallback for prediction.
export async function fetchCandles(forceRefresh = false): Promise<FetchCandlesResult> {
  const cacheKey = 'candles_15m_futures';
  const now = Date.now();

  if (!forceRefresh) {
    const cached = getCached<FetchCandlesResult>(cacheKey, 15000); // 15s fresh TTL
    if (cached) {
      const ageMs = now - (cached.timestamp || now);
      const status = ageMs > 15000 || cached.status !== 'LIVE' ? 'STALE' : 'LIVE';
      isCurrentMarketDataLive = status === 'LIVE';
      return {
        ...cached,
        ageMs,
        status
      };
    }
  }

  // Attempt Primary Futures Feed: Bybit Linear Futures (BTCUSDT)
  try {
    const bybitRes = await fetchBybit('15', 150);
    const rawCandles = bybitRes.candles;
    if (rawCandles.length >= 50) {
      isCurrentMarketDataLive = true;
      dataProvenanceLayerService.registerAndAuditFeedProvenance({
        feedKey: 'CANDLES_PRIMARY',
        source: 'Bybit Linear Futures BTCUSDT (Primary)',
        exchange: 'BYBIT',
        symbol: 'BTCUSDT',
        marketType: 'LINEAR_PERPETUAL',
        timeframe: '15m',
        sourceTimestampMs: bybitRes.sourceStartTimeMs,
        receivedTimestampMs: bybitRes.receivedTimestampMs,
        networkLatencyMs: bybitRes.latencyMs,
        candles: rawCandles,
      });
      const result: FetchCandlesResult = {
        candles: rawCandles, // Raw candles preserved for exact liquidity sweeps & wicks
        rawCandles,
        source: 'Bybit Linear Futures BTCUSDT (Primary)',
        status: 'LIVE',
        timestamp: bybitRes.sourceStartTimeMs,
        candleStartTimeMs: bybitRes.sourceStartTimeMs,
        candleCloseTimeMs: bybitRes.sourceCloseTimeMs,
        receivedTimestampMs: bybitRes.receivedTimestampMs,
        lastUpdateTimestampMs: now,
        ageMs: Math.max(0, now - bybitRes.sourceStartTimeMs),
        latencyMs: bybitRes.latencyMs,
      };
      setCache(cacheKey, result);
      lastKnownLiveCandles = result;
      return result;
    }
  } catch {
    // Primary feed failed
  }

  // Attempt Secondary Futures Feed: KuCoin Linear Futures (XBTUSDTM) - Same Contract Type ONLY
  try {
    const kucoinRes = await fetchKucoin('15min');
    const rawCandles = kucoinRes.candles;
    if (rawCandles.length >= 50) {
      isCurrentMarketDataLive = true;
      const compatCheck = dataProvenanceLayerService.verifyFallbackCompatibility(
        { exchange: 'BYBIT', symbol: 'BTCUSDT', marketType: 'LINEAR_PERPETUAL', timeframe: '15m' },
        { exchange: 'KUCOIN', symbol: 'XBTUSDTM', marketType: 'LINEAR_PERPETUAL', timeframe: '15m' }
      );
      if (compatCheck.isCompatible) {
        dataProvenanceLayerService.registerAndAuditFeedProvenance({
          feedKey: 'CANDLES_FALLBACK',
          source: 'KuCoin Linear Futures XBTUSDTM (Secondary Futures Fallback)',
          exchange: 'KUCOIN',
          symbol: 'BTCUSDT',
          marketType: 'LINEAR_PERPETUAL',
          timeframe: '15m',
          sourceTimestampMs: kucoinRes.sourceStartTimeMs,
          receivedTimestampMs: kucoinRes.receivedTimestampMs,
          networkLatencyMs: kucoinRes.latencyMs,
          candles: rawCandles,
        });
      }
      const result: FetchCandlesResult = {
        candles: rawCandles,
        rawCandles,
        source: 'KuCoin Linear Futures XBTUSDTM (Secondary Futures Fallback)',
        status: 'LIVE',
        timestamp: kucoinRes.sourceStartTimeMs,
        candleStartTimeMs: kucoinRes.sourceStartTimeMs,
        candleCloseTimeMs: kucoinRes.sourceCloseTimeMs,
        receivedTimestampMs: kucoinRes.receivedTimestampMs,
        lastUpdateTimestampMs: now,
        ageMs: Math.max(0, now - kucoinRes.sourceStartTimeMs),
        latencyMs: kucoinRes.latencyMs,
      };
      setCache(cacheKey, result);
      lastKnownLiveCandles = result;
      return result;
    }
  } catch {
    // Secondary futures feed failed
  }

  // Check if last known real futures data can serve as a short-lived STALE fallback (max 120 seconds)
  if (lastKnownLiveCandles && (now - (lastKnownLiveCandles.timestamp || 0)) <= 120000) {
    isCurrentMarketDataLive = false;
    const ageMs = now - (lastKnownLiveCandles.timestamp || 0);
    return {
      ...lastKnownLiveCandles,
      status: 'STALE',
      ageMs,
      source: `${lastKnownLiveCandles.source} [STALE - ${Math.round(ageMs / 1000)}s ago]`
    };
  }

  // STRICT SAFETY:
  // If real futures feeds are unavailable, NEVER use Spot data or fake synthetic candles.
  // Strictly report DATA_UNAVAILABLE for prediction core!
  isCurrentMarketDataLive = false;
  dataProvenanceLayerService.registerAndAuditFeedProvenance({
    feedKey: 'CANDLES_PRIMARY',
    source: 'DATA_UNAVAILABLE (Bybit/KuCoin Linear Futures Unreachable)',
    exchange: 'BYBIT',
    symbol: 'BTCUSDT',
    marketType: 'LINEAR_PERPETUAL',
    timeframe: '15m',
    customStatus: 'UNAVAILABLE',
    candles: [],
  });
  const unavailableResult: FetchCandlesResult = {
    candles: [],
    rawCandles: [],
    source: 'DATA_UNAVAILABLE (Bybit/KuCoin Linear Futures Unreachable)',
    status: 'DATA_UNAVAILABLE',
    timestamp: now,
    ageMs: Infinity,
    latencyMs: 0
  };
  return unavailableResult;
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
  const cacheKey = 'derivatives_futures';
  const cached = getCached<DerivativesData>(cacheKey, 15000);
  const now = Date.now();
  if (cached) {
    const ageMs = now - (cached.timestampUtc || now);
    return {
      ...cached,
      ageMs,
      status: ageMs > 60000 ? 'STALE' : cached.status
    };
  }

  try {
    interface BybitTickerResp {
      result?: {
        list?: Array<{ fundingRate?: string; openInterest?: string }>;
      };
    }
    const url = 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT';
    const histUrl = 'https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=3';

    const [tickerData, histData] = await Promise.allSettled([
      safeFetchJson<BybitTickerResp>(url, 4000),
      safeFetchJson<any>(histUrl, 3000),
    ]);

    const item = tickerData.status === 'fulfilled' ? tickerData.value?.data?.result?.list?.[0] : null;
    const latencyMs = tickerData.status === 'fulfilled' ? tickerData.value?.latencyMs || 0 : 0;

    if (item && item.fundingRate) {
      const currentFunding = parseFloat(item.fundingRate || '0.0') * 100.0;
      const oi = parseFloat(item.openInterest || '0');

      let historyArr: number[] = [currentFunding];
      if (histData.status === 'fulfilled' && histData.value?.data?.result?.list?.length > 0) {
        const rates = histData.value.data.result.list
          .map((x: any) => parseFloat(x.fundingRate || '0.0') * 100.0)
          .reverse();
        if (rates.length >= 2) {
          historyArr = [...rates.slice(-2), currentFunding];
        }
      }

      let trend: 'RISING' | 'FALLING' | 'STABLE' = 'STABLE';
      if (historyArr.length >= 3) {
        const [p1, p2, p3] = historyArr.slice(-3);
        if (p3 > p2 && p2 >= p1 && p3 - p1 > 0.005) {
          trend = 'RISING';
        } else if (p3 < p2 && p2 <= p1 && p1 - p3 > 0.005) {
          trend = 'FALLING';
        }
      }

      const res: DerivativesData = {
        funding: currentFunding,
        oi,
        fundingHistory: historyArr,
        fundingTrend: trend,
        status: 'LIVE',
        timestampUtc: now,
        isoTimeUtc: new Date(now).toISOString(),
        ageMs: 0,
        latencyMs,
        source: 'Bybit Linear Futures Derivatives'
      };
      setCache(cacheKey, res);
      return res;
    }
  } catch {
    // ignore
  }

  const fallback: DerivativesData = {
    funding: null,
    oi: null,
    fundingHistory: [],
    fundingTrend: 'STABLE',
    status: 'UNAVAILABLE',
    timestampUtc: now,
    isoTimeUtc: new Date(now).toISOString(),
    ageMs: Infinity,
    latencyMs: 0,
    source: 'DATA_UNAVAILABLE'
  };
  setCache(cacheKey, fallback);
  return fallback;
}

// Track previous orderbook snapshots for velocity, acceleration, and persistence dynamics (Item 12)
let prevObiHistory: Array<{
  timestamp: number;
  obi: number;
  bidDepth: number;
  askDepth: number;
  bestBid: number;
  bestAsk: number;
  bidWallPrice: number;
  bidWallUsd: number;
  askWallPrice: number;
  askWallUsd: number;
}> = [];

// 4. Real Order Book Imbalance (OBI) & Dynamics derived strictly from Bybit Linear Futures L2 OrderBook (Item 12 & 32)
export async function fetchRealOrderBookImbalance(): Promise<RealOrderBookImbalance> {
  const cacheKey = 'real_futures_orderbook_imbalance';
  const cached = getCached<RealOrderBookImbalance>(cacheKey, 3000);
  const now = Date.now();
  if (cached) {
    const ageMs = now - cached.timestamp;
    return {
      ...cached,
      ageMs,
      snapshotAgeMs: ageMs,
      status: ageMs > 10000 ? 'STALE' : cached.status
    };
  }

  try {
    interface BybitOrderbookResp {
      result?: {
        ts?: number;
        b?: string[][]; // [price, size]
        a?: string[][]; // [price, size]
      };
    }
    const url = 'https://api.bybit.com/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=50';
    const { data, latencyMs } = await safeFetchJson<BybitOrderbookResp>(url, 4000);
    if (data?.result?.b && data?.result?.a && data.result.b.length > 0 && data.result.a.length > 0) {
      const hasValidLevels = [...data.result.b, ...data.result.a].every((row) => {
        const price = parseFloat(row[0]);
        const size = parseFloat(row[1]);
        return Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0;
      });
      if (!hasValidLevels) {
        throw new Error('Live order-book payload contains an invalid level.');
      }
      // Calculate true L2 depth in USD for top 25 levels
      const topLevels = 25;
      const bids = data.result.b.slice(0, topLevels);
      const asks = data.result.a.slice(0, topLevels);
      
      const bidDepthUsd = bids.reduce((acc, row) => acc + (parseFloat(row[0]) * parseFloat(row[1])), 0);
      const askDepthUsd = asks.reduce((acc, row) => acc + (parseFloat(row[0]) * parseFloat(row[1])), 0);
      const totalDepth = bidDepthUsd + askDepthUsd;

      // Tiered depth analysis by distance (Item 12)
      const nearBids = bids.slice(0, 5).reduce((acc, r) => acc + parseFloat(r[0]) * parseFloat(r[1]), 0);
      const nearAsks = asks.slice(0, 5).reduce((acc, r) => acc + parseFloat(r[0]) * parseFloat(r[1]), 0);
      const midBids = bids.slice(5, 15).reduce((acc, r) => acc + parseFloat(r[0]) * parseFloat(r[1]), 0);
      const midAsks = asks.slice(5, 15).reduce((acc, r) => acc + parseFloat(r[0]) * parseFloat(r[1]), 0);
      const farBids = bids.slice(15, 25).reduce((acc, r) => acc + parseFloat(r[0]) * parseFloat(r[1]), 0);
      const farAsks = asks.slice(15, 25).reduce((acc, r) => acc + parseFloat(r[0]) * parseFloat(r[1]), 0);

      const nearImbalance = (nearBids + nearAsks) > 0 ? (nearBids - nearAsks) / (nearBids + nearAsks) : 0;
      const midImbalance = (midBids + midAsks) > 0 ? (midBids - midAsks) / (midBids + midAsks) : 0;
      const farImbalance = (farBids + farAsks) > 0 ? (farBids - farAsks) / (farBids + farAsks) : 0;

      const bestBid = parseFloat(bids[0][0]);
      const bestAsk = parseFloat(asks[0][0]);
      const currentSpread = bestAsk - bestBid;
      const largestWall = (rows: string[][]): { price: number; notionalUsd: number } =>
        rows.reduce((wall, row) => {
          const price = parseFloat(row[0]);
          const notionalUsd = price * parseFloat(row[1]);
          return notionalUsd > wall.notionalUsd ? { price, notionalUsd } : wall;
        }, { price: 0, notionalUsd: 0 });
      const bidWall = largestWall(bids);
      const askWall = largestWall(asks);

      if (totalDepth > 0) {
        const currentObi = (bidDepthUsd - askDepthUsd) / totalDepth;
        const ts = data.result.ts || now;
        if (!Number.isFinite(ts) || ts <= 0 || ts > now) {
          throw new Error('Live order-book timestamp is invalid or in the future.');
        }
        if (!Number.isFinite(currentSpread) || currentSpread < 0) {
          throw new Error('Live order-book spread is invalid.');
        }
        const snapshotAgeMs = now - ts;

        // Calculate OBI Velocity & Acceleration from historical snapshots (Item 12)
        let obiVelocity: number | null = null;
        let obiAcceleration: number | null = null;
        let bidWallPersistence: number | null = null;
        let askWallPersistence: number | null = null;
        let wallCancellationRatio: number | null = null;
        let absorptionRate: number | null = null;
        let liquidityInflowUsd: number | null = null;
        let liquidityWithdrawalUsd: number | null = null;
        let spreadCompressionUsd: number | null = null;
        let spreadExpansionUsd: number | null = null;
        let spoofingSuspicion: boolean | null = null;
        let wallCancellationObserved: boolean | null = null;
        let spreadChange: number | null = null;
        let liquidityMigration: 'TOWARD_INSIDE' | 'TOWARD_OUTSIDE' | 'STABLE' | 'UNKNOWN' = 'UNKNOWN';

        if (prevObiHistory.length > 0) {
          const lastSnap = prevObiHistory[prevObiHistory.length - 1];
          const dtSec = Math.max(0.5, (ts - lastSnap.timestamp) / 1000);
          obiVelocity = (currentObi - lastSnap.obi) / dtSec;
          spreadChange = currentSpread - (lastSnap.bestAsk - lastSnap.bestBid);
          spreadCompressionUsd = Math.max(0, -spreadChange);
          spreadExpansionUsd = Math.max(0, spreadChange);
          const bidDepthDelta = bidDepthUsd - lastSnap.bidDepth;
          const askDepthDelta = askDepthUsd - lastSnap.askDepth;
          liquidityInflowUsd = Math.max(0, bidDepthDelta) + Math.max(0, askDepthDelta);
          liquidityWithdrawalUsd = Math.max(0, -bidDepthDelta) + Math.max(0, -askDepthDelta);
          wallCancellationRatio = Math.min(
            1,
            liquidityWithdrawalUsd / Math.max(1, lastSnap.bidDepth + lastSnap.askDepth)
          );
          const bidWallStillPresent = Math.abs(bidWall.price - lastSnap.bidWallPrice) / Math.max(1, lastSnap.bidWallPrice) <= 0.001;
          const askWallStillPresent = Math.abs(askWall.price - lastSnap.askWallPrice) / Math.max(1, lastSnap.askWallPrice) <= 0.001;
          wallCancellationObserved = (lastSnap.bidWallUsd > 0 && !bidWallStillPresent) ||
            (lastSnap.askWallUsd > 0 && !askWallStillPresent);
          spoofingSuspicion = wallCancellationObserved && wallCancellationRatio >= 0.2;

          if (prevObiHistory.length > 1) {
            const prevSnap2 = prevObiHistory[prevObiHistory.length - 2];
            const dtSec2 = Math.max(0.5, (lastSnap.timestamp - prevSnap2.timestamp) / 1000);
            const prevVelocity = (lastSnap.obi - prevSnap2.obi) / dtSec2;
            obiAcceleration = (obiVelocity - prevVelocity) / dtSec;
          }

          const wallPersistence = (side: 'bid' | 'ask'): number | null => {
            const currentPrice = side === 'bid' ? bidWall.price : askWall.price;
            if (currentPrice <= 0) return null;
            let firstSeenTimestamp: number | null = null;
            for (let i = prevObiHistory.length - 1; i >= 0; i -= 1) {
              const snapshot = prevObiHistory[i];
              const priorWallPrice = side === 'bid' ? snapshot.bidWallPrice : snapshot.askWallPrice;
              if (priorWallPrice <= 0 ||
                Math.abs(currentPrice - priorWallPrice) / Math.max(1, priorWallPrice) > 0.001) break;
              firstSeenTimestamp = snapshot.timestamp;
            }
            return firstSeenTimestamp === null ? null : Math.max(0, ts - firstSeenTimestamp);
          };
          bidWallPersistence = wallPersistence('bid');
          askWallPersistence = wallPersistence('ask');

          // Liquidity migration
          if (Math.abs(nearImbalance) > Math.abs(farImbalance) + 0.2) {
            liquidityMigration = 'TOWARD_INSIDE';
          } else if (Math.abs(farImbalance) > Math.abs(nearImbalance) + 0.2) {
            liquidityMigration = 'TOWARD_OUTSIDE';
          } else {
            liquidityMigration = 'STABLE';
          }
        }

        prevObiHistory.push({
          timestamp: ts,
          obi: currentObi,
          bidDepth: bidDepthUsd,
          askDepth: askDepthUsd,
          bestBid,
          bestAsk,
          bidWallPrice: bidWall.price,
          bidWallUsd: bidWall.notionalUsd,
          askWallPrice: askWall.price,
          askWallUsd: askWall.notionalUsd
        });
        if (prevObiHistory.length > 20) prevObiHistory.shift();

        const result: RealOrderBookImbalance = {
          obi: Math.round(currentObi * 1000) / 1000,
          bidDepthUsd: Math.round(bidDepthUsd),
          askDepthUsd: Math.round(askDepthUsd),
          bestBid,
          bestAsk,
          spreadUsd: currentSpread,
          levelsCount: Math.min(data.result.b.length, topLevels),
          status: 'LIVE',
          timestamp: ts,
          ageMs: snapshotAgeMs,
          snapshotAgeMs,
          latencyMs,
          source: 'Bybit Linear Futures L2 OrderBook',
          obiVelocity: obiVelocity === null ? null : Math.round(obiVelocity * 10000) / 10000,
          obiAcceleration: obiAcceleration === null ? null : Math.round(obiAcceleration * 10000) / 10000,
          bidWallPersistence,
          askWallPersistence,
          wallCancellationRatio: wallCancellationRatio === null ? null : Math.round(wallCancellationRatio * 100) / 100,
          absorptionRate,
          liquidityInflowUsd,
          liquidityWithdrawalUsd,
          spreadCompressionUsd,
          spreadExpansionUsd,
          spoofingSuspicion,
          wallCancellationObserved,
          liquidityMigration,
          spreadChange: spreadChange === null ? null : Math.round(spreadChange * 100) / 100,
          depthImbalanceByDistance: {
            nearPct: Math.round(nearImbalance * 100),
            midPct: Math.round(midImbalance * 100),
            farPct: Math.round(farImbalance * 100)
          }
        };
        setCache(cacheKey, result);
        return result;
      }
    }
  } catch {
    // ignore
  }

  const unavailable: RealOrderBookImbalance = {
    obi: null,
    bidDepthUsd: 0,
    askDepthUsd: 0,
    levelsCount: 0,
    status: 'UNAVAILABLE',
    timestamp: now,
    ageMs: Infinity,
    snapshotAgeMs: Infinity,
    latencyMs: 0,
    source: 'DATA_UNAVAILABLE'
  };
  return unavailable;
}

// Fetch Order Book Imbalance (OBI) backward-compatible wrapper (returns null if unavailable, never masks with fake 0.0)
export async function fetchOrderBookImbalance(): Promise<number | null> {
  const res = await fetchRealOrderBookImbalance();
  return res.obi;
}

// 5. Real Taker Trade Flow / CVD Extractor (Item 11: Real Trade Flow from Market Takers)
export async function fetchRealTradeFlowCvd(): Promise<OrderFlowFeatures> {
  const cacheKey = 'real_futures_taker_trades_cvd';
  const cached = getCached<OrderFlowFeatures>(cacheKey, 3000);
  if (cached) return cached;

  try {
    interface BybitRecentTradeResp {
      result?: {
        list?: Array<{
          execId?: string;
          symbol?: string;
          price?: string;
          size?: string;
          side?: 'Buy' | 'Sell';
          time?: string;
          isBlockTrade?: boolean;
        }>;
      };
    }
    const url = 'https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=BTCUSDT&limit=200';
    const { data } = await safeFetchJson<BybitRecentTradeResp>(url, 4000);

    if (data?.result?.list && data.result.list.length > 0) {
      let takerBuyVol = 0;
      let takerSellVol = 0;
      let cumulativeDelta = 0;
      let cvdDeltaUsd = 0;
      const trades = data.result.list;

      const oldestTime = parseInt(trades[trades.length - 1].time || '0', 10);
      const newestTime = parseInt(trades[0].time || '0', 10);
      const timespanSec = Math.max(1, (newestTime - oldestTime) / 1000);
      const ageMs = Date.now() - newestTime;
      if (!Number.isFinite(newestTime) || newestTime <= 0 || ageMs < 0) {
        throw new Error('Live trade-flow timestamp is invalid or in the future.');
      }

      trades.forEach((t) => {
        const size = parseFloat(t.size || '0');
        const price = parseFloat(t.price || '0');
        if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0 ||
          (t.side !== 'Buy' && t.side !== 'Sell')) {
          throw new Error('Live trade-flow payload contains an invalid trade.');
        }
        if (t.side === 'Buy') {
          takerBuyVol += size;
          cumulativeDelta += size;
          cvdDeltaUsd += size * price;
        } else if (t.side === 'Sell') {
          takerSellVol += size;
          cumulativeDelta -= size;
          cvdDeltaUsd -= size * price;
        }
      });

      const totalVol = takerBuyVol + takerSellVol;
      const delta = takerBuyVol - takerSellVol;
      const deltaVelocity = delta / timespanSec;
      const takerRatio = totalVol > 0 ? takerBuyVol / totalVol : 0.5;

      const newestPrice = parseFloat(trades[0].price || '0');
      const oldestPrice = parseFloat(trades[trades.length - 1].price || '0');
      const priceDelta = newestPrice - oldestPrice;
      if (!Number.isFinite(newestPrice) || !Number.isFinite(oldestPrice) || oldestPrice <= 0) {
        throw new Error('Live trade-flow price progression is invalid.');
      }
      const tradePriceChangePct = (priceDelta / oldestPrice) * 100;

      let cvdDivergence = 'جریان خرید و فروش حقیقی متوازن است';
      if (priceDelta <= 0 && delta > 0) {
        cvdDivergence = 'واگرایی صعودی CVD: جذب سنگین تیکرهای خریدار توسط لیمیت‌سل‌ها (Bullish Absorption)';
      } else if (priceDelta >= 0 && delta < 0) {
        cvdDivergence = 'واگرایی نزولی CVD: توزیع تیکرهای فروشنده در قیمت بالا (Bearish Distribution)';
      }

      const res: OrderFlowFeatures = {
        cvdDelta: Math.round(cumulativeDelta * 100) / 100,
        cvdDeltaUsd: Math.round(cvdDeltaUsd * 100) / 100,
        cvdDivergence,
        takerBuyVol: Math.round(takerBuyVol * 100) / 100,
        takerSellVol: Math.round(takerSellVol * 100) / 100,
        takerRatio: Math.round(takerRatio * 1000) / 1000,
        takerDelta: Math.round(delta * 100) / 100,
        tradePriceChangePct: Math.round(tradePriceChangePct * 10000) / 10000,
        delta: Math.round(delta * 100) / 100,
        cumulativeDelta: Math.round(cumulativeDelta * 100) / 100,
        deltaVelocity: Math.round(deltaVelocity * 100) / 100,
        isRealTradeFlow: true,
        status: ageMs <= 5000 ? 'LIVE' : 'STALE',
        timestampUtc: newestTime,
        ageMs,
      };

      setCache(cacheKey, res);
      return res;
    }
  } catch {
    // ignore
  }

  // Item 11: If trade flow is unavailable, return UNAVAILABLE status and do not fake it!
  const unavailable: OrderFlowFeatures = {
    cvdDelta: null,
    cvdDeltaUsd: null,
    cvdDivergence: 'داده‌های جریان معاملات مارکت در دسترس نیست (UNAVAILABLE)',
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
  setCache(cacheKey, unavailable);
  return unavailable;
}

// 5. Distinct Orderflow Feature Extractor: Separates CVD and Taker Flow from L2 OBI
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
  if (derivResult.status === 'UNAVAILABLE' || derivResult.funding === null) {
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
        source: derivResult.source || 'Bybit Linear Perpetual',
        status: derivStatus,
        timestamp: derivResult.timestampUtc || now,
        ageMs: derivAgeMs,
        latencyMs: derivResult.latencyMs || 0,
        score: derivScore,
        detailsFa: derivStatus === 'LIVE' ? `Funding: ${(derivResult.funding || 0).toFixed(4)}% | OI: ${derivResult.oi || 0}` : 'فاندینگ غیرفعال'
      },
      futuresPrices: {
        feedName: 'Futures Prices (Last/Mark/Index)',
        source: futuresPricesResult?.source || 'Bybit Linear Futures Ticker',
        status: fpStatus,
        timestamp: futuresPricesResult?.timestampUtc || now,
        ageMs: fpAgeMs,
        latencyMs: fpLatency,
        score: fpScore,
        detailsFa: fpStatus === 'LIVE' ? `Last: $${futuresPricesResult?.lastPrice.toFixed(1)} | Mark: $${futuresPricesResult?.markPrice.toFixed(1)} | Index: $${futuresPricesResult?.indexPrice.toFixed(1)}` : 'قیمت زنده غیرفعال'
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

// 7. Canonical Market-Data Layer: Normalizes cross-exchange feeds, spreads, and contract specifications
export async function getCanonicalMarketSnapshot(): Promise<CanonicalMarketSnapshot> {
  const now = Date.now();
  const feeds: CanonicalExchangeFeed[] = [];

  // 1. Bybit Spot (Normalized)
  let bybitSpotPrice = 0;
  try {
    interface BybitTickerResp {
      result?: { list?: Array<{ lastPrice?: string; bid1Price?: string; ask1Price?: string; volume24h?: string }> };
    }
    const { data, latencyMs } = await safeFetchJson<BybitTickerResp>('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT', 3000);
    const item = data?.result?.list?.[0];
    if (item && item.lastPrice) {
      bybitSpotPrice = parseFloat(item.lastPrice);
      const bestBid = item.bid1Price ? parseFloat(item.bid1Price) : undefined;
      const bestAsk = item.ask1Price ? parseFloat(item.ask1Price) : undefined;
      const spreadUsd = (bestBid && bestAsk) ? bestAsk - bestBid : 0;
      feeds.push({
        exchange: 'BYBIT',
        marketType: 'SPOT',
        symbol: 'BTC/USDT',
        timestampUtc: now,
        isoTimeUtc: new Date(now).toISOString(),
        lastPrice: bybitSpotPrice,
        bestBid,
        bestAsk,
        spreadUsd: Math.round(spreadUsd * 100) / 100,
        spreadBps: bybitSpotPrice > 0 && spreadUsd ? Math.round((spreadUsd / bybitSpotPrice) * 10000 * 10) / 10 : 0,
        volume24hUsd: item.volume24h ? parseFloat(item.volume24h) * bybitSpotPrice : 0,
        latencyMs,
        status: 'LIVE'
      });
    }
  } catch {
    feeds.push({
      exchange: 'BYBIT',
      marketType: 'SPOT',
      symbol: 'BTC/USDT',
      timestampUtc: now,
      isoTimeUtc: new Date(now).toISOString(),
      lastPrice: 0,
      latencyMs: 0,
      status: 'UNAVAILABLE'
    });
  }

  // 2. KuCoin Spot (Normalized)
  let kucoinSpotPrice = 0;
  try {
    interface KucoinTickerResp {
      data?: { price?: string; bestBid?: string; bestAsk?: string; volValue?: string };
    }
    const { data, latencyMs } = await safeFetchJson<KucoinTickerResp>('https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT', 3000);
    if (data?.data?.price) {
      kucoinSpotPrice = parseFloat(data.data.price);
      const bestBid = data.data.bestBid ? parseFloat(data.data.bestBid) : undefined;
      const bestAsk = data.data.bestAsk ? parseFloat(data.data.bestAsk) : undefined;
      const spreadUsd = (bestBid && bestAsk) ? bestAsk - bestBid : 0;
      feeds.push({
        exchange: 'KUCOIN',
        marketType: 'SPOT',
        symbol: 'BTC/USDT',
        timestampUtc: now,
        isoTimeUtc: new Date(now).toISOString(),
        lastPrice: kucoinSpotPrice,
        bestBid,
        bestAsk,
        spreadUsd: Math.round(spreadUsd * 100) / 100,
        spreadBps: kucoinSpotPrice > 0 && spreadUsd ? Math.round((spreadUsd / kucoinSpotPrice) * 10000 * 10) / 10 : 0,
        volume24hUsd: data.data.volValue ? parseFloat(data.data.volValue) : 0,
        latencyMs,
        status: 'LIVE'
      });
    }
  } catch {
    feeds.push({
      exchange: 'KUCOIN',
      marketType: 'SPOT',
      symbol: 'BTC/USDT',
      timestampUtc: now,
      isoTimeUtc: new Date(now).toISOString(),
      lastPrice: 0,
      latencyMs: 0,
      status: 'UNAVAILABLE'
    });
  }

  // 3. Bybit Perpetual Linear (Normalized)
  let bybitPerpPrice = 0;
  try {
    interface BybitPerpTickerResp {
      result?: { list?: Array<{ lastPrice?: string; bid1Price?: string; ask1Price?: string; turnover24h?: string }> };
    }
    const { data, latencyMs } = await safeFetchJson<BybitPerpTickerResp>('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 3000);
    const item = data?.result?.list?.[0];
    if (item && item.lastPrice) {
      bybitPerpPrice = parseFloat(item.lastPrice);
      const bestBid = item.bid1Price ? parseFloat(item.bid1Price) : undefined;
      const bestAsk = item.ask1Price ? parseFloat(item.ask1Price) : undefined;
      const spreadUsd = (bestBid && bestAsk) ? bestAsk - bestBid : 0;
      feeds.push({
        exchange: 'BYBIT',
        marketType: 'PERPETUAL',
        symbol: 'BTC/USDT',
        timestampUtc: now,
        isoTimeUtc: new Date(now).toISOString(),
        lastPrice: bybitPerpPrice,
        bestBid,
        bestAsk,
        spreadUsd: Math.round(spreadUsd * 100) / 100,
        spreadBps: bybitPerpPrice > 0 && spreadUsd ? Math.round((spreadUsd / bybitPerpPrice) * 10000 * 10) / 10 : 0,
        volume24hUsd: item.turnover24h ? parseFloat(item.turnover24h) : 0,
        latencyMs,
        status: 'LIVE'
      });
    }
  } catch {
    feeds.push({
      exchange: 'BYBIT',
      marketType: 'PERPETUAL',
      symbol: 'BTC/USDT',
      timestampUtc: now,
      isoTimeUtc: new Date(now).toISOString(),
      lastPrice: 0,
      latencyMs: 0,
      status: 'UNAVAILABLE'
    });
  }

  // Normalized Benchmark Index Price across verified spot feeds
  const validSpotFeeds = feeds.filter(f => f.marketType === 'SPOT' && f.status === 'LIVE' && f.lastPrice > 0);
  const primaryIndexPrice = validSpotFeeds.length > 0
    ? validSpotFeeds.reduce((acc, f) => acc + f.lastPrice, 0) / validSpotFeeds.length
    : (bybitPerpPrice > 0 ? bybitPerpPrice : 0);

  // Spot vs Perpetual Basis Spread
  const basisSpreadUsd = (bybitPerpPrice > 0 && primaryIndexPrice > 0)
    ? Math.round((bybitPerpPrice - primaryIndexPrice) * 100) / 100
    : 0;
  const basisSpreadBps = primaryIndexPrice > 0
    ? Math.round((basisSpreadUsd / primaryIndexPrice) * 10000 * 10) / 10
    : 0;

  // Cross-Exchange Spot Price Divergence
  const crossExchangeSpreadUsd = (bybitSpotPrice > 0 && kucoinSpotPrice > 0)
    ? Math.round(Math.abs(bybitSpotPrice - kucoinSpotPrice) * 100) / 100
    : 0;

  const validFeeds = feeds.filter(f => f.status === 'LIVE');
  const avgLatency = validFeeds.length > 0
    ? Math.round(validFeeds.reduce((acc, f) => acc + f.latencyMs, 0) / validFeeds.length)
    : 0;

  const feedStatuses: Record<string, FeedStatus> = {};
  feeds.forEach(f => {
    feedStatuses[`${f.exchange}_${f.marketType}`] = f.status;
  });

  const overallQualityScore = Math.round((validFeeds.length / Math.max(1, feeds.length)) * 100);

  return {
    timestampUtc: now,
    isoTimeUtc: new Date(now).toISOString(),
    symbol: 'BTC/USDT',
    primaryIndexPrice: Math.round(primaryIndexPrice * 100) / 100,
    basisSpreadUsd,
    basisSpreadBps,
    crossExchangeSpreadUsd,
    crossExchangeLatencyMs: avgLatency,
    overallQualityScore,
    feedStatuses,
    feeds
  };
}

// Fetch Multi-Timeframe candles (1m, 5m, 1h, 4h)
export async function fetchHtf(): Promise<Record<string, Candle[]>> {
  const out: Record<string, Candle[]> = {};

  const promises = [
    fetchBybit('1', 80).then(res => { out['Bybit 1m'] = res.candles; }).catch(() => {}),
    fetchBybit('5', 80).then(res => { out['Bybit 5m'] = res.candles; }).catch(() => {}),
    fetchBybit('60', 100).then(res => { out['Bybit 1H'] = res.candles; }).catch(() => {}),
    fetchBybit('240', 100).then(res => { out['Bybit 4H'] = res.candles; }).catch(() => {}),
  ];

  await Promise.allSettled(promises);
  return out;
}
