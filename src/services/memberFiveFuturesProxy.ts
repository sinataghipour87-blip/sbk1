import WebSocket from 'ws';

export type MemberFiveProxyVenue = 'binance' | 'bybit' | 'okx' | 'kucoin' | 'gateio';
export const MEMBER_FIVE_PROXY_QUORUM = 3;
export const MEMBER_FIVE_PROXY_CACHE_TTL_MS = 30_000;
export type MemberFiveProxyCacheStatus = 'FRESH' | 'CACHED_OK' | 'EXPIRED' | 'UNAVAILABLE';

export interface MemberFiveProxyMetrics {
  healthStatus: 'HEALTHY';
  cacheStatus?: MemberFiveProxyCacheStatus;
  cacheAgeMs?: number;
  cacheReceivedAtMs?: number;
  cacheFallbackReason?: string;
  timestampMs: number;
  fundingTimestampMs: number;
  positioningTimestampMs: number;
  priceTimestampMs: number;
  fundingRate: number;
  fundingBaselineRate: number;
  fundingDeviation: number;
  longShortRatio: number;
  openInterestChangePct: number;
  priceReturnPct: number;
  realizedVolatilityPct: number;
  liquidationLongNotional: number | null;
  liquidationShortNotional: number | null;
  liquidationTimestampMs: number | null;
  liquidationEventCount: number;
  liquidationFeedStatus: 'LIVE' | 'NO_EVENTS' | 'UNAVAILABLE';
  directionScore: number;
  longShortRatioMethod:
    | 'TOP_TRADER_POSITION'
    | 'ACCOUNT_LONG_SHORT'
    | 'TAKER_TRADE_VOLUME';
}

export interface MemberFiveProxyDegraded {
  healthStatus: 'DEGRADED' | 'FAILED';
  detail: string;
  normalizedData: Readonly<Record<string, number | string | null>>;
}

export type MemberFiveProxyResult = MemberFiveProxyMetrics | MemberFiveProxyDegraded | null;

export interface MemberFiveProxyAggregate {
  sourceCount: number;
  sourceIds: readonly string[];
  fundingRate: number;
  fundingBaselineRate: number;
  fundingDeviation: number;
  longShortRatio: number;
  openInterestChangePct: number;
  priceReturnPct: number;
  realizedVolatilityPct: number;
  liquidationImbalance: number | null;
  liquidationSourceCount: number;
  directionScore: number;
}

export interface MemberFiveProxyAggregateInput {
  sourceId: string;
  fundingRate: number;
  fundingBaselineRate: number;
  longShortRatio: number;
  openInterestChangePct: number;
  priceReturnPct: number;
  realizedVolatilityPct: number;
  liquidationLongNotional: number | null;
  liquidationShortNotional: number | null;
  liquidationEventCount: number;
  liquidationFeedStatus: 'LIVE' | 'NO_EVENTS' | 'UNAVAILABLE';
}

interface Candle {
  timestampMs: number;
  close: number;
}

interface TimedValue {
  value: number;
  timestampMs: number;
}

interface LiquidationSnapshot {
  longNotional: number | null;
  shortNotional: number | null;
  timestampMs: number | null;
  eventCount: number;
  feedStatus: 'LIVE' | 'NO_EVENTS' | 'UNAVAILABLE';
}

