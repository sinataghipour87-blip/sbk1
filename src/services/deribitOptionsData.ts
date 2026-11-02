import type { CouncilOptionsData } from './eightMemberCouncil';
import { deduplicateOptionContracts } from './councilEvidenceDeduplication';
import { getFreqtradePairBaseAsset } from './freqtradePairs';

const DERIBIT_SUMMARY_ENDPOINT =
  'https://www.deribit.com/api/v2/public/get_book_summary_by_currency';
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
  bid_price: number;
  ask_price: number;
  volume: number;
}

interface ParsedOption {
  optionType: 'call' | 'put';
  expiryTimestampMs: number;
  strikePrice: number;
  openInterest: number;
  impliedVolatilityPct: number;
  underlyingPrice: number;
  timestampMs: number;
  bidAskSpreadPct: number;
  volume24h: number;
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
    provider: 'Deribit public options API',
    contractsCount: 0,
    callOpenInterest: null,
    putOpenInterest: null,
    underlyingPrice: null,
    ...(reason ? { unavailableReason: reason } : {}),
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
    isFiniteNumber(summary.creation_timestamp) &&
    isFiniteNumber(summary.bid_price) &&
    isFiniteNumber(summary.ask_price) &&
    isFiniteNumber(summary.volume);
}

function parseOption(summary: DeribitOptionSummary, asset: string, nowMs: number): ParsedOption | null {
  const match = /^([A-Z]+)-(\d{2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-(C|P)$/
    .exec(summary.instrument_name);
  if (match?.[1] !== asset) return null;
  if (!match || summary.open_interest <= 0 || summary.mark_iv <= 0 ||
      summary.mark_iv > 500 || summary.underlying_price <= 0 ||
      summary.bid_price <= 0 || summary.ask_price < summary.bid_price ||
      summary.volume <= 0) return null;
  const timestampMs = summary.creation_timestamp;
  if (
    !Number.isSafeInteger(timestampMs) ||
    timestampMs > nowMs + 1_000 ||
    nowMs - timestampMs > MAX_SOURCE_AGE_MS
  ) return null;
  const [, , dayText, monthText, yearText, strikeText, type] = match;
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
    timestampMs,
    bidAskSpreadPct: (summary.ask_price - summary.bid_price) /
      ((summary.ask_price + summary.bid_price) / 2) * 100,
    volume24h: summary.volume,
  };
}

async function fetchJson(fetcher: typeof fetch, asset: string): Promise<{ payload: unknown; retrievedAtMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = new URL(DERIBIT_SUMMARY_ENDPOINT);
    endpoint.searchParams.set('currency', asset);
    endpoint.searchParams.set('kind', 'option');
    const response = await fetcher(endpoint, {
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

async function fetchOrderBook(
  fetcher: typeof fetch,
  instrumentName: string,
): Promise<{ payload: unknown; retrievedAtMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = new URL('https://www.deribit.com/api/v2/public/get_order_book');
    endpoint.searchParams.set('instrument_name', instrumentName);
    endpoint.searchParams.set('depth', '5');
    const response = await fetcher(endpoint, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Deribit order-book API returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    return { payload, retrievedAtMs: Date.now() };
  } finally {
    clearTimeout(timeout);
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

export async function fetchDeribitOptionsData(options: {
  pair: string;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<CouncilOptionsData> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (!asset) return unavailable(options.pair);
  if (asset !== 'BTC' && asset !== 'ETH') return unavailable(options.pair);
  const nowMs = options.nowMs ?? Date.now();
  const cached = cachedResults.get(options.pair);
  if (cached && nowMs >= cached.cachedAtMs && nowMs - cached.cachedAtMs <= CACHE_TTL_MS) {
    return {
      ...cached.result,
      ageMs: cached.result.timestampMs === null ? null : nowMs - cached.result.timestampMs,
    };
  }
  try {
    const { payload, retrievedAtMs } = await fetchJson(options.fetcher ?? fetch, asset);
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
      const parsed = parseOption(summary, asset, evaluatedAtMs);
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
    const valid = eligible.filter(({ timestampMs }) =>
      timestampMs <= nowMs + 1_000 &&
      nowMs - timestampMs <= MAX_SOURCE_AGE_MS
    );
    const calls = valid.filter(({ optionType }) => optionType === 'call');
    const puts = valid.filter(({ optionType }) => optionType === 'put');
    const callOpenInterest = calls.reduce((sum, option) => sum + option.openInterest, 0);
    const putOpenInterest = puts.reduce((sum, option) => sum + option.openInterest, 0);
    if (
      valid.length < MIN_VALID_CONTRACTS ||
      calls.length < 4 ||
      puts.length < 4 ||
      callOpenInterest <= 0 ||
      putOpenInterest <= 0
    ) {
      const result = unavailable(
        options.pair,
        'Deribit did not provide at least 20 fresh contracts with four calls, four puts, and positive OI on both sides.',
      );
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
    }
    const bookSample = [
      ...[...calls].sort((left, right) => right.openInterest - left.openInterest).slice(0, 4),
      ...[...puts].sort((left, right) => right.openInterest - left.openInterest).slice(0, 4),
    ];
    if (bookSample.length !== 8) {
      const result = unavailable(
        options.pair,
        'Deribit did not provide four active contracts on each side for order-book validation.',
      );
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
    }
    const sampledBooks = await Promise.all(bookSample.map(async (option) => {
      const { payload: bookPayload, retrievedAtMs: bookReceivedAtMs } =
        await fetchOrderBook(options.fetcher ?? fetch, option.instrumentName);
      if (typeof bookPayload !== 'object' || bookPayload === null ||
          !('result' in bookPayload) || typeof bookPayload.result !== 'object' ||
          bookPayload.result === null) return null;
      const book = bookPayload.result as Record<string, unknown>;
      const bidLevel = Array.isArray(book.bids) && Array.isArray(book.bids[0])
        ? book.bids[0]
        : null;
      const askLevel = Array.isArray(book.asks) && Array.isArray(book.asks[0])
        ? book.asks[0]
        : null;
      const bid = bidLevel ? Number(bidLevel[0]) : Number.NaN;
      const bidSize = bidLevel ? Number(bidLevel[1]) : Number.NaN;
      const ask = askLevel ? Number(askLevel[0]) : Number.NaN;
      const askSize = askLevel ? Number(askLevel[1]) : Number.NaN;
      const bookTimestampMs = book.timestamp;
      if (
        !isFiniteNumber(bid) || bid <= 0 ||
        !isFiniteNumber(bidSize) || bidSize <= 0 ||
        !isFiniteNumber(ask) || ask < bid ||
        !isFiniteNumber(askSize) || askSize <= 0 ||
        !isFiniteNumber(bookTimestampMs) ||
        bookTimestampMs > bookReceivedAtMs + 1_000 ||
        bookReceivedAtMs - bookTimestampMs > MAX_SOURCE_AGE_MS
      ) return null;
      return {
        side: option.optionType,
        timestampMs: bookTimestampMs,
        spreadPct: (ask - bid) / ((ask + bid) / 2) * 100,
      };
    }));
    const validBookSamples = sampledBooks.filter(
      (sample): sample is NonNullable<typeof sample> => sample !== null,
    );
    if (
      validBookSamples.filter(({ side }) => side === 'call').length < 4 ||
      validBookSamples.filter(({ side }) => side === 'put').length < 4
    ) {
      const result = unavailable(
        options.pair,
        'Deribit order-book samples were missing, stale, crossed, or lacked positive top-level size.',
      );
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
    }
    const totalOpenInterest = callOpenInterest + putOpenInterest;
    const timestampMs = valid.length > 0
      ? Math.min(
        ...valid.map(({ timestampMs: summaryTimestampMs }) => summaryTimestampMs),
        ...validBookSamples.map(({ timestampMs: bookTimestampMs }) => bookTimestampMs),
      )
      : null;
    if (
      valid.length < MIN_VALID_CONTRACTS ||
      calls.length === 0 ||
      puts.length === 0 ||
      callOpenInterest <= 0 ||
      putOpenInterest <= 0 ||
      totalOpenInterest <= 0 ||
      timestampMs === null
    ) {
      const result = unavailable(
        options.pair,
        'Deribit did not provide at least 20 fresh contracts with positive call/put OI and two-sided top-of-book samples.',
      );
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
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
      pair: options.pair,
      asset,
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
      callContractsCount: calls.length,
      putContractsCount: puts.length,
      bidAskValidatedContracts: valid.length,
      bidAskSizeValidatedContracts: validBookSamples.length,
      medianBidAskSpreadPct: median(validBookSamples.map(({ spreadPct }) => spreadPct)),
      volume24h: valid.reduce((sum, option) => sum + option.volume24h, 0),
      volumeUnit: 'Deribit-reported underlying volume units',
      openInterestUnit: 'Deribit-reported option OI units',
      callOpenInterest,
      putOpenInterest,
      underlyingPrice: nearestAtm.underlyingPrice,
    };
    cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
    return { ...result };
  } catch (error) {
    console.error('[DeribitOptionsData] Options source unavailable:', error);
    return unavailable(
      options.pair,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function resetDeribitOptionsDataCacheForTests(): void {
  cachedResults.clear();
}
