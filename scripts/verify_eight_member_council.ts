import assert from 'node:assert/strict';
import type { Candle, DataQualityReport, MarketFeedQuality } from '../src/types/trading';
import type { DirectMetricResult } from '../src/services/freeMacroData';
import {
  CENTRAL_CONTROL_MODULES,
  COUNCIL_COORDINATOR_MODULES,
  EIGHT_MEMBER_COUNCIL,
  UNWIRED_OR_LEGACY_ANALYSIS_MODULES,
  UNWIRED_TRADE_MANAGEMENT_MODULES,
  evaluateEightMemberCouncil,
  getCouncilMacroBeta,
  type CouncilMemberSourceCheck,
  validateCouncilModuleOwnership,
  type CouncilMacroContext,
} from '../src/services/eightMemberCouncil';
import {
  deduplicateDerivativeObservations,
  deduplicateMacroObservations,
  deduplicateNews,
  deduplicateOnChainTransfers,
  deduplicateOptionContracts,
  deduplicateOrderBookSnapshots,
  deduplicateQuotes,
  deduplicateTrades,
} from '../src/services/councilEvidenceDeduplication';
import { getCouncilMemberSources } from '../src/services/councilSourceRegistry';
import {
  calculateMemberFiveProxyScore,
  MEMBER_FIVE_PROXY_CACHE_TTL_MS,
} from '../src/services/memberFiveFuturesProxy';

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
  signalDataTimestamps: {
    fundingRateMs: nowMs - 1_000,
    openInterestMs: nowMs - 1_000,
    mtf1hMs: nowMs - 1_000,
    mtf4hMs: nowMs - 1_000,
  },
};

const report = evaluateEightMemberCouncil({ analysis, macroContext, nowMs });
assert.equal(EIGHT_MEMBER_COUNCIL.length, 8);
assert.deepEqual(validateCouncilModuleOwnership(), []);
assert.deepEqual(COUNCIL_COORDINATOR_MODULES, ['sb.SB5']);
assert.ok(EIGHT_MEMBER_COUNCIL.reduce((count, member) => count + member.moduleIds.length, 0) > 0);
const councilModuleIds = new Set(EIGHT_MEMBER_COUNCIL.flatMap((member) => member.moduleIds));
assert.ok(CENTRAL_CONTROL_MODULES.every((id) => !councilModuleIds.has(id)));
assert.ok(CENTRAL_CONTROL_MODULES.includes('control.holdingHorizonSelector'));
assert.ok(!EIGHT_MEMBER_COUNCIL.some((member) => member.moduleIds.includes('control.holdingHorizonSelector')));
assert.ok(!EIGHT_MEMBER_COUNCIL[0].moduleIds.includes('brains.brain04PatternDivergence'));
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
assert.match(
  report.members[3].qualityChecks.find(({ labelFa }) => labelFa === 'مشاهدات مشتقات یکتا')?.detailFa ?? '',
  /2 مشاهدهٔ یکتا/,
  'member 4 counts funding and open interest as separate typed observations',
);
assert.match(
  report.members[2].qualityChecks.find(({ labelFa }) => labelFa === 'حذف snapshot تکراری')?.detailFa ?? '',
  /0 snapshot تکراری/,
);
assert.match(report.members[0].rationaleFa, /امتیاز عمومی LONG\/SHORT در رأی استفاده نشد/);
const uniqueTradeEvidence = deduplicateTrades([
  { venue: 'binance', symbol: 'BTCUSDT', tradeId: 42, price: 100, amount: 2 },
  { venue: 'BINANCE', symbol: 'btcusdt', tradeId: 42, price: 100, amount: 2 },
  { venue: 'binance', symbol: 'BTCUSDT', tradeId: 43, price: 100, amount: 2 },
]);
assert.equal(uniqueTradeEvidence.values.length, 2,
  'member 2 dedupes only the same venue/symbol/trade id, not distinct equal-valued trades');
assert.equal(uniqueTradeEvidence.duplicateCount, 1);
assert.equal(deduplicateTrades([
  { venue: 'binance', symbol: 'BTCUSDT', price: 100, amount: 2 },
  { venue: 'binance', symbol: 'BTCUSDT', price: 100, amount: 2 },
]).values.length, 2,
'without exchange event ids, equal-valued trades cannot safely be assumed to be duplicates');
const memberTwoTradeRows = [
  { venue: 'binance', symbol: 'BTCUSDT', tradeId: 51, timestampMs: nowMs - 500, side: 'buy', price: 100, amount: 2 },
  { venue: 'binance', symbol: 'BTCUSDT', tradeId: 52, timestampMs: nowMs - 250, side: 'sell', price: 100, amount: 1 },
];
const memberTwoUniqueTrades = deduplicateTrades(memberTwoTradeRows);
const memberTwoRepeatedTrades = deduplicateTrades([
  ...memberTwoTradeRows,
  memberTwoTradeRows[0],
]);
const memberTwoAnalysisForTrades = (trades: typeof memberTwoTradeRows) => {
  const uniqueTrades = deduplicateTrades(trades).values;
  const delta = uniqueTrades.reduce(
    (sum, trade) => sum + (trade.side === 'buy' ? trade.amount! : -trade.amount!),
    0,
  );
  return {
    ...analysis,
    orderFlowFeatures: {
      ...analysis.orderFlowFeatures,
      cvdDelta: delta,
      cvdDeltaUsd: delta * 100,
      takerBuyVol: uniqueTrades.filter(({ side }) => side === 'buy').reduce((sum, trade) => sum + trade.amount!, 0),
      takerSellVol: uniqueTrades.filter(({ side }) => side === 'sell').reduce((sum, trade) => sum + trade.amount!, 0),
      takerDelta: delta,
      cumulativeDelta: delta,
      delta: delta,
    },
  };
};
const memberTwoBaseVote = evaluateEightMemberCouncil({
  analysis: memberTwoAnalysisForTrades(memberTwoTradeRows),
  macroContext,
  nowMs,
}).members[1];
const memberTwoDuplicateVote = evaluateEightMemberCouncil({
  analysis: memberTwoAnalysisForTrades([...memberTwoTradeRows, memberTwoTradeRows[0]]),
  macroContext,
  nowMs,
}).members[1];
assert.equal(memberTwoRepeatedTrades.values.length, memberTwoUniqueTrades.values.length);
assert.equal(memberTwoDuplicateVote.vote, memberTwoBaseVote.vote,
  'member 2 vote must not change when an already-counted venue trade is repeated');

const uniqueBookSnapshots = deduplicateOrderBookSnapshots([
  {
    venue: 'binance',
    symbol: 'BTCUSDT',
    timestampMs: nowMs,
    sequenceId: 7,
    bids: [{ price: 99, amount: 3 }],
    asks: [{ price: 101, amount: 1 }],
  },
  {
    venue: 'BINANCE',
    symbol: 'btcusdt',
    timestampMs: nowMs + 1,
    sequenceId: 7,
    bids: [{ price: 99, amount: 3 }],
    asks: [{ price: 101, amount: 1 }],
  },
  { venue: 'bybit', symbol: 'BTCUSDT', timestampMs: nowMs, sequenceId: 7 },
]);
assert.equal(uniqueBookSnapshots.values.length, 2,
  'member 3 dedupes a repeated venue sequence but preserves an independent venue snapshot');
assert.equal(uniqueBookSnapshots.duplicateCount, 1);
const memberThreeBook = uniqueBookSnapshots.values[0];
const memberThreeBidDepth = memberThreeBook.bids!.reduce((sum, level) => sum + level.price * level.amount, 0);
const memberThreeAskDepth = memberThreeBook.asks!.reduce((sum, level) => sum + level.price * level.amount, 0);
const memberThreeBaseVote = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    realObiData: {
      ...analysis.realObiData,
      obi: (memberThreeBidDepth - memberThreeAskDepth) / (memberThreeBidDepth + memberThreeAskDepth),
      bidDepthUsd: memberThreeBidDepth,
      askDepthUsd: memberThreeAskDepth,
      levelsCount: memberThreeBook.bids!.length + memberThreeBook.asks!.length,
    },
  },
  macroContext,
  nowMs,
}).members[2];
assert.equal(uniqueBookSnapshots.values.length, 2);
assert.equal(memberThreeBaseVote.vote, report.members[2].vote,
  'member 3 vote from the unique snapshot must be unchanged by a repeated venue sequence');
const uniqueQuotes = deduplicateQuotes([
  { exchange: 'binance', symbol: 'BTCUSDT', sourceTimestampMs: nowMs, price: 100 },
  { exchange: 'BINANCE', symbol: 'btcusdt', sourceTimestampMs: nowMs, price: 100 },
  { exchange: 'bybit', symbol: 'BTCUSDT', sourceTimestampMs: nowMs, price: 100 },
]);
assert.equal(uniqueQuotes.values.length, 2,
  'identical prices from different venues remain independent quote evidence');

const uniqueDerivatives = deduplicateDerivativeObservations([
  { venue: 'binance', symbol: 'BTCUSDT', timestampMs: nowMs, dataType: 'funding' },
  { venue: 'BINANCE', symbol: 'btcusdt', timestampMs: nowMs, dataType: 'funding' },
  { venue: 'binance', symbol: 'BTCUSDT', timestampMs: nowMs, dataType: 'open-interest' },
]);
assert.equal(uniqueDerivatives.values.length, 2,
  'member 4 removes repeated funding observations but keeps distinct OI evidence');
