import type { CouncilOptionsData } from './eightMemberCouncil';
import { getFreqtradePairBaseAsset } from './freqtradePairs';
import { isRecord, toPositiveNumber } from './onChainCexShared';

const API_ROOT = 'https://api.india.delta.exchange/v2';
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 15_000;
const MAX_SOURCE_AGE_MS = 60_000;
const MIN_EXPIRY_AGE_MS = 24 * 60 * 60_000;
const MAX_EXPIRY_AGE_MS = 90 * 24 * 60 * 60_000;
const MAX_MONEYNESS_DEVIATION = 0.25;
const MIN_LIQUID_CONTRACTS = 20;

interface DeltaOptionProduct {
  id: number;
  symbol: string;
  state: string;
  trading_status: string;
  contract_type: 'call_options' | 'put_options';
  contract_value: string;
  contract_unit_currency: string;
  underlying_asset: { symbol: string };
  strike_price: string;
  settlement_time: string;
}

interface DeltaOptionTicker {
  product_id: number;
  symbol: string;
  underlying_asset_symbol: string;
  product_trading_status: string;
  contract_type: 'call_options' | 'put_options';
  timestamp: number;
  spot_price: string;
  strike_price: string;
  oi_contracts: string;
  oi_value: string;
  oi_value_usd: string;
  mark_vol: string;
  turnover_usd: number;
  quotes: {
    best_bid: string;
    best_ask: string;
    bid_size: string;
    ask_size: string;
  };
}

interface ParsedContract {
  product: DeltaOptionProduct;
  ticker: DeltaOptionTicker;
  expiryTimestampMs: number;
  strikePrice: number;
  side: 'call' | 'put';
  openInterestUsd: number;
  impliedVolatilityPct: number;
  underlyingPrice: number;
  timestampMs: number;
  bidAskSpreadPct: number;
  turnoverUsd: number;
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
    provider: 'Delta Exchange India public options API',
    contractsCount: 0,
    callOpenInterest: null,
    putOpenInterest: null,
    underlyingPrice: null,
    unavailableReason: reason,
  };
}

function parseTimestampMicroseconds(value: unknown): number | null {
  const timestamp = typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : Number.NaN;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  const timestampMs = Math.floor(timestamp / 1_000);
  return Number.isSafeInteger(timestampMs) && timestampMs > 0 ? timestampMs : null;
}

function isProduct(value: unknown, asset: string): value is DeltaOptionProduct {
  return isRecord(value) &&
    Number.isSafeInteger(value.id) &&
    typeof value.symbol === 'string' &&
    new RegExp(`^[CP]-${asset}-\\d+(?:\\.\\d+)?-\\d{6}$`).test(value.symbol) &&
    value.state === 'live' &&
    value.trading_status === 'operational' &&
    (value.contract_type === 'call_options' || value.contract_type === 'put_options') &&
    toPositiveNumber(value.contract_value) !== null &&
    value.contract_unit_currency === asset &&
    isRecord(value.underlying_asset) &&
    value.underlying_asset.symbol === asset &&
    toPositiveNumber(value.strike_price) !== null &&
    typeof value.settlement_time === 'string' &&
    Number.isFinite(Date.parse(value.settlement_time));
}

