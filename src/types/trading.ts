export type Candle = [number, number, number, number, number, number?]; // [timestamp?, open, high, low, close, volume] or [open, high, low, close, volume]

export type FeedStatus = 'LIVE' | 'SIMULATED' | 'STALE' | 'DATA_UNAVAILABLE' | 'UNAVAILABLE' | 'VERIFIED_REALTIME';

export type DecisionLifecycleStage =
  | 'MARKET_OBSERVED'
  | 'FEATURES_READY'
  | 'REGIME_CONFIRMED'
  | 'OPPORTUNITY_DETECTED'
  | 'DIRECTION_VALIDATED'
  | 'ENTRY_OPTIMIZED'
  | 'EV_VALIDATED'
  | 'RISK_APPROVED'
  | 'ORDER_SUBMITTED'
  | 'ORDER_ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'POSITION_RECONCILED'
  | 'POSITION_MANAGED'
  | 'CLOSED'
  | 'OUTCOME_RECORDED'
  | 'MODEL_FEEDBACK';

export interface VersionMetadata {
  decisionId: string;
  predictionId: string;
  modelVersion: string;
  featureVersion: string;
  strategyVersion: string;
  riskVersion: string;
  executionVersion: string;
  marketSnapshotTimestamp: number;
  exchangeTimestamp: number;
}

export type EntryCandidateType =
  | 'PULLBACK_ENTRY'
  | 'BREAKOUT_RETEST'
  | 'LIQUIDITY_SWEEP_RECLAIM'
  | 'FVG_RETRACEMENT'
  | 'ORDER_BLOCK_RETEST'
  | 'VWAP_RECLAIM_REJECTION'
  | 'MOMENTUM_CONTINUATION';

export interface EntryCandidate {
  candidateType: EntryCandidateType;
  entryZone: { min: number; max: number; target: number };
  invalidationPrice: number;
  targetPrice: number;
  expectedMovePct: number;
  spreadBps: number | null;
  slippagePct: number | null;
  riskRewardRatio: number;
  probability: number | null;
  expectedValueUsd: number | null;
  timeValidityMs: number;
  isExpired: boolean;
  isChasing: boolean;
}

export interface LatencyMetrics {
  marketTimestampMs?: number;
  dataArrivalMs?: number;
  featureCalculationMs?: number;
  predictionLatencyMs?: number;
  decisionLatencyMs: number;
  orderSentLatencyMs?: number;
  exchangeAckLatencyMs: number;
  fillLatencyMs: number;
  totalChainLatencyMs: number;
  isStaleLatencyExceeded: boolean;
  latencyBreakdownFa?: string;
}

export interface TradeDecision {
  decisionId: string;
  predictionId: string;
  versions: VersionMetadata;
  stage: DecisionLifecycleStage;
  canonicalInstrument: {
    exchange: 'BYBIT';
    symbol: 'BTCUSDT';
    category: 'linear';
    contractType: 'PERPETUAL';
    market: 'FUTURES';
  };
  snapshotId: string;
  marketSnapshotTimestamp: number;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  probability: number | null;
  expectedValueUsd: number | null;
  entryCandidate: EntryCandidate | null;
  riskApproved: boolean;
  executionStatus: 'EXECUTE_APPROVED' | 'WAIT_NO_TRADE' | 'ORDER_BLOCKED' | 'MISSED_ENTRY' | 'EXPIRED' | 'STALE_DATA_BLOCKED';
  reasonsForRejection: string[];
  latency: LatencyMetrics;
  tradeContract?: TradeContract;
  auditTrailDraft?: TradeAuditTrail;
  masterDecision?: MasterDecisionObject;
  evaluatedAtIso: string;
}
export type ExecutionMode = 'BACKTEST' | 'TESTNET' | 'PAPER' | 'LIVE';

export interface ExecutionSettings {
  mode: ExecutionMode;
  liveCapitalCeilingPct: number;
  lastChangedAt: number;
}

export interface MarketFeedQuality {
  feedName: string;
  source: string;
  status: FeedStatus;
  timestamp: number; // UTC ms
  ageMs: number;
  latencyMs: number;
  score: number; // 0 - 100
  detailsFa: string;
}

export interface DataQualityReport {
  overallScore: number; // 0 - 100
  isTradeAllowed: boolean;
  status: 'LIVE' | 'STALE' | 'DATA_UNAVAILABLE';
  reasonsFa: string[];
  feeds: {
    candles: MarketFeedQuality;
    orderBook: MarketFeedQuality;
    derivatives: MarketFeedQuality;
    futuresPrices: MarketFeedQuality;
    sentiment: MarketFeedQuality;
  };
}

export interface RealOrderBookImbalance {
  obi: number | null; // Real depth imbalance (bids - asks)/(bids + asks) from orderbook levels
  bidDepthUsd: number;
  askDepthUsd: number;
  bestBid?: number | null;
  bestAsk?: number | null;
  spreadUsd?: number | null;
  levelsCount: number;
  status: FeedStatus;
  timestamp: number;
  ageMs: number;
  latencyMs: number;
  source: string;
  obiVelocity?: number | null; // Rate of change of OBI (Item 12)
  obiAcceleration?: number | null; // Second derivative of OBI (Item 12)
  bidWallPersistence?: number | null; // Milliseconds / Score of bid wall stability (Item 12)
  askWallPersistence?: number | null; // Milliseconds / Score of ask wall stability (Item 12)
  wallCancellationRatio?: number | null; // Ratio of cancellations / spoofing (Item 12)
  absorptionRate?: number | null; // Rate of aggressive volume absorbed at walls (Item 12)
  liquidityInflowUsd?: number | null;
  liquidityWithdrawalUsd?: number | null;
  spreadCompressionUsd?: number | null;
  spreadExpansionUsd?: number | null;
  spoofingSuspicion?: boolean | null; // Suspicion of fake spoof walls (Item 12)
  wallCancellationObserved?: boolean | null;
  liquidityMigration?: 'TOWARD_INSIDE' | 'TOWARD_OUTSIDE' | 'STABLE' | 'UNKNOWN'; // Shift in liquidity depth (Item 12)
  spreadChange?: number | null; // Dynamic spread variation (Item 12)
  depthImbalanceByDistance?: { nearPct: number; midPct: number; farPct: number }; // Imbalance at distance tiers (Item 12)
  snapshotAgeMs?: number;
}

export interface OrderFlowFeatures {
  cvdDelta: number | null; // Cumulative signed trade-level volume delta
  cvdDeltaUsd?: number | null;
  cvdDivergence: string;
  takerBuyVol: number | null; // Specific real taker buyer volume (Item 11)
  takerSellVol: number | null; // Specific real taker seller volume (Item 11)
  takerRatio: number | null; // takerBuy / (takerBuy + takerSell)
  takerDelta: number | null; // takerBuy - takerSell
  tradePriceChangePct?: number | null;
  delta?: number | null; // Current period net delta (Item 11)
  cumulativeDelta?: number | null; // Multi-period cumulative delta (Item 11)
  deltaVelocity?: number | null; // Delta velocity (volume/sec) (Item 11)
  isRealTradeFlow?: boolean; // True if from live trade feed, false if unavailable (Item 11)
  status?: FeedStatus; // LIVE / UNAVAILABLE (Item 11)
  timestampUtc?: number;
  ageMs?: number;
}

export interface CanonicalExchangeFeed {
  exchange: 'BYBIT' | 'KUCOIN' | 'BINANCE' | 'COINBASE' | 'OKX';
  marketType: 'SPOT' | 'PERPETUAL_FUTURES' | 'PERPETUAL' | 'DELIVERY_FUTURES';
  symbol: string;
  contract?: string;
  timestampUtc: number; // Unix timestamp in ms UTC
  isoTimeUtc: string; // ISO 8601 UTC
  lastPrice: number;
  bestBid?: number;
  bestAsk?: number;
  spreadUsd?: number;
  spreadBps?: number;
  volume24hUsd?: number;
  latencyMs: number;
  status: FeedStatus;
  depth?: {
    bidDepthUsd0_1pct: number;
    askDepthUsd0_1pct: number;
  };
}

export interface CanonicalMarketSnapshot {
  timestampUtc: number;
  isoTimeUtc: string;
  symbol: 'BTC/USDT';
  primaryIndexPrice: number; // Normalized benchmark price
  basisSpreadUsd: number; // Spot vs Perpetual spread
  basisSpreadBps: number;
  crossExchangeSpreadUsd: number;
  crossExchangeLatencyMs: number;
  overallQualityScore: number; // 0 - 100
  feedStatuses: Record<string, FeedStatus>;
  feeds: CanonicalExchangeFeed[];
}

export interface FearAndGreed {
  value: number | null;
  sent: string;
  status?: 'LIVE' | 'STALE' | 'UNAVAILABLE';
}

export interface SentimentData {
  score: number; // -1 to 1
  label: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  trend: 'UP' | 'DOWN' | 'STABLE';
  drivers: string[];
}

export interface FuturesPrices {
  lastPrice: number;    // Used for Entry Execution & Slippage
  markPrice: number;    // Used for Stop Loss & Liquidation Engine
  indexPrice: number;   // Spot Underlying Index Benchmark
  timestampUtc: number;
  isoTimeUtc: string;
  ageMs: number;
  latencyMs: number;
  source: string;
  status: FeedStatus;
}