assert.equal(uniqueDerivatives.duplicateCount, 1);
const memberFourRepeatedVote = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    signalDataTimestamps: {
      ...analysis.signalDataTimestamps,
      fundingRateMs: uniqueDerivatives.values.find(({ dataType }) => dataType === 'funding')!.timestampMs,
      openInterestMs: uniqueDerivatives.values.find(({ dataType }) => dataType === 'open-interest')!.timestampMs,
    },
  },
  macroContext,
  nowMs,
}).members[3];
assert.equal(memberFourRepeatedVote.vote, report.members[3].vote,
  'member 4 vote must stay constant while repeated funding observations collapse to one alongside independent OI');

const uniqueOptions = deduplicateOptionContracts([
  { venue: 'deribit', instrumentName: 'BTC-30JUN27-100000-C', expiryTimestampMs: nowMs + 1, strikePrice: 100_000, side: 'call' },
  { venue: 'DERIBIT', instrumentName: 'btc-30jun27-100000-c', expiryTimestampMs: nowMs + 1, strikePrice: 100_000, side: 'call' },
  { venue: 'deribit', instrumentName: 'BTC-30JUN27-100000-P', expiryTimestampMs: nowMs + 1, strikePrice: 100_000, side: 'put' },
]);
assert.equal(uniqueOptions.values.length, 2,
  'member 5 keeps call and put contracts distinct while deduping the same venue contract');
assert.equal(uniqueOptions.duplicateCount, 1);

const repeatedTransfer = {
  transactionHash: 'ABCDEF',
  blockchain: 'Ethereum',
  blockHeight: 100,
  timestampMs: nowMs - 1_000,
  sourceProvider: 'provider-a',
  asset: 'ETH',
  amount: 12,
  estimatedUsd: 24_000,
  confirmationStatus: 'CONFIRMED' as const,
  transferId: 'log:3',
};
const uniqueTransfers = deduplicateOnChainTransfers([
  repeatedTransfer,
  { ...repeatedTransfer, sourceProvider: 'provider-b', estimatedUsd: 25_000 },
  { ...repeatedTransfer, transferId: 'log:4' },
]);
assert.equal(uniqueTransfers.values.length, 2,
  'member 6 merges the same blockchain transaction log across providers without merging adjacent logs');
assert.equal(uniqueTransfers.duplicateCount, 1);
const deduplicatedOnchainVote = evaluateEightMemberCouncil({
  analysis,
  macroContext,
  whaleFlowData: {
    status: 'LIVE',
    provider: 'two public mirrors',
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 90,
    independentProviderCount: 2,
    coverageStatus: 'SAMPLED',
    largeTransfers: [
      { ...repeatedTransfer, blockchain: 'bitcoin', transactionHash: 'tx-1', transferId: 'vout:0', asset: 'BTC' },
      { ...repeatedTransfer, blockchain: 'BITCOIN', transactionHash: 'TX-1', transferId: 'VOUT:0', asset: 'BTC', sourceProvider: 'mirror-b' },
    ],
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 1,
    windowStartHeight: 100,
    windowEndHeight: 100,
  },
  nowMs,
});
assert.equal(deduplicatedOnchainVote.members[5].vote, 'ABSTAIN');
assert.match(
  deduplicatedOnchainVote.members[5].qualityChecks.find(({ labelFa }) => labelFa === 'شناسهٔ یکتای انتقال')?.detailFa ?? '',
  /1 انتقال تکراری/,
);
const unidentifiedOnchainVote = evaluateEightMemberCouncil({
  analysis,
  macroContext,
  whaleFlowData: {
    status: 'LIVE',
    provider: 'unidentified test source',
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 90,
    independentProviderCount: 2,
    coverageStatus: 'SAMPLED',
    largeTransfers: [{
      ...repeatedTransfer,
      transactionHash: 'tx-without-output-index',
      transferId: undefined,
    }],
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 1,
    windowStartHeight: 100,
    windowEndHeight: 100,
  },
  nowMs,
});
assert.equal(unidentifiedOnchainVote.members[5].vote, 'ABSTAIN',
  'member 6 must fail closed if a transfer has no logIndex/vout identity');

const uniqueMacroObservations = deduplicateMacroObservations([
  { provider: 'fred', metric: 'DGS10', timestampMs: nowMs, value: 4.2, direction: 1 },
  { provider: 'FRED', metric: 'dgs10', timestampMs: nowMs, value: 4.2, direction: 1 },
  { provider: 'fred-mirror', metric: 'DGS10', timestampMs: nowMs, value: 4.2, direction: 1 },
  { provider: 'fred', metric: 'UNRATE', timestampMs: nowMs, value: 4.2, direction: 1 },
  { provider: 'fred', metric: 'DGS10', timestampMs: nowMs + 1, value: 4.2, direction: 1 },
]);
assert.equal(uniqueMacroObservations.values.length, 4,
  'member 7 identity includes provider, series id, and observation timestamp');
assert.equal(uniqueMacroObservations.duplicateCount, 1);
const directMetricFixture = (
  provider: string,
  metric: string,
  changePct: number,
): DirectMetricResult => ({
  status: 'LIVE',
  provider,
  endpoint: 'https://example.invalid/macro',
  metric,
  value: 100,
  previousValue: 99,
  changePct,
  observedAt: new Date(nowMs - 1_000).toISOString(),
  observedAtMs: nowMs - 1_000,
  retrievedAtMs: nowMs,
  latencyMs: 10,
  ageMs: 1_000,
});
const unavailableMetricFixture = (metric: string): DirectMetricResult => ({
  status: 'UNAVAILABLE',
  provider: 'verification-provider',
  endpoint: 'https://example.invalid/macro',
  metric,
  value: null,
  previousValue: null,
  changePct: null,
  observedAt: null,
  observedAtMs: null,
  retrievedAtMs: null,
  latencyMs: null,
  ageMs: null,
});
const sameMacroSeriesFromDifferentProviders = evaluateEightMemberCouncil({
  analysis,
  macroContext,
  directMacroData: {
    sp500: directMetricFixture('provider-a', 'same-series', 0.2),
    dxy: directMetricFixture('provider-b', 'same-series', -0.2),
    broadDollar: unavailableMetricFixture('broad-dollar'),
    fedEffectiveRate: unavailableMetricFixture('EFFR'),
    fedTargetUpperBound: unavailableMetricFixture('FEDFUNDS'),
    bitcoinActiveAddresses: unavailableMetricFixture('AdrActCnt'),
  },
  nowMs,
});
assert.equal(sameMacroSeriesFromDifferentProviders.members[6].vote, 'LONG');
assert.match(sameMacroSeriesFromDifferentProviders.members[6].rationaleFa, /2 شاخص مستقیم/,
  'member 7 must retain same-series observations from independent providers');

const paraphrasedNews = deduplicateNews([
  {
    url: 'https://news.example/bitcoin-etf-inflows',
    headline: 'Bitcoin price surges as ETF inflows reach record levels',
    publishedAt: new Date(nowMs - 1_000).toISOString(),
  },
  {
    url: 'https://wire.example/crypto-funds',
    headline: 'BTC rallies after exchange-traded funds attract unprecedented capital',
    publishedAt: new Date(nowMs - 2_000).toISOString(),
  },
]);
assert.equal(paraphrasedNews.values.length, 1,
  'member 8 merges cross-publisher rewrites when normalized event and entity terms strongly overlap');
assert.equal(paraphrasedNews.duplicateCount, 1);
const distinctNewsEvents = deduplicateNews([
  {
    url: 'https://news.example/bitcoin-etf-inflows',
    headline: 'Bitcoin price surges as ETF inflows reach record levels',
    publishedAt: new Date(nowMs - 1_000).toISOString(),
  },
  {
    url: 'https://wire.example/bitcoin-mining',
    headline: 'Bitcoin miners announce new energy agreement in Texas',
    publishedAt: new Date(nowMs - 2_000).toISOString(),
  },
]);
assert.equal(distinctNewsEvents.values.length, 2,
  'member 8 preserves distinct news events even when both mention Bitcoin');

