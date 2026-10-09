import { AdvancedRegimeType, Candle } from '../types/trading';

const REGIMES: AdvancedRegimeType[] = [
  'PANIC',
  'NEWS_WHIPSAW',
  'MEAN_REVERSION',
  'COMPRESSION',
  'EXPANSION',
  'HIGH_VOLATILITY',
  'BREAKOUT',
  'TREND',
  'RANGE',
];
const HORIZON_CANDLES = 20;
const FEATURE_COUNT = 8;
const MODEL_VERSION = 'regime-softmax-logistic-oos-v1';

export interface RegimeFeatures {
  adx: number;
  atrRatio: number;
  bollingerBandWidthPct: number;
  vwapDeviationStd: number;
  volumeSurgeRatio: number;
  whipsawWickRatio: number;
  trendAlignmentScore: number;
  priceChangeLast5: number;
}

interface TrainingSample {
  index: number;
  features: number[];
  label: number;
}

export interface RegimeProbabilityModelResult {
  activeRegime: AdvancedRegimeType;
  probabilities: Record<AdvancedRegimeType, number>;
  validation: {
    status: 'CALIBRATED' | 'UNCALIBRATED';
    modelVersion: string;
    horizonCandles: number;
    trainingSampleSize: number;
    calibrationSampleSize: number;
    oosSampleSize: number;
    oosBrierScore: number | null;
    baselineBrierScore: number | null;
  };
}

function normalizeFeatures(features: RegimeFeatures): number[] {
  return [
    features.adx / 50,
    features.atrRatio,
    features.bollingerBandWidthPct / 4,
    features.vwapDeviationStd / 3,
    features.volumeSurgeRatio / 3,
    features.whipsawWickRatio / 3,
    features.trendAlignmentScore / 100,
    features.priceChangeLast5 / 3,
  ].map(value => Math.max(-5, Math.min(5, Number.isFinite(value) ? value : 0)));
}

