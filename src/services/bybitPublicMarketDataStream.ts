import WebSocket from 'ws';
import type { PublicMarketSocket } from './publicMarketDataStream';

const MAX_PRICE_AGE_MS = 5_000;
const STALE_CONNECTION_MS = 15_000;

interface BybitPublicSocket extends PublicMarketSocket {
  send(data: string): void;
}

export interface PublicChartPrice {
  price: number;
  sourceTimestampMs: number;
  receivedAtMs: number;
  source: 'binance' | 'bybit';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePair(pair: string): string {
  const match = /^([A-Z0-9]+)\/USDT(?::USDT)?$/i.exec(pair.trim());
  if (!match) throw new Error(`Bybit live chart feed supports USDT-quoted pairs; received ${pair}.`);
  return `${match[1].toUpperCase()}USDT`;
}

export class BybitPublicMarketDataStream {
  private socket: BybitPublicSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private monitorTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private lastMessageAtMs = 0;
  private stopped = true;
  private symbol: string | null = null;
  private latestPrice: PublicChartPrice | null = null;

  constructor(
    private readonly createSocket: (url: string) => BybitPublicSocket = (url) =>
      new WebSocket(url, { handshakeTimeout: 5_000 }),
  ) {}

  start(pair: string, market: 'spot' | 'futures'): void {
    if (!this.stopped) return;
    if (market !== 'futures') throw new Error('Bybit public chart stream is configured for linear futures.');
    this.symbol = parsePair(pair);
    this.stopped = false;
    this.latestPrice = null;
    this.connect();
    this.monitorTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN &&
          Date.now() - this.lastMessageAtMs > STALE_CONNECTION_MS) {
        this.socket.close(4000, 'Bybit public trades stopped updating.');
      }
    }, 5_000);
    this.monitorTimer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.monitorTimer = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'Server shutting down.');
  }

  getLatestPrice(nowMs = Date.now()): PublicChartPrice | null {
    const price = this.latestPrice;
    return price && nowMs - price.sourceTimestampMs <= MAX_PRICE_AGE_MS &&
      nowMs - price.sourceTimestampMs >= -1_000
      ? { ...price }
      : null;
  }

  getLastReceivedAtMs(): number {
    return this.latestPrice?.receivedAtMs ?? 0;
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (this.stopped || !this.symbol) return;
    let socket: BybitPublicSocket;
    try {
      socket = this.createSocket('wss://stream.bybit.com/v5/public/linear');
    } catch (error) {
      console.error('[BybitPublicMarketDataStream] Could not open Bybit WebSocket:', error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.on('open', () => {
      if (this.socket !== socket || !this.symbol) return;
      this.reconnectAttempts = 0;
      this.lastMessageAtMs = Date.now();
      socket.send(JSON.stringify({ op: 'subscribe', args: [`publicTrade.${this.symbol}`] }));
      this.pingTimer = setInterval(() => {
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ op: 'ping' }));
        }
      }, 20_000);
      this.pingTimer.unref();
      console.info(`[BybitPublicMarketDataStream] Bybit linear trades connected for ${this.symbol}.`);
    });
    socket.on('message', (data) => {
      if (this.socket !== socket) return;
      this.lastMessageAtMs = Date.now();
      let payload: unknown;
      try {
        payload = JSON.parse(data.toString());
      } catch (error) {
        console.error('[BybitPublicMarketDataStream] Ignoring malformed Bybit WebSocket JSON:', error);
        return;
      }
      if (!isRecord(payload) || payload.topic !== `publicTrade.${this.symbol}` || !Array.isArray(payload.data)) return;
      for (const item of payload.data) {
        if (!isRecord(item)) continue;
        const price = Number(item.p);
        const sourceTimestampMs = Number(item.T);
        if (
          !Number.isFinite(price) || price <= 0 ||
          !Number.isSafeInteger(sourceTimestampMs) ||
          sourceTimestampMs <= 0 ||
          sourceTimestampMs > Date.now() + 1_000
        ) continue;
        if (
          this.latestPrice &&
          sourceTimestampMs <= this.latestPrice.sourceTimestampMs
        ) continue;
        this.latestPrice = {
          price,
          sourceTimestampMs,
          receivedAtMs: Date.now(),
          source: 'bybit',
        };
      }
    });
    socket.on('error', (error) => {
      if (this.socket === socket) {
        console.error('[BybitPublicMarketDataStream] Bybit WebSocket error:', error);
      }
    });
    socket.on('close', (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (code !== 1000) {
        console.warn(`[BybitPublicMarketDataStream] Bybit stream closed (${code}): ${reason.toString()}`);
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delayMs = Math.min(30_000, 1_000 * (2 ** Math.min(this.reconnectAttempts, 5)));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
    this.reconnectTimer.unref();
  }
}

export const bybitPublicMarketDataStream = new BybitPublicMarketDataStream();
