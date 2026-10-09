import { AnalysisResult, Candle, OrderFlowFeatures, RealOrderBookImbalance } from '../types/trading';

export type WaveOutcomeHorizon = '5m' | '15m' | '30m' | '60m';
export type LearnedWaveStage = 'WAVE_FORMING' | 'EARLY_ACCELERATION' | 'TREND_EXPANSION' | 'MATURE_TREND' | 'EXHAUSTION';

interface WaveHorizonOutcome {
  continuation: boolean;
  reversal: boolean;
  terminalMovePct: number;
  maximumFavorableMovePct: number;
  maximumAdverseMovePct: number;
  durationToPeakMinutes: number;
}

interface WaveObservation {
  timestampMs: number;
  direction: 'LONG' | 'SHORT';
  price: number;
  atr: number;
  features: number[];
  maximumFavorableMovePct: number;
  maximumAdverseMovePct: number;
  peakTimestampMs: number;
  outcomes: Partial<Record<WaveOutcomeHorizon, WaveHorizonOutcome>>;
}

interface WaveLearningDataset {
  version: 1;
  observations: WaveObservation[];
}

export interface WaveStageClassification {
  stage: LearnedWaveStage | 'UNCLASSIFIED';
  confidencePct: number | null;
  sampleCount: number;
  sampleCountByStage: Record<LearnedWaveStage, number>;
}

export interface WaveOutcomeMetrics {
  continuationProbabilityPct: number | null;
  reversalProbabilityPct: number | null;
  expectedRemainingMovePct: number | null;
  expectedDurationMinutes: number | null;
  outcomesByHorizon: Record<WaveOutcomeHorizon, number | null>;
}

const DATASET_STORAGE_KEY = 'quantum_wave_outcome_dataset_v1';
const HORIZON_MS: Record<WaveOutcomeHorizon, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '60m': 60 * 60_000,
};
const MAX_OBSERVATIONS = 2500;
const MIN_OBSERVATION_INTERVAL_MS = 5 * 60_000;
const MIN_INDEPENDENT_SAMPLE_SPACING_MS = HORIZON_MS['60m'];
const MIN_SAMPLES_PER_STAGE = 20;
const K_NEIGHBORS = 25;
const STAGES: LearnedWaveStage[] = [
  'WAVE_FORMING',
  'EARLY_ACCELERATION',
  'TREND_EXPANSION',
  'MATURE_TREND',
  'EXHAUSTION',
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isHorizonOutcome(value: unknown): value is WaveHorizonOutcome {
  if (!value || typeof value !== 'object') return false;
  const outcome = value as Record<string, unknown>;
  return typeof outcome.continuation === 'boolean' &&
    typeof outcome.reversal === 'boolean' &&
    isFiniteNumber(outcome.terminalMovePct) &&
    isFiniteNumber(outcome.maximumFavorableMovePct) &&
    isFiniteNumber(outcome.maximumAdverseMovePct) &&
    isFiniteNumber(outcome.durationToPeakMinutes);
}

function isWaveObservation(value: unknown): value is WaveObservation {
  if (!value || typeof value !== 'object') return false;
  const observation = value as Record<string, unknown>;
  const outcomes = observation.outcomes;
  return isFiniteNumber(observation.timestampMs) &&
    (observation.direction === 'LONG' || observation.direction === 'SHORT') &&
    isFiniteNumber(observation.price) && observation.price > 0 &&
    isFiniteNumber(observation.atr) && observation.atr > 0 &&
    Array.isArray(observation.features) &&
    observation.features.length === 7 &&
    observation.features.every(isFiniteNumber) &&
    isFiniteNumber(observation.maximumFavorableMovePct) &&
    isFiniteNumber(observation.maximumAdverseMovePct) &&
    isFiniteNumber(observation.peakTimestampMs) &&
    !!outcomes &&
    typeof outcomes === 'object' &&
    Object.entries(outcomes).every(([horizon, outcome]) =>
      horizon in HORIZON_MS && isHorizonOutcome(outcome)
    );
}

function readDataset(): WaveLearningDataset {
  const raw = window.localStorage.getItem(DATASET_STORAGE_KEY);
  if (raw === null) return { version: 1, observations: [] };

  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Stored wave-learning dataset has an invalid shape.');
  }
  const dataset = parsed as Record<string, unknown>;
  if (dataset.version !== 1 || !Array.isArray(dataset.observations) ||
    !dataset.observations.every(isWaveObservation)) {
    throw new Error('Stored wave-learning dataset failed validation.');
  }
  return { version: 1, observations: dataset.observations };
}

