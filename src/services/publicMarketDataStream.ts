import WebSocket from 'ws';
import type {
  FreqtradeMarketCandle,
  FreqtradeMarketOrderBook,
  FreqtradeMarketTrade,
  FreqtradeMarketTradeFlow,
} from './freqtradeMarketDataBridge';

const MAX_STREAM_AGE_MS = 5_000;
const MAX_STORED_TRADES = 2_000;
const STALE_CONNECTION_MS = 15_000;

type MarketKind = 'spot' | 'futures';

export interface PublicMarketSocket {
  readyState: number;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: { toString(): string }) => void): this;
  on(event: 'close', listener: (code: number, reason: { toString(): string }) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  close(code?: number, reason?: string): void;
}

interface StreamSnapshot {
  price: {
    sourceTimestampMs: number;
    retrievedAtMs: number;
    price: number;
  } | null;
  tradeFlow: FreqtradeMarketTradeFlow | null;
  orderBook: FreqtradeMarketOrderBook | null;
  partialFastCandle: {
    candle: FreqtradeMarketCandle;
    sourceTimestampMs: number;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function parseLevels(value: unknown): Array<{ price: number; amount: number }> | null {
  if (!Array.isArray(value)) return null;
  const levels = value.flatMap((entry): Array<{ price: number; amount: number }> => {
    if (!Array.isArray(entry) || entry.length < 2) return [];
    const price = positiveNumber(entry[0]);
    const amount = positiveNumber(entry[1]);
    return price !== null && amount !== null ? [{ price, amount }] : [];
  }).slice(0, 20);
  return levels.length > 0 ? levels : null;
}

function parseCandle(value: unknown): FreqtradeMarketCandle | null {
  if (!isRecord(value)) return null;
  const timestampMs = finiteNumber(value.t);
  const open = positiveNumber(value.o);
  const high = positiveNumber(value.h);
  const low = positiveNumber(value.l);
  const close = positiveNumber(value.c);
  const volume = finiteNumber(value.v);
  if (
    !Number.isSafeInteger(timestampMs) ||
    timestampMs! <= 0 ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    volume < 0 ||
    high < Math.max(open, close, low) ||
    low > Math.min(open, close, high)
  ) return null;
  return { timestampMs: timestampMs!, open, high, low, close, volume };
}

type StreamChannel = 'trades' | 'orderBook';

function makeStreamUrls(pair: string, market: MarketKind): Record<StreamChannel, string> {
  const match = /^([A-Z0-9]+)\/USDT(?::USDT)?$/i.exec(pair.trim());
  if (!match) throw new Error(`Binance live stream supports USDT-quoted pairs; received ${pair}.`);
  const symbol = `${match[1].toLowerCase()}usdt`;
  const baseUrl = market === 'futures'
    ? 'wss://fstream.binance.com/ws/'
    : 'wss://stream.binance.com:9443/ws/';
  return {
    trades: `${baseUrl}${symbol}@trade`,
    orderBook: `${baseUrl}${symbol}@depth20@100ms`,
  };
}

export class BinancePublicMarketDataStream {
  private sockets = new Map<StreamChannel, PublicMarketSocket>();
  private monitorTimer: NodeJS.Timeout | null = null;
  private reconnectTimers = new Map<StreamChannel, NodeJS.Timeout>();
  private reconnectAttempts = new Map<StreamChannel, number>();
  private lastMessageAtMs = new Map<StreamChannel, number>();
  private stopped = true;
  private urls: Record<StreamChannel, string> | null = null;
  private latestPrice: StreamSnapshot['price'] = null;
  private latestOrderBook: FreqtradeMarketOrderBook | null = null;
  private partialFastCandle: StreamSnapshot['partialFastCandle'] = null;
  private trades: FreqtradeMarketTrade[] = [];
  private lastTradeId: number | null = null;

  constructor(
    private readonly createSocket: (url: string) => PublicMarketSocket = (url) =>
      new WebSocket(url, { handshakeTimeout: 5_000 }),
  ) {}

  start(pair: string, market: MarketKind): void {
    if (!this.stopped) return;
    this.urls = makeStreamUrls(pair, market);
    this.stopped = false;
    this.latestPrice = null;
    this.latestOrderBook = null;
    this.partialFastCandle = null;
    this.trades = [];
    this.lastTradeId = null;
    this.connect('trades');
    this.connect('orderBook');
    this.monitorTimer = setInterval(() => {
      for (const channel of ['trades', 'orderBook'] as const) {
        const socket = this.sockets.get(channel);
        const lastMessageAtMs = this.lastMessageAtMs.get(channel) ?? 0;
        if (
          socket?.readyState === WebSocket.OPEN &&
          Date.now() - lastMessageAtMs > STALE_CONNECTION_MS
        ) {
          socket.close(4000, `${channel} stream has stopped sending updates.`);
        }
      }
    }, 5_000);
    this.monitorTimer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    const sockets = [...this.sockets.values()];
    this.sockets.clear();
    for (const socket of sockets) socket.close(1000, 'Server shutting down.');
  }

  getSnapshot(nowMs = Date.now()): StreamSnapshot {
    const isFresh = (timestampMs: number | null | undefined) =>
      typeof timestampMs === 'number' &&
      Number.isSafeInteger(timestampMs) &&
      timestampMs <= nowMs &&
      nowMs - timestampMs <= MAX_STREAM_AGE_MS;
    const recentTrades = this.trades.filter((trade) =>
      isFresh(trade.timestampMs),
    );
    return {
      price: this.latestPrice && isFresh(this.latestPrice.sourceTimestampMs)
        ? { ...this.latestPrice }
        : null,
      tradeFlow: recentTrades.length > 0
        ? { retrievedAtMs: nowMs, trades: recentTrades }
        : null,
      orderBook: this.latestOrderBook && isFresh(this.latestOrderBook.timestampMs)
        ? structuredClone(this.latestOrderBook)
        : null,
      partialFastCandle: this.partialFastCandle &&
        isFresh(this.partialFastCandle.sourceTimestampMs)
        ? structuredClone(this.partialFastCandle)
        : null,
    };
  }

  private connect(channel: StreamChannel): void {
    if (this.stopped || !this.urls) return;
    let socket: PublicMarketSocket;
    try {
      socket = this.createSocket(this.urls[channel]);
    } catch (error) {
      console.error(`[PublicMarketDataStream] Could not open Binance ${channel} WebSocket:`, error);
      this.scheduleReconnect(channel);
      return;
    }
    this.sockets.set(channel, socket);
    socket.on('open', () => {
      if (this.sockets.get(channel) !== socket) return;
      this.lastMessageAtMs.set(channel, Date.now());
      console.info(`[PublicMarketDataStream] Binance ${channel} stream connected.`);
    });
    socket.on('message', (data) => {
      if (this.sockets.get(channel) !== socket) return;
      const receivedAtMs = Date.now();
      this.lastMessageAtMs.set(channel, receivedAtMs);
      this.handleMessage(data.toString(), receivedAtMs);
    });
    socket.on('error', (error) => {
      if (this.sockets.get(channel) === socket) {
        console.error(`[PublicMarketDataStream] Binance ${channel} stream error:`, error);
      }
    });
    socket.on('close', (code, reason) => {
      if (this.sockets.get(channel) !== socket) return;
      this.sockets.delete(channel);
      if (code !== 1000) {
        console.warn(
          `[PublicMarketDataStream] Binance ${channel} stream closed (${code}): ${reason.toString()}`,
        );
      }
      this.scheduleReconnect(channel);
    });
  }

  private scheduleReconnect(channel: StreamChannel): void {
    if (this.stopped || this.reconnectTimers.has(channel)) return;
    const attempt = this.reconnectAttempts.get(channel) ?? 0;
    const delayMs = Math.min(30_000, 1_000 * (2 ** Math.min(attempt, 5)));
    this.reconnectAttempts.set(channel, attempt + 1);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(channel);
      this.connect(channel);
    }, delayMs);
    timer.unref();
    this.reconnectTimers.set(channel, timer);
  }

