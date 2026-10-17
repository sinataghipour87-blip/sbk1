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
  FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS,
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
    const res = await fetch(url, { signal: controller.signal });
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

export async function fetchBybit(interval = '15', limit = 150, forceRefresh = false): Promise<BybitCandlesResult> {
  if (!bybitIntervals.has(interval) || !Number.isInteger(limit) || limit < 20 || limit > 1000) {
    throw new Error(`Unsupported Bybit candle request: interval=${interval}, limit=${limit}.`);
  }
  const timeframe = timeframeForMinuteInterval(interval) || '15m';
  try {
    const snapshot = await getFreqtradeMarketSnapshot(forceRefresh);
    const snapshotAgeMs = Date.now() - snapshot.generatedAtMs;
    if (
      snapshotAgeMs < -1_000 ||
      snapshotAgeMs > FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS
    ) {
      throw new Error('snapshot is stale');
    }
    const sourceCandles = timeframe === snapshot.timeframe
      ? snapshot.candles
      : snapshot.additionalCandles[timeframe];
    const candles = candleDataForTimeframe(snapshot, timeframe).slice(-limit);
    if (candles.length < 20 || !sourceCandles?.length) {
      throw new Error(`insufficient fresh ${timeframe} candles`);
    }
    const lastSourceCandle = sourceCandles.at(-1)!;
    return {
      candles,
      latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
      sourceStartTimeMs: lastSourceCandle.timestampMs,
      sourceCloseTimeMs: lastSourceCandle.timestampMs + Number(interval) * 60_000,
      receivedTimestampMs: snapshot.generatedAtMs,
      source: 'freqtrade.dataprovider',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`داده از فریکترید در دسترس نیست: ${reason}`);
  }
}

function isValidMarketCandle(candle: Candle): boolean {
  const [open, high, low, close, volume] = candle;
  return [open, high, low, close, volume].every(Number.isFinite) &&
    open > 0 && high > 0 && low > 0 && close > 0 && volume >= 0;
}