const POSITIONING_MAX_AGE_MS = 6 * 60_000;
const LIVE_MAX_AGE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const LIQUIDATION_WINDOW_MS = 1_500;
const KUCOIN_OI_SAMPLES = new Map<string, TimedValue>();
const proxySnapshotCache = new Map<string, {
  receivedAtMs: number;
  metrics: MemberFiveProxyMetrics;
}>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function timestampValue(value: unknown): number | null {
  const parsed = numberValue(value);
  if (parsed === null || parsed <= 0) return null;
  return parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isFresh(timestampMs: number, nowMs: number, maxAgeMs: number): boolean {
  return timestampMs <= nowMs + 1_000 && nowMs - timestampMs <= maxAgeMs;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function calculateMemberFiveProxyScore(input: {
  fundingRate: number;
  fundingDeviation: number;
  longShortRatio: number;
  openInterestChangePct: number;
  priceReturnPct: number;
  liquidationImbalance: number | null;
}): number | null {
  const {
    fundingRate,
    fundingDeviation,
    longShortRatio,
    openInterestChangePct,
    priceReturnPct,
    liquidationImbalance,
  } = input;
  if (
    !Number.isFinite(fundingRate) ||
    !Number.isFinite(fundingDeviation) ||
    !Number.isFinite(longShortRatio) ||
    longShortRatio <= 0 ||
    !Number.isFinite(openInterestChangePct) ||
    !Number.isFinite(priceReturnPct) ||
    (liquidationImbalance !== null && !Number.isFinite(liquidationImbalance))
  ) return null;

  const positioningCrowding = clamp((1 - longShortRatio) / (1 + longShortRatio), -1, 1);
  const fundingCrowding =
    clamp(-fundingRate / 0.0005, -1, 1) * 0.3 +
    clamp(-fundingDeviation / 0.0001, -1, 1) * 0.7;
  const priceMomentum = clamp(priceReturnPct / 0.5, -1, 1);
  const openInterestConfirmation =
    clamp(openInterestChangePct / 1, -1, 1) * Math.sign(priceReturnPct);
  const coreScore =
    positioningCrowding * 0.3 +
    fundingCrowding * 0.25 +
    priceMomentum * 0.3 +
    openInterestConfirmation * 0.15;
  const score = liquidationImbalance === null
    ? coreScore
    : coreScore * 0.85 + clamp(liquidationImbalance, -1, 1) * 0.15;
  return Number(score.toFixed(6));
}

export function aggregateMemberFiveProxyMetrics(
  signals: readonly MemberFiveProxyAggregateInput[],
): MemberFiveProxyAggregate | null {
  if (signals.length < MEMBER_FIVE_PROXY_QUORUM) return null;
  const fundingRate = median(signals.map(({ fundingRate }) => fundingRate));
  const fundingBaselineRate = median(signals.map(({ fundingBaselineRate }) => fundingBaselineRate));
  const longShortRatio = median(signals.map(({ longShortRatio }) => longShortRatio));
  const openInterestChangePct = median(signals.map(({ openInterestChangePct }) => openInterestChangePct));
  const priceReturnPct = median(signals.map(({ priceReturnPct }) => priceReturnPct));
  const realizedVolatilityPct = median(signals.map(({ realizedVolatilityPct }) => realizedVolatilityPct));
  if (
    fundingRate === null ||
    fundingBaselineRate === null ||
    longShortRatio === null ||
    longShortRatio <= 0 ||
    openInterestChangePct === null ||
    priceReturnPct === null ||
    realizedVolatilityPct === null
  ) return null;
  const fundingDeviation = fundingRate - fundingBaselineRate;
  const liquidationImbalances = signals.flatMap((signal) => {
    if (
      signal.liquidationFeedStatus !== 'LIVE' ||
      signal.liquidationEventCount < 1 ||
      signal.liquidationLongNotional === null ||
      signal.liquidationShortNotional === null
    ) return [];
    const total = signal.liquidationLongNotional + signal.liquidationShortNotional;
    return total > 0
      ? [(signal.liquidationShortNotional - signal.liquidationLongNotional) / total]
      : [];
  });
  const liquidationImbalance = liquidationImbalances.length >= 2
    ? median(liquidationImbalances)
    : null;
  const directionScore = calculateMemberFiveProxyScore({
    fundingRate,
    fundingDeviation,
    longShortRatio,
    openInterestChangePct,
    priceReturnPct,
    liquidationImbalance,
  });
  if (directionScore === null) return null;
  return {
    sourceCount: signals.length,
    sourceIds: signals.map(({ sourceId }) => sourceId),
    fundingRate: Number(fundingRate.toFixed(12)),
    fundingBaselineRate: Number(fundingBaselineRate.toFixed(12)),
    fundingDeviation: Number(fundingDeviation.toFixed(12)),
    longShortRatio: Number(longShortRatio.toFixed(8)),
    openInterestChangePct: Number(openInterestChangePct.toFixed(6)),
    priceReturnPct: Number(priceReturnPct.toFixed(6)),
    realizedVolatilityPct: Number(realizedVolatilityPct.toFixed(6)),
    liquidationImbalance: liquidationImbalance === null
      ? null
      : Number(liquidationImbalance.toFixed(6)),
    liquidationSourceCount: liquidationImbalances.length,
    directionScore,
  };
}

function liquidationSnapshot(
  venue: MemberFiveProxyVenue,
  symbol: string,
): Promise<LiquidationSnapshot> {
  return new Promise((resolve) => {
    const snapshot: LiquidationSnapshot = {
      longNotional: 0,
      shortNotional: 0,
      timestampMs: null,
      eventCount: 0,
      feedStatus: 'UNAVAILABLE',
    };
    let settled = false;
    let opened = false;
    if (venue !== 'binance' && venue !== 'bybit') {
      resolve(snapshot);
      return;
    }
    const socket = new WebSocket(
      venue === 'binance'
        ? `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@forceOrder`
        : venue === 'bybit'
          ? 'wss://stream.bybit.com/v5/public/linear'
          : '',
      { handshakeTimeout: 1_000 },
    );
    const timer = setTimeout(() => finish(), LIQUIDATION_WINDOW_MS);
    timer.unref();
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      snapshot.feedStatus = snapshot.eventCount > 0
        ? 'LIVE'
        : opened ? 'NO_EVENTS' : 'UNAVAILABLE';
      if (snapshot.eventCount === 0) {
        snapshot.longNotional = null;
        snapshot.shortNotional = null;
      }
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, 'Liquidation sample window complete.');
      }
      resolve(snapshot);
    };
    socket.on('open', () => {
      opened = true;
      if (venue === 'bybit') {
        socket.send(JSON.stringify({
          op: 'subscribe',
          args: [`allLiquidation.${symbol}`],
        }));
      }
    });
    socket.on('message', (raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString()) as unknown;
      } catch {
        return;
      }
      if (!isRecord(payload)) return;
      if (venue === 'binance') {
        const order = isRecord(payload.o) ? payload.o : null;
        if (!order || order.s !== symbol) return;
        const price = positiveNumber(order.ap ?? order.p);
        const quantity = positiveNumber(order.q);
        const timestampMs = timestampValue(order.T ?? payload.T);
        if (price === null || quantity === null || timestampMs === null) return;
        const notional = price * quantity;
        if (order.S === 'SELL') snapshot.longNotional = (snapshot.longNotional ?? 0) + notional;
        else if (order.S === 'BUY') snapshot.shortNotional = (snapshot.shortNotional ?? 0) + notional;
        else return;
        snapshot.eventCount += 1;
        snapshot.timestampMs = Math.max(snapshot.timestampMs ?? 0, timestampMs);
      } else if (venue === 'bybit' && payload.topic === `allLiquidation.${symbol}`) {
        const rows = Array.isArray(payload.data) ? payload.data : [];
        for (const row of rows) {
          if (!isRecord(row) || (row.symbol ?? row.s) !== symbol) continue;
          const side = row.side ?? row.S;
          const price = positiveNumber(row.price ?? row.p);
          const quantity = positiveNumber(row.size ?? row.v);
          const timestampMs = timestampValue(row.updatedTime ?? row.T ?? payload.ts);
          if (price === null || quantity === null || timestampMs === null) continue;
          const notional = price * quantity;
          if (side === 'Sell') snapshot.longNotional = (snapshot.longNotional ?? 0) + notional;
          else if (side === 'Buy') snapshot.shortNotional = (snapshot.shortNotional ?? 0) + notional;
          else continue;
          snapshot.eventCount += 1;
          snapshot.timestampMs = Math.max(snapshot.timestampMs ?? 0, timestampMs);
        }
      }
    });
    socket.on('error', () => {
      if (!opened) finish();
    });
    socket.on('close', () => finish());
  });
}

