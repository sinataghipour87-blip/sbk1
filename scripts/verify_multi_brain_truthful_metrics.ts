import assert from 'node:assert/strict';
import { runUnifiedMultiBrainEnsemble } from '../src/services/multiBrainEnsemble';
import {
  macroContextBrainService,
  type MacroCorrelationData,
} from '../src/services/macroContextBrain';

const candles = Array.from({ length: 300 }, (_, index) => {
  const close = 100 + index * 0.01;
  return [close - 0.01, close + 0.02, close - 0.02, close, 10] as const;
});

const unavailableMacro: MacroCorrelationData = {
  overallDataStatus: 'UNAVAILABLE',
  lastUpdatedTime: null,
  lastUpdatedStr: 'UNAVAILABLE',
  provenance: {},
  sp500Status: 'UNAVAILABLE',
  sp500Price: null,
  sp500DailyChangePct: null,
  dxyStatus: 'UNAVAILABLE',
  dxyIndex: null,
  dxyDailyChangePct: null,
  broadDollarProxyStatus: 'UNAVAILABLE',
  broadDollarProxyIndex: null,
  broadDollarProxyDailyChangePct: null,
  fearAndGreedStatus: 'UNAVAILABLE',
  fearAndGreedIndex: null,
  fearAndGreedLabelFa: 'UNAVAILABLE',
  etfFlowStatus: 'UNAVAILABLE',
  spotEtfNetInflowMillionUsd: null,
  fedExpectationsStatus: 'UNAVAILABLE',
  fedRateCutExpectationPct: null,
  fedPublishedRateStatus: 'UNAVAILABLE',
  fedEffectiveRatePct: null,
  fedTargetUpperBoundPct: null,
  newsSentimentStatus: 'UNAVAILABLE',
  newsSentimentScore: null,
  newsHeadlinesStatus: 'UNAVAILABLE',
  recentHeadlines: [],
  whaleFlowStatus: 'UNKNOWN',
  whaleNetflowBtc: null,
  whalePressureIndex: null,
  whaleSentiment: 'UNKNOWN',
  bitcoinActiveAddressesStatus: 'UNAVAILABLE',
  bitcoinActiveAddresses: null,
  btcCorrelationWithSP500: null,
  btcCorrelationWithDXY: null,
  macroFilterStatus: 'UNAVAILABLE',
  macroFilterStatusFa: 'UNAVAILABLE',
  isTradeApprovedByMacro: false,
  fundamentalScorePct: null,
  fundamentalBias: 'UNAVAILABLE',
  breakingNewsImpactLevel: 'UNAVAILABLE',
  breakingNewsActionDirectiveFa: 'UNAVAILABLE',
  emergencyDefensiveShield: false,
  runnerExpansionBoost: false,
};
const originalGetMacroContext = macroContextBrainService.getMacroContext;
macroContextBrainService.getMacroContext = () => unavailableMacro;

try {
  const report = runUnifiedMultiBrainEnsemble({
    direction: 'LONG',
    price: 103,
    realObiData: { obi: 0.05, spreadUsd: 0.1, latencyMs: null },
    volatilityPct: 1,
    rsi: 50,
    setupType: 'TEST_ONLY',
    timeframe: '15m',
    marketRegime: 'NORMAL',
    candles,
  }, null, 103, []);

  assert.equal(report.brain12ExecutionSniper.exchangeLatencyMs, null);
  assert.equal(report.brain12ExecutionSniper.realWorldExecutionScore, null);
  assert.equal(report.dynamicWeights.brain12ExecutionSniperWeight, 0);
  assert.equal(report.brain5RiskHedging.floatingSystemHarmonized, null);
  assert.equal(report.brain14LossToBreakeven.escapeSpeedMs, null);
  assert.equal(report.brain16DrawdownLockout.lockedPositionsCount, null);
  assert.equal(report.brain16DrawdownLockout.isNewTradeBlocked, null);
  assert.equal(report.brain19LoadReallocator.reallocatedCapacityPct, null);
  assert.equal(report.brain20LatencyArbitrage.subSecondExecutionMs, null);
  assert.equal(report.brain20LatencyArbitrage.arbitrageShieldActive, null);
  assert.equal(report.brain21StrategicRecovery.exactCounterVolumeUsd, null);
  assert.equal(report.modelDisagreement.vetoTriggered, true);
  assert.equal(report.independentModels.length, 4);
  assert.equal(report.pipelineArchitecture.statisticalModelsCount, 0);
  assert.equal(report.proposalsListFa[0].status, 'BLOCKED_UNVALIDATED');
  for (const model of report.independentModels) {
    assert.equal(model.independenceValidated, false);
    assert.equal(model.correlationWithOtherModels, null);
    assert.equal(model.effectiveWeight, 0);
  }
  assert.notEqual(report.independentModels[0].healthState, 'HEALTHY');
  assert.notEqual(report.independentModels[1].healthState, 'HEALTHY');
} finally {
  macroContextBrainService.getMacroContext = originalGetMacroContext;
}

console.log('MultiBrain diagnostics do not fabricate missing latency, position, allocation, or recovery measurements.');
