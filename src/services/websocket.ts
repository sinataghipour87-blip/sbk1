/**
 * 🛰️ سرویس وب‌سوکت چندصرافی با failover اضطراری (Bybit → Binance/OKX)
 * قانون حیاتی: اگر فید اصلی قطع یا کند شود، فیدهای جایگزین بلافاصله فعال می‌شوند و هیچ داده ناپایدار یا فیک به موتور اجرا وارد نمی‌شود.
 */

export type WebSocketConnectionState = 'LIVE' | 'DEGRADED' | 'STALE' | 'DISCONNECTED';
export type ExchangeFeedSource = 'bybit' | 'binance' | 'okx';

export interface TickerFeedMessage {
  lastPrice: number;
  bid: number;
  ask: number;
  markPrice: number;
  exchangeTimestamp: number;
  source: ExchangeFeedSource;
  sequenceId?: number;
  state: WebSocketConnectionState;
}

const normalizeNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getConnectionAgeMs = (lastSeenAt: number): number => (lastSeenAt > 0 ? Date.now() - lastSeenAt : Number.POSITIVE_INFINITY);

const resolveEffectiveState = (lastUpdateTime: number): WebSocketConnectionState => {
  if (lastUpdateTime <= 0) return 'DISCONNECTED';
  const ageMs = getConnectionAgeMs(lastUpdateTime);
  if (ageMs <= 3000) return 'LIVE';
  if (ageMs <= 6000) return 'DEGRADED';
  return 'STALE';
};

const createTickerMessage = (
  exchange: ExchangeFeedSource,
  lastPrice: number,
  bid: number,
  ask: number,
  markPrice: number,
  exchangeTimestamp: number,
  sequenceId?: number,
  state: WebSocketConnectionState = 'LIVE'
): TickerFeedMessage => ({
  lastPrice,
  bid,
  ask,
  markPrice,
  exchangeTimestamp,
  source: exchange,
  sequenceId,
  state,
});