const duplicatedCandleCouncil = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    candles: [...analysis.candles, analysis.candles.at(-1)!],
  },
  macroContext,
  nowMs,
});
assert.equal(duplicatedCandleCouncil.members[0].vote, report.members[0].vote);
assert.match(
  duplicatedCandleCouncil.members[0].qualityChecks.find(({ labelFa }) => labelFa === 'حذف کندل تکراری')?.detailFa ?? '',
  /1 کندل تکراری حذف شد/,
);
const conflictingCandleCouncil = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    candles: [
      ...analysis.candles,
      [
        analysis.candles.at(-1)![0],
        analysis.candles.at(-1)![1],
        analysis.candles.at(-1)![2],
        analysis.candles.at(-1)![3],
        analysis.candles.at(-1)![4] + 1,
        analysis.candles.at(-1)![5],
      ],
    ],
  },
  macroContext,
  nowMs,
});
assert.equal(conflictingCandleCouncil.members[0].vote, 'ABSTAIN');
assert.equal(
  conflictingCandleCouncil.members[0].qualityChecks.find(({ labelFa }) => labelFa === 'حذف کندل تکراری')?.passed,
  false,
);
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
  locallyComputedRsi.members[0].qualityChecks.find(({ labelFa }) => labelFa === 'RSI از کندل‌های همین snapshot')?.passed,
  true,
);
assert.match(
  locallyComputedRsi.members[0].qualityChecks.find(({ labelFa }) => labelFa === 'RSI از کندل‌های همین snapshot')?.detailFa ?? '',
  /مستقیماً از closeهای همین snapshot/,
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
const staleIndicatorInputs = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    rsi: 1,
    mtf1h: 'BEARISH',
    mtf4h: 'BEARISH',
    signalDataTimestamps: {
      ...analysis.signalDataTimestamps,
      mtf1hMs: nowMs - 2 * 60 * 60_000,
      mtf4hMs: nowMs - 5 * 60 * 60_000,
    },
  },
  macroContext,
  nowMs,
});
assert.equal(
  staleIndicatorInputs.members[0].vote,
  report.members[0].vote,
  'stale RSI values and stale higher-timeframe signals must not change the technical vote',
);
assert.equal(
  staleIndicatorInputs.members[0].qualityChecks.find(({ labelFa }) => labelFa === 'تازگی تایم‌فریم ۱h/۴h')?.passed,
  false,
);
const staleOneMinuteCandles = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    htfCandles: { '1m': analysis.candles },
    signalDataTimestamps: {
      ...analysis.signalDataTimestamps,
      mtf1mMs: nowMs - 66_000,
    },
  },
  macroContext,
  nowMs,
});
assert.equal(staleOneMinuteCandles.members[0].vote, 'ABSTAIN');
assert.equal(
  staleOneMinuteCandles.members[0].qualityChecks.find(({ labelFa }) => labelFa === 'تازگی کندل رأی')?.passed,
  false,
);
const missingDerivativeTimestamps = evaluateEightMemberCouncil({
  analysis: { ...analysis, signalDataTimestamps: undefined },
  macroContext,
  nowMs,
});
assert.equal(
  missingDerivativeTimestamps.members[3].vote,
  'ABSTAIN',
  'derivatives must abstain when individual funding and open-interest timestamps are missing',
);
const staleDerivativeInputs = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    signalDataTimestamps: {
      ...analysis.signalDataTimestamps,
      fundingRateMs: nowMs - 61_000,
      openInterestMs: nowMs - 11 * 60_000,
    },
  },
  macroContext,
  nowMs,
});
assert.equal(staleDerivativeInputs.members[3].vote, 'ABSTAIN');
const slightlyStaleDerivativeInputs = evaluateEightMemberCouncil({
  analysis: {
    ...analysis,
    signalDataTimestamps: {
      ...analysis.signalDataTimestamps,
      openInterestMs: nowMs - 11_000,
    },
  },
  macroContext,
  nowMs,
});
assert.equal(
  slightlyStaleDerivativeInputs.members[3].vote,
  'ABSTAIN',
  'current open interest older than 10 seconds must not affect the derivatives vote',
);

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
assert.equal(directMacroCouncil.members[6].dataQualityPct, 67,
  'macro member quality reflects two live source groups out of three expected groups');
assert.ok(directMacroCouncil.members[6].moduleIds.includes('macro.dxy'));
assert.match(directMacroCouncil.members[6].rationaleFa, /شاخص واقعی DXY/);
assert.match(directMacroCouncil.members[6].rationaleFa, /proxy دلار به‌جای DXY معرفی نشده/);

const newsQualityCouncil = evaluateEightMemberCouncil({
  analysis,
  macroContext: {
    ...macroContext,
    newsSentimentStatus: 'LIVE',
    newsSentimentScore: 15,
    newsHeadlinesStatus: 'LIVE',
    recentHeadlines: Array.from({ length: 10 }, (_, index) => ({
      id: `quality-headline-${index}`,
      headline: `Recent verified headline ${index}`,
      source: index % 2 === 0 ? 'Source A' : 'Source B',
      url: `https://example.invalid/${index}`,
      publishedAt: new Date(nowMs - index * 1_000).toISOString(),
    })),
  },
  nowMs,
});
assert.equal(newsQualityCouncil.members[7].vote, 'LONG');
assert.equal(newsQualityCouncil.members[7].dataQualityPct, 80,
  'news member quality combines headline coverage and independent publisher coverage');
const duplicateNewsCouncil = evaluateEightMemberCouncil({
  analysis,
  macroContext: {
    ...macroContext,
    newsSentimentStatus: 'LIVE',
    newsSentimentScore: 15,
    newsHeadlinesStatus: 'LIVE',
    recentHeadlines: [
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `dedupe-headline-${index}`,
        headline: `Unique verified headline ${index}`,
        source: index % 2 === 0 ? 'Source A' : 'Source B',
        url: `https://example.invalid/dedupe-${index}`,
        publishedAt: new Date(nowMs - index * 1_000).toISOString(),
      })),
      {
        id: 'dedupe-headline-duplicate',
        headline: 'Duplicate first headline',
        source: 'Source A',
        url: 'https://example.invalid/dedupe-0',
        publishedAt: new Date(nowMs).toISOString(),
      },
    ],
  },
  nowMs,
});
assert.equal(duplicateNewsCouncil.members[7].dataQualityPct, 80);
assert.match(duplicateNewsCouncil.members[7].qualityChecks[0].detailFa, /10 خبر یکتا/);
const semanticallyDuplicateNewsCouncil = evaluateEightMemberCouncil({
  analysis,
  macroContext: {
    ...macroContext,
    newsSentimentStatus: 'LIVE',
    newsSentimentScore: 15,
    newsHeadlinesStatus: 'LIVE',
    recentHeadlines: [
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `semantic-${index}`,
        headline: `Bitcoin market update reports verified event number ${index} after strong institutional inflows`,
        source: index % 2 === 0 ? 'Source A' : 'Source B',
        url: `https://example.invalid/semantic-${index}`,
        publishedAt: new Date(nowMs - index * 1_000).toISOString(),
      })),
      {
        id: 'semantic-duplicate',
        headline: 'Bitcoin market update reports verified event number 0 after strong institutional inflows today',
        source: 'Syndicated Source',
        url: 'https://different.example.invalid/rewritten-story',
        publishedAt: new Date(nowMs - 2_000).toISOString(),
      },
    ],
  },
  nowMs,
});
assert.equal(
  semanticallyDuplicateNewsCouncil.members[7].vote,
  'LONG',
  JSON.stringify({
    rationale: semanticallyDuplicateNewsCouncil.members[7].rationaleFa,
    checks: semanticallyDuplicateNewsCouncil.members[7].qualityChecks,
    quality: semanticallyDuplicateNewsCouncil.members[7].dataQualityPct,
  }),
);
assert.match(
  semanticallyDuplicateNewsCouncil.members[7].qualityChecks.find(({ labelFa }) =>
    labelFa === 'حذف خبرهای تکراری و هم‌معنی',
  )?.detailFa ?? '',
  /1 خبر تکراری\/هم‌معنی/,
);
assert.match(semanticallyDuplicateNewsCouncil.members[7].qualityChecks[0].detailFa, /10 خبر یکتا/);
const staleNewsCoverage = evaluateEightMemberCouncil({
  analysis,
  macroContext: {
    ...macroContext,
    newsSentimentStatus: 'LIVE',
    newsSentimentScore: 15,
    newsHeadlinesStatus: 'LIVE',
    recentHeadlines: [
      {
        id: 'fresh-news-1',
        headline: 'Fresh Bitcoin market update with current verified information',
        source: 'Source A',
        url: 'https://example.invalid/fresh-one',
        publishedAt: new Date(nowMs - 1_000).toISOString(),
      },
      {
        id: 'stale-news-2',
        headline: 'Older Bitcoin market update with verified information',
        source: 'Source B',
        url: 'https://example.invalid/stale-two',
        publishedAt: new Date(nowMs - 7 * 60 * 60_000).toISOString(),
      },
      {
        id: 'stale-news-3',
        headline: 'Another old financial market report for bitcoin',
        source: 'Source A',
        url: 'https://example.invalid/stale-three',
        publishedAt: new Date(nowMs - 8 * 60 * 60_000).toISOString(),
      },
    ],
  },
  nowMs,
});
assert.equal(staleNewsCoverage.members[7].vote, 'ABSTAIN',
  'stale headlines must not satisfy unique fresh news coverage for member 8');

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
    callOpenInterest: 100,
    putOpenInterest: 70,
    callContractsCount: 12,
    putContractsCount: 12,
    bidAskValidatedContracts: 24,
    bidAskSizeValidatedContracts: 8,
    medianBidAskSpreadPct: 2,
    volume24h: 100,
    underlyingPrice: 60_000,
    expiryTimestampMs: nowMs + 24 * 60 * 60_000,
    strikePrice: 60_000,
    skewPct: -2.5,
  },
  nowMs,
});
assert.equal(withOptions.members[4].vote, 'LONG');
assert.equal(withOptions.longVotes, 6);
const sixContractAltcoinData = {
  pair: 'BNB/USDT:USDT',
  asset: 'BNB',
  status: 'LIVE' as const,
  provider: 'fixture',
  contractsCount: 6,
  timestampMs: nowMs - 1_000,
  ageMs: 1_000,
  qualityPct: 90,
  impliedVolatilityPct: 55,
  putCallRatio: 0.7,
  callOpenInterest: 100,
  putOpenInterest: 70,
  callContractsCount: 3,
  putContractsCount: 3,
  bidAskValidatedContracts: 6,
  bidAskSizeValidatedContracts: 4,
  medianBidAskSpreadPct: 2,
  volume24h: 100,
  underlyingPrice: 600,
  expiryTimestampMs: nowMs + 24 * 60 * 60_000,
  strikePrice: 600,
  skewPct: -2.5,
};
const sixContractAltcoinOptions = evaluateEightMemberCouncil({
  pair: 'BNB/USDT:USDT',
  analysis,
  macroContext,
  optionsData: sixContractAltcoinData,
  nowMs,
});
assert.equal(sixContractAltcoinOptions.members[4].vote, 'LONG',
  'six fresh, liquid BNB contracts meet the altcoin contract threshold');
