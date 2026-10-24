import {
  FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS,
  FREQTRADE_TICKER_MAX_AGE_MS,
} from './freqtradeMarketDataBridge';
import {
  cacheFreqtradeMarketSnapshot,
} from './marketData';
import type { FreqtradeMarketSnapshot } from './freqtradeMarketDataBridge';

export type MarketFeedConnectionState = 'LIVE' | 'DEGRADED' | 'STALE' | 'DISCONNECTED';

export interface TickerFeedMessage {
  lastPrice: number;
  bid: number | null;
  ask: number | null;
  markPrice: number | null;
  exchangeTimestamp: number | null;
  receivedTimestamp: number;
  source: 'freqtrade.dataprovider';
  state: MarketFeedConnectionState;
}

export const setupFreqtradeMarketFeed = (
  onMessage: (price: number, feed: TickerFeedMessage) => void,
  onStateChange?: (state: MarketFeedConnectionState) => void,
  onSnapshot?: (snapshot: FreqtradeMarketSnapshot) => void,
) => {
  let currentState: MarketFeedConnectionState = 'DISCONNECTED';
  let lastUpdateTime = 0;
  let lastTickerReceivedAtMs = 0;
  let isClosed = false;
  let streamConnected = false;
  let lastGeneratedAtMs = 0;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  const eventSource = new EventSource('/api/market/freqtrade-snapshot/stream');

  const updateState = (state: MarketFeedConnectionState) => {
    if (state === currentState) return;
    currentState = state;
    onStateChange?.(state);
  };

  eventSource.onopen = () => {
    streamConnected = true;
    updateState('DEGRADED');
  };
  eventSource.onmessage = (event) => {
    try {
      const payload: unknown = JSON.parse(event.data);
      if (
        typeof payload !== 'object' ||
        payload === null ||
        Array.isArray(payload) ||
        !('serverTimeMs' in payload) ||
        !Number.isSafeInteger(payload.serverTimeMs) ||
        !('snapshot' in payload)
      ) throw new Error('Freqtrade snapshot stream event has an invalid contract.');
      const { serverTimeMs, snapshot: snapshotValue } = payload as {
        serverTimeMs: number;
        snapshot: unknown;
      };
      streamConnected = true;
      const snapshot = cacheFreqtradeMarketSnapshot(snapshotValue, serverTimeMs);
      if (snapshot.generatedAtMs <= lastGeneratedAtMs || isClosed) return;
      lastGeneratedAtMs = snapshot.generatedAtMs;
      onSnapshot?.(snapshot);
      const snapshotAgeMs = serverTimeMs - snapshot.generatedAtMs;
      if (snapshotAgeMs < -1_000 || snapshotAgeMs > FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS) {
        updateState('STALE');
        return;
      }
      const ticker = snapshot.ticker;
      if (!ticker) {
        lastUpdateTime = 0;
        lastTickerReceivedAtMs = 0;
        updateState('DEGRADED');
      } else {
        const tickerAgeMs = serverTimeMs - ticker.retrievedAtMs;
        if (
          tickerAgeMs < -1_000 ||
          tickerAgeMs > FREQTRADE_TICKER_MAX_AGE_MS ||
          !Number.isFinite(ticker.last) ||
          ticker.last <= 0
        ) {
          lastUpdateTime = 0;
          lastTickerReceivedAtMs = 0;
          updateState('STALE');
        } else {
          lastUpdateTime = ticker.retrievedAtMs;
          lastTickerReceivedAtMs = Date.now();
          updateState('LIVE');
          onMessage(ticker.last, {
            lastPrice: ticker.last,
            bid: ticker.bid,
            ask: ticker.ask,
            markPrice: ticker.markPrice,
            exchangeTimestamp: ticker.exchangeTimestampMs,
            receivedTimestamp: ticker.retrievedAtMs,
            source: 'freqtrade.dataprovider',
            state: 'LIVE',
          });
        }
      }
    } catch (error) {
      console.error('[MarketFeed] Could not process a Freqtrade snapshot event:', error);
      updateState('DEGRADED');
    }
  };

  eventSource.onerror = () => {
    streamConnected = false;
    updateState('DISCONNECTED');
  };
  watchdog = setInterval(() => {
    if (!lastTickerReceivedAtMs) {
      updateState(streamConnected ? 'DEGRADED' : 'DISCONNECTED');
      return;
    }
    const isStale = Date.now() - lastTickerReceivedAtMs > FREQTRADE_TICKER_MAX_AGE_MS;
    updateState(isStale ? 'STALE' : streamConnected ? 'LIVE' : 'DISCONNECTED');
  }, 1_000);

  return {
    getState: () => currentState,
    getLastUpdateTime: () => lastUpdateTime,
    getLastSource: () => lastUpdateTime > 0 ? 'freqtrade.dataprovider' : 'none',
    close: () => {
      isClosed = true;
      if (watchdog !== null) clearInterval(watchdog);
      eventSource.close();
      updateState('DISCONNECTED');
    },
  };
};
