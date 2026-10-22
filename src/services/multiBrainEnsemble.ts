import { AnalysisResult, TradeHistory, BrainRoleType, ModelDisagreementReport, MetaModelHealthState } from '../types/trading';
import {
  predict30mTrendReversalPatternLayer,
  detectWhaleTrapAndLiquiditySweep,
  WhaleTrapSweepReport,
  computeBayesianMicroVector,
} from './predictiveEngine';
import { brainPriorityCoordinator, PriorityCoordinatorReport } from './brainPriorityCoordinator';
import { computeCentralCalibratedProbability } from './centralProbabilityEngine';
import { realGarchEngine } from './realGarchEngine';
import { realBayesianEngine } from './realBayesianEngine';

import { centralTradeDatasetService } from './centralTradeDataset';
import { macroContextBrainService } from './macroContextBrain';
import { whaleStatisticalProofEngine } from './whaleStatisticalProofEngine';
import { metaModelEnsembleEngine } from './metaModelEnsemble';
import {
  analyzeWalkForwardCandlePatterns,
  type WalkForwardCandleResearchInput,
  type WalkForwardCandleResearchReport,
} from './walkForwardCandleResearch';

/**
 * 🧠 معماری ۲۱ مغز پردازشی سیستم معاملاتی (Transparent 21-Brain Architecture)
 * تفکیک دقیق:
 * RAW DATA → FEATURE PROCESSOR → MODEL PREDICTION → CALIBRATION → CENTRAL PROBABILITY
 */

export type BrainType = BrainRoleType;

export interface Brain1MacroTrend {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rawEvidenceScore: number; // امتیاز شواهد اولیه
  scorePct: number; // Backwards-compatibility alias for legacy UI components
  hurstExponent: number;
  mtfAlignmentScore: number;
  mtfAlignmentPct: number; // Backwards-compatibility alias
  rationaleFa: string;
}

export interface Brain2LiquidityFlow {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  whaleAggressionScore: number;
  obiValue: number;
  trapDetected: boolean;
  trapDetails?: WhaleTrapSweepReport;
  liquidityPoolUsd: number;
  rationaleFa: string;
}

export interface Brain3GarchVolatility {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  garchRegime: 'COMPRESSION' | 'EXPANSION' | 'SPIKE_TURBULENCE' | 'NORMAL' | 'UNKNOWN';
  volatilityForecastPct: number | null;
  volatilityForecastHorizonMinutes: number | null;
  adaptiveTrailingOffsetPct: number;
  stopLossBufferPct: number;
  calibratedProbabilityPct: number | null;
  oosForecastErrorPct: number | null;
  rationaleFa: string;
}

export interface Brain4PatternDivergence {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  patternMatchPct: number | null;
  matchedPatternName: string;
  reversal30mProbabilityPct: number | null;
  expectedMove30mPct: number | null;
  calibratedProbabilityPct: number | null;
  rationaleFa: string;
}

export interface Brain5FloatingRiskHedging {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  riskBreakevenTriggerPrice: number;
  feeBufferPct: number;
  hedgingAllocationRatio: number;
  floatingSystemHarmonized: boolean | null;
  rationaleFa: string;
}

export interface Brain6OnChainWhaleFlow {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  netflowBtc24h: number | null;
  exchangeReserveStatusFa: string;
  whaleSentiment: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' | 'UNKNOWN';
  whalePressureIndex: number | null;
  rawEvidenceScore: number | null;
  onChainScorePct: number | null;
  rationaleFa: string;
}

export interface Brain7OrderBookCvd {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  cvdDeltaScore: number | null;
  bidAskRatio: number;
  subSecondOrderImbalancePct: number;
  rationaleFa: string;
  isEmpiricalMetric?: boolean;
  isLiveMeasured?: boolean;
  realCvdDeltaBtc?: number | null;
}

export interface Brain8FundamentalMacro {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  newsOscillatorScore: number | null;
  macroImpactLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE';
  blackoutCaution: boolean | null;
  rationaleFa: string;
}

export interface Brain9BayesianProbabilistic {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  priorProbabilityPct: number;
  posteriorProbabilityPct: number | null;
  confidenceIntervalWidthPct: number | null;
  calibratedProbabilityPct: number | null;
  priorSource: string;
  rationaleFa: string;
}

export interface Brain10AutoPilotHarmonizer {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  autoPilotActive: boolean;
  trailingExpansionRatio: number;
  riskProtectionEscapeSpeedMs: number | null;
  feeBufferCovered: boolean | null;
  rationaleFa: string;
}

export interface Brain11OnChainWhaleSentiment {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  largeTransactionsCount24h: number | null;
  largeTransactionsVolumeUsd: number | null;
  whaleSentimentBias: 'ACCUMULATION' | 'DISTRIBUTION' | 'MANIPULATION_ALERT' | 'NEUTRAL' | 'UNKNOWN';
  manipulationRiskPct: number | null;
  whaleActivityPressureScore: number | null;
  rationaleFa: string;
}

export interface Brain12RealWorldExecutionSniper {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  exchangeLatencyMs: number | null;
  slippageTolerancePct: number;
  makerTakerOptimized: boolean | null;
  spreadBtcUsd: number | null;
  realWorldExecutionScore: number | null;
  rationaleFa: string;
  isEmpiricalMetric?: boolean;
  isLiveMeasured?: boolean;
}

export interface Brain13AsymmetricProfitRunner {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  trailingExpansionRatio: number;
  peakProfitTargetPct: number;
  profitHarvestMode: 'SCALP_LOCK' | 'WAVE_RUNNER' | 'EXPONENTIAL_SURGE';
  asymmetricGainMultiplier: number;
  rationaleFa: string;
}

export interface Brain14LossToBreakevenEscaper {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  escapeSpeedMs: number | null;
  activeLossEvacuationProtocol: boolean | null;
  breakevenOffsetBufferUsd: number | null;
  rawEvidenceScore: number | null;
  rationaleFa: string;
}

export interface Brain15TradeFrequencyPreserver {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  dailyOpportunitiesTarget: number;
  detectedMicroOpportunities: number | null;
  frequencyPreserved: boolean | null;
  microChopScalpActive: boolean;
  isPassiveMonitorOnly: boolean;
  rationaleFa: string;
}

export interface Brain16DrawdownLockoutGuardian {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  activeLockState: boolean | null;
  lockedPositionsCount: number | null;
  divertedComputingPowerToRecoveryPct: number | null;
  isNewTradeBlocked: boolean | null;
  rationaleFa: string;
}

export interface Brain17RapidLossTurnaround {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  microPivotPrice: number;
  recoveryDistancePct: number;
  targetBreakevenSpeedSec: number;
  turnaroundActive: boolean;
  rationaleFa: string;
}

export interface Brain18StagnantTimeDecayLiquidator {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  maxTradeDurationMinutes: number;
  breakevenLiquidateTriggered: boolean;
  capitalLiberatedPct: number | null;
  stagnationEvacuationActive: boolean;
  rationaleFa: string;
}

