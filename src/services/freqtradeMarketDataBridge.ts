import { deduplicateTrades } from './councilEvidenceDeduplication';

export const FREQTRADE_MARKET_SNAPSHOT_VERSION = 'sbk1.freqtrade.market-snapshot.v5';
export const FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS = 15_000;
export const FREQTRADE_MARKET_SNAPSHOT_MAX_CANDLES = 1_500;
export const FREQTRADE_TICKER_MAX_AGE_MS = 5_000;
export const FREQTRADE_TRADE_FLOW_MAX_AGE_MS = 5_000;
export const FREQTRADE_OPEN_INTEREST_MAX_AGE_MS = 10 * 60_000;

export interface FreqtradeMarketCandle {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FreqtradeMarketTicker {
  exchangeTimestampMs: number | null;
  retrievedAtMs: number;
  last: number;
  bid: number | null;
  ask: number | null;
  markPrice: number | null;
  indexPrice: number | null;
}

export interface FreqtradeMarketFundingRate {
  retrievedAtMs: number;
  rate: number;
  nextFundingAtMs: number | null;
}

export interface FreqtradeMarketOrderBook {
  timestampMs: number;
  venue?: string;
  symbol?: string;
  sequenceId?: number;
  duplicateSnapshotCount?: number;
  bids: Array<{ price: number; amount: number }>;
  asks: Array<{ price: number; amount: number }>;
}

export interface FreqtradeMarketTrade {
  timestampMs: number;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  venue?: string;
  symbol?: string;
  tradeId?: string | number;
  exchangeEventId?: string | number;
}

export interface FreqtradeMarketTradeFlow {
  retrievedAtMs: number;
  duplicateCount?: number;
  trades: FreqtradeMarketTrade[];
}

export interface FreqtradeMarketOpenInterest {
  retrievedAtMs: number;
  latestTimestampMs: number;
  previousTimestampMs: number;
  latestAmount: number;
  previousAmount: number;
}

export interface FreqtradeMarketSnapshot {
  contractVersion: typeof FREQTRADE_MARKET_SNAPSHOT_VERSION;
  source: 'freqtrade.dataprovider';
  exchange: string;
  market: 'spot' | 'futures';
  pair: string;
  timeframe: string;
  generatedAtMs: number;
  candles: FreqtradeMarketCandle[];
  additionalCandles: Record<string, FreqtradeMarketCandle[] | null>;
  ticker: FreqtradeMarketTicker | null;
  orderBook: FreqtradeMarketOrderBook | null;
  fundingRate: FreqtradeMarketFundingRate | null;
  openInterest: FreqtradeMarketOpenInterest | null;
  tradeFlow: FreqtradeMarketTradeFlow | null;
}

export interface FreqtradeMarketSnapshotExpectation {
  exchange: string;
  market: 'spot' | 'futures';
  pair: string;
  timeframe: string;
}

export class FreqtradeMarketSnapshotValidationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'FreqtradeMarketSnapshotValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function timeframeToMs(timeframe: string): number {
  const match = /^(\d+)([mhdw])$/.exec(timeframe);
  if (!match) return 0;
  const quantity = Number(match[1]);
  const unitMs: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  const duration = quantity * unitMs[match[2]];
  return Number.isSafeInteger(duration) ? duration : 0;
}

function validateCandleCadence(value: FreqtradeMarketCandle[], timeframe: string): boolean {
  const timeframeMs = timeframeToMs(timeframe);
  return value.every((candle, index) =>
    index === 0 || candle.timestampMs - value[index - 1].timestampMs === timeframeMs
  );
}

function validateCandle(value: unknown): value is FreqtradeMarketCandle {
  if (!isRecord(value)) return false;
  return isTimestamp(value.timestampMs) &&
    isPositive(value.open) &&
    isPositive(value.high) &&
    isPositive(value.low) &&
    isPositive(value.close) &&
    typeof value.volume === 'number' &&
    Number.isFinite(value.volume) &&
    value.volume >= 0 &&
    value.high >= Math.max(value.open, value.close, value.low) &&
    value.low <= Math.min(value.open, value.close, value.high);
}

