import type { Candle } from '../types/trading';

const PATTERN_WINDOW_SIZE = 12;
const MIN_INDEPENDENT_MATCHES = 20;
const SIMILARITY_THRESHOLD_PCT = 85;

export interface HistoricalCandleRepeatReport {
  status: 'AVAILABLE' | 'INSUFFICIENT_HISTORY' | 'INVALID_INPUT';
  timeframe: string | null;
  forwardHorizonMinutes: number | null;
  comparedHistoricalWindows: number;
  similarSampleCount: number;
  bestSimilarityPct: number | null;
  bestMatchWindowStartIndex: number | null;
  matchingWindowStartIndices: number[];
  similarityThresholdPct: number;
  meanSimilarityPct: number | null;
  grossWinRatePct: number | null;
  meanForwardReturnPct: number | null;
  medianForwardReturnPct: number | null;
  meanMaximumFavorableMovePct: number | null;
  meanMaximumAdverseMovePct: number | null;
  samplesRequired: number;
  tradeEligible: false;
  note: string;
}

export interface HistoricalCandleRepeatContext {
  candles: Candle[];
  timeframe?: string;
  dataStatus?: string;
  candleFeedStatus?: string;
  candleFeedTimestampMs?: number;
  nowMs?: number;
  direction: 'BULLISH' | 'BEARISH';
}

interface NormalizedCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface HistoricalMatch {
  windowStartIndex: number;
  similarityPct: number;
  forwardReturnPct: number;
  maximumFavorableMovePct: number;
  maximumAdverseMovePct: number;
}

function unavailable(
  status: HistoricalCandleRepeatReport['status'],
  timeframe: string | null,
  forwardHorizonMinutes: number | null,
  comparedHistoricalWindows: number,
  similarSampleCount: number,
  bestSimilarityPct: number | null,
  bestMatchWindowStartIndex: number | null,
  matchingWindowStartIndices: number[],
  note: string,
): HistoricalCandleRepeatReport {
  return {
    status,
    timeframe,
    forwardHorizonMinutes,
    comparedHistoricalWindows,
    similarSampleCount,
    bestSimilarityPct,
    bestMatchWindowStartIndex,
    matchingWindowStartIndices,
    similarityThresholdPct: SIMILARITY_THRESHOLD_PCT,
    meanSimilarityPct: null,
    grossWinRatePct: null,
    meanForwardReturnPct: null,
    medianForwardReturnPct: null,
    meanMaximumFavorableMovePct: null,
    meanMaximumAdverseMovePct: null,
    samplesRequired: MIN_INDEPENDENT_MATCHES,
    tradeEligible: false,
    note,
  };
}

