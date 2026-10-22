import { binancePublicMarketDataStream } from '../src/services/publicMarketDataStream';

const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() ||
  process.env.FREQTRADE_PAIR?.trim() ||
  'BTC/USDT:USDT';
const market = process.env.SBK1_MARKET?.trim() === 'spot' ||
  process.env.FREQTRADE_MARKET?.trim() === 'spot'
  ? 'spot'
  : 'futures';
const timeoutMs = 8_000;
const startedAtMs = Date.now();
binancePublicMarketDataStream.start(pair, market);

try {
  let snapshot = binancePublicMarketDataStream.getSnapshot();
  while (
    Date.now() - startedAtMs < timeoutMs &&
    (!snapshot.price || !snapshot.tradeFlow || !snapshot.orderBook || !snapshot.partialFastCandle)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    snapshot = binancePublicMarketDataStream.getSnapshot();
  }

  const checkedAtMs = Date.now();
  const report = {
    pair,
    market,
    checkedAt: new Date(checkedAtMs).toISOString(),
    feeds: {
      lastTrade: snapshot.price
        ? { status: 'LIVE', ageMs: checkedAtMs - snapshot.price.sourceTimestampMs }
        : { status: 'UNAVAILABLE' },
      individualTrades: snapshot.tradeFlow
        ? {
          status: 'LIVE',
          ageMs: checkedAtMs - (snapshot.tradeFlow.trades.at(-1)?.timestampMs ?? checkedAtMs),
          count: snapshot.tradeFlow.trades.length,
        }
        : { status: 'UNAVAILABLE' },
      orderBook: snapshot.orderBook
        ? { status: 'LIVE', ageMs: checkedAtMs - snapshot.orderBook.timestampMs }
        : { status: 'UNAVAILABLE' },
      formingOneMinuteCandle: snapshot.partialFastCandle
        ? { status: 'LIVE', ageMs: checkedAtMs - snapshot.partialFastCandle.sourceTimestampMs }
        : { status: 'UNAVAILABLE' },
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!snapshot.price || !snapshot.tradeFlow || !snapshot.orderBook || !snapshot.partialFastCandle) {
    process.exitCode = 1;
  }
} finally {
  binancePublicMarketDataStream.stop();
}