function validateCandles(
  value: unknown,
  timeframe: string,
  generatedAtMs: number,
): value is FreqtradeMarketCandle[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > FREQTRADE_MARKET_SNAPSHOT_MAX_CANDLES
  ) return false;
  const timeframeMs = timeframeToMs(timeframe);
  if (timeframeMs <= 0) return false;
  let previousTimestampMs = 0;
  for (const candle of value) {
    if (
      !validateCandle(candle) ||
      candle.timestampMs <= previousTimestampMs ||
      candle.timestampMs + timeframeMs > generatedAtMs + 1_000
    ) return false;
    previousTimestampMs = candle.timestampMs;
  }
  if (!validateCandleCadence(value, timeframe)) return false;
  const latestCandleCloseMs = previousTimestampMs + timeframeMs;
  return generatedAtMs - latestCandleCloseMs <= timeframeMs * 2 + 60_000;
}

function validateTradeFlowShape(value: unknown, generatedAtMs: number, nowMs: number): value is FreqtradeMarketTradeFlow | null {
  if (value === null) return true;
  if (!isRecord(value) || !isTimestamp(value.retrievedAtMs) ||
    value.retrievedAtMs > nowMs + 1_000 || value.retrievedAtMs > generatedAtMs + 1_000 ||
    (value.duplicateCount !== undefined &&
      (typeof value.duplicateCount !== 'number' ||
        !Number.isSafeInteger(value.duplicateCount) || value.duplicateCount < 0)) ||
    !Array.isArray(value.trades) || value.trades.length === 0 || value.trades.length > 200) return false;
  let previousTimestampMs = 0;
  for (const trade of value.trades) {
    if (
      !isRecord(trade) ||
      !isTimestamp(trade.timestampMs) ||
      trade.timestampMs < previousTimestampMs ||
      trade.timestampMs > value.retrievedAtMs + 1_000 ||
      (trade.side !== 'buy' && trade.side !== 'sell') ||
      (trade.venue !== undefined && (typeof trade.venue !== 'string' || trade.venue.trim().length === 0)) ||
      (trade.symbol !== undefined && (typeof trade.symbol !== 'string' || trade.symbol.trim().length === 0)) ||
      (trade.tradeId !== undefined && !(
        (typeof trade.tradeId === 'string' && trade.tradeId.trim().length > 0) ||
        (typeof trade.tradeId === 'number' && Number.isSafeInteger(trade.tradeId))
      )) ||
      (trade.exchangeEventId !== undefined && !(
        (typeof trade.exchangeEventId === 'string' && trade.exchangeEventId.trim().length > 0) ||
        (typeof trade.exchangeEventId === 'number' && Number.isSafeInteger(trade.exchangeEventId))
      )) ||
      !isPositive(trade.price) ||
      !isPositive(trade.amount)
    ) return false;
    previousTimestampMs = trade.timestampMs;
  }
  return true;
}

function validateTickerShape(value: unknown): value is FreqtradeMarketTicker | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const rawExchangeTimestampMs = value.exchangeTimestampMs;
  const exchangeTimestampMs = typeof rawExchangeTimestampMs === 'number' ? rawExchangeTimestampMs : null;
  const retrievedAtMs = typeof value.retrievedAtMs === 'number' ? value.retrievedAtMs : Number.NaN;
  if (
    (rawExchangeTimestampMs !== null && exchangeTimestampMs === null) ||
    !isTimestamp(retrievedAtMs) ||
    (exchangeTimestampMs !== null && !isTimestamp(exchangeTimestampMs))
  ) return false;
  if (!isPositive(value.last)) return false;
  if (value.bid !== null && !isPositive(value.bid)) return false;
  if (value.ask !== null && !isPositive(value.ask)) return false;
  if (value.markPrice !== null && !isPositive(value.markPrice)) return false;
  if (value.indexPrice !== null && !isPositive(value.indexPrice)) return false;
  if (value.bid !== null && value.ask !== null && value.bid >= value.ask) return false;
  return exchangeTimestampMs === null || exchangeTimestampMs <= retrievedAtMs + 1_000;
}