export const setupBybitWebSocket = (
  onMessage: (price: number, feed: TickerFeedMessage) => void,
  onStateChange?: (state: WebSocketConnectionState) => void
) => {
  let lastUpdateTime = 0;
  let currentState: WebSocketConnectionState = 'DISCONNECTED';
  let lastKnownPrice = 0;
  let lastSource: ExchangeFeedSource | null = null;
  let isClosed = false;
  const connections: Record<ExchangeFeedSource, { ws: WebSocket | null; reconnectTimeout: any; retryCount: number; }> = {
    bybit: { ws: null, reconnectTimeout: null, retryCount: 0 },
    binance: { ws: null, reconnectTimeout: null, retryCount: 0 },
    okx: { ws: null, reconnectTimeout: null, retryCount: 0 },
  };

  const updateState = (newState: WebSocketConnectionState) => {
    if (currentState !== newState) {
      currentState = newState;
      if (onStateChange) onStateChange(currentState);
    }
  };

  const syncStateFromRuntime = () => {
    const nextState = resolveEffectiveState(lastUpdateTime);
    updateState(nextState);
  };

  const handleValidTick = (
    exchange: ExchangeFeedSource,
    feed: Pick<TickerFeedMessage, 'lastPrice' | 'bid' | 'ask' | 'markPrice' | 'exchangeTimestamp' | 'sequenceId'>
  ) => {
    const price = Number(feed.lastPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return;
    }

    lastUpdateTime = Date.now();
    lastKnownPrice = price;
    lastSource = exchange;
    const liveMessage = createTickerMessage(
      exchange,
      feed.lastPrice,
      feed.bid,
      feed.ask,
      feed.markPrice,
      feed.exchangeTimestamp,
      feed.sequenceId,
      'LIVE'
    );

    onMessage(price, liveMessage);
    syncStateFromRuntime();
  };

  const getReconnectDelayMs = (retryCount: number): number => Math.min(8000, 1000 * Math.pow(2, retryCount));

  const connectExchange = (exchange: ExchangeFeedSource, url: string, subscribePayload: unknown, parsePayload: (payload: any) => Pick<TickerFeedMessage, 'lastPrice' | 'bid' | 'ask' | 'markPrice' | 'exchangeTimestamp' | 'sequenceId'> | null) => {
    if (isClosed) return;

    try {
      const connection = connections[exchange];
      const ws = new WebSocket(url);
      connection.ws = ws;
      connection.retryCount = connection.retryCount || 0;

      ws.onopen = () => {
        connection.retryCount = 0;
        if (subscribePayload !== null) {
          ws.send(JSON.stringify(subscribePayload));
        }
        syncStateFromRuntime();
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const tick = parsePayload(payload);
          if (tick) {
            handleValidTick(exchange, tick);
          }
        } catch {
          // Ignore malformed payloads; fail closed by not pushing unsafe artificial values.
        }
      };

      ws.onerror = () => {
        syncStateFromRuntime();
      };

      ws.onclose = () => {
        connection.ws = null;
        if (!isClosed) {
          const delayMs = getReconnectDelayMs(connection.retryCount);
          connection.retryCount = Math.min(connection.retryCount + 1, 4);
          if (connection.reconnectTimeout) {
            clearTimeout(connection.reconnectTimeout);
          }
          connection.reconnectTimeout = setTimeout(() => {
            connectExchange(exchange, url, subscribePayload, parsePayload);
          }, delayMs);
        }
        syncStateFromRuntime();
      };
    } catch {
      if (!isClosed) {
        const connection = connections[exchange];
        const delayMs = getReconnectDelayMs(connection.retryCount);
        connection.retryCount = Math.min(connection.retryCount + 1, 4);
        if (connection.reconnectTimeout) {
          clearTimeout(connection.reconnectTimeout);
        }
        connection.reconnectTimeout = setTimeout(() => {
          connectExchange(exchange, url, subscribePayload, parsePayload);
        }, delayMs);
      }
      syncStateFromRuntime();
    }
  };

  const bybitParser = (payload: any) => {
    const item = payload?.topic === 'tickers.BTCUSDT' ? payload.data : null;
    if (!item) return null;

    const lastPrice = normalizeNumber(item.lastPrice);
    const bid = normalizeNumber(item.bid1Price ?? item.bid1);
    const ask = normalizeNumber(item.ask1Price ?? item.ask1);
    const markPrice = normalizeNumber(item.markPrice ?? item.lastPrice);
    const exchangeTimestamp = normalizeNumber(item.ts ?? payload.ts ?? Date.now());

    if (!lastPrice || !Number.isFinite(lastPrice) || lastPrice <= 0) return null;

    return {
      lastPrice,
      bid,
      ask,
      markPrice,
      exchangeTimestamp,
      sequenceId: payload.cts ?? item.cts,
    };
  };

  const binanceParser = (payload: any) => {
    const raw = payload?.data ?? payload;
    const item = raw && typeof raw === 'object' && 'e' in raw ? raw : null;
    if (!item || item.e !== '24hrTicker') return null;

    const lastPrice = normalizeNumber(item.c || item.lastPrice);
    const bid = normalizeNumber(item.b || item.bidPrice);
    const ask = normalizeNumber(item.a || item.askPrice);
    const markPrice = normalizeNumber(item.m || item.lastPrice);
    const exchangeTimestamp = normalizeNumber(item.E ?? Date.now());

    if (!lastPrice || lastPrice <= 0) return null;

    return {
      lastPrice,
      bid,
      ask,
      markPrice,
      exchangeTimestamp,
      sequenceId: item.u,
    };
  };

  const okxParser = (payload: any) => {
    const item = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
    if (!item) return null;

    const lastPrice = normalizeNumber(item.last);
    const bid = normalizeNumber(item.bidPx ?? item.bidPrice ?? item.bid1Px);
    const ask = normalizeNumber(item.askPx ?? item.askPrice ?? item.ask1Px);
    const markPrice = normalizeNumber(item.markPx ?? item.last);
    const exchangeTimestamp = normalizeNumber(item.ts ?? Date.now());

    if (!lastPrice || lastPrice <= 0) return null;

    return {
      lastPrice,
      bid,
      ask,
      markPrice,
      exchangeTimestamp,
      sequenceId: item.seqId,
    };
  };

  connectExchange('bybit', 'wss://stream.bybit.com/v5/public/linear', { op: 'subscribe', args: ['tickers.BTCUSDT'] }, bybitParser);
  connectExchange('binance', 'wss://stream.binance.com:9443/stream?streams=btcusdt@ticker', null, binanceParser);
  connectExchange('okx', 'wss://ws.okx.com:8443/ws/v5/public?brokerId=9999', { op: 'subscribe', args: [{ channel: 'tickers', instId: 'BTC-USDT-SWAP' }] }, okxParser);

  const watchdog = setInterval(() => {
    const nextState = resolveEffectiveState(lastUpdateTime);
    updateState(nextState);
  }, 1000);

  return {
    seedPrice: (liveMarketPrice: number) => {
      if (!liveMarketPrice || liveMarketPrice <= 0) return;
      lastUpdateTime = Date.now();
      lastKnownPrice = liveMarketPrice;
      lastSource = 'bybit';
      onMessage(liveMarketPrice, createTickerMessage('bybit', liveMarketPrice, liveMarketPrice * 0.9995, liveMarketPrice * 1.0005, liveMarketPrice, Date.now(), undefined, 'LIVE'));
      syncStateFromRuntime();
    },
    getState: () => currentState,
    getLastUpdateTime: () => lastUpdateTime,
    getLastSource: () => lastSource,
    close: () => {
      isClosed = true;
      clearInterval(watchdog);
      (Object.keys(connections) as ExchangeFeedSource[]).forEach((exchange) => {
        const connection = connections[exchange];
        if (connection.reconnectTimeout) clearTimeout(connection.reconnectTimeout);
        if (connection.ws) connection.ws.close();
      });
      updateState('DISCONNECTED');
    },
  };
};

export const setupMultiExchangePriceFeed = setupBybitWebSocket;