async function getJson(fetcher: typeof fetch, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${new URL(url).host}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function latestTimedValue(
  entries: readonly Record<string, unknown>[],
  valueKey: string,
  timestampKey: string,
): TimedValue | null {
  const values = entries.flatMap((entry) => {
    const value = numberValue(entry[valueKey]);
    const timestampMs = timestampValue(entry[timestampKey]);
    return value !== null && timestampMs !== null ? [{ value, timestampMs }] : [];
  });
  return values.sort((left, right) => right.timestampMs - left.timestampMs)[0] ?? null;
}

function latestFundingHistory(
  entries: readonly Record<string, unknown>[],
  valueKey: string,
): { mean: number; count: number } | null {
  const rates = entries
    .map((entry) => numberValue(entry[valueKey]))
    .filter((value): value is number => value !== null);
  if (rates.length < 3) return null;
  return {
    mean: rates.reduce((sum, value) => sum + value, 0) / rates.length,
    count: rates.length,
  };
}

function candlesFromArrays(value: unknown, timestampIndex: number, closeIndex: number): Candle[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): Candle[] => {
    if (!Array.isArray(row)) return [];
    const timestampMs = timestampValue(row[timestampIndex]);
    const close = positiveNumber(row[closeIndex]);
    return timestampMs !== null && close !== null ? [{ timestampMs, close }] : [];
  }).sort((left, right) => left.timestampMs - right.timestampMs);
}

function parseBinance(
  responses: readonly unknown[],
  nowMs: number,
  liquidation: LiquidationSnapshot,
): MemberFiveProxyMetrics | null {
  const [premiumValue, ratioValue, oiValue, candlesValue, fundingHistoryValue] = responses;
  const premium = isRecord(premiumValue) ? premiumValue : null;
  const ratio = latestTimedValue(records(ratioValue), 'longShortRatio', 'timestamp');
  const oiRows = records(oiValue);
  const oiValues = oiRows.flatMap((entry) => {
    const value = positiveNumber(entry.sumOpenInterestValue);
    const timestampMs = timestampValue(entry.timestamp);
    return value !== null && timestampMs !== null ? [{ value, timestampMs }] : [];
  }).sort((left, right) => right.timestampMs - left.timestampMs);
  const candles = candlesFromArrays(candlesValue, 0, 4);
  const fundingRate = numberValue(premium?.lastFundingRate);
  const fundingTimestampMs = timestampValue(premium?.time);
  const fundingHistory = latestFundingHistory(records(fundingHistoryValue), 'fundingRate');
  if (
    fundingRate === null || fundingTimestampMs === null ||
    fundingHistory === null ||
    !isFresh(fundingTimestampMs, nowMs, LIVE_MAX_AGE_MS) ||
    !ratio || !isFresh(ratio.timestampMs, nowMs, POSITIONING_MAX_AGE_MS) ||
    oiValues.length < 2 || !isFresh(oiValues[0].timestampMs, nowMs, POSITIONING_MAX_AGE_MS) ||
    candles.length < 3 || !isFresh(candles[candles.length - 1].timestampMs, nowMs, LIVE_MAX_AGE_MS)
  ) return null;
  return buildMetrics(
    fundingRate,
    fundingHistory.mean,
    fundingTimestampMs,
    ratio.value,
    ratio.timestampMs,
    oiValues[0],
    oiValues[1],
    candles,
    liquidation,
    'TOP_TRADER_POSITION',
  );
}