function validateLevels(value: unknown, descending: boolean): value is Array<{ price: number; amount: number }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return false;
  let previousPrice: number | undefined;
  for (const level of value) {
    if (!isRecord(level) || !isPositive(level.price) || !isPositive(level.amount)) return false;
    if (
      previousPrice !== undefined &&
      (descending ? level.price > previousPrice : level.price < previousPrice)
    ) return false;
    previousPrice = level.price;
  }
  return true;
}

function validateOrderBookShape(value: unknown, nowMs: number): value is FreqtradeMarketOrderBook | null {
  if (value === null) return true;
  if (
    !isRecord(value) ||
    !isTimestamp(value.timestampMs) ||
    value.timestampMs > nowMs + 1_000 ||
    (value.venue !== undefined && typeof value.venue !== 'string') ||
    (value.symbol !== undefined && typeof value.symbol !== 'string') ||
    (value.sequenceId !== undefined && !Number.isSafeInteger(value.sequenceId)) ||
    (value.duplicateSnapshotCount !== undefined &&
      (typeof value.duplicateSnapshotCount !== 'number' ||
        !Number.isSafeInteger(value.duplicateSnapshotCount) || value.duplicateSnapshotCount < 0)) ||
    !validateLevels(value.bids, true) ||
    !validateLevels(value.asks, false)
  ) return false;
  const bestBid = value.bids[0].price;
  const bestAsk = value.asks[0].price;
  return bestBid < bestAsk;
}

function validateFundingRateShape(value: unknown): value is FreqtradeMarketFundingRate | null {
  if (value === null) return true;
  return isRecord(value) &&
    isTimestamp(value.retrievedAtMs) &&
    typeof value.rate === 'number' &&
    Number.isFinite(value.rate) &&
    (value.nextFundingAtMs === null || isTimestamp(value.nextFundingAtMs));
}

function validateOpenInterestShape(
  value: unknown,
  generatedAtMs: number,
  nowMs: number,
): value is FreqtradeMarketOpenInterest | null {
  if (value === null) return true;
  return isRecord(value) &&
    isTimestamp(value.retrievedAtMs) &&
    isTimestamp(value.latestTimestampMs) &&
    isTimestamp(value.previousTimestampMs) &&
    isPositive(value.latestAmount) &&
    isPositive(value.previousAmount) &&
    value.latestTimestampMs - value.previousTimestampMs === 5 * 60_000 &&
    value.latestTimestampMs <= value.retrievedAtMs + 1_000 &&
    value.retrievedAtMs <= generatedAtMs + 1_000 &&
    value.retrievedAtMs <= nowMs + 1_000;
}