const staleAltcoinOptions = evaluateEightMemberCouncil({
  pair: 'BNB/USDT:USDT',
  analysis,
  macroContext,
  optionsData: {
    ...sixContractAltcoinData,
    timestampMs: nowMs - 60_001,
    ageMs: 60_001,
  },
  nowMs,
});
assert.equal(staleAltcoinOptions.members[4].vote, 'ABSTAIN',
  'altcoin options data older than 60 seconds is rejected');
const conflictingOptions = evaluateEightMemberCouncil({
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
    putCallRatio: 0.79,
    callOpenInterest: 100,
    putOpenInterest: 79,
    callContractsCount: 12,
    putContractsCount: 12,
    bidAskValidatedContracts: 24,
    bidAskSizeValidatedContracts: 8,
    medianBidAskSpreadPct: 2,
    volume24h: 100,
    underlyingPrice: 60_000,
    expiryTimestampMs: nowMs + 24 * 60 * 60_000,
    strikePrice: 60_000,
    skewPct: 2.01,
  },
  nowMs,
});
assert.equal(conflictingOptions.members[4].vote, 'NEUTRAL',
  'conflicting OI and IV-skew direction neutralizes the source score');

const memberFiveNormalizedData = {
  putCallOpenInterestRatio: 0.7,
  putCallIvSpread: -0.025,
  optionQualityPct: 90,
  callOpenInterest: 100,
  putOpenInterest: 70,
  optionInstrumentCount: 24,
  optionCallContractCount: 12,
  optionPutContractCount: 12,
  bidAskValidatedContracts: 24,
  bidAskSizeValidatedContracts: 8,
  medianBidAskSpreadPct: 2,
  optionsVolume24h: 100,
  optionImpliedVolatilityPct: 55,
  optionUnderlyingPrice: 3_000,
  optionStrikePrice: 3_000,
  optionExpiryTimestampMs: nowMs + 24 * 60 * 60_000,
  optionTimestampMs: nowMs - 1_000,
};
const memberFiveSourceChecks: CouncilMemberSourceCheck[] = [
  { sourceId: 'council.member5.deribit-options', status: 'HEALTHY', detail: 'Live Deribit options response.', dataValid: true, observedAtMs: nowMs, normalizedData: memberFiveNormalizedData },
  { sourceId: 'council.member5.okx-opt-summary', status: 'BROKEN', detail: 'HTTP 500.', dataValid: false },
  { sourceId: 'council.member5.bybit-options', status: 'REGION_RESTRICTED', detail: 'HTTP 403.', dataValid: false },
  { sourceId: 'council.member5.binance-eapi', status: 'MISSING_API_KEY', detail: 'API key absent.', dataValid: false },
  { sourceId: 'council.member5.delta-options', status: 'BROKEN', detail: 'HTTP 503.', dataValid: false },
];
const insufficientMemberSources = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  optionsData: {
    pair: 'ETH/USDT:USDT',
    asset: 'ETH',
    sourceId: 'council.member5.deribit-options',
    provider: 'Deribit',
    status: 'LIVE',
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 90,
    impliedVolatilityPct: 55,
    putCallRatio: 0.7,
    contractsCount: 24,
    expiryTimestampMs: nowMs + 24 * 60 * 60_000,
    strikePrice: 3_000,
    skewPct: 2.5,
  },
  memberSourceChecks: { 5: memberFiveSourceChecks },
  requireMemberSourceQuorum: true,
  nowMs,
});
assert.equal(insufficientMemberSources.members[4].vote, 'ABSTAIN');
assert.equal(insufficientMemberSources.members[4].healthySourceCount, 0,
  'one direct options source does not satisfy the selected proxy fallback quorum');
assert.equal(insufficientMemberSources.members[4].sourceChecks.length, 11);
assert.match(insufficientMemberSources.members[4].rationaleFa, /0\/3/);

const validMemberFiveVote = {
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  optionsData: {
    pair: 'ETH/USDT:USDT',
    asset: 'ETH',
    sourceId: 'council.member5.deribit-options',
    provider: 'Deribit',
    status: 'LIVE' as const,
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 90,
    impliedVolatilityPct: 55,
    putCallRatio: 1.6,
    callOpenInterest: 100,
    putOpenInterest: 160,
    contractsCount: 24,
    callContractsCount: 12,
    putContractsCount: 12,
    bidAskValidatedContracts: 24,
    bidAskSizeValidatedContracts: 8,
    medianBidAskSpreadPct: 2,
    volume24h: 100,
    underlyingPrice: 3_000,
    expiryTimestampMs: nowMs + 24 * 60 * 60_000,
    strikePrice: 3_000,
    skewPct: 2.5,
  },
  requireMemberSourceQuorum: true,
  nowMs,
};
const allHealthySources = memberFiveSourceChecks.map((check) => ({
  ...check,
  status: 'HEALTHY' as const,
  dataValid: true,
  observedAtMs: nowMs,
  normalizedData: memberFiveNormalizedData,
}));
const twoHealthySources = memberFiveSourceChecks.map((check, index) => ({
  ...check,
  status: index < 2 ? 'HEALTHY' as const : check.status,
  dataValid: index < 2,
  observedAtMs: index < 2 ? nowMs : null,
  normalizedData: index < 2 ? memberFiveNormalizedData : {},
}));
const oneHealthySource = memberFiveSourceChecks.map((check, index) => ({
  ...check,
  status: index === 0 ? 'HEALTHY' as const : check.status,
}));
const allHealthyVote = evaluateEightMemberCouncil({
  ...validMemberFiveVote,
  memberSourceChecks: { 5: allHealthySources },
}).members[4];
const twoHealthyVote = evaluateEightMemberCouncil({
  ...validMemberFiveVote,
  memberSourceChecks: { 5: twoHealthySources },
}).members[4];
const oneHealthyVote = evaluateEightMemberCouncil({
  ...validMemberFiveVote,
  memberSourceChecks: { 5: oneHealthySource },
}).members[4];
assert.equal(allHealthyVote.vote, 'LONG', 'all five healthy sources preserve a normal member vote');
assert.equal(allHealthyVote.healthySourceCount, 3,
  'BTC/ETH direct quorum counts only Deribit, OKX, and Bybit options venues');
assert.equal(allHealthyVote.evidenceTrack, 'OPTIONS');
assert.ok((allHealthyVote.confidencePct ?? 0) >= 80 &&
  (allHealthyVote.confidencePct ?? 100) <= 95,
'direct options confidence remains in the requested heuristic range');
assert.equal(twoHealthyVote.vote, 'LONG', 'two healthy sources meet the member quorum');
assert.equal(twoHealthyVote.healthySourceCount, 2);
assert.equal(oneHealthyVote.vote, 'ABSTAIN', 'one healthy source is below the member quorum');
assert.equal(oneHealthyVote.healthySourceCount, 0,
  'the failed options track does not count as quorum for a proxy fallback vote');
