import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import {
  BinancePublicMarketDataStream,
  type PublicMarketSocket,
} from '../src/services/publicMarketDataStream';

class FakeWebSocket extends EventEmitter implements PublicMarketSocket {
  readyState: number = WebSocket.OPEN;

  close(code = 1000, reason = ''): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }
}

const sockets: FakeWebSocket[] = [];
const connectedUrls: string[] = [];
const stream = new BinancePublicMarketDataStream((url) => {
  connectedUrls.push(url);
  const socket = new FakeWebSocket();
  sockets.push(socket);
  return socket;
});
stream.start('BTC/USDT:USDT', 'futures');
const [tradeSocket, orderBookSocket] = sockets;
assert.ok(tradeSocket && orderBookSocket);
tradeSocket.emit('open');
orderBookSocket.emit('open');
assert.match(connectedUrls[0], /^wss:\/\/fstream\.binance\.com\/ws\/btcusdt@trade$/);
assert.match(connectedUrls[1], /^wss:\/\/fstream\.binance\.com\/ws\/btcusdt@depth20@100ms$/);

const nowMs = Date.now();
const send = (socket: FakeWebSocket, data: Record<string, unknown>) =>
  socket.emit('message', Buffer.from(JSON.stringify(data)));
send(tradeSocket, {
  e: 'trade',
  E: nowMs - 100,
  T: nowMs - 150,
  t: 10,
  p: '100',
  q: '2',
  m: false,
});
send(tradeSocket, {
  e: 'trade',
  E: nowMs - 20,
  T: nowMs - 25,
  t: 11,
  p: '101',
  q: '1',
  m: true,
});
send(orderBookSocket, {
  e: 'depthUpdate',
  E: nowMs - 80,
  b: [['99', '3'], ['98', '4']],
  a: [['101', '2'], ['102', '5']],
});

const live = stream.getSnapshot(nowMs);
assert.equal(live.price?.price, 101);
assert.equal(live.tradeFlow?.trades.length, 2);
assert.equal(live.tradeFlow?.trades[0].side, 'buy');
assert.equal(live.tradeFlow?.trades[1].side, 'sell');
assert.equal(live.orderBook?.bids[0].price, 99);
assert.equal(live.partialFastCandle?.candle.close, 101);
assert.equal(live.partialFastCandle?.candle.volume, 3);
assert.equal(live.partialFastCandle?.sourceTimestampMs, nowMs - 25);

const stale = stream.getSnapshot(nowMs + 6_000);
assert.equal(stale.price, null);
assert.equal(stale.tradeFlow, null);
assert.equal(stale.orderBook, null);
assert.equal(stale.partialFastCandle, null);

stream.stop();
console.log('Binance WebSocket trade/depth subscriptions, live candle aggregation, and stale-feed rejection passed.');
