import type { CouncilOptionsData } from './eightMemberCouncil';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import { isRecord, toPositiveNumber } from './onChainCexShared';
import { getCouncilOptionsThresholds } from './councilOptionsThresholds';

const API_ROOT = 'https://api.gateio.ws/api/v4';
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 15_000;
const MAX_SOURCE_AGE_MS = 60_000;
const MIN_EXPIRY_AGE_MS = 24 * 60 * 60_000;
const MAX_EXPIRY_AGE_MS = 90 * 24 * 60 * 60_000;
const MAX_MONEYNESS_DEVIATION = 0.25;
const TRADE_SAMPLE_LIMIT = 1_000;
const VOLUME_WINDOW_MS = 24 * 60 * 60_000;

interface GateOptionContract {
  name: string;
  underlying: string;
  expiration_time: number;
  is_call: boolean;
  multiplier: string;
  strike_price: string;
  underlying_price: string;
  is_active: boolean;
}

interface GateOptionTicker {
  name: string;
  mark_price: string;
  index_price: string;
  ask1_size: number;
  ask1_price: string;
  bid1_size: number;
  bid1_price: string;
  position_size: number;
  mark_iv: string;
  underlying_price: string;
}

interface GateOptionTrade {
  contract: string;
  create_time: number;
  price: string;
  size: number;
}

interface GateBookLevel {
  p: string;
  s: number;
}

interface GateOptionOrderBook {
  current: number;
  update: number;
  asks: GateBookLevel[];
  bids: GateBookLevel[];
}

interface ParsedContract {
  name: string;
  expiryTimestampMs: number;
  strikePrice: number;
  side: 'call' | 'put';
  openInterest: number;
  impliedVolatilityPct: number;
  underlyingPrice: number;
  bidAskSpreadPct: number;
}

interface ParsedTrade {
  timestampMs: number;
  premiumNotional: number;
}

const cachedResults = new Map<string, { cachedAtMs: number; result: CouncilOptionsData }>();

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
    provider: 'Gate.io public Options API v4',
    contractsCount: 0,
    callOpenInterest: null,
    putOpenInterest: null,
    underlyingPrice: null,
    unavailableReason: reason,
  };
}

function parseSecondsTimestamp(value: unknown): number | null {
  const timestamp = typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : Number.NaN;
  const timestampMs = timestamp * 1_000;
  return Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs : null;
}

function isOptionContract(value: unknown, asset: string): value is GateOptionContract {
  return isRecord(value) &&
    typeof value.name === 'string' &&
    new RegExp(`^${asset}_USDT-\\d{8}-\\d+(?:\\.\\d+)?-[CP]$`).test(value.name) &&
    value.underlying === `${asset}_USDT` &&
    parseSecondsTimestamp(value.expiration_time) !== null &&
    typeof value.is_call === 'boolean' &&
    toPositiveNumber(value.multiplier) !== null &&
    toPositiveNumber(value.strike_price) !== null &&
    value.is_active === true;
}

function isOptionTicker(value: unknown, asset: string): value is GateOptionTicker {
  return isRecord(value) &&
    typeof value.name === 'string' &&
    new RegExp(`^${asset}_USDT-\\d{8}-\\d+(?:\\.\\d+)?-[CP]$`).test(value.name);
}

function parseTrade(value: unknown, asset: string): ParsedTrade | null {
  if (!isRecord(value) || typeof value.contract !== 'string' ||
      !value.contract.startsWith(`${asset}_USDT-`)) return null;
  const timestampMs = parseSecondsTimestamp(value.create_time);
  const price = toPositiveNumber(value.price);
  const size = typeof value.size === 'number' ? value.size : Number.NaN;
  if (timestampMs === null || price === null || !Number.isFinite(size) || size === 0) return null;
  return { timestampMs, premiumNotional: Math.abs(size) * price };
}