assert.equal(oneHealthyVote.sourceId, 'council.member5.deribit-options');
assert.deepEqual(oneHealthyVote.usedSourceIds, [], 'partial options evidence is not reported as used in an abstaining vote');
const bnbOnlySource = getCouncilMemberSources(5, 'BNB')[0];
assert.ok(bnbOnlySource, 'BNB has a registered member 5 options source');
const oneHealthyBnbSourceVote = evaluateEightMemberCouncil({
  pair: 'BNB/USDT:USDT',
  analysis,
  macroContext,
  optionsData: {
    pair: 'BNB/USDT:USDT',
    asset: 'BNB',
    provider: bnbOnlySource.provider,
    status: 'LIVE',
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 90,
    impliedVolatilityPct: 55,
    putCallRatio: 0.79,
    callOpenInterest: 100,
    putOpenInterest: 79,
    contractsCount: 6,
    callContractsCount: 3,
    putContractsCount: 3,
    bidAskValidatedContracts: 6,
    bidAskSizeValidatedContracts: 4,
    medianBidAskSpreadPct: 2,
    volume24h: 100,
    underlyingPrice: 600,
    expiryTimestampMs: nowMs + 24 * 60 * 60_000,
    strikePrice: 600,
    skewPct: 2.01,
  },
  memberSourceChecks: {
    5: [{
      sourceId: bnbOnlySource.id,
      status: 'HEALTHY',
      detail: 'Live BNB options evidence.',
      dataValid: true,
      observedAtMs: nowMs,
      normalizedData: {
        ...memberFiveNormalizedData,
        putCallOpenInterestRatio: 0.79,
        putOpenInterest: 79,
        optionInstrumentCount: 6,
        optionCallContractCount: 3,
        optionPutContractCount: 3,
        bidAskValidatedContracts: 6,
        bidAskSizeValidatedContracts: 4,
        putCallIvSpread: 0.0201,
        optionUnderlyingPrice: 600,
        optionStrikePrice: 600,
        optionTimestampMs: nowMs - 1_000,
      },
    }],
  },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[4];
assert.equal(oneHealthyBnbSourceVote.vote, 'NEUTRAL',
  'a single healthy BNB source meets the altcoin quorum and OI/skew conflict scores neutral');
assert.equal(oneHealthyBnbSourceVote.healthySourceCount, 1);
assert.ok((oneHealthyBnbSourceVote.confidencePct ?? 0) >= 80 &&
  (oneHealthyBnbSourceVote.confidencePct ?? 100) <= 95);
assert.deepEqual(oneHealthyBnbSourceVote.usedSourceIds, [bnbOnlySource.id]);

const proxyInputs = {
  fundingRate: 0.0002,
  fundingDeviation: 0.0002,
  longShortRatio: 2,
  openInterestChangePct: 0.5,
  priceReturnPct: -0.5,
  liquidationImbalance: null,
};
const proxyScore = calculateMemberFiveProxyScore(proxyInputs);
assert.ok(proxyScore !== null);
const longLiquidationScore = calculateMemberFiveProxyScore({
  ...proxyInputs,
  liquidationImbalance: -1,
});
const shortLiquidationScore = calculateMemberFiveProxyScore({
  ...proxyInputs,
  liquidationImbalance: 1,
});
assert.ok(longLiquidationScore !== null && shortLiquidationScore !== null);
assert.ok(shortLiquidationScore > proxyScore && proxyScore > longLiquidationScore,
  'fresh short-liquidation pressure raises the proxy score and long-liquidation pressure lowers it');
const proxyNormalizedData = {
  proxyCacheStatus: 'FRESH',
  proxyCacheAgeMs: 0,
  proxyCacheReceivedAtMs: nowMs - 1_000,
  proxyTimestampMs: nowMs - 5_000,
  proxyFundingTimestampMs: nowMs - 1_000,
  proxyPositioningTimestampMs: nowMs - 5_000,
  proxyPriceTimestampMs: nowMs - 1_000,
  proxyFundingRate: proxyInputs.fundingRate,
  proxyFundingBaselineRate: proxyInputs.fundingRate - proxyInputs.fundingDeviation,
  proxyFundingDeviation: proxyInputs.fundingDeviation,
  proxyLongShortRatio: proxyInputs.longShortRatio,
  proxyOpenInterestChangePct: proxyInputs.openInterestChangePct,
  proxyPriceReturnPct: proxyInputs.priceReturnPct,
  proxyRealizedVolatilityPct: 0.05,
  proxyDirectionScore: proxyScore,
};
const proxyOutlierInputs = {
  ...proxyInputs,
  fundingRate: 0.02,
};
const proxyOutlierScore = calculateMemberFiveProxyScore(proxyOutlierInputs);
assert.ok(proxyOutlierScore !== null);
const memberFiveProxySources = getCouncilMemberSources(5, 'ETH');
const memberFiveProxyChecks = memberFiveProxySources.map((source) => {
  const sourceIsProxy = source.id.includes('.proxy.');
  const useProxy = sourceIsProxy;
  const normalizedData = useProxy && source.id.includes('.gateio-futures.')
    ? {
        ...proxyNormalizedData,
        proxyFundingRate: proxyOutlierInputs.fundingRate,
        proxyFundingBaselineRate:
          proxyOutlierInputs.fundingRate - proxyOutlierInputs.fundingDeviation,
        proxyDirectionScore: proxyOutlierScore,
      }
    : proxyNormalizedData;
  return {
    sourceId: source.id,
    status: useProxy ? 'HEALTHY' as const : 'BROKEN' as const,
    detail: sourceIsProxy ? 'Fresh futures proxy fixture.' : 'No qualifying options chain.',
    dataValid: useProxy,
    voteValue: useProxy ? 'USEFUL' as const : 'LOW_VALUE' as const,
    observedAtMs: useProxy ? nowMs - 1_000 : null,
    sourceTimestampMs: useProxy ? nowMs - 5_000 : null,
    normalizedData: useProxy ? normalizedData : {},
  };
});
const memberFiveProxyVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 5: memberFiveProxyChecks },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[4];
assert.equal(memberFiveProxyVote.evidenceTrack, 'FUTURES_PROXY');
assert.equal(memberFiveProxyVote.vote, 'SHORT');
assert.equal(memberFiveProxyVote.healthySourceCount, 5);
assert.equal(memberFiveProxyVote.sourceQuorumRequired, 3);
assert.equal(memberFiveProxyVote.proxyAggregate?.sourceCount, 5);
assert.equal(memberFiveProxyVote.proxyAggregate?.fundingRate, proxyInputs.fundingRate);
assert.equal(memberFiveProxyVote.proxyAggregate?.directionScore, proxyScore,
  'one extreme funding value is excluded by the five-venue median');
assert.ok((memberFiveProxyVote.confidencePct ?? 0) >= 60 &&
  (memberFiveProxyVote.confidencePct ?? 100) <= 75);
assert.ok((memberFiveProxyVote.voteWeightPct ?? 0) >= 60 &&
  (memberFiveProxyVote.voteWeightPct ?? 100) <= 75);

const expiredProxyChecks = memberFiveProxyChecks.map((check) => ({
  ...check,
  normalizedData: check.sourceId.includes('.proxy.')
    ? {
        ...check.normalizedData,
        proxyCacheStatus: 'EXPIRED',
        proxyCacheAgeMs: MEMBER_FIVE_PROXY_CACHE_TTL_MS + 1,
      }
    : check.normalizedData,
}));
const expiredProxyVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 5: expiredProxyChecks },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[4];
assert.equal(expiredProxyVote.vote, 'ABSTAIN',
  'expired proxy snapshots are excluded from both the median and the three-source quorum');
assert.equal(expiredProxyVote.healthySourceCount, 0);
assert.equal(expiredProxyVote.proxyAggregate ?? null, null);

const oneProxyCheck = memberFiveProxyChecks.map((check) => ({
  ...check,
  status: check.sourceId.includes('.proxy.binance-futures.') ? 'HEALTHY' as const : 'BROKEN' as const,
  dataValid: check.sourceId.includes('.proxy.binance-futures.'),
  voteValue: check.sourceId.includes('.proxy.binance-futures.') ? 'USEFUL' as const : 'LOW_VALUE' as const,
  observedAtMs: check.sourceId.includes('.proxy.binance-futures.') ? nowMs - 1_000 : null,
  sourceTimestampMs: check.sourceId.includes('.proxy.binance-futures.') ? nowMs - 5_000 : null,
  normalizedData: check.sourceId.includes('.proxy.binance-futures.') ? proxyNormalizedData : {},
}));
const insufficientProxyVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 5: oneProxyCheck },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[4];
assert.equal(insufficientProxyVote.vote, 'ABSTAIN',
  'one futures venue cannot satisfy the three-source proxy quorum');
assert.equal(insufficientProxyVote.healthySourceCount, 1);
assert.equal(insufficientProxyVote.sourceQuorumRequired, 3);