export interface DerivativesData {
  funding: number | null;
  oi: number | null;
  fundingHistory?: number[];
  fundingTrend?: 'RISING' | 'FALLING' | 'STABLE';
  status?: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  timestampUtc?: number;
  isoTimeUtc?: string;
  ageMs?: number;
  latencyMs?: number;
  source?: string;
}

export type SignalLifecycleState = 'SETUP_IDENTIFIED' | 'ARMED' | 'TRIGGERED' | 'EXECUTED' | 'MANAGED' | 'CANCELLED';

export interface StructuralEventNode {
  stage: 'LIQUIDITY_SWEEP' | 'REJECTION' | 'DISPLACEMENT' | 'RETEST' | 'TRIGGER_CONFIRMATION' | 'ENTRY_READY';
  passed: boolean;
  timestampUtc: number;
  descriptionFa: string;
}

export interface TriggerQualityMetrics {
  qualityScore: number | null; // Heuristic 0-100 score, never a probability
  eventStrength: number;
  volumeStrength: number | null;
  reclaimStrength: number;
  orderFlowConfirmation: number | null;
  failureToContinueStrength: number | null;
  isOrderFlowConfirmed: boolean;
}

export interface EntryQualityProfile {
  expectedMaePct: number; // Historical expected adverse excursion before profit (e.g. 0.35%)
  expectedMfePct: number; // Historical expected favorable excursion (e.g. 1.85%)
  prematureStopHitPct: number; // Empirical % times early wick challenges stop
  entryEfficiencyRatio: number; // MFE / (MAE + 0.01)
  optimalLocationDescriptionFa: string;
  isChasingDetected: boolean;
  distanceFromIdealZonePct: number;
}

export interface SetupContext {
  setupType: 'SMC_ORDER_BLOCK_RETEST' | 'LIQUIDITY_SWEEP_REVERSAL' | 'FVG_EQUILIBRIUM_PULLBACK' | 'VWAP_MSS_CONTINUATION';
  lifecycleState: SignalLifecycleState;
  currentMarketPrice: number;
  idealEntryZone: { min: number; max: number; optimal: number; low: number; high: number };
  actualExecutableEntry: number;
  invalidationLevel: number;
  triggerCondition: string;
  isTriggerConfirmed: boolean;
  setupExpectancyR: number; // Historical Out-of-sample Expectancy in R multiples
  riskRewardRatio: number;
  maePctExpected: number;
  mfePctExpected: number;
  entryQualityProfile?: EntryQualityProfile;
  eventSequence?: StructuralEventNode[];
  triggerQuality?: TriggerQualityMetrics;
}

export interface TradePosition {
  id: string;
  dir: 'LONG' | 'SHORT';
  entry: number;
  lev: number;
  initialMargin: number;
  margin: number;
  sl: number;
  tp: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  tp3Hit?: boolean;
  realizedPnlUsd?: number;
  currentTarget?: 1 | 2 | 3;
  pyramided?: boolean;
  openedAt: string;
  peakPnlPct?: number;
  isRecoveryTrade?: boolean;
  harvestedPnlUsd?: number;
  name?: string;
  isAuto?: boolean;
  isRunner?: boolean;
  maxDrawdownPct?: number;
  // --- Smart Zero-Loss Cross-Hedge Fields ---
  recoveryStep?: number; // 1 = initial, 2 = hedge locked
  initialEntry?: number;
  avgEntry?: number;
  recoveryTp?: number;
  hardEmergencySl?: number;
  hedgeActive?: boolean;
  hedgeEntry?: number;
  hedgeLockedPnlUsd?: number;
  hedgeBreakevenTicks?: number;
  hedgeBreakevenStartTime?: number;
  lastAutoBoostTimestamp?: number;
  hedgeInjected?: boolean;
  lastHedgeHarvestTime?: number;
  hedgePeakPnlUsd?: number;
  predictedProfitUsd?: number;
  predictedProfitPct?: number;
  wavePotentialRating?: 'HIGH_SUPER_WAVE' | 'PRIME_TREND_WAVE' | 'MICRO_SNIPER_WAVE';
  exchangeFeeEstimateUsd?: number;
  maintenanceMargin?: number;
  liquidationPrice?: number;
  floatingPnlUsd?: number;
  netEquityUsd?: number;
  invalidationPrice?: number;
  tradeThesis?: string;
  setupContext?: SetupContext;
  // --- Items 31 to 34: Thesis Monitor, 3-Tier Smart Loss Exit & Dynamic Breakeven ---
  thesisStatus?: 'PRISTINE' | 'HEALTHY' | 'DEGRADED' | 'INVALID';
  smartLossTier?: 'NORMAL' | 'WARNING' | 'REDUCE' | 'EXIT';
  smartLossReduced?: boolean; // True if 50% reduced on tier REDUCE
  dynamicBreakevenPrice?: number;
  dynamicBreakevenOffsetUsd?: number;
  isBreakevenArmed?: boolean;
  isInMarketNoiseZone?: boolean;
  estimatedLossSavingsUsd?: number;
  symbol?: string;
  isPartialExitTaken?: boolean;
  isExchangeConfirmed?: boolean;
  exchangeStopOrderId?: string;
  unrealizedPnl?: number;
  // Real-time tracking of Excursions & Immutable Contract
  maeUsd?: number; // Maximum Adverse Excursion in USD
  maePct?: number; // Maximum Adverse Excursion in %
  mfeUsd?: number; // Maximum Favorable Excursion in USD
  mfePct?: number; // Maximum Favorable Excursion in %
  realizedFeesUsd?: number;
  slippageUsd?: number;
  expectedPrice?: number;
  submittedPrice?: number;
  averageFillPrice?: number;
  actualSlippageBps?: number;
  actualRiskUsd?: number;
  protectiveOrderVerified?: boolean;
  emergencyProtectionActive?: boolean;
  tradeContract?: TradeContract;
  auditTrail?: TradeAuditTrail;

  // --- Real-World Execution & Safeguard Fields (Issues 26-30) ---
  fillSource?: 'EXCHANGE' | 'SIMULATION' | 'PENDING';
  isSimulatedFill?: boolean;
  simulatedFillPrice?: number;
  actualQtyBtc?: number;
  uniqueClientOrderId?: string;
  signalId?: string;
  decisionId?: string;
  executionAttemptId?: string;
  lifecycleStatus?: 'SIGNAL' | 'APPROVED' | 'ORDER_SUBMITTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'PROTECTED' | 'MANAGED' | 'CLOSED' | 'RECONCILED' | 'REJECTED';
  rejectionReason?: string;
  reconciliation?: ExchangeOrderReconciliation;
  reconciliationHalted?: boolean;
}

export interface ExchangeOrderReconciliation {
  orderId: string;
  clientOrderId: string;
  signalId: string;
  decisionId: string;
  executionAttemptId: string;
  orderStatus: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'UNTRIGGERED' | 'DEACTIVATED';
  filledQty: number;
  remainingQty: number;
  avgFillPrice: number;
  requestedPrice: number;
  actualFeeUsd: number;
  actualSlippageUsd: number;
  positionSizeBtc: number;
  positionSide: 'Buy' | 'Sell' | 'None';
  exchangePositionState: 'ACTIVE' | 'CLOSED' | 'MISMATCH_HALTED';
  isReconciled: boolean;
  discrepancyFa?: string;
  lastReconciledTime: number;
}

export interface AutoTradePrerequisitesCheck {
  isEligible: boolean;
  exchangeConnected: boolean;
  apiPermissionValid: boolean;
  marketDataLive: boolean;
  riskEngineHealthy: boolean;
  executionEngineHealthy: boolean;
  clockSynchronized: boolean;
  positionStateSynchronized: boolean;
  emergencyStopAvailable: boolean;
  realEquityAvailable?: boolean;
  walletBalanceUsdt?: number | null;
  detailsFa: string[];
  checkedAt: number;
}

export interface TradeHistory extends TradePosition {
  pnlUsd: number;
  pnlPct: number;
  closedAt: string;
  closeReason?: string;
  exitPrice?: number;
  durationSeconds?: number;
  action?: string;
}

export interface TradeContract {
  contractId: string;
  direction: 'LONG' | 'SHORT';
  entryZone: {
    min: number;
    max: number;
    target: number;
  };
  trigger: string;
  invalidation: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  expectedValue: number | null; // In $ or net R (null if uncalibrated)
  winProbability: number | null; // Strictly empirical 0.00 - 1.00 or null if uncalibrated
  technicalScore: number; // 0 - 100 (Indicator & rule alignment)
  consensusScore: number; // 0 - 100 (Multi-brain/model agreement)
  confidenceScore: number; // 0 - 100 (Cognitive conviction, NOT win probability)
  expectedR: number; // e.g. 2.5
  riskUsd: number;
  positionSize: {
    marginUsd: number;
    notionalUsd: number;
    btcQty: number;
  };
  leverage: number;
  dataTimestamp: number;
  dataTimestampIso: string;
  signalTimestamp: number;
  signalTimestampIso: string;
  reasonForEntry: string;
  reasonsForRejection: string[];
  contractStatus: 'APPROVED_EXECUTABLE' | 'REJECTED_WAIT_NO_TRADE';
  isImmutable: boolean;
  contractSealHash: string;
}

