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
assert.equal(deduplicatedOnchainVote.members[5].vote, 'NEUTRAL');
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