const oneBnbProxySource = getCouncilMemberSources(5, 'BNB').find(({ id }) =>
  id.includes('.proxy.binance-futures.'),
);
assert.ok(oneBnbProxySource);
const oneBnbProxyVote = evaluateEightMemberCouncil({
  pair: 'BNB/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: {
    5: getCouncilMemberSources(5, 'BNB').map((source) => {
      const healthy = source.id === oneBnbProxySource.id;
      return {
        sourceId: source.id,
        status: healthy ? 'HEALTHY' as const : 'BROKEN' as const,
        detail: healthy ? 'Fresh BNB proxy fixture.' : 'No qualifying BNB options/proxy data.',
        dataValid: healthy,
        voteValue: healthy ? 'USEFUL' as const : 'LOW_VALUE' as const,
        observedAtMs: healthy ? nowMs - 1_000 : null,
        sourceTimestampMs: healthy ? nowMs - 5_000 : null,
        normalizedData: healthy ? proxyNormalizedData : {},
      };
    }),
  },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[4];
assert.equal(oneBnbProxyVote.vote, 'ABSTAIN',
  'one complete BNB futures venue does not meet the three-source proxy quorum');
assert.equal(oneBnbProxyVote.evidenceTrack, 'FUTURES_PROXY');
assert.equal(oneBnbProxyVote.healthySourceCount, 1);
assert.equal(oneBnbProxyVote.sourceQuorumRequired, 3);

const threeBnbProxyVote = evaluateEightMemberCouncil({
  pair: 'BNB/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: {
    5: getCouncilMemberSources(5, 'BNB').map((source) => {
      const healthy = source.id.includes('.proxy.') &&
        ['.binance-futures.', '.bybit-futures.', '.okx-futures.']
          .some((venue) => source.id.includes(venue));
      return {
        sourceId: source.id,
        status: healthy ? 'HEALTHY' as const : 'BROKEN' as const,
        detail: healthy ? 'Fresh BNB proxy fixture.' : 'No qualifying BNB options/proxy data.',
        dataValid: healthy,
        voteValue: healthy ? 'USEFUL' as const : 'LOW_VALUE' as const,
        observedAtMs: healthy ? nowMs - 1_000 : null,
        sourceTimestampMs: healthy ? nowMs - 5_000 : null,
        normalizedData: healthy ? proxyNormalizedData : {},
      };
    }),
  },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[4];
assert.equal(threeBnbProxyVote.vote, 'SHORT',
  'three independent BNB futures venues satisfy the fixed proxy quorum');
assert.equal(threeBnbProxyVote.healthySourceCount, 3);
assert.equal(threeBnbProxyVote.sourceQuorumRequired, 3);
assert.ok((threeBnbProxyVote.confidencePct ?? 0) >= 60 &&
  (threeBnbProxyVote.confidencePct ?? 100) <= 75);
assert.ok((threeBnbProxyVote.voteWeightPct ?? 0) >= 60 &&
  (threeBnbProxyVote.voteWeightPct ?? 100) <= 75);

const memberTwoIds = [
  'council.member2.coinbase-trades',
  'council.member2.kraken-trades',
  'council.member2.okx-trades',
  'council.member2.bitfinex-trades',
  'council.member2.binance-trades',
];
const memberTwoSourceChecks: CouncilMemberSourceCheck[] = memberTwoIds.map((sourceId, index) => ({
  sourceId,
  status: index < 2 ? 'HEALTHY' : 'BROKEN',
  detail: 'Five-minute classified trade-flow measurement.',
  dataValid: index < 2,
  observedAtMs: nowMs,
  normalizedData: index < 2
    ? {
      cvdEth: 2,
      buyVolumeEth: 3,
      sellVolumeEth: 1,
      classifiedTradeCount: 6,
      cvdWindowMs: 5 * 60_000,
      tradeTimestampMs: nowMs - 1_000,
    }
    : {},
}));
const memberTwoVote = (checks: CouncilMemberSourceCheck[]) => evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 2: checks },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[1];
const memberTwoFiveSources = memberTwoVote(memberTwoSourceChecks.map((check) => ({
  ...check,
  status: 'HEALTHY',
  dataValid: true,
  normalizedData: {
    cvdEth: 2,
    buyVolumeEth: 3,
    sellVolumeEth: 1,
    classifiedTradeCount: 6,
    cvdWindowMs: 5 * 60_000,
    tradeTimestampMs: nowMs - 1_000,
  },
})));
const memberTwoTwoSources = memberTwoVote(memberTwoSourceChecks);
const memberTwoDisagreeingSources = memberTwoVote(memberTwoSourceChecks.map((check, index) => ({
  ...check,
  normalizedData: index === 1
    ? {
      cvdEth: -2,
      buyVolumeEth: 1,
      sellVolumeEth: 3,
      classifiedTradeCount: 6,
      cvdWindowMs: 5 * 60_000,
      tradeTimestampMs: nowMs - 1_000,
    }
    : check.normalizedData,
})));
const memberTwoOneSource = memberTwoVote(memberTwoSourceChecks.map((check, index) => ({
  ...check,
  status: index === 3 ? 'HEALTHY' : 'BROKEN',
  dataValid: index === 3,
  normalizedData: index === 3
    ? {
      cvdEth: -2,
      buyVolumeEth: 1,
      sellVolumeEth: 3,
      classifiedTradeCount: 8,
      cvdWindowMs: 5 * 60_000,
      tradeTimestampMs: nowMs - 1_000,
    }
    : {},
})));
const memberTwoSplitMarket = memberTwoVote(memberTwoSourceChecks.map((check, index) => ({
  ...check,
  status: index === 0 || index === 4 ? 'HEALTHY' : 'BROKEN',
  dataValid: index === 0 || index === 4,
  normalizedData: index === 0 || index === 4
    ? {
      cvdEth: 2,
      buyVolumeEth: 3,
      sellVolumeEth: 1,
      classifiedTradeCount: 6,
      cvdWindowMs: 5 * 60_000,
      tradeTimestampMs: nowMs - 1_000,
    }
    : {},
})));
const memberTwoStaleSource = memberTwoVote(memberTwoSourceChecks.map((check, index) => ({
  ...check,
  normalizedData: index === 1
    ? {
      ...check.normalizedData,
      tradeTimestampMs: nowMs - 60_001,
    }
    : check.normalizedData,
})));
assert.equal(memberTwoFiveSources.vote, 'LONG');
assert.equal(memberTwoFiveSources.healthySourceCount, 5);
assert.equal(memberTwoTwoSources.vote, 'LONG');
assert.equal(memberTwoTwoSources.healthySourceCount, 2);
assert.equal(memberTwoTwoSources.fallbackSourceId, null,
  'healthy primary source with a secondary confirmation is not a failover');
assert.equal(memberTwoDisagreeingSources.vote, 'NEUTRAL',
  'member 2 averages independent CVD signals instead of following the first exchange');
assert.equal(memberTwoOneSource.vote, 'ABSTAIN',
  'member 2 must abstain when only one independent exchange is valid');
assert.equal(memberTwoOneSource.healthySourceCount, 1);
assert.equal(memberTwoOneSource.sourceId, 'council.member2.bitfinex-trades');
assert.equal(memberTwoOneSource.fallbackSourceId, 'council.member2.bitfinex-trades',
  'an abstaining vote identifies the only valid non-primary source as its fallback evidence');
assert.match(memberTwoOneSource.rationaleFa, /ABSTAIN/);
assert.equal(memberTwoSplitMarket.vote, 'ABSTAIN',
  'one spot and one futures venue do not satisfy a same-market CVD quorum');
assert.equal(memberTwoSplitMarket.healthySourceCount, 2);
const bnbMemberTwoChecks = getCouncilMemberSources(2, 'BNB').map((source) => ({
  sourceId: source.id,
  status: 'HEALTHY' as const,
  detail: 'Timestamped five-minute BNB CVD source.',
  dataValid: true,
  observedAtMs: nowMs,
  normalizedData: {
    cvdBase: 2,
    buyVolumeBase: 3,
    sellVolumeBase: 1,
    classifiedTradeCount: 20,
    cvdWindowMs: 5 * 60_000,
    tradeTimestampMs: nowMs - 1_000,
  },
}));
const bnbMemberTwoVote = evaluateEightMemberCouncil({
  pair: 'BNB/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 2: bnbMemberTwoChecks },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[1];
assert.equal(bnbMemberTwoVote.vote, 'LONG');
assert.deepEqual(
  new Set(bnbMemberTwoVote.usedSourceIds),
  new Set(bnbMemberTwoChecks.map(({ sourceId }) => sourceId)),
  'quorate BNB Spot and Futures CVD groups are both used without pooling their trade volumes',
);
assert.ok(bnbMemberTwoVote.usedSourceIds?.includes('council.member2.BNB.bybit-trades'));
assert.ok(bnbMemberTwoVote.rationaleFa.includes('spot=0.5000'));
assert.ok(bnbMemberTwoVote.rationaleFa.includes('futures=0.5000'));
const conflictingBnbMarkets = bnbMemberTwoChecks.map((check) => {
  const isFutures = check.sourceId.endsWith('.bybit-trades') ||
    check.sourceId.endsWith('.binance-trades');
  return {
    ...check,
    normalizedData: isFutures
      ? {
        cvdBase: -2,
        buyVolumeBase: 1,
        sellVolumeBase: 3,
        classifiedTradeCount: 20,
        cvdWindowMs: 5 * 60_000,
        tradeTimestampMs: nowMs - 1_000,
      }
      : check.normalizedData,
  };
});
const conflictingBnbVote = evaluateEightMemberCouncil({
  pair: 'BNB/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 2: conflictingBnbMarkets },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[1];
assert.equal(conflictingBnbVote.vote, 'ABSTAIN');
assert.deepEqual(conflictingBnbVote.usedSourceIds, []);
assert.match(conflictingBnbVote.rationaleFa, /Spot و Futures.*متعارض/);
assert.equal(memberTwoStaleSource.vote, 'ABSTAIN',
  'a stale trade timestamp cannot contribute to member 2 CVD quorum');
assert.equal(memberTwoStaleSource.healthySourceCount, 1);
assert.equal(
  memberTwoStaleSource.sourceChecks.find(({ sourceId }) => sourceId === 'council.member2.kraken-trades')?.status,
  'BROKEN',
  'vote reporting rejects an otherwise HEALTHY check when its CVD timestamp is stale',
);

const memberSevenSourceChecks: CouncilMemberSourceCheck[] = [
  {
    sourceId: 'council.member7.fred',
    status: 'HEALTHY',
    detail: 'Dated public FRED series with S&P and broad-dollar changes.',
    dataValid: true,
    observedAtMs: nowMs,
    normalizedData: { macroDirectionValue: 1 },
  },
  {
    sourceId: 'council.member7.cboe-vix',
    status: 'HEALTHY',
    detail: 'Dated VIX close and change.',
    dataValid: true,
    observedAtMs: nowMs,
    normalizedData: { macroDirectionValue: -1 },
  },
  {
    sourceId: 'council.member7.yahoo-chart',
    status: 'HEALTHY',
    detail: 'Unofficial dated daily Yahoo observations.',
    dataValid: true,
    observedAtMs: nowMs,
    normalizedData: { macroDirectionValue: 1 },
  },
  {
    sourceId: 'council.member7.fred-market-series',
    status: 'HEALTHY',
    detail: 'Additional dated FRED series from the same provider family.',
    dataValid: true,
    observedAtMs: nowMs,
    normalizedData: { macroDirectionValue: 1 },
  },
];
const memberSevenBase = {
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  requireMemberSourceQuorum: true,
  nowMs,
};
const memberSevenFourSources = evaluateEightMemberCouncil({
  ...memberSevenBase,
  memberSourceChecks: { 7: memberSevenSourceChecks },
}).members[6];
const memberSevenTwoSources = evaluateEightMemberCouncil({
  ...memberSevenBase,
  memberSourceChecks: {
    7: memberSevenSourceChecks.map((check, index) => index < 2
      ? check
      : { ...check, status: 'BROKEN', dataValid: false }),
  },
}).members[6];
assert.equal(memberSevenFourSources.vote, 'LONG');
assert.equal(memberSevenFourSources.healthySourceCount, 4);
assert.ok((memberSevenFourSources.confidencePct ?? 100) <= 40);
const memberSevenOneSource = evaluateEightMemberCouncil({
  ...memberSevenBase,
  memberSourceChecks: {
    7: memberSevenSourceChecks.map((check, index) => index !== 0
      ? { ...check, status: 'BROKEN', dataValid: false }
      : check),
  },
}).members[6];
assert.equal(memberSevenTwoSources.vote, 'NEUTRAL',
  'two dated member-7 macro sources must produce a source-driven vote');
assert.equal(memberSevenTwoSources.healthySourceCount, 2);
assert.equal(memberSevenOneSource.vote, 'ABSTAIN',
  'one dated member-7 macro source must abstain');
assert.equal(memberSevenOneSource.healthySourceCount, 1);
assert.ok((memberSevenTwoSources.confidencePct ?? 100) <= 40,
  'member 7 macro heuristic confidence is capped at 40 percent');

const memberSixDirectionalChecks: CouncilMemberSourceCheck[] = [
  {
    sourceId: 'onchain.ethereum-public-rpc',
    status: 'HEALTHY',
    detail: 'Fresh Ethereum mainnet block from PublicNode.',
    dataValid: true,
    normalizedData: {
      blockHeight: 20_000_000,
      observationTimestampMs: nowMs - 60_000,
    },
  },
  {
    sourceId: 'onchain.ethereum-flashbots',
    status: 'HEALTHY',
    detail: 'Fresh Ethereum mainnet block from 1RPC.',
    dataValid: true,
    normalizedData: {
      blockHeight: 20_000_000,
      observationTimestampMs: nowMs - 30_000,
    },
  },
  {
    sourceId: 'onchain.ethereum-routescan',
    status: 'HEALTHY',
    detail: 'Fresh Ethereum latest-block observation from Routescan.',
    dataValid: true,
    normalizedData: {
      blockHeight: 20_000_000,
      observationTimestampMs: nowMs - 45_000,
    },
  },
  {
    sourceId: 'onchain.ethereum-blockscout',
    status: 'BROKEN',
    detail: 'Blockscout Ethereum endpoint is unavailable.',
    dataValid: false,
    voteValue: 'LOW_VALUE',
    normalizedData: {},
  },
  {
    sourceId: 'onchain.ethereum-blockchair',
    status: 'BROKEN',
    detail: 'Blockchair Ethereum endpoint is unavailable.',
    dataValid: false,
    voteValue: 'LOW_VALUE',
    normalizedData: {},
  },
  {
    sourceId: 'onchain.ethereum-drpc',
    status: 'HEALTHY',
    detail: 'Fresh Ethereum mainnet block from PublicNode alias.',
    dataValid: true,
    voteValue: 'LOW_VALUE',
    normalizedData: {
      ethereumDexVolume24hUsd: 1_250_000_000,
      ethereumDexVolumeChange1dPct: -9.6,
      ethereumDexVolumeChange7dPct: -5.1,
      observationTimestampMs: nowMs - 60_000,
    },
  },
];
const memberSixFourSourceVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 6: memberSixDirectionalChecks },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[5];
const memberSixTwoSourceVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: {
    6: memberSixDirectionalChecks.map((check, index) => index < 2
      ? check
      : { ...check, status: 'BROKEN', dataValid: false, normalizedData: {} }),
  },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[5];
const memberSixOneSourceVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: {
    6: memberSixDirectionalChecks.map((check, index) => index === 0
      ? check
      : { ...check, status: 'BROKEN', dataValid: false, normalizedData: {} }),
  },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[5];
const memberSixConflictingVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: {
    6: memberSixDirectionalChecks.map((check) => check.sourceId === 'onchain.ethereum-drpc'
      ? { ...check, normalizedData: { stablecoinSupplyChange7dPct: -0.8 } }
      : check),
  },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[5];
assert.equal(memberSixFourSourceVote.vote, 'ABSTAIN',
  'healthy on-chain context without explicit CEX-watchlist attribution must not create direction');
assert.equal(memberSixFourSourceVote.healthySourceCount, 4);
assert.equal(memberSixTwoSourceVote.vote, 'ABSTAIN',
  'stablecoin and staking heuristics without CEX-watchlist attribution must abstain');
assert.equal(memberSixTwoSourceVote.healthySourceCount, 2,
  'healthy source count remains independent from the Member 6 directional-vote quorum');
assert.match(memberSixTwoSourceVote.rationaleFa, /pair-scoped|دارایی|آن‌چین/,
  'source health checks alone cannot replace the pair-scoped flow signal');
assert.equal(memberSixOneSourceVote.vote, 'ABSTAIN',
  'one valid member-6 directional metric is insufficient');
assert.equal(memberSixConflictingVote.vote, 'ABSTAIN',
  'conflicting context-only on-chain data must abstain');

const memberEightNoFreshEthNewsChecks: CouncilMemberSourceCheck[] = [
  'decrypt',
  'the-block',
  'coindesk',
  'google-news',
].map((provider) => ({
  sourceId: `council.member8.${provider}`,
  status: 'HEALTHY',
  detail: 'RSS parsed with no recent ETH-specific matches.',
  httpHealthy: true,
  dataValid: true,
  normalizedData: {
    ethRelevantItemCount24h: 0,
    freshEthItemCount: 0,
    rssEthItemsJson: '[]',
  },
}));
const memberEightFilteredVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 8: memberEightNoFreshEthNewsChecks },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[7];
assert.equal(memberEightFilteredVote.vote, 'ABSTAIN');
assert.match(memberEightFilteredVote.rationaleFa, /کمبود خبر/);
assert.equal(memberEightFilteredVote.sourceId, 'council.member8.decrypt');

const makeMemberEightNews = (
  sourceId: string,
  publisher: string,
  title: string,
): CouncilMemberSourceCheck => ({
  sourceId,
  status: 'HEALTHY',
  detail: 'Live RSS fixture with one recent ETH item.',
  dataValid: true,
  observedAtMs: nowMs,
  normalizedData: {
    ethRelevantItemCount24h: 1,
    freshEthItemCount: 1,
    rssEthItemsJson: JSON.stringify([{
      title,
      description: '',
      categories: [],
      publisher,
      publishedAt: new Date(nowMs - 30 * 60_000).toISOString(),
      publishedAtMs: nowMs - 30 * 60_000,
    }]),
  },
});
const memberEightLiveChecks = [
  makeMemberEightNews('council.member8.decrypt', 'Decrypt', 'Ethereum adoption gains momentum'),
  makeMemberEightNews('council.member8.the-block', 'The Block', 'Ether rally draws strong inflows'),
  makeMemberEightNews('council.member8.coindesk', 'CoinDesk', 'Ethereum upgrade improves network growth'),
  makeMemberEightNews('council.member8.google-news', 'Crypto News', 'Ether bullish trend gains'),
];
const memberEightFourSources = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 8: memberEightLiveChecks },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[7];
const memberEightTwoSources = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 8: memberEightLiveChecks.slice(0, 2) },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[7];
const memberEightOneSource = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  memberSourceChecks: { 8: memberEightLiveChecks.slice(0, 1) },
  requireMemberSourceQuorum: true,
  nowMs,
}).members[7];
assert.equal(memberEightFourSources.vote, 'LONG');
assert.equal(memberEightFourSources.healthySourceCount, 4);
assert.ok((memberEightFourSources.confidencePct ?? 100) <= 40);
assert.equal(memberEightTwoSources.vote, 'LONG',
  'two publishers with fresh ETH news and lexicon scores produce a low-confidence vote');
