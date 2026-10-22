import assert from 'node:assert/strict';
import type { AnalysisResult, MarketFeedQuality } from '../src/types/trading';
import {
  evaluateEightMemberCouncil,
  type EightMemberCouncilReport,
} from '../src/services/eightMemberCouncil';
import { runPostCouncilTradeControl } from '../src/services/postCouncilTradeController';
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

const wideStopAllocation = calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 0.1,
  stopFraction: 0.02,
});
assert.ok(wideStopAllocation);
assert.equal(wideStopAllocation.leverage, 1);
assert.equal(wideStopAllocation.marginUsd, 50);
assert.ok(wideStopAllocation.marginUsd * 0.02 <= wideStopAllocation.riskBudgetUsd);
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
  price: 60_000,
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
assert.equal(staleOrderBook.gates[1]?.passed, false);

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
  openRiskUsd: 29,
  dailyLossLimitPct: 5,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(remainingPortfolioBudget.approved, true);
assert.ok(
  (remainingPortfolioBudget.executionRisk?.allocatedRiskUsd ?? Number.POSITIVE_INFINITY) <= 1.01,
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
  dailyLossUsd: 19.5,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  nowMs,
});
assert.equal(remainingDailyBudget.approved, true);
assert.ok(
  (remainingDailyBudget.executionRisk?.allocatedRiskUsd ?? Number.POSITIVE_INFINITY) <= 0.51,
  'new allocation must fit in the remaining daily-loss budget',
);

console.log('Central council execution-control checks passed; no predictive ensemble is required or produced.');