export interface TradeAuditTrail {
  tradeId: string;
  contractId: string;
  entryTimestamp: number;
  entryTimestampIso: string;
  exitTimestamp?: number;
  exitTimestampIso?: string;
  featureSnapshot?: any;
  entryFeatures: {
    price: number;
    rsi: number;
    adx: number;
    atr: number;
    atrPct: number | null;
    vwap: number;
    ema20: number;
    ema50: number;
    ema200: number;
    obi: number;
    cvdDelta?: number | null;
    takerRatio?: number;
    fngVal: number | null;
    spreadUsd: number;
    spreadBps: number;
    bidDepthUsd?: number;
    askDepthUsd?: number;
    orderBookLevels?: number;
    fundingRate: number | null;
    fundingTrend?: string;
    garchRegime?: string;
    dataFreshnessAgeMs: number | null;
    feedQualityScore: number | null;
    dataStatus: string;
    marketRegime: string;
    htf1h: string;
    htf4h: string;
  };
  entryScores: {
    totalConfluencePct: number;
    passedPillarsCount: number;
    totalPillarsCount: number;
    pillarBreakdown: Array<{
      id: string;
      nameFa: string;
      score: number;
      weight: number;
      passed: boolean;
      details: string;
    }>;
    technicalScore: number; // 0 - 100
    consensusScore: number; // 0 - 100
    confidenceScore: number; // 0 - 100 (Cognitive conviction, NOT statistical probability)
    aiConfidenceScore: number;
    convictionLevel: string;
    expectedValueUsd: number | null;
    expectedR: number;
    calibratedWinProbability: number | null; // Empirical statistical probability or null
    winProbabilityPct: number | null;
  };
  modelOutputs: {
    predictedTrend?: string;
    forecastUp?: number;
    forecastDown?: number;
    reversalProbability?: number | null;
    reversalSignalStrength?: number;
    quantumCertainty?: number;
    microVectorBias?: string;
    garchVolForecast?: number;
  };
  executionMetrics: {
    requestedPrice: number;
    actualEntryPrice: number;
    slippageUsd: number;
    slippageBps: number;
    estimatedFeeUsd: number;
    actualFeeUsd: number;
    exitPrice?: number;
    maeUsd: number;
    maePct: number;
    mfeUsd: number;
    mfePct: number;
    finalPnlUsd?: number;
    finalPnlPct?: number;
    finalOutcome?: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'IN_FLIGHT';
    closeReason?: string;
  };
}

export type PipelineStageId =
  | 'STAGE_1_MARKET_DATA'
  | 'STAGE_2_DATA_QUALITY'
  | 'STAGE_3_MARKET_REGIME'
  | 'STAGE_4_HTF_STRUCTURE'
  | 'STAGE_5_SETUP_DETECTION'
  | 'STAGE_6_LIQUIDITY_ANALYSIS'
  | 'STAGE_7_ORDER_FLOW'
  | 'STAGE_8_ENTRY_TRIGGER'
  | 'STAGE_9_ENTRY_PRICE'
  | 'STAGE_10_STOP_INVALIDATION'
  | 'STAGE_11_TP_TARGETS'
  | 'STAGE_12_EXPECTED_VALUE'
  | 'STAGE_13_POSITION_SIZE'
  | 'STAGE_14_EXECUTION';

export interface DecisionPipelineStageState {
  id: PipelineStageId;
  name: string;
  nameFa: string;
  passed: boolean;
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'EVALUATING';
  value: string | number;
  threshold: string | number;
  reasonFa: string;
  details?: string;
}

export interface DecisionPipelineResult {
  decision: 'EXECUTE_APPROVED' | 'WAIT_NO_TRADE';
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  activeStage: PipelineStageId;
  stages: DecisionPipelineStageState[];
  passedStagesCount: number;
  totalStagesCount: number;
  isEdgeProven: boolean;
  expectedValueUsd: number | null;
  expectedR: number | null;
  calibratedWinProb: number | null;
  tradeContract?: TradeContract;
  auditTrailDraft?: TradeAuditTrail;
  canonicalDecision?: TradeDecision;
  masterDecision?: MasterDecisionObject;
  opportunitySurface?: EntryOpportunitySurfaceReport;
  waitReasonFa: string;
  prerequisitesToArmFa: string[];
  evaluatedAtIso: string;
}

export interface UserSettings {
  riskPct: number;
  emaPeriods: { fast: number; slow: number; trend: number };
  notificationsEnabled: boolean;
  autoTradeEnabled: boolean;
  rangeFilterEnabled?: boolean;
  volatilityThreshold?: number; // Minimum ATR/Volatility %
  precisionPullbackEnabled?: boolean;
  autoHedgeEnabled?: boolean;
  takeProfitMode?: 'FULL_TP1' | 'STEPPED_3_TIER';
}

export interface SmcZone {
  top: number;
  bottom: number;
  type: 'BULLISH' | 'BEARISH';
  label: string;
}

export interface AnalysisResult {
  price: number;
  lastPrice?: number;        // Executable fill price (Last Price)
  markPrice?: number;        // Stop Loss & Liquidation Benchmark (Mark Price)
  indexPrice?: number;       // Spot Index Underlying Price (Index Price)
  futuresPrices?: FuturesPrices;
  entryPriceType?: 'LAST_PRICE';
  stopLossPriceType?: 'MARK_PRICE';
  liquidationPriceType?: 'MARK_PRICE';
  sentiment: SentimentData;
  htfCandles?: Record<string, Candle[]>;
  action: string;
  actionCol: string;
  direction: 'LONG' | 'SHORT';
  signalOk: boolean;
  confScore: number;
  technicalScore?: number;       // 0 - 100 (Pure indicator & rule alignment)
  consensusScore?: number;       // 0 - 100 (Multi-brain & multi-model agreement)
  confidenceScore?: number;      // 0 - 100 (Cognitive heuristic conviction, NOT win probability)
  calibratedWinProbability?: number | null; // 0.00 - 1.00 (Empirical statistical probability or null if uncalibrated)
  fillProbabilityPct?: number | null;
  scoreLong: number;
  scoreShort: number;
  mtf1m: string;
  mtf5m: string;
  mtf15m: string;
  mtf1h: string;
  mtf4h: string;
  mtfAlignment: number;
  mtfNote: string;
  marketRegime: string;
  isRangeBound?: boolean;
  rangeBreakoutConfirmed?: boolean;
  volatilityPct?: number;
  pullbackLimitPrice?: number;
  triggerCandlePrice?: number;
  sl: number;
  tp: number;
  tp1: number;
  tp2: number;
  tp3: number;
  slDistPct: number;
  leverage: number;
  margin: number;
  posUsd: number;
  qtyBtc: number;
  riskUsd: number;
  rsi: number;
  rsi1h?: number;
  rsi1hDivergence?: 'BULLISH_CONVERGENCE' | 'BEARISH_DIVERGENCE' | 'NEUTRAL';
  rsi1hConvergenceNoteFa?: string;
  stoch: number;
  cci: number;
  wr: number;
  mom: number;
  atr: number;
  adx: number;
  pdi: number;
  mdi: number;
  obv: number;
  obvSlope: number;
  obvDiv: string;
  mfi: number;
  vwap: number;
  ema20Val: number;
  ema50Val: number;
  ema200Val: number;
  supertrend: string;
  fngVal: number | null;
  fngSent: string;
  funding: number | null;
  fundingRate?: number | null;
  fundingHistory?: number[];
  fundingTrend?: 'RISING' | 'FALLING' | 'STABLE';
  oi: number | null;
  frNote: string;
  obi: number;
  cvdDelta?: number | null;
  cvdDivergence?: string;
  fundingSqueezeSignal?: string;
  forecastUp: number;
  forecastDown: number;
  smcOrderBlock?: SmcZone;
  fvg?: SmcZone;
  candles: Candle[];
  rawCandles?: Candle[];
  dataStatus?: FeedStatus;
  entryTiming?: 'IMMEDIATE' | 'WAIT_FOR_PULLBACK' | 'WAIT_FOR_BREAKOUT' | 'NO_TRADE';
  invalidationPrice?: number;
  expectedValue?: number;
  calibratedWinProb?: number | null;
  tradeThesis?: string;
  setupContext?: SetupContext;
  ema20: number[];
  ema50: number[];
  ema200: number[];
  stLine: number[];
  bbUp: number[];
  bbMid: number[];
  bbLow: number[];
  macdLine: number[];
  macdSignal: number[];
  macdH: number[];
  dataQualityReport?: DataQualityReport;
  realObiData?: RealOrderBookImbalance;
  orderFlowFeatures?: OrderFlowFeatures;
  canonicalSnapshot?: CanonicalMarketSnapshot;
  takerBuyVol?: number | null;
  takerSellVol?: number | null;
  takerRatio?: number | null;
  calibratedMetadata?: CalibratedProbabilityMetadata;
  decisionPipeline?: DecisionPipelineResult;
  liquidityMap?: LiquidityMapReport;
  sweepReversalSetup?: SweepReversalSetup | null;
  cvdOiMatrix?: CvdOiMatrixReport;
  liquidationCascadePrediction?: LiquidationCascadePrediction;
  regimeClassification?: MarketRegimeClassification;
  regimeSetupEdgeMatrix?: RegimeSetupMatrixReport;
  mtfStructuralReport?: MtfStructuralReport;
  scenarioCompetitionReport?: ScenarioCompetitionReport;
  noTradePrediction?: NoTradePredictionReport;
  slReport?: any;
  maeMfeFingerprint?: any;
  timeframe?: string;
}