assert.equal(memberEightTwoSources.healthySourceCount, 2);
assert.equal(memberEightOneSource.vote, 'ABSTAIN',
  'one publisher does not meet the member-8 coverage requirement');

const noHealthChecksVote = evaluateEightMemberCouncil(validMemberFiveVote).members[4];
assert.equal(noHealthChecksVote.vote, 'SHORT',
  'missing health observations alone must not turn an otherwise valid vote into abstention');
assert.equal(noHealthChecksVote.healthySourceCount, null);

const incompleteEthWhaleSignals = [
  {
    sourceId: 'whale.hyperliquid-accounts',
    status: 'LIVE' as const,
    direction: 'LONG' as const,
    confidencePct: 50,
    weightPct: 20,
    coverage: 'configured accounts only',
    coverageComplete: false,
    observedAtMs: nowMs - 1_000,
    interpretationFa: 'پوشش ناقص؛ وزن پایین.',
    evidence: { positions: 1 },
  },
  {
    sourceId: 'whale.deribit-block-trades',
    status: 'LIVE' as const,
    direction: 'LONG' as const,
    confidencePct: 50,
    weightPct: 20,
    coverage: 'recent block trades only',
    coverageComplete: false,
    observedAtMs: nowMs - 1_000,
    interpretationFa: 'پوشش ناقص؛ وزن پایین.',
    evidence: { blockTradeCount: 2 },
  },
];
const weightedEthWhaleVote = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  whaleFlowData: {
    pair: 'ETH/USDT:USDT',
    asset: 'ETH',
    status: 'UNAVAILABLE',
    provider: 'verification-only',
    timestampMs: null,
    ageMs: null,
    qualityPct: 0,
    coverageStatus: 'UNAVAILABLE',
    ethereumWhaleSignals: incompleteEthWhaleSignals,
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 0,
    windowStartHeight: null,
    windowEndHeight: null,
  },
  nowMs,
}).members[5];
assert.equal(weightedEthWhaleVote.vote, 'ABSTAIN',
  'derivatives signals without explicit CEX-watchlist matching must not vote directionally');
