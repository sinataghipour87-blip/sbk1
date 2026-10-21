import assert from 'node:assert/strict';
import type { Candle, DataQualityReport, MarketFeedQuality } from '../src/types/trading';
import {
  CENTRAL_CONTROL_MODULES,
  COUNCIL_COORDINATOR_MODULES,
  EIGHT_MEMBER_COUNCIL,
  UNWIRED_OR_LEGACY_ANALYSIS_MODULES,
  UNWIRED_TRADE_MANAGEMENT_MODULES,
  evaluateEightMemberCouncil,
  validateCouncilModuleOwnership,
  type CouncilMacroContext,
} from '../src/services/eightMemberCouncil';

const nowMs = Date.now();

function feed(feedName: string): MarketFeedQuality {
  return {
    feedName,
    source: 'council-verification-fixture',
    status: 'LIVE',
    timestamp: nowMs - 1_000,
    ageMs: 1_000,
    maxAgeMs: 15_000,
    latencyMs: 100,
    score: 90,
    detailsFa: 'verification fixture',
  };
}

const dataQualityReport: DataQualityReport = {
  overallScore: 90,
  isTradeAllowed: true,
  status: 'LIVE',
  reasonsFa: [],
  feeds: {
    candles: feed('candles'),
    orderBook: feed('orderBook'),
    derivatives: { ...feed('derivatives'), maxAgeMs: 60_000 },
    futuresPrices: feed('futuresPrices'),
    sentiment: feed('sentiment'),
    orderFlow: { ...feed('orderFlow'), maxAgeMs: 5_000 },
  },
};

const macroContext: CouncilMacroContext = {
  overallDataStatus: 'LIVE',
  lastUpdatedTime: nowMs - 1_000,
  sp500Status: 'LIVE',
  sp500DailyChangePct: 1,
  dxyStatus: 'LIVE',
  dxyIndex: 104.25,
  dxyDailyChangePct: -0.5,
  etfFlowStatus: 'LIVE',
  spotEtfNetInflowMillionUsd: 100,
  newsSentimentStatus: 'UNAVAILABLE',
  newsSentimentScore: null,
  newsHeadlinesStatus: 'UNAVAILABLE',
  recentHeadlines: [],
  whaleFlowStatus: 'UNKNOWN',
  whaleNetflowBtc: null,
  whalePressureIndex: null,
  whaleSentiment: 'UNKNOWN',
  fundamentalBias: 'BULLISH',
};

const analysis = {
  scoreLong: 80,
  scoreShort: 20,
  rsi: 60,
  mtf1h: 'BULLISH',
  mtf4h: 'BULLISH',
  candles: Array.from({ length: 30 }, (_, index): Candle => [
    index + 1,
    100 + index,
    102 + index,
    99 + index,
    101 + index,
    1,
  ]),
  dataQualityReport,
  orderFlowFeatures: {
    cvdDelta: 500,
    cvdDeltaUsd: 500,
    cvdDivergence: 'NONE',
    takerBuyVol: 800,
    takerSellVol: 300,
    takerRatio: 0.72,
    takerDelta: 500,
    isRealTradeFlow: true,
    status: 'LIVE' as const,
    timestampUtc: nowMs - 1_000,
    ageMs: 1_000,
    source: 'verification-fixture',
  },
  realObiData: {
    obi: 0.2,
    bidDepthUsd: 10_000,
    askDepthUsd: 5_000,
    levelsCount: 20,
    status: 'LIVE' as const,
    timestamp: nowMs - 1_000,
    ageMs: 1_000,
    latencyMs: 100,
    source: 'verification-fixture',
  },
  fundingRate: -0.0003,
  oi: 10_000,
};