export function validateFreqtradeMarketSnapshot(
  value: unknown,
  expected: FreqtradeMarketSnapshotExpectation,
  nowMs = Date.now(),
): FreqtradeMarketSnapshot {
  if (!isRecord(value)) {
    throw new FreqtradeMarketSnapshotValidationError('Snapshot payload must be an object.', 'INVALID_SNAPSHOT');
  }
  if (value.contractVersion !== FREQTRADE_MARKET_SNAPSHOT_VERSION) {
    throw new FreqtradeMarketSnapshotValidationError('Unsupported market snapshot contract.', 'UNSUPPORTED_CONTRACT_VERSION');
  }
  if (
    value.source !== 'freqtrade.dataprovider' ||
    typeof value.exchange !== 'string' ||
    value.exchange.toLowerCase() !== expected.exchange.toLowerCase()
  ) {
    throw new FreqtradeMarketSnapshotValidationError('Snapshot source or exchange does not match the configured Freqtrade instance.', 'EXCHANGE_MISMATCH');
  }
  if (
    value.market !== expected.market ||
    value.pair !== expected.pair ||
    value.timeframe !== expected.timeframe
  ) {
    throw new FreqtradeMarketSnapshotValidationError('Snapshot market, pair, or timeframe does not match the configured Freqtrade instance.', 'MARKET_CONFIGURATION_MISMATCH');
  }
  if (
    typeof value.pair !== 'string' ||
    !/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}(?::[A-Z0-9]{2,20})?$/.test(value.pair) ||
    typeof value.timeframe !== 'string' ||
    timeframeToMs(value.timeframe) <= 0
  ) {
    throw new FreqtradeMarketSnapshotValidationError('Snapshot pair or timeframe is invalid.', 'INVALID_MARKET_CONFIGURATION');
  }
  if (
    !isTimestamp(value.generatedAtMs) ||
    value.generatedAtMs > nowMs + 1_000 ||
    nowMs - value.generatedAtMs > FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS
  ) {
    throw new FreqtradeMarketSnapshotValidationError('Snapshot is future-dated or stale.', 'STALE_SNAPSHOT');
  }
  const timeframeMs = timeframeToMs(value.timeframe);
  if (
    !validateCandles(value.candles, value.timeframe, value.generatedAtMs)
  ) {
    throw new FreqtradeMarketSnapshotValidationError('Snapshot candles are missing or invalid.', 'INVALID_CANDLES');
  }
  const candles: FreqtradeMarketCandle[] = [];
  for (const candidate of value.candles) {
    const previous = candles[candles.length - 1];
    if (previous && candidate.timestampMs <= previous.timestampMs) {
      throw new FreqtradeMarketSnapshotValidationError('Snapshot candles must be strictly time-ordered.', 'INVALID_CANDLE_ORDER');
    }
    candles.push({ ...candidate });
  }
  if (!isRecord(value.additionalCandles)) {
    throw new FreqtradeMarketSnapshotValidationError('Additional timeframe candles are invalid.', 'INVALID_CANDLES');
  }
  const additionalCandles: Record<string, FreqtradeMarketCandle[] | null> = {};
  for (const [timeframe, candidateCandles] of Object.entries(value.additionalCandles)) {
    if (!['1m', '5m', '1h', '4h'].includes(timeframe)) {
      throw new FreqtradeMarketSnapshotValidationError('Unsupported informative timeframe in snapshot.', 'INVALID_TIMEFRAME');
    }
    if (candidateCandles === null) {
      additionalCandles[timeframe] = null;
      continue;
    }
    if (!validateCandles(candidateCandles, timeframe, value.generatedAtMs)) {
      additionalCandles[timeframe] = null;
      continue;
    }
    additionalCandles[timeframe] = candidateCandles.map((candle) => ({ ...candle }));
  }
  let ticker: FreqtradeMarketTicker | null = validateTickerShape(value.ticker)
    ? value.ticker
    : null;
  if (
    isRecord(ticker) &&
    (ticker.retrievedAtMs > nowMs + 1_000 || ticker.retrievedAtMs > value.generatedAtMs + 1_000)
  ) {
    ticker = null;
  }
  const verifiedTicker = ticker !== null &&
    nowMs - ticker.retrievedAtMs <= FREQTRADE_TICKER_MAX_AGE_MS &&
    (ticker.exchangeTimestampMs === null ||
      ticker.retrievedAtMs - ticker.exchangeTimestampMs <= FREQTRADE_TICKER_MAX_AGE_MS)
    ? ticker
    : null;
  let orderBook: FreqtradeMarketOrderBook | null = validateOrderBookShape(value.orderBook, nowMs)
    ? value.orderBook
    : null;
  if (orderBook && (
    (orderBook.venue !== undefined && orderBook.venue.toLowerCase() !== expected.exchange.toLowerCase()) ||
    (orderBook.symbol !== undefined && orderBook.symbol.toLowerCase() !== expected.pair.toLowerCase())
  )) {
    orderBook = null;
  }
  if (orderBook && orderBook.timestampMs > value.generatedAtMs + 1_000) {
    orderBook = null;
  }
  const verifiedOrderBook = orderBook !== null && nowMs - orderBook.timestampMs <= 10_000
    ? orderBook
    : null;
  let fundingRate: FreqtradeMarketFundingRate | null = validateFundingRateShape(value.fundingRate)
    ? value.fundingRate
    : null;
  if (
    fundingRate &&
    (fundingRate.retrievedAtMs > nowMs + 1_000 ||
      fundingRate.retrievedAtMs > value.generatedAtMs + 1_000)
  ) {
    fundingRate = null;
  }
  const verifiedFundingRate = fundingRate !== null &&
    nowMs - fundingRate.retrievedAtMs <= FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS
    ? fundingRate
    : null;
  let openInterest: FreqtradeMarketOpenInterest | null = validateOpenInterestShape(
    value.openInterest,
    value.generatedAtMs,
    nowMs,
  )
    ? value.openInterest
    : null;
  if (
    openInterest &&
    (openInterest.retrievedAtMs > nowMs + 1_000 ||
      openInterest.retrievedAtMs > value.generatedAtMs + 1_000 ||
      openInterest.latestTimestampMs > nowMs + 1_000 ||
      openInterest.previousTimestampMs > nowMs + 1_000)
  ) {
    openInterest = null;
  }
  const verifiedOpenInterest = openInterest !== null &&
    nowMs - openInterest.latestTimestampMs >= 0 &&
    nowMs - openInterest.latestTimestampMs <= FREQTRADE_OPEN_INTEREST_MAX_AGE_MS
    ? openInterest
    : null;
  let tradeFlow: FreqtradeMarketTradeFlow | null = validateTradeFlowShape(
    value.tradeFlow,
    value.generatedAtMs,
    nowMs,
  )
    ? value.tradeFlow
    : null;
  if (tradeFlow && tradeFlow.trades.some((trade) =>
    (trade.venue !== undefined && trade.venue.toLowerCase() !== expected.exchange.toLowerCase()) ||
    (trade.symbol !== undefined && trade.symbol.toLowerCase() !== expected.pair.toLowerCase())
  )) {
    tradeFlow = null;
  }
  const verifiedTradeFlow = tradeFlow !== null &&
    nowMs - tradeFlow.retrievedAtMs <= FREQTRADE_TRADE_FLOW_MAX_AGE_MS &&
    tradeFlow.trades.every((trade) => nowMs - trade.timestampMs <= FREQTRADE_TRADE_FLOW_MAX_AGE_MS)
    ? tradeFlow
    : null;
  const deduplicatedTradeFlow = verifiedTradeFlow
    ? deduplicateTrades(verifiedTradeFlow.trades.map((trade) => ({
      ...trade,
      venue: trade.venue ?? expected.exchange,
      symbol: trade.symbol ?? expected.pair,
    })))
    : null;
  const usableTradeFlow = deduplicatedTradeFlow && !deduplicatedTradeFlow.conflictingIdentity
    ? deduplicatedTradeFlow
    : null;
  return {
    contractVersion: FREQTRADE_MARKET_SNAPSHOT_VERSION,
    source: 'freqtrade.dataprovider',
    exchange: value.exchange,
    market: expected.market,
    pair: expected.pair,
    timeframe: expected.timeframe,
    generatedAtMs: value.generatedAtMs,
    candles,
    additionalCandles,
    ticker: verifiedTicker && { ...verifiedTicker },
    orderBook: verifiedOrderBook && {
      timestampMs: verifiedOrderBook.timestampMs,
      venue: verifiedOrderBook.venue ?? expected.exchange,
      symbol: verifiedOrderBook.symbol ?? expected.pair,
      ...(verifiedOrderBook.sequenceId === undefined ? {} : { sequenceId: verifiedOrderBook.sequenceId }),
      ...(verifiedOrderBook.duplicateSnapshotCount === undefined
        ? {}
        : { duplicateSnapshotCount: verifiedOrderBook.duplicateSnapshotCount }),
      bids: verifiedOrderBook.bids.map((level) => ({ ...level })),
      asks: verifiedOrderBook.asks.map((level) => ({ ...level })),
    },
    fundingRate: verifiedFundingRate && { ...verifiedFundingRate },
    openInterest: verifiedOpenInterest && { ...verifiedOpenInterest },
    tradeFlow: verifiedTradeFlow && usableTradeFlow && {
      retrievedAtMs: verifiedTradeFlow.retrievedAtMs,
      duplicateCount: (verifiedTradeFlow.duplicateCount ?? 0) + usableTradeFlow.duplicateCount,
      trades: usableTradeFlow.values.map((trade) => ({ ...trade })),
    },
  };
}