export interface TradeQualityScore {
  totalScore: number; // 0 - 100
  isTradeWorthy: boolean;
  grade: 'ELITE' | 'HIGH_QUALITY' | 'MARGINAL' | 'REJECTED';
  breakdown: {
    setupQuality: number; // 0 - 20
    calibratedProbabilityQuality: number; // 0 - 25
    riskRewardAsymmetry: number; // 0 - 20
    economicEdgeAndExpectancy: number; // 0 - 20
    executionMicrostructure: number; // 0 - 15
  };
  metrics: {
    winRatePct: number;
    expectancyUsd: number | null;
    profitFactor: number | null;
    averageR: number | null;
    maxDrawdownPct: number | null;
    maeMfeRatio: number | null;
    tailRiskPenaltyPct: number;
    riskAdjustedEdgeScore: number | null;
  };
  verdictFa: string;
  rejectionReasonsFa: string[];
}

export type BrainRoleType =
  | 'FEATURE_PROCESSOR'
  | 'STATISTICAL_MODEL'
  | 'ML_MODEL'
  | 'RISK_CONTROLLER'
  | 'EXECUTION_CONTROLLER';

export interface CalibratedProbabilityMetadata {
  rawEvidenceScore: number;
  rawProbability: number | null;
  calibratedWinProbability: number | null; // 0.00 - 1.00 or null
  isCalibrationVerified: boolean;
  calibrationVerified: boolean;
  dataSufficient: boolean;
  sampleSize: number;
  resolvedSampleSize: number;
  requiredOosSampleSize: number;
  oosSampleSize: number;
  confidenceIntervalWidth: number | null;
  modelVersion: string;
  datasetVersion: string;
  calibrationStatus: 'CALIBRATED' | 'UNCALIBRATED' | 'UNKNOWN';
  lastTrainedAt: string | null;
  timeframe: string;
  directionScore?: number;
  confidenceInterval: {
    lowerBound: number;
    upperBound: number;
    confidenceLevelPct: number;
  } | null;
  calibrationScore: number; // 0 - 100
  brierScore: number | null;
  logLoss: number | null;
  expectedCalibrationError: number | null; // ECE
  ece: number | null;
  outOfSamplePrecision: number;
  expectancyUsd: number | null;
  profitFactor?: number | null;
  maxDrawdownPct?: number | null;
  tailRiskPct?: number | null;
  riskAdjustedEdge?: number | null;
  isExpectancyNegative?: boolean;
  tradeQualityScore?: TradeQualityScore;
  regime: string;
  setupType: string;
  recommendation: 'EXECUTE_APPROVED' | 'WAIT_NO_TRADE';
  selectiveMode: {
    isSelectiveHighConfidence: boolean;
    requiredThreshold: number;
    recommendation: 'EXECUTE_APPROVED' | 'WAIT_NO_TRADE';
    rejectionReasonFa?: string;
  };
  reliabilityDiagramBins?: Array<{
    binMidpoint: number;
    empiricalAccuracy: number;
    predictedConfidence: number;
    sampleCount: number;
  }>;
}

export type OrderLifecycleState = 'CREATED' | 'SUBMITTED' | 'ACCEPTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export interface PreTradeRiskGateCheck {
  liveMarketData: boolean;
  dataFreshness: boolean;
  exchangeConnection: boolean;
  accountState: boolean;
  positionState: boolean;
  marginAvailable: boolean;
  riskLimit: boolean;
  dailyLossLimit: boolean;
  maxDrawdown: boolean;
  spreadLimit: boolean;
  slippageLimit: boolean;
  probabilityGate: boolean;
  entryTrigger: boolean;
  stopValidity: boolean;
  tpValidity: boolean;
  expectedValue: boolean;
  duplicateOrderCheck: boolean;
  clockSynchronization: boolean;
  allPassed: boolean;
  status: 'ORDER_APPROVED' | 'ORDER_BLOCKED';
  reasonsFa: string[];
  checkedAt: number;
}

export interface PositionReconciliationReport {
  isMatched: boolean;
  mismatchDetected: boolean;
  tradingHalted: boolean;
  reconciliationRequired: boolean;
  detailsFa: string;
  discrepancies: string[];
  checkedAt: number;
}

// -------------------------------------------------------------
// ۱۱. ممیزی ممانعت از چند معامله غیرواقعی روی یک حرکت (Opportunity Clustering Guard)
// -------------------------------------------------------------
export interface OpportunityClusteringCheck {
  isAllowed: boolean;
  opportunityId: string;
  clusterMoveKey: string;
  isSameMoveDetected: boolean;
  isCandleSpikeDuplicate: boolean;
  totalMoveExposureUsd: number;
  maxMoveExposureCapUsd: number;
  currentAvailableMarginUsd: number;
  liquidityParticipationPct: number;
  reasonsFa: string[];
  status: 'MOVE_APPROVED' | 'SAME_MOVE_BLOCKED' | 'EXPOSURE_CAP_BREACHED' | 'LIQUIDITY_LIMIT_EXCEEDED';
  checkedAt: number;
}

// -------------------------------------------------------------
// ۱۲. مدل جامع و واقع‌بینانه Fill سفارشات (Realistic Order Fill Engine)
// -------------------------------------------------------------
export interface RealisticFillSimulationResult {
  isFilled: boolean;
  nominalPrice: number;
  executedPrice: number;
  orderType: 'MARKET_TAKER' | 'LIMIT_MAKER';
  direction: 'BUY' | 'SELL';
  spreadCostUsd: number;
  spreadBps: number;
  slippageUsd: number;
  slippagePct: number;
  latencyMs: number;
  latencyDragUsd: number;
  queuePositionRank: number;
  marketImpactUsd: number;
  marketImpactBps: number;
  fillProbabilityPct: number;
  exchangeFeeUsd: number;
  totalExecutionFrictionUsd: number;
  fillProofDetailsFa: string;
  fillVerificationStatus: 'VERIFIED_FILLED' | 'LIMIT_QUEUE_EXPIRED' | 'UNFILLED_PRICE_OUT_OF_REACH' | 'INSUFFICIENT_LIQUIDITY';
  timestamp: number;
}

// -------------------------------------------------------------
// ۱۳. مدل Dynamic Slippage (تابعی از Volatility + Size + Liquidity + Spread + Time + Regime + News)
// -------------------------------------------------------------
export interface DynamicSlippageFactors {
  volatilityFactor: number;
  orderSizeFactor: number;
  liquidityDepthUsd: number;
  spreadBps: number;
  timeOfDayMultiplier: number;
  timeZoneLabelFa: string;
  marketRegimeMultiplier: number;
  isFlashMoveOrNews: boolean;
  flashMoveMultiplier: number;
  calculatedSlippageBps: number;
  calculatedSlippagePct: number;
  slippageUsd: number;
}

// -------------------------------------------------------------
// ۱۴. مدل کامل هزینه معامله و Net PnL واقعی (Full Transaction Cost Model)
// Entry Fee + Exit Fee + Funding + Spread + Slippage + Partial Fill + Market Impact + Borrow
// -------------------------------------------------------------
export interface FullTransactionCostBreakdown {
  entryFeeUsd: number;
  exitFeeUsd: number;
  fundingCostUsd: number;
  spreadCostUsd: number;
  slippageCostUsd: number;
  partialFillCostUsd: number;
  marketImpactCostUsd: number;
  borrowCostUsd: number;
  totalTransactionCostUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  costToProfitRatioPct: number;
  holdingHours: number;
}

// -------------------------------------------------------------
// ۱۵ & ۱۶. ارزیابی ست‌آپ مستقل ورود مجدد و حذف Recovery مبتنی بر امید به برگشت
// -------------------------------------------------------------
export interface StandaloneRecoveryEvaluation {
  isSetupConfirmed: boolean;
  standaloneSetupType: 'LIQUIDITY_SWEEP_REVERSAL' | 'MSS_STRUCTURE_BREAKOUT' | 'VALUE_AREA_REJECTION' | 'NO_STANDALONE_SETUP';
  standaloneWinProbPct: number;
  standaloneEvUsd: number;
  independentStopLoss: number;
  independentTakeProfit: number;
  independentRiskReward: number;
  averagingDownBlocked: boolean;
  decisionStatus: 'INDEPENDENT_SETUP_APPROVED' | 'HOPE_RECOVERY_REJECTED';
  reasonsFa: string[];
  checkedAt: number;
}

// -------------------------------------------------------------
// ۱۷ & ۱۸. موتور ردیاب فرصت‌های ورود (Entry Opportunity & Timing Engine)
// -------------------------------------------------------------
export type OpportunityLifecycle = 'FORMING' | 'ARMED' | 'TRIGGERED' | 'EXECUTABLE' | 'EXPIRED';

