import process from 'node:process';
import { fetchPublicMarketFallback } from '../src/services/publicMarketDataFallback';

const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() ||
  process.env.FREQTRADE_PAIR?.trim() ||
  'BTC/USDT:USDT';
const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() ||
  process.env.FREQTRADE_TIMEFRAME?.trim() ||
  '1m';
const market = process.env.SBK1_MARKET?.trim() === 'spot' ? 'spot' : 'futures';
const requestStartedAtMs = Date.now();
const result = await fetchPublicMarketFallback({
  pair,
  timeframe,
  market,
  nowMs: requestStartedAtMs,
});
const checkedAtMs = Date.now();
const summarize = (feed: typeof result.candles | typeof result.orderBook | typeof result.tradeFlow |
  typeof result.fundingRate | typeof result.openInterest) => ({
  status: feed.status,
  sourceTimestampMs: feed.sourceTimestampMs,
  ageMs: feed.sourceTimestampMs === null ? null : checkedAtMs - feed.sourceTimestampMs,
  error: feed.error,
});
const report = {
  checkedAt: new Date(checkedAtMs).toISOString(),
  provider: result.provider,
  venue: result.venue,
  market: result.market,
  pair: result.pair,
  timeframe: result.timeframe,
  feeds: {
    candles: {
      ...summarize(result.candles),
      completedCandleCount: result.candles.value?.length ?? 0,
    },
    trades: {
      ...summarize(result.tradeFlow),
      tradeCount: result.tradeFlow.value?.trades.length ?? 0,
    },
    orderBook: {
      ...summarize(result.orderBook),
      bidLevels: result.orderBook.value?.bids.length ?? 0,
      askLevels: result.orderBook.value?.asks.length ?? 0,
    },
    funding: summarize(result.fundingRate),
    openInterest: summarize(result.openInterest),
  },
};
console.log(JSON.stringify(report, null, 2));

const requiredFeeds = market === 'futures'
  ? [
    result.candles,
    result.tradeFlow,
    result.orderBook,
    result.fundingRate,
    result.openInterest,
  ]
  : [result.candles, result.tradeFlow, result.orderBook];
if (requiredFeeds.some((feed) => feed.status !== 'LIVE')) process.exitCode = 1;
