import assert from 'node:assert/strict';
import type { AnalysisResult, MarketFeedQuality } from '../src/types/trading';
import {
  evaluateEightMemberCouncil,
  type EightMemberCouncilReport,
} from '../src/services/eightMemberCouncil';
import {
  runPostCouncilTradeControl as runControlWithResearch,
} from '../src/services/postCouncilTradeController';
import type { WalkForwardCandleResearchReport } from '../src/services/walkForwardCandleResearch';
import { calculateCentralRiskAllocation } from '../src/services/centralRiskAllocation';

const tightStopAllocation = calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  stopFraction: 0.002,
});
assert.ok(tightStopAllocation);
assert.equal(tightStopAllocation.leverage, 5);
assert.equal(tightStopAllocation.marginUsd, 100);
assert.ok(
  tightStopAllocation.marginUsd * tightStopAllocation.leverage * 0.002 <=
    tightStopAllocation.riskBudgetUsd,
);
assert.ok(tightStopAllocation.leverage <= 25, 'the selected leverage must stay within the hard 25x cap');

const maximumRiskAllocation = calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 25,
  riskBudgetPct: 10,
  stopFraction: 0.002,
});
assert.ok(maximumRiskAllocation);
assert.equal(maximumRiskAllocation.leverage, 25);
assert.equal(maximumRiskAllocation.marginUsd, 100);
assert.ok(maximumRiskAllocation.allocatedRiskUsd <= 100);
assert.equal(calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 25.01,
  riskBudgetPct: 10,
  stopFraction: 0.002,
}), null, 'leverage above the hard cap must be rejected');
assert.equal(calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 25,
  riskBudgetPct: 10.01,
  stopFraction: 0.002,
}), null, 'risk above the hard per-trade cap must be rejected');

const wideStopAllocation = calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 0.1,
  stopFraction: 0.005,
});
assert.ok(wideStopAllocation);
assert.equal(wideStopAllocation.leverage, 5);
assert.equal(wideStopAllocation.marginUsd, 40);
assert.ok(wideStopAllocation.marginUsd * 5 * 0.005 <= wideStopAllocation.riskBudgetUsd);
assert.ok(wideStopAllocation.marginUsd >= 20 && wideStopAllocation.marginUsd <= 100);
const variableAllocation = calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 1_000,
  maxLeverage: 25,
  riskBudgetPct: 10,
  stopFraction: 0.045,
});
assert.ok(variableAllocation);
assert.equal(variableAllocation.marginUsd, 100);
assert.ok(variableAllocation.leverage > 5 && variableAllocation.leverage < 25);
assert.ok(variableAllocation.allocatedRiskUsd <= variableAllocation.riskBudgetUsd);
assert.equal(
  maximumRiskAllocation.marginUsd,
  1_000 * 0.1,
  'the maximum margin must be 10% of equity',
);
const minimumBoundsAllocation = calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 1_000,
  maxLeverage: 25,
  riskBudgetPct: 0.1,
  stopFraction: 0.01,
});
assert.ok(minimumBoundsAllocation);
assert.equal(minimumBoundsAllocation.marginUsd, 20);
assert.equal(minimumBoundsAllocation.leverage, 5);
assert.equal(calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 25,
  riskBudgetPct: 0.1,
  stopFraction: 0.02,
}), null, 'the trade must be rejected when risk cannot fund the minimum margin and leverage');
assert.equal(calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 19,
  maxLeverage: 25,
  riskBudgetPct: 10,
  stopFraction: 0.005,
}), null, 'the trade must be rejected if available margin is below 2% of equity');
assert.ok(
  wideStopAllocation.allocatedRiskUsd <= wideStopAllocation.riskBudgetUsd,
  'the central controller must communicate the actual absolute risk budget to Freqtrade',
);
assert.equal(calculateCentralRiskAllocation({
  balance: 0,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  stopFraction: 0.01,
}), null);