const report = evaluateEightMemberCouncil({ analysis, macroContext, nowMs });
assert.equal(EIGHT_MEMBER_COUNCIL.length, 8);
assert.deepEqual(validateCouncilModuleOwnership(), []);
assert.deepEqual(COUNCIL_COORDINATOR_MODULES, ['sb.SB5']);
assert.ok(EIGHT_MEMBER_COUNCIL.reduce((count, member) => count + member.moduleIds.length, 0) > 0);
const councilModuleIds = new Set(EIGHT_MEMBER_COUNCIL.flatMap((member) => member.moduleIds));
assert.ok(CENTRAL_CONTROL_MODULES.every((id) => !councilModuleIds.has(id)));
assert.ok(UNWIRED_TRADE_MANAGEMENT_MODULES.every((id) => !councilModuleIds.has(id)));
assert.ok(UNWIRED_OR_LEGACY_ANALYSIS_MODULES.every((id) => !councilModuleIds.has(id)));
assert.equal(EIGHT_MEMBER_COUNCIL.filter((member) => member.moduleIds.includes('openSource.newsSentiment')).map(({ id }) => id).join(','), '8');
assert.equal(EIGHT_MEMBER_COUNCIL.filter((member) => member.moduleIds.includes('onchain.bitcoinActiveAddresses')).map(({ id }) => id).join(','), '6');
assert.equal(EIGHT_MEMBER_COUNCIL.filter((member) => member.moduleIds.includes('macro.broadDollarProxy')).map(({ id }) => id).join(','), '7');
assert.equal(report.longVotes, 5);
assert.equal(report.shortVotes, 0);
assert.equal(report.neutralVotes, 0);
assert.equal(report.abstentions, 3);
assert.equal(report.selectedDirection, 'LONG');
assert.equal(report.quorumMet, true);
assert.equal(report.members[4].vote, 'ABSTAIN');
assert.equal(report.members[7].vote, 'ABSTAIN');
assert.match(report.members[0].rationaleFa, /امتیاز عمومی LONG\/SHORT در رأی استفاده نشد/);
const productionShapeCandles = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    candles: analysis.candles.map(([, open, high, low, close]) => [
      open,
      high,
      low,
      close,
      1,
    ]),
  },
  macroContext,
  nowMs,
});
assert.equal(
  productionShapeCandles.members[0].vote,
  'LONG',
  'technical vote must read close at index 3 from the production OHLCV tuple',
);
const locallyComputedRsi = evaluateEightMemberCouncil({
  analysis: { ...analysis, rsi: undefined },
  macroContext,
  nowMs,
});
assert.notEqual(
  locallyComputedRsi.members[0].vote,
  'ABSTAIN',
  'member 1 must calculate RSI14 from fresh close data when the upstream RSI is missing',
);
assert.equal(
  locallyComputedRsi.members[0].qualityChecks.find(({ labelFa }) => labelFa === 'RSI قابل‌محاسبه')?.passed,
  true,
);
assert.match(
  locallyComputedRsi.members[0].qualityChecks.find(({ labelFa }) => labelFa === 'RSI قابل‌محاسبه')?.detailFa ?? '',
  /محاسبه‌شده از closeهای واقعی/,
);
const changedVolumeOnly = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    candles: analysis.candles.map(([, open, high, low, close], index) => [
      open,
      high,
      low,
      close,
      index % 2 === 0 ? 1_000_000 : 0.001,
    ]),
  },
  macroContext,
  nowMs,
});
assert.equal(
  changedVolumeOnly.members[0].vote,
  productionShapeCandles.members[0].vote,
  'changing only volume must not change the technical close-based vote',
);
const contradictoryGeneralScores = evaluateEightMemberCouncil({
  analysis: { ...analysis, scoreLong: 0, scoreShort: 100 },
  macroContext,
  nowMs,
});
assert.equal(contradictoryGeneralScores.members[0].vote, 'LONG');

const directMacroContext: CouncilMacroContext = {
  ...macroContext,
  sp500Status: 'LIVE',
  sp500DailyChangePct: 0.5,
  broadDollarProxyStatus: 'PROXY',
  broadDollarProxyDailyChangePct: -0.2,
  provenance: {
    sp500DailyChangePct: { status: 'LIVE', observedAtMs: nowMs - 1_000 },
    dxyIndex: { status: 'LIVE', observedAtMs: nowMs - 1_000 },
    broadDollarProxy: { status: 'LIVE', observedAtMs: nowMs - 1_000 },
  },
};
const directMacroCouncil = evaluateEightMemberCouncil({
  analysis,
  macroContext: directMacroContext,
  nowMs,
});
assert.equal(directMacroCouncil.members[6].vote, 'LONG');
assert.ok(directMacroCouncil.members[6].moduleIds.includes('macro.dxy'));
assert.match(directMacroCouncil.members[6].rationaleFa, /شاخص واقعی DXY/);
assert.match(directMacroCouncil.members[6].rationaleFa, /proxy، نه DXY/);