function writeDataset(dataset: WaveLearningDataset): void {
  window.localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify({
    version: dataset.version,
    observations: dataset.observations.slice(-MAX_OBSERVATIONS),
  }));
}

function liveTradeFlow(value?: OrderFlowFeatures): value is OrderFlowFeatures & {
  cvdDeltaUsd: number;
  takerBuyVol: number;
  takerSellVol: number;
  ageMs: number;
} {
  return value?.isRealTradeFlow === true &&
    value.status === 'LIVE' &&
    isFiniteNumber(value.ageMs) && value.ageMs >= 0 && value.ageMs <= 5000 &&
    isFiniteNumber(value.cvdDeltaUsd) &&
    isFiniteNumber(value.takerBuyVol) &&
    isFiniteNumber(value.takerSellVol) &&
    value.takerBuyVol + value.takerSellVol > 0;
}

function liveOrderBook(value?: RealOrderBookImbalance): value is RealOrderBookImbalance & { obi: number } {
  return value?.status === 'LIVE' &&
    isFiniteNumber(value.obi) &&
    isFiniteNumber(value.snapshotAgeMs ?? value.ageMs) &&
    (value.snapshotAgeMs ?? value.ageMs) >= 0 &&
    (value.snapshotAgeMs ?? value.ageMs) <= 10_000;
}

function buildFeatures(analysis: Partial<AnalysisResult>): {
  price: number;
  atr: number;
  direction: 'LONG' | 'SHORT';
  currentHigh: number;
  currentLow: number;
  features: number[];
} | null {
  const candles = analysis.rawCandles;
  const price = analysis.price;
  const atr = analysis.atr;
  const direction = analysis.direction;
  const flow = analysis.orderFlowFeatures;
  const orderBook = analysis.realObiData;
  if (!candles || candles.length < 5 ||
    !isFiniteNumber(price) || price <= 0 ||
    !isFiniteNumber(atr) || atr <= 0 ||
    (analysis.dataStatus !== 'LIVE' && analysis.dataStatus !== 'VERIFIED_REALTIME') ||
    analysis.dataQualityReport?.isTradeAllowed !== true ||
    (direction !== 'LONG' && direction !== 'SHORT') ||
    !liveTradeFlow(flow) || !liveOrderBook(orderBook) ||
    !isFiniteNumber(analysis.volatilityPct) ||
    !isFiniteNumber(analysis.ema20Val) ||
    !isFiniteNumber(analysis.ema50Val)) {
    return null;
  }

  const isLong = direction === 'LONG';
  const recentCandles: Candle[] = candles.slice(-5);
  const latest = recentCandles[recentCandles.length - 1];
  const previous = recentCandles[0];
  const currentHigh = latest[1];
  const currentLow = latest[2];
  const currentVolume = latest[4];
  const previousClose = previous[3];
  if (![currentHigh, currentLow, currentVolume, previousClose].every(isFiniteNumber) ||
    currentHigh < currentLow || currentVolume <= 0 || previousClose <= 0) {
    return null;
  }

  const directional = isLong ? 1 : -1;
  const favorableOrigin = isLong
    ? Math.min(...recentCandles.map(candle => candle[2]))
    : Math.max(...recentCandles.map(candle => candle[1]));
  if (!isFiniteNumber(favorableOrigin) || favorableOrigin <= 0) return null;

  const momentumPct = ((price - previousClose) / previousClose) * 100 * directional;
  const cvdPressure = (flow.cvdDeltaUsd / ((flow.takerBuyVol + flow.takerSellVol) * price)) * directional;
  const structureFeature = (
    ((price - analysis.ema20Val) / price) +
    ((analysis.ema20Val - analysis.ema50Val) / price)
  ) * 100 * directional;
  const mfeProgressionPct = Math.max(0, ((price - favorableOrigin) / favorableOrigin) * 100 * directional);
  const features = [
    momentumPct,
    analysis.volatilityPct,
    Math.log1p(currentVolume),
    orderBook.obi * directional,
    cvdPressure,
    structureFeature,
    mfeProgressionPct,
  ];

  return features.every(Number.isFinite)
    ? { price, atr, direction, currentHigh, currentLow, features }
    : null;
}