function parseBybit(
  responses: readonly unknown[],
  nowMs: number,
  liquidation: LiquidationSnapshot,
): MemberFiveProxyMetrics | null {
  const [tickerValue, ratioValue, oiValue, candleValue, fundingHistoryValue] = responses;
  const tickerRoot = isRecord(tickerValue) ? tickerValue : null;
  const tickerResult = isRecord(tickerRoot?.result) ? tickerRoot.result : null;
  const ticker = records(tickerResult?.list)[0];
  const ratioRoot = isRecord(ratioValue) ? ratioValue : null;
  const ratioResult = isRecord(ratioRoot?.result) ? ratioRoot.result : null;
  const ratio = latestTimedValue(records(ratioResult?.list), 'buyRatio', 'timestamp');
  const oiRoot = isRecord(oiValue) ? oiValue : null;
  const oiResult = isRecord(oiRoot?.result) ? oiRoot.result : null;
  const oiValues = records(oiResult?.list).flatMap((entry) => {
    const value = positiveNumber(entry.openInterest);
    const timestampMs = timestampValue(entry.timestamp);
    return value !== null && timestampMs !== null ? [{ value, timestampMs }] : [];
  }).sort((left, right) => right.timestampMs - left.timestampMs);
  const candleRoot = isRecord(candleValue) ? candleValue : null;
  const candleResult = isRecord(candleRoot?.result) ? candleRoot.result : null;
  const candles = candlesFromArrays(candleResult?.list, 0, 4);
  const serverTimestampMs = timestampValue(tickerRoot?.time ?? tickerRoot?.timeNano);
  const fundingRate = numberValue(ticker?.fundingRate);
  const tickerTimestampMs = serverTimestampMs ?? nowMs;
  const fundingHistoryRoot = isRecord(fundingHistoryValue) ? fundingHistoryValue : null;
  const fundingHistoryResult = isRecord(fundingHistoryRoot?.result) ? fundingHistoryRoot.result : null;
  const fundingHistory = latestFundingHistory(records(fundingHistoryResult?.list), 'fundingRate');
  const buyRatio = ratio?.value;
  const longShortRatio = buyRatio !== undefined && buyRatio > 0 && buyRatio < 1
    ? buyRatio / (1 - buyRatio)
    : null;
  if (
    fundingRate === null || !isFresh(tickerTimestampMs, nowMs, LIVE_MAX_AGE_MS) ||
    fundingHistory === null ||
    !ratio || !longShortRatio || !isFresh(ratio.timestampMs, nowMs, POSITIONING_MAX_AGE_MS) ||
    oiValues.length < 2 || !isFresh(oiValues[0].timestampMs, nowMs, POSITIONING_MAX_AGE_MS) ||
    candles.length < 3 || !isFresh(candles[candles.length - 1].timestampMs, nowMs, LIVE_MAX_AGE_MS)
  ) return null;
  return buildMetrics(
    fundingRate,
    fundingHistory.mean,
    tickerTimestampMs,
    longShortRatio,
    ratio.timestampMs,
    oiValues[0],
    oiValues[1],
    candles,
    liquidation,
    'ACCOUNT_LONG_SHORT',
  );
}