  private handleMessage(rawMessage: string, receivedAtMs: number): void {
    let envelope: unknown;
    try {
      envelope = JSON.parse(rawMessage);
    } catch (error) {
      console.error('[PublicMarketDataStream] Ignoring malformed Binance WebSocket JSON:', error);
      return;
    }
    if (!isRecord(envelope)) return;
    const event = isRecord(envelope.data) ? envelope.data : envelope;
    const eventTimeMs = finiteNumber(event.E);
    if (eventTimeMs === null || eventTimeMs <= 0 || eventTimeMs > receivedAtMs + 1_000) return;

    if (event.e === 'trade' || event.e === 'aggTrade') {
      const timestampMs = finiteNumber(event.T);
      const tradeId = finiteNumber(event.e === 'trade' ? event.t : event.a);
      const price = positiveNumber(event.p);
      const amount = positiveNumber(event.q);
      if (
        timestampMs === null ||
        !Number.isSafeInteger(tradeId) ||
        tradeId! <= 0 ||
        (this.lastTradeId !== null && tradeId! <= this.lastTradeId) ||
        timestampMs > receivedAtMs + 1_000 ||
        price === null ||
        amount === null ||
        typeof event.m !== 'boolean'
      ) return;
      this.lastTradeId = tradeId!;
      this.latestPrice = { sourceTimestampMs: timestampMs, retrievedAtMs: receivedAtMs, price };
      this.trades.push({
        timestampMs,
        side: event.m ? 'sell' : 'buy',
        price,
        amount,
      });
      this.updatePartialCandle(timestampMs, price, amount);
      if (this.trades.length > MAX_STORED_TRADES) {
        this.trades = this.trades.slice(-MAX_STORED_TRADES);
      }
      return;
    }

    if (event.e === 'depthUpdate') {
      const bids = parseLevels(event.b);
      const asks = parseLevels(event.a);
      if (!bids || !asks || bids[0].price >= asks[0].price) return;
      this.latestOrderBook = { timestampMs: eventTimeMs, bids, asks };
      return;
    }

    if (event.e === 'kline' && isRecord(event.k) && event.k.i === '1m') {
      const candle = parseCandle(event.k);
      if (!candle) return;
      if (event.k.x === true) {
        if (this.partialFastCandle?.candle.timestampMs &&
            this.partialFastCandle.candle.timestampMs <= candle.timestampMs) {
          this.partialFastCandle = null;
        }
        return;
      }
      if (
        this.partialFastCandle &&
        this.partialFastCandle.candle.timestampMs > candle.timestampMs
      ) return;
      this.partialFastCandle = {
        candle,
        sourceTimestampMs: eventTimeMs,
      };
    }
  }

  private updatePartialCandle(timestampMs: number, price: number, amount: number): void {
    const minuteTimestampMs = Math.floor(timestampMs / 60_000) * 60_000;
    const previous = this.partialFastCandle;
    if (previous && previous.candle.timestampMs > minuteTimestampMs) return;
    if (!previous || previous.candle.timestampMs < minuteTimestampMs) {
      this.partialFastCandle = {
        candle: {
          timestampMs: minuteTimestampMs,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: amount,
        },
        sourceTimestampMs: timestampMs,
      };
      return;
    }
    this.partialFastCandle = {
      candle: {
        ...previous.candle,
        high: Math.max(previous.candle.high, price),
        low: Math.min(previous.candle.low, price),
        close: price,
        volume: previous.candle.volume + amount,
      },
      sourceTimestampMs: timestampMs,
    };
  }
}

export const binancePublicMarketDataStream = new BinancePublicMarketDataStream();