function updateForwardOutcomes(observation: WaveObservation, price: number, high: number, low: number, now: number): void {
  const isLong = observation.direction === 'LONG';
  const favorablePrice = isLong ? high : low;
  const adversePrice = isLong ? low : high;
  const favorableMovePct = Math.max(0, ((favorablePrice - observation.price) / observation.price) * 100 * (isLong ? 1 : -1));
  const adverseMovePct = Math.max(0, ((observation.price - adversePrice) / observation.price) * 100 * (isLong ? 1 : -1));
  if (favorableMovePct > observation.maximumFavorableMovePct) {
    observation.maximumFavorableMovePct = favorableMovePct;
    observation.peakTimestampMs = now;
  }
  observation.maximumAdverseMovePct = Math.max(observation.maximumAdverseMovePct, adverseMovePct);

  const terminalMovePct = ((price - observation.price) / observation.price) * 100 * (isLong ? 1 : -1);
  for (const [horizon, horizonMs] of Object.entries(HORIZON_MS) as Array<[WaveOutcomeHorizon, number]>) {
    if (observation.outcomes[horizon] || now < observation.timestampMs + horizonMs) continue;
    observation.outcomes[horizon] = {
      continuation: terminalMovePct > 0,
      reversal: terminalMovePct < 0 && observation.maximumAdverseMovePct > observation.maximumFavorableMovePct,
      terminalMovePct,
      maximumFavorableMovePct: observation.maximumFavorableMovePct,
      maximumAdverseMovePct: observation.maximumAdverseMovePct,
      durationToPeakMinutes: Math.max(0, (observation.peakTimestampMs - observation.timestampMs) / 60_000),
    };
  }
}

function quantile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function stageLabels(observations: WaveObservation[]): Map<WaveObservation, LearnedWaveStage> {
  const resolved = independentResolvedObservations(observations).flatMap(observation => {
    const outcome = observation.outcomes['60m'];
    return outcome ? [{ observation, outcome }] : [];
  });
  const favorableAtr = resolved.map(({ observation, outcome }) => outcome.maximumFavorableMovePct / ((observation.atr / observation.price) * 100));
  const medianMfeAtr = quantile(favorableAtr, 0.5);
  const upperMfeAtr = quantile(favorableAtr, 0.75);
  const continuationRatios = resolved.map(({ outcome }) =>
    outcome.maximumFavorableMovePct > 0
      ? Math.max(0, outcome.terminalMovePct) / outcome.maximumFavorableMovePct
      : 0
  );
  const medianContinuationRatio = quantile(continuationRatios, 0.5);

  return new Map(resolved.map(({ observation, outcome }, index) => {
    const favorable = favorableAtr[index];
    const continuationRatio = continuationRatios[index];
    let stage: LearnedWaveStage;
    if (outcome.reversal) {
      stage = 'EXHAUSTION';
    } else if (favorable >= upperMfeAtr) {
      stage = continuationRatio <= medianContinuationRatio ? 'MATURE_TREND' : 'TREND_EXPANSION';
    } else if (favorable > medianMfeAtr && outcome.continuation) {
      stage = 'EARLY_ACCELERATION';
    } else {
      stage = 'WAVE_FORMING';
    }
    return [observation, stage];
  }));
}