export interface EntryOpportunityReport {
  opportunityId: string;
  state: OpportunityLifecycle;
  stateFa: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  timeToTriggerEstMin: number;
  formingProgressPct: number;
  isTriggered: boolean;
  isExecutable: boolean;
  setupQualityScore: number; // کیفیت تکنیکال جهت (Directional Score)
  timingScore: number;       // کیفیت فاکتور زمان‌بندی (Timing Score)
  verdictFa: string;
  reasonsFa: string[];
  checkedAt: number;
}

export type MetaModelHealthState = 'HEALTHY' | 'DEGRADED' | 'SUSPENDED' | 'RETIRED';
export type HunterMode = 'HUNT' | 'AMBUSH' | 'EXECUTE';

export interface EntryOpportunitySurfacePoint {
  entryPrice: number;
  calibratedProbabilityPct: number | null;
  expectedValueR: number | null;
  expectedMaeR: number | null;
  expectedMfeR: number | null;
  expectedDurationSeconds: number | null;
  fillProbabilityPct: number | null;
  slippageBps: number | null;
  stopDistance: number | null;
  reward: number | null;
  liquidityUsd: number | null;
  qualityScore: number | null; // Composite 0-100 score, never a probability
}

export interface EntryOpportunitySurfaceReport {
  mode: HunterMode;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  points: EntryOpportunitySurfacePoint[];
  triggerQuality?: TriggerQualityMetrics;
  entryZone: { min: number; max: number } | null;
  optimalEntryPrice: number | null;
  isPriceAtOptimalEntry: boolean;
  isTriggerConfirmed: boolean;
  readinessPct: number;
  nearMissReasonFa: string | null;
  fillProbabilityAvailable: boolean;
  evaluatedAt: number;
}

// -------------------------------------------------------------
// ۱۹ & ۲۰. ردیاب زودهنگام فرصت (Early Detector) و ارزیابی Breakout vs Fakeout
// -------------------------------------------------------------
export interface EarlyOpportunityMetrics {
  liquidityBuildUpScore: number;     // 0 - 100
  compressionScore: number;          // 0 - 100 (Volatility Squeeze)
  orderBookShiftScore: number;       // -100 to +100
  cvdShiftScore: number;             // -100 to +100
  openInterestChangePct: number;     // e.g. +3.5%
  fundingRateChange: number;         // e.g. +0.005%
  volatilityCompressionIndex: number;// 0 - 1
  structurePressureScore: number;    // -100 to +100
  earlyScore: number;                // 0 - 100
  isArmedEarly: boolean;
  rationaleFa: string;
}

export interface BreakoutVsFakeoutEvaluation {
  isBreakoutCandidate: boolean;
  realBreakoutProbabilityPct: number;    // e.g. 74.5%
  fakeoutLiquiditySweepProbabilityPct: number; // e.g. 25.5%
  statisticalEdgeVerified: boolean;      // Real Prob >= 68% and > Fakeout Prob + 30%
  verdictFa: string;
  decisionStatus: 'BREAKOUT_APPROVED_EDGE_PROVEN' | 'FAKE_BREAKOUT_AVOIDED_REJECTED';
  reasonsFa: string[];
  checkedAt: number;
}

// -------------------------------------------------------------
// ۲۱. نقشه نقدینگی جامع (Real Liquidity Map & Pools)
// -------------------------------------------------------------
export type LiquidityPoolType =
  | 'EQUAL_HIGHS'         // سقف‌های برابر (EQH - استخر نقدینگی استاپ خریداران)
  | 'EQUAL_LOWS'          // کف‌های برابر (EQL - استخر نقدینگی استاپ فروشندگان)
  | 'PREVIOUS_HIGH_LOW'   // سقف و کف دوره قبلی (PDH / PDL / Session H/L)
  | 'LIQUIDATION_ZONE'    // نواحی انباشته لیکوئیدیشن اهرم‌های بالا (25x/50x/100x)
  | 'ORDERBOOK_WALL'      // دیوارهای حجمی اوردربوک لایه ۲ (Bid / Ask Wall)
  | 'VOLUME_NODE'         // گره‌های حجمی مشخصات حجم (HVN / POC / LVN)
  | 'FVG'                 // گپ ارزش منصفانه (Fair Value Gap)
  | 'ORDER_BLOCK';        // اوردر بلاک‌های نهادی (Institutional Order Block)

export interface LiquidityPool {
  id: string;
  type: LiquidityPoolType;
  typeFa: string;
  side: 'BUY_SIDE' | 'SELL_SIDE'; // Buy-side (بالای قیمت) یا Sell-side (پایین قیمت)
  priceMin: number;
  priceMax: number;
  centerPrice: number;
  estimatedVolumeUsd: number;
  strengthScore: number;          // 0 - 100
  isMitigated: boolean;           // مصرف شده یا دست‌نخورده
  distancePct: number;            // فاصله درصدی از قیمت کنونی
  magnetAttractionScore: number;  // 0 - 100 پتانسیل جذب قیمت به عنوان مغناطیس نقدینگی
  descriptionFa: string;
}

export interface LiquidityMapReport {
  currentPrice: number;
  pools: LiquidityPool[];
  dominantBuySideMagnet: LiquidityPool | null;
  dominantSellSideMagnet: LiquidityPool | null;
  predictedTargetPool: LiquidityPool | null;
  predictionRationaleFa: string;
  netLiquidityBias: 'ATTRACTED_TO_BUY_SIDE' | 'ATTRACTED_TO_SELL_SIDE' | 'BALANCED';
  timestamp: number;
}

// -------------------------------------------------------------
// ۲۲. ردیاب بازگشت با هانت نقدینگی (Liquidity Sweep Reversal Detector)
// -------------------------------------------------------------
export type SweepSequenceStage = 'SWEEP' | 'REJECTION' | 'DISPLACEMENT' | 'RECLAIM' | 'COMPLETED';

export interface SweepReversalSetup {
  setupId: string;
  direction: 'BULLISH_REVERSAL' | 'BEARISH_REVERSAL';
  targetPool: LiquidityPool;
  
  // توالی ساختاری ۴ مرحله‌ای
  sweepCompleted: boolean;
  rejectionCompleted: boolean;
  displacementCompleted: boolean;
  reclaimCompleted: boolean;
  
  currentStage: SweepSequenceStage;
  sequenceCompleted: boolean;     // فقط در صورت تکمیل کامل ۴ گانه
  isReversalSetupActive: boolean; // فعال‌ساز رسمی ستاپ

  // سطوح قیمتی
  sweptPriceLevel: number;
  sweepExtremePrice: number;
  rejectionPrice: number;
  displacementBodyPct: number;
  reclaimPriceLevel: number;
  
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  riskRewardRatio: number;
  
  confidenceScore: number; // 0 - 100
  verdictFa: string;
  stageProgressFa: {
    sweep: { status: 'DONE' | 'PENDING' | 'FAILED'; noteFa: string };
    rejection: { status: 'DONE' | 'PENDING' | 'FAILED'; noteFa: string };
    displacement: { status: 'DONE' | 'PENDING' | 'FAILED'; noteFa: string };
    reclaim: { status: 'DONE' | 'PENDING' | 'FAILED'; noteFa: string };
  };
  detectedAt: number;
}

// -------------------------------------------------------------
// ۲۵. ماتریس واگرایی چندبعدی CVD / OI / Price / Funding / Liquidations
// -------------------------------------------------------------
export type DirectionState = 'UP' | 'DOWN' | 'FLAT';
export type CvdDirectionState = DirectionState | 'UNKNOWN';
export type FundingState = 'HIGH_POSITIVE' | 'NEUTRAL' | 'HIGH_NEGATIVE';
export type LiquidationDominance = 'LONGS_DOMINANT' | 'SHORTS_DOMINANT' | 'BALANCED';

export type MatrixRegimeType =
  | 'HEALTHY_BULLISH_AGGRESSION'       // قیمت بالا + OI بالا + CVD بالا (خرید ارگانیک)
  | 'EXHAUSTION_ABSORPTION_TRAP'      // قیمت بالا + OI بالا + CVD پایین (تله واگرایی جذب توسط فروشندگان لیمیت)
  | 'SHORT_SQUEEZE_COVERING'          // قیمت بالا + OI پایین + CVD بالا (پوشش شورت‌ها)
  | 'HEALTHY_BEARISH_DUMPING'         // قیمت پایین + OI بالا + CVD پایین (فروش ارگانیک)
  | 'BULL_LIQUIDATION_CASCADE'        // قیمت پایین + OI پایین + CVD پایین (لیکوئید شدن لانگ‌ها)
  | 'BEAR_ABSORPTION_ACCUMULATION'    // قیمت پایین + OI بالا + CVD بالا (جذب خرید توسط نهنگ‌ها)
  | 'NEUTRAL_CONSOLIDATION';          // خنثی

export interface CvdOiMatrixCell {
  dimensionName: string; // Price, CVD, OI, Funding, Liquidations
  valueText: string;
  state: DirectionState | CvdDirectionState | FundingState | LiquidationDominance;
  scoreContribution: number;
  isDivergent: boolean;
}

