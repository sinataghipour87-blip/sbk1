import {
  FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS,
  FREQTRADE_TICKER_MAX_AGE_MS,
  FreqtradeMarketSnapshotValidationError,
} from './freqtradeMarketDataBridge';
import { getFreqtradeMarketSnapshot } from './marketData';

export type WebSocketConnectionState = 'LIVE' | 'DEGRADED' | 'STALE' | 'DISCONNECTED';

export interface TickerFeedMessage {
  lastPrice: number;
  bid: number | null;
  ask: number | null;
  markPrice: number | null;
  exchangeTimestamp: number | null;
  receivedTimestamp: number;
  source: 'freqtrade.dataprovider';
  state: WebSocketConnectionState;
}

const SNAPSHOT_POLL_INTERVAL_MS = 5_000;

export const setupFreqtradeMarketFeed = (
  onMessage: (price: number, feed: TickerFeedMessage) => void,
  onStateChange?: (state: WebSocketConnectionState) => void,
) => {
  let currentState: WebSocketConnectionState = 'DISCONNECTED';
  let lastUpdateTime = 0;
  let isClosed = false;
  let isPolling = false;

  const updateState = (state: WebSocketConnectionState) => {
    if (state === currentState) return;
    currentState = state;
    onStateChange?.(state);
  };

  const pollSnapshot = async () => {
    if (isClosed || isPolling) return;
    isPolling = true;
    try {
      const snapshot = await getFreqtradeMarketSnapshot();
      if (isClosed) return;
      const now = Date.now();
      const snapshotAgeMs = now - snapshot.generatedAtMs;
      if (
        snapshotAgeMs < -1_000 ||
        snapshotAgeMs > FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS
      ) {
        updateState('STALE');
        return;
      }

      const ticker = snapshot.ticker;
      if (!ticker) {
        updateState('STALE');
        return;
      }
      const tickerAgeMs = now - ticker.retrievedAtMs;
      if (
        tickerAgeMs < -1_000 ||
        tickerAgeMs > FREQTRADE_TICKER_MAX_AGE_MS ||
        !Number.isFinite(ticker.last) ||
        ticker.last <= 0
      ) {
        updateState('STALE');
        return;
      }

      lastUpdateTime = ticker.retrievedAtMs;
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
    } catch (error) {
      const isStaleSnapshot = error instanceof FreqtradeMarketSnapshotValidationError &&
        error.code === 'STALE_SNAPSHOT';
      updateState(isStaleSnapshot ? 'STALE' : 'DISCONNECTED');
    } finally {
      isPolling = false;
    }
  };

  void pollSnapshot();
  const pollTimer = setInterval(() => void pollSnapshot(), SNAPSHOT_POLL_INTERVAL_MS);

  return {
    getState: () => currentState,
    getLastUpdateTime: () => lastUpdateTime,
    getLastSource: () => lastUpdateTime > 0 ? 'freqtrade.dataprovider' : 'none',
    close: () => {
      isClosed = true;
      clearInterval(pollTimer);
      updateState('DISCONNECTED');
    },
  };
};