function timeframeMinutes(timeframe: string): number | null {
  const match = /^(\d+)(m|h|d|w)$/.exec(timeframe);
  if (!match) return null;
  const amount = Number(match[1]);
  const unitMinutes: Record<string, number> = {
    m: 1,
    h: 60,
    d: 1_440,
    w: 10_080,
  };
  const minutes = amount * unitMinutes[match[2]];
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

function normalizeCandle(candle: Candle): NormalizedCandle | null {
  const timestamped = candle.length === 6;
  const offset = timestamped ? 1 : 0;
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

function windowFeatures(window: NormalizedCandle[]): number[][] {
  const rangeMedian = median(window.map(candle => Math.max(candle.high - candle.low, candle.close * 1e-8)));
  const volumeMedian = median(window.map(candle => candle.volume)) || 1;
  return window.map(candle => {
    const range = Math.max(candle.high - candle.low, candle.close * 1e-8);
    const body = (candle.close - candle.open) / range;
    const upperWick = (candle.high - Math.max(candle.open, candle.close)) / range;
    const lowerWick = (Math.min(candle.open, candle.close) - candle.low) / range;
    const rangeScale = Math.tanh(Math.log(range / rangeMedian));
    const volumeScale = Math.tanh(Math.log((candle.volume + volumeMedian * 1e-8) / volumeMedian));
    return [body, upperWick, lowerWick, rangeScale, volumeScale];
  });
}

function similarityPct(left: number[][], right: number[][]): number {
  let absoluteError = 0;
  let featureCount = 0;
  for (let row = 0; row < PATTERN_WINDOW_SIZE; row += 1) {
    for (let column = 0; column < left[row].length; column += 1) {
      absoluteError += Math.abs(left[row][column] - right[row][column]);
      featureCount += 1;
    }
  }
  return Math.max(0, 100 * (1 - absoluteError / (featureCount * 2)));
}

function summarize(matches: HistoricalMatch[]): Pick<
  HistoricalCandleRepeatReport,
  | 'meanSimilarityPct'
  | 'grossWinRatePct'
  | 'meanForwardReturnPct'
  | 'medianForwardReturnPct'
  | 'meanMaximumFavorableMovePct'
  | 'meanMaximumAdverseMovePct'
> {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const returns = matches.map(match => match.forwardReturnPct);
  return {
    meanSimilarityPct: mean(matches.map(match => match.similarityPct)),
    grossWinRatePct: matches.filter(match => match.forwardReturnPct > 0).length / matches.length * 100,
    meanForwardReturnPct: mean(returns),
    medianForwardReturnPct: median(returns),
    meanMaximumFavorableMovePct: mean(matches.map(match => match.maximumFavorableMovePct)),
    meanMaximumAdverseMovePct: mean(matches.map(match => match.maximumAdverseMovePct)),
  };
}

export function analyzeHistoricalCandleRepeats(
  candles: Candle[],
  timeframeValue: string | undefined,
  direction: 'BULLISH' | 'BEARISH',
): HistoricalCandleRepeatReport {
  const timeframe = typeof timeframeValue === 'string' ? timeframeValue : null;
  const minutesPerCandle = timeframe ? timeframeMinutes(timeframe) : null;
  if (minutesPerCandle === null) {
    return unavailable(
      'INVALID_INPUT',
      timeframe,
      null,
      0,
      0,
      null,
      null,
      [],
      'A valid candle timeframe is required; historical performance is not inferred.',
    );
  }

  const horizonBars = Math.ceil(30 / minutesPerCandle);
  const forwardHorizonMinutes = horizonBars * minutesPerCandle;
  const parsed = candles.map(normalizeCandle);
  if (parsed.length < PATTERN_WINDOW_SIZE * 2 + horizonBars || parsed.some(candle => candle === null)) {
    return unavailable(
      'INSUFFICIENT_HISTORY',
      timeframe,
      forwardHorizonMinutes,
      0,
      0,
      null,
      null,
      [],
      'Insufficient complete OHLCV history for an independent repeated-pattern comparison.',
    );
  }
  const history = parsed as NormalizedCandle[];
  const currentStart = history.length - PATTERN_WINDOW_SIZE;
  const currentFeatures = windowFeatures(history.slice(currentStart));
  const directionSign = direction === 'BULLISH' ? 1 : -1;
  const minimumSpacing = PATTERN_WINDOW_SIZE + horizonBars;
  const historicalMatches: HistoricalMatch[] = [];
  let comparedHistoricalWindows = 0;
  let bestSimilarityPct: number | null = null;
  let bestMatchWindowStartIndex: number | null = null;

  for (
    let start = 0;
    start + PATTERN_WINDOW_SIZE + horizonBars <= currentStart;
    start += minimumSpacing
  ) {
    const patternEnd = start + PATTERN_WINDOW_SIZE - 1;
    const forwardEnd = patternEnd + horizonBars;
    const candidateFeatures = windowFeatures(history.slice(start, patternEnd + 1));
    const score = similarityPct(currentFeatures, candidateFeatures);
    comparedHistoricalWindows += 1;
    if (bestSimilarityPct === null || score > bestSimilarityPct) {
      bestSimilarityPct = score;
      bestMatchWindowStartIndex = start;
    }
    if (score < SIMILARITY_THRESHOLD_PCT) continue;

    const entryPrice = history[patternEnd].close;
    const exitPrice = history[forwardEnd].close;
    const forwardReturnPct = ((exitPrice - entryPrice) / entryPrice) * directionSign * 100;
    const forwardCandles = history.slice(patternEnd + 1, forwardEnd + 1);
    const maximumFavorableMovePct = directionSign > 0
      ? (Math.max(...forwardCandles.map(candle => candle.high)) - entryPrice) / entryPrice * 100
      : (entryPrice - Math.min(...forwardCandles.map(candle => candle.low))) / entryPrice * 100;
    const maximumAdverseMovePct = directionSign > 0
      ? (entryPrice - Math.min(...forwardCandles.map(candle => candle.low))) / entryPrice * 100
      : (Math.max(...forwardCandles.map(candle => candle.high)) - entryPrice) / entryPrice * 100;
    historicalMatches.push({
      windowStartIndex: start,
      similarityPct: score,
      forwardReturnPct,
      maximumFavorableMovePct,
      maximumAdverseMovePct,
    });
  }

  if (historicalMatches.length < MIN_INDEPENDENT_MATCHES) {
    return unavailable(
      'INSUFFICIENT_HISTORY',
      timeframe,
      forwardHorizonMinutes,
      comparedHistoricalWindows,
      historicalMatches.length,
      bestSimilarityPct,
      bestMatchWindowStartIndex,
      historicalMatches.map(({ windowStartIndex }) => windowStartIndex),
      `Found ${historicalMatches.length} independent matches; at least ${MIN_INDEPENDENT_MATCHES} are required before historical outcome statistics are reported.`,
    );
  }

  return {
    status: 'AVAILABLE',
    timeframe,
    forwardHorizonMinutes,
    comparedHistoricalWindows,
    similarSampleCount: historicalMatches.length,
    bestSimilarityPct,
    bestMatchWindowStartIndex,
    matchingWindowStartIndices: historicalMatches.map(({ windowStartIndex }) => windowStartIndex),
    similarityThresholdPct: SIMILARITY_THRESHOLD_PCT,
    ...summarize(historicalMatches),
    samplesRequired: MIN_INDEPENDENT_MATCHES,
    tradeEligible: false,
    note: 'Historical gross outcomes only; fees, slippage, funding, out-of-sample validation, and execution effects are not included. Advisory evidence cannot authorize a trade.',
  };
}

export function analyzeVerifiedHistoricalCandleRepeats(
  context: HistoricalCandleRepeatContext,
): HistoricalCandleRepeatReport {
  const timeframe = context.timeframe ?? null;
  const minutesPerCandle = timeframe ? timeframeMinutes(timeframe) : null;
  const nowMs = context.nowMs ?? Date.now();
  const maxAgeMs = minutesPerCandle === null ? 0 : minutesPerCandle * 60_000 + 60_000;
  const feedAgeMs = context.candleFeedTimestampMs === undefined
    ? Number.NaN
    : nowMs - context.candleFeedTimestampMs;
  const verifiedLiveFeed =
    (context.dataStatus === 'LIVE' || context.dataStatus === 'VERIFIED_REALTIME') &&
    (context.candleFeedStatus === 'LIVE' || context.candleFeedStatus === 'VERIFIED_REALTIME') &&
    Number.isSafeInteger(context.candleFeedTimestampMs) &&
    feedAgeMs >= 0 &&
    feedAgeMs <= maxAgeMs;
  if (!verifiedLiveFeed) {
    return unavailable(
      'INVALID_INPUT',
      timeframe,
      minutesPerCandle === null ? null : Math.ceil(30 / minutesPerCandle) * minutesPerCandle,
      0,
      0,
      null,
      null,
      [],
      'A fresh, provenance-verified live candle feed is required; heuristic or stale candles are excluded.',
    );
  }
  return analyzeHistoricalCandleRepeats(context.candles, timeframe ?? undefined, context.direction);
}