function parseOkx(responses: readonly unknown[], nowMs: number): MemberFiveProxyMetrics | null {
  const [fundingValue, ratioValue, oiValue, candleValue, fundingHistoryValue] = responses;
  const fundingRoot = isRecord(fundingValue) ? fundingValue : null;
  const funding = records(fundingRoot?.data)[0];
  const ratioRoot = isRecord(ratioValue) ? ratioValue : null;
  const ratioRows = Array.isArray(ratioRoot?.data) ? ratioRoot.data : [];
  const ratioValues = ratioRows.flatMap((row): TimedValue[] => {
    if (!Array.isArray(row)) return [];
    const timestampMs = timestampValue(row[0]);
    const value = numberValue(row[1]);
    return timestampMs !== null && value !== null ? [{ timestampMs, value }] : [];
  }).sort((left, right) => right.timestampMs - left.timestampMs);
  const oiRoot = isRecord(oiValue) ? oiValue : null;
  const oiRows = Array.isArray(oiRoot?.data) ? oiRoot.data : [];
  const oiValues = oiRows.flatMap((row): TimedValue[] => {
    if (!Array.isArray(row)) return [];
    const timestampMs = timestampValue(row[0]);
    const value = positiveNumber(row[1]);
    return timestampMs !== null && value !== null ? [{ timestampMs, value }] : [];
  }).sort((left, right) => right.timestampMs - left.timestampMs);
  const candleRoot = isRecord(candleValue) ? candleValue : null;
  const candles = candlesFromArrays(candleRoot?.data, 0, 4);
  const fundingRate = numberValue(funding?.fundingRate);
  const fundingTimestampMs = timestampValue(funding?.ts);
  const fundingHistoryRoot = isRecord(fundingHistoryValue) ? fundingHistoryValue : null;
  const fundingHistory = latestFundingHistory(records(fundingHistoryRoot?.data), 'fundingRate');
  const ratio = ratioValues[0];
  if (
    fundingRate === null || fundingTimestampMs === null ||
    fundingHistory === null ||
    !isFresh(fundingTimestampMs, nowMs, LIVE_MAX_AGE_MS) ||
    !ratio || ratio.value <= 0 || !isFresh(ratio.timestampMs, nowMs, POSITIONING_MAX_AGE_MS) ||
    oiValues.length < 2 || !isFresh(oiValues[0].timestampMs, nowMs, POSITIONING_MAX_AGE_MS) ||
    candles.length < 3 || !isFresh(candles[candles.length - 1].timestampMs, nowMs, LIVE_MAX_AGE_MS)
  ) return null;
  return buildMetrics(
    fundingRate,
    fundingHistory.mean,
    fundingTimestampMs,
    ratio.value,
    ratio.timestampMs,
    oiValues[0],
    oiValues[1],
    candles,
    {
      longNotional: null,
      shortNotional: null,
      timestampMs: null,
      eventCount: 0,
      feedStatus: 'UNAVAILABLE',
    },
    'ACCOUNT_LONG_SHORT',
  );
}

function parseGateCandles(value: unknown): Candle[] {
  return records(value).flatMap((row): Candle[] => {
    const timestampMs = timestampValue(row.t);
    const close = positiveNumber(row.c);
    return timestampMs !== null && close !== null ? [{ timestampMs, close }] : [];
  }).sort((left, right) => left.timestampMs - right.timestampMs);
}

function parseGate(
  responses: readonly unknown[],
  nowMs: number,
): MemberFiveProxyMetrics | null {
  const [statsValue, candlesValue] = responses;
  const stats = records(statsValue).flatMap((row) => {
    const timestampMs = timestampValue(row.time);
    const fundingRate = numberValue(row.last_funding_rate);
    const openInterest = positiveNumber(row.open_interest_usd ?? row.open_interest);
    const longShortRatio = positiveNumber(row.lsr_account);
    return timestampMs !== null && fundingRate !== null &&
      openInterest !== null && longShortRatio !== null
      ? [{
          timestampMs,
          fundingRate,
          openInterest,
          longShortRatio,
          markPrice: positiveNumber(row.mark_price),
        }]
      : [];
  }).sort((left, right) => right.timestampMs - left.timestampMs);
  const candles = parseGateCandles(candlesValue);
  if (
    stats.length < 2 ||
    !isFresh(stats[0].timestampMs, nowMs, POSITIONING_MAX_AGE_MS) ||
    !isFresh(candles[candles.length - 1]?.timestampMs ?? 0, nowMs, LIVE_MAX_AGE_MS)
  ) return null;
  const latest = stats[0];
  const fundingValues = stats.slice(0, 5).map(({ fundingRate }) => fundingRate);
  const fundingBaselineRate = fundingValues.reduce((sum, value) => sum + value, 0) /
    fundingValues.length;
  return buildMetrics(
    latest.fundingRate,
    fundingBaselineRate,
    nowMs,
    latest.longShortRatio,
    latest.timestampMs,
    { value: latest.openInterest, timestampMs: latest.timestampMs },
    { value: stats[1].openInterest, timestampMs: stats[1].timestampMs },
    candles,
    {
      longNotional: null,
      shortNotional: null,
      timestampMs: null,
      eventCount: 0,
      feedStatus: 'UNAVAILABLE',
    },
    'ACCOUNT_LONG_SHORT',
  );
}