const staleDxyCouncil = evaluateEightMemberCouncil({
  analysis,
  macroContext: {
    ...directMacroContext,
    overallDataStatus: 'UNAVAILABLE',
    fundamentalBias: 'UNAVAILABLE',
    sp500Status: 'UNAVAILABLE',
    sp500DailyChangePct: null,
    broadDollarProxyStatus: 'UNAVAILABLE',
    broadDollarProxyDailyChangePct: null,
    etfFlowStatus: 'UNAVAILABLE',
    spotEtfNetInflowMillionUsd: null,
    provenance: {
      dxyIndex: { status: 'LIVE', observedAtMs: nowMs - 121_000 },
    },
  },
  nowMs,
});
assert.equal(staleDxyCouncil.members[6].vote, 'ABSTAIN');

const attachedEvidence = evaluateEightMemberCouncil({
  analysis,
  macroContext,
  supportingModules: {
    'sb.SB1': {
      moduleId: 'sb.SB1',
      nameFa: 'SB1',
      status: 'AVAILABLE',
      sourceTimestampMs: nowMs,
      summaryFa: 'پشتیبان عضو اول',
    },
    'openSource.newsSentiment': {
      moduleId: 'openSource.newsSentiment',
      nameFa: 'News sentiment',
      status: 'AVAILABLE',
      sourceTimestampMs: nowMs,
      summaryFa: 'پشتیبان عضو هشتم',
    },
  },
  nowMs,
});
assert.equal(attachedEvidence.members[0].supportingEvidence.find((item) => item.moduleId === 'sb.SB1')?.summaryFa, 'پشتیبان عضو اول');
assert.equal(attachedEvidence.members[7].supportingEvidence.find((item) => item.moduleId === 'openSource.newsSentiment')?.summaryFa, 'پشتیبان عضو هشتم');
assert.equal(attachedEvidence.members[0].supportingEvidence.length, EIGHT_MEMBER_COUNCIL[0].moduleIds.length);
assert.equal(attachedEvidence.members.length, 8);

const withOptions = evaluateEightMemberCouncil({
  analysis,
  macroContext,
  optionsData: {
    status: 'LIVE',
    provider: 'fixture',
    contractsCount: 24,
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 90,
    impliedVolatilityPct: 55,
    putCallRatio: 0.7,
    expiryTimestampMs: nowMs + 24 * 60 * 60_000,
    strikePrice: 60_000,
    skewPct: 2.5,
  },
  nowMs,
});
assert.equal(withOptions.members[4].vote, 'LONG');
assert.equal(withOptions.longVotes, 6);

const incompleteOptions = evaluateEightMemberCouncil({
  analysis,
  macroContext,
  optionsData: {
    status: 'LIVE',
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 90,
    impliedVolatilityPct: 55,
    putCallRatio: 0.7,
    expiryTimestampMs: null,
    strikePrice: 60_000,
    skewPct: 2.5,
  },
  nowMs,
});
assert.equal(incompleteOptions.members[4].vote, 'ABSTAIN');

const belowQuorum = evaluateEightMemberCouncil({
  analysis: { ...analysis, fundingRate: 0 },
  macroContext,
  nowMs,
});
assert.equal(belowQuorum.longVotes, 4);
assert.equal(belowQuorum.neutralVotes, 1);
assert.equal(belowQuorum.selectedDirection, null);
assert.equal(belowQuorum.quorumMet, false);

const staleFlow = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    orderFlowFeatures: {
      ...analysis.orderFlowFeatures,
      timestampUtc: nowMs - 8_000,
      ageMs: 8_000,
    },
  },
  macroContext,
  nowMs,
});
assert.equal(staleFlow.members[1].vote, 'ABSTAIN');
assert.equal(staleFlow.selectedDirection, null);

console.log('Eight-member council verification passed.');
