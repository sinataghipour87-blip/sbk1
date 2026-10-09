import { AdvancedRegimeType, MetaLearnerInputFeatures } from '../types/trading';
import { PredictionDatasetRecord } from './centralTradeDataset';

const REGIMES: AdvancedRegimeType[] = [
  'TREND',
  'RANGE',
  'BREAKOUT',
  'COMPRESSION',
  'EXPANSION',
  'HIGH_VOLATILITY',
  'PANIC',
  'MEAN_REVERSION',
  'NEWS_WHIPSAW',
];
const SETUPS = [
  'PULLBACK_ENTRY',
  'BREAKOUT_RETEST',
  'LIQUIDITY_SWEEP_RECLAIM',
  'FVG_RETRACEMENT',
  'ORDER_BLOCK_RETEST',
  'VWAP_RECLAIM_REJECTION',
  'MOMENTUM_CONTINUATION',
];
const FEATURE_COUNT = REGIMES.length + SETUPS.length + 16;

interface LabeledSnapshot {
  timestamp: number;
  features: number[];
  label: number;
  r: number | null;
}

export interface EmpiricalMetaProbabilityResult {
  probability: number | null;
  status: 'CALIBRATED' | 'UNCALIBRATED';
  trainingSampleSize: number;
  calibrationSampleSize: number;
  oosSampleSize: number;
  oosBrierScore: number | null;
  baselineBrierScore: number | null;
  averageWinR: number | null;
  averageLossR: number | null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeSetup(setupType: string | null): string | null {
  if (!setupType) return null;
  const normalized = setupType.toUpperCase();
  const aliases: Record<string, string> = {
    LIQUIDITY_SWEEP_REVERSAL: 'LIQUIDITY_SWEEP_RECLAIM',
    FVG_EQUILIBRIUM_PULLBACK: 'FVG_RETRACEMENT',
    VWAP_MSS_CONTINUATION: 'MOMENTUM_CONTINUATION',
    PULLBACK: 'PULLBACK_ENTRY',
  };
  const resolved = aliases[normalized] ?? normalized;
  return SETUPS.includes(resolved) ? resolved : null;
}

function buildFeatures(
  regimeProbabilities: Record<AdvancedRegimeType, number> | null,
  setupType: string | null,
  direction: 'LONG' | 'SHORT',
  obi: number | null,
  cvd: number | null,
  volatilityPct: number | null,
  bidDepthUsd: number | null,
  askDepthUsd: number | null,
  spreadBps: number | null,
  modelAgreementPct: number | null,
  latencyMs: number | null,
  rsi: number | null,
  adx: number | null,
  ensembleProbability: number | null,
  calibrationErrorPct: number | null,
  signalAgeMs: number | null,
  oiValue: number | null,
  oiChangePct: number | null,
  fundingRate: number | null
): number[] | null {
  const resolvedSetup = normalizeSetup(setupType);
  if (
    !regimeProbabilities ||
    !resolvedSetup ||
    !finite(obi) ||
    !finite(cvd) ||
    !finite(volatilityPct) ||
    !finite(bidDepthUsd) ||
    !finite(askDepthUsd) ||
    !finite(spreadBps) ||
    !finite(modelAgreementPct) ||
    !finite(latencyMs) ||
    !finite(rsi) ||
    !finite(adx) ||
    !finite(ensembleProbability) ||
    !finite(calibrationErrorPct) ||
    !finite(signalAgeMs) ||
    !finite(oiValue) ||
    !finite(oiChangePct) ||
    !finite(fundingRate)
  ) return null;

  const probabilities = REGIMES.map(regime => regimeProbabilities[regime]);
  const totalProbability = probabilities.reduce((sum, value) => sum + value, 0);
  if (
    probabilities.some(value => !finite(value) || value < 0 || value > 100) ||
    Math.abs(totalProbability - 100) > 0.2 ||
    bidDepthUsd < 0 ||
    askDepthUsd < 0 ||
    volatilityPct < 0 ||
    spreadBps < 0 ||
    latencyMs < 0 ||
    rsi < 0 ||
    rsi > 100 ||
    adx < 0 ||
    ensembleProbability < 0 ||
    ensembleProbability > 1 ||
    calibrationErrorPct < 0 ||
    calibrationErrorPct > 100 ||
    signalAgeMs < 0 ||
    oiValue < 0
  ) return null;

  return [
    ...probabilities.map(value => value / 100),
    ...SETUPS.map(setup => Number(resolvedSetup === setup)),
    direction === 'LONG' ? 1 : -1,
    Math.max(-1, Math.min(1, obi)),
    Math.max(-5, Math.min(5, cvd / 1_000_000_000)),
    Math.min(10, volatilityPct) / 10,
    Math.log1p(bidDepthUsd + askDepthUsd) / 25,
    Math.min(100, spreadBps) / 100,
    Math.max(0, Math.min(100, modelAgreementPct)) / 100,
    Math.min(2000, latencyMs) / 2000,
    rsi / 100,
    Math.min(100, adx) / 100,
    ensembleProbability,
    Math.min(100, calibrationErrorPct) / 100,
    Math.min(5000, signalAgeMs) / 5000,
    Math.log1p(oiValue) / 30,
    Math.max(-100, Math.min(100, oiChangePct)) / 100,
    Math.max(-1, Math.min(1, fundingRate)),
  ];
}

function historicalFeatures(record: PredictionDatasetRecord, direction: 'LONG' | 'SHORT'): number[] | null {
  if (record.features.regimeModelCalibrated !== true) return null;
  return buildFeatures(
    record.features.regimeProbabilities ?? null,
    record.setupType,
    direction,
    record.features.obi ?? null,
    record.CVD,
    record.volatility,
    record.orderBookState.bidDepthUsd,
    record.orderBookState.askDepthUsd,
    record.spread,
    record.features.modelAgreementPct ?? null,
    record.latency,
    record.features.rsi ?? null,
    record.features.adx ?? null,
    record.probability,
    record.features.calibrationErrorPct ?? null,
    record.features.signalAgeMs ?? null,
    record.OI,
    record.features.oiChangePct ?? null,
    record.funding,
  );
}

function sigmoid(value: number): number {
  const bounded = Math.max(-30, Math.min(30, value));
  return 1 / (1 + Math.exp(-bounded));
}

function fit(samples: LabeledSnapshot[]): number[] | null {
  if (samples.length === 0 || new Set(samples.map(sample => sample.label)).size < 2) return null;
  const winRate = samples.reduce((sum, sample) => sum + sample.label, 0) / samples.length;
  const weights = [Math.log(winRate / (1 - winRate)), ...Array(FEATURE_COUNT).fill(0)];
  for (let epoch = 0; epoch < 240; epoch++) {
    const gradients = Array(FEATURE_COUNT + 1).fill(0);
    for (const sample of samples) {
      const prediction = sigmoid(weights[0] + sample.features.reduce((sum, value, index) => sum + value * weights[index + 1], 0));
      const error = prediction - sample.label;
      gradients[0] += error;
      for (let index = 0; index < FEATURE_COUNT; index++) gradients[index + 1] += error * sample.features[index];
    }
    const learningRate = 0.08 / Math.sqrt(1 + epoch / 60);
    for (let index = 0; index < weights.length; index++) {
      const regularization = index === 0 ? 0 : 0.005 * weights[index];
      weights[index] -= learningRate * (gradients[index] / samples.length + regularization);
    }
  }
  return weights;
}

function predict(weights: number[], features: number[], temperature = 1): number {
  return sigmoid((weights[0] + features.reduce((sum, value, index) => sum + value * weights[index + 1], 0)) / temperature);
}

function brierScore(samples: LabeledSnapshot[], weights: number[], temperature: number): number {
  return samples.reduce((sum, sample) => sum + (predict(weights, sample.features, temperature) - sample.label) ** 2, 0) / samples.length;
}

export function predictEmpiricalMetaProbability(
  records: PredictionDatasetRecord[],
  inputs: MetaLearnerInputFeatures,
  direction: 'LONG' | 'SHORT',
  ensembleProbability: number | null
): EmpiricalMetaProbabilityResult {
  const currentFeatures = buildFeatures(
    inputs.regimeProbabilities ?? null,
    inputs.setupType ?? null,
    direction,
    inputs.orderBookFeature?.obi ?? null,
    inputs.cvdFeature?.cvdDelta ?? null,
    inputs.volatilityPct,
    inputs.orderBookFeature?.bidDepthUsd ?? null,
    inputs.orderBookFeature?.askDepthUsd ?? null,
    inputs.spreadBps,
    100 - inputs.disagreementIndex,
    inputs.latencyMs,
    inputs.momentumFeature?.rsi ?? null,
    inputs.momentumFeature?.adx ?? null,
    ensembleProbability,
    inputs.calibrationErrorPct ?? null,
    inputs.signalAgeMs ?? null,
    inputs.oiFeature?.oiValue ?? null,
    inputs.oiFeature?.oiChangePct ?? null,
    inputs.fundingFeature?.fundingRate ?? null,
  );
  const samples = records
    .filter(record => (record.outcome === 'WIN' || record.outcome === 'LOSS') &&
      (record.executionStatus === 'EXECUTED_FILLED' || record.executionStatus === 'CLOSED_COMPLETED'))
    .map(record => {
      if (record.direction !== 'LONG' && record.direction !== 'SHORT') return null;
      const features = historicalFeatures(record, record.direction);
      return features
        ? { timestamp: record.timestamp, features, label: Number(record.outcome === 'WIN'), r: finite(record.R) ? record.R : null }
        : null;
    })
    .filter((sample): sample is LabeledSnapshot => sample !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  const firstBoundary = Math.floor(samples.length * 0.6);
  const secondBoundary = Math.floor(samples.length * 0.8);
  const training = samples.slice(0, firstBoundary);
  const calibration = samples.slice(firstBoundary, secondBoundary);
  const oos = samples.slice(secondBoundary);
  const model = training.length >= 50 ? fit(training) : null;
  let temperature = 1;

  if (model && calibration.length >= 20 && new Set(calibration.map(sample => sample.label)).size === 2) {
    let lowestLoss = Number.POSITIVE_INFINITY;
    for (let candidate = 0.5; candidate <= 3; candidate += 0.05) {
      const loss = calibration.reduce((sum, sample) => {
        const probability = predict(model, sample.features, candidate);
        return sum - (sample.label * Math.log(Math.max(Number.EPSILON, probability)) +
          (1 - sample.label) * Math.log(Math.max(Number.EPSILON, 1 - probability)));
      }, 0) / calibration.length;
      if (loss < lowestLoss) {
        lowestLoss = loss;
        temperature = candidate;
      }
    }
  }

  const oosBrierScore = model && oos.length > 0 ? brierScore(oos, model, temperature) : null;
  const baselineProbability = training.length > 0
    ? training.reduce((sum, sample) => sum + sample.label, 0) / training.length
    : null;
  const baselineBrierScore = baselineProbability !== null && oos.length > 0
    ? oos.reduce((sum, sample) => sum + (baselineProbability - sample.label) ** 2, 0) / oos.length
    : null;
  const isCalibrated =
    currentFeatures !== null &&
    model !== null &&
    training.length >= 50 &&
    calibration.length >= 20 &&
    oos.length >= 20 &&
    new Set(calibration.map(sample => sample.label)).size === 2 &&
    oosBrierScore !== null &&
    baselineBrierScore !== null &&
    oosBrierScore < baselineBrierScore;

  const trainingWins = training.filter(sample => sample.label === 1 && sample.r !== null);
  const trainingLosses = training.filter(sample => sample.label === 0 && sample.r !== null);
  const averageWinR = trainingWins.length > 0
    ? trainingWins.reduce((sum, sample) => sum + (sample.r ?? 0), 0) / trainingWins.length
    : null;
  const averageLossR = trainingLosses.length > 0
    ? trainingLosses.reduce((sum, sample) => sum + (sample.r ?? 0), 0) / trainingLosses.length
    : null;

  return {
    probability: isCalibrated && model && currentFeatures
      ? predict(model, currentFeatures, temperature)
      : null,
    status: isCalibrated ? 'CALIBRATED' : 'UNCALIBRATED',
    trainingSampleSize: training.length,
    calibrationSampleSize: calibration.length,
    oosSampleSize: oos.length,
    oosBrierScore: oosBrierScore === null ? null : Math.round(oosBrierScore * 10000) / 10000,
    baselineBrierScore: baselineBrierScore === null ? null : Math.round(baselineBrierScore * 10000) / 10000,
    averageWinR: averageWinR === null ? null : Math.round(averageWinR * 100) / 100,
    averageLossR: averageLossR === null ? null : Math.round(averageLossR * 100) / 100,
  };
}
