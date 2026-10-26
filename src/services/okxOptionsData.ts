import type { CouncilOptionsData } from './eightMemberCouncil';
import { deduplicateOptionContracts } from './councilEvidenceDeduplication';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import { isRecord, toPositiveNumber } from './onChainCexShared';

const OKX_API = 'https://www.okx.com/api/v5';
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 15_000;
const MAX_SOURCE_AGE_MS = 60_000;
const MIN_EXPIRY_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_EXPIRY_AGE_MS = 90 * 24 * 60 * 60_000;
const MIN_LIQUID_CONTRACTS = 20;

interface OkxInstrument {
  instId: string;
  instType: 'OPTION';
  uly: string;
  instFamily: string;
  ctVal: string;
  ctMult: string;
  ctValCcy: string;
  settleCcy: string;
  optType: 'C' | 'P';
  stk: string;
  expTime: string;
  state: string;
}

interface OkxOptionSummary {
  instId: string;
  markVol: string;
  fwdPx: string;
  ts: string;
}

interface OkxOpenInterest {
  instId: string;
  oiCcy: string;
  ts: string;
}

interface OkxTicker {
  instId: string;
  bidPx: string;
  askPx: string;
  ts: string;
}

interface ParsedContract {
  instrumentName: string;
  expiryTimestampMs: number;
  strikePrice: number;
  side: 'call' | 'put';
  openInterestBase: number;
  impliedVolatilityPct: number;
  underlyingPrice: number;
  timestampMs: number;
}

const cachedResults = new Map<string, { cachedAtMs: number; result: CouncilOptionsData }>();

function unavailable(pair: string, reason?: string): CouncilOptionsData {
  return {
    pair,
    asset: getFreqtradePairBaseAsset(pair) ?? undefined,
    status: 'UNAVAILABLE',
    timestampMs: null,
    retrievedAtMs: null,
    ageMs: null,
    qualityPct: 0,
    impliedVolatilityPct: null,
    putCallRatio: null,
    expiryTimestampMs: null,
    strikePrice: null,
    skewPct: null,
    provider: 'OKX V5 public options API',
    contractsCount: 0,
    callOpenInterest: null,
    putOpenInterest: null,
    underlyingPrice: null,
    ...(reason ? { unavailableReason: reason } : {}),
  };
}