export interface Brain19LoadReallocator {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  underperformingBrainsPrunedCount: number | null;
  reallocatedCapacityPct: number | null;
  pruningActive: boolean | null;
  rationaleFa: string;
}

export interface Brain20LatencyArbitrage {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  bboSpreadCaptureUsd: number | null;
  subSecondExecutionMs: number | null;
  arbitrageShieldActive: boolean | null;
  rationaleFa: string;
}

export interface Brain21StrategicRecovery {
  brainType: BrainType;
  role: BrainRoleType;
  nameFa: string;
  globalFreezeActive: boolean | null;
  microAtrUsd: number;
  exactCounterVolumeUsd: number | null;
  targetBreakevenSeconds: number | null;
  recoveryStatusFa: string;
  rationaleFa: string;
}

export interface IndependentModelPrediction {
  modelId: string;
  nameFa: string;
  prediction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rawProbabilityPct: number | null;
  historicalPrecisionPct: number | null;
  sampleSize: number;
  calibrationFactor: number;
  regimePerformancePct: number | null;
  healthState: MetaModelHealthState;
  independenceValidated: boolean;
  correlationWithOtherModels: number | null;
  effectiveWeight: number;
}

export interface PipelineArchitectureReport {
  rawDataFeedsCount: number;
  featureProcessorsCount: number;
  statisticalModelsCount: number;
  calibrationMethod: string;
  pipelineFlowFa: string;
}

export interface MultiBrainConsensusReport {
  timestamp: string;
  timestampMs: number;
  sourceTimestampMs: number | null;
  currentPrice: number;
  masterDirection: 'LONG' | 'SHORT' | 'HOLD';
  consensusScorePct: number; // اجماع کالیبره‌شده بر اساس مدل‌های مستقل
  confidenceGrade: 'DIAMOND_S_TIER' | 'GOLD_ALPHA' | 'TACTICAL_SCALP' | 'BLOCKED_RISK';
  winProbabilityPct: number | null;
  riskProtectionActive: boolean;
  tradeFrequencyMonitoringOnly: boolean;
  drawdownLockoutActive: boolean;
  
  dynamicWeights: Record<string, number>; // Backwards compatibility for legacy widgets
  scenarioMatrix?: any; // Backwards compatibility
  
  pipelineArchitecture: PipelineArchitectureReport;
  independentModels: IndependentModelPrediction[];
  modelDisagreement: ModelDisagreementReport;
  
  // ۲۱ بخش پردازشی
  brain1Macro: Brain1MacroTrend;
  brain2Liquidity: Brain2LiquidityFlow;
  brain3Volatility: Brain3GarchVolatility;
  brain4Pattern: Brain4PatternDivergence;
  historicalCandleResearch: WalkForwardCandleResearchReport;
  brain5RiskHedging: Brain5FloatingRiskHedging;
  brain6OnChainWhale: Brain6OnChainWhaleFlow;
  brain7OrderBookCvd: Brain7OrderBookCvd;
  brain8FundamentalMacro: Brain8FundamentalMacro;
  brain9BayesianProbabilistic: Brain9BayesianProbabilistic;
  brain10AutoPilotHarmonizer: Brain10AutoPilotHarmonizer;
  brain11OnChainWhaleSentiment: Brain11OnChainWhaleSentiment;
  brain12ExecutionSniper: Brain12RealWorldExecutionSniper;
  brain13MaxProfit: Brain13AsymmetricProfitRunner;
  brain14LossToBreakeven: Brain14LossToBreakevenEscaper;
  brain15FrequencyPreserver: Brain15TradeFrequencyPreserver;
  brain16DrawdownLockout: Brain16DrawdownLockoutGuardian;
  brain17RapidTurnaround: Brain17RapidLossTurnaround;
  brain18StagnantLiquidator: Brain18StagnantTimeDecayLiquidator;
  brain19LoadReallocator: Brain19LoadReallocator;
  brain20LatencyArbitrage: Brain20LatencyArbitrage;
  brain21StrategicRecovery: Brain21StrategicRecovery;

  coordinatorReport: PriorityCoordinatorReport;

  proposalsListFa: Array<{
    id: string;
    category: 'PREDICTION_ACCURACY' | 'SCENARIO_READINESS' | 'FLOATING_HARMONY' | 'REAL_WORLD_EXECUTION';
    titleFa: string;
    status: 'ACTIVE_CALIBRATED' | 'READY_FOR_DEPLOYMENT' | 'BLOCKED_UNVALIDATED';
    descriptionFa: string;
    impactFa: string;
  }>;
  
  learningFeedbackStatusFa: string;
}

let latestMultiBrainReport: MultiBrainConsensusReport | null = null;

function evaluateModelHealthState(
  isCalibrated: boolean,
  hasProbability: boolean,
  sampleSize: number,
  oosPrecisionPct: number | null
): MetaModelHealthState {
  if (
    !isCalibrated ||
    !hasProbability ||
    oosPrecisionPct === null ||
    !Number.isFinite(oosPrecisionPct) ||
    sampleSize < 15 ||
    oosPrecisionPct < 50
  ) return 'SUSPENDED';
  return sampleSize < 35 || oosPrecisionPct < 55 ? 'DEGRADED' : 'HEALTHY';
}

export function getLatestMultiBrainConsensusReport(
  currentPrice: number,
  sourceTimestampMs: number | null,
  maxAgeMs = 3000
): MultiBrainConsensusReport | null {
  const report = latestMultiBrainReport;
  if (
    !report ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0 ||
    sourceTimestampMs === null ||
    !Number.isFinite(sourceTimestampMs) ||
    report.sourceTimestampMs === null ||
    Math.abs(report.sourceTimestampMs - sourceTimestampMs) > 250 ||
    Date.now() - report.timestampMs < 0 ||
    Date.now() - report.timestampMs > maxAgeMs ||
    Math.abs(report.currentPrice - currentPrice) / currentPrice > 0.0015
  ) return null;
  return report;
}

/**
 * اجرا و ارزیابی معماری ۲۱ مغزی با اجماع بر پایه مدل‌های آماری مستقل
 */
