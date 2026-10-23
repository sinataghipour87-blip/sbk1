import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  Candle,
  DataQualityReport,
  DecisionPipelineResult,
  DerivativesData,
  DirectionalSignalCandidate,
  FearAndGreed,
  FuturesPrices,
  OrderFlowFeatures,
  RealOrderBookImbalance,
  SentimentData,
  AnalysisResult,
  TradePosition,
} from '../types/trading';
import type { FreqtradeBotState, FreqtradeBalance, FreqtradeTrade } from './freqtradeBridge';
import {
  FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS,
  FREQTRADE_TRADE_FLOW_MAX_AGE_MS,
  freqtradeMarketDataBridge,
  type FreqtradeMarketSnapshot,
  type FreqtradeMarketSnapshotExpectation,
} from './freqtradeMarketDataBridge';
import {
  deriveSbkExitSignalId,
  deriveSbkSignalIds,
  freqtradeSignalAdapter,
  SBK_EXECUTION_TIMEFRAME,
  SBK_MAX_OPEN_TRADES,
  SBK_SIGNAL_CONTRACT_VERSION,
  validateSbkFreqtradeSignal,
  type SbkFreqtradeExitSignal,
  type SbkFreqtradeSignal,
  type SbkFreqtradeSignalRecord,
  type SbkEntryAuthorization,
} from './freqtradeSignalAdapter';
import { freqtradeBridge } from './freqtradeBridge';
import { operationalTradeArchive, type OperationalTradeArchiveMetadata } from './operationalTradeArchive';
import { centralTradeDatasetService } from './centralTradeDataset';
import { fetchDirectNewsHeadlines } from './directNewsFeeds';
import { deduplicateTrades } from './councilEvidenceDeduplication';
import {
  openSourceAdvisoryService,
  type OpenSourceAdvisoryReport,
} from './openSourceAdvisoryService';
import {
  runEightMemberCouncilRuntime,
} from './eightMemberCouncilRuntime';
import { runPostCouncilTradeControl } from './postCouncilTradeController';
import type { HoldingHorizonDecision } from './postCouncilTradeController';
import { macroContextBrainService } from './macroContextBrain';
import { sbFiveModelsEngine } from './sbFiveModelsEngine';
import { fetchFreeMacroData } from './freeMacroData';
import { fetchDeribitOptionsData } from './deribitOptionsData';
import {
  fetchOnChainWhaleData,
  startPublicBitcoinWhaleDataPrefetch,
  stopPublicBitcoinWhaleDataPrefetch,
} from './publicBitcoinWhaleData';
import { fetchPublicMarketFallback } from './publicMarketDataFallback';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MINIMUM_CANDLES_FOR_ANALYSIS = 300;
const DEFAULT_SIGNAL_TTL_SECONDS = 120;
const DEFAULT_SIGNAL_MAX_DEVIATION_BPS = 100;
const DEFAULT_RISK_BUDGET_PCT = 10;
const DEFAULT_MAX_LEVERAGE = 25;
const MAX_RISK_BUDGET_PCT = 10;
const DEFAULT_DAILY_LOSS_LIMIT_PCT = 10;
const MAX_DAILY_LOSS_LIMIT_PCT = 10;
const DEFAULT_MAX_ATR_PCT = 2;
const MAX_READY_ADVISORY_AGE_MS = 2 * 60_000;

function historicalPatternCostConfig(): {
  feeBpsPerSide?: number;
  slippageBpsPerSide?: number;
} {
  const feeValue = process.env.SBK1_PATTERN_TAKER_FEE_BPS?.trim();
  const slippageValue = process.env.SBK1_PATTERN_SLIPPAGE_BPS?.trim();
  if (!feeValue && !slippageValue) return {};
  const feeBpsPerSide = Number(feeValue);
  const slippageBpsPerSide = Number(slippageValue);
  if (
    !feeValue || !slippageValue ||
    !Number.isFinite(feeBpsPerSide) || feeBpsPerSide < 0 ||
    !Number.isFinite(slippageBpsPerSide) || slippageBpsPerSide < 0
  ) {
    console.error(
      '[SBK1_PATTERN_RESEARCH] Invalid cost configuration. Set both SBK1_PATTERN_TAKER_FEE_BPS and SBK1_PATTERN_SLIPPAGE_BPS to non-negative per-side basis points.',
    );
    return {};
  }
  return { feeBpsPerSide, slippageBpsPerSide };
}

export interface ServerSignalAuditRecord {
  at: string;
  candleTimestampMs: number | null;
  decision: 'NO TRADE' | 'LONG' | 'SHORT';
  reason: string;
  eventType?: 'ADVISORY_REPORT';
  signalId?: string;
  duplicate?: boolean;
  unavailableInputs?: string[];
  openSourceAdvisories?: OpenSourceAdvisoryReport;
  holdingHorizon?: HoldingHorizonDecision;
}

export interface ServerSignalRunnerDependencies {
  getFreqtradeStatus(): Promise<FreqtradeBotState>;
  getOpenTrades(): Promise<FreqtradeTrade[]>;
  getFreqtradeBalance(): Promise<FreqtradeBalance>;
  getDailyRealizedLossUsd(dayStartMs: number, nowMs: number): Promise<number>;
  getSnapshot(expected: FreqtradeMarketSnapshotExpectation, nowMs: number): FreqtradeMarketSnapshot;
  isKillSwitchActive(): boolean;
  submitSignal(
    signal: SbkFreqtradeSignal,
    expected: { expectedPair: string; expectedExchange: string; expectedTimeframe: string },
  ): Promise<SbkFreqtradeSignalRecord>;
  recordSignalArchive?(
    signal: SbkFreqtradeSignalRecord,
    metadata: OperationalTradeArchiveMetadata,
  ): Promise<void>;
  syncClosedTrades?(status: FreqtradeBotState): Promise<void>;
  getSignal(signalId: string): Promise<SbkFreqtradeSignalRecord | null>;
  submitExitSignal(signal: SbkFreqtradeExitSignal, nowMs: number): Promise<{ duplicate?: boolean }>;
  evaluateExit?(
    snapshot: FreqtradeMarketSnapshot,
    candles: Candle[],
    nowMs: number,
    trade: FreqtradeTrade,
    entrySignal: SbkFreqtradeSignalRecord,
  ): Promise<{ shouldExit: boolean; reason: string }>;
  analyze?: (
    snapshot: FreqtradeMarketSnapshot,
    candles: Candle[],
    nowMs: number,
    balance: number,
    signalSettings?: ReturnType<typeof readSignalSettings>,
    availableBalance?: number,
    openRiskUsd?: number,
    dailyLossUsd?: number,
    maxOpenTrades?: number,
  ) => Promise<{
    candidate: DirectionalSignalCandidate | null;
    reason: string;
    holdingHorizon?: HoldingHorizonDecision;
    executionRisk?: { maxStakeQuote: number; maxLeverage: number; allocatedRiskUsd: number };
    authorization?: Omit<SbkEntryAuthorization, 'decisionId' | 'allocatedRiskUsd'>;
    featureSnapshot?: OperationalTradeArchiveMetadata['featureSnapshot'];
    featureVersion?: string;
    modelVersion?: string;
    openSourceAdvisories?: OpenSourceAdvisoryReport;
  }>;
  appendAudit?: (record: ServerSignalAuditRecord) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  minimumCandles?: number;
}

function timeframeToMs(timeframe: string): number {
  const match = /^(\d+)([mhdw])$/.exec(timeframe);
  if (!match) return 0;
  const units: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  const duration = Number(match[1]) * units[match[2]];
  return Number.isSafeInteger(duration) ? duration : 0;
}