function isTicker(value: unknown, asset: string): value is DeltaOptionTicker {
  return isRecord(value) &&
    Number.isSafeInteger(value.product_id) &&
    typeof value.symbol === 'string' &&
  new RegExp(`^[CP]-${asset}-\\d+(?:\\.\\d+)?-\\d{6}$`).test(value.symbol) &&
    value.underlying_asset_symbol === asset &&
    value.product_trading_status === 'operational' &&
    (value.contract_type === 'call_options' || value.contract_type === 'put_options') &&
    parseTimestampMicroseconds(value.timestamp) !== null &&
    toPositiveNumber(value.spot_price) !== null &&
    toPositiveNumber(value.strike_price) !== null &&
    toPositiveNumber(value.oi_contracts) !== null &&
    toPositiveNumber(value.oi_value) !== null &&
    toPositiveNumber(value.oi_value_usd) !== null &&
    toPositiveNumber(value.mark_vol) !== null &&
    typeof value.turnover_usd === 'number' &&
    Number.isFinite(value.turnover_usd) &&
    value.turnover_usd >= 0 &&
    isRecord(value.quotes) &&
    toPositiveNumber(value.quotes.best_bid) !== null &&
    toPositiveNumber(value.quotes.best_ask) !== null &&
    toPositiveNumber(value.quotes.bid_size) !== null &&
    toPositiveNumber(value.quotes.ask_size) !== null;
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
    if (!response.ok) throw new Error(`Delta India Options API returned HTTP ${response.status}.`);
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
  product: DeltaOptionProduct,
  ticker: DeltaOptionTicker,
  nowMs: number,
): ParsedContract | null {
  if (
    product.id !== ticker.product_id ||
    product.symbol !== ticker.symbol ||
    product.contract_type !== ticker.contract_type ||
    toPositiveNumber(product.strike_price) !== toPositiveNumber(ticker.strike_price)
  ) return null;
  const expiryTimestampMs = Date.parse(product.settlement_time);
  const strikePrice = toPositiveNumber(product.strike_price);
  const underlyingPrice = toPositiveNumber(ticker.spot_price);
  const openInterestContracts = toPositiveNumber(ticker.oi_contracts);
  const contractValue = toPositiveNumber(product.contract_value);
  const openInterestBase = toPositiveNumber(ticker.oi_value);
  const openInterestUsd = toPositiveNumber(ticker.oi_value_usd);
  const markVol = toPositiveNumber(ticker.mark_vol);
  const bid = toPositiveNumber(ticker.quotes.best_bid);
  const ask = toPositiveNumber(ticker.quotes.best_ask);
  const bidSize = toPositiveNumber(ticker.quotes.bid_size);
  const askSize = toPositiveNumber(ticker.quotes.ask_size);
  const timestampMs = parseTimestampMicroseconds(ticker.timestamp);
  const expiryAgeMs = expiryTimestampMs - nowMs;

  if (
    strikePrice === null ||
    underlyingPrice === null ||
    openInterestContracts === null ||
    contractValue === null ||
    openInterestBase === null ||
    openInterestUsd === null ||
    markVol === null ||
    bid === null ||
    ask === null ||
    bidSize === null ||
    askSize === null ||
    timestampMs === null ||
    !Number.isFinite(expiryAgeMs) ||
    expiryAgeMs < MIN_EXPIRY_AGE_MS ||
    expiryAgeMs > MAX_EXPIRY_AGE_MS ||
    markVol > 5 ||
    ask <= bid ||
    timestampMs > nowMs + 1_000 ||
    nowMs - timestampMs > MAX_SOURCE_AGE_MS
  ) return null;

  const expectedOpenInterestBase = openInterestContracts * contractValue;
  if (Math.abs(openInterestBase - expectedOpenInterestBase) > Math.max(1e-8, expectedOpenInterestBase * 0.01)) {
    return null;
  }
  const expectedOpenInterestUsd = openInterestBase * underlyingPrice;
  if (Math.abs(openInterestUsd - expectedOpenInterestUsd) > Math.max(1, expectedOpenInterestUsd * 0.05)) {
    return null;
  }

  const bidAskSpreadPct = (ask - bid) / ((ask + bid) / 2) * 100;
  if (!Number.isFinite(bidAskSpreadPct) || bidAskSpreadPct < 0 || bidAskSpreadPct > 20) return null;

  return {
    product,
    ticker,
    expiryTimestampMs,
    strikePrice,
    side: product.contract_type === 'call_options' ? 'call' : 'put',
    openInterestUsd,
    impliedVolatilityPct: markVol * 100,
    underlyingPrice,
    timestampMs,
    bidAskSpreadPct,
    turnoverUsd: ticker.turnover_usd,
  };
}

async function validateOrderBook(
  fetcher: typeof fetch,
  contract: ParsedContract,
): Promise<{ timestampMs: number; spreadPct: number } | null> {
  const { payload, receivedAtMs } = await request(fetcher, `/l2orderbook/${contract.product.id}`);
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.result)) return null;
  const book = payload.result;
  if (
    book.symbol !== contract.product.symbol ||
    !Array.isArray(book.buy) ||
    !Array.isArray(book.sell) ||
    !isRecord(book.buy[0]) ||
    !isRecord(book.sell[0])
  ) return null;
  const bid = toPositiveNumber(book.buy[0].price);
  const bidSize = toPositiveNumber(book.buy[0].size);
  const ask = toPositiveNumber(book.sell[0].price);
  const askSize = toPositiveNumber(book.sell[0].size);
  const timestampMs = parseTimestampMicroseconds(book.last_updated_at);
  if (
    bid === null || bidSize === null || ask === null || askSize === null ||
    timestampMs === null ||
    timestampMs > receivedAtMs + 1_000 ||
    receivedAtMs - timestampMs > MAX_SOURCE_AGE_MS ||
    ask <= bid
  ) return null;
  const spreadPct = (ask - bid) / ((ask + bid) / 2) * 100;
  if (!Number.isFinite(spreadPct) || spreadPct > 20) return null;
  return { timestampMs, spreadPct };
}