function buildMetrics(
  fundingRate: number,
  fundingBaselineRate: number,
  fundingTimestampMs: number,
  longShortRatio: number,
  positioningTimestampMs: number,
  latestOi: TimedValue,
  previousOi: TimedValue,
  candles: readonly Candle[],
  liquidation: LiquidationSnapshot,
  longShortRatioMethod: MemberFiveProxyMetrics['longShortRatioMethod'],
): MemberFiveProxyMetrics | null {
  const oldestClose = candles[0]?.close;
  const latestClose = candles[candles.length - 1]?.close;
  if (!oldestClose || !latestClose || !previousOi.value) return null;
  const priceReturnPct = (latestClose / oldestClose - 1) * 100;
  const fundingDeviation = fundingRate - fundingBaselineRate;
  const openInterestChangePct = (latestOi.value / previousOi.value - 1) * 100;
  const returns = candles.slice(1).map((candle, index) =>
    Math.log(candle.close / candles[index].close)
  );
  const realizedVolatilityPct = returns.length
    ? Math.sqrt(returns.reduce((sum, value) => sum + value * value, 0) / returns.length) * 100
    : 0;
  const liquidationTotal = (liquidation.longNotional ?? 0) + (liquidation.shortNotional ?? 0);
  const liquidationImbalance = liquidationTotal > 0
    ? (liquidation.shortNotional! - liquidation.longNotional!) / liquidationTotal
    : null;
  const directionScore = calculateMemberFiveProxyScore({
    fundingRate,
    fundingDeviation,
    longShortRatio,
    openInterestChangePct,
    priceReturnPct,
    liquidationImbalance,
  });
  if (directionScore === null) return null;
  return {
    healthStatus: 'HEALTHY',
    timestampMs: Math.min(fundingTimestampMs, positioningTimestampMs, latestOi.timestampMs, candles[candles.length - 1].timestampMs),
    fundingTimestampMs,
    positioningTimestampMs: Math.min(positioningTimestampMs, latestOi.timestampMs),
    priceTimestampMs: candles[candles.length - 1].timestampMs,
    fundingRate,
    fundingBaselineRate,
    fundingDeviation,
    longShortRatio,
    openInterestChangePct: Number(openInterestChangePct.toFixed(6)),
    priceReturnPct: Number(priceReturnPct.toFixed(6)),
    realizedVolatilityPct: Number(realizedVolatilityPct.toFixed(6)),
    liquidationLongNotional: liquidation.longNotional,
    liquidationShortNotional: liquidation.shortNotional,
    liquidationTimestampMs: liquidation.timestampMs,
    liquidationEventCount: liquidation.eventCount,
    liquidationFeedStatus: liquidation.feedStatus,
    directionScore,
    longShortRatioMethod,
  };
}

function kucoinTimestampMs(value: unknown): number | null {
  const parsed = numberValue(value);
  if (parsed === null || parsed <= 0) return null;
  return parsed > 1_000_000_000_000_000
    ? parsed / 1_000_000
    : timestampValue(parsed);
}

function kucoinContractSymbol(asset: string): string {
  return `${asset === 'BTC' ? 'XBT' : asset}USDTM`;
}