export function runUnifiedMultiBrainEnsemble(
  analysis: Partial<AnalysisResult> | any,
  aiPrediction: any,
  currentPrice: number,
  recentHistory: TradeHistory[] = [],
  historicalCandleInput?: Pick<
    WalkForwardCandleResearchInput,
    'candles' | 'exchange' | 'market' | 'pair' | 'sourceTimestampMs' | 'dataStatus' | 'feeBpsPerSide' | 'slippageBpsPerSide'
  >,
): MultiBrainConsensusReport {
  const datasetService = centralTradeDatasetService;
  const p = currentPrice;
  const obi = analysis?.realObiData?.obi;
  const volPct = analysis?.volatilityPct;
  const rsi = analysis?.rsi;
  const setupType = analysis?.setupContext?.setupType || analysis?.setupType;
  const timeframe = analysis?.timeframe;
  const marketRegime = analysis?.marketRegime;
  const candles = analysis?.candles;
  if (
    !Number.isFinite(p) || p <= 0 ||
    typeof obi !== 'number' || !Number.isFinite(obi) ||
    typeof volPct !== 'number' || !Number.isFinite(volPct) ||
    typeof rsi !== 'number' || !Number.isFinite(rsi) ||
    !setupType ||
    !timeframe ||
    !marketRegime ||
    !Array.isArray(candles) ||
    candles.length < 300
  ) {
    throw new Error('Multi-brain consensus requires a validated live price, 300 candles, regime, setup, order-flow, volatility, RSI, and timeframe.');
  }
  const rawDirection = analysis?.direction === 'SHORT' ? 'SHORT' : (analysis?.direction === 'LONG' ? 'LONG' : 'HOLD');
  if (rawDirection === 'HOLD') {
    throw new Error('Multi-brain directional consensus cannot run without a live LONG or SHORT setup.');
  }

  // ۱. مغز ۱: پردازشگر ویژگی روند و فرکتال (Feature Processor)
  const hurst = 0.58 + (Math.abs(obi) * 0.2);
  const mtfScore = Math.min(100, Math.round(50 + Math.abs(obi) * 120));
  const rawScore = Math.min(98, Math.round(65 + Math.abs(obi) * 80));
  const brain1Macro: Brain1MacroTrend = {
    brainType: 'FEATURE_PROCESSOR',
    role: 'FEATURE_PROCESSOR',
    nameFa: 'مغز ۱: پردازشگر ویژگی فرکتال و روند کلان (Fractal & MTF Feature Processor)',
    bias: rawDirection === 'SHORT' ? 'BEARISH' : (rawDirection === 'LONG' ? 'BULLISH' : 'NEUTRAL'),
    rawEvidenceScore: rawScore,
    scorePct: rawScore,
    hurstExponent: Math.round(hurst * 100) / 100,
    mtfAlignmentScore: mtfScore,
    mtfAlignmentPct: mtfScore,
    rationaleFa: `برآورد هرست و امتیاز تایم‌فریم با heuristic از قیمت/کندل ساخته شده‌اند؛ این‌ها احتمال کالیبره‌شده یا سلامت مدل نیستند (H=${hurst.toFixed(2)}).`
  };

  // ۲. مغز ۲: پردازشگر ویژگی نقدینگی اردر بوک (Feature Processor)
  const trapInfo = detectWhaleTrapAndLiquiditySweep(p, obi, analysis?.candles || []);
  const liquidityPoolUsd = Math.round(p * (rawDirection === 'SHORT' ? 0.981 : 1.019));
  const brain2Liquidity: Brain2LiquidityFlow = {
    brainType: 'FEATURE_PROCESSOR',
    role: 'FEATURE_PROCESSOR',
    nameFa: 'مغز ۲: پردازشگر ویژگی عمق اردر بوک و نقدینگی (OrderBook Liquidity Feature Processor)',
    whaleAggressionScore: Math.min(100, Math.round(Math.abs(obi) * 350 + 40)),
    obiValue: Math.round(obi * 1000) / 1000,
    trapDetected: trapInfo.isTrapDetected,
    trapDetails: trapInfo,
    liquidityPoolUsd,
    rationaleFa: trapInfo.isTrapDetected
      ? trapInfo.descriptionFa
      : `عدم تقارن دفتر سفارش (${(obi * 100).toFixed(1)}٪) دریافت شد؛ امتیاز و pool قیمتی heuristic هستند و حجم نقدینگی مستقل را اندازه‌گیری نمی‌کنند.`
  };

  // ۳. مغز ۳: مدل نوسان‌سنج پارامتری GARCH (Statistical Model - Item 9)
  const garchResult = realGarchEngine.fitAndForecast(analysis?.candles || [], analysis?.timeframe ?? '');
  const garchRegime: Brain3GarchVolatility['garchRegime'] = garchResult.regime;
  const adaptiveTrailingOffsetPct = garchRegime === 'SPIKE_TURBULENCE' ? 0.25 : 0.40;
  const stopLossBufferPct = garchRegime === 'COMPRESSION' ? 0.28 : 0.32;
  const brain3Volatility: Brain3GarchVolatility = {
    brainType: 'STATISTICAL_MODEL',
    role: 'STATISTICAL_MODEL',
    nameFa: 'مغز ۳: مدل نوسان‌سنج پارامتری GARCH(1,1)',
    garchRegime,
    volatilityForecastPct: garchResult.forecastVol15mPct,
    volatilityForecastHorizonMinutes: garchResult.forecastVol15mActualHorizonMinutes,
    adaptiveTrailingOffsetPct,
    stopLossBufferPct,
    calibratedProbabilityPct: null,
    oosForecastErrorPct: garchResult.oosRmse,
    rationaleFa: garchResult.status === 'AVAILABLE'
      ? garchResult.detailsFa
      : 'مدل GARCH: داده‌های سری زمانی کندل‌ها ناکافی است (UNAVAILABLE). هیچ عدد ساختگی تولید نشد.'
  };

  // ۴. مغز ۴: مدل انطباق الگوهای تاریخی (Statistical Pattern Model)
  const reversalAnalysis = predict30mTrendReversalPatternLayer(analysis?.candles || [], p, rawDirection === 'SHORT' ? 'BEARISH' : 'BULLISH', obi, volPct, rsi);
  const candleFeed = analysis?.dataQualityReport?.feeds.candles;
  const historicalResearchCandles = historicalCandleInput?.candles ?? analysis?.candles ?? [];
  const historicalRepeatAnalysis = analyzeWalkForwardCandlePatterns({
    candles: historicalResearchCandles,
    timeframe: analysis?.timeframe ?? '15m',
    dataStatus: historicalCandleInput?.dataStatus ?? analysis?.dataStatus ?? 'UNAVAILABLE',
    sourceTimestampMs: historicalCandleInput?.sourceTimestampMs ??
      candleFeed?.timestamp ?? Number.NaN,
    feeBpsPerSide: historicalCandleInput?.feeBpsPerSide,
    slippageBpsPerSide: historicalCandleInput?.slippageBpsPerSide,
  });
  const brain4Pattern: Brain4PatternDivergence = {
    brainType: 'STATISTICAL_MODEL',
    role: 'STATISTICAL_MODEL',
    nameFa: 'مغز ۴: سنجش شباهت الگو و بازده نمونه‌های تاریخی (Historical Pattern Research)',
    patternMatchPct: null,
    matchedPatternName: 'Current 30m reversal analysis; historical-repeat research is owned by central control',
    reversal30mProbabilityPct: reversalAnalysis.reversalProbability,
    expectedMove30mPct: reversalAnalysis.expectedMovePct30m,
    calibratedProbabilityPct: reversalAnalysis.reversalProbability !== null ? Math.round(reversalAnalysis.reversalProbability) : null,
    rationaleFa: reversalAnalysis.reversalProbability === null
      ? 'تحلیل بازگشت ۳۰ دقیقه‌ای فعلی کالیبره نشده و رأی مستقل یا مجوز معامله نیست.'
      : 'خروجی تحلیل بازگشت ۳۰ دقیقه‌ای است؛ جست‌وجوی تکرار تاریخی و تعیین افق نگهداری در گزارش مستقل کنترل مرکزی قرار دارد.'
  };

  // ۵. مغز ۵: کنترل‌کننده ریسک پویای پوزیشن (Risk Controller - Item 5)
  const feeBufferPct = 0.05;
  const breakevenTriggerPrice = rawDirection === 'SHORT'
    ? Math.round((p * (1 - (0.0025 + feeBufferPct / 100))) * 100) / 100
    : Math.round((p * (1 + (0.0025 + feeBufferPct / 100))) * 100) / 100;

  const brain5RiskHedging: Brain5FloatingRiskHedging = {
    brainType: 'RISK_CONTROLLER',
    role: 'RISK_CONTROLLER',
    nameFa: 'مغز ۵: سیستم مدیریت ریسک و استاپ پویای پوزیشن (Dynamic Risk Protection Brain)',
    riskBreakevenTriggerPrice: breakevenTriggerPrice,
    feeBufferPct,
    hedgingAllocationRatio: 0.25,
    floatingSystemHarmonized: null,
    rationaleFa: 'هماهنگی پوزیشن/هج و پوشش واقعی کارمزد از فریکترید دریافت نمی‌شود؛ نسبت و trigger صرفاً پارامترهای نمایشی‌اند.'
  };

  // ۶. مغز ۶: پردازشگر ویژگی آن‌چین (Feature Processor)
  const macroCtx = macroContextBrainService.getMacroContext(p);
  const isWhaleLive = macroCtx.whaleFlowStatus === 'LIVE' &&
    typeof macroCtx.whaleNetflowBtc === 'number' &&
    Number.isFinite(macroCtx.whaleNetflowBtc);
  const netflowBtc24h = isWhaleLive ? macroCtx.whaleNetflowBtc : null;
  const whaleSentiment = isWhaleLive ? (macroCtx.whaleSentiment || 'NEUTRAL') : 'UNKNOWN';
  const onChainRaw = isWhaleLive && netflowBtc24h !== null
    ? (netflowBtc24h < 0 ? 80 : 40)
    : null;

  const brain6OnChainWhale: Brain6OnChainWhaleFlow = {
    brainType: 'FEATURE_PROCESSOR',
    role: 'FEATURE_PROCESSOR',
    nameFa: 'مغز ۶: پردازشگر ویژگی جریان آن‌چین (On-Chain Flow Feature Processor)',
    netflowBtc24h,
    exchangeReserveStatusFa: isWhaleLive
      ? (netflowBtc24h < 0 ? 'خروج خالص از صرافی‌ها (انباشت نهنگ)' : 'ورود بیت‌کوین به صرافی‌ها (فشار فروش)')
      : 'داده آن‌چین: UNAVAILABLE (قطع منبع زنده)',
    whaleSentiment,
    whalePressureIndex: isWhaleLive ? macroCtx.whalePressureIndex : null,
    rawEvidenceScore: onChainRaw,
    onChainScorePct: onChainRaw,
    rationaleFa: isWhaleLive
      ? `خلاصهٔ جریان نهنگ از منبع خبری/جست‌وجویی grounded دریافت شد (${netflowBtc24h} BTC)؛ این فید مستقیم تراکنش آن‌چین نیست و امتیاز جهت‌گیری heuristic است.`
      : 'وضعیت جریان نهنگ: UNAVAILABLE. فید مستقیم تراکنش آن‌چین متصل نیست.'
  };

  // ۷. مغز ۷: پردازشگر ویژگی CVD (Feature Processor)
  // توجه: امتیازهای محاسباتی فرمولی، لزوماً معیارهای واقعی عملکرد نیستند.
  // در صورتی که جریان زنده تریدها موجود باشد از آن استفاده می‌شود؛ در غیر اینصورت تفکیک شفاف اعمال می‌گردد.
  const liveTradeFlow = analysis?.orderFlowFeatures?.isRealTradeFlow === true &&
    analysis?.orderFlowFeatures?.status === 'LIVE' &&
    typeof analysis?.orderFlowFeatures?.cvdDeltaUsd === 'number' &&
    Number.isFinite(analysis.orderFlowFeatures.cvdDeltaUsd);
  
  const measuredCvdDelta = liveTradeFlow ? analysis.orderFlowFeatures.cvdDeltaUsd : (typeof analysis?.cvdDelta === 'number' ? analysis.cvdDelta : null);
  const isCvdEmpirical = liveTradeFlow && measuredCvdDelta !== null;
  const cvdDeltaScore = isCvdEmpirical
    ? Math.min(100, Math.max(20, Math.round(50 + (measuredCvdDelta > 0 ? 25 : -25) + obi * 80)))
    : null;

  const brain7OrderBookCvd: Brain7OrderBookCvd = {
    brainType: 'FEATURE_PROCESSOR',
    role: 'FEATURE_PROCESSOR',
    nameFa: 'مغز ۷: پردازشگر ویژگی دلتای سفارشات CVD (CVD Delta Feature Processor)',
    cvdDeltaScore,
    bidAskRatio: Math.round((1.2 + obi * 0.5) * 100) / 100,
    subSecondOrderImbalancePct: Math.round((obi * 100) * 10) / 10,
    isEmpiricalMetric: isCvdEmpirical,
    isLiveMeasured: isCvdEmpirical,
    realCvdDeltaBtc: isCvdEmpirical ? measuredCvdDelta : null,
    rationaleFa: isCvdEmpirical
      ? `شواهد تجربی CVD: دلتای واقعی معاملات (${measuredCvdDelta > 0 ? '+' : ''}${measuredCvdDelta}) ثبت شد.`
      : `تقریب محاسباتی CVD: فید جریان ترید زنده متصل نیست. امتیاز بر پایه عدم تقارن دفتر سفارشات (${(obi * 100).toFixed(1)}٪) تقریب زده شده و ادعای اندازه‌گیری تجربی ندارد.`
  };

  // ۸. مغز ۸: پردازشگر شاخص‌های کلان (Feature Processor)
  const isNewsLive = macroCtx.newsSentimentStatus === 'LIVE' && macroCtx.newsSentimentScore !== null;
  const newsScore = isNewsLive ? macroCtx.newsSentimentScore : null;
  const brain8FundamentalMacro: Brain8FundamentalMacro = {
    brainType: 'FEATURE_PROCESSOR',
    role: 'FEATURE_PROCESSOR',
    nameFa: 'مغز ۸: پردازشگر ویژگی رویدادهای فاندامنتال (Fundamental & News Feature Processor)',
    newsOscillatorScore: newsScore,
    macroImpactLevel: isNewsLive ? (Math.abs(newsScore) >= 60 ? 'HIGH' : 'MEDIUM') : 'UNAVAILABLE',
    blackoutCaution: isNewsLive
      ? macroCtx.breakingNewsImpactLevel === 'SEVERE_BEARISH_THREAT'
      : null,
    rationaleFa: isNewsLive
      ? `ارزیابی زنده شاخص اخبار: امتیاز سنتیمنت ${newsScore > 0 ? '+' : ''}${newsScore}.`
      : 'داده‌های اخبار و فاندامنتال: UNAVAILABLE. داده جعلی اعمال نمی‌شود.'
  };

  // ۹. مغز ۹: مدل شبکه احتمالات بیزی (Statistical Bayesian Model - Item 10)
  const bayesResult = realBayesianEngine.inferPosterior({
    setupType,
    marketRegime,
    timeframe,
    direction: rawDirection,
    obi,
    candles,
    volatilityPct: volPct,
    rsi
  });
  const brain9BayesianProbabilistic: Brain9BayesianProbabilistic = {
    brainType: 'STATISTICAL_MODEL',
    role: 'STATISTICAL_MODEL',
    nameFa: 'مغز ۹: مدل شبکه‌ای احتمالات بیزی (Bayesian Probabilistic Model)',
    priorProbabilityPct: Math.round(bayesResult.priorProbability * 100),
    posteriorProbabilityPct: bayesResult.posteriorProbability !== null ? Math.round(bayesResult.posteriorProbability * 100) : null,
    confidenceIntervalWidthPct: bayesResult.credibleInterval95 !== null ? Math.round((bayesResult.credibleInterval95.upper - bayesResult.credibleInterval95.lower) * 100) : null,
    calibratedProbabilityPct: bayesResult.status === 'CALIBRATED' ? (bayesResult.posteriorProbability !== null ? Math.round(bayesResult.posteriorProbability * 100) : null) : null,
    priorSource: bayesResult.priorSource,
    rationaleFa: bayesResult.detailsFa
  };

  // ۱۰. مغز ۱۰: پردازشگر خروج و تریلینگ (Execution Controller - Item 5)
  const brain10AutoPilotHarmonizer: Brain10AutoPilotHarmonizer = {
    brainType: 'EXECUTION_CONTROLLER',
    role: 'EXECUTION_CONTROLLER',
    nameFa: 'مغز ۱۰: پردازشگر هماهنگ‌ساز خروج و تریلینگ (Trailing Execution Processor)',
    autoPilotActive: false,
    trailingExpansionRatio: 1.25,
    riskProtectionEscapeSpeedMs: null,
    feeBufferCovered: null,
    rationaleFa: 'این مغز سفارش را اجرا نمی‌کند؛ زمان تاخیر و پوشش کارمزد در این مسیر اندازه‌گیری نشده است.'
  };

  // ۱۱. مغز ۱۱: پردازشگر ویژگی تراکنش‌های بزرگ (Feature Processor)
  const largeTransactionsCount24h = null;
  const largeTransactionsVolumeUsd = null;
  let whaleSentimentBias: Brain11OnChainWhaleSentiment['whaleSentimentBias'] = isWhaleLive ? 'NEUTRAL' : 'UNKNOWN';
  if (isWhaleLive) {
    if (volPct > 2.0 && Math.abs(obi) > 0.15) {
      whaleSentimentBias = 'MANIPULATION_ALERT';
    } else if (obi > 0.08) {
      whaleSentimentBias = 'ACCUMULATION';
    } else if (obi < -0.08) {
      whaleSentimentBias = 'DISTRIBUTION';
    }
  }

  const manipulationRiskPct = isWhaleLive
    ? (volPct > 2.0 ? Math.min(95, Math.round(30 + volPct * 20 + Math.abs(obi) * 50)) : Math.min(45, Math.round(15 + Math.abs(obi) * 80)))
    : null;

  const brain11OnChainWhaleSentiment: Brain11OnChainWhaleSentiment = {
    brainType: 'FEATURE_PROCESSOR',
    role: 'FEATURE_PROCESSOR',
    nameFa: 'مغز ۱۱: پردازشگر ردیابی تراکنش‌های بزرگ نهنگ‌ها (Whale Transactions Processor)',
    largeTransactionsCount24h,
    largeTransactionsVolumeUsd,
    whaleSentimentBias,
    manipulationRiskPct,
    whaleActivityPressureScore: null,
    rationaleFa: isWhaleLive
      ? `تعداد و حجم معاملات نهنگ در منبع داده نیست. برچسب ${whaleSentimentBias} فقط heuristic مبتنی بر OBI/نوسان است و اندازه‌گیری آن‌چین نیست.`
      : 'تعداد، حجم و جریان تراکنش نهنگ: UNAVAILABLE؛ منبع معاملات آن‌چین متصل نیست.'
  };

  // ۱۲. مغز ۱۲: پردازشگر اسپرد و تاخیر شبکه (Execution Controller - Item 5)
  // توجه: امتیازهای محاسباتی فرمولی، لزوماً معیارهای واقعی عملکرد نیستند.
  const exchangeLatencyMs = analysis?.canonicalSnapshot?.crossExchangeLatencyMs ??
    analysis?.realObiData?.latencyMs ?? null;
  const spreadBtcUsd = typeof analysis?.canonicalSnapshot?.crossExchangeSpreadUsd === 'number'
    ? Math.round(analysis.canonicalSnapshot.crossExchangeSpreadUsd * 100) / 100
    : (typeof analysis?.realObiData?.spreadUsd === 'number'
      ? Math.round(analysis.realObiData.spreadUsd * 100) / 100
      : null);
  const hasLiveExecutionMetrics = exchangeLatencyMs !== null && exchangeLatencyMs > 0 && spreadBtcUsd !== null;
  const executionScore = hasLiveExecutionMetrics
    ? Math.max(0, Math.min(95, Math.round(90 - (exchangeLatencyMs * 0.4) - (spreadBtcUsd * 5))))
    : null;

  const brain12ExecutionSniper: Brain12RealWorldExecutionSniper = {
    brainType: 'EXECUTION_CONTROLLER',
    role: 'EXECUTION_CONTROLLER',
    nameFa: 'مغز ۱۲: پردازشگر سنجش اسپرد و تاخیر صرافی (Execution Metrics Processor)',
    exchangeLatencyMs,
    slippageTolerancePct: 0.02,
    makerTakerOptimized: null,
    spreadBtcUsd,
    realWorldExecutionScore: executionScore,
    isEmpiricalMetric: false, // مدل محاسباتی شرایط بازار، نه تضمین تجربی کیفیت اجرای سفارش بروکر
    isLiveMeasured: hasLiveExecutionMetrics,
    rationaleFa: hasLiveExecutionMetrics
      ? `تاخیر ${exchangeLatencyMs}ms و اسپرد $${spreadBtcUsd} از دادهٔ موجود استخراج شد؛ امتیاز ${executionScore}/100 تضمین کیفیت اجرای سفارش نیست.`
      : 'تاخیر و اسپرد معتبر موجود نیست؛ سنجه‌ها و امتیاز اجرای واقعی UNAVAILABLE هستند.'
  };

  // ۱۳. مغز ۱۳: کنترل‌کننده قوانین حد سود (Risk Controller - Item 5)
  const isHighMomentum = Math.abs(obi) > 0.12 && volPct > 1.2;
  const brain13MaxProfit: Brain13AsymmetricProfitRunner = {
    brainType: 'RISK_CONTROLLER',
    role: 'RISK_CONTROLLER',
    nameFa: 'مغز ۱۳: پردازشگر قوانین حد سود متغیر (Asymmetric Profit Target Processor)',
    trailingExpansionRatio: isHighMomentum ? 1.6 : 1.2,
    peakProfitTargetPct: isHighMomentum ? 4.8 : 2.5,
    profitHarvestMode: isHighMomentum ? 'EXPONENTIAL_SURGE' : 'WAVE_RUNNER',
    asymmetricGainMultiplier: 3.2,
    rationaleFa: `تنظیم گام‌های حد سود متغیر در مود [${isHighMomentum ? 'EXPONENTIAL_SURGE' : 'WAVE_RUNNER'}].`
  };

  // ۱۴. مغز ۱۴: کنترل‌کننده خروج بی‌زیان در نوسان (Risk Controller - Item 5)
  const brain14LossToBreakeven: Brain14LossToBreakevenEscaper = {
    brainType: 'RISK_CONTROLLER',
    role: 'RISK_CONTROLLER',
    nameFa: 'مغز ۱۴: پردازشگر خروج بی‌زیان در نوسان مخالف (Loss Mitigation Processor)',
    escapeSpeedMs: null,
    activeLossEvacuationProtocol: null,
    breakevenOffsetBufferUsd: null,
    rawEvidenceScore: null,
    rationaleFa: 'سرعت، فعال‌بودن پروتکل و بافر سربه‌سر از lifecycle واقعی فریکترید در این گزارش اندازه‌گیری نمی‌شوند.'
  };

  // ۱۵. مغز ۱۵: پایشگر غیرفعال فرکانس معامله (Execution Controller - Item 5)
  const brain15FrequencyPreserver: Brain15TradeFrequencyPreserver = {
    brainType: 'EXECUTION_CONTROLLER',
    role: 'EXECUTION_CONTROLLER',
    nameFa: 'مغز ۱۵: پایشگر آماری فرکانس معاملات (Passive Trade Frequency Monitor)',
    dailyOpportunitiesTarget: 0,
    detectedMicroOpportunities: null,
    frequencyPreserved: null,
    microChopScalpActive: false,
    isPassiveMonitorOnly: true,
    rationaleFa: 'پایشگر کاملاً منفعل: هیچگونه دخل و تصرفی در تصمیم ورود ندارد. اگر لبه آماری وجود نداشته باشد، نتیجه NO TRADE خواهد بود.'
  };

  // ۱۶. مغز ۱۶: کنترل‌کننده فیلتر محافظت در برابر ضرر (Risk Controller - Item 5)
  const brain16DrawdownLockout: Brain16DrawdownLockoutGuardian = {
    brainType: 'RISK_CONTROLLER',
    role: 'RISK_CONTROLLER',
    nameFa: 'مغز ۱۶: پردازشگر فیلتر قفل معاملات جدید در زمان وجود ضرر (Drawdown Freeze Guardian)',
    activeLockState: null,
    lockedPositionsCount: null,
    divertedComputingPowerToRecoveryPct: null,
    isNewTradeBlocked: null,
    rationaleFa: 'وضعیت drawdown و تعداد position باید از فریکترید/ریسک‌سرویس بیاید؛ در این گزارش به‌عنوان UNAVAILABLE باقی می‌ماند.'
  };

  // ۱۷. مغز ۱۷: کنترل‌کننده قوانین پولبک (Risk Controller - Item 5)
  const brain17RapidTurnaround: Brain17RapidLossTurnaround = {
    brainType: 'RISK_CONTROLLER',
    role: 'RISK_CONTROLLER',
    nameFa: 'مغز ۱۷: پردازشگر قوانین پولبک برای بازگردانی پوزیشن (Micro Pivot Processor)',
    microPivotPrice: Math.round((p * 0.9985) * 10) / 10,
    recoveryDistancePct: 0.15,
    targetBreakevenSpeedSec: 180,
    turnaroundActive: false,
    rationaleFa: 'نقطه عطف یک مقدار مشتق‌شده است؛ هیچ گردش/هج معکوسی در این مغز اجرا نمی‌شود.'
  };

  // ۱۸. مغز ۱۸: کنترل‌کننده تایمر فرسایش زمان (Risk Controller - Item 5)
  const brain18StagnantLiquidator: Brain18StagnantTimeDecayLiquidator = {
    brainType: 'RISK_CONTROLLER',
    role: 'RISK_CONTROLLER',
    nameFa: 'مغز ۱۸: پردازشگر فرسایش زمانی پوزیشن‌های رکودی (Time Decay Liquidator)',
    maxTradeDurationMinutes: 180,
    breakevenLiquidateTriggered: false,
    capitalLiberatedPct: null,
    stagnationEvacuationActive: false,
    rationaleFa: 'مدت پوزیشن و خروج زمان‌محور در این گزارش به چرخه واقعی Freqtrade وصل نیست.'
  };

  // ۱۹. مغز ۱۹: کنترل‌کننده تخصیص بار پردازشی (Execution Controller - Item 5)
  const brain19LoadReallocator: Brain19LoadReallocator = {
    brainType: 'EXECUTION_CONTROLLER',
    role: 'EXECUTION_CONTROLLER',
    nameFa: 'مغز ۱۹: پردازشگر تخصیص بار پردازشی (Load Reallocator)',
    underperformingBrainsPrunedCount: null,
    reallocatedCapacityPct: null,
    pruningActive: null,
    rationaleFa: 'هیچ pruning یا تخصیص ظرفیت زنده instrument نشده است؛ مقادیر UNAVAILABLE هستند.'
  };

  // ۲۰. مغز ۲۰: کنترل‌کننده BBO (Execution Controller - Item 5)
  const brain20LatencyArbitrage: Brain20LatencyArbitrage = {
    brainType: 'EXECUTION_CONTROLLER',
    role: 'EXECUTION_CONTROLLER',
    nameFa: 'مغز ۲۰: پردازشگر سنجش اسپرد BBO (BBO Spread Monitor)',
    bboSpreadCaptureUsd: null,
    subSecondExecutionMs: null,
    arbitrageShieldActive: null,
    rationaleFa: 'BBO capture، زمان اجرای زیرثانیه و shield در این سامانه اندازه‌گیری/اجرا نشده‌اند.'
  };

  // ۲۱. مغز ۲۱: کنترل‌کننده مدیریت هجینگ معکوس (Risk Controller - Item 5)
  const brain21StrategicRecovery: Brain21StrategicRecovery = {
    brainType: 'RISK_CONTROLLER',
    role: 'RISK_CONTROLLER',
    nameFa: 'مغز ۲۱: پردازشگر مدیریت هجینگ معکوس (Strategic Recovery Guard)',
    globalFreezeActive: null,
    microAtrUsd: Math.round(p * 0.0012 * 100) / 100,
    exactCounterVolumeUsd: null,
    targetBreakevenSeconds: null,
    recoveryStatusFa: 'وضعیت بازیابی واقعی متصل نیست (UNAVAILABLE).',
    rationaleFa: 'فقط ATR مشتق‌شده از قیمت گزارش می‌شود؛ حجم counter و اجرای بازیابی به منبع/مسیر سفارش معتبر متصل نیست.'
  };

  // =========================================================================
  // ساخت مدل‌های آماری مستقل (INDEPENDENT STATISTICAL MODELS - Item 5, 7, 9 & 10)
  // sampleSize and calibration calculated from REAL dataset!
  // =========================================================================
  const datasetPredictions = datasetService.getFreqtradeVerifiedPredictions();
  const realResolvedSample = datasetPredictions.filter(rec => rec.outcome === 'WIN' || rec.outcome === 'LOSS').length;

  const masterDir: 'LONG' | 'SHORT' = rawDirection === 'SHORT' ? 'SHORT' : 'LONG';
  const centralCalib = computeCentralCalibratedProbability({
    trendBias: rawDirection === 'SHORT' ? 'BEARISH' : rawDirection === 'LONG' ? 'BULLISH' : 'NEUTRAL',
    scoreLong: analysis?.scoreLong ?? 0,
    scoreShort: analysis?.scoreShort ?? 0,
    obi,
    hurst,
    volatilityPct: volPct,
    adx: analysis?.adx ?? 0,
    rsi,
    price: p,
    ema20: analysis?.ema20Val,
    ema50: analysis?.ema50Val,
    ema200: analysis?.ema200Val,
    setupType: 'VWAP_MSS_CONTINUATION',
    marketRegime: garchRegime,
    candles: analysis?.candles || []
  });

  const model1CalibrationState = evaluateModelHealthState(
    centralCalib.isCalibrationVerified,
    centralCalib.calibratedWinProbability !== null,
    centralCalib.sampleSize,
    centralCalib.outOfSamplePrecision === null ? null : centralCalib.outOfSamplePrecision * 100
  );
  const model2CalibrationState = evaluateModelHealthState(
    bayesResult.status === 'CALIBRATED',
    bayesResult.posteriorProbability !== null,
    bayesResult.sampleSize,
    bayesResult.status === 'CALIBRATED' ? bayesResult.calibrationMetrics.oosAccuracyPct : null
  );
  const model1HealthState = model1CalibrationState === 'SUSPENDED' ? 'SUSPENDED' : 'UNVALIDATED';
  const model2HealthState = model2CalibrationState === 'SUSPENDED' ? 'SUSPENDED' : 'UNVALIDATED';
  const model1Central: IndependentModelPrediction = {
    modelId: 'M1_CENTRAL_CALIBRATED',
    nameFa: 'مدل کالیبره‌شده آماری مرکزی (Platt Scaling Engine)',
    prediction: centralCalib.rawProbability === null
      ? 'NEUTRAL'
      : masterDir === 'SHORT' ? 'BEARISH' : 'BULLISH',
    rawProbabilityPct: centralCalib.isCalibrationVerified && centralCalib.calibratedWinProbability !== null
      ? Math.round(centralCalib.calibratedWinProbability * 1000) / 10
      : null,
    historicalPrecisionPct: centralCalib.isCalibrationVerified && centralCalib.outOfSamplePrecision !== null
      ? Math.round(centralCalib.outOfSamplePrecision * 100)
      : null,
    sampleSize: centralCalib.sampleSize,
    calibrationFactor: centralCalib.isCalibrationVerified ? 1.0 : 0.0,
    regimePerformancePct: null,
    healthState: model1HealthState,
    independenceValidated: false,
    correlationWithOtherModels: null,
    effectiveWeight: 0,
  };

  const model2Bayesian: IndependentModelPrediction = {
    modelId: 'M2_BAYESIAN_MICRO',
    nameFa: 'مدل احتمالات استنتاج بیزی (Real Bayesian Posterior Model)',
    prediction: (bayesResult.posteriorProbability ?? 0) >= 0.52
      ? (rawDirection === 'SHORT' ? 'BEARISH' : 'BULLISH')
      : 'NEUTRAL',
    rawProbabilityPct: bayesResult.status === 'CALIBRATED' && bayesResult.posteriorProbability !== null
      ? Math.round(bayesResult.posteriorProbability * 100)
      : null,
    historicalPrecisionPct: bayesResult.status === 'CALIBRATED' ? bayesResult.calibrationMetrics.oosAccuracyPct : null,
    sampleSize: bayesResult.sampleSize,
    calibrationFactor: bayesResult.status === 'CALIBRATED' ? 1.0 : 0.0,
    regimePerformancePct: null,
    healthState: model2HealthState,
    independenceValidated: false,
    correlationWithOtherModels: null,
    effectiveWeight: 0,
  };

  const model3Pattern: IndependentModelPrediction = {
    modelId: 'M3_PATTERN_SIMILARITY',
    nameFa: 'مدل شباهت تاریخی الگوها (Pattern Divergence Similarity)',
    prediction: (reversalAnalysis.reversalProbability ?? 0) >= 65
      ? (masterDir === 'LONG' ? 'BEARISH' : 'BULLISH')
      : (masterDir === 'SHORT' ? 'BEARISH' : 'BULLISH'),
    rawProbabilityPct: null,
    historicalPrecisionPct: null,
    sampleSize: reversalAnalysis.reversalProbability !== null ? realResolvedSample : 0,
    calibrationFactor: 0,
    regimePerformancePct: null,
    healthState: 'SUSPENDED',
    independenceValidated: false,
    correlationWithOtherModels: null,
    effectiveWeight: 0,
  };

  const model4Garch: IndependentModelPrediction = {
    modelId: 'M4_GARCH_REGIME',
    nameFa: 'مدل نوسان‌سنج پارامتری GARCH(1,1) (Real Parametric Volatility)',
    prediction: 'NEUTRAL',
    rawProbabilityPct: null,
    historicalPrecisionPct: null,
    sampleSize: garchResult.sampleSize,
    calibrationFactor: garchResult.status === 'AVAILABLE' ? 1.0 : 0.0,
    regimePerformancePct: null,
    healthState: 'SUSPENDED',
    independenceValidated: false,
    correlationWithOtherModels: null,
    effectiveWeight: 0,
  };

  const independentModels = [model1Central, model2Bayesian, model3Pattern, model4Garch];
  const activeModels = independentModels.filter(model =>
    model.effectiveWeight > 0 &&
    model.independenceValidated &&
    model.calibrationFactor > 0 &&
    model.healthState === 'HEALTHY' &&
    model.rawProbabilityPct !== null &&
    model.historicalPrecisionPct !== null
  );
  const modelDisagreement = metaModelEnsembleEngine.evaluateModelDisagreement(activeModels.map(model => ({
    modelId: model.modelId,
    nameFa: model.nameFa,
    direction: model.prediction === 'BULLISH' ? 'LONG' : model.prediction === 'BEARISH' ? 'SHORT' : 'NEUTRAL',
    confidencePct: model.rawProbabilityPct,
    effectiveWeightPct: model.correlationWithOtherModels === null
      ? 0
      : model.effectiveWeight * (1 - model.correlationWithOtherModels * 0.5) * model.calibrationFactor * 100,
  })));
  const consensusScorePct = activeModels.length >= 2 && !modelDisagreement.vetoTriggered
    ? 100 - modelDisagreement.disagreementIndex
    : 0;

  let confidenceGrade: MultiBrainConsensusReport['confidenceGrade'] = 'BLOCKED_RISK';
  if (activeModels.length >= 2 && modelDisagreement.vetoTriggered) {
    confidenceGrade = 'BLOCKED_RISK';
  } else if (activeModels.length >= 2 && consensusScorePct >= 72 && !trapInfo.isTrapDetected) {
    confidenceGrade = 'DIAMOND_S_TIER';
  } else if (activeModels.length >= 2 && (garchRegime === 'SPIKE_TURBULENCE' || trapInfo.isTrapDetected)) {
    confidenceGrade = 'TACTICAL_SCALP';
  } else if (activeModels.length >= 2) {
    confidenceGrade = 'GOLD_ALPHA';
  }

  const coordinatorReport = brainPriorityCoordinator.getCoordinatorReport(p);

  const pipelineArchitecture: PipelineArchitectureReport = {
    rawDataFeedsCount: 5,
    featureProcessorsCount: 17,
    statisticalModelsCount: activeModels.length,
    calibrationMethod: 'TIME_ORDERED_OOS_AND_DIRECTIONAL_DISAGREEMENT',
    pipelineFlowFa: 'FEATURES → VALIDATED MODEL ELIGIBILITY → DIRECTIONAL DISAGREEMENT RISK → WAIT ON VETO'
  };

  const proposalsListFa: MultiBrainConsensusReport['proposalsListFa'] = [
    {
      id: 'prop_independent_models_consensus',
      category: 'PREDICTION_ACCURACY',
      titleFa: '۱. اجماع مدل‌های مستقل (اعتبارسنجی استقلال انجام نشده)',
      status: 'BLOCKED_UNVALIDATED',
      descriptionFa: 'همبستگی خطای خارج‌ازنمونه اندازه‌گیری نشده است؛ خروجی مدل‌ها رأی مستقل محسوب نمی‌شود و وزن مؤثرشان صفر است. ورود تا اعتبارسنجی مستقل مدل‌ها مسدود می‌ماند.',
      impactFa: 'این وضعیت عمداً fail-closed است؛ هیچ آمادگی سفارش یا کیفیت پیش‌بینی را اثبات نمی‌کند.'
    },
    {
      id: 'prop_transparent_pipeline',
      category: 'SCENARIO_READINESS',
      titleFa: '۲. شفاف‌سازی لایه‌های پردازشی (RAW DATA → FEATURE → MODEL → CALIBRATION)',
      status: 'READY_FOR_DEPLOYMENT',
      descriptionFa: 'تفکیک ۱۷ پردازشگر ویژگی از ۴ پیاده‌سازی کاندید مدل آماری؛ در حال حاضر هیچ‌کدام به دلیل استقلال/کالیبراسیون اثبات‌نشده رأی مؤثر ندارند.',
      impactFa: 'تعداد پیاده‌سازی‌ها به‌معنای استقلال داده، اعتبارسنجی یا آمادگی زنده نیست.'
    },
    {
      id: 'prop_risk_protection_guard',
      category: 'FLOATING_HARMONY',
      titleFa: '۳. سیستم محافظت پویا از اصل سرمایه (Dynamic Risk Protection Guard)',
      status: 'READY_FOR_DEPLOYMENT',
      descriptionFa: 'تنظیم تریلینگ استاپ روی نقطه ورود + بافر کارمزد صرافی به محض تثبیت حرکت مثبت، بدون ادعای غیرواقعی تضمین عدم زیان.',
      impactFa: 'کنترل دقیق و واقع‌گرایانه ریسک معامله.'
    },
    {
      id: 'prop_frequency_passive_monitor',
      category: 'REAL_WORLD_EXECUTION',
      titleFa: '۴. خروج پایشگر فرکانس معامله از چرخه تصمیم‌گیری ورود (Passive Frequency Monitor)',
      status: 'READY_FOR_DEPLOYMENT',
      descriptionFa: 'غیرفعال‌سازی اثرگذاری فرکانس بر تصمیم ورود؛ اگر در یک روز هیچ معامله‌ای با edge معتبر وجود نداشته باشد، خروجی NO TRADE خواهد بود.',
      impactFa: 'جلوگیری از ورود‌های اجباری و حفظ سرمایه در شرایط بدون برتری آماری.'
    }
  ];

  const report: MultiBrainConsensusReport = {
    timestamp: new Date().toLocaleTimeString('fa-IR'),
    timestampMs: Date.now(),
    sourceTimestampMs: analysis?.canonicalSnapshot?.timestampUtc ?? analysis?.realObiData?.timestamp ?? null,
    currentPrice: p,
    masterDirection: modelDisagreement.vetoTriggered ? 'HOLD' : masterDir,
    consensusScorePct,
    confidenceGrade,
    winProbabilityPct: !modelDisagreement.vetoTriggered && centralCalib.isCalibrationVerified && centralCalib.calibratedWinProbability !== null
      ? Math.round(centralCalib.calibratedWinProbability * 1000) / 10
      : null,
    riskProtectionActive: true,
    tradeFrequencyMonitoringOnly: true,
    drawdownLockoutActive: true,
    
    dynamicWeights: {
      brain1MacroWeight: 0.1,
      brain2LiquidityWeight: 0.1,
      brain3VolatilityWeight: 0.1,
      brain4PatternWeight: 0.1,
      brain5RiskHedgingWeight: 0.1,
      brain6OnChainWeight: isWhaleLive ? 0.1 : 0.0,
      brain7CvdWeight: isCvdEmpirical ? 0.1 : 0.0,
      brain8MacroNewsWeight: isNewsLive ? 0.1 : 0.0,
      brain9BayesianWeight: 0.1,
      brain10AutoPilotWeight: 0.0,
      brain11WhaleSentimentWeight: 0.0,
      brain12ExecutionSniperWeight: hasLiveExecutionMetrics ? 0.1 : 0.0,
    },
    pipelineArchitecture,
    independentModels,
    modelDisagreement,
    
    brain1Macro,
    brain2Liquidity,
    brain3Volatility,
    brain4Pattern,
    historicalCandleResearch: historicalRepeatAnalysis,
    brain5RiskHedging,
    brain6OnChainWhale,
    brain7OrderBookCvd,
    brain8FundamentalMacro,
    brain9BayesianProbabilistic,
    brain10AutoPilotHarmonizer,
    brain11OnChainWhaleSentiment,
    brain12ExecutionSniper,
    brain13MaxProfit,
    brain14LossToBreakeven,
    brain15FrequencyPreserver,
    brain16DrawdownLockout,
    brain17RapidTurnaround,
    brain18StagnantLiquidator,
    brain19LoadReallocator,
    brain20LatencyArbitrage,
    brain21StrategicRecovery,

    coordinatorReport,
    proposalsListFa,
    learningFeedbackStatusFa: `🧠 ${activeModels.length} مدل دارای اعتبارسنجی OOS فعال است؛ اختلاف ${modelDisagreement.disagreementIndex}٪، ضریب اجماع ${consensusScorePct}٪ | ${pipelineArchitecture.pipelineFlowFa}`
  };
  latestMultiBrainReport = report;
  return report;
}