function independentResolvedObservations(observations: WaveObservation[]): WaveObservation[] {
  const sorted = observations
    .filter(observation => observation.outcomes['60m'])
    .sort((left, right) => left.timestampMs - right.timestampMs);
  const independent: WaveObservation[] = [];
  let lastIncludedAt = Number.NEGATIVE_INFINITY;
  for (const observation of sorted) {
    if (observation.timestampMs - lastIncludedAt < MIN_INDEPENDENT_SAMPLE_SPACING_MS) continue;
    independent.push(observation);
    lastIncludedAt = observation.timestampMs;
  }
  return independent;
}

function standardizedDistance(left: number[], right: number[], means: number[], scales: number[]): number {
  return Math.sqrt(left.reduce((sum, value, index) =>
    sum + Math.pow((value - right[index]) / scales[index], 2), 0
  ));
}

export function recordWaveObservationAndClassify(
  analysis: Partial<AnalysisResult>,
  now = Date.now()
): WaveStageClassification {
  const unclassified: WaveStageClassification = {
    stage: 'UNCLASSIFIED',
    confidencePct: null,
    sampleCount: 0,
    sampleCountByStage: Object.fromEntries(STAGES.map(stage => [stage, 0])) as Record<LearnedWaveStage, number>,
  };
  if (typeof window === 'undefined') return unclassified;

  const current = buildFeatures(analysis);
  if (!current) return unclassified;

  const dataset = readDataset();
  const lastObservation = dataset.observations[dataset.observations.length - 1];
  if (lastObservation && now <= lastObservation.timestampMs) {
    return classifyWave(current.features, dataset.observations);
  }
  if (lastObservation && now - lastObservation.timestampMs < MIN_OBSERVATION_INTERVAL_MS) {
    return classifyWave(current.features, dataset.observations);
  }

  for (const observation of dataset.observations) {
    if (now > observation.timestampMs) {
      updateForwardOutcomes(observation, current.price, current.currentHigh, current.currentLow, now);
    }
  }
  dataset.observations.push({
    timestampMs: now,
    direction: current.direction,
    price: current.price,
    atr: current.atr,
    features: current.features,
    maximumFavorableMovePct: 0,
    maximumAdverseMovePct: 0,
    peakTimestampMs: now,
    outcomes: {},
  });
  dataset.observations = dataset.observations.slice(-MAX_OBSERVATIONS);
  writeDataset(dataset);
  return classifyWave(current.features, dataset.observations);
}

