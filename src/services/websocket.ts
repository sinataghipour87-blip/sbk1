import { getFreqtradeMarketSnapshot } from './marketData';
import { FREQTRADE_TICKER_MAX_AGE_MS } from './freqtradeMarketDataBridge';

export type WebSocketConnectionState = 'LIVE' | 'DEGRADED' | 'STALE' | 'DISCONNECTED';

export interface TickerFeedMessage {
  lastPrice: number;
  bid: number | null;
  ask: number | null;
  markPrice: number | null;
  exchangeTimestamp: number | null;
  receivedTimestamp: number;
  source: 'freqtrade';
  state: WebSocketConnectionState;
}

const POLL_INTERVAL_MS = 5_000;

export const setupFreqtradeMarketFeed = (
  onMessage: (price: number, feed: TickerFeedMessage) => void,
  onStateChange?: (state: WebSocketConnectionState) => void,
) => {
  let currentState: WebSocketConnectionState = 'DISCONNECTED';
  let lastUpdateTime = 0;
  let isClosed = false;
  let isPolling = false;
  let lastSnapshotTimestamp = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const updateState = (state: WebSocketConnectionState) => {
    if (state === currentState) return;
    currentState = state;
    onStateChange?.(state);
  };

  const poll = async () => {
    if (isClosed || isPolling) return;
    isPolling = true;
    try {
      const snapshot = await getFreqtradeMarketSnapshot();
      if (isClosed) return;
      const ticker = snapshot.ticker;
      const nowMs = Date.now();
      if (!ticker ||
        nowMs - ticker.retrievedAtMs < 0 ||
        nowMs - ticker.retrievedAtMs > FREQTRADE_TICKER_MAX_AGE_MS
      ) {
        updateState(lastUpdateTime > 0 ? 'STALE' : 'DISCONNECTED');
        return;
      }
      updateState('LIVE');
      if (snapshot.generatedAtMs > lastSnapshotTimestamp) {
        lastSnapshotTimestamp = snapshot.generatedAtMs;
        lastUpdateTime = nowMs;
        onMessage(ticker.last, {
          lastPrice: ticker.last,
          bid: ticker.bid,
          ask: ticker.ask,
          markPrice: ticker.markPrice,
          exchangeTimestamp: ticker.exchangeTimestampMs,
          receivedTimestamp: ticker.retrievedAtMs,
          source: 'freqtrade',
          state: 'LIVE',
        });
      }
    } catch {
      if (!isClosed) updateState(lastUpdateTime > 0 ? 'STALE' : 'DISCONNECTED');
    } finally {
      isPolling = false;
    }
  };

  void poll();
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);

  return {
    getState: () => currentState,
    getLastUpdateTime: () => lastUpdateTime,
    getLastSource: () => lastUpdateTime > 0 ? 'freqtrade' : 'none',
    close: () => {
      isClosed = true;
      if (pollTimer) clearInterval(pollTimer);
      updateState('DISCONNECTED');
    },
  };
};
