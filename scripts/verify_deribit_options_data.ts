import assert from 'node:assert/strict';
import {
  fetchDeribitOptionsData,
  resetDeribitOptionsDataCacheForTests,
} from '../src/services/deribitOptionsData';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';
import type { MarketFeedQuality, DataQualityReport } from '../src/types/trading';

const nowMs = Date.now();
const expiration = new Date(nowMs + 15 * 24 * 60 * 60_000);
const day = String(expiration.getUTCDate()).padStart(2, '0');
const month = expiration.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
const year = String(expiration.getUTCFullYear()).slice(-2);
const summaries = Array.from({ length: 24 }, (_, index) => {
  const type = index % 2 === 0 ? 'C' : 'P';
  const optionType = type === 'C' ? 'call' : 'put';
  const strike = 95_000 + Math.floor(index / 2) * 1_000;
  return {
    instrument_name: `BTC-${day}${month}${year}-${strike}-${type}`,
    open_interest: optionType === 'call' ? 10 : 20,
    mark_iv: optionType === 'call' ? 40 : 50,
    underlying_price: 100_000,
    creation_timestamp: nowMs - 30 * 24 * 60 * 60_000,
  };
});

resetDeribitOptionsDataCacheForTests();
const data = await fetchDeribitOptionsData({
  nowMs,
  fetcher: async (input) => {
    assert.equal(String(input), 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option');
    return Response.json({ jsonrpc: '2.0', result: summaries });
  },
});
assert.equal(data.status, 'LIVE');
assert.equal(data.provider, 'Deribit public options API');
assert.equal(data.contractsCount, 24);
assert.equal(data.putCallRatio, 2);
assert.equal(data.impliedVolatilityPct, 46.67);
assert.equal(data.skewPct, 10);
assert.equal(data.qualityPct, 100);
assert.ok(data.timestampMs !== null && data.timestampMs <= Date.now());
assert.ok(data.ageMs !== null && data.ageMs <= 1_000);

const freshFeed: MarketFeedQuality = {
  feedName: 'candles',
  source: 'fixture',
  status: 'LIVE',
  timestamp: nowMs - 1_000,
  ageMs: 1_000,
  maxAgeMs: 15_000,
  latencyMs: 10,
  score: 90,
  detailsFa: 'fixture',
};
const dataQualityReport: DataQualityReport = {
  overallScore: 90,
  isTradeAllowed: true,
  status: 'LIVE',
  reasonsFa: [],
  feeds: {
    candles: freshFeed,
    orderBook: freshFeed,
    derivatives: freshFeed,
    futuresPrices: freshFeed,
    sentiment: freshFeed,
    orderFlow: freshFeed,
  },
};
const council = evaluateEightMemberCouncil({
  optionsData: data,
  analysis: {
    price: 100_000,
    scoreLong: 0,
    scoreShort: 0,
    candles: [],
    dataQualityReport,
  },
  nowMs: Date.now(),
});
assert.equal(council.members[4].vote, 'SHORT');
assert.match(council.members[4].rationaleFa, /Deribit public options API/);

const lowQualityCouncil = evaluateEightMemberCouncil({
  optionsData: { ...data, qualityPct: 79 },
  analysis: {
    price: 100_000,
    scoreLong: 0,
    scoreShort: 0,
    candles: [],
    dataQualityReport,
  },
  nowMs,
});
assert.equal(lowQualityCouncil.members[4].vote, 'ABSTAIN');

resetDeribitOptionsDataCacheForTests();
const malformed = await fetchDeribitOptionsData({
  nowMs,
  fetcher: async () => Response.json({ result: 'not-an-array' }),
});
assert.equal(malformed.status, 'UNAVAILABLE');
assert.equal(malformed.putCallRatio, null);

console.log('Deribit options source validation, aggregation, freshness, and council vote checks passed.');