export class FreqtradeMarketDataBridge {
  private readonly latestByMarket = new Map<string, FreqtradeMarketSnapshot>();
  private readonly snapshotListeners = new Set<(snapshot: FreqtradeMarketSnapshot) => void>();

  subscribe(listener: (snapshot: FreqtradeMarketSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  accept(
    value: unknown,
    expected: FreqtradeMarketSnapshotExpectation,
    nowMs = Date.now(),
  ): FreqtradeMarketSnapshot {
    const snapshot = validateFreqtradeMarketSnapshot(value, expected, nowMs);
    const key = this.key(expected);
    const previous = this.latestByMarket.get(key);
    if (previous && snapshot.generatedAtMs <= previous.generatedAtMs) {
      throw new FreqtradeMarketSnapshotValidationError('Snapshot timestamp did not advance.', 'OUT_OF_ORDER_SNAPSHOT');
    }
    this.latestByMarket.set(key, snapshot);
    for (const listener of this.snapshotListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('[FreqtradeMarketDataBridge] Snapshot subscriber failed:', error);
      }
    }
    return snapshot;
  }

  getLatest(
    expected: FreqtradeMarketSnapshotExpectation,
    nowMs = Date.now(),
  ): FreqtradeMarketSnapshot {
    const snapshot = this.latestByMarket.get(this.key(expected));
    if (!snapshot || nowMs - snapshot.generatedAtMs > FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS) {
      throw new FreqtradeMarketSnapshotValidationError('No fresh Freqtrade market snapshot is available.', 'MARKET_SNAPSHOT_UNAVAILABLE');
    }
    return snapshot;
  }

  getLatestConfigured(
    configuration: { exchange: string; pair: string; timeframe: string },
    nowMs = Date.now(),
  ): FreqtradeMarketSnapshot {
    const matching = [...this.latestByMarket.values()].filter((snapshot) =>
      snapshot.exchange.toLowerCase() === configuration.exchange.toLowerCase() &&
      snapshot.pair === configuration.pair &&
      snapshot.timeframe === configuration.timeframe &&
      nowMs - snapshot.generatedAtMs <= FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS
    );
    if (matching.length !== 1) {
      throw new FreqtradeMarketSnapshotValidationError(
        matching.length === 0
          ? 'No fresh Freqtrade market snapshot is available.'
          : 'Multiple market types are available; the configured market must be selected explicitly.',
        matching.length === 0 ? 'MARKET_SNAPSHOT_UNAVAILABLE' : 'AMBIGUOUS_MARKET_SNAPSHOT',
      );
    }
    return matching[0];
  }

  private key(expected: FreqtradeMarketSnapshotExpectation): string {
    return [expected.exchange.toLowerCase(), expected.market, expected.pair, expected.timeframe].join('|');
  }
}

export const freqtradeMarketDataBridge = new FreqtradeMarketDataBridge();