export interface CvdOiMatrixReport {
  priceDirection: DirectionState;
  priceChangePct: number;
  
  cvdDirection: CvdDirectionState;
  cvdDeltaUsd: number | null;
  
  oiDirection: DirectionState;
  openInterestChangePct: number;
  
  fundingState: FundingState;
  fundingRatePct: number;
  
  liquidationDominance: LiquidationDominance;
  recentLongLiqUsd: number;
  recentShortLiqUsd: number;
  
  matrixRegime: MatrixRegimeType;
  matrixRegimeFa: string;
  matrixScore: number; // -100 to +100
  
  divergenceType: 'BULLISH_ABSORPTION' | 'BEARISH_ABSORPTION' | 'SHORT_COVERING_RALLY' | 'LONG_LIQUIDATION_UNWIND' | 'CONGRUENT_EXPANSION' | 'NEUTRAL';
  institutionalTrapAlert: boolean; // هشدار تله نهادی بر اساس واگرایی قیمت و CVD
  verdictFa: string;
  matrixCells: CvdOiMatrixCell[];
  calculatedAt: number;
}

// -------------------------------------------------------------
// ۲۶. پیش‌بینی‌کننده آبشاری لیکوئیدیشن (Liquidation Cascade Predictor)
// -------------------------------------------------------------
export type CascadeRiskLevel = 'CRITICAL_IMMINENT' | 'HIGH_BUILDUP' | 'ELEVATED' | 'NORMAL';
export type CascadeDirection = 'LONG_SQUEEZE_CASCADE' | 'SHORT_SQUEEZE_CASCADE' | 'LOW_RISK';

export interface LiquidationCascadePrediction {
  cascadeRiskScore: number;          // 0 - 100%
  cascadeProbabilityPct: number;     // e.g. 84%
  predictedCascadeDirection: CascadeDirection;
  cascadeAlertLevel: CascadeRiskLevel;
  
  squeezeTriggerPrice: number;        // قیمت ماشه‌چکان آغاز دومینوی لیکوئیدیشن
  estimatedCascadeVolumeUsd: number;  // حجم تخمینی لیکوئیدیشن‌های اجباری دومینویی
  timeToPotentialCascadeMin: number; // زمان تخمینی تا نقطه بحرانی
  
  dominoTriggerPool: LiquidityPool | null; // استخر نقدینگی ماشه‌چکان
  oiBuildupSeverityScore: number;    // 0 - 100
  fundingSqueezePressure: number;     // -100 to +100
  distanceToCascadeTriggerPct: number;// فاصله درصدی قیمت تا نقطه‌عطف
  
  riskFactorsFa: string[];
  mitigationAdviceFa: string;
  verdictFa: string;
  evaluatedAt: number;
}

// -------------------------------------------------------------
// ۲۷. رده‌بندی پیشرفته رژیم بازار (Comprehensive Market Regime Classifier)
// -------------------------------------------------------------
export type AdvancedRegimeType =
  | 'TREND'               // رونددار (صعودی یا نزولی مداوم)
  | 'RANGE'               // رنج و خنثی
  | 'BREAKOUT'            // شکست پرحجم سطوح ساختاری
  | 'COMPRESSION'         // فشردگی شدید نوسان (Volatility Squeeze)
  | 'EXPANSION'           // انبساط و شتاب ناگهانی نوسان
  | 'HIGH_VOLATILITY'     // نوسان‌پذیری بسیار بالا و دامنه‌دار
  | 'PANIC'               // وحشت / ریزش آبشاری و فشار سنگین فروش
  | 'MEAN_REVERSION'      // کشیدگی مفرط و بازگشت آماری به میانگین
  | 'NEWS_WHIPSAW';       // شلاق نوسانی سریع و دوطرفه ناشی از اخبار

export type RegimeStrategyType =
  | 'MOMENTUM_TREND_FOLLOWING'        // تعقیب روند و ورود در اصلاح‌ها
  | 'RANGE_BOUND_SUPPORT_RESISTANCE'  // نوسان‌گیری بین حمایت و مقاومت رنج
  | 'VOLATILITY_BREAKOUT_EXPANSION'   // شکار بریک‌اوت و همراهی با انفجار قیمت
  | 'SQUEEZE_BREAKOUT_PREPARATION'    // آمادگی شکست فشردگی
  | 'IMPULSE_EXPANSION_RIDE'          // سواری بر موج پرشتاب تکانه
  | 'VOLATILITY_ADAPTIVE_WIDE_BRACKET'// براکت‌های عریض و مدیریت حجم در نوسان بالا
  | 'CAPITULATION_ABSORPTION_HARVEST' // جذب تسلیم نهایی یا خروج موقت در پنیک
  | 'STATISTICAL_MEAN_REVERSION'      // معامله بازگشت به میانگین VWAP / EMA200
  | 'DEFENSIVE_PRESERVATION_STANDBY'; // وضعیت تدافعی، کاهش ریسک و عدم ورود در شلاق خبری

export interface MarketRegimeClassification {
  activeRegime: AdvancedRegimeType;
  regimeFa: string;
  confidencePct: number;          // 0 - 100%
  suitableStrategy: RegimeStrategyType;
  strategyDescriptionFa: string;
  regimeProbabilities: Record<AdvancedRegimeType, number>;
  probabilityModelValidation: {
    status: 'CALIBRATED' | 'UNCALIBRATED';
    modelVersion: string;
    horizonCandles: number;
    trainingSampleSize: number;
    calibrationSampleSize: number;
    oosSampleSize: number;
    oosBrierScore: number | null;
    baselineBrierScore: number | null;
  };
  metrics: {
    adx: number;
    atrRatio: number;              // Current ATR / Historical baseline ATR
    bollingerBandWidthPct: number; // (Upper - Lower) / Mid
    vwapDeviationStd: number;      // Distance to VWAP in standard deviations
    orderBookImbalance: number;
    volumeSurgeRatio: number;      // Current Volume / 20-period avg Volume
    whipsawWickRatio: number;      // Ratio of candle wicks to candle bodies
    trendAlignmentScore: number;   // -100 to +100
  };
  rationaleFa: string;
  classifiedAt: number;
}

// -------------------------------------------------------------
// ۲۸. عملکرد تخصصی ستاپ‌ها بر پایه رژیم و تایم‌فریم (Regime-Specific Setup Edge Matrix)
// Setup × Regime × Timeframe
// -------------------------------------------------------------
export type TradingTimeframe = '1m' | '5m' | '15m' | '1h' | '4h';

export interface SetupRegimeEdgeRecord {
  setupType: EntryCandidateType;
  setupTypeFa: string;
  regime: AdvancedRegimeType;
  regimeFa: string;
  timeframe: TradingTimeframe;
  
  sampleCount: number;
  winRatePct: number | null;
  profitFactor: number | null;
  averageR: number | null;
  expectancyR: number | null;      // امید ریاضی در واحد R
  validationStatus: 'VALIDATED' | 'UNVALIDATED';
  
  positiveEdgeVerified: boolean;  // آیا Edge آماری مثبت دارد؟
  activationStatus: 'ACTIVE_APPROVED' | 'BLOCKED_NEGATIVE_EDGE' | 'UNVALIDATED';
  reasonFa: string;
}

export interface RegimeSetupMatrixReport {
  activeRegime: AdvancedRegimeType;
  activeTimeframe: TradingTimeframe;
  activeDirection: 'LONG' | 'SHORT';
  activeSetupCandidate: EntryCandidateType;
  currentEdgeRecord: SetupRegimeEdgeRecord;
  isSetupAllowedInCurrentRegime: boolean; // گیت اصلی: آیا ستاپ مجاز به اجراست؟
  
  matrixRecords: SetupRegimeEdgeRecord[]; // ماتریس کامل ستاپ × رژیم
  bestSetupsForCurrentRegime: { setupType: EntryCandidateType; setupTypeFa: string; expectancyR: number }[];
  prohibitedSetupsInCurrentRegime: { setupType: EntryCandidateType; setupTypeFa: string; reasonFa: string }[];
  summaryVerdictFa: string;
  evaluatedAt: number;
}

// -------------------------------------------------------------
// ۳۱ & ۳۲. موتور رقابت سناریوها و انتخاب برنده با Evidence
// Scenario Competition Engine & Evidence Evaluator
// -------------------------------------------------------------
export type CompetitiveScenarioType =
  | 'CONTINUATION'    // امتداد روند صعودی یا نزولی
  | 'PULLBACK'        // اصلاح درون‌روندی بهینه برای ورود
  | 'REVERSAL'        // چرخش و معکوس شدن کلی ساختار
  | 'BREAKOUT'        // شکست پرحجم سطوح کلیدی
  | 'FAKEOUT'         // تله شکست کاذب و هانت نقدینگی
  | 'RANGE';          // نوسان رنج و تعادل نقدینگی

export interface ScenarioEvidenceBreakdown {
  probabilityPct: number;          // ۱. احتمال وقوع از داده‌های واقعی (> 55%)
  expectedValueR: number;          // ۲. امید ریاضی مثبت (> +0.20R)
  confidenceIntervalScore: number; // ۳. فاصله اطمینان آماری (0-100)
  regimeFitScore: number;          // ۴. میزان انطباق با رژیم فعال بازار (0-100)
  liquidityStructureScore: number; // ۵. انطباق با استخرهای نقدینگی، CVD و OBI (0-100)
}

