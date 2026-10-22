import assert from 'node:assert/strict';
import process from 'node:process';
import { fetchPublicMarketFallback } from '../src/services/publicMarketDataFallback';
import { analyzeWalkForwardCandlePatterns } from '../src/services/walkForwardCandleResearch';
import type { Candle } from '../src/types/trading';

const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() ||
  process.env.FREQTRADE_PAIR?.trim() ||
  'BTC/USDT:USDT';
const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() ||
  process.env.FREQTRADE_TIMEFRAME?.trim() ||
  '15m';
const market = process.env.SBK1_MARKET?.trim() === 'spot' ? 'spot' : 'futures';
const nowMs = Date.now();
const marketData = await fetchPublicMarketFallback({ pair, timeframe, market, nowMs });
assert.equal(marketData.provider, 'Binance public REST API');
assert.equal(marketData.candles.status, 'LIVE', marketData.candles.error);
assert.ok(marketData.candles.value && marketData.candles.value.length >= 30);
assert.ok(marketData.candles.sourceTimestampMs !== null);

const candles = marketData.candles.value!;
const feeValue = process.env.SBK1_PATTERN_TAKER_FEE_BPS?.trim();
const slippageValue = process.env.SBK1_PATTERN_SLIPPAGE_BPS?.trim();
const report = analyzeWalkForwardCandlePatterns({
  candles: candles.map(({ open, high, low, close, volume }) =>
    [open, high, low, close, volume] as Candle
  ),
  exchange: marketData.venue,
  market: marketData.market,
  pair: marketData.pair,
  timeframe,
  dataStatus: 'LIVE',
  sourceTimestampMs: marketData.candles.sourceTimestampMs,
  nowMs: Date.now(),
  ...(feeValue && slippageValue
    ? {
        feeBpsPerSide: Number(feeValue),
        slippageBpsPerSide: Number(slippageValue),
      }
    : {}),
});
assert.ok(['AVAILABLE', 'INSUFFICIENT_HISTORY', 'INSUFFICIENT_EVIDENCE'].includes(report.status));
assert.equal(report.tradeEligible, false);
assert.equal(report.timeframe, timeframe);
assert.ok(report.candleCount >= candles.length);
assert.ok(report.trainingCandleCount > 0);
assert.ok(report.testCandleCount > 0);
assert.deepEqual(Object.keys(report.horizons).map(Number).sort((a, b) => a - b), [7, 15, 30, 60]);
for (const horizon of Object.values(report.horizons)) {
  assert.equal(horizon.minimumForecastsForMetrics, report.minimumOutOfSampleForecasts);
  if (!horizon.available) continue;
  assert.ok(horizon.forecastsWithEnoughMatches >= horizon.minimumForecastsForMetrics);
  assert.ok(Number.isFinite(horizon.meanGrossPredictedReturnPct));
  assert.ok(Number.isFinite(horizon.meanMaximumFavorableMovePct));
  assert.ok(Number.isFinite(horizon.meanMaximumAdverseMovePct));
  if (report.costs.configured) assert.ok(Number.isFinite(horizon.meanNetPredictedReturnPct));
}

console.log(JSON.stringify({
  source: marketData.provider,
  pair,
  timeframe,
  candleCount: candles.length,
  candleObservedAtMs: marketData.candles.sourceTimestampMs,
  report,
}, null, 2));
