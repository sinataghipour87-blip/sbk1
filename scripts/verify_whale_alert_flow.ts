import assert from 'node:assert/strict';
import {
  fetchWhaleAlertFlow,
  resetWhaleAlertFlowCacheForTests,
} from '../src/services/whaleAlertFlow';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';

const nowMs = Date.now();
const timestamp = Math.floor((nowMs - 60_000) / 1_000);
const calls: string[] = [];
const fetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  calls.push(url.toString());
  assert.equal(url.searchParams.get('api_key'), 'test-api-key');
  if (url.pathname === '/bitcoin/status') {
    return Response.json({ end_height: 900_000 });
  }
  assert.equal(url.searchParams.get('start_height'), String(900_000 - 12 + 1));
  assert.equal(url.searchParams.get('end_height'), '900000');
  assert.equal(url.searchParams.get('min_amount'), '10');
  return Response.json({
    transactions: [{
      timestamp,
      sub_transactions: [{
        symbol: 'BTC',
        transaction_type: 'transfer',
        inputs: [{ amount: '12', owner: 'unknown wallet', owner_type: 'unknown' }],
        outputs: [{ amount: '12', owner: 'Example Exchange', owner_type: 'exchange' }],
      }],
    }, {
      timestamp,
      sub_transactions: [{
        symbol: 'BTC',
        transaction_type: 'transfer',
        inputs: [{ amount: '15', owner: 'Example Exchange', owner_type: 'exchange' }],
        outputs: [{ amount: '15', owner: 'unknown wallet', owner_type: 'unknown' }],
      }],
    }],
  });
};

resetWhaleAlertFlowCacheForTests();
const flow = await fetchWhaleAlertFlow({ apiKey: 'test-api-key', nowMs, fetcher });
assert.equal(calls.length, 2);
assert.equal(flow.status, 'LIVE');
assert.equal(flow.exchangeInflowsBtc, 12);
assert.equal(flow.exchangeOutflowsBtc, 15);
assert.equal(flow.netExchangeFlowBtc, -3);
assert.equal(flow.transactionCount, 2);
assert.equal(flow.qualityPct, 100);
assert.equal(JSON.stringify(flow).includes('test-api-key'), false);

const report = evaluateEightMemberCouncil({
  whaleFlowData: flow,
  nowMs,
});
assert.equal(report.members[5].vote, 'NEUTRAL');
assert.match(report.members[5].rationaleFa, /رأی جهت‌دار صادر نمی‌شود/);

resetWhaleAlertFlowCacheForTests();
let fetchedWithoutKey = false;
const missingKey = await fetchWhaleAlertFlow({
  apiKey: '',
  nowMs,
  fetcher: async () => {
    fetchedWithoutKey = true;
    throw new Error('must not make unauthenticated request');
  },
});
assert.equal(fetchedWithoutKey, false);
assert.equal(missingKey.status, 'UNAVAILABLE');
assert.equal(missingKey.netExchangeFlowBtc, null);

resetWhaleAlertFlowCacheForTests();
const incomplete = await fetchWhaleAlertFlow({
  apiKey: 'test-api-key',
  nowMs,
  fetcher: async (input) => new URL(String(input)).pathname === '/bitcoin/status'
    ? Response.json({ end_height: 900_000 })
    : Response.json({
      transactions: [],
      next: 'https://leviathan.whale-alert.io/bitcoin/transactions?start_index=100',
    }),
});
assert.equal(incomplete.status, 'UNAVAILABLE');

console.log('Whale Alert source attribution, flow aggregation, credential gating, and council checks passed.');
