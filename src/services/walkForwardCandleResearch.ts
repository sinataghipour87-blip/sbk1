import type { Candle } from '../types/trading';

const PATTERN_WINDOW_SIZE = 12;
const CONTEXT_WINDOW_SIZE = 48;
const MIN_SIMILARITY_PCT = 85;
const MIN_REFERENCE_MATCHES = 3;
const MIN_OUT_OF_SAMPLE_FORECASTS = 20;
const TRAINING_FRACTION = 0.7;
const HORIZONS_MINUTES = [7, 15, 30, 60] as const;

export type CandleResearchHorizon = (typeof HORIZONS_MINUTES)[number];

export interface CandleResearchCosts {
  takerFeeBpsPerSide: number;
  slippageBpsPerSide: number;
}

export interface WalkForwardHorizonResult {
  horizonMinutes: CandleResearchHorizon;
  actualHorizonMinutes: number;
  available: boolean;
  outOfSampleForecastCount: number;
  forecastsWithEnoughMatches: number;
  minimumForecastsForMetrics: number;
  averageReferenceMatches: number | null;
  meanSimilarityPct: number | null;
  grossDirectionAccuracyPct: number | null;
  meanGrossPredictedReturnPct: number | null;
  grossWinRatePct: number | null;
  meanNetPredictedReturnPct: number | null;
  netWinRatePct: number | null;
  meanMaximumFavorableMovePct: number | null;
  meanMaximumAdverseMovePct: number | null;
  meanCostAdjustedRewardRiskRatio: number | null;
}

export interface WalkForwardCandleResearchReport {
  status: 'AVAILABLE' | 'INSUFFICIENT_HISTORY' | 'INSUFFICIENT_EVIDENCE' | 'INVALID_INPUT';
  source: 'verified-live-exchange-candles';
  timeframe: string | null;
  candleCount: number;
  trainingCandleCount: number;
  testCandleCount: number;
  trainingCutoffTimestampMs: number | null;
  similarityThresholdPct: number;
  contextSimilarityWeightPct: number;
  requiredReferenceMatches: number;
  minimumOutOfSampleForecasts: number;
  costs: {
    takerFeeBpsPerSide: number;
    slippageBpsPerSide: number;
    roundTripPercent: number;
    configured: true;
  } | {
    configured: false;
    note: string;
  };
  horizons: Record<CandleResearchHorizon, WalkForwardHorizonResult>;
  tradeEligible: false;
  note: string;
}

export interface WalkForwardCandleResearchInput {
  candles: Candle[];
  timeframe: string;
  sourceTimestampMs: number;
  nowMs?: number;
  dataStatus: string;
  feeBpsPerSide?: number;
  slippageBpsPerSide?: number;
}

interface NormalizedCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandleFeatures {
  shape: number[];
  trend: -1 | 0 | 1;
  volatility: number;
  relativeVolume: number;
}

interface ReferenceWindow {
  features: CandleFeatures;
  direction: -1 | 0 | 1;
  forwardReturnPct: number;
}

interface TestForecast {
  similarityPct: number;
  referenceCount: number;
  predictedDirection: -1 | 1;
  grossReturnPct: number;
  maximumFavorableMovePct: number;
  maximumAdverseMovePct: number;
}