function classifyWave(features: number[], observations: WaveObservation[]): WaveStageClassification {
  const labeledStages = stageLabels(observations);
  const sampleCountByStage = Object.fromEntries(STAGES.map(stage => [stage, 0])) as Record<LearnedWaveStage, number>;
  for (const stage of labeledStages.values()) sampleCountByStage[stage] += 1;
  const sampleCount = labeledStages.size;
  if (STAGES.some(stage => sampleCountByStage[stage] < MIN_SAMPLES_PER_STAGE)) {
    return { stage: 'UNCLASSIFIED', confidencePct: null, sampleCount, sampleCountByStage };
  }

  const labeled = [...labeledStages.entries()];
  const means = features.map((_, featureIndex) =>
    labeled.reduce((sum, [observation]) => sum + observation.features[featureIndex], 0) / labeled.length
  );
  const scales = features.map((_, featureIndex) => {
    const variance = labeled.reduce((sum, [observation]) =>
      sum + Math.pow(observation.features[featureIndex] - means[featureIndex], 2), 0
    ) / labeled.length;
    return Math.max(Math.sqrt(variance), 1e-6);
  });
  const neighbors = labeled
    .map(([observation, stage]) => ({
      stage,
      distance: standardizedDistance(features, observation.features, means, scales),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.min(K_NEIGHBORS, labeled.length));
  const votes = Object.fromEntries(STAGES.map(stage => [stage, 0])) as Record<LearnedWaveStage, number>;
  neighbors.forEach(neighbor => { votes[neighbor.stage] += 1; });
  const stage = STAGES.reduce((best, candidate) => votes[candidate] > votes[best] ? candidate : best, STAGES[0]);
  return {
    stage,
    confidencePct: Math.round((votes[stage] / neighbors.length) * 100),
    sampleCount,
    sampleCountByStage,
  };
}

export function getWaveOutcomeMetrics(
  analysis: Partial<AnalysisResult>,
  stage: LearnedWaveStage | 'UNCLASSIFIED'
): WaveOutcomeMetrics {
  const horizons: WaveOutcomeHorizon[] = ['5m', '15m', '30m', '60m'];
  const empty: WaveOutcomeMetrics = {
    continuationProbabilityPct: null,
    reversalProbabilityPct: null,
    expectedRemainingMovePct: null,
    expectedDurationMinutes: null,
    outcomesByHorizon: { '5m': null, '15m': null, '30m': null, '60m': null },
  };
  if (typeof window === 'undefined' || stage === 'UNCLASSIFIED') return empty;
  const current = buildFeatures(analysis);
  if (!current) return empty;
  const dataset = readDataset();
  const labels = stageLabels(dataset.observations);
  const stageObservations = [...labels.entries()]
    .filter(([observation, label]) => label === stage && observation.direction === current.direction)
    .map(([observation]) => observation);
  const means = current.features.map((_, index) =>
    stageObservations.length > 0
      ? stageObservations.reduce((sum, observation) => sum + observation.features[index], 0) / stageObservations.length
      : 0
  );
  const scales = current.features.map((_, index) => {
    const variance = stageObservations.length > 0
      ? stageObservations.reduce((sum, observation) =>
          sum + Math.pow(observation.features[index] - means[index], 2), 0
        ) / stageObservations.length
      : 1;
    return Math.max(Math.sqrt(variance), 1e-6);
  });
  const matching = stageObservations
    .map(observation => ({
      observation,
      distance: standardizedDistance(current.features, observation.features, means, scales),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 200)
    .map(result => result.observation);
  const outcomes = Object.fromEntries(horizons.map(horizon => [
    horizon,
    matching.flatMap(observation => observation.outcomes[horizon] ? [observation.outcomes[horizon]!] : []),
  ])) as Record<WaveOutcomeHorizon, WaveHorizonOutcome[]>;
  const probability = (samples: WaveHorizonOutcome[], property: 'continuation' | 'reversal'): number | null =>
    samples.length >= MIN_SAMPLES_PER_STAGE
      ? Math.round((samples.filter(sample => sample[property]).length / samples.length) * 100)
      : null;
  const sixtyMinuteOutcomes = outcomes['60m'];
  const expectedMaximumMove = sixtyMinuteOutcomes.length >= MIN_SAMPLES_PER_STAGE
    ? sixtyMinuteOutcomes.reduce((sum, outcome) => sum + outcome.maximumFavorableMovePct, 0) / sixtyMinuteOutcomes.length
    : null;
  const expectedDuration = sixtyMinuteOutcomes.length >= MIN_SAMPLES_PER_STAGE
    ? sixtyMinuteOutcomes.reduce((sum, outcome) => sum + outcome.durationToPeakMinutes, 0) / sixtyMinuteOutcomes.length
    : null;
  const outcomesByHorizon = Object.fromEntries(horizons.map(horizon => [
    horizon,
    probability(outcomes[horizon], 'continuation'),
  ])) as WaveOutcomeMetrics['outcomesByHorizon'];

  return {
    continuationProbabilityPct: probability(sixtyMinuteOutcomes, 'continuation'),
    reversalProbabilityPct: probability(sixtyMinuteOutcomes, 'reversal'),
    expectedRemainingMovePct: expectedMaximumMove,
    expectedDurationMinutes: expectedDuration === null ? null : Math.max(0, Math.round(expectedDuration)),
    outcomesByHorizon,
  };
}