export interface MarketScenarioCandidate {
  scenarioType: CompetitiveScenarioType;
  scenarioTypeFa: string;
  evidence: ScenarioEvidenceBreakdown;
  
  overallEvidenceScore: number;    // میانگین وزنی ۵ شاخص شواهد (0 - 100)
  evidencePassed: boolean;         // آیا تمامی ۵ شرط شواهد همزمان پاس شده‌اند؟
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  keyTriggersFa: string[];
}

export interface ScenarioCompetitionReport {
  candidates: MarketScenarioCandidate[];
  winningScenario: MarketScenarioCandidate | null;
  runnerUpScenario: MarketScenarioCandidate | null;
  
  probabilityGapPct: number;       // اختلاف درصد احتمال سناریوی اول و دوم
  isCloseCompetition: boolean;     // آیا رقابت بسیار نزدیک است؟ (gap < 8%)
  
  tradeDecision: 'EXECUTE_WINNING_SCENARIO' | 'NO_TRADE_CLOSE_COMPETITION' | 'NO_TRADE_INSUFFICIENT_EVIDENCE';
  verdictFa: string;
  evaluatedAt: number;
}


// -------------------------------------------------------------
// ۲۹ & ۳۰. ساختار پیشرفته چند تایم‌فریمه (MTF Structural Engine)
// -------------------------------------------------------------
export type MtfRoleType = 'MACRO_STRUCTURE' | 'REGIME_STRUCTURE' | 'SETUP' | 'ENTRY_ZONE' | 'TRIGGER_EXECUTION';

export interface MtfRoleDefinition {
  timeframe: TradingTimeframe;
  role: MtfRoleType;
  roleFa: string;
  focusAreaFa: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number; // 0 - 100
  detailsFa: string;
}

export type MtfStructuralScenarioType =
  | 'PULLBACK_IN_HTF_TREND'            // اصلاح موقت درون‌روندی جهت ورود لانگ/شورت قوی
  | 'HTF_REVERSAL_CONFIRMED'           // چرخش کلی و قطعی ساختار کلان
  | 'CONGRUENT_TREND_CONTINUATION'     // روند فوق‌العاده همگرا و یکدست در تمام تایم‌فریم‌ها
  | 'CHOPPY_NO_EDGE';                  // بازار نوسانی نامنظم و بدون لبه معاملاتی واضح

export interface MtfStructuralReport {
  roles: Record<TradingTimeframe, MtfRoleDefinition>;
  activeScenario: MtfStructuralScenarioType;
  scenarioFa: string;
  isConflictDetected: boolean;
  conflictDetailsFa: string;
  actionPermission: 'ALLOWED_EXECUTE' | 'BLOCKED_BY_CONFLICT' | 'ALLOWED_PULLBACK_ONLY';
  verdictFa: string;
  finalUnifiedScore: number; // وزن‌دهی شده بر اساس نقش‌ها
  calculatedAt: number;
}

// -------------------------------------------------------------
// ۳۳ & ۳۴. پیش‌بینی‌کننده مستقل احتمال عدم معامله (No-Trade Predictor Engine)
// -------------------------------------------------------------
export type NoTradeRiskFactorType =
  | 'CHOP'                 // نوسان نامنظم، ساید بدون روند و فقدان تکانه
  | 'WHIPSAW'              // شلاق قیمتی سریع، سایه‌های بلند دوطرفه و استاپ‌هانتر
  | 'NEWS_SHOCK'           // شوک ناگهانی ناشی از رویدادها یا اخبار پرریسک
  | 'LOW_LIQUIDITY'        // عمق کم دفتر سفارشات، اسلیپیج بالا و اسپرد عریض
  | 'CONFLICTING_SIGNALS'; // تناقض شدید بین اندیکاتورها، تایم‌فریم‌ها و مدل‌های پیش‌بینی

export interface NoTradeFactorAssessment {
  factor: NoTradeRiskFactorType;
  factorFa: string;
  severityScore: number;   // 0 - 100
  weight: number;          // وزن شاخص
  isTriggered: boolean;    // آیا این عامل از مرز بحرانی گذشته است؟
  evidenceFa: string;      // شواهد فنی تشخیص
}

export interface NoTradePredictionReport {
  noTradeProbabilityPct: number;    // احتمال مستقل عدم مناسب بودن بازار (0 - 100%)
  statisticalThresholdPct: number;  // آستانه آماری وتوی ترید (پیش‌فرض: 65%)
  isNoTradeTriggered: boolean;      // آیا وتوی قطعی معامله فعال شد؟
  
  primaryRiskFactor: NoTradeRiskFactorType | null;
  riskFactors: NoTradeFactorAssessment[];
  
  vetoAction: 'HARD_LOCK_NO_TRADE' | 'CONDITIONAL_CAUTION' | 'SAFE_TO_TRADE';
  overrideMessageFa: string;
  verdictFa: string;
  calculatedAt: number;
}

// -------------------------------------------------------------
// 91. Data-Driven Dynamic Model Pruning & Weighting
// -------------------------------------------------------------
export interface DynamicModelWeightingResult {
  modelId: string;
  rawWeight: number;
  effectiveWeight: number;
  isPrunedInCurrentRegime: boolean;
  isFreshCapped: boolean;
  oosBoostFactor: number;
  regimePerformanceAccuracyPct: number;
  reasonFa: string;
}

// -------------------------------------------------------------
// 92. Meta-Model / Meta-Learner Layer
// -------------------------------------------------------------
export interface MetaLearnerInputFeatures {
  modelPredictions: Record<string, {
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    prob: number | null;
    healthState: MetaModelHealthState;
  }>;
  garchFeature?: { conditionalVolPct: number | null; regime: string; isStationary: boolean };
  bayesianFeature?: { posterior: number | null; bayesFactor: number; isCalibrated: boolean };
  orderBookFeature?: { obi: number | null; bidDepthUsd: number | null; askDepthUsd: number | null };
  cvdFeature?: { cvdDelta: number | null };
  oiFeature?: { oiValue: number | null; oiChangePct: number | null };
  fundingFeature?: { fundingRate: number | null };
  momentumFeature?: { rsi: number | null; adx: number | null };
  marketRegime: string;
  regimeProbabilities?: Record<AdvancedRegimeType, number>;
  setupType?: string | null;
  spreadBps: number | null;
  volatilityPct: number | null;
  disagreementIndex: number; // 0 - 100%
  calibrationErrorPct?: number | null;
  signalAgeMs?: number | null;
  predictionStabilityScore?: number; // 0 - 100%
  latencyMs: number | null;
}

export interface MetaLearnerPrediction {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  calibratedProbabilityPct: number | null; // Null if underlying models or sample size fail OOS validation
  expectedReturnR: number | null;
  expectedReturnUsd: number | null;
  expectedMaeR: number | null;
  expectedMfeR: number | null;
  expectedDurationSeconds: number | null;
  confidenceInterval: {
    lowerBoundPct: number | null;
    upperBoundPct: number | null;
    confidenceLevelPct: number;
  } | null;
  dominantModelId: string;
  calibrationStatus: 'CALIBRATED' | 'UNCALIBRATED' | 'UNRANKED';
  confidenceScorePct: number | null;
  metaRationaleFa: string;
  evaluatedAt: number;
}

// -------------------------------------------------------------
// 93. Model Disagreement Risk Evaluation
// -------------------------------------------------------------
export interface ModelDisagreementReport {
  isHighDisagreementDetected: boolean;
  disagreementIndex: number; // 0 - 100%
  directionalEntropy: number; // 0 - 1
  conflictingDirectionCount: number;
  modelsBreakdown: Array<{
    modelId: string;
    modelNameFa: string;
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    confidencePct: number;
    effectiveWeightPct: number;
  }>;
  disagreementPenaltyFactor: number; // 0.1 to 1.0 (scales down sizing / EV)
  vetoTriggered: boolean;
  verdictFa: string;
}

// -------------------------------------------------------------
// 94. Prediction Stability Engine
// -------------------------------------------------------------
export interface PredictionStabilityReport {
  isPredictionStable: boolean;
  predictionStabilityScore: number; // 0 - 100%
  recentPredictionsJitterVariance: number;
  isEntryBlockedByInstability: boolean;
  recentProbabilitiesSample: number[];
  reasonsFa: string[];
  evaluatedAt: number;
}

// -------------------------------------------------------------
// 95. Temporal Entry Stability
// -------------------------------------------------------------
export interface TemporalEntryStabilityReport {
  isTemporalStabilityVerified: boolean;
  consecutiveHighThresholdSnapshots: number;
  requiredConsecutiveSnapshots: number;
  isStructuralTriggerConfirmed: boolean;
  structuralTriggerType?: string;
  isLateEntryPrevented: boolean;
  verdictFa: string;
  checkedAt: number;
}

// -------------------------------------------------------------
// 100. Master Decision Object (Single Immutable Gateway Before Execution)
// -------------------------------------------------------------
export type MasterDecisionStatus = 'NO_TRADE' | 'ARMED' | 'TRIGGERED' | 'EXECUTE';