function timeframeMinutes(timeframe: string): number | null {
  const match = /^(\d+)(m|h|d|w)$/.exec(timeframe);
  if (!match) return null;
  const scale: Record<string, number> = { m: 1, h: 60, d: 1_440, w: 10_080 };
  const minutes = Number(match[1]) * scale[match[2]];
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

function normalizeCandle(candle: Candle): NormalizedCandle | null {
  const offset = candle.length === 6 ? 1 : 0;
  const [open, high, low, close, volume] = candle.slice(offset, offset + 5);
  if (
    ![open, high, low, close, volume].every(Number.isFinite) ||
    open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 ||
    high < Math.max(open, close, low) ||
    low > Math.min(open, close, high)
  ) return null;
  return { open, high, low, close, volume };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function extractFeatures(candles: NormalizedCandle[], start: number): CandleFeatures | null {
  const contextStart = start - CONTEXT_WINDOW_SIZE;
  if (contextStart < 0) return null;
  const window = candles.slice(start, start + PATTERN_WINDOW_SIZE);
  const context = candles.slice(contextStart, start);
  if (window.length !== PATTERN_WINDOW_SIZE || context.length !== CONTEXT_WINDOW_SIZE) return null;

  const rangeMedian = median(window.map(candle => Math.max(candle.high - candle.low, candle.close * 1e-8)));
  const volumeMedian = median(context.map(candle => candle.volume)) || 1;
  const shape = window.flatMap(candle => {
    const range = Math.max(candle.high - candle.low, candle.close * 1e-8);
    return [
      (candle.close - candle.open) / range,
      (candle.high - Math.max(candle.open, candle.close)) / range,
      (Math.min(candle.open, candle.close) - candle.low) / range,
      Math.tanh(Math.log(range / rangeMedian)),
      Math.tanh(Math.log((candle.volume + volumeMedian * 1e-8) / volumeMedian)),
    ];
  });
  const contextReturns = context.slice(1).map((candle, index) =>
    candle.close / context[index].close - 1
  );
  const volatility = Math.sqrt(
    contextReturns.reduce((sum, value) => sum + value * value, 0) / Math.max(1, contextReturns.length),
  );
  const contextReturn = context.at(-1)!.close / context[0].close - 1;
  const trendStrength = contextReturn / Math.max(volatility * Math.sqrt(contextReturns.length), 1e-12);
  const trend: -1 | 0 | 1 = trendStrength > 0.5 ? 1 : trendStrength < -0.5 ? -1 : 0;
  const windowVolumeMedian = median(window.map(candle => candle.volume));
  const relativeVolume = Math.log((windowVolumeMedian + 1e-12) / volumeMedian);
  return { shape, trend, volatility, relativeVolume };
}

function compareFeatures(left: CandleFeatures, right: CandleFeatures): number {
  let shapeError = 0;
  for (let index = 0; index < left.shape.length; index += 1) {
    shapeError += Math.abs(left.shape[index] - right.shape[index]);
  }
  const shapeSimilarity = Math.max(0, 1 - shapeError / (left.shape.length * 2));
  const volatilitySimilarity = Math.exp(
    -Math.abs(Math.log((left.volatility + 1e-12) / (right.volatility + 1e-12))),
  );
  const volumeSimilarity = Math.exp(-Math.abs(left.relativeVolume - right.relativeVolume) / 2);
  const contextSimilarity =
    (left.trend === right.trend ? 0.5 : 0) +
    volatilitySimilarity * 0.3 +
    volumeSimilarity * 0.2;
  return (shapeSimilarity * 0.7 + contextSimilarity * 0.3) * 100;
}

function emptyHorizon(horizonMinutes: CandleResearchHorizon, actualHorizonMinutes: number): WalkForwardHorizonResult {
  return {
    horizonMinutes,
    actualHorizonMinutes,
    available: false,
    outOfSampleForecastCount: 0,
    forecastsWithEnoughMatches: 0,
    minimumForecastsForMetrics: MIN_OUT_OF_SAMPLE_FORECASTS,
    averageReferenceMatches: null,
    meanSimilarityPct: null,
    grossDirectionAccuracyPct: null,
    meanGrossPredictedReturnPct: null,
    grossWinRatePct: null,
    meanNetPredictedReturnPct: null,
    netWinRatePct: null,
    meanMaximumFavorableMovePct: null,
    meanMaximumAdverseMovePct: null,
    meanCostAdjustedRewardRiskRatio: null,
  };
}

function validateCosts(input: WalkForwardCandleResearchInput): CandleResearchCosts | null {
  const fee = input.feeBpsPerSide;
  const slippage = input.slippageBpsPerSide;
  if (
    typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0 ||
    typeof slippage !== 'number' || !Number.isFinite(slippage) || slippage < 0
  ) return null;
  return { takerFeeBpsPerSide: fee, slippageBpsPerSide: slippage };
}

export function analyzeWalkForwardCandlePatterns(
  input: WalkForwardCandleResearchInput,
): WalkForwardCandleResearchReport {
  const minutesPerCandle = timeframeMinutes(input.timeframe);
  const emptyHorizons = Object.fromEntries(
    HORIZONS_MINUTES.map(horizon => [
      horizon,
      emptyHorizon(
        horizon,
        minutesPerCandle === null ? horizon : Math.ceil(horizon / minutesPerCandle) * minutesPerCandle,
      ),
    ]),
  ) as Record<CandleResearchHorizon, WalkForwardHorizonResult>;
  const costInputs = validateCosts(input);
  const costs: WalkForwardCandleResearchReport['costs'] = costInputs
    ? {
        ...costInputs,
        roundTripPercent: 2 * (
          costInputs.takerFeeBpsPerSide + costInputs.slippageBpsPerSide
        ) / 100,
        configured: true,
      }

    : {
        configured: false,
        note: 'Set account-specific taker fee and estimated slippage in basis points per side to report net returns.',
      };

  const invalid = (note: string): WalkForwardCandleResearchReport => ({
    status: 'INVALID_INPUT',
    source: 'verified-live-exchange-candles',
    timeframe: input.timeframe || null,
    candleCount: input.candles.length,
    trainingCandleCount: 0,
    testCandleCount: 0,
    trainingCutoffTimestampMs: null,
    similarityThresholdPct: MIN_SIMILARITY_PCT,
    contextSimilarityWeightPct: 30,
    requiredReferenceMatches: MIN_REFERENCE_MATCHES,
    minimumOutOfSampleForecasts: MIN_OUT_OF_SAMPLE_FORECASTS,
    costs,
    horizons: emptyHorizons,
    tradeEligible: false,
    note,
  });
  if (
    minutesPerCandle === null ||
    !Number.isSafeInteger(input.sourceTimestampMs) ||
    !Number.isSafeInteger(input.nowMs ?? Date.now()) ||
    !['LIVE', 'VERIFIED_REALTIME'].includes(input.dataStatus)
  ) return invalid('A valid timeframe, source timestamp, and live/verified data status are required.');
  const nowMs = input.nowMs ?? Date.now();
  const maxAgeMs = minutesPerCandle * 60_000 + 60_000;
  if (
    input.sourceTimestampMs > nowMs ||
    nowMs - input.sourceTimestampMs > maxAgeMs
  ) return invalid('The latest completed candle timestamp is stale or future-dated.');
  const parsed = input.candles.map(normalizeCandle);
  const horizonBars = HORIZONS_MINUTES.map(horizon => Math.ceil(horizon / minutesPerCandle));
  const largestHorizonBars = Math.max(...horizonBars);
  const minimumHistory = CONTEXT_WINDOW_SIZE + PATTERN_WINDOW_SIZE * 2 + largestHorizonBars * 2;
  if (
    parsed.length < minimumHistory ||
    parsed.some(candle => candle === null)
  ) {
    return {
      ...invalid(`At least ${minimumHistory} contiguous valid completed candles are required.`),
      status: 'INSUFFICIENT_HISTORY',
    };
  }

  const candles = parsed as NormalizedCandle[];
  const splitIndex = Math.floor(candles.length * TRAINING_FRACTION);
  const testStarts: number[] = [];
  for (
    let start = Math.max(splitIndex, CONTEXT_WINDOW_SIZE);
    start + PATTERN_WINDOW_SIZE + largestHorizonBars <= candles.length;
    start += PATTERN_WINDOW_SIZE + largestHorizonBars
  ) testStarts.push(start);
  const outputHorizons = { ...emptyHorizons };

  HORIZONS_MINUTES.forEach((horizonMinutes, horizonIndex) => {
    const bars = horizonBars[horizonIndex];
    const spacing = PATTERN_WINDOW_SIZE + bars;
    const referenceWindows: ReferenceWindow[] = [];
    for (let start = CONTEXT_WINDOW_SIZE; start + PATTERN_WINDOW_SIZE + bars <= splitIndex; start += spacing) {
      const features = extractFeatures(candles, start);
      if (!features || features.trend === 0) continue;
      const patternEnd = start + PATTERN_WINDOW_SIZE - 1;
      const futureClose = candles[patternEnd + bars].close;
      const directionSign = features.trend;
      referenceWindows.push({
        features,
        direction: features.trend,
        forwardReturnPct: (futureClose / candles[patternEnd].close - 1) * directionSign * 100,
      });
    }

    const forecasts: TestForecast[] = [];
    for (const start of testStarts) {
      if (start + PATTERN_WINDOW_SIZE + bars > candles.length) continue;
      const query = extractFeatures(candles, start);
      if (!query || query.trend === 0) continue;
      const matches = referenceWindows
        .filter(reference => reference.direction === query.trend)
        .map(reference => ({
          similarityPct: compareFeatures(query, reference.features),
          forwardReturnPct: reference.forwardReturnPct,
        }))
        .filter(match => match.similarityPct >= MIN_SIMILARITY_PCT)
        .sort((left, right) => right.similarityPct - left.similarityPct)
        .slice(0, 5);
      if (matches.length < MIN_REFERENCE_MATCHES) continue;
      const predictedReturn = matches.reduce((sum, match) => sum + match.forwardReturnPct, 0) / matches.length;
      const predictedDirection: -1 | 1 = predictedReturn >= 0 ? 1 : -1;
      const patternEnd = start + PATTERN_WINDOW_SIZE - 1;
      const entry = candles[patternEnd].close;
      const future = candles[patternEnd + bars].close;
      const actualMovePct = (future / entry - 1) * 100 * predictedDirection;
      const futureWindow = candles.slice(patternEnd + 1, patternEnd + bars + 1);
      const favorable = predictedDirection > 0
        ? (Math.max(...futureWindow.map(candle => candle.high)) / entry - 1) * 100
        : (1 - Math.min(...futureWindow.map(candle => candle.low)) / entry) * 100;
      const adverse = predictedDirection > 0
        ? (1 - Math.min(...futureWindow.map(candle => candle.low)) / entry) * 100
        : (Math.max(...futureWindow.map(candle => candle.high)) / entry - 1) * 100;
      forecasts.push({
        similarityPct: matches.reduce((sum, match) => sum + match.similarityPct, 0) / matches.length,
        referenceCount: matches.length,
        predictedDirection,
        grossReturnPct: actualMovePct,
        maximumFavorableMovePct: favorable,
        maximumAdverseMovePct: adverse,
      });
    }

    if (forecasts.length === 0) return;
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const grossReturns = forecasts.map(forecast => forecast.grossReturnPct);
    const roundTripCostPct = costs.configured ? costs.roundTripPercent : null;
    const netReturns = roundTripCostPct === null
      ? null
      : grossReturns.map(value => value - roundTripCostPct);
    const enoughOutOfSampleForecasts = forecasts.length >= MIN_OUT_OF_SAMPLE_FORECASTS;
    const meanCostAdjustedRewardRiskRatio = roundTripCostPct === null
      ? null
      : mean(forecasts.map(forecast =>
          Math.max(0, forecast.maximumFavorableMovePct - roundTripCostPct) /
          Math.max(1e-12, forecast.maximumAdverseMovePct + roundTripCostPct)
        ));
    outputHorizons[horizonMinutes] = {
      horizonMinutes,
      actualHorizonMinutes: bars * minutesPerCandle,
      available: enoughOutOfSampleForecasts,
      outOfSampleForecastCount: forecasts.length,
      forecastsWithEnoughMatches: forecasts.length,
      minimumForecastsForMetrics: MIN_OUT_OF_SAMPLE_FORECASTS,
      averageReferenceMatches: enoughOutOfSampleForecasts
        ? mean(forecasts.map(forecast => forecast.referenceCount))
        : null,
      meanSimilarityPct: enoughOutOfSampleForecasts
        ? mean(forecasts.map(forecast => forecast.similarityPct))
        : null,
      grossDirectionAccuracyPct: enoughOutOfSampleForecasts
        ? grossReturns.filter(value => value > 0).length / grossReturns.length * 100
        : null,
      meanGrossPredictedReturnPct: enoughOutOfSampleForecasts ? mean(grossReturns) : null,
      grossWinRatePct: enoughOutOfSampleForecasts
        ? grossReturns.filter(value => value > 0).length / grossReturns.length * 100
        : null,
      meanNetPredictedReturnPct: !enoughOutOfSampleForecasts || netReturns === null
        ? null
        : mean(netReturns),
      netWinRatePct: !enoughOutOfSampleForecasts || netReturns === null
        ? null
        : netReturns.filter(value => value > 0).length / netReturns.length * 100,
      meanMaximumFavorableMovePct: enoughOutOfSampleForecasts
        ? mean(forecasts.map(forecast => forecast.maximumFavorableMovePct))
        : null,
      meanMaximumAdverseMovePct: enoughOutOfSampleForecasts
        ? mean(forecasts.map(forecast => forecast.maximumAdverseMovePct))
        : null,
      meanCostAdjustedRewardRiskRatio:
        enoughOutOfSampleForecasts ? meanCostAdjustedRewardRiskRatio : null,
    };
  });

  const availableHorizons = Object.values(outputHorizons).filter(result => result.available).length;
  return {
    status: availableHorizons > 0 ? 'AVAILABLE' : 'INSUFFICIENT_EVIDENCE',
    source: 'verified-live-exchange-candles',
    timeframe: input.timeframe,
    candleCount: candles.length,
    trainingCandleCount: splitIndex,
    testCandleCount: candles.length - splitIndex,
    trainingCutoffTimestampMs: input.sourceTimestampMs -
      (candles.length - splitIndex - 1) * minutesPerCandle * 60_000,
    similarityThresholdPct: MIN_SIMILARITY_PCT,
    contextSimilarityWeightPct: 30,
    requiredReferenceMatches: MIN_REFERENCE_MATCHES,
    minimumOutOfSampleForecasts: MIN_OUT_OF_SAMPLE_FORECASTS,
    costs,
    horizons: outputHorizons,
    tradeEligible: false,
    note: availableHorizons > 0
      ? 'Chronological 70/30 holdout; each test pattern uses reference outcomes available before the training cutoff. Gross results exclude funding and market-impact costs; net results include only configured taker fees and slippage. Advisory research cannot authorize trades.'
      : 'Fewer than the minimum independent out-of-sample forecasts were available for reliable metrics, or no test queries found enough context-compatible references. No predictive edge is claimed.',
  };
}