function positiveNumber(value: unknown): number | null {
  return toPositiveNumber(value);
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{13}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isOkxEnvelope(value: unknown): value is { code: string; data: unknown[] } {
  return isRecord(value) && value.code === '0' && Array.isArray(value.data);
}

function isInstrument(value: unknown, asset: string): value is OkxInstrument {
  return isRecord(value) &&
    typeof value.instId === 'string' &&
    value.instType === 'OPTION' &&
    value.uly === `${asset}-USDT` &&
    value.instFamily === `${asset}-USDT` &&
    typeof value.ctVal === 'string' &&
    typeof value.ctMult === 'string' &&
    typeof value.ctValCcy === 'string' &&
    typeof value.settleCcy === 'string' &&
    (value.optType === 'C' || value.optType === 'P') &&
    typeof value.stk === 'string' &&
    typeof value.expTime === 'string' &&
    value.state === 'live';
}

async function request(
  fetcher: typeof fetch,
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${OKX_API}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`OKX V5 returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOkxOptionsData(options: {
  pair: string;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<CouncilOptionsData> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (!asset || !['SOL', 'XRP', 'BNB'].includes(asset)) return unavailable(options.pair);

  const nowMs = options.nowMs ?? Date.now();
  const cached = cachedResults.get(options.pair);
  if (cached && nowMs >= cached.cachedAtMs && nowMs - cached.cachedAtMs <= CACHE_TTL_MS) {
    return {
      ...cached.result,
      ageMs: cached.result.timestampMs === null ? null : nowMs - cached.result.timestampMs,
    };
  }

  const fetcher = options.fetcher ?? fetch;
  try {
    const envelope = await request(fetcher, 'public/instruments', {
      instType: 'OPTION',
      uly: `${asset}-USDT`,
    });
    if (!isOkxEnvelope(envelope)) throw new Error('OKX V5 instruments response is malformed.');
    const instruments = envelope.data.filter((item): item is OkxInstrument =>
      isInstrument(item, asset)
    );
    const eligibleInstruments = instruments.filter((instrument) => {
      const expiryMs = Number(instrument.expTime);
      const strike = positiveNumber(instrument.stk);
      const contractValue = positiveNumber(instrument.ctVal);
      const multiplier = positiveNumber(instrument.ctMult);
      return Number.isSafeInteger(expiryMs) &&
        expiryMs - nowMs >= MIN_EXPIRY_AGE_MS &&
        expiryMs - nowMs <= MAX_EXPIRY_AGE_MS &&
        strike !== null &&
        contractValue !== null &&
        multiplier !== null &&
        instrument.ctValCcy === asset &&
        instrument.settleCcy === asset;
    });
    if (eligibleInstruments.length === 0) {
      const result = unavailable(
        options.pair,
        `OKX has no active OPTION contracts with underlying ${asset}-USDT; BTC/USD or another quote market was not substituted.`,
      );
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
    }

    const [summaryEnvelope, interestEnvelope, tickerEnvelope] = await Promise.all([
      request(fetcher, 'public/opt-summary', { uly: `${asset}-USDT` }),
      request(fetcher, 'public/open-interest', { instType: 'OPTION', uly: `${asset}-USDT` }),
      request(fetcher, 'market/tickers', { instType: 'OPTION' }),
    ]);
    if (
      !isOkxEnvelope(summaryEnvelope) ||
      !isOkxEnvelope(interestEnvelope) ||
      !isOkxEnvelope(tickerEnvelope)
    ) {
      throw new Error('OKX V5 options summary, open-interest, or ticker response is malformed.');
    }

    const contractIds = new Set(eligibleInstruments.map(({ instId }) => instId));
    const summaries = new Map<string, OkxOptionSummary>();
    for (const item of summaryEnvelope.data) {
      if (!isRecord(item) || typeof item.instId !== 'string' || !contractIds.has(item.instId)) continue;
      if (typeof item.markVol !== 'string' || typeof item.fwdPx !== 'string' ||
          typeof item.ts !== 'string') continue;
      const previous = summaries.get(item.instId);
      if (previous && (previous.markVol !== item.markVol || previous.ts !== item.ts)) {
        throw new Error(`OKX returned conflicting option summaries for ${item.instId}.`);
      }
      summaries.set(item.instId, item as unknown as OkxOptionSummary);
    }
    const interests = new Map<string, OkxOpenInterest>();
    for (const item of interestEnvelope.data) {
      if (!isRecord(item) || typeof item.instId !== 'string' || !contractIds.has(item.instId)) continue;
      if (typeof item.oiCcy !== 'string' || typeof item.ts !== 'string') continue;
      const previous = interests.get(item.instId);
      if (previous && (previous.oiCcy !== item.oiCcy || previous.ts !== item.ts)) {
        throw new Error(`OKX returned conflicting open interest for ${item.instId}.`);
      }
      interests.set(item.instId, item as unknown as OkxOpenInterest);
    }
    const tickers = new Map<string, OkxTicker>();
    for (const item of tickerEnvelope.data) {
      if (!isRecord(item) || typeof item.instId !== 'string' || !contractIds.has(item.instId)) continue;
      if (typeof item.bidPx !== 'string' || typeof item.askPx !== 'string' || typeof item.ts !== 'string') continue;
      const previous = tickers.get(item.instId);
      if (previous && (previous.bidPx !== item.bidPx || previous.askPx !== item.askPx || previous.ts !== item.ts)) {
        throw new Error(`OKX returned conflicting option tickers for ${item.instId}.`);
      }
      tickers.set(item.instId, item as unknown as OkxTicker);
    }

    const retrievedAtMs = Date.now();
    const contracts = eligibleInstruments.flatMap((instrument): ParsedContract[] => {
      const summary = summaries.get(instrument.instId);
      const interest = interests.get(instrument.instId);
      const ticker = tickers.get(instrument.instId);
      const markVol = positiveNumber(summary?.markVol);
      const underlyingPrice = positiveNumber(summary?.fwdPx);
      const openInterestBase = positiveNumber(interest?.oiCcy);
      const bid = positiveNumber(ticker?.bidPx);
      const ask = positiveNumber(ticker?.askPx);
      const timestamps = [
        timestamp(summary?.ts),
        timestamp(interest?.ts),
        timestamp(ticker?.ts),
      ];
      if (
        markVol === null ||
        markVol > 5 ||
        underlyingPrice === null ||
        openInterestBase === null ||
        bid === null ||
        ask === null ||
        bid > ask ||
        timestamps.some((value) => value === null)
      ) return [];
      const sourceTimestampMs = Math.min(...timestamps as number[]);
      if (
        sourceTimestampMs > nowMs + 1_000 ||
        nowMs - sourceTimestampMs > MAX_SOURCE_AGE_MS
      ) return [];
      return [{
        instrumentName: instrument.instId,
        expiryTimestampMs: Number(instrument.expTime),
        strikePrice: Number(instrument.stk),
        side: instrument.optType === 'C' ? 'call' : 'put',
        openInterestBase,
        impliedVolatilityPct: markVol * 100,
        underlyingPrice,
        timestampMs: sourceTimestampMs,
      }];
    });
    const deduplication = deduplicateOptionContracts(contracts.map((contract) => ({
      venue: 'okx',
      instrumentName: contract.instrumentName,
      expiryTimestampMs: contract.expiryTimestampMs,
      strikePrice: contract.strikePrice,
      side: contract.side,
      contractData: contract,
      candidate: contract,
    })));
    if (deduplication.conflictingIdentity) {
      throw new Error('OKX returned conflicting duplicate option contracts.');
    }
    const valid = deduplication.values.map(({ candidate }) => candidate);
    const calls = valid.filter(({ side }) => side === 'call');
    const puts = valid.filter(({ side }) => side === 'put');
    const callOpenInterest = calls.reduce((sum, contract) => sum + contract.openInterestBase, 0);
    const putOpenInterest = puts.reduce((sum, contract) => sum + contract.openInterestBase, 0);
    if (
      valid.length < MIN_LIQUID_CONTRACTS ||
      calls.length === 0 ||
      puts.length === 0 ||
      callOpenInterest <= 0 ||
      putOpenInterest <= 0
    ) {
      const result = unavailable(
        options.pair,
        'OKX options did not provide at least 20 fresh, open-interest-positive, two-sided liquid contracts across calls and puts.',
      );
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
    }
    const weightedIv = (values: ParsedContract[]) => values.reduce(
      (sum, contract) => sum + contract.impliedVolatilityPct * contract.openInterestBase,
      0,
    ) / values.reduce((sum, contract) => sum + contract.openInterestBase, 0);
    const nearestAtm = [...valid].sort((left, right) =>
      Math.abs(left.strikePrice - left.underlyingPrice) / left.underlyingPrice -
      Math.abs(right.strikePrice - right.underlyingPrice) / right.underlyingPrice
    )[0];
    const sourceTimestampMs = Math.min(...valid.map(({ timestampMs }) => timestampMs));
    const ageMs = Math.max(0, retrievedAtMs - sourceTimestampMs);
    const result: CouncilOptionsData = {
      pair: options.pair,
      asset,
      status: ageMs <= MAX_SOURCE_AGE_MS ? 'LIVE' : 'STALE',
      timestampMs: sourceTimestampMs,
      retrievedAtMs,
      ageMs,
      qualityPct: Math.round(valid.length / Math.max(eligibleInstruments.length, 1) * 100),
      impliedVolatilityPct: Math.round(weightedIv(valid) * 100) / 100,
      putCallRatio: putOpenInterest / callOpenInterest,
      expiryTimestampMs: nearestAtm.expiryTimestampMs,
      strikePrice: nearestAtm.strikePrice,
      skewPct: Math.round((weightedIv(puts) - weightedIv(calls)) * 100) / 100,
      provider: 'OKX V5 public options API',
      contractsCount: valid.length,
      callOpenInterest,
      putOpenInterest,
      underlyingPrice: nearestAtm.underlyingPrice,
    };
    cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
    return { ...result };
  } catch (error) {
    console.error(
      '[OkxOptionsData] OKX options source unavailable:',
      error instanceof Error ? error.message : String(error),
    );
    return unavailable(
      options.pair,
      error instanceof Error ? error.message : 'OKX options source is unavailable.',
    );
  }
}

export function resetOkxOptionsDataCacheForTests(): void {
  cachedResults.clear();
}