async function fetchKucoinProxy(
  asset: string,
  nowMs: number,
  fetcher: typeof fetch,
): Promise<MemberFiveProxyDegraded> {
  const symbol = encodeURIComponent(kucoinContractSymbol(asset));
  const [contractValue, fundingValue, candleValue, tradeValue] = await Promise.all([
    getJson(fetcher, `https://api-futures.kucoin.com/api/v1/contracts/${symbol}`),
    getJson(fetcher, `https://api-futures.kucoin.com/api/v1/funding-rate/${symbol}/current`),
    getJson(fetcher, `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${symbol}&granularity=1&from=${nowMs - 5 * 60_000}&to=${nowMs}`),
    getJson(fetcher, `https://api-futures.kucoin.com/api/v1/trade/history?symbol=${symbol}`),
  ]);
  const contractRoot = isRecord(contractValue) ? contractValue : null;
  const contract = isRecord(contractRoot?.data) ? contractRoot.data : null;
  const fundingRoot = isRecord(fundingValue) ? fundingValue : null;
  const funding = isRecord(fundingRoot?.data) ? fundingRoot.data : null;
  const candlesRoot = isRecord(candleValue) ? candleValue : null;
  const candles = candlesFromArrays(candlesRoot?.data, 0, 4);
  const tradesRoot = isRecord(tradeValue) ? tradeValue : null;
  const trades = records(tradesRoot?.data);
  const buyVolume = trades.reduce((sum, trade) =>
    trade.side === 'buy' ? sum + (positiveNumber(trade.size) ?? 0) : sum, 0);
  const sellVolume = trades.reduce((sum, trade) =>
    trade.side === 'sell' ? sum + (positiveNumber(trade.size) ?? 0) : sum, 0);
  const lastTradeTimestampMs = trades.reduce<number | null>((latest, trade) => {
    const timestampMs = kucoinTimestampMs(trade.ts);
    return timestampMs === null ? latest : Math.max(latest ?? 0, timestampMs);
  }, null);
  const openInterest = positiveNumber(contract?.openInterest);
  const fundingRate = numberValue(funding?.value ?? contract?.fundingFeeRate);
  const fundingBaselineRate = numberValue(funding?.lastTimeFundingRate ?? contract?.lastTimeFundingRate);
  const latestCandle = candles[candles.length - 1];
  const previousOi = KUCOIN_OI_SAMPLES.get(asset);
  const oiAgeMs = previousOi ? nowMs - previousOi.timestampMs : null;
  const openInterestChangePct = openInterest !== null &&
    previousOi !== undefined &&
    oiAgeMs !== null &&
    oiAgeMs > 0 &&
    oiAgeMs <= POSITIONING_MAX_AGE_MS &&
    previousOi.value > 0
    ? Number(((openInterest / previousOi.value - 1) * 100).toFixed(6))
    : null;
  if (openInterest !== null) KUCOIN_OI_SAMPLES.set(asset, { value: openInterest, timestampMs: nowMs });

  const tradeRatio = buyVolume > 0 && sellVolume > 0
    ? buyVolume / sellVolume
    : null;
  const candlesFresh = latestCandle !== undefined &&
    isFresh(latestCandle.timestampMs, nowMs, LIVE_MAX_AGE_MS);
  const tradeFeedFresh = lastTradeTimestampMs !== null &&
    isFresh(lastTradeTimestampMs, nowMs, LIVE_MAX_AGE_MS);
  const priceReturnPct = candles.length >= 2 && candlesFresh
    ? Number(((candles[candles.length - 1].close / candles[0].close - 1) * 100).toFixed(6))
    : null;
  const candleReturns = candles.slice(1).map((candle, index) =>
    Math.log(candle.close / candles[index].close)
  );
  const realizedVolatilityPct = candleReturns.length > 0 && candlesFresh
    ? Number((Math.sqrt(candleReturns.reduce((sum, value) => sum + value * value, 0) /
      candleReturns.length) * 100).toFixed(6))
    : null;
  const proxyTimestampMs = Math.min(
    nowMs,
    lastTradeTimestampMs ?? nowMs,
    latestCandle?.timestampMs ?? nowMs,
  );

  return {
    healthStatus: 'DEGRADED',
    detail: 'KuCoin public Futures endpoints provide current funding/OI and executed-trade flow, but no verified public account long/short history; trade-side ratio is not substituted for account positioning, so this source is excluded from the three-source voting quorum.',
    normalizedData: {
      proxyHealthStatus: 'DEGRADED',
      proxyTimestampMs,
      proxyFundingTimestampMs: nowMs,
      proxyPositioningTimestampMs: lastTradeTimestampMs,
      proxyTradeFeedStatus: tradeFeedFresh ? 'FRESH' : 'STALE',
      proxyPriceTimestampMs: latestCandle?.timestampMs ?? null,
      proxyFundingRate: fundingRate,
      proxyFundingBaselineRate: fundingBaselineRate,
      proxyFundingDeviation: fundingRate !== null && fundingBaselineRate !== null
        ? fundingRate - fundingBaselineRate
        : null,
      proxyLongShortRatio: tradeRatio,
      proxyLongShortRatioMethod: 'TAKER_TRADE_VOLUME',
      proxyBuyTradeVolume: buyVolume,
      proxySellTradeVolume: sellVolume,
      proxyOpenInterest: openInterest,
      proxyOpenInterestChangePct: openInterestChangePct,
      proxyPriceReturnPct: priceReturnPct,
      proxyRealizedVolatilityPct: realizedVolatilityPct,
      proxyLiquidationFeedStatus: 'UNAVAILABLE',
    },
  };
}

