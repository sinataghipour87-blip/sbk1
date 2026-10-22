import assert from 'node:assert/strict';
import type { AnalysisResult, Candle } from '../src/types/trading';
import { realGarchEngine } from '../src/services/realGarchEngine';
import { evaluateVolatilitySpike } from '../src/services/volatilitySpikePredictor';

const nowMs = 1_800_000_000_000;
const makeCandles = (timeframe: string, count: number): Candle[] => {
  const minutes = Number(/^(\d+)m$/.exec(timeframe)?.[1] ?? 60);
  return Array.from({ length: count }, (_, index) => {
    const close = 60_000 + Math.sin(index / 2) * 100 + index * 0.2;
    return [
      nowMs - (count - index) * minutes * 60_000,
      close,
      close + 25,
      close - 25,
      close,
      10,
    ];
  });
};

const fiveMinuteResult = realGarchEngine.fitAndForecast(makeCandles('5m', 300), '5m');
assert.equal(fiveMinuteResult.status, 'AVAILABLE');
assert.equal(fiveMinuteResult.timeframe, '5m');
assert.equal(fiveMinuteResult.forecastVol15mActualHorizonMinutes, 15);
assert.equal(fiveMinuteResult.forecastVol1hActualHorizonMinutes, 60);
assert.equal(fiveMinuteResult.regimeProbability, null, 'heuristic regimes must not masquerade as calibrated probabilities');

const hourlyResult = realGarchEngine.fitAndForecast(makeCandles('1h', 300), '1h');
assert.equal(hourlyResult.status, 'AVAILABLE');
assert.equal(hourlyResult.forecastVol15mActualHorizonMinutes, 60);
assert.equal(hourlyResult.forecastVol1hActualHorizonMinutes, 60);

const duplicateTimestampCandles = makeCandles('5m', 300);
duplicateTimestampCandles[duplicateTimestampCandles.length - 1] = duplicateTimestampCandles.at(-2)!;
const invalidCadenceResult = realGarchEngine.fitAndForecast(duplicateTimestampCandles, '5m');
assert.equal(invalidCadenceResult.status, 'UNAVAILABLE');
assert.equal(invalidCadenceResult.regime, 'UNKNOWN');
assert.equal(realGarchEngine.fitAndForecast(makeCandles('5m', 300), '').status, 'UNAVAILABLE');

const missingData = evaluateVolatilitySpike(undefined, 60_000, nowMs);
assert.equal(missingData.status, 'UNAVAILABLE');
assert.equal(missingData.riskScorePct, null, 'missing feeds must never receive a synthetic risk score');

const liveAnalysis = {
  dataStatus: 'LIVE',
  price: 60_000,
  funding: 0.04,
  volatilityPct: 1.2,
  futuresPrices: {
    lastPrice: 60_000,
    receivedTimestampMs: nowMs,
    status: 'LIVE',
  },
  realObiData: {
    obi: -0.2,
    timestamp: nowMs,
    status: 'LIVE',
  },
  dataQualityReport: {
    isTradeAllowed: true,
    feeds: {
      orderBook: { status: 'LIVE', timestamp: nowMs, maxAgeMs: 5_000 },
      derivatives: { status: 'LIVE', timestamp: nowMs, maxAgeMs: 600_000 },
    },
  },
} as unknown as Partial<AnalysisResult>;
const liveReport = evaluateVolatilitySpike(liveAnalysis, 60_000, nowMs);
assert.equal(liveReport.status, 'AVAILABLE');
assert.equal(liveReport.riskScorePct, 89);
assert.equal(liveReport.expectedDirection, 'DOWN_LONG_FLUSH');

const staleReport = evaluateVolatilitySpike(liveAnalysis, 60_000, nowMs + 6_000);
assert.equal(staleReport.status, 'UNAVAILABLE');
assert.equal(staleReport.riskScorePct, null);

console.log('Volatility controls enforce live inputs, timeframe-aware GARCH horizons, and fail-closed execution-risk evidence.');
