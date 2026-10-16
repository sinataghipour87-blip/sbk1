export type WebSocketConnectionState = 'LIVE' | 'DEGRADED' | 'STALE' | 'DISCONNECTED';

export interface TickerFeedMessage {
  lastPrice: number;
  bid: number | null;
  ask: number | null;
  markPrice: number | null;
  exchangeTimestamp: number | null;
  receivedTimestamp: number;
  source: 'bybit';
  state: WebSocketConnectionState;
}

const STALE_AFTER_MS = 10_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

export const setupFreqtradeMarketFeed = (
  onMessage: (price: number, feed: TickerFeedMessage) => void,
  onStateChange?: (state: WebSocketConnectionState) => void,
) => {
  let currentState: WebSocketConnectionState = 'DISCONNECTED';
  let lastUpdateTime = 0;
  let connectionOpenedAt = 0;
  let isClosed = false;
  let reconnectDelayMs = RECONNECT_MIN_MS;
  let connectionMode: 'server' | 'public' = 'server';
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;

  const updateState = (state: WebSocketConnectionState) => {
    if (state === currentState) return;
    currentState = state;
    onStateChange?.(state);
  };

  const connect = () => {
    if (isClosed || socket || typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      if (!isClosed && typeof WebSocket === 'undefined') updateState('DISCONNECTED');
      return;
    }
    const url = connectionMode === 'server'
      ? new URL('/api/market-stream', window.location.href)
      : new URL('wss://stream.bybit.com/v5/public/linear');
    if (connectionMode === 'server') url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    updateState(lastUpdateTime > 0 ? 'STALE' : 'DISCONNECTED');
    const connection = new WebSocket(url);
    socket = connection;

    connection.addEventListener('open', () => {
      if (socket !== connection || isClosed) return;
      connectionOpenedAt = Date.now();
      reconnectDelayMs = RECONNECT_MIN_MS;
      if (connectionMode === 'public') {
        connection.send(JSON.stringify({ op: 'subscribe', args: ['tickers.BTCUSDT'] }));
      }
      if (Date.now() - lastUpdateTime > STALE_AFTER_MS) updateState('DEGRADED');
    });

    connection.addEventListener('message', (event) => {
      if (socket !== connection || isClosed || typeof event.data !== 'string') return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        updateState('DEGRADED');
        return;
      }
      if (typeof message !== 'object' || message === null || !('type' in message)) return;
      if ('state' in message && message.state === 'DISCONNECTED') {
        updateState(lastUpdateTime > 0 ? 'STALE' : 'DISCONNECTED');
        return;
      }
      const publicTicker = 'topic' in message &&
        message.topic === 'tickers.BTCUSDT' &&
        'data' in message &&
        typeof message.data === 'object' &&
        message.data !== null
        ? message.data
        : null;
      const serverTicker = 'type' in message && message.type === 'ticker' ? message : null;
      const ticker = publicTicker ?? serverTicker;
      const rawLastPrice = ticker && 'lastPrice' in ticker
        ? Number(ticker.lastPrice)
        : ticker && 'markPrice' in ticker
          ? Number(ticker.markPrice)
          : Number.NaN;
      const receivedTimestamp = serverTicker && 'receivedTimestamp' in serverTicker
        ? Number(serverTicker.receivedTimestamp)
        : Date.now();
      if (
        !ticker ||
        !Number.isFinite(rawLastPrice) ||
        rawLastPrice <= 0 ||
        !Number.isSafeInteger(receivedTimestamp)
      ) return;

      const ageMs = Date.now() - receivedTimestamp;
      if (ageMs < -1_000 || ageMs > STALE_AFTER_MS) {
        updateState('STALE');
        return;
      }
      lastUpdateTime = receivedTimestamp;
      updateState('LIVE');
      onMessage(rawLastPrice, {
        lastPrice: rawLastPrice,
        bid: ticker && 'bid' in ticker && typeof ticker.bid === 'number'
          ? ticker.bid
          : ticker && 'bid1Price' in ticker && Number.isFinite(Number(ticker.bid1Price))
            ? Number(ticker.bid1Price)
            : null,
        ask: ticker && 'ask' in ticker && typeof ticker.ask === 'number'
          ? ticker.ask
          : ticker && 'ask1Price' in ticker && Number.isFinite(Number(ticker.ask1Price))
            ? Number(ticker.ask1Price)
            : null,
        markPrice: ticker && 'markPrice' in ticker && Number.isFinite(Number(ticker.markPrice))
          ? Number(ticker.markPrice)
          : null,
        exchangeTimestamp: publicTicker && 'ts' in message && Number.isSafeInteger(Number(message.ts))
          ? Number(message.ts)
          : serverTicker && 'exchangeTimestamp' in serverTicker && typeof serverTicker.exchangeTimestamp === 'number'
            ? serverTicker.exchangeTimestamp
            : null,
        receivedTimestamp,
        source: 'bybit',
        state: 'LIVE',
      });
    });

    connection.addEventListener('error', () => connection.close());
    connection.addEventListener('close', () => {
      if (socket !== connection) return;
      socket = null;
      connectionOpenedAt = 0;
      if (isClosed) return;
      if (connectionMode === 'server') {
        connectionMode = 'public';
        reconnectDelayMs = RECONNECT_MIN_MS;
        connect();
        return;
      }
      updateState(lastUpdateTime > 0 && Date.now() - lastUpdateTime <= STALE_AFTER_MS ? 'DEGRADED' : 'DISCONNECTED');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
    });
  };

  connect();
  watchdogTimer = setInterval(() => {
    if (isClosed) return;
    const lastActivityTime = lastUpdateTime || connectionOpenedAt;
    if (lastActivityTime === 0 || Date.now() - lastActivityTime <= STALE_AFTER_MS) return;
    if (socket?.readyState === WebSocket.OPEN) {
      updateState(lastUpdateTime > 0 ? 'STALE' : 'DEGRADED');
      socket.close(4000, 'Market ticker stream is stale');
    } else {
      updateState(lastUpdateTime > 0 ? 'STALE' : 'DISCONNECTED');
    }
  }, 1_000);

  return {
    getState: () => currentState,
    getLastUpdateTime: () => lastUpdateTime,
    getLastSource: () => lastUpdateTime > 0 ? 'bybit' : 'none',
    close: () => {
      isClosed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (watchdogTimer) clearInterval(watchdogTimer);
      reconnectTimer = null;
      watchdogTimer = null;
      socket?.close(1000, 'Market feed stopped');
      socket = null;
      updateState('DISCONNECTED');
    },
  };
};
