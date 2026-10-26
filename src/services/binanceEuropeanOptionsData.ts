import type { CouncilOptionsData } from './eightMemberCouncil';
import { deduplicateOptionContracts } from './councilEvidenceDeduplication';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import { isRecord, toPositiveNumber } from './onChainCexShared';

const API_ROOT = 'https://eapi.binance.com/eapi/v1';
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 15_000;
const MAX_SOURCE_AGE_MS = 60_000;
const MIN_EXPIRY_AGE_MS = 24 * 60 * 60_000;
const MAX_EXPIRY_AGE_MS = 90 * 24 * 60 * 60_000;
const MIN_LIQUID_CONTRACTS = 20;

interface BinanceOptionInstrument {
  symbol: string;
  underlying: string;
  quoteAsset: string;
  unit: number;
  expiryDate: number;
  side: 'CALL' | 'PUT';
  strikePrice: string;
  status: 'TRADING';
}

interface BinanceOptionMark {
  symbol: string;
  markPrice: string;
  markIV: string;
}

interface BinanceOptionOpenInterest {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestUsd: string;
  timestamp: number;
}

interface BinanceOptionIndex {
  indexPrice: string;
  time: number;
}

interface ParsedContract {
  instrumentName: string;
  expiryTimestampMs: number;
  strikePrice: number;
  side: 'call' | 'put';
  openInterestUsd: number;
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
    provider: 'Binance European Options public API',
    contractsCount: 0,
    callOpenInterest: null,
    putOpenInterest: null,
    underlyingPrice: null,
    ...(reason ? { unavailableReason: reason } : {}),
  };
}