const nowMs = Date.now();
const candleResearch: WalkForwardCandleResearchReport = {
  status: 'AVAILABLE',
  source: 'verified-live-exchange-candles',
  exchange: 'bybit',
  market: 'futures',
  pair: 'BTC/USDT:USDT',
  sourceTimestampMs: nowMs,
  timeframe: '1m',
  candleCount: 1_000,
  trainingCandleCount: 700,
  testCandleCount: 300,
  trainingCutoffTimestampMs: nowMs - 300 * 60_000,
  similarityThresholdPct: 85,
  contextSimilarityWeightPct: 30,
  requiredReferenceMatches: 3,
  minimumOutOfSampleForecasts: 20,
  costs: { configured: true, takerFeeBpsPerSide: 5, slippageBpsPerSide: 2, roundTripPercent: 0.14 },
  horizons: Object.fromEntries([7, 15, 30, 60].map((horizonMinutes) => [horizonMinutes, {
    horizonMinutes,
    actualHorizonMinutes: horizonMinutes,
    available: true,
    outOfSampleForecastCount: 50,
    forecastsWithEnoughMatches: 50,
    minimumForecastsForMetrics: 20,
    averageReferenceMatches: 4,
    meanSimilarityPct: 90,
    grossDirectionAccuracyPct: 60,
    meanGrossPredictedReturnPct: 0.3,
    grossWinRatePct: 60,
    meanNetPredictedReturnPct: 0.16,
    netWinRatePct: 76,
    netWinCount: 38,
    meanMaximumFavorableMovePct: 0.4,
    meanMaximumAdverseMovePct: 0.2,
    meanCostAdjustedRewardRiskRatio: 1.2,
  }])) as WalkForwardCandleResearchReport['horizons'],
  tradeEligible: false,
  note: 'OOS verification evidence only.',
};
function runPostCouncilTradeControl(
  input: Omit<Parameters<typeof runControlWithResearch>[0], 'marketIdentity'> &
    Partial<Pick<Parameters<typeof runControlWithResearch>[0], 'marketIdentity'>>,
) {
  return runControlWithResearch({
    marketIdentity: input.marketIdentity ?? {
      exchange: 'bybit',
      market: 'futures',
      pair: 'BTC/USDT:USDT',
    },
    candleResearch,
    ...input,
  });
}
const baseCouncil = evaluateEightMemberCouncil({ nowMs });
const council: EightMemberCouncilReport = {
  ...baseCouncil,
  members: baseCouncil.members.map((member, index) => ({
    ...member,
    vote: index < 5 ? 'LONG' as const : 'NEUTRAL' as const,
  })),
  longVotes: 5,
  shortVotes: 0,
  neutralVotes: 3,
  abstentions: 0,
  quorumMet: true,
  selectedDirection: 'LONG',
};
const feed = (feedName: string): MarketFeedQuality => ({
  feedName,
  source: 'verification',
  status: 'LIVE',
  timestamp: nowMs,
  ageMs: 0,
  maxAgeMs: 15_000,
  latencyMs: 1,
  score: 100,
  detailsFa: 'fresh test feed',
});
const controlRisk = {
  maxOpenTrades: 3,
  openRiskUsd: 0,
  dailyLossUsd: 0,
  dailyLossLimitPct: 2,
};
const analysis = {
  timeframe: '1m',
  price: 60_000,
  atr: 100,
  dataStatus: 'LIVE',
  candles: Array.from({ length: 30 }, (_, index) =>
    [nowMs - (30 - index) * 60_000, 60_000, 60_100, 59_900, 60_000, 1] as const
  ),
  sl: 59_000,
  tp1: 62_000,
  dataQualityReport: {
    overallScore: 95,
    isTradeAllowed: true,
    status: 'LIVE',
    reasonsFa: [],
    feeds: {
      candles: feed('candles'),
      orderBook: feed('orderBook'),
      derivatives: feed('derivatives'),
      futuresPrices: feed('futuresPrices'),
      sentiment: feed('sentiment'),
      orderFlow: feed('orderFlow'),
    },
  },
  futuresPrices: {
    lastPrice: 60_000,
    markPrice: 60_000,
    indexPrice: 60_000,
    timestampUtc: nowMs,
    exchangeTimestampUtc: nowMs,
    timestampSource: 'EXCHANGE',
    receivedTimestampMs: nowMs,
    isoTimeUtc: new Date(nowMs).toISOString(),
    ageMs: 0,
    latencyMs: 1,
    source: 'test ticker',
    status: 'LIVE',
  },
  realObiData: {
    obi: 0,
    bidDepthUsd: 10_000,
    askDepthUsd: 10_000,
    bestBid: 59_990,
    bestAsk: 60_010,
    spreadUsd: 20,
    levelsCount: 10,
    status: 'LIVE',
    timestamp: nowMs,
    ageMs: 0,
    latencyMs: 1,
    source: 'test order book',
  },
  canonicalSnapshot: { timestampUtc: nowMs, basisSpreadBps: 900 },
  orderFlowFeatures: {
    cvdDelta: 0,
    cvdDivergence: 'test',
    takerBuyVol: 1,
    takerSellVol: 1,
    takerRatio: 0.5,
    takerDelta: 0,
    isRealTradeFlow: true,
    status: 'LIVE',
    timestampUtc: nowMs,
    ageMs: 0,
    latencyMs: 1,
    source: 'test trades',
  },
} as unknown as AnalysisResult;

