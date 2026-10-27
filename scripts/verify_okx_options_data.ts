import assert from 'node:assert/strict';
import {
  fetchOkxOptionsData,
  resetOkxOptionsDataCacheForTests,
} from '../src/services/okxOptionsData';

const nowMs = Date.now();
const expiry = String(nowMs + 20 * 24 * 60 * 60_000);
const timestamp = String(nowMs);
const instruments = Array.from({ length: 20 }, (_, index) => {
  const optType = index % 2 === 0 ? 'C' : 'P';
  return {
    instId: `SOL-USDT-${expiry}-${1_000 + index}-${optType}`,
    instType: 'OPTION',
    uly: 'SOL-USDT',
    instFamily: 'SOL-USDT',
    ctVal: '1',
    ctMult: '1',
    ctValCcy: 'SOL',
    settleCcy: 'SOL',
    optType,
    stk: String(145 + index),
    expTime: expiry,
    state: 'live',
  };
});
const summaries = instruments.map((instrument, index) => ({
  instId: instrument.instId,
  markVol: index % 2 === 0 ? '0.5' : '0.6',
  fwdPx: '150',
  ts: timestamp,
}));
const interests = instruments.map((instrument, index) => ({
  instId: instrument.instId,
  oiCcy: index % 2 === 0 ? '10' : '20',
  ts: timestamp,
}));
const tickers = instruments.map((instrument) => ({
  instId: instrument.instId,
  bidPx: '0.01',
  askPx: '0.02',
  ts: timestamp,
}));

const requests: URL[] = [];
resetOkxOptionsDataCacheForTests();
const result = await fetchOkxOptionsData({
  pair: 'SOL/USDT:USDT',
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const path = url.pathname.split('/').at(-1);
    if (path === 'instruments') return Response.json({ code: '0', data: instruments, msg: '' });
    if (path === 'opt-summary') return Response.json({ code: '0', data: summaries, msg: '' });
    if (path === 'open-interest') return Response.json({ code: '0', data: interests, msg: '' });
    if (path === 'tickers') return Response.json({ code: '0', data: tickers, msg: '' });
    throw new Error(`Unexpected OKX route ${url.pathname}`);
  },
});
assert.equal(result.status, 'LIVE');
assert.equal(result.pair, 'SOL/USDT:USDT');
assert.equal(result.asset, 'SOL');
assert.equal(result.provider, 'OKX V5 public options API');
assert.equal(result.contractsCount, 20);
assert.equal(result.putCallRatio, 2);
assert.equal(result.impliedVolatilityPct, 56.67);
assert.equal(result.qualityPct, 100);
assert.ok(result.timestampMs !== null);
assert.ok(requests.every((url) => url.searchParams.get('uly') === 'SOL-USDT' ||
  url.pathname.endsWith('/tickers')));

resetOkxOptionsDataCacheForTests();
const ethInstruments = instruments.map((instrument) => ({
  ...instrument,
  instId: instrument.instId.replaceAll('SOL-USDT', 'ETH-USD'),
  uly: 'ETH-USD',
  instFamily: 'ETH-USD',
  ctValCcy: 'ETH',
  settleCcy: 'ETH',
}));
const ethRequests: URL[] = [];
const ethOptions = await fetchOkxOptionsData({
  pair: 'ETH/USDT:USDT',
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    ethRequests.push(url);
    const path = url.pathname.split('/').at(-1);
    if (path === 'instruments') return Response.json({ code: '0', data: ethInstruments, msg: '' });
    if (path === 'opt-summary') return Response.json({ code: '0', data: summaries.map((item) => ({
      ...item,
      instId: item.instId.replaceAll('SOL-USDT', 'ETH-USD'),
    })), msg: '' });
    if (path === 'open-interest') return Response.json({ code: '0', data: interests.map((item) => ({
      ...item,
      instId: item.instId.replaceAll('SOL-USDT', 'ETH-USD'),
    })), msg: '' });
    if (path === 'tickers') return Response.json({ code: '0', data: tickers.map((item) => ({
      ...item,
      instId: item.instId.replaceAll('SOL-USDT', 'ETH-USD'),
    })), msg: '' });
    throw new Error(`Unexpected OKX route ${url.pathname}`);
  },
});
assert.equal(ethOptions.status, 'LIVE');
assert.equal(ethOptions.asset, 'ETH');
assert.equal(ethOptions.contractsCount, 20);
assert.ok(ethRequests.every((url) => url.searchParams.get('uly') === 'ETH-USD' ||
  url.pathname.endsWith('/tickers')));

resetOkxOptionsDataCacheForTests();
let secondaryRequests = 0;
const noOptions = await fetchOkxOptionsData({
  pair: 'XRP/USDT:USDT',
  nowMs,
  fetcher: async () => {
    secondaryRequests += 1;
    return Response.json({ code: '0', data: [], msg: '' });
  },
});
assert.equal(noOptions.status, 'UNAVAILABLE');
assert.match(noOptions.unavailableReason ?? '', /no active OPTION contracts/i);
assert.equal(secondaryRequests, 1, 'do not query prices or OI when the requested underlying has no options');

resetOkxOptionsDataCacheForTests();
const mismatched = await fetchOkxOptionsData({
  pair: 'BTC/USDT:USDT',
  nowMs,
  fetcher: async () => {
    throw new Error('unsupported pairs must not make OKX calls');
  },
});
assert.equal(mismatched.status, 'UNAVAILABLE');

resetOkxOptionsDataCacheForTests();
const stale = await fetchOkxOptionsData({
  pair: 'BNB/USDT:USDT',
  nowMs,
  fetcher: async (input) => {
    const url = new URL(String(input));
    const path = url.pathname.split('/').at(-1);
    const expiredTimestamp = String(nowMs - 90_000);
    const assetInstruments = instruments.map((item) => ({
      ...item,
      instId: item.instId.replaceAll('SOL', 'BNB'),
      uly: 'BNB-USDT',
      instFamily: 'BNB-USDT',
      ctValCcy: 'BNB',
      settleCcy: 'BNB',
      expTime: expiry,
    }));
    if (path === 'instruments') return Response.json({ code: '0', data: assetInstruments, msg: '' });
    if (path === 'opt-summary') return Response.json({
      code: '0',
      data: assetInstruments.map(({ instId }, index) => ({
        instId, markVol: index % 2 ? '0.6' : '0.5', fwdPx: '600', ts: expiredTimestamp,
      })),
      msg: '',
    });
    if (path === 'open-interest') return Response.json({
      code: '0',
      data: assetInstruments.map(({ instId }) => ({ instId, oiCcy: '10', ts: expiredTimestamp })),
      msg: '',
    });
    return Response.json({
      code: '0',
      data: assetInstruments.map(({ instId }) => ({ instId, bidPx: '1', askPx: '2', ts: expiredTimestamp })),
      msg: '',
    });
  },
});
assert.equal(stale.status, 'UNAVAILABLE');
assert.equal(stale.timestampMs, null);

console.log('OKX options source validation, quote isolation, liquidity checks, and abstention checks passed.');
