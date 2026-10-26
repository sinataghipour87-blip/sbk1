import type { CouncilOptionsData } from './eightMemberCouncil';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import { isRecord, toPositiveNumber } from './onChainCexShared';

const API_ROOT = 'https://api.bybit.com/v5/market';
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 15_000;
const MAX_SOURCE_AGE_MS = 60_000;
const MIN_EXPIRY_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_EXPIRY_AGE_MS = 90 * 24 * 60 * 60_000;
const MIN_LIQUID_CONTRACTS = 20;
const MAX_INSTRUMENT_PAGES = 10;

interface BybitInstrument {
  symbol: string;
  status: string;
  baseCoin: string;
  quoteCoin: string;
  optionsType: string;
  deliveryTime: string;
  priceFilter: { minPrice: string; maxPrice: string; tickSize: string };
}

interface BybitOptionTicker {
  symbol: string;
  bid1Price: string;
  bid1Size: string;
  ask1Price: string;
  ask1Size: string;
  markPrice: string;
  markIv: string;
  underlyingPrice: string;
  openInterest: string;
  turnover24h: string;
}

interface ParsedContract {
  expiryTimestampMs: number;
  strikePrice: number;
  side: 'call' | 'put';
  openInterest: number;
  impliedVolatilityPct: number;
  underlyingPrice: number;
}

const cache = new Map<string, { cachedAtMs: number; value: CouncilOptionsData }>();

function unavailable(pair: string, reason: string): CouncilOptionsData {
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
    provider: 'Bybit V5 public options API',
    contractsCount: 0,
    callOpenInterest: null,
    putOpenInterest: null,
    underlyingPrice: null,
    unavailableReason: reason,
  };
}

function parseInstrument(value: unknown, asset: string): value is BybitInstrument {
  return isRecord(value) &&
    typeof value.symbol === 'string' &&
    new RegExp(`^${asset}-\\d{2}[A-Z]{3}\\d{2}-\\d+(?:\\.\\d+)?-[CP]-USDT$`).test(value.symbol) &&
    value.status === 'Trading' &&
    value.baseCoin === asset &&
    value.quoteCoin === 'USDT' &&
    (value.optionsType === 'Call' || value.optionsType === 'Put') &&
    typeof value.deliveryTime === 'string' &&
    /^\d{13}$/.test(value.deliveryTime) &&
    isRecord(value.priceFilter) &&
    toPositiveNumber(value.priceFilter.tickSize) !== null;
}

function parseTicker(value: unknown, asset: string): BybitOptionTicker | null {
  if (
    !isRecord(value) ||
    typeof value.symbol !== 'string' ||
    !new RegExp(`^${asset}-\\d{2}[A-Z]{3}\\d{2}-\\d+(?:\\.\\d+)?-[CP]-USDT$`).test(value.symbol)
  ) return null;
  const fields = [
    value.bid1Price,
    value.bid1Size,
    value.ask1Price,
    value.ask1Size,
    value.markPrice,
    value.markIv,
    value.underlyingPrice,
    value.openInterest,
    value.turnover24h,
  ];
  if (fields.some((field) => toPositiveNumber(field) === null)) return null;
  return value as unknown as BybitOptionTicker;
}