function readPositiveEnv(name: string, defaultValue: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : defaultValue;
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be a number greater than 0 and no more than ${maximum}.`);
  }
  return value;
}

function readSignalSettings(): {
  ttlSeconds: number;
  maxDeviationBps: number;
  riskBudgetPct: number;
  maxStakeQuote: number;
  maxLeverage: number;
  dailyLossLimitPct: number;
  maxAtrPct: number;
} {
  const ttlSeconds = readPositiveEnv('SBK1_SIGNAL_TTL_SECONDS', DEFAULT_SIGNAL_TTL_SECONDS, 120);
  const riskBudgetPct = readPositiveEnv(
    'SBK1_SIGNAL_RISK_BUDGET_PCT',
    DEFAULT_RISK_BUDGET_PCT,
    MAX_RISK_BUDGET_PCT,
  );
  const maxStakeQuote = readPositiveEnv(
    'SBK1_SIGNAL_MAX_STAKE_QUOTE',
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  const maxLeverage = readPositiveEnv('SBK1_SIGNAL_MAX_LEVERAGE', DEFAULT_MAX_LEVERAGE, 25);
  return {
    ttlSeconds,
    maxDeviationBps: readPositiveEnv(
      'SBK1_SIGNAL_MAX_DEVIATION_BPS',
      DEFAULT_SIGNAL_MAX_DEVIATION_BPS,
      100,
    ),
    riskBudgetPct,
    maxStakeQuote,
    maxLeverage,
    dailyLossLimitPct: readPositiveEnv(
      'SBK1_SIGNAL_DAILY_LOSS_LIMIT_PCT',
      DEFAULT_DAILY_LOSS_LIMIT_PCT,
      MAX_DAILY_LOSS_LIMIT_PCT,
    ),
    maxAtrPct: readPositiveEnv('SBK1_SIGNAL_MAX_ATR_PCT', DEFAULT_MAX_ATR_PCT, 5),
  };
}

export async function calculateOpenTradeRiskUsd(
  openTrades: FreqtradeTrade[],
  getSignal: (signalId: string) => Promise<SbkFreqtradeSignalRecord | null>,
): Promise<number> {
  let totalRiskUsd = 0;
  for (const trade of openTrades) {
    if (!trade.is_open) continue;
    const leverage = trade.leverage;
    if (
      !Number.isSafeInteger(trade.trade_id) ||
      trade.trade_id <= 0 ||
      typeof trade.enter_tag !== 'string' ||
      !trade.enter_tag ||
      !Number.isFinite(trade.open_rate) ||
      trade.open_rate <= 0 ||
      !Number.isFinite(trade.stake_amount) ||
      trade.stake_amount <= 0 ||
      typeof leverage !== 'number' ||
      !Number.isFinite(leverage) ||
      leverage < 1
    ) {
      throw new Error(`Open Freqtrade trade ${String(trade.trade_id)} has no verifiable entry risk.`);
    }
    const record = await getSignal(trade.enter_tag);
    const expectedDirection = trade.is_short ? 'SHORT' : 'LONG';
    if (
      !record ||
      record.signal.pair !== trade.pair ||
      record.signal.direction !== expectedDirection ||
      (record.tradeId !== undefined && record.tradeId !== trade.trade_id)
    ) {
      throw new Error(`Open Freqtrade trade ${trade.trade_id} has no matching authorized signal; portfolio risk is unknown.`);
    }
    const stopLoss = record.signal.entryConditions.stopLoss;
    const stopIsValid = expectedDirection === 'LONG'
      ? stopLoss < trade.open_rate
      : stopLoss > trade.open_rate;
    if (!Number.isFinite(stopLoss) || stopLoss <= 0 || !stopIsValid) {
      throw new Error(`Open Freqtrade trade ${trade.trade_id} has no valid protective-stop distance.`);
    }
    totalRiskUsd += trade.stake_amount * leverage *
      Math.abs(trade.open_rate - stopLoss) / trade.open_rate;
  }
  if (!Number.isFinite(totalRiskUsd)) throw new Error('Aggregate open-trade risk is not finite.');
  return totalRiskUsd;
}

export function toCandleTuple(
  candle: FreqtradeMarketSnapshot['candles'][number],
): Candle {
  return [
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ];
}

function createMarketFeedQuality(input: {
  feedName: string;
  source: string;
  status: 'LIVE' | 'UNAVAILABLE';
  timestamp: number;
  ageMs: number;
  maxAgeMs?: number;
  score: number;
  detailsFa: string;
}) {
  return {
    ...input,
    latencyMs: null,
  };
}

function makeSnapshotAnalysisInputs(
  snapshot: FreqtradeMarketSnapshot,
  candles: Candle[],
  nowMs: number,
): {
  fearAndGreed: FearAndGreed;
  sentiment: SentimentData;
  derivatives: DerivativesData;
  dataQuality: DataQualityReport;
  orderBook?: RealOrderBookImbalance;
  futuresPrices?: FuturesPrices;
  orderFlow: OrderFlowFeatures;
  unavailableInputs: string[];
} {
  const snapshotAgeMs = nowMs - snapshot.generatedAtMs;
  const orderBookSnapshot = snapshot.orderBook;
  const bidDepthUsd = orderBookSnapshot?.bids.reduce((total, level) => total + level.price * level.amount, 0) ?? null;
  const askDepthUsd = orderBookSnapshot?.asks.reduce((total, level) => total + level.price * level.amount, 0) ?? null;
  const orderBookObi = bidDepthUsd !== null && askDepthUsd !== null && bidDepthUsd + askDepthUsd > 0
    ? (bidDepthUsd - askDepthUsd) / (bidDepthUsd + askDepthUsd)
    : null;
  const orderBook: RealOrderBookImbalance | undefined = orderBookSnapshot
    ? {
      venue: orderBookSnapshot.venue ?? snapshot.exchange,
      symbol: orderBookSnapshot.symbol ?? snapshot.pair,
      ...(orderBookSnapshot.sequenceId === undefined ? {} : { sequenceId: orderBookSnapshot.sequenceId }),
      duplicateSnapshotCount: orderBookSnapshot.duplicateSnapshotCount ?? 0,
      obi: orderBookObi,
      bidDepthUsd: bidDepthUsd ?? 0,
      askDepthUsd: askDepthUsd ?? 0,
      bestBid: orderBookSnapshot.bids[0]?.price ?? null,
      bestAsk: orderBookSnapshot.asks[0]?.price ?? null,
      spreadUsd: orderBookSnapshot.bids[0] && orderBookSnapshot.asks[0]
        ? orderBookSnapshot.asks[0].price - orderBookSnapshot.bids[0].price
        : null,
      levelsCount: Math.min(orderBookSnapshot.bids.length, orderBookSnapshot.asks.length),
      status: 'LIVE',
      timestamp: orderBookSnapshot.timestampMs,
      ageMs: nowMs - orderBookSnapshot.timestampMs,
      latencyMs: null,
      source: 'freqtrade.dataprovider',
    }
    : undefined;
  const ticker = snapshot.ticker;
  const tickerAgeMs = ticker ? nowMs - ticker.retrievedAtMs : Number.POSITIVE_INFINITY;
  const tickerLive = Boolean(
    ticker &&
    tickerAgeMs >= 0 &&
    tickerAgeMs <= 5_000 &&
    ticker.markPrice !== null &&
    ticker.indexPrice !== null
  );
  const futuresPrices: FuturesPrices | undefined = ticker?.markPrice !== null &&
    ticker?.indexPrice !== null &&
    ticker &&
    tickerLive
    ? {
      lastPrice: ticker.last,
      markPrice: ticker.markPrice,
      indexPrice: ticker.indexPrice,
      timestampUtc: ticker.exchangeTimestampMs ?? ticker.retrievedAtMs,
      exchangeTimestampUtc: ticker.exchangeTimestampMs,
      timestampSource: ticker.exchangeTimestampMs === null ? 'FREQTRADE_RECEIVED' : 'EXCHANGE',
      receivedTimestampMs: ticker.retrievedAtMs,
      isoTimeUtc: new Date(ticker.retrievedAtMs).toISOString(),
      ageMs: nowMs - ticker.retrievedAtMs,
      latencyMs: null,
      source: 'freqtrade.dataprovider',
      status: 'LIVE',
    }
    : undefined;

  const tradeFlow = snapshot.tradeFlow;
  const tradeFlowAgeMs = tradeFlow ? nowMs - tradeFlow.retrievedAtMs : Number.POSITIVE_INFINITY;
  const deduplicatedPrimaryTrades = tradeFlow
    ? deduplicateTrades(tradeFlow.trades.map((trade) => ({
      ...trade,
      venue: trade.venue ?? snapshot.exchange,
      symbol: trade.symbol ?? snapshot.pair,
    })))
    : null;
  const hasFreshTradeFlow = Boolean(
    tradeFlow &&
    deduplicatedPrimaryTrades &&
    !deduplicatedPrimaryTrades.conflictingIdentity &&
    tradeFlowAgeMs >= 0 &&
    tradeFlowAgeMs <= FREQTRADE_TRADE_FLOW_MAX_AGE_MS &&
    deduplicatedPrimaryTrades.values.length > 0 &&
    deduplicatedPrimaryTrades.values.every((trade) =>
      nowMs - trade.timestampMs >= 0 &&
      nowMs - trade.timestampMs <= FREQTRADE_TRADE_FLOW_MAX_AGE_MS &&
      Number.isFinite(trade.price) &&
      Number.isFinite(trade.amount)
    )
  );
  const uniqueTrades = hasFreshTradeFlow ? deduplicatedPrimaryTrades!.values : [];
  const buyTrades = uniqueTrades.filter((trade) => trade.side === 'buy');
  const sellTrades = uniqueTrades.filter((trade) => trade.side === 'sell');
  const takerBuyVol = buyTrades.reduce((total, trade) => total + trade.amount, 0);
  const takerSellVol = sellTrades.reduce((total, trade) => total + trade.amount, 0);
  const cvdDelta = takerBuyVol - takerSellVol;
  const cvdDeltaUsd = buyTrades.reduce((total, trade) => total + trade.amount * trade.price, 0) -
    sellTrades.reduce((total, trade) => total + trade.amount * trade.price, 0);
  const totalTakerVolume = takerBuyVol + takerSellVol;
  const latestTradeTimestampMs = hasFreshTradeFlow
    ? uniqueTrades[uniqueTrades.length - 1].timestampMs
    : null;
  const orderFlow: OrderFlowFeatures = {
    cvdDelta: hasFreshTradeFlow ? cvdDelta : null,
    cvdDeltaUsd: hasFreshTradeFlow ? cvdDeltaUsd : null,
    cvdDivergence: hasFreshTradeFlow ? 'RECENT_TRADE_FLOW_WINDOW' : 'UNAVAILABLE',
    takerBuyVol: hasFreshTradeFlow ? takerBuyVol : null,
    takerSellVol: hasFreshTradeFlow ? takerSellVol : null,
    takerRatio: hasFreshTradeFlow && totalTakerVolume > 0 ? takerBuyVol / totalTakerVolume : null,
    takerDelta: hasFreshTradeFlow ? cvdDelta : null,
    delta: hasFreshTradeFlow ? cvdDelta : null,
    cumulativeDelta: hasFreshTradeFlow ? cvdDelta : null,
    deltaVelocity: hasFreshTradeFlow
      ? cvdDelta / Math.max(1, (tradeFlow!.retrievedAtMs - uniqueTrades[0].timestampMs) / 1_000)
      : null,
    isRealTradeFlow: hasFreshTradeFlow,
    uniqueTradeCount: hasFreshTradeFlow ? uniqueTrades.length : 0,
    duplicateTradeCount: (tradeFlow?.duplicateCount ?? 0) +
      (deduplicatedPrimaryTrades?.duplicateCount ?? 0),
    status: hasFreshTradeFlow ? 'LIVE' : 'UNAVAILABLE',
    timestampUtc: latestTradeTimestampMs ?? snapshot.generatedAtMs,
    ageMs: latestTradeTimestampMs === null ? Number.POSITIVE_INFINITY : nowMs - latestTradeTimestampMs,
    latencyMs: null,
    source: hasFreshTradeFlow ? `${snapshot.source}.ccxt.fetch_trades` : snapshot.source,
    ...(hasFreshTradeFlow ? {} : { error: 'Fresh trade-level flow is missing from the Freqtrade snapshot.' }),
  };

  const openInterest = snapshot.openInterest;
  const openInterestAgeMs = openInterest ? nowMs - openInterest.latestTimestampMs : Number.POSITIVE_INFINITY;
  const openInterestFresh = Boolean(
    openInterest &&
    openInterestAgeMs >= 0 &&
    openInterestAgeMs <= 10 * 60_000
  );
  const fundingRate = snapshot.fundingRate;
  const fundingAgeMs = fundingRate ? nowMs - fundingRate.retrievedAtMs : Number.POSITIVE_INFINITY;
  const fundingFresh = Boolean(
    fundingRate &&
    fundingAgeMs >= -1_000 &&
    fundingAgeMs <= FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS
  );
  const derivativesLive = openInterestFresh && fundingFresh;
  const oiChangePct = openInterestFresh && openInterest
    ? ((openInterest.latestAmount - openInterest.previousAmount) / openInterest.previousAmount) * 100
    : null;
  const candleLive = candles.length >= MINIMUM_CANDLES_FOR_ANALYSIS;
  const latestCompletedCandle = snapshot.candles.at(-1);
  const candleCloseTimestampMs = latestCompletedCandle
    ? latestCompletedCandle.timestampMs + timeframeToMs(snapshot.timeframe)
    : null;
  const candleAgeMs = candleCloseTimestampMs === null ? Number.POSITIVE_INFINITY : nowMs - candleCloseTimestampMs;
  const candleMaxAgeMs = timeframeToMs(snapshot.timeframe) + 60_000;
  const candleFresh = candleLive && candleAgeMs >= 0 && candleAgeMs <= candleMaxAgeMs;
  const snapshotFresh = snapshotAgeMs >= 0 && snapshotAgeMs <= FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS;
  const orderBookFresh = Boolean(orderBook && orderBook.obi !== null && orderBook.ageMs >= 0 && orderBook.ageMs <= 10_000);
  const executionFeedsAvailable = candleFresh && tickerLive && orderBookFresh && hasFreshTradeFlow && snapshotFresh;
  const unavailableInputs = [
    'Fear and Greed sentiment is not included in the Freqtrade snapshot.',
    'Cross-exchange data and browser-only model state are not available to the server runner.',
    'MultiBrain UI evidence is not an independent input to the server signal runner.',
    ...(!candleFresh ? ['Completed candles are missing, stale, or have invalid cadence.'] : []),
    ...(!tickerLive ? ['A fresh ticker with Last, Mark, and Index prices is unavailable.'] : []),
    ...(!orderBookFresh ? ['A fresh, valid order book is unavailable.'] : []),
    ...(!hasFreshTradeFlow ? ['Fresh, timestamped public trades for CVD/taker-flow are unavailable.'] : []),
    ...(!openInterestFresh ? ['Fresh, timestamped open-interest history is unavailable.'] : []),
    ...(!orderBook ? ['Order book is unavailable in the current snapshot.'] : []),
    ...(!ticker ? ['Ticker is unavailable; reference price will use the completed candle close.'] : []),
    ...(snapshot.fundingRate === null ? ['Funding data is unavailable in the current snapshot.'] : []),
  ];
  const candlesFeed = createMarketFeedQuality({
    feedName: 'Freqtrade completed candles',
    source: snapshot.source,
    status: candleFresh ? 'LIVE' : 'UNAVAILABLE',
    timestamp: candleCloseTimestampMs ?? snapshot.generatedAtMs,
    ageMs: candleAgeMs,
    maxAgeMs: candleMaxAgeMs,
    score: candleFresh ? 100 : 0,
    detailsFa: candleFresh ? 'کندل‌های تکمیل‌شده با cadence پیوسته از snapshot داخلی Freqtrade.' : 'کندل ناقص، کهنه یا دارای فاصلهٔ زمانی نامعتبر است.',
  });
  const orderBookFeed = createMarketFeedQuality({
    feedName: 'Freqtrade order book',
    source: snapshot.source,
    status: orderBookFresh ? 'LIVE' : 'UNAVAILABLE',
    timestamp: orderBook?.timestamp ?? snapshot.generatedAtMs,
    ageMs: orderBook?.ageMs ?? Number.POSITIVE_INFINITY,
    score: orderBookFresh ? 100 : 0,
    detailsFa: orderBookFresh ? 'دفتر سفارش تازه و معتبر از snapshot داخلی Freqtrade.' : 'دفتر سفارش تازه و معتبر در snapshot موجود نیست.',
  });
  const unavailableFeed = (feedName: string, detailsFa: string) => createMarketFeedQuality({
    feedName,
    source: snapshot.source,
    status: 'UNAVAILABLE',
    timestamp: snapshot.generatedAtMs,
    ageMs: Number.POSITIVE_INFINITY,
    score: 0,
    detailsFa,
  });
  const pricesFeed = createMarketFeedQuality({
    feedName: 'Freqtrade ticker',
    source: snapshot.source,
    status: tickerLive ? 'LIVE' : 'UNAVAILABLE',
    timestamp: ticker?.retrievedAtMs ?? snapshot.generatedAtMs,
    ageMs: tickerAgeMs,
    maxAgeMs: 5_000,
    score: tickerLive ? 100 : 0,
    detailsFa: tickerLive ? 'Ticker تازه با Last، Mark و Index از snapshot داخلی Freqtrade.' : 'Ticker تازه با قیمت‌های موردنیاز در snapshot موجود نیست.',
  });
  const orderFlowFeed = createMarketFeedQuality({
    feedName: 'Freqtrade recent public trades / taker flow',
    source: orderFlow.source ?? snapshot.source,
    status: hasFreshTradeFlow ? 'LIVE' : 'UNAVAILABLE',
    timestamp: orderFlow.timestampUtc ?? snapshot.generatedAtMs,
    ageMs: orderFlow.ageMs ?? Number.POSITIVE_INFINITY,
    maxAgeMs: FREQTRADE_TRADE_FLOW_MAX_AGE_MS,
    score: hasFreshTradeFlow ? 100 : 0,
    detailsFa: hasFreshTradeFlow
      ? `جریان معاملات واقعی در پنجرهٔ کوتاه دریافت شد (${tradeFlow?.trades.length} معامله).`
      : 'تاریخچهٔ معاملات تازه برای محاسبهٔ CVD/taker flow در دسترس نیست.',
  });
  const derivativesFeed = createMarketFeedQuality({
    feedName: 'Freqtrade CCXT open-interest history / funding',
    source: 'freqtrade.dataprovider.ccxt.fetch_open_interest_history',
    status: derivativesLive ? 'LIVE' : 'UNAVAILABLE',
    timestamp: openInterest?.latestTimestampMs ?? snapshot.generatedAtMs,
    ageMs: Math.max(openInterestAgeMs, fundingAgeMs),
    maxAgeMs: 10 * 60_000,
    score: derivativesLive ? 100 : 0,
    detailsFa: derivativesLive
      ? 'دو رکورد پنج‌دقیقه‌ای سود باز و Funding تازه از صرافی دریافت شد.'
      : 'تاریخچهٔ معتبر Open Interest یا Funding در snapshot موجود نیست.',
  });
  const dataQuality: DataQualityReport = {
    overallScore: Math.round(
      [candleFresh, orderBookFresh, tickerLive, hasFreshTradeFlow, snapshotFresh, derivativesLive].filter(Boolean).length / 6 * 100,
    ),
    isTradeAllowed: executionFeedsAvailable,
    status: executionFeedsAvailable ? 'LIVE' : 'DATA_UNAVAILABLE',
    reasonsFa: unavailableInputs,
    feeds: {
      candles: candlesFeed,
      orderBook: orderBookFeed,
      derivatives: derivativesFeed,
      futuresPrices: pricesFeed,
      sentiment: unavailableFeed('Fear and Greed sentiment', 'Sentiment در snapshot موجود نیست.'),
      orderFlow: orderFlowFeed,
    },
  };

  return {
    fearAndGreed: {
      value: null,
      sent: 'UNAVAILABLE',
      status: 'UNAVAILABLE',
      source: snapshot.source,
      ageMs: Number.POSITIVE_INFINITY,
    },
    sentiment: {
      score: null,
      label: 'UNAVAILABLE',
      trend: 'UNAVAILABLE',
      drivers: [],
      status: 'UNAVAILABLE',
    },
    derivatives: {
      funding: fundingFresh ? fundingRate?.rate ?? null : null,
      oi: openInterestFresh ? openInterest?.latestAmount ?? null : null,
      oiChangePct: openInterestFresh && Number.isFinite(oiChangePct) ? oiChangePct : null,
      status: derivativesLive ? 'LIVE' : 'UNAVAILABLE',
      timestampUtc: openInterestFresh ? openInterest?.latestTimestampMs ?? 0 : snapshot.generatedAtMs,
      ageMs: Math.max(openInterestAgeMs, fundingAgeMs),
      source: 'freqtrade.dataprovider.ccxt.fetch_open_interest_history',
      ...(!derivativesLive ? { error: 'Fresh verified open-interest history and funding are both required.' } : {}),
    },
    dataQuality,
    orderBook,
    futuresPrices,
    orderFlow,
    unavailableInputs,
  };
}

async function analyzeOpenSourceAdvisories(
  snapshot: FreqtradeMarketSnapshot,
  nowMs: number,
): Promise<void> {
  const completedSnapshotCandles = snapshot.candles
    .filter((candle) => candle.timestampMs + timeframeToMs(snapshot.timeframe) <= nowMs);
  const candleTimestampMs = completedSnapshotCandles.at(-1)?.timestampMs ?? snapshot.generatedAtMs;
  const advisoryCandles = completedSnapshotCandles.slice(-500);
  const advisoryTimestampMs = advisoryCandles.at(-1)?.timestampMs ?? candleTimestampMs;
  let sourceHeadlines: Awaited<ReturnType<typeof fetchDirectNewsHeadlines>>['headlines'] = [];
  let newsHeadlinesRetrievedAtMs: number | null = null;
  try {
    if (advisoryCandles.length === 0) {
      throw new Error('No completed candles are available for open-source advisory analysis.');
    }
    const newsResult = await fetchDirectNewsHeadlines();
    sourceHeadlines = newsResult.headlines;
    newsHeadlinesRetrievedAtMs = newsResult.retrievedAtMs;
    const report = await openSourceAdvisoryService.analyze(advisoryCandles, newsResult.headlines);
    if (report.sourceTimestampMs !== advisoryTimestampMs) {
      throw new Error('Open-source advisory output does not match the analyzed completed candle.');
    }
    report.sourceHeadlines = sourceHeadlines;
    report.newsHeadlinesRetrievedAtMs = newsHeadlinesRetrievedAtMs;
    await appendAdvisoryReport(report);
  } catch (error: unknown) {
    console.error('[SBK1_ADVISORIES] Local open-source analysis failed; council receives unavailable evidence:', error);
    const reason = error instanceof Error ? error.message : String(error);
    const report = openSourceAdvisoryService.publishUnavailable(
      reason,
      advisoryTimestampMs,
      Date.now(),
    );
    report.sourceHeadlines = sourceHeadlines;
    report.newsHeadlinesRetrievedAtMs = newsHeadlinesRetrievedAtMs;
    await appendAdvisoryReport(report);
  }
}

async function analyzeSnapshotData(
  snapshot: FreqtradeMarketSnapshot,
  candles: Candle[],
  nowMs: number,
  balance: number,
  requestAdvisories = false,
): Promise<AnalysisResult> {
  const inputs = makeSnapshotAnalysisInputs(snapshot, candles, nowMs);
  const { analyzePro } = await import('./analysisEngine');
  const informativeCandles = Object.fromEntries(
    Object.entries(snapshot.additionalCandles).map(([timeframe, entries]) => [
      timeframe,
      entries?.filter((candle) => candle.timestampMs + timeframeToMs(timeframe) <= nowMs).map(toCandleTuple) ?? [],
    ]),
  );
  const analysis = analyzePro(
    candles,
    inputs.fearAndGreed,
    inputs.sentiment,
    informativeCandles,
    inputs.derivatives,
    inputs.orderBook?.obi ?? 0,
    balance,
    1.5,
    candles,
    'LIVE',
    inputs.dataQuality,
    inputs.orderBook,
    undefined,
    inputs.futuresPrices,
    inputs.orderFlow,
  );
  analysis.htfCandles = informativeCandles;
  analysis.timeframe = snapshot.timeframe;
  const informativeCloseTimestamp = (timeframe: string): number | null => {
    const latest = snapshot.additionalCandles[timeframe]
      ?.filter((candle) => candle.timestampMs + timeframeToMs(timeframe) <= nowMs)
      .at(-1);
    return latest ? latest.timestampMs + timeframeToMs(timeframe) : null;
  };
  analysis.signalDataTimestamps = {
    fundingRateMs: snapshot.fundingRate?.retrievedAtMs ?? null,
    openInterestMs: snapshot.openInterest?.latestTimestampMs ?? null,
    mtf1mMs: informativeCloseTimestamp('1m'),
    mtf5mMs: informativeCloseTimestamp('5m'),
    mtf1hMs: informativeCloseTimestamp('1h'),
    mtf4hMs: informativeCloseTimestamp('4h'),
  };
  if (requestAdvisories && !openSourceAdvisoryService.isStopped()) {
    void analyzeOpenSourceAdvisories(snapshot, nowMs).catch((error: unknown) => {
      console.error('[SBK1_ADVISORIES] Background advisory task failed:', error);
    });
  }
  return analysis;
}

function makeServerFeatureSnapshot(
  analysis: AnalysisResult,
): OperationalTradeArchiveMetadata['featureSnapshot'] {
  const latestCandle = analysis.candles.at(-1);
  return {
    price: analysis.price,
    rsi: analysis.rsi ?? null,
    adx: analysis.adx ?? null,
    volatilityPct: analysis.volatilityPct ?? null,
    ema20: analysis.ema20Val ?? null,
    ema50: analysis.ema50Val ?? null,
    ema200: analysis.ema200Val ?? null,
    scoreLong: analysis.scoreLong ?? null,
    scoreShort: analysis.scoreShort ?? null,
    obi: analysis.realObiData?.obi ?? analysis.obi ?? null,
    atr: analysis.atr ?? null,
    fundingRate: analysis.fundingRate ?? null,
    marketRegime: analysis.marketRegime ?? null,
    timeframe: analysis.timeframe ?? null,
    setupType: analysis.setupContext?.setupType ?? null,
    candleOpen: latestCandle?.[0] ?? null,
    candleHigh: latestCandle?.[1] ?? null,
    candleLow: latestCandle?.[2] ?? null,
    candleClose: latestCandle?.[3] ?? null,
    candleVolume: latestCandle?.[4] ?? null,
    openSourceAdvisoryStatus: analysis.openSourceAdvisories?.status ?? 'UNAVAILABLE',
    openSourceAdvisoryTimestampMs: analysis.openSourceAdvisories?.generatedAtMs ?? null,
  };
}

export async function applyPublicMarketFallbackToCouncilAnalysis(
  analysis: AnalysisResult,
  fallback: Awaited<ReturnType<typeof fetchPublicMarketFallback>>,
  nowMs: number,
): Promise<AnalysisResult> {
  const timeframeMatch = typeof analysis.timeframe === 'string'
    ? /^(\d+)([mhdw])$/.exec(analysis.timeframe)
    : null;
  const timeframeUnitMs: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  const candleFreshnessLimitMs = timeframeMatch
    ? Number(timeframeMatch[1]) * timeframeUnitMs[timeframeMatch[2]] + 60_000
    : 15_000;
  const existingQuality = analysis.dataQualityReport;
  const existingFeeds = existingQuality?.feeds;
  const isPrimaryFeedFresh = (
    feed: DataQualityReport['feeds'][keyof DataQualityReport['feeds']] | undefined,
    maxAgeMs: number,
  ): boolean => Boolean(
    feed &&
    feed.status === 'LIVE' &&
    Number.isFinite(feed.timestamp) &&
    feed.timestamp <= nowMs &&
    nowMs - feed.timestamp <= Math.min(feed.maxAgeMs ?? maxAgeMs, maxAgeMs),
  );
  const candlesFallback = fallback.candles.status === 'LIVE' &&
    fallback.candles.value !== null &&
    fallback.candles.sourceTimestampMs !== null;
  const primaryCandlesUsable = isPrimaryFeedFresh(existingFeeds?.candles, candleFreshnessLimitMs) &&
    analysis.candles.length >= 30 &&
    analysis.candles.every((candle) =>
      Number.isFinite(candle[3]) && candle[3] > 0,
    );
  const useFallbackCandles = !primaryCandlesUsable &&
    candlesFallback &&
    fallback.candles.value!.length >= 30;

  const fallbackTradeDeduplication = fallback.tradeFlow.value
    ? deduplicateTrades(fallback.tradeFlow.value.trades.map((trade) => ({
      ...trade,
      venue: trade.venue ?? fallback.venue,
      symbol: trade.symbol ?? fallback.pair,
    })))
    : null;
  const tradeFallback = fallback.tradeFlow.status === 'LIVE' &&
    fallback.tradeFlow.value !== null &&
    fallbackTradeDeduplication !== null &&
    !fallbackTradeDeduplication.conflictingIdentity &&
    fallbackTradeDeduplication.values.length > 0 &&
    fallback.tradeFlow.sourceTimestampMs !== null;
  const primaryTrades = analysis.orderFlowFeatures;
  const primaryTradesUsable = isPrimaryFeedFresh(existingFeeds?.orderFlow, FREQTRADE_TRADE_FLOW_MAX_AGE_MS) &&
    primaryTrades?.isRealTradeFlow === true &&
    primaryTrades.status === 'LIVE' &&
    Number.isFinite(primaryTrades.timestampUtc) &&
    Number.isFinite(primaryTrades.cvdDeltaUsd ?? primaryTrades.cvdDelta);
  const useFallbackTrades = !primaryTradesUsable &&
    tradeFallback;

  const bookFallback = fallback.orderBook.status === 'LIVE' &&
    fallback.orderBook.value !== null &&
    fallback.orderBook.sourceTimestampMs !== null;
  const primaryBook = analysis.realObiData;
  const primaryBookUsable = isPrimaryFeedFresh(existingFeeds?.orderBook, 5_000) &&
    primaryBook?.status === 'LIVE' &&
    Number.isFinite(primaryBook.obi) &&
    Number.isFinite(primaryBook.bidDepthUsd) &&
    Number.isFinite(primaryBook.askDepthUsd) &&
    primaryBook.bidDepthUsd + primaryBook.askDepthUsd > 0 &&
    primaryBook.levelsCount > 0;
  const useFallbackBook = !primaryBookUsable &&
    bookFallback;

  const fundingFallback = fallback.fundingRate.status === 'LIVE' &&
    fallback.fundingRate.value !== null &&
    fallback.fundingRate.sourceTimestampMs !== null;
  const liveOiFallback = fallback.liveOpenInterest.status === 'LIVE' &&
    fallback.liveOpenInterest.value !== null &&
    fallback.liveOpenInterest.sourceTimestampMs !== null;
  const fastCandles = fallback.fastCandles.status === 'LIVE' &&
    fallback.fastCandles.value !== null &&
    fallback.fastCandles.sourceTimestampMs !== null &&
    fallback.fastCandles.sourceTimestampMs <= nowMs
    ? fallback.fastCandles
    : null;
  const fastCandlesTimestampMs = fastCandles?.sourceTimestampMs ?? null;
  const existingFastCandlesTimestampMs = analysis.signalDataTimestamps?.mtf1mMs ?? null;
  const useFastFallbackCandles = fastCandlesTimestampMs !== null &&
    (existingFastCandlesTimestampMs === null ||
      fastCandlesTimestampMs > existingFastCandlesTimestampMs);
  const useFallbackHigherTimeframe = (timeframe: '1h' | '4h'): boolean => {
    const feed = fallback.higherTimeframeCandles[timeframe];
    const existingTimestamp = analysis.signalDataTimestamps?.[
      timeframe === '1h' ? 'mtf1hMs' : 'mtf4hMs'
    ];
    return feed.status === 'LIVE' &&
      feed.value !== null &&
      feed.sourceTimestampMs !== null &&
      feed.sourceTimestampMs <= nowMs &&
      (existingTimestamp == null || feed.sourceTimestampMs > existingTimestamp);
  };
  const useFallback1hCandles = useFallbackHigherTimeframe('1h');
  const useFallback4hCandles = useFallbackHigherTimeframe('4h');
  const primaryOpenInterestFresh = analysis.signalDataTimestamps?.openInterestMs !== undefined &&
    analysis.signalDataTimestamps.openInterestMs !== null &&
    nowMs >= analysis.signalDataTimestamps.openInterestMs &&
    nowMs - analysis.signalDataTimestamps.openInterestMs <= 10_000;
  const primaryDerivativesFresh = isPrimaryFeedFresh(existingFeeds?.derivatives, 60_000) &&
    typeof analysis.fundingRate === 'number' &&
    Number.isFinite(analysis.fundingRate) &&
    typeof analysis.oi === 'number' &&
    Number.isFinite(analysis.oi) &&
    analysis.oi > 0 &&
    primaryOpenInterestFresh;
  const useFallbackDerivatives = !primaryDerivativesFresh && fundingFallback && liveOiFallback;

  if (!useFallbackCandles && !useFallbackTrades && !useFallbackBook &&
      !useFallbackDerivatives && !useFastFallbackCandles &&
      !useFallback1hCandles && !useFallback4hCandles) {
    return analysis;
  }

  const unavailableFeed = (feedName: string) => createMarketFeedQuality({
    feedName,
    source: 'No verified source in this analysis snapshot',
    status: 'UNAVAILABLE',
    timestamp: nowMs,
    ageMs: Number.POSITIVE_INFINITY,
    score: 0,
    detailsFa: 'فید معتبر در snapshot تحلیل وجود ندارد.',
  });
  const feeds = existingFeeds ? { ...existingFeeds } : {
    candles: unavailableFeed('candles'),
    orderBook: unavailableFeed('orderBook'),
    derivatives: unavailableFeed('derivatives'),
    futuresPrices: unavailableFeed('futuresPrices'),
    sentiment: unavailableFeed('sentiment'),
    orderFlow: unavailableFeed('orderFlow'),
  };
  const cloneFeed = (
    feedName: string,
    sourceTimestampMs: number,
    maxAgeMs: number,
    detailsFa: string,
  ) => createMarketFeedQuality({
    feedName,
    source: fallback.provider,
    status: 'LIVE',
    timestamp: sourceTimestampMs,
    ageMs: Math.max(0, nowMs - sourceTimestampMs),
    maxAgeMs,
    score: 90,
    detailsFa,
  });

  const fallbackCandles = useFallbackCandles ? fallback.candles.value! : null;
  const fallbackTrades = useFallbackTrades
    ? {
      ...fallback.tradeFlow.value!,
      trades: fallbackTradeDeduplication!.values,
    }
    : null;
  const fallbackBook = useFallbackBook ? fallback.orderBook.value! : null;
  const fallbackFunding = useFallbackDerivatives ? fallback.fundingRate.value! : null;
  const fallbackOi = useFallbackDerivatives ? fallback.liveOpenInterest.value! : null;
  if (feeds && fallbackCandles) {
    feeds.candles = cloneFeed(
      `${fallback.provider} completed candles`,
      fallback.candles.sourceTimestampMs!,
      candleFreshnessLimitMs,
      `${fallback.pair} تکمیل‌شده؛ ورودی جایگزین عضو ۱.`,
    );
  }
  if (feeds && fallbackTrades) {
    feeds.orderFlow = cloneFeed(
      `${fallback.provider} recent aggregate trades`,
      fallback.tradeFlow.sourceTimestampMs!,
      FREQTRADE_TRADE_FLOW_MAX_AGE_MS,
      `${fallbackTrades.trades.length} معاملهٔ یکتا از ${(fallback.tradeFlow.value?.duplicateCount ?? 0) + (fallbackTradeDeduplication?.duplicateCount ?? 0)} تکراری برای محاسبهٔ CVD عضو ۲.`,
    );
  }
  if (feeds && fallbackBook) {
    feeds.orderBook = cloneFeed(
      `${fallback.provider} order book`,
      fallback.orderBook.sourceTimestampMs!,
      5_000,
      'دفتر سفارش عمومی تازه برای عضو ۳.',
    );
  }
  if (feeds && fallbackFunding && fallbackOi) {
    feeds.derivatives = cloneFeed(
      `${fallback.provider} funding and current open interest`,
      Math.min(fallback.fundingRate.sourceTimestampMs!, fallback.liveOpenInterest.sourceTimestampMs!),
      60_000,
      'Funding تازه و OI لحظه‌ای از بازار آتی عمومی برای عضو ۴.',
    );
  }

  const buyTrades = fallbackTrades?.trades.filter((trade) => trade.side === 'buy') ?? [];
  const sellTrades = fallbackTrades?.trades.filter((trade) => trade.side === 'sell') ?? [];
  const buyVolume = buyTrades.reduce((sum, trade) => sum + trade.amount, 0);
  const sellVolume = sellTrades.reduce((sum, trade) => sum + trade.amount, 0);
  const latestTradeTimestampMs = fallbackTrades?.trades.at(-1)?.timestampMs;
  const bidDepthUsd = fallbackBook?.bids.reduce((sum, level) => sum + level.price * level.amount, 0);
  const askDepthUsd = fallbackBook?.asks.reduce((sum, level) => sum + level.price * level.amount, 0);
  const fallbackFundingRate = fallbackFunding?.rate;
  const fallbackOpenInterest = fallbackOi?.amount;
  const fallbackCandlesTuple = fallbackCandles?.map((candle) => [
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ] as Candle);
  const fastFallbackCandlesTuple = useFastFallbackCandles
    ? fastCandles!.value!.map((candle) => [
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ] as Candle)
    : null;
  const fallback1hCandlesTuple = useFallback1hCandles
    ? fallback.higherTimeframeCandles['1h'].value!.map((candle) => [
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ] as Candle)
    : null;
  const fallback4hCandlesTuple = useFallback4hCandles
    ? fallback.higherTimeframeCandles['4h'].value!.map((candle) => [
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ] as Candle)
    : null;

  const councilAnalysis: AnalysisResult = {
    ...analysis,
    signalDataTimestamps: {
      ...analysis.signalDataTimestamps,
      ...(fastFallbackCandlesTuple && fastCandlesTimestampMs !== null
        ? {
          mtf1mMs: fastCandlesTimestampMs,
          mtf1mIsPartial: fastCandles?.isPartial === true,
        }
        : {}),
      ...(fallback1hCandlesTuple
        ? { mtf1hMs: fallback.higherTimeframeCandles['1h'].sourceTimestampMs }
        : {}),
      ...(fallback4hCandlesTuple
        ? { mtf4hMs: fallback.higherTimeframeCandles['4h'].sourceTimestampMs }
        : {}),
      ...(useFallbackDerivatives ? {
        fundingRateMs: fallback.fundingRate.sourceTimestampMs,
        openInterestMs: fallback.liveOpenInterest.sourceTimestampMs,
      } : {}),
    },
    ...(fastFallbackCandlesTuple || fallback1hCandlesTuple || fallback4hCandlesTuple ? {
      htfCandles: {
        ...analysis.htfCandles,
        ...(fastFallbackCandlesTuple ? { '1m': fastFallbackCandlesTuple } : {}),
        ...(fallback1hCandlesTuple ? { '1h': fallback1hCandlesTuple } : {}),
        ...(fallback4hCandlesTuple ? { '4h': fallback4hCandlesTuple } : {}),
      },
    } : {}),
    ...(fallbackCandlesTuple ? { candles: fallbackCandlesTuple } : {}),
    ...(typeof fallbackFundingRate === 'number' ? {
      funding: fallbackFundingRate,
      fundingRate: fallbackFundingRate,
    } : {}),
    ...(typeof fallbackOpenInterest === 'number' ? { oi: fallbackOpenInterest } : {}),
    ...(fallbackTrades && typeof latestTradeTimestampMs === 'number' ? {
      orderFlowFeatures: {
        cvdDelta: buyVolume - sellVolume,
        cvdDeltaUsd: buyTrades.reduce((sum, trade) => sum + trade.amount * trade.price, 0) -
          sellTrades.reduce((sum, trade) => sum + trade.amount * trade.price, 0),
        cvdDivergence: 'BINANCE_PUBLIC_AGG_TRADES',
        takerBuyVol: buyVolume,
        takerSellVol: sellVolume,
        takerRatio: buyVolume + sellVolume > 0 ? buyVolume / (buyVolume + sellVolume) : null,
        takerDelta: buyVolume - sellVolume,
        delta: buyVolume - sellVolume,
        cumulativeDelta: buyVolume - sellVolume,
        deltaVelocity: buyVolume - sellVolume,
        isRealTradeFlow: true,
        uniqueTradeCount: fallbackTrades.trades.length,
        duplicateTradeCount: (fallback.tradeFlow.value?.duplicateCount ?? 0) +
          (fallbackTradeDeduplication?.duplicateCount ?? 0),
        status: 'LIVE',
        timestampUtc: latestTradeTimestampMs,
        ageMs: nowMs - latestTradeTimestampMs,
        latencyMs: null,
        source: `${fallback.provider} ${fallback.market} aggregate trades (${fallback.pair})`,
      },
    } : {}),
    ...(fallbackBook && bidDepthUsd !== undefined && askDepthUsd !== undefined ? {
      realObiData: {
        venue: fallback.venue,
        symbol: fallback.pair,
        ...(fallbackBook.sequenceId === undefined ? {} : { sequenceId: fallbackBook.sequenceId }),
        duplicateSnapshotCount: fallbackBook.duplicateSnapshotCount ?? 0,
        obi: bidDepthUsd + askDepthUsd > 0
          ? (bidDepthUsd - askDepthUsd) / (bidDepthUsd + askDepthUsd)
          : null,
        bidDepthUsd,
        askDepthUsd,
        bestBid: fallbackBook.bids[0]?.price ?? null,
        bestAsk: fallbackBook.asks[0]?.price ?? null,
        spreadUsd: fallbackBook.bids[0] && fallbackBook.asks[0]
          ? fallbackBook.asks[0].price - fallbackBook.bids[0].price
          : null,
        levelsCount: Math.min(fallbackBook.bids.length, fallbackBook.asks.length),
        status: 'LIVE',
        timestamp: fallbackBook.timestampMs,
        ageMs: nowMs - fallbackBook.timestampMs,
        latencyMs: null,
        source: `${fallback.provider} ${fallback.market} depth (${fallback.pair})`,
      },
    } : {}),
    ...(feeds ? {
      dataQualityReport: {
        ...(existingQuality ?? {
          overallScore: 0,
          isTradeAllowed: false,
          status: 'DATA_UNAVAILABLE' as const,
          reasonsFa: [],
        }),
        feeds,
        reasonsFa: [
          ...(existingQuality?.reasonsFa ?? []),
          `Fallback council evidence: ${fallback.provider} ${fallback.market} ${fallback.pair}.`,
        ],
      },
    } : {}),
  };
  if (fallback1hCandlesTuple || fallback4hCandlesTuple) {
    const { analyzeHtfTrend } = await import('./analysisEngine');
    if (fallback1hCandlesTuple) {
      councilAnalysis.mtf1h = analyzeHtfTrend(fallback1hCandlesTuple);
    }
    if (fallback4hCandlesTuple) {
      councilAnalysis.mtf4h = analyzeHtfTrend(fallback4hCandlesTuple);
    }
  }
  return councilAnalysis;
}

async function analyzeSnapshot(
  snapshot: FreqtradeMarketSnapshot,
  candles: Candle[],
  nowMs: number,
  balance: number,
  signalSettings: ReturnType<typeof readSignalSettings> = readSignalSettings(),
  availableBalance: number = balance,
  openRiskUsd = 0,
  dailyLossUsd = 0,
  maxOpenTrades = SBK_MAX_OPEN_TRADES,
): Promise<{
  candidate: DirectionalSignalCandidate | null;
  reason: string;
  holdingHorizon?: HoldingHorizonDecision;
  executionRisk?: { maxStakeQuote: number; maxLeverage: number; allocatedRiskUsd: number };
  authorization?: Omit<SbkEntryAuthorization, 'decisionId' | 'allocatedRiskUsd'>;
  featureSnapshot: OperationalTradeArchiveMetadata['featureSnapshot'];
  featureVersion: string;
  modelVersion: string;
  openSourceAdvisories?: OpenSourceAdvisoryReport;
}> {
  const analysis = await analyzeSnapshotData(snapshot, candles, nowMs, balance, true);
  const [freeMacroData, optionsData, whaleFlowData, publicMarketFallback] = await Promise.all([
    fetchFreeMacroData(),
    fetchDeribitOptionsData({ nowMs }),
    fetchOnChainWhaleData({ nowMs, btcPriceUsd: analysis.price }),
    fetchPublicMarketFallback({
      pair: snapshot.pair,
      timeframe: snapshot.timeframe,
      market: snapshot.market,
      nowMs,
    }),
  ]);
  const councilEvaluationNowMs = Math.max(nowMs, Date.now());
  const latestCompletedCandleTimestampMs = snapshot.candles
    .filter((candle) => candle.timestampMs + timeframeToMs(snapshot.timeframe) <= councilEvaluationNowMs)
    .at(-1)?.timestampMs;
  const readyAdvisory = openSourceAdvisoryService.getLatest();
  if (
    readyAdvisory &&
    readyAdvisory.sourceTimestampMs === latestCompletedCandleTimestampMs &&
    readyAdvisory.generatedAtMs <= councilEvaluationNowMs &&
    councilEvaluationNowMs - readyAdvisory.generatedAtMs <= MAX_READY_ADVISORY_AGE_MS
  ) {
    analysis.openSourceAdvisories = readyAdvisory;
  }
  const councilAnalysis = await applyPublicMarketFallbackToCouncilAnalysis(
    analysis,
    publicMarketFallback,
    councilEvaluationNowMs,
  );
  const macroContext = macroContextBrainService.getCachedMacroContext();
  const { runUnifiedMultiBrainEnsemble } = await import('./multiBrainEnsemble');
  const historicalCandles = snapshot.candles;
  const patternCosts = historicalPatternCostConfig();
  const multiBrainReport = runUnifiedMultiBrainEnsemble(
    analysis,
    null,
    analysis.price,
    [],
    {
      candles: historicalCandles.map(({ open, high, low, close, volume }) =>
        [open, high, low, close, volume] as Candle
      ),
      exchange: snapshot.exchange,
      market: snapshot.market,
      pair: snapshot.pair,
      sourceTimestampMs: historicalCandles.at(-1)
        ? historicalCandles.at(-1)!.timestampMs + timeframeToMs(snapshot.timeframe)
        : Number.NaN,
      dataStatus: historicalCandles.length > 0 ? 'LIVE' : 'UNAVAILABLE',
      ...patternCosts,
    },
  );
  const sbReport = sbFiveModelsEngine.evaluatePentagon(analysis, null, analysis.price);
  const decisionSnapshotTimestampMs = snapshot.candles
    .filter((candle) => candle.timestampMs + timeframeToMs(snapshot.timeframe) <= nowMs)
    .at(-1)?.timestampMs;
  const councilReport = await runEightMemberCouncilRuntime({
    analysis: councilAnalysis,
    multiBrainReport,
    sbReport,
    macroContext,
    freeMacroData,
    optionsData,
    whaleFlowData,
    publicMarketFallback,
    decisionSnapshotTimestampMs,
    nowMs: councilEvaluationNowMs,
  });

  if (!councilReport.quorumMet || !councilReport.selectedDirection) {
    return {
      candidate: null,
      reason: `Council quorum not met; no directional pipeline, leverage, margin, or Freqtrade signal was produced. ${councilReport.summaryFa}`,
      openSourceAdvisories: analysis.openSourceAdvisories,
      featureSnapshot: makeServerFeatureSnapshot(analysis),
      featureVersion: 'server-signal-features-v1',
      modelVersion: analysis.calibratedMetadata?.modelVersion ?? 'analysis-engine-current',
    };
  }

  const control = runPostCouncilTradeControl({
    analysis,
    council: councilReport,
    balance,
    maxStakeQuote: Math.min(signalSettings.maxStakeQuote, availableBalance),
    maxLeverage: signalSettings.maxLeverage,
    riskBudgetPct: signalSettings.riskBudgetPct,
    maxAtrPct: signalSettings.maxAtrPct,
    referencePrice: analysis.futuresPrices?.lastPrice ?? Number.NaN,
    maxDeviationBps: signalSettings.maxDeviationBps,
    maxOpenTrades,
    openRiskUsd,
    dailyLossUsd,
    dailyLossLimitPct: signalSettings.dailyLossLimitPct,
    marketIdentity: {
      exchange: snapshot.exchange,
      market: snapshot.market,
      pair: snapshot.pair,
    },
    candleResearch: multiBrainReport.historicalCandleResearch,
    nowMs: councilEvaluationNowMs,
  });
  const approved = control.approved;
  const latestCandle = analysis.candles.at(-1);
  const executionPlan = control.executionPlan;
  return {
    candidate: approved && executionPlan
      ? {
        direction: executionPlan.direction,
        entryPrice: executionPlan.entryPrice,
        stopLoss: executionPlan.stopLoss,
        takeProfit: executionPlan.takeProfit,
        engineScore: analysis.confScore,
        setupType: executionPlan.setupType,
      }
      : null,
    ...(approved && control.executionRisk ? { executionRisk: control.executionRisk } : {}),
    reason: control.reason,
    holdingHorizon: control.holdingHorizon,
    openSourceAdvisories: analysis.openSourceAdvisories,
    ...(approved && executionPlan ? {
      authorization: {
        contractVersion: 'sbk1.entry.authorization.v2',
        decision: 'APPROVE_ENTRY' as const,
        snapshotId: `SNP_${snapshot.generatedAtMs}_${latestCandle?.[0] ?? 0}`,
        snapshotTimestampMs: snapshot.generatedAtMs,
        evaluatedAtMs: nowMs,
        timeframe: snapshot.timeframe,
        direction: executionPlan.direction,
        gates: control.gates.map((gate) => ({
          id: gate.id,
          status: gate.passed ? 'PASSED' as const : 'FAILED' as const,
          reason: gate.reason,
        })),
        models: [],
        disagreementVeto: false,
        ensembleProbabilityPct: null,
        riskRewardRatio: executionPlan.riskRewardRatio,
        holdingHorizonMinutes: executionPlan.holdingHorizon.selectedHorizonMinutes!,
      },
    } : {}),
    featureSnapshot: makeServerFeatureSnapshot(analysis),
    featureVersion: 'server-signal-features-v1',
    modelVersion: analysis.calibratedMetadata?.modelVersion ?? 'analysis-engine-current',
  };
}

async function evaluateManagedExit(
  snapshot: FreqtradeMarketSnapshot,
  candles: Candle[],
  nowMs: number,
  trade: FreqtradeTrade,
  entrySignal: SbkFreqtradeSignalRecord,
): Promise<{ shouldExit: boolean; reason: string }> {
  const price = candles.at(-1)?.[4];
  if (!price || !Number.isFinite(price) || price <= 0) {
    return { shouldExit: false, reason: 'No valid completed-candle price is available for exit evaluation.' };
  }
  const signal = entrySignal.signal;
  const analysis = await analyzeSnapshotData(snapshot, candles, nowMs, trade.stake_amount);
  const { tradeThesisAndSmartExitEngine } = await import('./tradeThesisAndSmartExitEngine');
  const { trendSurvivalAndMfeTrailingEngine } = await import('./trendSurvivalAndMfeTrailingEngine');
  const direction = trade.is_short ? 'SHORT' : 'LONG';
  const entry = trade.open_rate;
  const position: TradePosition = {
    id: String(trade.trade_id),
    dir: direction,
    entry,
    lev: trade.leverage ?? signal.riskLimits.maxLeverage,
    initialMargin: trade.stake_amount,
    margin: trade.stake_amount,
    sl: signal.entryConditions.stopLoss,
    tp: signal.entryConditions.takeProfit,
    tp1: signal.entryConditions.takeProfit,
    tp2: signal.entryConditions.takeProfit,
    tp3: signal.entryConditions.takeProfit,
    openedAt: new Date(trade.open_fill_timestamp ?? signal.generatedAtMs).toISOString(),
    tradeThesis: signal.entryConditions.setupType,
  };
  const thesisEngine = tradeThesisAndSmartExitEngine;
  const thesis = thesisEngine.evaluateTradeThesis(position, price, analysis, candles);
  const smartLoss = thesisEngine.evaluateSmartLossExit(position, price, thesis, analysis);
  const comprehensive = thesisEngine.evaluateComprehensiveExitManagement(position, price, analysis, candles);
  const survival = trendSurvivalAndMfeTrailingEngine.evaluateComprehensiveState({
    direction,
    entryPrice: entry,
    currentPrice: price,
    marginUsd: trade.stake_amount,
    leverage: position.lev,
    rsi: analysis.rsi,
    macdHist: analysis.macdH.at(-1),
    macdHistPrevious: analysis.macdH.at(-2),
    cvdDelta: analysis.orderFlowFeatures?.cvdDelta ?? null,
    cvdSlope: null,
    orderBookImbalance: analysis.realObiData?.obi ?? analysis.obi,
    atrValue: analysis.atr,
  });
  const shouldExit =
    smartLoss.shouldExitImmediately ||
    comprehensive.regimeShiftAndThesis.isThesisInvalidated ||
    comprehensive.liquidityRiskGuard.shouldExitDueToLiquidity ||
    survival.recommendedCompositeAction.actionType === 'FULL_CLOSE';
  const reason = smartLoss.shouldExitImmediately
    ? smartLoss.rationaleFa
    : comprehensive.regimeShiftAndThesis.isThesisInvalidated
      ? comprehensive.regimeShiftAndThesis.actionFa
      : comprehensive.liquidityRiskGuard.shouldExitDueToLiquidity
        ? comprehensive.liquidityRiskGuard.rationaleFa
        : survival.recommendedCompositeAction.reasonFa;
  return { shouldExit, reason };
}

async function appendAudit(record: ServerSignalAuditRecord): Promise<void> {
  const filePath = path.resolve('data/sbk1-execution-audit.jsonl');
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function appendAdvisoryReport(report: OpenSourceAdvisoryReport): Promise<void> {
  try {
    await appendAudit({
      at: new Date(report.generatedAtMs).toISOString(),
      candleTimestampMs: report.sourceTimestampMs,
      decision: 'NO TRADE',
      reason: 'ADVISORY_REPORT: analysis output only; no trade decision was made.',
      eventType: 'ADVISORY_REPORT',
      openSourceAdvisories: report,
    });
  } catch (error) {
    console.error('[SBK1_ADVISORIES] Could not persist advisory report:', error);
  }
}

function runtimeExpectation(status: FreqtradeBotState): FreqtradeMarketSnapshotExpectation {
  const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim() ||
    process.env.FREQTRADE_EXCHANGE?.trim() ||
    status.exchange;
  const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() ||
    process.env.FREQTRADE_PAIR?.trim() ||
    '';
  const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() ||
    process.env.FREQTRADE_TIMEFRAME?.trim() ||
    status.timeframe ||
    '';
  if (!exchange || !pair || !timeframe || !status.market) {
    throw new Error('Freqtrade exchange, pair, market, or timeframe configuration is incomplete.');
  }
  if (timeframe !== SBK_EXECUTION_TIMEFRAME) {
    throw new Error(`SBK1 entry timeframe must be ${SBK_EXECUTION_TIMEFRAME}.`);
  }
  if (
    status.exchange?.toLowerCase() !== exchange.toLowerCase() ||
    status.timeframe !== timeframe
  ) {
    throw new Error('Freqtrade RPC configuration does not match the configured signal market.');
  }
  return { exchange, pair, timeframe, market: status.market };
}

export class ServerSignalRunner {
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly minimumCandles: number;
  private readonly analyze: NonNullable<ServerSignalRunnerDependencies['analyze']>;
  private readonly audit: NonNullable<ServerSignalRunnerDependencies['appendAudit']>;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private lastProcessedCandleMs: number | null = null;

  constructor(private readonly dependencies: ServerSignalRunnerDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.minimumCandles = dependencies.minimumCandles ?? MINIMUM_CANDLES_FOR_ANALYSIS;
    this.analyze = dependencies.analyze ?? analyzeSnapshot;
    this.audit = dependencies.appendAudit ?? appendAudit;
  }

  start(): void {
    if (this.timer) return;
    startPublicBitcoinWhaleDataPrefetch();
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.pollIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([this.inFlight, stopPublicBitcoinWhaleDataPrefetch()]);
  }

  async runOnce(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const operation = this.processSnapshot();
    this.inFlight = operation;
    try {
      await operation;
    } finally {
      this.inFlight = null;
    }
  }

  private async record(record: Omit<ServerSignalAuditRecord, 'at'>): Promise<void> {
    try {
      await this.audit({ at: new Date(this.now()).toISOString(), ...record });
    } catch (error) {
      console.error('[SBK1_SIGNAL_RUNNER] Could not append execution audit record:', error);
    }
  }

  private async processSnapshot(): Promise<void> {
    const nowMs = this.now();
    let candleTimestampMs: number | null = null;
    try {
      const status = await this.dependencies.getFreqtradeStatus();
      try {
        await this.dependencies.syncClosedTrades?.(status);
      } catch (error) {
        console.error('[SBK1_SIGNAL_RUNNER] Could not synchronize closed Freqtrade outcomes:', error);
      }
      if (
        status.status !== 'running' ||
        status.forceEntryEnabled !== false ||
        !status.dryRun
      ) {
        await this.record({
          candleTimestampMs: null,
          decision: 'NO TRADE',
          reason: status.forceEntryEnabled !== false
            ? 'Freqtrade force_entry_enable must remain false.'
            : !status.dryRun
              ? 'SBK1 automatic entry signals are disabled unless Freqtrade RPC confirms dry_run=true.'
              : 'Freqtrade RPC reports that the execution engine is not running.',
        });
        return;
      }
      const expected = runtimeExpectation(status);
      const snapshot = this.dependencies.getSnapshot(expected, nowMs);
      if (
        snapshot.exchange.toLowerCase() !== expected.exchange.toLowerCase() ||
        snapshot.market !== expected.market ||
        snapshot.pair !== expected.pair ||
        snapshot.timeframe !== expected.timeframe
      ) {
        throw new Error('Freqtrade snapshot does not match the configured exchange, pair, market, and timeframe.');
      }
      if (
        nowMs - snapshot.generatedAtMs < 0 ||
        nowMs - snapshot.generatedAtMs > FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS
      ) {
        throw new Error('Freqtrade market snapshot is stale.');
      }

      const timeframeMs = timeframeToMs(snapshot.timeframe);
      if (timeframeMs <= 0) throw new Error(`Unsupported Freqtrade timeframe: ${snapshot.timeframe}.`);
      const completedSnapshotCandles = snapshot.candles
        .filter((candle) => candle.timestampMs + timeframeMs <= nowMs);
      const completedCandles = completedSnapshotCandles.map(toCandleTuple);
      const latestCandle = completedCandles.at(-1);
      const latestSnapshotCandle = completedSnapshotCandles.at(-1);
      if (!latestCandle || !latestSnapshotCandle) {
        await this.record({
          candleTimestampMs: null,
          decision: 'NO TRADE',
          reason: 'No completed candle is available in the current Freqtrade snapshot.',
        });
        return;
      }
      candleTimestampMs = latestSnapshotCandle.timestampMs;
      if (this.lastProcessedCandleMs !== null && candleTimestampMs <= this.lastProcessedCandleMs) return;
      this.lastProcessedCandleMs = candleTimestampMs;

      const openTrades = await this.dependencies.getOpenTrades();
      if (!Array.isArray(openTrades)) {
        throw new Error('Freqtrade RPC did not return an open-trades list.');
      }
      const actualOpenTradesCount = openTrades.filter((trade) => trade.is_open).length;
      if (actualOpenTradesCount !== status.openTradesCount) {
        throw new Error('Freqtrade status and open-trade list disagree; portfolio risk cannot be verified.');
      }
      if (completedCandles.length < this.minimumCandles) {
        await this.record({
          candleTimestampMs,
          decision: 'NO TRADE',
          reason: `Only ${completedCandles.length} completed candles are available; ${this.minimumCandles} are required for analysis.`,
        });
        return;
      }
      const settings = readSignalSettings();
      for (const trade of openTrades) {
        if (!trade.is_open || trade.pair !== expected.pair || typeof trade.enter_tag !== 'string') continue;
        const entrySignal = await this.dependencies.getSignal(trade.enter_tag);
        if (
          !entrySignal ||
          entrySignal.status !== 'FILLED' ||
          (entrySignal.tradeId !== undefined && entrySignal.tradeId !== trade.trade_id) ||
          entrySignal.signal.pair !== trade.pair ||
          entrySignal.signal.direction !== (trade.is_short ? 'SHORT' : 'LONG')
        ) {
          continue;
        }
        const exitDecision = await (this.dependencies.evaluateExit ?? evaluateManagedExit)(
          snapshot,
          completedCandles,
          nowMs,
          trade,
          entrySignal,
        );
        if (!exitDecision.shouldExit) continue;
        const exitSignal: SbkFreqtradeExitSignal = {
          contractVersion: SBK_SIGNAL_CONTRACT_VERSION,
          signalType: 'EXIT',
          exitId: deriveSbkExitSignalId({
            tradeId: trade.trade_id,
            entryTag: trade.enter_tag,
            reason: exitDecision.reason,
            generatedAtMs: candleTimestampMs,
          }),
          pair: trade.pair,
          tradeId: trade.trade_id,
          entryTag: trade.enter_tag,
          direction: trade.is_short ? 'SHORT' : 'LONG',
          reason: exitDecision.reason.slice(0, 240),
          generatedAtMs: nowMs,
          expiresAtMs: nowMs + settings.ttlSeconds * 1_000,
        };
        const submitted = await this.dependencies.submitExitSignal(exitSignal, nowMs);
        await this.record({
          candleTimestampMs,
          decision: trade.is_short ? 'SHORT' : 'LONG',
          reason: exitDecision.reason,
          signalId: exitSignal.exitId,
          duplicate: submitted.duplicate === true,
        });
      }
      if (this.dependencies.isKillSwitchActive()) {
        await this.record({
          candleTimestampMs,
          decision: 'NO TRADE',
          reason: 'Manual SBK1 kill switch is active; open-position exits were still evaluated.',
        });
        return;
      }
      if (
        !Number.isSafeInteger(status.openTradesCount) ||
        !Number.isSafeInteger(status.maxOpenTrades) ||
        status.maxOpenTrades <= 0 ||
        status.maxOpenTrades > SBK_MAX_OPEN_TRADES
      ) {
        await this.record({
          candleTimestampMs,
          decision: 'NO TRADE',
          reason: `Freqtrade max_open_trades must be a positive integer no greater than ${SBK_MAX_OPEN_TRADES} for portfolio-risk control.`,
        });
        return;
      }
      if (actualOpenTradesCount >= status.maxOpenTrades) {
        await this.record({
          candleTimestampMs,
          decision: 'NO TRADE',
          reason: `Freqtrade open-trade limit reached (${actualOpenTradesCount}/${status.maxOpenTrades}).`,
        });
        return;
      }

      const balance = await this.dependencies.getFreqtradeBalance();
      if (
        !Number.isFinite(balance.equity) ||
        balance.equity <= 0 ||
        !Number.isFinite(balance.available) ||
        balance.available <= 0
      ) {
        await this.record({
          candleTimestampMs,
          decision: 'NO TRADE',
          reason: 'Freqtrade reports invalid equity or no available quote balance for a valid risk limit.',
        });
        return;
      }
      const openRiskUsd = await calculateOpenTradeRiskUsd(
        openTrades,
        (signalId) => this.dependencies.getSignal(signalId),
      );
      const utcDayStartMs = Date.UTC(
        new Date(nowMs).getUTCFullYear(),
        new Date(nowMs).getUTCMonth(),
        new Date(nowMs).getUTCDate(),
      );
      const dailyLossUsd = await this.dependencies.getDailyRealizedLossUsd(utcDayStartMs, nowMs);
      if (!Number.isFinite(dailyLossUsd) || dailyLossUsd < 0) {
        throw new Error('Freqtrade daily realized loss is invalid; new entries are blocked.');
      }
      if (!this.dependencies.analyze) {
        centralTradeDatasetService.replaceTrainingArchiveRecords(await operationalTradeArchive.getAll());
      }
      const result = await this.analyze(
        snapshot,
        completedCandles,
        nowMs,
        balance.equity,
        settings,
        balance.available,
        openRiskUsd,
        dailyLossUsd,
        status.maxOpenTrades,
      );
      const candidate = result.candidate;
      if (!candidate) {
        await this.record({
          candleTimestampMs,
          decision: 'NO TRADE',
          reason: result.reason,
          unavailableInputs: makeSnapshotAnalysisInputs(snapshot, completedCandles, nowMs).unavailableInputs,
          openSourceAdvisories: result.openSourceAdvisories,
          holdingHorizon: result.holdingHorizon,
        });
        return;
      }
      if (
        !result.authorization ||
        !result.executionRisk ||
        !Number.isFinite(result.executionRisk.allocatedRiskUsd) ||
        result.executionRisk.allocatedRiskUsd <= 0 ||
        result.authorization.decision !== 'APPROVE_ENTRY' ||
        result.authorization.direction !== candidate.direction ||
        !Number.isSafeInteger(result.authorization.holdingHorizonMinutes) ||
        result.authorization.holdingHorizonMinutes < 1 ||
        result.authorization.holdingHorizonMinutes > 60 ||
        result.authorization.timeframe !== expected.timeframe ||
        result.authorization.snapshotTimestampMs !== snapshot.generatedAtMs ||
        result.authorization.gates.length === 0
      ) {
        await this.record({
          candleTimestampMs,
          decision: 'NO TRADE',
          reason: 'The complete decision pipeline did not provide an entry authorization.',
          openSourceAdvisories: result.openSourceAdvisories,
          holdingHorizon: result.holdingHorizon,
        });
        return;
      }

      const referencePrice = latestCandle[3];

      const setupType = `${candidate.setupType}:${candleTimestampMs}`;
      const ids = deriveSbkSignalIds({
        pair: expected.pair,
        direction: candidate.direction,
        setupType,
        generatedAtMs: candleTimestampMs,
        sweptLevelPrice: referencePrice,
        referencePrice,
        stopLoss: candidate.stopLoss,
        takeProfit: candidate.takeProfit,
      });
      const alreadyQueued = await this.dependencies.getSignal(ids.signalId);
      if (alreadyQueued) {
        await this.record({
          candleTimestampMs,
          decision: candidate.direction,
          reason: 'This completed candle already has a persisted Freqtrade signal.',
          signalId: ids.signalId,
          duplicate: true,
          openSourceAdvisories: result.openSourceAdvisories,
        });
        return;
      }

      const maxStakeQuote = Math.min(
        settings.maxStakeQuote,
        balance.available,
        result.executionRisk?.maxStakeQuote ?? Number.POSITIVE_INFINITY,
      );
      const maxLeverage = Math.min(
        settings.maxLeverage,
        result.executionRisk?.maxLeverage ?? settings.maxLeverage,
      );
      const signal: SbkFreqtradeSignal = validateSbkFreqtradeSignal({
        contractVersion: SBK_SIGNAL_CONTRACT_VERSION,
        ...ids,
        exchange: expected.exchange,
        market: expected.market,
        pair: expected.pair,
        direction: candidate.direction,
        timeframe: expected.timeframe,
        generatedAtMs: nowMs,
        expiresAtMs: nowMs + settings.ttlSeconds * 1_000,
        referencePrice,
        engineScore: candidate.engineScore,
        dataQuality: {
          status: 'LIVE',
          source: snapshot.source,
          observedAtMs: snapshot.generatedAtMs,
          maxAgeMs: FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS,
        },
        entryConditions: {
          setupType,
          entryPrice: candidate.entryPrice,
          stopLoss: candidate.stopLoss,
          takeProfit: candidate.takeProfit,
          maxPriceDeviationBps: settings.maxDeviationBps,
          maxHoldingMinutes: result.authorization.holdingHorizonMinutes,
        },
        riskLimits: {
          riskBudgetPct: settings.riskBudgetPct,
          maxStakeQuote,
          maxLeverage,
        },
        authorization: {
          ...result.authorization,
          decisionId: ids.decisionId,
          allocatedRiskUsd: result.executionRisk.allocatedRiskUsd,
        },
      }, {
        nowMs,
        expectedPair: expected.pair,
        expectedExchange: expected.exchange,
        expectedTimeframe: expected.timeframe,
      });
      const submitted = await this.dependencies.submitSignal(signal, {
        expectedPair: expected.pair,
        expectedExchange: expected.exchange,
        expectedTimeframe: expected.timeframe,
      });
      try {
        const featureSnapshot = result.featureSnapshot ?? {
          entryPrice: candidate.entryPrice,
          stopLoss: candidate.stopLoss,
          takeProfit: candidate.takeProfit,
          referencePrice,
          candleOpen: latestCandle[0],
          candleHigh: latestCandle[1],
          candleLow: latestCandle[2],
          candleClose: latestCandle[3],
          candleVolume: latestCandle[4],
          fundingRate: snapshot.fundingRate?.rate ?? null,
          marketRegime: null,
          timeframe: snapshot.timeframe,
          setupType: candidate.setupType,
        };
        await this.dependencies.recordSignalArchive?.(submitted, {
          featureSnapshot,
          featureVersion: result.featureVersion ?? 'server-signal-features-v1',
          modelVersion: result.modelVersion ?? 'server-signal-runner-current',
          codeVersion: process.env.SBK1_CODE_VERSION?.trim() || 'unversioned',
        });
      } catch (error) {
        console.error('[SBK1_SIGNAL_RUNNER] Could not archive signal features:', error);
      }
      await this.record({
        candleTimestampMs,
        decision: candidate.direction,
        reason: submitted.duplicate
          ? 'Freqtrade adapter recognized this signal as an idempotent duplicate.'
          : 'Directional signal was accepted by the Freqtrade adapter.',
        signalId: signal.signalId,
        duplicate: submitted.duplicate === true,
        unavailableInputs: makeSnapshotAnalysisInputs(snapshot, completedCandles, nowMs).unavailableInputs,
        openSourceAdvisories: result.openSourceAdvisories,
        holdingHorizon: result.holdingHorizon,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SBK1_SIGNAL_RUNNER] Candle analysis failed:', error);
      await this.record({
        candleTimestampMs,
        decision: 'NO TRADE',
        reason: message,
      });
      if (candleTimestampMs !== null) this.lastProcessedCandleMs = candleTimestampMs;
    }
  }
}

export function createServerSignalRunner(options: {
  isKillSwitchActive: () => boolean;
}): ServerSignalRunner {
  return new ServerSignalRunner({
    getFreqtradeStatus: () => freqtradeBridge.getStatus(),
    getOpenTrades: () => freqtradeBridge.getOpenTrades(),
    getFreqtradeBalance: () => freqtradeBridge.getBalance(),
    getDailyRealizedLossUsd: (dayStartMs, nowMs) =>
      freqtradeBridge.getDailyRealizedLossUsd(dayStartMs, nowMs),
    getSnapshot: (expected, nowMs) => freqtradeMarketDataBridge.getLatestConfigured(expected, nowMs),
    isKillSwitchActive: options.isKillSwitchActive,
    submitSignal: (signal, expected) => freqtradeSignalAdapter.submit(signal, {
      nowMs: Date.now(),
      ...expected,
    }),
    recordSignalArchive: (record, metadata) => operationalTradeArchive.recordSignalLifecycle(record, metadata),
    syncClosedTrades: async (status) => {
      const pending = await operationalTradeArchive.getPendingOutcomeTrades();
      for (const { signalId, tradeId } of pending) {
        const trade = await freqtradeBridge.getTrade(tradeId);
        if (trade.is_open || trade.enter_tag !== signalId) continue;
        await operationalTradeArchive.recordFreqtradeTrade(
          signalId,
          trade,
          status.dryRun ? 'DRY_RUN' : 'LIVE',
        );
      }
    },
    getSignal: (signalId) => freqtradeSignalAdapter.get(signalId),
    submitExitSignal: (signal, nowMs) => freqtradeSignalAdapter.submitExitSignal(signal, nowMs),
  });
}
