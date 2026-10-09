/**
 * 🛰️ سرویس وب‌سوکت فریدوم فیلترشده و فاقد نویز (Linear Perpetual WebSocket)
 * مجهز به ردیابی وضعیت سلامت فید (LIVE, DEGRADED, STALE, DISCONNECTED)
 * قانون حیاتی: قیمت خام صرافی (Raw Exchange Price) بدون هیچ‌گونه smoothing یا فشرده‌سازی مستقیماً به مسیر اجرا ارسال می‌شود.
 */

export type WebSocketConnectionState = 'LIVE' | 'DEGRADED' | 'STALE' | 'DISCONNECTED';

export interface TickerFeedMessage {
  lastPrice: number;
  bid: number;
  ask: number;
  markPrice: number;
  exchangeTimestamp: number;
  sequenceId?: number;
  state: WebSocketConnectionState;
}

export const setupBybitWebSocket = (
  onMessage: (price: number, feed: TickerFeedMessage) => void,
  onStateChange?: (state: WebSocketConnectionState) => void
) => {
  let ws: WebSocket | null = null;
  let fallbackTimer: any = null;
  let lastUpdateTime = 0;
  let currentState: WebSocketConnectionState = 'DISCONNECTED';

  const updateState = (newState: WebSocketConnectionState) => {
    if (currentState !== newState) {
      currentState = newState;
      if (onStateChange) onStateChange(currentState);
    }
  };

  let isClosed = false;
  let reconnectTimeout: any = null;
  let retryCount = 0;

  const connect = () => {
    if (isClosed) return;

    try {
      // Bybit Linear Perpetual WebSocket endpoint for BTCUSDT Futures
      ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
      
      ws.onopen = () => {
        retryCount = 0;
        updateState('DEGRADED');
        if (fallbackTimer) {
          clearInterval(fallbackTimer);
          fallbackTimer = null;
        }
        ws?.send(JSON.stringify({ op: 'subscribe', args: ['tickers.BTCUSDT'] }));
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.topic === 'tickers.BTCUSDT' && data.data) {
            const item = data.data;
            const lastPrice = parseFloat(item.lastPrice);
            const bid = parseFloat(item.bid1Price || item.bid1 || '0');
            const ask = parseFloat(item.ask1Price || item.ask1 || '0');
            const markPrice = parseFloat(item.markPrice || item.lastPrice);
            const ts = parseInt(item.ts || data.ts || Date.now(), 10);

            if (!isNaN(lastPrice) && lastPrice > 0) {
              lastUpdateTime = Date.now();
              updateState('LIVE');

              const feedMessage: TickerFeedMessage = {
                lastPrice,
                bid,
                ask,
                markPrice,
                exchangeTimestamp: ts,
                sequenceId: data.cts || item.cts,
                state: 'LIVE'
              };

              // RAW EXCHANGE PRICE: Direct delivery to execution engine without smoothing compression!
              onMessage(lastPrice, feedMessage);
            }
          }
        } catch (e) {
          // ignore parse error
        }
      };

      ws.onerror = () => {
        updateState('DEGRADED');
      };

      ws.onclose = () => {
        updateState('DISCONNECTED');
        if (!isClosed) {
          const delay = Math.min(8000, 1000 * Math.pow(2, retryCount));
          retryCount = Math.min(retryCount + 1, 4);
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(() => {
            connect();
          }, delay);

          if (!fallbackTimer) {
            fallbackTimer = setInterval(() => {
              const age = Date.now() - lastUpdateTime;
              if (age > 5000) {
                updateState('STALE');
              } else if (age > 3000) {
                updateState('DEGRADED');
              }
            }, 1000);
          }
        }
      };
    } catch (err) {
      updateState('DISCONNECTED');
      if (!isClosed) {
        const delay = Math.min(8000, 1000 * Math.pow(2, retryCount));
        retryCount = Math.min(retryCount + 1, 4);
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
          connect();
        }, delay);
      }
    }
  };

  connect();

  const watchdog = setInterval(() => {
    if (lastUpdateTime > 0) {
      const age = Date.now() - lastUpdateTime;
      if (age > 6000) {
        updateState('STALE');
      } else if (age > 3000) {
        updateState('DEGRADED');
      } else if (currentState !== 'DISCONNECTED') {
        updateState('LIVE');
      }
    } else {
      updateState('DISCONNECTED');
    }
  }, 1000);

  return {
    seedPrice: (liveMarketPrice: number) => {
      if (liveMarketPrice > 0 && lastUpdateTime === 0) {
        lastUpdateTime = Date.now();
        updateState('LIVE');
        onMessage(liveMarketPrice, {
          lastPrice: liveMarketPrice,
          bid: liveMarketPrice * 0.9995,
          ask: liveMarketPrice * 1.0005,
          markPrice: liveMarketPrice,
          exchangeTimestamp: Date.now(),
          state: 'LIVE'
        });
      }
    },
    getState: () => currentState,
    getLastUpdateTime: () => lastUpdateTime,
    close: () => {
      isClosed = true;
      clearInterval(watchdog);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
      updateState('DISCONNECTED');
    }
  };
};