function parseContract(
  instrument: BybitInstrument,
  ticker: BybitOptionTicker,
  nowMs: number,
): ParsedContract | null {
  const match = /^([A-Z]+)-\d{2}[A-Z]{3}\d{2}-(\d+(?:\.\d+)?)-([CP])-USDT$/.exec(instrument.symbol);
  if (!match || match[1] !== instrument.baseCoin || match[1] !== ticker.symbol.split('-')[0]) return null;
  const expiryTimestampMs = Number(instrument.deliveryTime);
  const strikePrice = Number(match[2]);
  const markPrice = toPositiveNumber(ticker.markPrice);
  const markIv = toPositiveNumber(ticker.markIv);
  const underlyingPrice = toPositiveNumber(ticker.underlyingPrice);
  const openInterest = toPositiveNumber(ticker.openInterest);
  const bid = toPositiveNumber(ticker.bid1Price);
  const bidSize = toPositiveNumber(ticker.bid1Size);
  const ask = toPositiveNumber(ticker.ask1Price);
  const askSize = toPositiveNumber(ticker.ask1Size);
  const turnover = toPositiveNumber(ticker.turnover24h);
  const expiryAgeMs = expiryTimestampMs - nowMs;
  if (
    ![expiryTimestampMs, strikePrice, markPrice, markIv, underlyingPrice, openInterest, bid, bidSize, ask, askSize, turnover]
      .every((value) => value !== null && Number.isFinite(value) && value > 0) ||
    markIv! > 500 ||
    bid! >= ask! ||
    expiryAgeMs < MIN_EXPIRY_AGE_MS ||
    expiryAgeMs > MAX_EXPIRY_AGE_MS ||
    strikePrice < underlyingPrice! * 0.75 ||
    strikePrice > underlyingPrice! * 1.25
  ) return null;
  return {
    expiryTimestampMs,
    strikePrice,
    side: match[3] === 'C' ? 'call' : 'put',
    openInterest: openInterest!,
    impliedVolatilityPct: markIv! * 100,
    underlyingPrice: underlyingPrice!,
  };
}