const valid = runPostCouncilTradeControl({
  analysis,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(valid.approved, true, valid.reason);
assert.equal(valid.direction, 'LONG');
assert.equal(valid.executionPlan?.direction, 'LONG');
assert.equal(valid.executionPlan?.entryPrice, 60_000);
assert.equal(valid.gates.every((gate) => gate.passed), true);
assert.match(
  valid.gates.find((gate) => gate.id === 'EXECUTION_SPREAD')?.reason ?? '',
  /3\.33bps/,
  'the execution gate must use bid/ask spread, not spot-perpetual basis',
);
assert.ok(valid.executionRisk);
assert.equal('models' in valid, false, 'central control must not generate model predictions');
assert.equal(valid.gates.find((gate) => gate.id === 'VOLATILITY')?.passed, true);
assert.equal(valid.executionPlan?.holdingHorizon.selectedHorizonMinutes, 60);
assert.equal(valid.gates.find((gate) => gate.id === 'HOLDING_HORIZON')?.passed, true);

const noResearchHorizon = runControlWithResearch({
  analysis,
  council,
  marketIdentity: { exchange: 'bybit', market: 'futures', pair: 'BTC/USDT:USDT' },
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(noResearchHorizon.approved, false);
assert.equal(noResearchHorizon.gates.at(-1)?.id, 'HOLDING_HORIZON');
assert.equal(noResearchHorizon.holdingHorizon?.status, 'UNAVAILABLE');

const malformedResearch = structuredClone(candleResearch);
delete (malformedResearch.horizons as Partial<typeof malformedResearch.horizons>)[60];
const malformedResearchResult = runControlWithResearch({
  analysis,
  council,
  marketIdentity: { exchange: 'bybit', market: 'futures', pair: 'BTC/USDT:USDT' },
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  candleResearch: malformedResearch,
  nowMs,
});
assert.equal(malformedResearchResult.approved, false);
assert.equal(malformedResearchResult.holdingHorizon?.status, 'UNAVAILABLE');

const weakWinEvidence = structuredClone(candleResearch);
for (const horizon of Object.values(weakWinEvidence.horizons)) {
  horizon.netWinRatePct = 64;
  horizon.netWinCount = 32;
}
const weakWinResult = runControlWithResearch({
  analysis,
  council,
  marketIdentity: { exchange: 'bybit', market: 'futures', pair: 'BTC/USDT:USDT' },
  candleResearch: weakWinEvidence,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(weakWinResult.approved, false);
assert.match(
  weakWinResult.holdingHorizon?.evaluations[0]?.reason ?? '',
  /کران پایین Wilson/,
  'minimum sample wins alone must not pass without a multiple-horizon confidence bound',
);

for (const marketIdentity of [
  { exchange: 'binance', market: 'futures' as const, pair: 'BTC/USDT:USDT' },
  { exchange: 'bybit', market: 'spot' as const, pair: 'BTC/USDT:USDT' },
  { exchange: 'bybit', market: 'futures' as const, pair: 'ETH/USDT:USDT' },
]) {
  const mismatchedResearch = runControlWithResearch({
    analysis,
    council,
    marketIdentity,
    candleResearch,
    balance: 1_000,
    maxStakeQuote: 100,
    maxLeverage: 5,
    riskBudgetPct: 1,
    ...controlRisk,
    referencePrice: 60_000,
    maxDeviationBps: 100,
    nowMs,
  });
  assert.equal(mismatchedResearch.approved, false);
  assert.match(mismatchedResearch.holdingHorizon?.reason ?? '', /صرافی، نماد یا نوع بازار/);
}

const excessiveVolatility = runPostCouncilTradeControl({
  analysis: { ...analysis, atr: 1_500 } as AnalysisResult,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  maxAtrPct: 2,
  nowMs,
});
assert.equal(excessiveVolatility.approved, false);
assert.equal(excessiveVolatility.gates.at(-1)?.id, 'VOLATILITY');

const unavailableAtr = runPostCouncilTradeControl({
  analysis: { ...analysis, atr: Number.NaN } as AnalysisResult,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(unavailableAtr.approved, false);
assert.equal(unavailableAtr.gates.at(-1)?.id, 'VOLATILITY');

const staleReferencePrice = runPostCouncilTradeControl({
  analysis,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_700,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(staleReferencePrice.approved, false);
assert.equal(
  staleReferencePrice.gates.find((gate) => gate.id === 'REFERENCE_PRICE')?.passed,
  false,
  'analysis price must be compared against the live Last reference, not a duplicate candle-close value',
);

const quorumWithAbstention: EightMemberCouncilReport = {
  ...council,
  members: council.members.map((member, index) => ({
    ...member,
    vote: index === 0
      ? 'ABSTAIN' as const
      : index <= 5
        ? 'LONG' as const
        : 'NEUTRAL' as const,
  })),
  longVotes: 5,
  neutralVotes: 2,
  abstentions: 1,
};
const approvedWithQuorumAndAbstention = runPostCouncilTradeControl({
  analysis,
  council: quorumWithAbstention,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(
  approvedWithQuorumAndAbstention.approved,
  true,
  'the central controller must honor a valid 5-of-8 council quorum without requiring extra member-specific votes',
);

const noQuorum = runPostCouncilTradeControl({
  analysis,
  council: baseCouncil,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(noQuorum.approved, false);
assert.equal(noQuorum.gates[0].id, 'COUNCIL_REPORT');
assert.equal(noQuorum.gates[0].passed, false);

const inconsistentQuorum = runPostCouncilTradeControl({
  analysis,
  council: { ...council, longVotes: 4 },
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(inconsistentQuorum.approved, false);
assert.match(inconsistentQuorum.reason, /ناسازگار/);

const staleAnalysis = {
  ...analysis,
  dataQualityReport: {
    ...analysis.dataQualityReport,
    feeds: {
      ...analysis.dataQualityReport.feeds,
      candles: { ...analysis.dataQualityReport.feeds.candles, timestamp: nowMs - 20_000 },
    },
  },
} as AnalysisResult;
const stale = runPostCouncilTradeControl({
  analysis: staleAnalysis,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(stale.approved, false);
assert.equal(stale.gates.at(-1)?.id, 'LIVE_DATA');

const badLevels = runPostCouncilTradeControl({
  analysis: { ...analysis, sl: 61_000 } as AnalysisResult,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(badLevels.approved, false);
assert.equal(badLevels.gates.at(-1)?.id, 'TRADE_LEVELS');

const excessiveSpread = runPostCouncilTradeControl({
  analysis: {
    ...analysis,
    realObiData: { ...analysis.realObiData, bestAsk: 60_060 },
  } as AnalysisResult,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(excessiveSpread.approved, false);
assert.equal(excessiveSpread.gates.at(-1)?.id, 'EXECUTION_SPREAD');

const invalidCouncilVote = runPostCouncilTradeControl({
  analysis,
  council: {
    ...council,
    members: council.members.map((member, index) => index === 7
      ? { ...member, vote: 'INVALID' as EightMemberCouncilReport['members'][number]['vote'] }
      : member),
  },
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(invalidCouncilVote.approved, false, 'unknown council vote values must not be treated as abstentions');

const staleOrderBook = runPostCouncilTradeControl({
  analysis: {
    ...analysis,
    realObiData: { ...analysis.realObiData, timestamp: nowMs - 6_000 },
  } as AnalysisResult,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(staleOrderBook.approved, false, 'stale execution book must fail closed');
assert.equal(staleOrderBook.gates.find((gate) => gate.id === 'LIVE_DATA')?.passed, false);

const staleTradeFlow = runPostCouncilTradeControl({
  analysis: {
    ...analysis,
    orderFlowFeatures: { ...analysis.orderFlowFeatures, timestampUtc: nowMs - 31_000 },
  } as AnalysisResult,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(staleTradeFlow.approved, false, 'stale trade flow must fail the live-data gate');

const portfolioLimit = runPostCouncilTradeControl({
  analysis,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  openRiskUsd: 30,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(portfolioLimit.approved, false, 'open risk at the configured aggregate cap must block another entry');

const remainingPortfolioBudget = runPostCouncilTradeControl({
  analysis,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  openRiskUsd: 28.3,
  dailyLossLimitPct: 5,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(remainingPortfolioBudget.approved, true);
assert.ok(
  (remainingPortfolioBudget.executionRisk?.allocatedRiskUsd ?? Number.POSITIVE_INFINITY) <= 1.71,
  'new allocation must be limited to remaining portfolio risk, not a fresh full per-trade budget',
);

const dailyLossLimit = runPostCouncilTradeControl({
  analysis,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  dailyLossUsd: 20,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(dailyLossLimit.approved, false, 'daily loss limit must block new entries');

const remainingDailyBudget = runPostCouncilTradeControl({
  analysis,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  dailyLossUsd: 18.3,
  dailyLossLimitPct: 2,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(remainingDailyBudget.approved, true);
assert.ok(
  (remainingDailyBudget.executionRisk?.allocatedRiskUsd ?? Number.POSITIVE_INFINITY) <= 1.71,
  'new allocation must fit in the remaining daily-loss budget',
);

const maxDailyLossLimit = runPostCouncilTradeControl({
  analysis,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  dailyLossUsd: 98.3,
  dailyLossLimitPct: 10,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(maxDailyLossLimit.approved, true, 'the configured 10% daily-loss limit must be accepted');

const exhaustedMaxDailyLossLimit = runPostCouncilTradeControl({
  analysis,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  dailyLossUsd: 100,
  dailyLossLimitPct: 10,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(exhaustedMaxDailyLossLimit.approved, false, 'reaching the 10% daily-loss limit must block new entries');

const invalidDailyLossLimit = runPostCouncilTradeControl({
  analysis,
  council,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  ...controlRisk,
  dailyLossLimitPct: 10.01,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(invalidDailyLossLimit.approved, false, 'a daily-loss limit above 10% must be rejected');

console.log('Central council execution-control checks passed; no predictive ensemble is required or produced.');