export interface MasterDecisionObject {
  decisionId: string;
  status: MasterDecisionStatus;
  statusFa: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  probabilityPct: number;
  confidenceInterval: {
    lowerBoundPct: number;
    upperBoundPct: number;
    widthPct: number;
  };
  score: number; // 0 - 100
  expectedValueUsd: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskUsd: number;
  modelVersion: string;
  dataTimestamp: number;
  dataTimestampIso: string;
  signalExpiryTimestamp: number;
  isExpired: boolean;
  masterVerdictFa: string;
  rejectionBlockersFa: string[];
  executionPermitted: boolean;
  metaLearnerOutput?: MetaLearnerPrediction;
  disagreementReport?: ModelDisagreementReport;
  predictionStability?: PredictionStabilityReport;
  temporalStability?: TemporalEntryStabilityReport;
  opportunitySurface?: EntryOpportunitySurfaceReport;
}

// -------------------------------------------------------------
// 101. HUNTER OS (7-Ring Hunter Architecture)
// -------------------------------------------------------------
export type HunterOsRingId =
  | 'SCOUT'
  | 'AMBUSH'
  | 'PREDICT'
  | 'PRICE_HUNTER'
  | 'TRIGGER'
  | 'WAVE_RIDER'
  | 'EXIT_LEARN';

export interface HunterRingStatus {
  ringId: HunterOsRingId;
  nameFa: string;
  stageNameFa: string;
  isActive: boolean;
  isComplete: boolean;
  score: number; // 0 - 100
  statusTextFa: string;
  metricLabelFa: string;
  metricValue: string | number;
  timestamp: number;
}

// -------------------------------------------------------------
// 102. EDGE DECAY RADAR
// -------------------------------------------------------------
export type EdgeDecayAction = 'HOLD' | 'REDUCE' | 'EXIT';

export interface EdgeDecayRadarMetrics {
  positionId: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  entryProbabilityPct: number;
  currentProbabilityPct: number;
  probabilityDeltaPct: number;
  entryEvR: number; // Expected Value in R units at entry (e.g. +0.62R)
  currentEvR: number; // Current real-time Expected Value in R (e.g. -0.21R)
  evDeltaR: number;
  decayRatioPct: number; // 100% = intact, 0% = completely decayed, <0% = negative edge
  momentumErosionPct: number;
  adversePressurePct: number;
  recommendedAction: EdgeDecayAction;
  actionReasonFa: string;
  confidenceScore: number;
  urgencyLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  evaluatedAt: number;
}

// -------------------------------------------------------------
// 103. WAVE DNA & WAVE DATASET
// -------------------------------------------------------------
export type WaveOriginType =
  | 'LIQUIDITY_SWEEP'
  | 'BREAKOUT_CONSOLIDATION'
  | 'WHALE_ABSORPTION'
  | 'FUNDING_REVERSION'
  | 'SQUEEZE_EXPLOSION'
  | 'MEAN_REVERSION'
  | 'TREND_CONTINUATION';

export type WaveExhaustionPattern =
  | 'CLIMAX_VOLUME'
  | 'DIVERGENCE_EXHAUSTION'
  | 'ORDER_BOOK_WALL_REJECTION'
  | 'ABSORPTION_FAIL'
  | 'MOMENTUM_DRAIN'
  | 'NONE_HEALTHY';

export interface WaveDnaSignature {
  dnaId: string;
  timestamp: number;
  origin: WaveOriginType;
  direction: 'LONG' | 'SHORT';
  regime: string;
  momentum: number; // RSI / MACD / ROC composite normalized (-100 to +100)
  volumeZScore: number; // Volume relative intensity
  cvdDeltaPct: number; // Cumulative Volume Delta slope
  obiImbalance: number; // -1.0 to +1.0
  liquidityScore: number; // 0 - 100
  volatilityAtrPct: number;
  mfeR: number; // Maximum Favorable Excursion in R
  maeR: number; // Maximum Adverse Excursion in R
  durationSeconds: number;
  accelerationScore: number; // Price acceleration (d2P/dt2)
  exhaustionPattern: WaveExhaustionPattern;
  outcome: 'CONTINUED' | 'FAILED' | 'REVERSED' | 'IN_PROGRESS';
  actualRealizedR?: number;
}

export interface WaveDnaSimilarityMatch {
  matchedDna: WaveDnaSignature;
  similarityScorePct: number; // 0 - 100%
  outcome: 'CONTINUED' | 'FAILED' | 'REVERSED';
  realizedR: number;
}

export interface WaveDnaDatabaseReport {
  totalWavesInDataset: number;
  similarWavesFoundCount: number;
  continuationCount: number;
  failedCount: number;
  continuationRatePct: number | null;
  failureRatePct: number | null;
  averageMfeR: number | null;
  averageMaeR: number | null;
  isStatisticallySufficient: boolean;
  verdictFa: string;
  topMatches: WaveDnaSimilarityMatch[];
}

// -------------------------------------------------------------
// 104. HUNTER EPISODIC MEMORY & COUNTERFACTUAL LEARNING ENGINE
// -------------------------------------------------------------
export interface CounterfactualBranch {
  name: string;
  nameFa: string;
  descriptionFa: string;
  entryPrice: number;
  stopPrice: number;
  exitPrice: number;
  realizedR: number;
  pnlDeltaPct: number;
  maePct: number;
  mfePct: number;
  wasStopHitPrematurely: boolean;
  efficiencyScorePct: number;
}

export interface CounterfactualAnalysis {
  baselineRealizedR: number;
  optimalRealizedR: number;
  missedRMultiple: number;
  // Entry offset experiments (0.1, 0.25, 0.5 ATR)
  entryBranches: {
    better0_1Atr: CounterfactualBranch;
    better0_25Atr: CounterfactualBranch;
    better0_5Atr: CounterfactualBranch;
    delayed10s: CounterfactualBranch;
  };
  // Stop distance experiments (+0.2, -0.2 ATR)
  stopBranches: {
    wider0_2Atr: CounterfactualBranch;
    tighter0_2Atr: CounterfactualBranch;
  };
  // Exit timing experiments (early, delayed runner, optimal MFE)
  exitBranches: {
    earlyMomentumPause: CounterfactualBranch;
    delayedStructuralRunner: CounterfactualBranch;
    optimalPeakMfe: CounterfactualBranch;
  };
  bestBranchVerdictFa: string;
  keyLessonFa: string;
}

export interface HunterEpisodicMemoryRecord {
  memoryId: string;
  timestamp: number;
  timestampIso: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  realizedPnlUsd: number;
  realizedR: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  
  // 1. Root Thesis & Setup
  entryReasonFa: string; // چرا وارد شدیم؟
  triggerEventFa: string; // Trigger چه بود؟
  waveStageAtEntry: string; // Wave Stage چه بود؟
  entryQualityScore: number; // Entry Quality چه بود؟ (0 - 100)
  entryProbabilityPct: number; // Probability چه بود؟
  
  // 2. Multi-Model Consensus & Disagreement
  agreeingModels: string[]; // چه Modelهایی موافق بودند؟ (e.g. ['SB1', 'SB3', 'BayesianBrain'])
  disagreeingModels: string[]; // کدام Model مخالف بود؟ (e.g. ['SB4', 'MacroBrain'])
  
  // 3. Post-Mortem Root Cause
  profitOrLossReasonFa: string; // چرا سود کرد؟ یا چرا ضرر کرد؟
  wasPrematureStopOut: boolean;
  wasSlippageSevere: boolean;
  
  // 4. Ground Truth Real Extremes
  realBestEntryPrice: number; // بهترین Entry واقعی کجا بود؟
  realBestExitPrice: number; // بهترین Exit واقعی کجا بود؟
  optimalMfeR: number;
  worstMaeR: number;
  
  // 5. Counterfactual Simulation
  counterfactual: CounterfactualAnalysis;
  
  // 6. Actionable Takeaway for Future Trades
  actionableAdjustment: {
    recommendedEntryOffsetAtr: number; // e.g. -0.15 ATR for better limit snipe
    recommendedStopBufferAtr: number; // e.g. +0.2 ATR wider
    recommendedExitPolicy: 'EARLY_DECAY_EXIT' | 'STANDARD_TP' | 'MFE_TRAIL_RUNNER';
    lessonSummaryFa: string;
  };
}

export interface HunterMemoryInsights {
  totalAnalyzedMemories: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  totalCapturedR: number;
  potentialOptimalR: number;
  averageMissedRPerTrade: number;
  
  // Learned optimal policies across all episodic memory
  learnedOptimalEntryOffsetAtr: number; // e.g. +0.22 ATR patience
  learnedOptimalStopBufferAtr: number; // e.g. +0.18 ATR buffer to stop noise wicks
  learnedBestExitStrategy: 'EARLY_DECAY_EXIT' | 'STANDARD_TP' | 'MFE_TRAIL_RUNNER';
  mostReliableModel: string;
  mostFrequentContrarianModel: string;
  frequentLossRootCausesFa: { causeFa: string; count: number }[];
  strategicImprovementSummaryFa: string;
  memories: HunterEpisodicMemoryRecord[];
}


