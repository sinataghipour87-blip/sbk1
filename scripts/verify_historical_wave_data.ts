import assert from 'node:assert/strict';
import type { AnalysisResult, WaveDnaSignature } from '../src/types/trading';
import { getWaveOutcomeMetrics, recordWaveObservationAndClassify } from '../src/services/waveOutcomeDataset';

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
};
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: localStorageMock },
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});

function analysis(price: number): Partial<AnalysisResult> {
  const candles = Array.from({ length: 5 }, (_, index) => {
    const close = price - (4 - index) * 0.1;
    return [close - 0.05, close + 0.1, close - 0.1, close, 10] as [number, number, number, number, number];
  });
  return {
    price,
    atr: 1,
    direction: 'LONG',
    rawCandles: candles,
    dataStatus: 'LIVE',
    dataQualityReport: { isTradeAllowed: true } as AnalysisResult['dataQualityReport'],
    orderFlowFeatures: {
      isRealTradeFlow: true,
      status: 'LIVE',
      ageMs: 100,
      cvdDeltaUsd: 100,
      takerBuyVol: 10,
      takerSellVol: 5,
    } as AnalysisResult['orderFlowFeatures'],
    realObiData: {
      status: 'LIVE',
      obi: 0.2,
      snapshotAgeMs: 100,
    } as AnalysisResult['realObiData'],
    volatilityPct: 1,
    ema20Val: price - 0.1,
    ema50Val: price - 0.2,
  };
}

const startMs = Date.parse('2026-10-21T20:00:00.000Z');
recordWaveObservationAndClassify(analysis(100), startMs);
recordWaveObservationAndClassify(analysis(101), startMs + 5 * 60_000);
recordWaveObservationAndClassify(analysis(102), startMs + 7 * 60_000);

const observationKey = 'quantum_wave_outcome_dataset_v1';
const stored = JSON.parse(store.get(observationKey) ?? '{}') as {
  observations: Array<{
    timestampMs: number;
    outcomes: Record<string, { observedAtMs: number; terminalMovePct: number } | undefined>;
  }>;
};
assert.equal(stored.observations[0].outcomes['5m']?.observedAtMs, startMs + 5 * 60_000);
assert.equal(stored.observations[0].outcomes['7m']?.observedAtMs, startMs + 7 * 60_000);
assert.equal(stored.observations[0].outcomes['7m']?.terminalMovePct, 2);
assert.equal(stored.observations[0].outcomes['15m'], undefined);

store.set(observationKey, JSON.stringify({
  version: 1,
  observations: [{
    timestampMs: startMs - 60 * 60_000,
    direction: 'LONG',
    price: 100,
    atr: 1,
    features: [0, 0, 0, 0, 0, 0, 0],
    maximumFavorableMovePct: 1,
    maximumAdverseMovePct: 0.5,
    peakTimestampMs: startMs - 60 * 60_000,
    outcomes: {
      '7m': {
        continuation: true,
        reversal: false,
        terminalMovePct: 1,
        maximumFavorableMovePct: 1,
        maximumAdverseMovePct: 0.5,
        durationToPeakMinutes: 3,
      },
    },
  }],
}));
recordWaveObservationAndClassify(analysis(103), startMs + 30 * 60_000);
const migrated = JSON.parse(store.get(observationKey) ?? '{}') as {
  observations: Array<{ timestampMs: number; outcomes: Record<string, unknown> }>;
};
assert.deepEqual(migrated.observations[0].outcomes, {}, 'legacy horizon labels without observed timestamps must be discarded');

const metrics = getWaveOutcomeMetrics(analysis(102), 'UNCLASSIFIED');
assert.equal(metrics.outcomesByHorizon['7m'], null);
assert.equal(metrics.sampleCountByHorizon['7m'], 0);

const wave = (dnaId: string, dataProvenance?: WaveDnaSignature['dataProvenance']): WaveDnaSignature => ({
  dnaId,
  timestamp: startMs,
  dataProvenance,
  origin: 'LIQUIDITY_SWEEP',
  direction: 'LONG',
  regime: 'TRENDING_BULL',
  momentum: 50,
  volumeZScore: 1,
  cvdDeltaPct: 10,
  obiImbalance: 0.2,
  liquidityScore: 80,
  volatilityAtrPct: 1,
  mfeR: 1.5,
  maeR: 0.2,
  durationSeconds: 600,
  accelerationScore: 70,
  exhaustionPattern: 'NONE_HEALTHY',
  outcome: 'CONTINUED',
  actualRealizedR: 1.2,
});

const hunterStorageKey = 'quantum_wave_dna_dataset_v1';
store.delete(hunterStorageKey);
const { hunterOsEngine } = await import('../src/services/hunterOsEngine');
assert.equal(hunterOsEngine.getWaveDataset().length, 0);
assert.equal(store.has(hunterStorageKey), false, 'an empty dataset must not be populated with synthetic benchmark samples');
hunterOsEngine.recordCompletedWaveDna(wave('unvalidated-snapshot', 'UNVALIDATED'));
hunterOsEngine.recordCompletedWaveDna(wave('verified-entry-outcome', 'VERIFIED_ENTRY_OUTCOME'));
const matched = hunterOsEngine.matchWaveDnaSimilarity(wave('current-wave'));
assert.equal(matched.totalWavesInDataset, 1);
assert.equal(matched.similarWavesFoundCount, 1);
assert.equal(matched.isStatisticallySufficient, false);
assert.equal(matched.topMatches[0].matchedDna.dnaId, 'verified-entry-outcome');

console.log('Historical wave outcomes use accurately timed 5m/7m labels; unverified and synthetic waves cannot influence matching.');