async function request(
  fetcher: typeof fetch,
  path: string,
): Promise<{ payload: unknown; receivedAtMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(`${API_ROOT}${path}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Gate.io Options API returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    return { payload, receivedAtMs: Date.now() };
  } finally {
    clearTimeout(timeout);
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function parseContract(
  contract: GateOptionContract,
  ticker: GateOptionTicker,
  nowMs: number,
): ParsedContract | null {
  if (contract.name !== ticker.name) return null;
  const expiryTimestampMs = parseSecondsTimestamp(contract.expiration_time);
  const strikePrice = toPositiveNumber(contract.strike_price);
  const multiplier = toPositiveNumber(contract.multiplier);
  const underlyingPrice = toPositiveNumber(ticker.underlying_price);
  const positionSize = toPositiveNumber(ticker.position_size);
  const markIv = toPositiveNumber(ticker.mark_iv);
  const bid = toPositiveNumber(ticker.bid1_price);
  const ask = toPositiveNumber(ticker.ask1_price);
  const bidSize = toPositiveNumber(ticker.bid1_size);
  const askSize = toPositiveNumber(ticker.ask1_size);
  if (
    expiryTimestampMs === null ||
    strikePrice === null ||
    multiplier === null ||
    underlyingPrice === null ||
    positionSize === null ||
    markIv === null ||
    bid === null ||
    ask === null ||
    bidSize === null ||
    askSize === null ||
    markIv > 5 ||
    ask <= bid ||
    expiryTimestampMs - nowMs < MIN_EXPIRY_AGE_MS ||
    expiryTimestampMs - nowMs > MAX_EXPIRY_AGE_MS ||
    Math.abs(strikePrice - underlyingPrice) / underlyingPrice > MAX_MONEYNESS_DEVIATION
  ) return null;

  const bidAskSpreadPct = (ask - bid) / ((ask + bid) / 2) * 100;
  if (!Number.isFinite(bidAskSpreadPct) || bidAskSpreadPct > 20) return null;

  return {
    name: contract.name,
    expiryTimestampMs,
    strikePrice,
    side: contract.is_call ? 'call' : 'put',
    openInterest: positionSize * multiplier * underlyingPrice,
    impliedVolatilityPct: markIv * 100,
    underlyingPrice,
    bidAskSpreadPct,
  };
}

async function validateOrderBook(
  fetcher: typeof fetch,
  contract: ParsedContract,
  receivedAtMs: number,
): Promise<{ timestampMs: number; spreadPct: number } | null> {
  const { payload, receivedAtMs: bookReceivedAtMs } = await request(
    fetcher,
    `/options/order_book?contract=${encodeURIComponent(contract.name)}&limit=10`,
  );
  if (!isRecord(payload) || !Array.isArray(payload.bids) || !Array.isArray(payload.asks)) return null;
  const book = payload as unknown as GateOptionOrderBook;
  const bid = isRecord(book.bids[0]) ? toPositiveNumber(book.bids[0].p) : null;
  const bidSize = isRecord(book.bids[0]) ? toPositiveNumber(book.bids[0].s) : null;
  const ask = isRecord(book.asks[0]) ? toPositiveNumber(book.asks[0].p) : null;
  const askSize = isRecord(book.asks[0]) ? toPositiveNumber(book.asks[0].s) : null;
  const currentMs = parseSecondsTimestamp(book.current);
  const timestampMs = parseSecondsTimestamp(book.update);
  if (
    bid === null || bidSize === null || ask === null || askSize === null ||
    currentMs === null || timestampMs === null ||
    currentMs > bookReceivedAtMs + 1_000 ||
    timestampMs > currentMs + 1_000 ||
    bookReceivedAtMs - timestampMs > MAX_SOURCE_AGE_MS ||
    bookReceivedAtMs < receivedAtMs ||
    ask <= bid
  ) return null;
  const spreadPct = (ask - bid) / ((ask + bid) / 2) * 100;
  return Number.isFinite(spreadPct) && spreadPct <= 20
    ? { timestampMs, spreadPct }
    : null;
}

export async function fetchGateioOptionsData(options: {
  pair: string;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<CouncilOptionsData> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (!asset || !['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].includes(asset)) {
    return unavailable(options.pair, 'Gate.io Options has no verified contract mapping for this pair.');
  }
  const thresholds = getCouncilOptionsThresholds(asset);
  if (!thresholds) return unavailable(options.pair, 'Gate.io Options has no council validation thresholds for this asset.');
  const nowMs = options.nowMs ?? Date.now();
  const cached = cachedResults.get(options.pair);
  if (cached && nowMs >= cached.cachedAtMs && nowMs - cached.cachedAtMs <= CACHE_TTL_MS) {
    const ageMs = cached.result.timestampMs === null ? null : nowMs - cached.result.timestampMs;
    const fresh = ageMs !== null && ageMs >= 0 && ageMs <= MAX_SOURCE_AGE_MS;
    return {
      ...cached.result,
      status: fresh ? 'LIVE' : 'STALE',
      ageMs,
      qualityPct: fresh ? cached.result.qualityPct : 0,
      ...(fresh ? {} : { unavailableReason: 'Gate.io sampled option book updates are stale or future-dated.' }),
    };
  }

  const fetcher = options.fetcher ?? fetch;
  try {
    const underlying = `${asset}_USDT`;
    const params = new URLSearchParams({ underlying });
    const startedAtMs = Date.now();
    const [contractsResponse, tickersResponse, tradesResponse] = await Promise.all([
      request(fetcher, `/options/contracts?${params}`),
      request(fetcher, `/options/tickers?${params}`),
      request(fetcher, `/options/trades?limit=${TRADE_SAMPLE_LIMIT}`),
    ]);
    if (
      !Array.isArray(contractsResponse.payload) ||
      !Array.isArray(tickersResponse.payload) ||
      !Array.isArray(tradesResponse.payload)
    ) {
      throw new Error('Gate.io option contracts, tickers, or trades response is malformed.');
    }

    const evaluatedAtMs = Math.max(
      nowMs,
      contractsResponse.receivedAtMs,
      tickersResponse.receivedAtMs,
      tradesResponse.receivedAtMs,
    );
    const tickerMap = new Map<string, GateOptionTicker>();
    for (const candidate of tickersResponse.payload) {
      if (!isOptionTicker(candidate, asset)) continue;
      const ticker = candidate as GateOptionTicker;
      if (tickerMap.has(ticker.name)) throw new Error(`Gate.io returned duplicate option ticker ${ticker.name}.`);
      tickerMap.set(ticker.name, ticker);
    }

    const contractMap = new Map<string, GateOptionContract>();
    for (const candidate of contractsResponse.payload) {
      if (!isOptionContract(candidate, asset)) continue;
      const contract = candidate as GateOptionContract;
      if (contractMap.has(contract.name)) throw new Error(`Gate.io returned duplicate option contract ${contract.name}.`);
      contractMap.set(contract.name, contract);
    }

    const relevantContracts = [...contractMap.values()].filter((contract) => {
      const expiryTimestampMs = parseSecondsTimestamp(contract.expiration_time);
      const strikePrice = toPositiveNumber(contract.strike_price);
      const underlyingPrice = toPositiveNumber(contract.underlying_price);
      return expiryTimestampMs !== null &&
        expiryTimestampMs - evaluatedAtMs >= MIN_EXPIRY_AGE_MS &&
        expiryTimestampMs - evaluatedAtMs <= MAX_EXPIRY_AGE_MS &&
        strikePrice !== null &&
        underlyingPrice !== null &&
        Math.abs(strikePrice - underlyingPrice) / underlyingPrice <= MAX_MONEYNESS_DEVIATION;
    });
    if (relevantContracts.length === 0) {
      const result = unavailable(options.pair, `Gate.io has no complete ${asset} options within the accepted expiry and moneyness windows.`);
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
    }

    const contracts = relevantContracts.flatMap((candidate) => {
      const contract = candidate as GateOptionContract;
      const ticker = tickerMap.get(contract.name);
      if (!ticker) return [];
      const parsed = parseContract(contract, ticker, evaluatedAtMs);
      return parsed ? [parsed] : [];
    });
    const calls = contracts.filter(({ side }) => side === 'call');
    const puts = contracts.filter(({ side }) => side === 'put');
    if (
      contracts.length < thresholds.minimumContracts ||
      calls.length < thresholds.minimumContractsPerSide ||
      puts.length < thresholds.minimumContractsPerSide
    ) {
      throw new Error(
        `Gate.io returned ${contracts.length} fresh liquid ${asset} options (${calls.length} calls/${puts.length} puts); at least ${thresholds.minimumContracts} total and ${thresholds.minimumContractsPerSide} each side with two-sided quotes are required.`,
      );
    }

    const trades = tradesResponse.payload;
    const parsedTrades = trades.flatMap((candidate) => {
      const parsed = parseTrade(candidate, asset);
      return parsed ? [parsed] : [];
    });
    const validTradeTimestamps = trades.flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      const timestampMs = parseSecondsTimestamp(candidate.create_time);
      return timestampMs === null ? [] : [timestampMs];
    });
    if (validTradeTimestamps.length !== trades.length || validTradeTimestamps.some((timestampMs) =>
      timestampMs > evaluatedAtMs + 1_000
    )) {
      throw new Error('Gate.io option trades contain an invalid or future timestamp.');
    }
    const oldestTradeTimestampMs = validTradeTimestamps.length > 0
      ? Math.min(...validTradeTimestamps)
      : null;
    if (
      trades.length === TRADE_SAMPLE_LIMIT &&
      oldestTradeTimestampMs !== null &&
      oldestTradeTimestampMs > evaluatedAtMs - VOLUME_WINDOW_MS
    ) {
      throw new Error('Gate.io latest-trades sample does not cover the full rolling 24-hour window.');
    }
    const volume24h = parsedTrades.reduce(
      (sum, trade) => sum + (
        trade.timestampMs >= evaluatedAtMs - VOLUME_WINDOW_MS &&
        trade.timestampMs <= evaluatedAtMs
          ? trade.premiumNotional
          : 0
      ),
      0,
    );
    if (volume24h <= 0) throw new Error(`Gate.io has no ${asset} option premium turnover in the last 24 hours.`);

    const nearestContracts = (side: ParsedContract['side']) => [...contracts]
      .filter((contract) => contract.side === side)
      .sort((left, right) =>
        Math.abs(left.strikePrice - left.underlyingPrice) / left.underlyingPrice -
        Math.abs(right.strikePrice - right.underlyingPrice) / right.underlyingPrice
      )
      .slice(0, thresholds.minimumContractsPerSide);
    const bookSamples = [
      ...nearestContracts('call'),
      ...nearestContracts('put'),
    ];
    const sampledBooks = await Promise.all(bookSamples.map((contract) =>
      validateOrderBook(fetcher, contract, startedAtMs)
    ));
    const validBookSamples = sampledBooks.filter(
      (sample): sample is NonNullable<typeof sample> => sample !== null,
    );
    if (validBookSamples.length !== thresholds.minimumSizedOrderBooks) {
      throw new Error(
        `Gate.io returned only ${validBookSamples.length}/${thresholds.minimumSizedOrderBooks} fresh two-sided option order books (${thresholds.minimumContractsPerSide} calls and puts required).`,
      );
    }

    const callOpenInterest = calls.reduce((sum, contract) => sum + contract.openInterest, 0);
    const putOpenInterest = puts.reduce((sum, contract) => sum + contract.openInterest, 0);
    if (callOpenInterest <= 0 || putOpenInterest <= 0) {
      throw new Error('Gate.io options require positive call and put open interest.');
    }
    const totalOpenInterest = callOpenInterest + putOpenInterest;
    const weightedIv = contracts.reduce(
      (sum, contract) => sum + contract.impliedVolatilityPct * contract.openInterest,
      0,
    ) / totalOpenInterest;
    const weightedIvForSide = (side: ParsedContract['side']) => {
      const sideContracts = contracts.filter((contract) => contract.side === side);
      const sideOpenInterest = side === 'call' ? callOpenInterest : putOpenInterest;
      return sideContracts.reduce(
        (sum, contract) => sum + contract.impliedVolatilityPct * contract.openInterest,
        0,
      ) / sideOpenInterest;
    };
    const nearestAtm = [...contracts].sort((left, right) =>
      Math.abs(left.strikePrice - left.underlyingPrice) / left.underlyingPrice -
      Math.abs(right.strikePrice - right.underlyingPrice) / right.underlyingPrice
    )[0];
    const timestampMs = Math.min(...validBookSamples.map(({ timestampMs: sampleMs }) => sampleMs));
    const qualityPct = Math.round(contracts.length / relevantContracts.length * 100);
    const retrievedAtMs = Math.max(
      contractsResponse.receivedAtMs,
      tickersResponse.receivedAtMs,
      tradesResponse.receivedAtMs,
      Date.now(),
    );
    const ageMs = retrievedAtMs - timestampMs;
    if (ageMs < 0 || ageMs > MAX_SOURCE_AGE_MS) {
      throw new Error('Gate.io option order-book updates are stale or future-dated.');
    }

    const result: CouncilOptionsData = {
      pair: options.pair,
      asset,
      status: 'LIVE',
      timestampMs,
      retrievedAtMs,
      ageMs,
      qualityPct,
      impliedVolatilityPct: weightedIv,
      putCallRatio: putOpenInterest / callOpenInterest,
      expiryTimestampMs: nearestAtm.expiryTimestampMs,
      strikePrice: nearestAtm.strikePrice,
      skewPct: weightedIvForSide('put') - weightedIvForSide('call'),
      provider: 'Gate.io public Options API v4',
      contractsCount: contracts.length,
      callContractsCount: calls.length,
      putContractsCount: puts.length,
      bidAskValidatedContracts: contracts.length,
      bidAskSizeValidatedContracts: validBookSamples.length,
      medianBidAskSpreadPct: median([
        ...contracts.map(({ bidAskSpreadPct }) => bidAskSpreadPct),
        ...validBookSamples.map(({ spreadPct }) => spreadPct),
      ]),
      volume24h,
      volumeUnit: 'Gate raw option premium units (trade price * contract count; no multiplier conversion)',
      openInterestUnit: 'USD notional estimated from Gate position size × multiplier × underlying price',
      callOpenInterest,
      putOpenInterest,
      underlyingPrice: nearestAtm.underlyingPrice,
      ...(qualityPct < 80
        ? { unavailableReason: `Gate.io option data quality is ${qualityPct}%, below the council minimum of 80%; this feed is not vote-eligible.` }
        : {}),
    };
    cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[GateioOptionsData] Public options source unavailable:', reason);
    return unavailable(options.pair, reason);
  }
}
