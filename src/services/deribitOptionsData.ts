import type { CouncilOptionsData } from './eightMemberCouncil';
import { deduplicateOptionContracts } from './councilEvidenceDeduplication';

const DERIBIT_SUMMARY_ENDPOINT =
  'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option';
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 15_000;
const MAX_SOURCE_AGE_MS = 60_000;
const MIN_EXPIRY_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_EXPIRY_AGE_MS = 90 * 24 * 60 * 60_000;
const MIN_VALID_CONTRACTS = 20;
const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

interface DeribitOptionSummary {
  instrument_name: string;
  open_interest: number;
  mark_iv: number;
  underlying_price: number;
  creation_timestamp: number;
}

interface ParsedOption {
  optionType: 'call' | 'put';
  expiryTimestampMs: number;
  strikePrice: number;
  openInterest: number;
  impliedVolatilityPct: number;
  underlyingPrice: number;
}

let cachedAtMs = 0;
let cachedResult: CouncilOptionsData | null = null;

function unavailable(status: CouncilOptionsData['status'] = 'UNAVAILABLE'): CouncilOptionsData {
  return {
    status,
    timestampMs: null,
    retrievedAtMs: null,
    ageMs: null,
    qualityPct: 0,
    impliedVolatilityPct: null,
    putCallRatio: null,
    expiryTimestampMs: null,
    strikePrice: null,
    skewPct: null,
    provider: 'Deribit public options API',
    contractsCount: 0,
    callOpenInterest: null,
    putOpenInterest: null,
    underlyingPrice: null,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSummary(value: unknown): value is DeribitOptionSummary {
  if (typeof value !== 'object' || value === null) return false;
  const summary = value as Record<string, unknown>;
  return typeof summary.instrument_name === 'string' &&
    isFiniteNumber(summary.open_interest) &&
    isFiniteNumber(summary.mark_iv) &&
    isFiniteNumber(summary.underlying_price) &&
    isFiniteNumber(summary.creation_timestamp);
}

function parseOption(summary: DeribitOptionSummary, nowMs: number): ParsedOption | null {
  const match = /^BTC-(\d{2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-(C|P)$/.exec(summary.instrument_name);
  if (!match || summary.open_interest <= 0 || summary.mark_iv <= 0 ||
      summary.mark_iv > 500 || summary.underlying_price <= 0) return null;
  const [, dayText, monthText, yearText, strikeText, type] = match;
  const month = MONTHS[monthText];
  const day = Number(dayText);
  const year = 2000 + Number(yearText);
  if (month === undefined || day < 1 || day > 31) return null;
  const expiryTimestampMs = Date.UTC(year, month, day, 8);
  const expiryDate = new Date(expiryTimestampMs);
  if (
    expiryDate.getUTCFullYear() !== year ||
    expiryDate.getUTCMonth() !== month ||
    expiryDate.getUTCDate() !== day
  ) return null;
  const expiryAgeMs = expiryTimestampMs - nowMs;
  if (expiryAgeMs < MIN_EXPIRY_AGE_MS || expiryAgeMs > MAX_EXPIRY_AGE_MS) return null;
  return {
    optionType: type === 'C' ? 'call' : 'put',
    expiryTimestampMs,
    strikePrice: Number(strikeText),
    openInterest: summary.open_interest,
    impliedVolatilityPct: summary.mark_iv,
    underlyingPrice: summary.underlying_price,
  };
}

async function fetchJson(fetcher: typeof fetch): Promise<{ payload: unknown; retrievedAtMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(DERIBIT_SUMMARY_ENDPOINT, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Deribit options API returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    return { payload, retrievedAtMs: Date.now() };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchDeribitOptionsData(options: {
  nowMs?: number;
  fetcher?: typeof fetch;
} = {}): Promise<CouncilOptionsData> {
  const nowMs = options.nowMs ?? Date.now();
  if (cachedResult && nowMs >= cachedAtMs && nowMs - cachedAtMs <= CACHE_TTL_MS) {
    return {
      ...cachedResult,
      ageMs: cachedResult.timestampMs === null ? null : nowMs - cachedResult.timestampMs,
    };
  }
  try {
    const { payload, retrievedAtMs } = await fetchJson(options.fetcher ?? fetch);
    const evaluatedAtMs = Math.max(nowMs, retrievedAtMs);
    if (typeof payload !== 'object' || payload === null ||
        !('result' in payload) || !Array.isArray(payload.result)) {
      throw new Error('Deribit options response is malformed.');
    }
    const summariesByInstrument = new Map<string, DeribitOptionSummary>();
    for (const candidate of payload.result) {
      if (!isSummary(candidate)) continue;
      const previous = summariesByInstrument.get(candidate.instrument_name);
      if (previous && (
        previous.open_interest !== candidate.open_interest ||
        previous.mark_iv !== candidate.mark_iv ||
        previous.underlying_price !== candidate.underlying_price ||
        previous.creation_timestamp !== candidate.creation_timestamp
      )) {
        throw new Error(
          `Deribit returned conflicting duplicate summaries for ${candidate.instrument_name}.`,
        );
      }
      summariesByInstrument.set(candidate.instrument_name, candidate);
    }
    const summaries = [...summariesByInstrument.values()];
    const candidates = summaries.flatMap((summary) => {
      const parsed = parseOption(summary, evaluatedAtMs);
      return parsed && parsed.strikePrice >= parsed.underlyingPrice * 0.75 &&
        parsed.strikePrice <= parsed.underlyingPrice * 1.25
        ? [{
          ...parsed,
          instrumentName: summary.instrument_name,
          summary,
        }]
        : [];
    });
    const uniqueContracts = deduplicateOptionContracts(candidates.map((candidate) => ({
      venue: 'deribit',
      instrumentName: candidate.instrumentName,
      expiryTimestampMs: candidate.expiryTimestampMs,
      strikePrice: candidate.strikePrice,
      side: candidate.optionType,
      contractData: candidate,
      candidate,
    })));
    if (uniqueContracts.conflictingIdentity) {
      throw new Error('Deribit returned conflicting summaries for the same option contract identity.');
    }
    const eligible = uniqueContracts.values.map(({ candidate }) => candidate);
    const valid = retrievedAtMs <= nowMs + 1_000 &&
      nowMs - retrievedAtMs <= MAX_SOURCE_AGE_MS
      ? eligible
      : [];
    const calls = valid.filter(({ optionType }) => optionType === 'call');
    const puts = valid.filter(({ optionType }) => optionType === 'put');
    const callOpenInterest = calls.reduce((sum, option) => sum + option.openInterest, 0);
    const putOpenInterest = puts.reduce((sum, option) => sum + option.openInterest, 0);
    const totalOpenInterest = callOpenInterest + putOpenInterest;
    const timestampMs = valid.length > 0 ? retrievedAtMs : null;
    if (
      valid.length < MIN_VALID_CONTRACTS ||
      calls.length === 0 ||
      puts.length === 0 ||
      callOpenInterest <= 0 ||
      putOpenInterest <= 0 ||
      totalOpenInterest <= 0 ||
      timestampMs === null
    ) {
      cachedResult = unavailable('UNAVAILABLE');
      cachedAtMs = nowMs;
      return cachedResult;
    }

    const weightedIv = (contracts: ParsedOption[]) => contracts.reduce(
      (sum, option) => sum + option.impliedVolatilityPct * option.openInterest,
      0,
    ) / contracts.reduce((sum, option) => sum + option.openInterest, 0);
    const nearestAtm = [...valid].sort((left, right) =>
      Math.abs(left.strikePrice - left.underlyingPrice) / left.underlyingPrice -
      Math.abs(right.strikePrice - right.underlyingPrice) / right.underlyingPrice
    )[0];
    const ageMs = Math.max(0, evaluatedAtMs - timestampMs);
    const result: CouncilOptionsData = {
      status: 'LIVE',
      timestampMs,
      retrievedAtMs,
      ageMs,
      qualityPct: Math.round(valid.length / Math.max(eligible.length, 1) * 100),
      impliedVolatilityPct: Math.round(weightedIv(valid) * 100) / 100,
      putCallRatio: putOpenInterest / callOpenInterest,
      expiryTimestampMs: nearestAtm.expiryTimestampMs,
      strikePrice: nearestAtm.strikePrice,
      skewPct: Math.round((weightedIv(puts) - weightedIv(calls)) * 100) / 100,
      provider: 'Deribit public options API',
      contractsCount: valid.length,
      callOpenInterest,
      putOpenInterest,
      underlyingPrice: nearestAtm.underlyingPrice,
    };
    cachedResult = result;
    cachedAtMs = nowMs;
    return { ...result };
  } catch (error) {
    console.error('[DeribitOptionsData] Options source unavailable:', error);
    return unavailable('UNAVAILABLE');
  }
}

export function resetDeribitOptionsDataCacheForTests(): void {
  cachedAtMs = 0;
  cachedResult = null;
}