export async function fetchDeltaOptionsData(options: {
  pair: string;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<CouncilOptionsData> {
  const asset = getFreqtradePairBaseAsset(options.pair);
  if (asset !== 'BTC' && asset !== 'ETH') {
    return unavailable(options.pair, 'Delta India currently has verified options coverage only for BTC and ETH.');
  }
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
      ...(fresh ? {} : { unavailableReason: 'Delta India option data is stale or future-dated.' }),
    };
  }

  const fetcher = options.fetcher ?? fetch;
  try {
    const [productsResponse, tickersResponse] = await Promise.all([
      request(fetcher, '/products?contract_types=call_options,put_options'),
      request(fetcher, '/tickers?contract_types=call_options,put_options'),
    ]);
    const productsPayload = productsResponse.payload;
    const tickersPayload = tickersResponse.payload;
    if (
      !isRecord(productsPayload) || productsPayload.success !== true || !Array.isArray(productsPayload.result) ||
      !isRecord(tickersPayload) || tickersPayload.success !== true || !Array.isArray(tickersPayload.result)
    ) {
      throw new Error('Delta India option products or tickers response is malformed or unsuccessful.');
    }

    const evaluatedAtMs = Math.max(nowMs, productsResponse.receivedAtMs, tickersResponse.receivedAtMs);
    const productMap = new Map<number, DeltaOptionProduct>();
    for (const candidate of productsPayload.result) {
      if (!isProduct(candidate, asset)) continue;
      if (productMap.has(candidate.id)) throw new Error(`Delta India returned duplicate option product id ${candidate.id}.`);
      productMap.set(candidate.id, candidate);
    }
    const eligibleProducts = [...productMap.values()].filter((product) => {
      const expiryAgeMs = Date.parse(product.settlement_time) - evaluatedAtMs;
      return expiryAgeMs >= MIN_EXPIRY_AGE_MS && expiryAgeMs <= MAX_EXPIRY_AGE_MS;
    });
    if (eligibleProducts.length === 0) {
      const result = unavailable(options.pair, `Delta India has no operational ${asset} options contracts in the accepted expiry window.`);
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
    }

    const productById = new Map(eligibleProducts.map((product) => [product.id, product]));
    const tickerMap = new Map<number, DeltaOptionTicker>();
    for (const candidate of tickersPayload.result) {
      if (!isTicker(candidate, asset) || !productById.has(candidate.product_id)) continue;
      if (tickerMap.has(candidate.product_id)) {
        throw new Error(`Delta India returned duplicate option ticker for product ${candidate.product_id}.`);
      }
      tickerMap.set(candidate.product_id, candidate);
    }

    const relevantProducts = eligibleProducts.filter((product) => {
      const ticker = tickerMap.get(product.id);
      const strikePrice = ticker ? toPositiveNumber(ticker.strike_price) : null;
      const underlyingPrice = ticker ? toPositiveNumber(ticker.spot_price) : null;
      return strikePrice !== null &&
        underlyingPrice !== null &&
        Math.abs(strikePrice - underlyingPrice) / underlyingPrice <= MAX_MONEYNESS_DEVIATION;
    });
    if (relevantProducts.length === 0) {
      const result = unavailable(options.pair, `Delta India has no complete timestamped ${asset} option tickers with strikes within 75%-125% of spot in the accepted expiry window.`);
      cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
      return result;
    }

    const contracts = relevantProducts.flatMap((product) => {
      const ticker = tickerMap.get(product.id);
      if (!ticker) return [];
      const parsed = parseContract(product, ticker, evaluatedAtMs);
      return parsed ? [parsed] : [];
    });
    const calls = contracts.filter(({ side }) => side === 'call');
    const puts = contracts.filter(({ side }) => side === 'put');
    const callOpenInterest = calls.reduce((sum, contract) => sum + contract.openInterestUsd, 0);
    const putOpenInterest = puts.reduce((sum, contract) => sum + contract.openInterestUsd, 0);
    if (
      contracts.length < MIN_LIQUID_CONTRACTS ||
      calls.length < 4 ||
      puts.length < 4 ||
      callOpenInterest <= 0 ||
      putOpenInterest <= 0
    ) {
      throw new Error(
        `Delta India returned ${contracts.length} fresh liquid ${asset} options (${calls.length} calls/${puts.length} puts); at least 20 total, four each side and positive USD OI are required.`,
      );
    }

    const bookSamples = [
      ...[...calls].sort((left, right) =>
        Math.abs(left.strikePrice - left.underlyingPrice) - Math.abs(right.strikePrice - right.underlyingPrice)
      ).slice(0, 4),
      ...[...puts].sort((left, right) =>
        Math.abs(left.strikePrice - left.underlyingPrice) - Math.abs(right.strikePrice - right.underlyingPrice)
      ).slice(0, 4),
    ];
    const sampledBooks = await Promise.all(bookSamples.map((contract) =>
      validateOrderBook(fetcher, contract)
    ));
    const validBookSamples = sampledBooks.filter(
      (sample): sample is NonNullable<typeof sample> => sample !== null,
    );
    if (validBookSamples.length !== 8) {
      throw new Error(
        `Delta India returned only ${validBookSamples.length}/8 fresh two-sided order books (four calls and four puts required).`,
      );
    }

    const totalOpenInterest = callOpenInterest + putOpenInterest;
    const weightedIv = contracts.reduce(
      (sum, contract) => sum + contract.impliedVolatilityPct * contract.openInterestUsd,
      0,
    ) / totalOpenInterest;
    const weightedIvForSide = (side: ParsedContract['side']) => {
      const sideContracts = contracts.filter((contract) => contract.side === side);
      const sideOpenInterest = side === 'call' ? callOpenInterest : putOpenInterest;
      return sideContracts.reduce(
        (sum, contract) => sum + contract.impliedVolatilityPct * contract.openInterestUsd,
        0,
      ) / sideOpenInterest;
    };
    const nearestAtm = [...contracts].sort((left, right) =>
      Math.abs(left.strikePrice - left.underlyingPrice) / left.underlyingPrice -
      Math.abs(right.strikePrice - right.underlyingPrice) / right.underlyingPrice
    )[0];
    const timestampMs = Math.min(
      ...contracts.map(({ timestampMs: sourceTimestampMs }) => sourceTimestampMs),
      ...validBookSamples.map(({ timestampMs: bookTimestampMs }) => bookTimestampMs),
    );
    const retrievedAtMs = Math.max(
      productsResponse.receivedAtMs,
      tickersResponse.receivedAtMs,
      Date.now(),
    );
    const ageMs = retrievedAtMs - timestampMs;
    if (ageMs < 0 || ageMs > MAX_SOURCE_AGE_MS) {
      throw new Error('Delta India option ticker or order-book timestamps are stale or future-dated.');
    }
    const result: CouncilOptionsData = {
      pair: options.pair,
      asset,
      status: 'LIVE',
      timestampMs,
      retrievedAtMs,
      ageMs,
      qualityPct: Math.round(contracts.length / relevantProducts.length * 100),
      impliedVolatilityPct: weightedIv,
      putCallRatio: putOpenInterest / callOpenInterest,
      expiryTimestampMs: nearestAtm.expiryTimestampMs,
      strikePrice: nearestAtm.strikePrice,
      skewPct: weightedIvForSide('put') - weightedIvForSide('call'),
      provider: 'Delta Exchange India public options API',
      contractsCount: contracts.length,
      callContractsCount: calls.length,
      putContractsCount: puts.length,
      bidAskValidatedContracts: contracts.length,
      bidAskSizeValidatedContracts: validBookSamples.length,
      medianBidAskSpreadPct: median([
        ...contracts.map(({ bidAskSpreadPct }) => bidAskSpreadPct),
        ...validBookSamples.map(({ spreadPct }) => spreadPct),
      ]),
      volume24h: contracts.reduce((sum, contract) => sum + contract.turnoverUsd, 0),
      volumeUnit: 'USD turnover (Delta turnover_usd)',
      openInterestUnit: 'USD notional (Delta oi_value_usd; contract units checked)',
      callOpenInterest,
      putOpenInterest,
      underlyingPrice: nearestAtm.underlyingPrice,
    };
    cachedResults.set(options.pair, { cachedAtMs: nowMs, result });
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[DeltaOptionsData] Public options source unavailable:', reason);
    return unavailable(options.pair, reason);
  }
}

export function resetDeltaOptionsDataCacheForTests(): void {
  cachedResults.clear();
}