export function deriveRegimeFeatures(candles: Candle[]): RegimeFeatures | null {
  if (candles.length < 20) return null;
  const closes = candles.map(candle => candle[3]);
  const highs = candles.map(candle => candle[1]);
  const lows = candles.map(candle => candle[2]);
  const volumes = candles.map(candle => candle[4]);
  if ([...closes, ...highs, ...lows, ...volumes].some(value => !Number.isFinite(value))) return null;

  const price = closes[closes.length - 1];
  if (price <= 0) return null;
  const ranges = candles.slice(-30).map(candle => candle[1] - candle[2]);
  const avgRange = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
  if (!Number.isFinite(avgRange) || avgRange <= 0) return null;
  const atr = candles.slice(-14).reduce((sum, candle) => sum + candle[1] - candle[2], 0) / Math.min(14, candles.length);

  const recentCloses = closes.slice(-20);
  const meanClose = recentCloses.reduce((sum, value) => sum + value, 0) / recentCloses.length;
  const variance = recentCloses.reduce((sum, value) => sum + (value - meanClose) ** 2, 0) / recentCloses.length;
  const bollingerBandWidthPct = meanClose > 0 ? (4 * Math.sqrt(variance) / meanClose) * 100 : 0;

  const recentCandles = candles.slice(-20);
  const volumeSum = recentCandles.reduce((sum, candle) => sum + candle[4], 0);
  const vwap = volumeSum > 0
    ? recentCandles.reduce((sum, candle) => sum + ((candle[1] + candle[2] + candle[3]) / 3) * candle[4], 0) / volumeSum
    : meanClose;

  let plusDm = 0;
  let minusDm = 0;
  let trueRange = 0;
  for (let i = Math.max(1, candles.length - 14); i < candles.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDm += upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm += downMove > upMove && downMove > 0 ? downMove : 0;
    trueRange += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const plusDi = trueRange > 0 ? (plusDm / trueRange) * 100 : 0;
  const minusDi = trueRange > 0 ? (minusDm / trueRange) * 100 : 0;
  const adx = plusDi + minusDi > 0 ? (Math.abs(plusDi - minusDi) / (plusDi + minusDi)) * 100 : 0;
  const ema20Approx = closes.slice(-20).reduce((sum, value) => sum + value, 0) / 20;
  const ema50Approx = closes.slice(-50).reduce((sum, value) => sum + value, 0) / Math.min(50, closes.length);
  const trendAlignmentScore = price > ema20Approx && ema20Approx > ema50Approx
    ? Math.min(100, Math.round(adx * 2.5))
    : price < ema20Approx && ema20Approx < ema50Approx
      ? -Math.min(100, Math.round(adx * 2.5))
      : 0;
  const avgVol = recentCandles.reduce((sum, candle) => sum + candle[4], 0) / recentCandles.length;
  const wickCandles = candles.slice(-5);
  const wickAndBody = wickCandles.reduce((acc, candle) => {
    const range = candle[1] - candle[2];
    const body = Math.abs(candle[3] - candle[0]);
    acc.wicks += range - body;
    acc.bodies += Math.max(1, body);
    return acc;
  }, { wicks: 0, bodies: 0 });

  return {
    adx,
    atrRatio: atr / avgRange,
    bollingerBandWidthPct,
    vwapDeviationStd: Math.abs(price - vwap) / atr,
    volumeSurgeRatio: avgVol > 0 ? volumes[volumes.length - 1] / avgVol : 0,
    whipsawWickRatio: wickAndBody.wicks / wickAndBody.bodies,
    trendAlignmentScore,
    priceChangeLast5: closes.length >= 6
      ? ((price - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
      : 0,
  };
}

function scoreRegime(features: RegimeFeatures): number[] {
  const scores = REGIMES.map(() => 0);
  const byRegime = (regime: AdvancedRegimeType, score: number) => {
    scores[REGIMES.indexOf(regime)] = Math.max(0, score);
  };
  const { adx, atrRatio, bollingerBandWidthPct, vwapDeviationStd, volumeSurgeRatio, whipsawWickRatio, trendAlignmentScore, priceChangeLast5 } = features;

  if (priceChangeLast5 < -1) {
    byRegime('PANIC', Math.min(5, Math.abs(priceChangeLast5)) * 1.8 + (volumeSurgeRatio > 1.5 ? volumeSurgeRatio * 1.5 : 0));
  }
  if (whipsawWickRatio > 1.2) {
    byRegime('NEWS_WHIPSAW', (whipsawWickRatio - 1) * 3.5 + (volumeSurgeRatio > 1.3 ? volumeSurgeRatio * 1.8 : 0));
  }
  if (vwapDeviationStd > 1.2) {
    byRegime('MEAN_REVERSION', vwapDeviationStd ** 1.6 * 2.2 + (adx < 25 ? (25 - adx) * 0.15 : 0));
  }
  if (bollingerBandWidthPct < 2 && atrRatio < 0.95) {
    byRegime('COMPRESSION', (2.2 - Math.min(2, bollingerBandWidthPct)) * 4 + (1 - Math.min(0.95, atrRatio)) * 3.5);
  }
  if (atrRatio > 1.15 && Math.abs(priceChangeLast5) > 0.6) {
    byRegime('EXPANSION', (atrRatio - 1) * 3.2 + (volumeSurgeRatio > 1.2 ? (volumeSurgeRatio - 1) * 2.5 : 0));
  }
  if (atrRatio > 1.4 || bollingerBandWidthPct > 3.2) {
    byRegime('HIGH_VOLATILITY', (atrRatio > 1.4 ? (atrRatio - 1.4) * 4 : 0) + (bollingerBandWidthPct > 3 ? (bollingerBandWidthPct - 3) * 1.5 : 0));
  }
  if (volumeSurgeRatio > 1.3 && Math.abs(priceChangeLast5) > 0.7) {
    byRegime('BREAKOUT', (volumeSurgeRatio - 1) * 2.8 + Math.abs(priceChangeLast5) * 1.8 + (adx > 20 ? (adx - 20) * 0.12 : 0));
  }
  if (adx >= 18 && Math.abs(trendAlignmentScore) >= 20) {
    byRegime('TREND', (adx / 10) * 2.2 + (Math.abs(trendAlignmentScore) / 100) * 4.5 + (atrRatio >= 0.9 && atrRatio <= 1.5 ? 1.5 : 0));
  }
  if (adx < 26) {
    byRegime('RANGE', (26 - adx) * 0.25 + Math.max(0, 1.2 - Math.abs(atrRatio - 1)) * 2 + (Math.abs(trendAlignmentScore) < 25 ? 2.5 : 0));
  }
  if (Math.max(...scores) === 0) byRegime('RANGE', 0.08);
  return scores;
}

function softmax(logits: number[], temperature = 1): number[] {
  const maxLogit = Math.max(...logits);
  const exponents = logits.map(value => Math.exp((value - maxLogit) / temperature));
  const total = exponents.reduce((sum, value) => sum + value, 0);
  return exponents.map(value => value / total);
}

function fitModel(samples: TrainingSample[]): { weights: number[][]; priors: number[] } | null {
  const counts = REGIMES.map((_, classIndex) => samples.filter(sample => sample.label === classIndex).length);
  if (counts.filter(count => count > 0).length < 2) return null;
  const priors = counts.map(count => (count + 0.5) / (samples.length + REGIMES.length * 0.5));
  const weights = REGIMES.map((_, classIndex) => [
    Math.log(priors[classIndex]),
    ...Array(FEATURE_COUNT).fill(0),
  ]);

  for (let epoch = 0; epoch < 160; epoch++) {
    const gradients = weights.map(() => Array(FEATURE_COUNT + 1).fill(0));
    for (const sample of samples) {
      const probabilities = softmax(weights.map(row => row[0] + row.slice(1).reduce((sum, weight, index) => sum + weight * sample.features[index], 0)));
      for (let classIndex = 0; classIndex < REGIMES.length; classIndex++) {
        const error = probabilities[classIndex] - Number(sample.label === classIndex);
        gradients[classIndex][0] += error;
        for (let featureIndex = 0; featureIndex < FEATURE_COUNT; featureIndex++) {
          gradients[classIndex][featureIndex + 1] += error * sample.features[featureIndex];
        }
      }
    }
    const learningRate = 0.08 / Math.sqrt(1 + epoch / 40);
    for (let classIndex = 0; classIndex < REGIMES.length; classIndex++) {
      for (let index = 0; index < weights[classIndex].length; index++) {
        const regularization = index === 0 ? 0 : 0.002 * weights[classIndex][index];
        weights[classIndex][index] -= learningRate * (gradients[classIndex][index] / samples.length + regularization);
      }
    }
  }
  return { weights, priors };
}

function predict(model: { weights: number[][] }, features: number[], temperature = 1): number[] {
  return softmax(model.weights.map(row => row[0] + row.slice(1).reduce((sum, weight, index) => sum + weight * features[index], 0)), temperature);
}

function brierScore(samples: TrainingSample[], model: { weights: number[][] }, temperature: number): number {
  return samples.reduce((sum, sample) => {
    const probabilities = predict(model, sample.features, temperature);
    return sum + probabilities.reduce((classSum, probability, classIndex) => classSum + (probability - Number(sample.label === classIndex)) ** 2, 0);
  }, 0) / samples.length;
}

export function classifyFutureRegime(
  candles: Candle[],
  currentFeatures: RegimeFeatures,
): RegimeProbabilityModelResult {
  const samples: TrainingSample[] = [];
  for (let index = 50; index + HORIZON_CANDLES <= candles.length; index++) {
    const historicalFeatures = deriveRegimeFeatures(candles.slice(Math.max(0, index - 50), index));
    const futureFeatures = deriveRegimeFeatures(candles.slice(index, index + HORIZON_CANDLES));
    if (!historicalFeatures || !futureFeatures) continue;
    const targetScores = scoreRegime(futureFeatures);
    const label = targetScores.indexOf(Math.max(...targetScores));
    samples.push({ index, features: normalizeFeatures(historicalFeatures), label });
  }

  if (candles.length < 300 || samples.length < 100) {
    throw new Error('Regime model requires at least 300 valid real candles for time-separated training, calibration, and OOS evaluation.');
  }

  const trainBoundary = Math.floor(candles.length * 0.6);
  const calibrationBoundary = Math.floor(candles.length * 0.8);
  const training = samples.filter(sample => sample.index < trainBoundary - HORIZON_CANDLES);
  const calibration = samples.filter(sample => sample.index >= trainBoundary + HORIZON_CANDLES && sample.index <= calibrationBoundary - HORIZON_CANDLES);
  const oos = samples.filter(sample => sample.index >= calibrationBoundary + HORIZON_CANDLES);
  const model = fitModel(training);
  if (!model) {
    throw new Error('Regime model cannot fit: historical OOS labels contain fewer than two observed regime classes.');
  }

  let temperature = 1;
  if (calibration.length > 0) {
    let bestLoss = Number.POSITIVE_INFINITY;
    for (let candidate = 0.5; candidate <= 3; candidate += 0.05) {
      const loss = calibration.reduce((sum, sample) => {
        const probability = predict(model, sample.features, candidate)[sample.label];
        return sum - Math.log(Math.max(Number.EPSILON, probability));
      }, 0) / calibration.length;
      if (loss < bestLoss) {
        bestLoss = loss;
        temperature = candidate;
      }
    }
  }

  const oosBrierScore = oos.length > 0 ? brierScore(oos, model, temperature) : null;
  const baselineBrierScore = oos.length > 0
    ? oos.reduce((sum, sample) => sum + model.priors.reduce((classSum, prior, classIndex) => classSum + (prior - Number(sample.label === classIndex)) ** 2, 0), 0) / oos.length
    : null;
  const isCalibrated =
    training.length >= 50 &&
    calibration.length >= 20 &&
    oos.length >= 20 &&
    oosBrierScore !== null &&
    baselineBrierScore !== null &&
    oosBrierScore < baselineBrierScore;
  const probabilities = predict(model, normalizeFeatures(currentFeatures), isCalibrated ? temperature : 1);
  const maxIndex = probabilities.indexOf(Math.max(...probabilities));
  const output = Object.fromEntries(REGIMES.map((regime, index) => [regime, probabilities[index] * 100])) as Record<AdvancedRegimeType, number>;
  const rounded = Object.fromEntries(REGIMES.map(regime => [regime, Math.round(output[regime] * 10) / 10])) as Record<AdvancedRegimeType, number>;
  const roundDiff = Math.round((100 - Object.values(rounded).reduce((sum, probability) => sum + probability, 0)) * 10) / 10;
  rounded[REGIMES[maxIndex]] = Math.round((rounded[REGIMES[maxIndex]] + roundDiff) * 10) / 10;

  return {
    activeRegime: REGIMES[maxIndex],
    probabilities: rounded,
    validation: {
      status: isCalibrated ? 'CALIBRATED' : 'UNCALIBRATED',
      modelVersion: MODEL_VERSION,
      horizonCandles: HORIZON_CANDLES,
      trainingSampleSize: training.length,
      calibrationSampleSize: calibration.length,
      oosSampleSize: oos.length,
      oosBrierScore: oosBrierScore === null ? null : Math.round(oosBrierScore * 10000) / 10000,
      baselineBrierScore: baselineBrierScore === null ? null : Math.round(baselineBrierScore * 10000) / 10000,
    },
  };
}
