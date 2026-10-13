import {
  deriveSbkSignalIds,
  DRY_RUN_COLLECTION_MODE,
  SBK_SIGNAL_CONTRACT_VERSION,
  validateSbkFreqtradeSignal,
  type SbkFreqtradeSignal,
} from './freqtradeSignalAdapter';
import { atr } from './indicators';
import type { Candle } from '../types/trading';
import type { FreqtradeMarketSnapshot } from './freqtradeMarketDataBridge';
import {
  getDryRunFixtureReadinessError,
  type DryRunFixtureConfiguration,
} from './freqtradeDryRunFixture';
import type { FreqtradeBotState } from './freqtradeBridge';

export const DRY_RUN_COLLECTION_MINIMUM_SPACING_MS = 5 * 60 * 1000;
export const DRY_RUN_COLLECTION_DEFAULT_MAX_SIGNALS_PER_DAY = 10;

export function getDryRunCollectionReadinessError(
  state: FreqtradeBotState,
  configuration: DryRunFixtureConfiguration,
  options: { requireNoOpenTrades?: boolean } = {},
): string | undefined {
  const fixtureReadinessError = getDryRunFixtureReadinessError(
    state,
    configuration,
    {
      requireNoOpenTrades: options.requireNoOpenTrades ?? true,
      requireDemoTradingOff: true,
    },
  );
  if (fixtureReadinessError) return fixtureReadinessError;
  if (state.maxOpenTrades !== 1) {
    return 'Authenticated Freqtrade RPC must confirm max_open_trades=1 for collection.';
  }
  return undefined;
}

export interface DryRunCollectionSignalInput {
  nowMs: number;
  generatedAtMs?: number;
  exchange: string;
  pair: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  setupType: string;
  sweptLevelPrice: number;
  referencePrice: number;
  stopLoss: number;
  takeProfit: number;
  observedAtMs: number;
  maxStakeQuote: number;
}

export interface DryRunCollectionMarketEvidence {
  obi: number;
  atr: number;
  fundingRate: number;
  observedAtMs: number;
}

