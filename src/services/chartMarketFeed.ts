import type { Candle } from '../types/trading';

export type ChartMarketFeedState = 'LIVE' | 'DEGRADED' | 'STALE' | 'DISCONNECTED';

export interface ChartMarketFeedUpdate {
  state: ChartMarketFeedState;
  source: 'binance' | 'bybit' | null;
  price: number | null;
  sourceTimestampMs: number | null;
  receivedAtMs: number;
}

export interface ChartPriceCandidate {
  source: 'binance' | 'bybit';
  price: number;
  sourceTimestampMs: number;
  receivedAtMs: number;
}

export function selectChartPrice(
  bybit: ChartPriceCandidate | null,
  binance: ChartPriceCandidate | null,
  nowMs = Date.now(),
): ChartPriceCandidate | null {
  const isFresh = (candidate: ChartPriceCandidate | null): candidate is ChartPriceCandidate =>
    candidate !== null &&
    Number.isFinite(candidate.price) &&
    candidate.price > 0 &&
    Number.isSafeInteger(candidate.sourceTimestampMs) &&
    Number.isSafeInteger(candidate.receivedAtMs) &&
    nowMs - candidate.sourceTimestampMs >= -1_000 &&
    nowMs - candidate.sourceTimestampMs <= 5_000 &&
    nowMs - candidate.receivedAtMs >= -1_000 &&
    nowMs - candidate.receivedAtMs <= 5_000;
  if (isFresh(bybit)) return bybit;
  if (isFresh(binance)) return binance;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUpdate(value: unknown): ChartMarketFeedUpdate | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  const source = value.source;
  const price = value.price;
  const sourceTimestampMs = value.sourceTimestampMs;
  const receivedAtMs = value.receivedAtMs;
  if (state !== 'LIVE' && state !== 'DEGRADED' && state !== 'STALE' && state !== 'DISCONNECTED') return null;
  let parsedSource: ChartMarketFeedUpdate['source'];
  if (source === null) parsedSource = null;
  else if (source === 'binance' || source === 'bybit') parsedSource = source;
  else return null;
  let parsedPrice: number | null;
  if (price === null) parsedPrice = null;
  else if (typeof price === 'number' && Number.isFinite(price) && price > 0) parsedPrice = price;
  else return null;
  let parsedSourceTimestamp: number | null;
  if (sourceTimestampMs === null) parsedSourceTimestamp = null;
  else if (typeof sourceTimestampMs === 'number' && Number.isSafeInteger(sourceTimestampMs)) {
    parsedSourceTimestamp = sourceTimestampMs;
  } else return null;
  if (typeof receivedAtMs !== 'number' || !Number.isSafeInteger(receivedAtMs)) return null;
  return {
    state,
    source: parsedSource,
    price: parsedPrice,
    sourceTimestampMs: parsedSourceTimestamp,
    receivedAtMs,
  };
}

export async function fetchBinanceChartCandles(): Promise<Candle[]> {
  const response = await fetch('/api/market/chart-candles', { cache: 'no-store' });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : `Chart candles request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!isRecord(payload) || payload.source !== 'binance' || !Array.isArray(payload.candles)) {
    throw new Error('Binance chart candles response has an invalid contract.');
  }
  const candles = payload.candles.flatMap((value): Candle[] => {
    if (!isRecord(value)) return [];
    const { timestampMs, open, high, low, close, volume } = value;
    if (
      typeof timestampMs !== 'number' ||
      !Number.isSafeInteger(timestampMs) ||
      typeof open !== 'number' || !Number.isFinite(open) || open <= 0 ||
      typeof high !== 'number' || !Number.isFinite(high) || high <= 0 ||
      typeof low !== 'number' || !Number.isFinite(low) || low <= 0 ||
      typeof close !== 'number' || !Number.isFinite(close) || close <= 0 ||
      typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 ||
      high < Math.max(open, close, low) ||
      low > Math.min(open, close, high)
    ) return [];
    return [[open, high, low, close, volume]];
  });
  if (candles.length < 30 || candles.length !== payload.candles.length) {
    throw new Error('Binance chart candles response contains too few or invalid candles.');
  }
  return candles;
}

export function setupChartMarketFeed(
  onUpdate: (update: ChartMarketFeedUpdate) => void,
  onError?: () => void,
) {
  const source = new EventSource('/api/market/chart-stream');
  let lastLiveUpdateReceivedAtMs = 0;
  let latestState: ChartMarketFeedState = 'DISCONNECTED';
  let closed = false;
  let reconnectTimer: number | null = null;
  const watchdog = window.setInterval(() => {
    if (closed) return;
    if (
      latestState === 'LIVE' &&
      (!lastLiveUpdateReceivedAtMs || Date.now() - lastLiveUpdateReceivedAtMs > 5_000)
    ) {
      latestState = 'STALE';
      onUpdate({
        state: 'STALE',
        source: null,
        price: null,
        sourceTimestampMs: null,
        receivedAtMs: Date.now(),
      });
    }
  }, 1_000);

  source.onmessage = (event) => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    let value: unknown;
    try {
      value = JSON.parse(event.data);
    } catch (error) {
      console.error('[ChartMarketFeed] Server sent invalid JSON:', error);
      return;
    }
    const update = parseUpdate(value);
    if (!update) {
      console.error('[ChartMarketFeed] Server sent an invalid chart-feed event.');
      return;
    }
    latestState = update.state;
    if (update.state === 'LIVE') lastLiveUpdateReceivedAtMs = Date.now();
    onUpdate(update);
  };
  source.onerror = () => {
    if (closed) return;
    onError?.();
    latestState = 'DEGRADED';
    onUpdate({
      state: 'DEGRADED',
      source: null,
      price: null,
      sourceTimestampMs: null,
      receivedAtMs: Date.now(),
    });
    if (reconnectTimer === null) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (closed) return;
        latestState = 'DISCONNECTED';
        onUpdate({
          state: 'DISCONNECTED',
          source: null,
          price: null,
          sourceTimestampMs: null,
          receivedAtMs: Date.now(),
        });
      }, 10_000);
    }
  };

  return {
    close: () => {
      closed = true;
      window.clearInterval(watchdog);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      source.close();
    },
  };
}