export async function fetchFuturesPrices(forceRefresh = false): Promise<FuturesPrices> {
  const nowMs = Date.now();
  try {
    const snapshot = await getFreqtradeMarketSnapshot(forceRefresh);
    const ticker = snapshot.ticker;
    const ageMs = ticker ? nowMs - ticker.retrievedAtMs : Number.POSITIVE_INFINITY;
    const isFresh = ticker !== null &&
      ageMs >= -1_000 &&
      ageMs <= FREQTRADE_TICKER_MAX_AGE_MS &&
      nowMs - snapshot.generatedAtMs >= -1_000 &&
      nowMs - snapshot.generatedAtMs <= FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS;
    return {
      lastPrice: ticker?.last ?? 0,
      markPrice: ticker?.markPrice ?? 0,
      indexPrice: ticker?.indexPrice ?? 0,
      timestampUtc: ticker?.exchangeTimestampMs ?? ticker?.retrievedAtMs ?? 0,
      exchangeTimestampUtc: ticker?.exchangeTimestampMs ?? null,
      timestampSource: ticker
        ? ticker.exchangeTimestampMs === null ? 'FREQTRADE_RECEIVED' : 'EXCHANGE'
        : 'UNAVAILABLE',
      receivedTimestampMs: nowMs,
      isoTimeUtc: ticker ? new Date(ticker.retrievedAtMs).toISOString() : '',
      ageMs,
      latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
      systemLastPrice: null,
      systemOpenInterest: null,
      systemPriceStatus: 'UNAVAILABLE',
      source: 'freqtrade.dataprovider',
      status: isFresh ? 'LIVE' : ticker ? 'STALE' : 'UNAVAILABLE',
      ...(!isFresh ? { error: ticker ? 'Freqtrade ticker is stale.' : 'Freqtrade snapshot has no valid ticker.' } : {}),
    };
  } catch (error) {
    return {
      lastPrice: 0,
      markPrice: 0,
      indexPrice: 0,
      timestampUtc: 0,
      exchangeTimestampUtc: null,
      timestampSource: 'UNAVAILABLE',
      receivedTimestampMs: nowMs,
      isoTimeUtc: '',
      ageMs: Number.POSITIVE_INFINITY,
      latencyMs: 0,
      systemLastPrice: null,
      systemOpenInterest: null,
      systemPriceStatus: 'UNAVAILABLE',
      source: 'freqtrade.dataprovider',
      status: 'UNAVAILABLE',
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
      source: 'freqtrade.dataprovider',
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
  const nowMs = Date.now();
  try {
    const snapshot = await getFreqtradeMarketSnapshot();
    const fundingRate = snapshot.fundingRate;
    const ageMs = fundingRate ? nowMs - fundingRate.retrievedAtMs : Number.POSITIVE_INFINITY;
    const freshFunding = fundingRate !== null &&
      ageMs >= -1_000 &&
      ageMs <= FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS;
    return {
      funding: freshFunding ? fundingRate.rate : null,
      oi: null,
      fundingHistory: [],
      status: 'UNAVAILABLE',
      timestampUtc: fundingRate?.retrievedAtMs ?? 0,
      isoTimeUtc: fundingRate ? new Date(fundingRate.retrievedAtMs).toISOString() : '',
      ageMs,
      latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
      source: 'freqtrade.dataprovider',
      ...(!freshFunding
        ? { error: 'No fresh Freqtrade funding rate is available.' }
        : { error: 'Open interest is not available in the Freqtrade market snapshot.' }),
    };
  } catch (error) {
    return {
      funding: null,
      oi: null,
      fundingHistory: [],
      status: 'UNAVAILABLE',
      timestampUtc: 0,
      isoTimeUtc: '',
      ageMs: Number.POSITIVE_INFINITY,
      latencyMs: 0,
      source: 'freqtrade.dataprovider',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchRealOrderBookImbalance(): Promise<RealOrderBookImbalance> {
  const unavailable = (error: string): RealOrderBookImbalance => {
    return {
      obi: null,
      bidDepthUsd: 0,
      askDepthUsd: 0,
      bestBid: null,
      bestAsk: null,
      spreadUsd: null,
      levelsCount: 0,
      status: 'UNAVAILABLE',
      error,
      timestamp: 0,
      ageMs: Number.POSITIVE_INFINITY,
      snapshotAgeMs: Number.POSITIVE_INFINITY,
      latencyMs: 0,
      source: 'freqtrade.dataprovider',
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
  };
  let snapshot: FreqtradeMarketSnapshot;
  try {
    snapshot = await getFreqtradeMarketSnapshot();
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
  const orderBook = snapshot.orderBook;
  if (!orderBook) return unavailable('No Freqtrade order book is available.');
  const nowMs = Date.now();
  const ageMs = nowMs - orderBook.timestampMs;
  const snapshotAgeMs = nowMs - snapshot.generatedAtMs;
  if (
    ageMs < -1_000 ||
    ageMs > 10_000 ||
    snapshotAgeMs < -1_000 ||
    snapshotAgeMs > FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS
  ) return unavailable('The Freqtrade order book is stale.');

  const bidDepthUsd = orderBook.bids.reduce((total, level) => total + level.price * level.amount, 0);
  const askDepthUsd = orderBook.asks.reduce((total, level) => total + level.price * level.amount, 0);
  const totalDepthUsd = bidDepthUsd + askDepthUsd;
  return {
    obi: totalDepthUsd > 0 ? (bidDepthUsd - askDepthUsd) / totalDepthUsd : null,
    bidDepthUsd,
    askDepthUsd,
    bestBid: orderBook.bids[0]?.price ?? null,
    bestAsk: orderBook.asks[0]?.price ?? null,
    spreadUsd: orderBook.asks[0] && orderBook.bids[0]
      ? orderBook.asks[0].price - orderBook.bids[0].price
      : null,
    levelsCount: orderBook.bids.length + orderBook.asks.length,
    status: 'LIVE',
    timestamp: orderBook.timestampMs,
    ageMs,
    snapshotAgeMs,
    latencyMs: getSnapshotNetworkLatencyMs(snapshot) ?? 0,
    source: 'freqtrade.dataprovider',
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

export async function fetchRealTradeFlowCvd(): Promise<OrderFlowFeatures> {
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
    latencyMs: 0,
    source: 'freqtrade.dataprovider',
    error: 'Freqtrade market snapshots do not contain trade-level flow data.',
  };
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