export function isDryRunCollectionDecisionEligible(
  decision: {
    collectionEligible?: boolean;
    direction?: string;
    hasTradeContract: boolean;
    stages: Array<{ id: string; passed: boolean }>;
  },
  expectedDirection: 'LONG' | 'SHORT',
): boolean {
  return decision.collectionEligible === true &&
    decision.direction === expectedDirection &&
    decision.hasTradeContract &&
    decision.stages.some((stage) => stage.id === 'STAGE_12_EXPECTED_VALUE') &&
    decision.stages.every((stage) => stage.passed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateDryRunCollectionMarketEvidence(
  analysisValue: unknown,
  marketSnapshot: FreqtradeMarketSnapshot,
  direction: 'LONG' | 'SHORT',
  nowMs: number,
): DryRunCollectionMarketEvidence {
  if (!isRecord(analysisValue)) {
    throw new Error('A complete SBK1 analysis is required for dry-run collection.');
  }
  const quality = analysisValue.dataQualityReport;
  const liveObi = analysisValue.realObiData;
  const regime = analysisValue.regimeClassification;
  const canonicalSnapshot = analysisValue.canonicalSnapshot;
  const analysisTimestamp = isRecord(canonicalSnapshot)
    ? canonicalSnapshot.timestampUtc
    : undefined;
  if (
    analysisValue.dataStatus !== 'LIVE' ||
    !isRecord(quality) ||
    quality.isTradeAllowed !== true ||
    quality.status !== 'LIVE' ||
    typeof analysisTimestamp !== 'number' ||
    !Number.isSafeInteger(analysisTimestamp) ||
    analysisTimestamp > nowMs + 1_000 ||
    nowMs - analysisTimestamp > 5_000
  ) {
    throw new Error('Fresh LIVE SBK1 market data and an allowed data-quality report are required.');
  }
  if (
    !isRecord(liveObi) ||
    liveObi.status !== 'LIVE' ||
    typeof liveObi.obi !== 'number' ||
    !Number.isFinite(liveObi.obi) ||
    liveObi.obi < -1 ||
    liveObi.obi > 1 ||
    typeof liveObi.timestamp !== 'number' ||
    !Number.isSafeInteger(liveObi.timestamp) ||
    liveObi.timestamp > nowMs ||
    nowMs - liveObi.timestamp > 5_000
  ) {
    throw new Error('A valid, fresh LIVE order-book imbalance is required.');
  }
  if (
    !marketSnapshot.ticker ||
    nowMs - marketSnapshot.ticker.retrievedAtMs > 5_000 ||
    !marketSnapshot.orderBook ||
    nowMs - marketSnapshot.orderBook.timestampMs > 5_000 ||
    marketSnapshot.orderBook.timestampMs > nowMs + 1_000
  ) {
    throw new Error('A fresh authenticated Freqtrade order book is required.');
  }

  const bidDepthUsd = marketSnapshot.orderBook.bids.reduce(
    (total, level) => total + level.price * level.amount,
    0,
  );
  const askDepthUsd = marketSnapshot.orderBook.asks.reduce(
    (total, level) => total + level.price * level.amount,
    0,
  );
  const depthTotal = bidDepthUsd + askDepthUsd;
  const obi = depthTotal > 0 ? (bidDepthUsd - askDepthUsd) / depthTotal : Number.NaN;
  const bestBid = marketSnapshot.orderBook.bids[0]?.price;
  const bestAsk = marketSnapshot.orderBook.asks[0]?.price;
  const spreadBps = bestBid && bestAsk
    ? ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 10_000
    : Number.NaN;
  if (
    !Number.isFinite(obi) ||
    Math.abs(obi - liveObi.obi) > 0.15 ||
    !Number.isFinite(spreadBps) ||
    spreadBps > 8 ||
    (direction === 'LONG' ? obi < -0.30 : obi > 0.30)
  ) {
    throw new Error('Authenticated order-book imbalance or spread failed the directional liquidity gate.');
  }

  const funding = marketSnapshot.fundingRate;
  if (
    !funding ||
    !Number.isFinite(funding.rate) ||
    Math.abs(funding.rate) > 0.03 ||
    funding.retrievedAtMs > nowMs + 1_000 ||
    nowMs - funding.retrievedAtMs > 15_000
  ) {
    throw new Error('A fresh, valid funding rate within the existing risk limit is required.');
  }
  if (
    !isRecord(regime) ||
    !isRecord(regime.probabilityModelValidation) ||
    regime.probabilityModelValidation.status !== 'CALIBRATED' ||
    analysisValue.noTradePrediction === undefined ||
    !isRecord(analysisValue.noTradePrediction) ||
    analysisValue.noTradePrediction.isNoTradeTriggered !== false
  ) {
    throw new Error('The existing calibrated regime and no-trade veto gates must pass.');
  }
  if (
    typeof analysisValue.atr !== 'number' ||
    !Number.isFinite(analysisValue.atr) ||
    analysisValue.atr <= 0 ||
    marketSnapshot.candles.length < 30
  ) {
    throw new Error('A valid ATR and sufficient authenticated Freqtrade candles are required.');
  }
  const candles: Candle[] = marketSnapshot.candles.map((candle) => [
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ]);
  const currentAtr = atr(candles, 14).at(-1);
  if (
    currentAtr === undefined ||
    !Number.isFinite(currentAtr) ||
    currentAtr <= 0 ||
    Math.abs(currentAtr - analysisValue.atr) / currentAtr > 0.25
  ) {
    throw new Error('The SBK1 ATR does not match the authenticated Freqtrade candle data.');
  }

  return {
    obi,
    atr: currentAtr,
    fundingRate: funding.rate,
    observedAtMs: marketSnapshot.ticker?.retrievedAtMs ?? marketSnapshot.generatedAtMs,
  };
}

export function createDryRunCollectionSignal(
  input: DryRunCollectionSignalInput,
): SbkFreqtradeSignal {
  const generatedAtMs = input.generatedAtMs ?? input.nowMs;
  const ids = deriveSbkSignalIds({
    pair: input.pair,
    direction: input.direction,
    setupType: `${DRY_RUN_COLLECTION_MODE}|${input.setupType}`,
    generatedAtMs,
    sweptLevelPrice: input.sweptLevelPrice,
    referencePrice: input.referencePrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
  });

  return validateSbkFreqtradeSignal({
    contractVersion: SBK_SIGNAL_CONTRACT_VERSION,
    ...ids,
    exchange: input.exchange,
    market: 'futures',
    pair: input.pair,
    direction: input.direction,
    timeframe: input.timeframe,
    generatedAtMs,
    expiresAtMs: generatedAtMs + 60_000,
    referencePrice: input.referencePrice,
    dataQuality: {
      status: 'LIVE',
      source: 'freqtrade.dataprovider.ticker',
      observedAtMs: input.observedAtMs,
      maxAgeMs: 5_000,
    },
    entryConditions: {
      setupType: input.setupType,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      maxPriceDeviationBps: 100,
    },
    riskLimits: {
      riskBudgetPct: 1.5,
      maxStakeQuote: input.maxStakeQuote,
      maxLeverage: 1,
    },
    collectionMode: DRY_RUN_COLLECTION_MODE,
  }, {
    nowMs: input.nowMs,
    expectedPair: input.pair,
    expectedExchange: input.exchange,
    expectedTimeframe: input.timeframe,
  });
}