async function request(
  fetcher: typeof fetch,
  path: string,
  asset: string,
  cursor?: string,
): Promise<{ payload: unknown; receivedAtMs: number }> {
  const url = new URL(`${API_ROOT}/${path}`);
  url.searchParams.set('category', 'option');
  url.searchParams.set('baseCoin', asset);
  if (path === 'instruments-info') {
    url.searchParams.set('limit', '1000');
  }
  if (cursor) url.searchParams.set('cursor', cursor);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Bybit options API returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    return { payload, receivedAtMs: Date.now() };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestAllInstruments(
  fetcher: typeof fetch,
  asset: string,
): Promise<{ instruments: unknown[]; receivedAtMs: number }> {
  const instruments: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let receivedAtMs = 0;
  for (let page = 0; page < MAX_INSTRUMENT_PAGES; page += 1) {
    const response = await request(fetcher, 'instruments-info', asset, cursor);
    if (!envelope(response.payload)) {
      throw new Error('Bybit instruments response envelope is malformed or unsuccessful.');
    }
    instruments.push(...response.payload.result.list);
    receivedAtMs = response.receivedAtMs;
    const nextCursor = response.payload.result.nextPageCursor;
    if (!nextCursor) return { instruments, receivedAtMs };
    if (seenCursors.has(nextCursor)) {
      throw new Error('Bybit instruments pagination returned a repeated cursor.');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error(`Bybit instruments pagination exceeded ${MAX_INSTRUMENT_PAGES} pages.`);
}

function envelope(value: unknown): value is {
  retCode: number;
  time: number;
  result: { list: unknown[]; nextPageCursor?: string };
} {
  return isRecord(value) &&
    value.retCode === 0 &&
    Number.isSafeInteger(value.time) &&
    isRecord(value.result) &&
    Array.isArray(value.result.list);
}

export async function fetchBybitOptionsData(options: {
  pair: string;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<CouncilOptionsData> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (asset !== 'BTC' && asset !== 'ETH') {
    return unavailable(options.pair, 'Bybit public options fallback is enabled only for BTC and ETH.');
  }
  const nowMs = options.nowMs ?? Date.now();
  const cached = cache.get(options.pair);
  if (cached && nowMs >= cached.cachedAtMs && nowMs - cached.cachedAtMs <= CACHE_TTL_MS) {
    const ageMs = cached.value.timestampMs === null
      ? null
      : Math.max(0, nowMs - cached.value.timestampMs);
    const fresh = ageMs !== null && ageMs <= MAX_SOURCE_AGE_MS;
    return {
      ...cached.value,
      status: fresh ? 'LIVE' : 'STALE',
      ageMs,
      qualityPct: fresh ? cached.value.qualityPct : 0,
      ...(fresh ? {} : { unavailableReason: 'Bybit options response is older than one minute.' }),
    };
  }

  const fetcher = options.fetcher ?? fetch;
  try {
    const [instrumentResponse, tickerResponse] = await Promise.all([
      requestAllInstruments(fetcher, asset),
      request(fetcher, 'tickers', asset),
    ]);
    if (!envelope(tickerResponse.payload)) {
      throw new Error('Bybit options response envelope is malformed or unsuccessful.');
    }
    const sourceTimestampMs = tickerResponse.payload.time;
    const retrievedAtMs = tickerResponse.receivedAtMs;
    if (
      sourceTimestampMs > retrievedAtMs + 1_000 ||
      sourceTimestampMs > nowMs + 1_000 ||
      Math.max(nowMs, retrievedAtMs) - sourceTimestampMs > MAX_SOURCE_AGE_MS
    ) {
      throw new Error('Bybit options response is stale or future-dated.');
    }

    const instruments = instrumentResponse.instruments.filter((item): item is BybitInstrument =>
      parseInstrument(item, asset)
    );
    const tickers = new Map<string, BybitOptionTicker>();
    for (const candidate of tickerResponse.payload.result.list) {
      const ticker = parseTicker(candidate, asset);
      if (ticker) {
        if (tickers.has(ticker.symbol)) throw new Error(`Bybit returned duplicate option ticker ${ticker.symbol}.`);
        tickers.set(ticker.symbol, ticker);
      }
    }
    const valid = instruments.flatMap((instrument) => {
      const ticker = tickers.get(instrument.symbol);
      if (!ticker) return [];
      const parsed = parseContract(instrument, ticker, Math.max(nowMs, retrievedAtMs));
      return parsed ? [parsed] : [];
    });
    const calls = valid.filter(({ side }) => side === 'call');
    const puts = valid.filter(({ side }) => side === 'put');
    const callOpenInterest = calls.reduce((sum, contract) => sum + contract.openInterest, 0);
    const putOpenInterest = puts.reduce((sum, contract) => sum + contract.openInterest, 0);
    const totalOpenInterest = callOpenInterest + putOpenInterest;
    if (
      valid.length < MIN_LIQUID_CONTRACTS ||
      calls.length === 0 ||
      puts.length === 0 ||
      callOpenInterest <= 0 ||
      putOpenInterest <= 0
    ) {
      throw new Error(`Bybit returned only ${valid.length} active liquid contracts; at least ${MIN_LIQUID_CONTRACTS} with calls and puts are required.`);
    }
    const weightedIv = valid.reduce(
      (sum, contract) => sum + contract.impliedVolatilityPct * contract.openInterest,
      0,
    ) / totalOpenInterest;
    const earliestExpiry = Math.min(...valid.map(({ expiryTimestampMs }) => expiryTimestampMs));
    const medianStrike = [...valid.map(({ strikePrice }) => strikePrice)]
      .sort((left, right) => left - right)[Math.floor(valid.length / 2)];
    const underlyingPrice = valid.reduce(
      (sum, contract) => sum + contract.underlyingPrice * contract.openInterest,
      0,
    ) / totalOpenInterest;
    const result: CouncilOptionsData = {
      pair: options.pair,
      asset,
      status: 'LIVE',
      timestampMs: sourceTimestampMs,
      retrievedAtMs,
      ageMs: Math.max(0, retrievedAtMs - sourceTimestampMs),
      qualityPct: 80,
      impliedVolatilityPct: weightedIv,
      putCallRatio: putOpenInterest / callOpenInterest,
      expiryTimestampMs: earliestExpiry,
      strikePrice: medianStrike,
      skewPct: null,
      provider: 'Bybit V5 public options API',
      contractsCount: valid.length,
      callOpenInterest,
      putOpenInterest,
      underlyingPrice,
    };
    cache.set(options.pair, { cachedAtMs: nowMs, value: result });
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[BybitOptionsData] Public options fallback unavailable: ${reason}`);
    return unavailable(options.pair, reason);
  }
}

export function resetBybitOptionsDataCacheForTests(): void {
  cache.clear();
}