async function fetchFreshMemberFiveFuturesProxy(input: {
  asset: string;
  venue: MemberFiveProxyVenue;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<MemberFiveProxyResult> {
  const { asset, venue } = input;
  const nowMs = input.nowMs ?? Date.now();
  const fetcher = input.fetcher ?? fetch;
  const symbol = `${asset}USDT`;

  if (venue === 'binance') {
    const querySymbol = encodeURIComponent(symbol);
    const [responses, liquidation] = await Promise.all([
      Promise.all([
      getJson(fetcher, `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${querySymbol}`),
      getJson(fetcher, `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${querySymbol}&period=5m&limit=3`),
      getJson(fetcher, `https://fapi.binance.com/futures/data/openInterestHist?symbol=${querySymbol}&period=5m&limit=3`),
      getJson(fetcher, `https://fapi.binance.com/fapi/v1/klines?symbol=${querySymbol}&interval=1m&limit=5`),
      getJson(fetcher, `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${querySymbol}&limit=8`),
      ]),
      liquidationSnapshot(venue, symbol),
    ]);
    return parseBinance(responses, Math.max(nowMs, Date.now()), liquidation);
  }

  if (venue === 'bybit') {
    const querySymbol = encodeURIComponent(symbol);
    const [responses, liquidation] = await Promise.all([
      Promise.all([
      getJson(fetcher, `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${querySymbol}`),
      getJson(fetcher, `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${querySymbol}&period=5min&limit=3`),
      getJson(fetcher, `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${querySymbol}&intervalTime=5min&limit=3`),
      getJson(fetcher, `https://api.bybit.com/v5/market/kline?category=linear&symbol=${querySymbol}&interval=1&limit=5`),
      getJson(fetcher, `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${querySymbol}&limit=8`),
      ]),
      liquidationSnapshot(venue, symbol),
    ]);
    return parseBybit(responses, Math.max(nowMs, Date.now()), liquidation);
  }

  if (venue === 'kucoin') {
    return fetchKucoinProxy(asset, Math.max(nowMs, Date.now()), fetcher);
  }

  if (venue === 'gateio') {
    const contract = encodeURIComponent(`${asset}_USDT`);
    const [statsValue, candlesValue] = await Promise.all([
      getJson(fetcher, `https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${contract}&interval=5m&limit=5`),
      getJson(fetcher, `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${contract}&interval=1m&limit=5`),
    ]);
    return parseGate([statsValue, candlesValue], Math.max(nowMs, Date.now()));
  }

  const instrumentId = encodeURIComponent(`${asset}-USDT-SWAP`);
  const currency = encodeURIComponent(asset);
  const responses = await Promise.all([
    getJson(fetcher, `https://www.okx.com/api/v5/public/funding-rate?instId=${instrumentId}`),
    getJson(fetcher, `https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${currency}&period=5m`),
    getJson(fetcher, `https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${currency}&period=5m`),
    getJson(fetcher, `https://www.okx.com/api/v5/market/candles?instId=${instrumentId}&bar=1m&limit=5`),
    getJson(fetcher, `https://www.okx.com/api/v5/public/funding-rate-history?instId=${instrumentId}&limit=8`),
  ]);
  return parseOkx(responses, Math.max(nowMs, Date.now()));
}

export async function fetchMemberFiveFuturesProxy(input: {
  asset: string;
  venue: MemberFiveProxyVenue;
  nowMs?: number;
  fetcher?: typeof fetch;
}): Promise<MemberFiveProxyResult> {
  const cacheKey = `${input.asset}:${input.venue}`;
  let latestFailure: MemberFiveProxyResult = null;
  try {
    latestFailure = await fetchFreshMemberFiveFuturesProxy(input);
  } catch (error) {
    latestFailure = {
      healthStatus: 'FAILED',
      detail: error instanceof Error ? error.message : String(error),
      normalizedData: {},
    };
  }

  const cacheNowMs = Math.max(input.nowMs ?? Date.now(), Date.now());
  const receivedAtMs = cacheNowMs;
  if (latestFailure?.healthStatus === 'HEALTHY') {
    const snapshot: MemberFiveProxyMetrics = {
      ...latestFailure,
      cacheStatus: 'FRESH',
      cacheAgeMs: 0,
      cacheReceivedAtMs: receivedAtMs,
    };
    proxySnapshotCache.set(cacheKey, { receivedAtMs, metrics: snapshot });
    return snapshot;
  }

  const cached = proxySnapshotCache.get(cacheKey);
  if (cached) {
    const cacheAgeMs = cacheNowMs - cached.receivedAtMs;
    if (cacheAgeMs >= 0 && cacheAgeMs <= MEMBER_FIVE_PROXY_CACHE_TTL_MS) {
      return {
        ...cached.metrics,
        cacheStatus: 'CACHED_OK',
        cacheAgeMs,
        cacheReceivedAtMs: cached.receivedAtMs,
        cacheFallbackReason: latestFailure && 'detail' in latestFailure
          ? latestFailure.detail
          : 'Latest refresh did not produce a complete valid snapshot.',
      };
    }
    proxySnapshotCache.delete(cacheKey);
    return {
      healthStatus: 'FAILED',
      detail: `Last ${input.venue} futures snapshot expired (${cacheAgeMs}ms; maximum ${MEMBER_FIVE_PROXY_CACHE_TTL_MS}ms) and was excluded.`,
      normalizedData: {
        proxyCacheStatus: 'EXPIRED',
        proxyCacheAgeMs: cacheAgeMs,
        proxyCacheReceivedAtMs: cached.receivedAtMs,
        proxyHealthStatus: 'FAILED',
      },
    };
  }

  if (latestFailure) {
    return {
      ...latestFailure,
      normalizedData: {
        ...('normalizedData' in latestFailure ? latestFailure.normalizedData : {}),
        proxyCacheStatus: 'UNAVAILABLE',
        proxyCacheAgeMs: null,
        proxyCacheReceivedAtMs: null,
      },
    };
  }
  return {
    healthStatus: 'FAILED',
    detail: `${input.venue} returned no complete, valid futures snapshot and has no recent cache entry.`,
    normalizedData: {
      proxyCacheStatus: 'UNAVAILABLE',
      proxyCacheAgeMs: null,
      proxyCacheReceivedAtMs: null,
      proxyHealthStatus: 'FAILED',
    },
  };
}

export function resetMemberFiveFuturesProxyCacheForTests(): void {
  proxySnapshotCache.clear();
  KUCOIN_OI_SAMPLES.clear();
}