function parseTimestamp(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{13}$/.test(value)
      ? Number(value)
      : null;
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isInstrument(value: unknown, asset: string): value is BinanceOptionInstrument {
  return isRecord(value) &&
    typeof value.symbol === 'string' &&
    new RegExp(`^${asset}-\\d{6}-\\d+(?:\\.\\d+)?-[CP]$`).test(value.symbol) &&
    value.underlying === `${asset}USDT` &&
    value.quoteAsset === 'USDT' &&
    toPositiveNumber(value.unit) !== null &&
    parseTimestamp(value.expiryDate) !== null &&
    (value.side === 'CALL' || value.side === 'PUT') &&
    toPositiveNumber(value.strikePrice) !== null &&
    value.status === 'TRADING';
}

function isEnvelopeArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

async function request(
  fetcher: typeof fetch,
  path: string,
  params: Record<string, string> = {},
): Promise<{ payload: unknown; receivedAtMs: number }> {
  const url = new URL(`${API_ROOT}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Binance European Options API returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    return { payload, receivedAtMs: Date.now() };
  } finally {
    clearTimeout(timeout);
  }
}

function expiryParam(expiryTimestampMs: number): string {
  const date = new Date(expiryTimestampMs);
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export async function fetchBinanceEuropeanOptionsData(options: {
  pair: string;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<CouncilOptionsData> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (!asset || !['BTC', 'ETH', 'SOL', 'XRP', 'BNB'].includes(asset)) return unavailable(options.pair);

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
    const { payload: exchangeInfo } = await request(fetcher, 'exchangeInfo');
    if (!isRecord(exchangeInfo) || !Array.isArray(exchangeInfo.optionSymbols)) {
      throw new Error('Binance European Options exchangeInfo response is malformed.');
    }
    const instruments = exchangeInfo.optionSymbols.filter((item): item is BinanceOptionInstrument =>
      isInstrument(item, asset)
    );
    const eligible = instruments.filter((instrument) => {
      const remainingMs = instrument.expiryDate - nowMs;
      return remainingMs >= MIN_EXPIRY_AGE_MS && remainingMs <= MAX_EXPIRY_AGE_MS;
    });
    if (eligible.length === 0) {
      const result = unavailable(
        options.pair,
        `Binance has no active European OPTION contracts for ${asset}USDT in the accepted expiry window.`,
      );
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
    }

    const expiryDates = [...new Set(eligible.map(({ expiryDate }) => expiryDate))];
    const [markResponse, indexResponse, ...openInterestResponses] = await Promise.all([
      request(fetcher, 'mark'),
      request(fetcher, 'index', { underlying: `${asset}USDT` }),
      ...expiryDates.map((expiryDate) =>
        request(fetcher, 'openInterest', {
          underlyingAsset: asset,
          expiration: expiryParam(expiryDate),
        })
      ),
    ]);
    if (!isEnvelopeArray(markResponse.payload) ||
        !isRecord(indexResponse.payload) ||
        openInterestResponses.some(({ payload }) => !isEnvelopeArray(payload))) {
      throw new Error('Binance European Options index, mark or openInterest response is malformed.');
    }
    const indexPrice = toPositiveNumber(indexResponse.payload.indexPrice);
    const indexTimestampMs = parseTimestamp(indexResponse.payload.time);
    if (
      indexPrice === null ||
      indexTimestampMs === null ||
      indexTimestampMs > indexResponse.receivedAtMs + 1_000 ||
      indexResponse.receivedAtMs - indexTimestampMs > MAX_SOURCE_AGE_MS
    ) {
      throw new Error('Binance European Options underlying index is missing, stale, or future-dated.');
    }

    const contractNames = new Set(eligible.map(({ symbol }) => symbol));
    const marks = new Map<string, BinanceOptionMark>();
    for (const candidate of markResponse.payload) {
      if (!isRecord(candidate) || typeof candidate.symbol !== 'string' ||
          !contractNames.has(candidate.symbol)) continue;
      if (typeof candidate.markPrice !== 'string' || typeof candidate.markIV !== 'string') continue;
      const previous = marks.get(candidate.symbol);
      if (previous && (previous.markPrice !== candidate.markPrice || previous.markIV !== candidate.markIV)) {
        throw new Error(`Binance returned conflicting mark data for ${candidate.symbol}.`);
      }
      marks.set(candidate.symbol, candidate as unknown as BinanceOptionMark);
    }

    const interests = new Map<string, BinanceOptionOpenInterest>();
    for (const { payload } of openInterestResponses) {
      for (const candidate of payload as unknown[]) {
        if (!isRecord(candidate) || typeof candidate.symbol !== 'string' ||
            !contractNames.has(candidate.symbol)) continue;
        if (
          typeof candidate.sumOpenInterest !== 'string' ||
          typeof candidate.sumOpenInterestUsd !== 'string' ||
          parseTimestamp(candidate.timestamp) === null
        ) continue;
        const previous = interests.get(candidate.symbol);
        if (previous && (
          previous.sumOpenInterest !== candidate.sumOpenInterest ||
          previous.sumOpenInterestUsd !== candidate.sumOpenInterestUsd ||
          previous.timestamp !== candidate.timestamp
        )) {
          throw new Error(`Binance returned conflicting open-interest data for ${candidate.symbol}.`);
        }
        interests.set(candidate.symbol, candidate as unknown as BinanceOptionOpenInterest);
      }
    }

    const retrievedAtMs = Math.max(
      markResponse.receivedAtMs,
      indexResponse.receivedAtMs,
      ...openInterestResponses.map(({ receivedAtMs }) => receivedAtMs),
    );
    const parsed = eligible.flatMap((instrument): ParsedContract[] => {
      const mark = marks.get(instrument.symbol);
      const interest = interests.get(instrument.symbol);
      const markPrice = toPositiveNumber(mark?.markPrice);
      const markIv = toPositiveNumber(mark?.markIV);
      const openInterestUsd = toPositiveNumber(interest?.sumOpenInterestUsd);
      const openInterestTimestampMs = parseTimestamp(interest?.timestamp);
      if (
        markPrice === null ||
        markIv === null ||
        markIv > 5 ||
        openInterestUsd === null ||
        openInterestTimestampMs === null ||
        openInterestTimestampMs > retrievedAtMs + 1_000 ||
        retrievedAtMs - openInterestTimestampMs > MAX_SOURCE_AGE_MS
      ) return [];
      const sourceTimestampMs = Math.min(openInterestTimestampMs, indexTimestampMs);
      return [{
        instrumentName: instrument.symbol,
        expiryTimestampMs: instrument.expiryDate,
        strikePrice: Number(instrument.strikePrice),
        side: instrument.side === 'CALL' ? 'call' : 'put',
        openInterestUsd,
        impliedVolatilityPct: markIv * 100,
        underlyingPrice: indexPrice,
        timestampMs: sourceTimestampMs,
      }];
    });
    const deduplicated = deduplicateOptionContracts(parsed.map((contract) => ({
      venue: 'binance-european-options',
      instrumentName: contract.instrumentName,
      expiryTimestampMs: contract.expiryTimestampMs,
      strikePrice: contract.strikePrice,
      side: contract.side,
      contractData: contract,
      candidate: contract,
    })));
    if (deduplicated.conflictingIdentity) {
      throw new Error('Binance returned conflicting duplicate European option contracts.');
    }

    const contracts = deduplicated.values.map(({ candidate }) => candidate);
    const calls = contracts.filter(({ side }) => side === 'call');
    const puts = contracts.filter(({ side }) => side === 'put');
    const callOpenInterest = calls.reduce((sum, contract) => sum + contract.openInterestUsd, 0);
    const putOpenInterest = puts.reduce((sum, contract) => sum + contract.openInterestUsd, 0);
    if (
      contracts.length < MIN_LIQUID_CONTRACTS ||
      calls.length === 0 ||
      puts.length === 0 ||
      callOpenInterest <= 0 ||
      putOpenInterest <= 0
    ) {
      const result = unavailable(
        options.pair,
        'Binance European Options did not provide at least 20 fresh, open-interest-positive contracts across calls and puts.',
      );
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
    }

    const weightedIv = (values: ParsedContract[]) => values.reduce(
      (sum, contract) => sum + contract.impliedVolatilityPct * contract.openInterestUsd,
      0,
    ) / values.reduce((sum, contract) => sum + contract.openInterestUsd, 0);
    const nearestAtm = [...contracts].sort((left, right) =>
      Math.abs(left.strikePrice - left.underlyingPrice) / left.underlyingPrice -
      Math.abs(right.strikePrice - right.underlyingPrice) / right.underlyingPrice
    )[0];
    const sourceTimestampMs = Math.min(...contracts.map(({ timestampMs }) => timestampMs));
    const ageMs = retrievedAtMs - sourceTimestampMs;
    const result: CouncilOptionsData = {
      pair: options.pair,
      asset,
      status: ageMs <= MAX_SOURCE_AGE_MS ? 'LIVE' : 'STALE',
      timestampMs: sourceTimestampMs,
      retrievedAtMs,
      ageMs,
      qualityPct: Math.round(contracts.length / Math.max(eligible.length, 1) * 100),
      impliedVolatilityPct: Math.round(weightedIv(contracts) * 100) / 100,
      putCallRatio: putOpenInterest / callOpenInterest,
      expiryTimestampMs: nearestAtm.expiryTimestampMs,
      strikePrice: nearestAtm.strikePrice,
      skewPct: Math.round((weightedIv(puts) - weightedIv(calls)) * 100) / 100,
      provider: 'Binance European Options public API (timestamped index/OI; OI-weighted USD open interest)',
      contractsCount: contracts.length,
      callOpenInterest,
      putOpenInterest,
      underlyingPrice: nearestAtm.underlyingPrice,
    };
    cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Binance European Options source is unavailable.';
    console.error('[BinanceEuropeanOptionsData] Public options source unavailable:', reason);
    return unavailable(options.pair, reason);
  }
}

export function resetBinanceEuropeanOptionsDataCacheForTests(): void {
  cachedResults.clear();
}