const matchedButUnvalidatedEthSignals = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  analysis,
  macroContext,
  whaleFlowData: {
    pair: 'ETH/USDT:USDT',
    asset: 'ETH',
    status: 'LIVE',
    provider: 'verification-only',
    timestampMs: nowMs - 1_000,
    retrievedAtMs: nowMs,
    ageMs: 1_000,
    qualityPct: 90,
    independentProviderCount: 2,
    independentSourceIds: ['eth-provider-a', 'eth-provider-b'],
    coverageStatus: 'SAMPLED',
    largeTransfers: [],
    ethereumWhaleSignals: incompleteEthWhaleSignals.map((signal) => ({
      ...signal,
      cexWatchlistMatched: true,
      confidencePct: 90,
      weightPct: 90,
    })),
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 0,
    windowStartHeight: null,
    windowEndHeight: null,
  },
  nowMs,
}).members[5];
assert.equal(matchedButUnvalidatedEthSignals.vote, 'ABSTAIN',
  'CEX-tagged ETH metrics cannot bypass labeled native flow and the 24-hour spike baseline');

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

const configuredMacroBetas = process.env.SBK1_MACRO_BETA_BY_PAIR;
delete process.env.SBK1_MACRO_BETA_BY_PAIR;
assert.deepEqual(
  [
    getCouncilMacroBeta('BTC/USDT:USDT'),
    getCouncilMacroBeta('ETH/USDT:USDT'),
    getCouncilMacroBeta('SOL/USDT:USDT'),
    getCouncilMacroBeta('XRP/USDT:USDT'),
    getCouncilMacroBeta('BNB/USDT:USDT'),
  ],
  [1, 1.05, 1.3, 1.2, 1.15],
);
process.env.SBK1_MACRO_BETA_BY_PAIR =
  'BTC/USDT:USDT=1.00,ETH/USDT:USDT=1.05,SOL/USDT:USDT=1.30,XRP/USDT:USDT=1.20,BNB/USDT:USDT=1.15';
assert.equal(getCouncilMacroBeta('SOL/USDT:USDT'), 1.3);
if (configuredMacroBetas === undefined) delete process.env.SBK1_MACRO_BETA_BY_PAIR;
else process.env.SBK1_MACRO_BETA_BY_PAIR = configuredMacroBetas;

const previousMacroBetas = process.env.SBK1_MACRO_BETA_BY_PAIR;
process.env.SBK1_MACRO_BETA_BY_PAIR = JSON.stringify({
  'BTC/USDT:USDT': 2,
  'ETH/USDT:USDT': 0.5,
});
const betaMacroData = {
  sp500: directMetricFixture('beta-provider', 'SP500', 0.2),
  dxy: directMetricFixture('beta-provider', 'DXY', -0.2),
  broadDollar: unavailableMetricFixture('broad-dollar'),
  fedEffectiveRate: unavailableMetricFixture('EFFR'),
  fedTargetUpperBound: unavailableMetricFixture('FEDFUNDS'),
  bitcoinActiveAddresses: unavailableMetricFixture('AdrActCnt'),
};
const highBetaMacroVote = evaluateEightMemberCouncil({
  analysis,
  macroContext,
  directMacroData: betaMacroData,
  pair: 'BTC/USDT:USDT',
  nowMs,
}).members[6];
const lowBetaMacroVote = evaluateEightMemberCouncil({
  analysis,
  macroContext,
  directMacroData: betaMacroData,
  pair: 'ETH/USDT:USDT',
  nowMs,
}).members[6];
assert.equal(highBetaMacroVote.vote, 'LONG');
assert.equal(lowBetaMacroVote.vote, 'NEUTRAL',
  'macro sensitivity is applied using the target pair beta, not one shared vote');
if (previousMacroBetas === undefined) delete process.env.SBK1_MACRO_BETA_BY_PAIR;
else process.env.SBK1_MACRO_BETA_BY_PAIR = previousMacroBetas;

const ethNewsContext: CouncilMacroContext = {
  ...macroContext,
  newsSentimentStatus: 'LIVE',
  newsSentimentScore: 25,
  newsHeadlinesStatus: 'LIVE',
  recentHeadlines: ['Publisher A', 'Publisher B', 'Publisher C'].map((source, index) => ({
    id: `eth-news-${index}`,
    pair: 'ETH/USDT:USDT',
    headline: `Ethereum ${index} network update`,
    source,
    url: `https://example.invalid/eth-news-${index}`,
    publishedAt: new Date(nowMs - 1_000).toISOString(),
  })),
};
assert.equal(evaluateEightMemberCouncil({
  analysis,
  macroContext: ethNewsContext,
  pair: 'ETH/USDT:USDT',
  nowMs,
}).members[7].vote, 'LONG');
assert.equal(evaluateEightMemberCouncil({
  analysis,
  macroContext: ethNewsContext,
  pair: 'BTC/USDT:USDT',
  nowMs,
}).members[7].vote, 'ABSTAIN',
  'ETH news cannot be reused in the BTC room');

const mismatchedOptions = evaluateEightMemberCouncil({
  analysis,
  macroContext,
  pair: 'ETH/USDT:USDT',
  optionsData: {
    pair: 'BTC/USDT:USDT',
    asset: 'BTC',
    status: 'LIVE',
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 95,
    impliedVolatilityPct: 40,
    putCallRatio: 0.7,
    expiryTimestampMs: nowMs + 10 * 24 * 60 * 60_000,
    strikePrice: 3_000,
    skewPct: 2,
    contractsCount: 24,
    provider: 'fixture',
  },
  nowMs,
});
assert.equal(mismatchedOptions.members[4].vote, 'ABSTAIN');
const mismatchedChain = evaluateEightMemberCouncil({
  analysis,
  macroContext,
  pair: 'ETH/USDT:USDT',
  whaleFlowData: {
    pair: 'ETH/USDT:USDT',
    asset: 'ETH',
    status: 'LIVE',
    provider: 'fixture',
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 90,
    coverageStatus: 'SAMPLED',
    largeTransfers: [{
      transactionHash: 'a'.repeat(64),
      blockchain: 'bitcoin',
      blockHeight: 1,
      timestampMs: nowMs - 1_000,
      sourceProvider: 'fixture',
      asset: 'BTC',
      amount: 12,
      estimatedUsd: 720_000,
      confirmationStatus: 'CONFIRMED',
      transferId: 'vout:0',
    }],
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 1,
    windowStartHeight: 1,
    windowEndHeight: 1,
  },
  nowMs,
});
assert.equal(mismatchedChain.members[5].vote, 'ABSTAIN',
  'Bitcoin transfers cannot be counted in the Ethereum room even if mislabeled at the payload level');

const pairRoomMatrix = [
  'BTC/USDT:USDT',
  'ETH/USDT:USDT',
  'SOL/USDT:USDT',
  'XRP/USDT:USDT',
  'BNB/USDT:USDT',
] as const;
const previousMatrixBetas = process.env.SBK1_MACRO_BETA_BY_PAIR;
process.env.SBK1_MACRO_BETA_BY_PAIR = '{}';
for (const pair of pairRoomMatrix) {
  const foreignOptionsData = pair === 'BTC/USDT:USDT' ? undefined : {
    pair: 'BTC/USDT:USDT',
    asset: 'BTC',
    status: 'LIVE' as const,
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 95,
    impliedVolatilityPct: 40,
    putCallRatio: 0.7,
    expiryTimestampMs: nowMs + 10 * 24 * 60 * 60_000,
    strikePrice: 60_000,
    skewPct: 2,
    contractsCount: 24,
    provider: 'matrix-fixture',
  };
  const foreignWhaleFlowData = pair === 'BTC/USDT:USDT' ? undefined : {
    pair: 'BTC/USDT:USDT',
    asset: 'BTC',
    status: 'LIVE' as const,
    provider: 'matrix-fixture',
    timestampMs: nowMs - 1_000,
    ageMs: 1_000,
    qualityPct: 90,
    coverageStatus: 'SAMPLED' as const,
    largeTransfers: [],
    exchangeInflowsBtc: null,
    exchangeOutflowsBtc: null,
    netExchangeFlowBtc: null,
    transactionCount: 0,
    windowStartHeight: 1,
    windowEndHeight: 1,
  };
  const roomReport = evaluateEightMemberCouncil({
    analysis,
    macroContext,
    pair,
    optionsData: foreignOptionsData,
    whaleFlowData: foreignWhaleFlowData,
    nowMs,
  });
  for (const memberId of [5, 6, 7, 8]) {
    assert.equal(roomReport.members[memberId - 1].vote, 'ABSTAIN',
      `member ${memberId} must abstain in ${pair} when its own validated evidence is absent`);
  }
}
if (previousMatrixBetas === undefined) delete process.env.SBK1_MACRO_BETA_BY_PAIR;
else process.env.SBK1_MACRO_BETA_BY_PAIR = previousMatrixBetas;

console.log('Eight-member council verification passed.');
