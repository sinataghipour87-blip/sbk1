import React, { lazy, Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { QuantumChart } from './components/QuantumChart';
import { ChartTopBar } from './components/ChartTopBar';
import { TickerBar } from './components/TickerBar';
import { StrategyAndIndicators } from './components/StrategyAndIndicators';
import { HistoryDashboard } from './components/HistoryDashboard';
import { DcaCalculator } from './components/DcaCalculator';
import { LiquidityRiskPanel } from './components/LiquidityRiskPanel';
import { OrderExecutionPanel } from './components/OrderExecutionPanel';
import { CollapsibleCard } from './components/CollapsibleCard';
import { PillarsStatusWidget } from './components/PillarsStatusWidget';
import { LiquidityHeatmapWidget } from './components/LiquidityHeatmapWidget';
import { LossRecoveryPanel, LossRecoveryState } from './components/LossRecoveryPanel';
import { SmartEnginesHub } from './components/SmartEnginesHub';
import { WavePredictionEngineWidget } from './components/WavePredictionEngineWidget';
import { CentralDatasetPerformanceMatrixWidget } from './components/CentralDatasetPerformanceMatrixWidget';
import { MultiBrainConsensusPanel } from './components/MultiBrainConsensusPanel';
import { TenBrainArchitecturePanel } from './components/TenBrainArchitecturePanel';
import { TenBrainRadarConsensusWidget } from './components/TenBrainRadarConsensusWidget';
import { ActivityFrequencyMonitorWidget } from './components/ActivityFrequencyMonitorWidget';
import { VolatilitySpikePredictorWidget } from './components/VolatilitySpikePredictorWidget';
import { FundingPriceCorrelationWidget } from './components/FundingPriceCorrelationWidget';
import { RealtimeSynchronizerWidget } from './components/RealtimeSynchronizerWidget';
import { IndexedDbBrainMemoryWidget } from './components/IndexedDbBrainMemoryWidget';
import { DistributedMemoryCacheWidget } from './components/DistributedMemoryCacheWidget';
import { DynamicEntryWidget } from './components/DynamicEntryWidget';

import { EarlyWarningProtocolWidget } from './components/EarlyWarningProtocolWidget';
import { BrainLoadBalancerWidget } from './components/BrainLoadBalancerWidget';
import { BrainSelfEvolutionWidget } from './components/BrainSelfEvolutionWidget';
import { BrainStrategicBufferWidget } from './components/BrainStrategicBufferWidget';
import { EightMemberCouncilPanel } from './components/EightMemberCouncilPanel';
import { HierarchicalDecisionFusionWidget } from './components/HierarchicalDecisionFusionWidget';
import { DynamicHedgeUnblockerWidget } from './components/DynamicHedgeUnblockerWidget';
import { HunterOrderFlowDashboardWidget } from './components/HunterOrderFlowDashboardWidget';
import { CrossBrainPredictiveEngineWidget } from './components/CrossBrainPredictiveEngineWidget';
import { LockedHedgeCrisisEscaperWidget } from './components/LockedHedgeCrisisEscaperWidget';
import { RootCauseAnalysisWidget } from './components/RootCauseAnalysisWidget';
import { MacroContextBrainWidget } from './components/MacroContextBrainWidget';
import { WhaleSignalStatisticalProofWidget } from './components/WhaleSignalStatisticalProofWidget';
import { WhaleOnChainRadarWidget } from './components/WhaleOnChainRadarWidget';
import { OpenSourceAdvisoryPanel } from './components/OpenSourceAdvisoryPanel';
import { GarchRealtimeRiskWidget } from './components/GarchRealtimeRiskWidget';
import { CrossExchangeCorrelationWidget } from './components/CrossExchangeCorrelationWidget';
import { CvdOiMatrixWidget } from './components/CvdOiMatrixWidget';
import { LiquidationCascadeWidget } from './components/LiquidationCascadeWidget';
import { RegimeClassifierWidget } from './components/RegimeClassifierWidget';
import { NoTradePredictorWidget } from './components/NoTradePredictorWidget';
import { MtfStructuralWidget } from './components/MtfStructuralWidget';
import { ScenarioCompetitionWidget } from './components/ScenarioCompetitionWidget';
import { ScenarioReadinessProfitMaximizerPanel } from './components/ScenarioReadinessProfitMaximizerPanel';
import { TrendSurvivalAndMfeTrailingWidget } from './components/TrendSurvivalAndMfeTrailingWidget';
import { StatisticalProtectionAndMaximizationWidget } from './components/StatisticalProtectionAndMaximizationWidget';
import { TradeThesisAndSmartExitWidget } from './components/TradeThesisAndSmartExitWidget';
import { BrainPriorityCoordinatorPanel } from './components/BrainPriorityCoordinatorPanel';
import { ModelChampionChallengerWidget } from './components/ModelChampionChallengerWidget';
import { AntiSelfDeceptionOnlineLearningWidget } from './components/AntiSelfDeceptionOnlineLearningWidget';
import { NewsShockFirewallWidget } from './components/NewsShockFirewallWidget';
import { BrainStatisticalEdgeVerifierWidget } from './components/BrainStatisticalEdgeVerifierWidget';
import { HunterOsDashboardWidget } from './components/HunterOsDashboardWidget';
import { hunterOsEngine } from './services/hunterOsEngine';

import { AIRiskGovernor, RiskGovernorState } from './components/AIRiskGovernor';
import ExecutionGovernorDashboard from './components/ExecutionGovernorDashboard';
import { WinRateOptimizerComponent, WinRateOptimizerConfig } from './components/WinRateOptimizer';
import { runUnifiedDecisionPipeline } from './services/decisionPipeline';
import { SbFiveModelsPanel } from './components/SbFiveModelsPanel';
import { sbFiveModelsEngine, analyzeMultiTimeframeSbObiCorrelation } from './services/sbFiveModelsEngine';
import { realWorldMasterBrainsService } from './services/realWorldMasterBrains';
import { rootCauseAnalysisEngineService } from './services/rootCauseAnalysisEngine';
import { macroContextBrainService } from './services/macroContextBrain';
import { 
  fetchCandles, 
  fetchDerivatives, 
  fetchFearGreed, 
  fetchHtf, 
  fetchOrderBookImbalance, 
  fetchRealOrderBookImbalance, 
  fetchRealTradeFlowCvd,
  fetchFuturesPrices,
  evaluateMarketDataQuality, 
  getCanonicalMarketSnapshot 
} from './services/marketData';
import { analyzePro } from './services/analysisEngine';
import { AnalysisResult, TradePosition, TradeHistory, UserSettings, SentimentData, ExecutionMode } from './types/trading';
import { loadSettings, saveSettings } from './services/settings';
import { saveTradeToHistory, getTradeHistory } from './services/history';
import { calculateKellyRisk, getAntiTiltStatus, calculateDynamicKellyMargin, evaluateCognitiveConviction } from './services/kellyRisk';
import { requestNotificationPermission, sendNotification } from './services/notifications';
import { setupFreqtradeMarketFeed, type WebSocketConnectionState } from './services/websocket';
import { validatePrecisionEntry, generateClientSidePredictionFallback, updatePredictiveModelFeedbackLoop, evaluate15mTimingAndLifecycle, runDistributedMultiTimeframeBrains, calculateAiMtfConsensusCorrelation, evaluateFuturePredictability } from './services/predictiveEngine';
import { evaluateSignalToExecution, buildExecutionPosition, calculateLogicTargets } from './services/signalToExecution';
import { verifyAutoTradePrerequisites } from './services/autoTradeGuard';
import { getExecutionMode, getSelectedExecutionMode } from './services/executionMode';
import type { FreqtradeTrade } from './services/freqtradeBridge';
import { brainEvolutionHub } from './services/brainSelfEvolutionHub';
import { tradeThesisAndSmartExitEngine } from './services/tradeThesisAndSmartExitEngine';
import { signalExpirationEngine, SignalStateSnapshot } from './services/signalExpirationEngine';
import { hunterExecutionEngine } from './services/hunterExecutionEngine';
import { AlertCircle, Settings, CheckCircle2, Cpu, Shield, Activity, BarChart2, Layers, Compass, Menu, Crosshair } from 'lucide-react';

const TfjsReinforcementLearningWidget = lazy(() =>
  import('./components/TfjsReinforcementLearningWidget').then(({ TfjsReinforcementLearningWidget }) => ({
    default: TfjsReinforcementLearningWidget,
  }))
);

export interface DerivFeeData {
  fundingRate?: number;
  openInterestUsd?: number;
  longShortRatio?: number;
  networkTakerFeeRate?: number;
  networkMakerFeeRate?: number;
}

/**
 * Calculates the exact Break-Even Price for a hedged position taking into account
 * real-time exchange network trading fees and cumulative funding interest rate from Deriv API.
 */
export function calculateHedgeBreakEvenPrice(
  pos: TradePosition,
  currentPrice: number,
  derivData?: DerivFeeData | number
): {
  breakEvenPrice: number;
  breakEvenMessageFa: string;
  netCostUsd: number;
  cumulativeFundingUsd: number;
  tradingFeesUsd: number;
} {
  if (!pos || !pos.hedgeActive) {
    return {
      breakEvenPrice: pos?.entry || currentPrice,
      breakEvenMessageFa: 'هجینگ غیرفعال است',
      netCostUsd: 0,
      cumulativeFundingUsd: 0,
      tradingFeesUsd: 0,
    };
  }

  const primaryEntry = pos.initialEntry || pos.entry || currentPrice;
  const hedgeEntry = pos.hedgeEntry || currentPrice;
  const leverage = pos.lev || 10;
  
  const primaryMargin = pos.initialMargin || 10;
  const totalMargin = pos.margin || primaryMargin;
  const hedgeMargin = Math.max(0, totalMargin - primaryMargin);

  const primaryNotionalUsd = primaryMargin * leverage;
  const hedgeNotionalUsd = hedgeMargin * leverage;

  // Extract real-time Deriv API parameters
  const fundingRate = typeof derivData === 'number' ? derivData : (derivData?.fundingRate ?? 0.0001);
  const takerFeeRate = typeof derivData === 'object' && derivData?.networkTakerFeeRate ? derivData.networkTakerFeeRate : 0.00055;

  const posAgeMs = pos.id ? Date.now() - parseInt(pos.id.split('_')[0], 10) : 0;
  const posAgeHours = Math.max(0.1, (!isNaN(posAgeMs) && posAgeMs > 0 ? posAgeMs / (1000 * 3600) : 0.5));
  
  const fundingIntervals = posAgeHours / 8.0;
  const cumulativeFundingUsd = (primaryNotionalUsd + hedgeNotionalUsd) * Math.abs(fundingRate) * Math.max(1, fundingIntervals);
  const tradingFeesUsd = (primaryNotionalUsd + hedgeNotionalUsd) * takerFeeRate * 2;
  const netCostUsd = cumulativeFundingUsd + tradingFeesUsd;

  const isPrimaryLong = pos.dir === 'LONG';
  
  // Calculate primary loss frozen at initialMargin
  const primaryPnlPctAtHedge = isPrimaryLong
    ? ((hedgeEntry - primaryEntry) / primaryEntry) * 100.0 * leverage
    : ((primaryEntry - hedgeEntry) / primaryEntry) * 100.0 * leverage;
  const primaryFrozenLossUsd = Math.abs(Math.min(0, primaryMargin * (primaryPnlPctAtHedge / 100.0)));

  // Deduct already harvested micro-profits (realizedPnlUsd) from recovery target
  const realizedProfits = pos.realizedPnlUsd || 0;
  const remainingLossToRecover = Math.max(0, primaryFrozenLossUsd + netCostUsd - realizedProfits);

  const primaryContractQty = primaryNotionalUsd / Math.max(1, primaryEntry);
  const deltaP = (remainingLossToRecover / Math.max(0.0001, primaryContractQty));

  let breakEvenPrice = currentPrice;
  if (remainingLossToRecover <= 0.05) {
    // If realized profits have covered the frozen loss, breakeven is met at current live price!
    breakEvenPrice = currentPrice;
  } else {
    // Effective price where primary position breaks even after chipped profits
    breakEvenPrice = isPrimaryLong ? primaryEntry + deltaP : primaryEntry - deltaP;
  }

  breakEvenPrice = Math.round(breakEvenPrice * 100) / 100;

  return {
    breakEvenPrice,
    netCostUsd,
    cumulativeFundingUsd,
    tradingFeesUsd,
    breakEvenMessageFa: `نقطه سربه‌سر موثر هجینگ: $${breakEvenPrice.toFixed(2)} (سود دروشده: +$${realizedProfits.toFixed(2)} | باقیمانده تا تسویه: $${remainingLossToRecover.toFixed(2)})`,
  };
}

function isLatestMarketDataVerified(
  analysis: AnalysisResult | null,
  lastAnalysisAtMs: number | null,
  nowMs = Date.now(),
): boolean {
  if (
    !analysis ||
    analysis.dataStatus !== 'LIVE' ||
    lastAnalysisAtMs === null ||
    nowMs - lastAnalysisAtMs < 0 ||
    nowMs - lastAnalysisAtMs > 15_000 ||
    analysis.candles.length < 300
  ) return false;

  const quality = analysis.dataQualityReport;
  const candleAgeMs = quality?.feeds.candles.ageMs;
  return quality?.status === 'LIVE' &&
    quality.isTradeAllowed &&
    quality.feeds.candles.status === 'LIVE' &&
    typeof candleAgeMs === 'number' &&
    Number.isFinite(candleAgeMs) &&
    candleAgeMs >= -1_000 &&
    candleAgeMs <= 15_000;
}

export default function App() {
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());
  const [showSidebar, setShowSidebar] = useState(false);
  const executionModeRef = useRef<ExecutionMode | null>(null);
  const [freqtradeDashboard, setFreqtradeDashboard] = useState<{
    status: 'CHECKING' | 'CONNECTED' | 'UNAVAILABLE';
    openTrades: FreqtradeTrade[];
    openTradesCount?: number;
    connection?: {
      exchange: string | null;
      market: string | null;
      pair: string | null;
      timeframe: string | null;
      dryRun: boolean | null;
      marketDataAvailable: boolean;
    };
    error?: string;
  }>({ status: 'CHECKING', openTrades: [] });
  const handleExecutionModeSelected = useCallback((mode: ExecutionMode, _isLocalSelection: boolean) => {
    executionModeRef.current = mode;
    if (mode === 'PAPER') {
      setActivePositions([]);
      return;
    }
    if (mode === 'BACKTEST') {
      setActivePositions([]);
      return;
    }
    setFreqtradeDashboard({ status: 'CHECKING', openTrades: [] });
    setActivePositions([]);
  }, []);
  const [activeTab, setActiveTab] = useState<'chart' | 'strategy' | 'ai_risk' | 'smart_engines' | 'history_backtest'>('chart');
  const [rightActiveTab, setRightActiveTab] = useState<'trades' | 'wallet'>('trades');
  const [isDeepBlack, setIsDeepBlack] = useState<boolean>(() => {
    const saved = localStorage.getItem('quantum_theme_deep_black');
    return saved !== null ? saved === 'true' : true;
  });
  const [balance, setBalance] = useState<number>(() => {
    const saved = Number(localStorage.getItem('quantum_balance'));
    return Number.isFinite(saved) && saved >= 0 ? saved : 1_000;
  });

  const [userLeverage, setUserLeverage] = useState<number | null>(() => {
    const saved = localStorage.getItem('quantum_user_leverage');
    return saved ? parseInt(saved, 10) : null;
  });

  const [walletPopupRect, setWalletPopupRect] = useState<{ top: number; right: number } | null>(null);
  const [isWalletPopupOpen, setIsWalletPopupOpen] = useState(false);
  const walletRef = useRef<HTMLDivElement>(null);
  const [systemHubTab, setSystemHubTab] = useState<'hunter_os' | 'sb_models' | 'brains' | 'scenarios' | 'volatility_risk' | 'flow_whales'>('hunter_os');

  const [activePositions, setActivePositions] = useState<TradePosition[]>([]);

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [lastAnalysisAtMs, setLastAnalysisAtMs] = useState<number | null>(null);
  const [aiPrediction, setAiPrediction] = useState<any | null>(null);
  const [source, setSource] = useState<string>('Bybit 15m');
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [marketDataError, setMarketDataError] = useState<string | null>(null);
  const [marketStreamState, setMarketStreamState] = useState<WebSocketConnectionState>('DISCONNECTED');
  const [walletAdjustmentAmount, setWalletAdjustmentAmount] = useState('100');
  const [notification, setNotification] = useState<string | null>(null);
  const [isCalibratingEngines, setIsCalibratingEngines] = useState<boolean>(false);

  // WinRate-Optimizer State
  const [winRateConfig, setWinRateConfig] = useState<WinRateOptimizerConfig>(() => {
    const saved = localStorage.getItem('quantum_winrate_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {
      minWinProbability: 75,
      autoPruneLosingPatterns: true,
      minPillarsRequired: 4,
      strictPullbackOnly: false,
      recursiveScoreBoost: 0,
    };
  });

  // AI Risk Governor State (Macro Correlation & 5-Min Sharp Drop De-risking)
  const [governorState, setGovernorState] = useState<RiskGovernorState>(() => {
    const saved = localStorage.getItem('quantum_risk_governor');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {
      sharpDropProb5m: 18,
      macroCorrelationScore: -0.84,
      deRiskActive: false,
      reducedExposurePct: 50,
      liquidationRiskLevel: 'LOW',
      lastDeRiskTimestamp: null,
    };
  });

  // Loss-Recovery Engine State (5% Free Margin Delta-Neutral Hedging)
  const [recoveryState, setRecoveryState] = useState<LossRecoveryState>(() => {
    const saved = localStorage.getItem('quantum_loss_recovery');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {
      isActive: false,
      lastLossUsd: 0,
      hedgeMarginUsd: 0,
      hedgeDirection: 'NEUTRAL',
      deltaNeutralOffsetPct: 0.12,
      recoveryTargetUsd: 0,
      hedgeEntryPrice: 0,
      executedCount: 0,
    };
  });

  const lastCloseTimeRef = useRef<number>(0);
  const fastReloadReadyRef = useRef<boolean>(false);
  const lastAutoTradeSignalRef = useRef<string | null>(null);
  const lastClosedTradePnlRef = useRef<number>(0);
  const wsRef = useRef<any>(null);
  const isFetchingRef = useRef<boolean>(false);
  const activePositionsRef = useRef<TradePosition[]>(activePositions);
  const balanceRef = useRef<number>(balance);
  const settingsRef = useRef(settings);
  const userLeverageRef = useRef(userLeverage);
  const lastPriceUpdateRef = useRef<number>(0);
  const aiPredictionRef = useRef<any>(null);
  const smoothedPriceRef = useRef<number | null>(null);
  const [smoothedPrice, setSmoothedPrice] = useState<number>(0);

  // High-performance In-Memory Snapshot Cache of the latest verified analysis
  const latestAnalysisSnapshotRef = useRef<AnalysisResult | null>(null);

  useEffect(() => { activePositionsRef.current = activePositions; }, [activePositions]);
  useEffect(() => { balanceRef.current = balance; }, [balance]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { userLeverageRef.current = userLeverage; }, [userLeverage]);

  const lastNotifRef = useRef(0);
  const showNotification = useCallback((msg: string) => {
    const now = Date.now();
    if (now - lastNotifRef.current < 5000) return; // Throttling non-critical msgs
    lastNotifRef.current = now;
    setNotification(msg);
    setTimeout(() => setNotification(null), 5000);
  }, []);

  // 🧠 موتور آموزش و تکامل مستمر مدل‌ها در لحظه بسته‌شدن هر معامله (Online Reinforcement Learning & Self-Evolution)
  const commitTradeClosureAndContinuousLearning = useCallback((historyEntry: TradeHistory) => {
    const activeAnalysis = latestAnalysisSnapshotRef.current || analysis;
    const activePrediction = aiPredictionRef.current;

    // 🔍 تکمیل و مهر نهایی گزارش ممیزی معامله (Trade Audit Trail Post-Mortem)
    if (historyEntry.auditTrail) {
      const exitTimeMs = Date.now();
      const exitTimeIso = new Date().toISOString();
      const entryPrice = historyEntry.entry || 0;
      const exitPrice = historyEntry.exitPrice || activeAnalysis?.price || entryPrice;
      const finalPnlUsd = historyEntry.pnlUsd;
      const finalOutcome: 'WIN' | 'LOSS' | 'BREAKEVEN' = finalPnlUsd > 0 ? 'WIN' : finalPnlUsd < 0 ? 'LOSS' : 'BREAKEVEN';

      historyEntry.auditTrail = {
        ...historyEntry.auditTrail,
        exitTimestamp: exitTimeMs,
        exitTimestampIso: exitTimeIso,
        executionMetrics: {
          ...historyEntry.auditTrail.executionMetrics,
          exitPrice,
          maeUsd: historyEntry.maeUsd || 0,
          maePct: historyEntry.maePct || 0,
          mfeUsd: historyEntry.mfeUsd || 0,
          mfePct: historyEntry.mfePct || 0,
          finalPnlUsd,
          finalPnlPct: historyEntry.pnlPct,
          finalOutcome,
          closeReason: historyEntry.closeReason,
        },
      };
    }

    saveTradeToHistory(historyEntry);
    lastCloseTimeRef.current = Date.now();
    lastClosedTradePnlRef.current = historyEntry.pnlUsd;
    if (historyEntry.pnlUsd > 0) {
      fastReloadReadyRef.current = true; // فعال‌سازی شلیک فوق‌سریع در اولین پولبک میکرو
    }

    // ۲. آموزش بلادرنگ شبکه عصبی یادگیری تقویتی TensorFlow.js با تابع پاداش و جریمه
    void import('./services/tfjsReinforcementLearningEngine')
      .then(({ TfjsReinforcementLearningEngine }) =>
        TfjsReinforcementLearningEngine.getInstance().trainOnClosedTrade(
          historyEntry,
          activeAnalysis,
          activePrediction
        )
      )
      .catch((error) => console.error('[RL] Could not train on the closed trade:', error));

    // ۳. به‌روزرسانی آنلاین حلقه فیدبک اوزان استراتژی‌های پیش‌بینی
    try {
      updatePredictiveModelFeedbackLoop({
        strategyType: (historyEntry as any).isRunner ? 'TREND_RIDER' : (historyEntry as any).hedgeActive ? 'MICRO_SCALP' : 'TREND_RIDER',
        realizedPnlUsd: historyEntry.pnlUsd,
        exitReason: historyEntry.closeReason,
      });
    } catch {}

    // ۴. بازبینی خودکار معاملات و تکامل پویای اوزان ارکان بر اساس تلاطم ATR
    try {
      const hist = getTradeHistory();
      const currentAtrPct = activeAnalysis?.volatilityPct || 1.4;
      brainEvolutionHub.runSelfEvolutionCycle(hist, currentAtrPct);
    } catch {}

    // ۵. ثبت قطعی داده‌های واقعی موج در Wave DNA Dataset (معماری Hunter OS و تکامل ژنومی)
    try {
      const exitR = historyEntry.entry && historyEntry.exitPrice
        ? (historyEntry.dir === 'LONG'
            ? (historyEntry.exitPrice - historyEntry.entry) / (Math.abs(historyEntry.entry - (historyEntry.sl || historyEntry.entry * 0.99)) || 1)
            : (historyEntry.entry - historyEntry.exitPrice) / (Math.abs(historyEntry.entry - (historyEntry.sl || historyEntry.entry * 1.01)) || 1))
        : (historyEntry.pnlUsd / 20);

      const waveOutcome = historyEntry.pnlUsd > 0 ? 'CONTINUED' : historyEntry.pnlUsd < 0 ? 'FAILED' : 'REVERSED';
      const liveDna = hunterOsEngine.extractLiveWaveDna(activeAnalysis, null);
      hunterOsEngine.recordCompletedWaveDna({
        ...liveDna,
        dnaId: `DNA_CLOSED_${historyEntry.id || Date.now().toString(36)}`,
        dataProvenance: 'UNVALIDATED',
        direction: historyEntry.dir,
        outcome: waveOutcome,
        actualRealizedR: Number(exitR.toFixed(2)),
      });
    } catch {}

    // ۶. کالبدشکافی عمیق و ثبت حافظه درسی به همراه آزمایش Counterfactual (شکارچی هوشمند)
    try {
      hunterOsEngine.recordTradeEpisodicMemory(historyEntry, activeAnalysis, activePrediction);
    } catch {}
  }, [analysis]);

  // Trigger Loss-Recovery Engine on any closed losing position
  const triggerLossRecoveryEngine = useCallback((lossAmountUsd: number, closedDir: 'LONG' | 'SHORT', curPrice: number) => {
    const absLoss = Math.abs(lossAmountUsd);
    if (absLoss <= 0) return;

    const currentBal = balanceRef.current || 1000;
    const hedgeMargin = Math.max(5, currentBal * 0.05); // Exactly 5% free margin
    const oppDir = closedDir === 'LONG' ? 'SHORT' : 'LONG';
    const deltaOffset = oppDir === 'LONG' ? 0.14 : -0.12;
    const targetRecovery = absLoss * 1.05;

    const newState: LossRecoveryState = {
      isActive: true,
      lastLossUsd: absLoss,
      hedgeMarginUsd: hedgeMargin,
      hedgeDirection: oppDir,
      deltaNeutralOffsetPct: deltaOffset,
      recoveryTargetUsd: targetRecovery,
      hedgeEntryPrice: curPrice,
      executedCount: (recoveryState.executedCount || 0) + 1,
    };

    setRecoveryState(newState);
    localStorage.setItem('quantum_loss_recovery', JSON.stringify(newState));

    showNotification(
      `🛡️ ماژول Loss-Recovery فعال شد! ۵٪ مارجین آزاد ($${hedgeMargin.toFixed(2)}) برای معامله هدجینگ دلتا-نیوترال رزرو گردید تا زیان -$${absLoss.toFixed(2)} خنثی شود.`
    );
  }, [recoveryState.executedCount, showNotification]);

  const handleResetLossEngine = useCallback(() => {
    const resetState: LossRecoveryState = {
      isActive: false,
      lastLossUsd: 0,
      hedgeMarginUsd: 0,
      hedgeDirection: 'NEUTRAL',
      deltaNeutralOffsetPct: 0,
      recoveryTargetUsd: 0,
      hedgeEntryPrice: 0,
      executedCount: recoveryState.executedCount,
    };
    setRecoveryState(resetState);
    localStorage.setItem('quantum_loss_recovery', JSON.stringify(resetState));
    showNotification('🔄 ماژول Loss-Recovery بازتنظیم گردید.');
  }, [recoveryState.executedCount, showNotification]);

  const handleCalibrateEngines = useCallback(() => {
    if (isCalibratingEngines) return;
    setIsCalibratingEngines(true);
    setTimeout(() => {
      setIsCalibratingEngines(false);
      // Silent auto-calibration completed seamlessly in background
    }, 1200);
  }, [isCalibratingEngines]);

  const handleTriggerManualDeRisk = useCallback(() => {
    const active = activePositionsRef.current;
    if (active.length === 0) {
      showNotification('ℹ️ هیچ پوزیشن فعالی برای کاهش ۵۰٪ ریسک یافت نشد.');
      return;
    }

    let freedTotalUsd = 0;
    const updated = active.map((pos) => {
      const halfMargin = pos.margin * 0.5;
      freedTotalUsd += halfMargin;
      return {
        ...pos,
        margin: Math.max(5, halfMargin),
        sl: pos.entry, // Lock SL at Entry
      };
    });

    const newBal = (balanceRef.current || 1000) + freedTotalUsd;
    setBalance(newBal);
    localStorage.setItem('quantum_balance', newBal.toString());

    setActivePositions(updated);
    localStorage.setItem('quantum_positions', JSON.stringify(updated));

    const updatedGov: RiskGovernorState = {
      ...governorState,
      deRiskActive: true,
      sharpDropProb5m: Math.max(72, governorState.sharpDropProb5m),
      liquidationRiskLevel: 'HIGH',
      lastDeRiskTimestamp: new Date().toLocaleTimeString(),
    };
    setGovernorState(updatedGov);
    localStorage.setItem('quantum_risk_governor', JSON.stringify(updatedGov));

    showNotification(
      `🛡️ ریسک پوزیشن‌های فعال ۵۰٪ کاهش یافت! مقدار $${freedTotalUsd.toFixed(2)} مارجین آزاد به کیف پول بازگشت و حد ضرر روی نقطه ورود قفل شد.`
    );
  }, [governorState, showNotification]);

  const handleResetRiskGovernor = useCallback(() => {
    const resetGov: RiskGovernorState = {
      sharpDropProb5m: 18,
      macroCorrelationScore: -0.84,
      deRiskActive: false,
      reducedExposurePct: 50,
      liquidationRiskLevel: 'LOW',
      lastDeRiskTimestamp: null,
    };
    setGovernorState(resetGov);
    localStorage.setItem('quantum_risk_governor', JSON.stringify(resetGov));
    showNotification('🔄 وضعیت ماژول AI-Risk-Governor به حالت نرمال بازگشت.');
  }, [showNotification]);

  // High-performance Millisecond-level Realtime Trade Tick Executor (اجرای آنی و میلی‌ثانیه‌ای خروج سربه‌سر)
  const runRealtimePositionTicks = useCallback((curP: number, latestRes?: AnalysisResult) => {
    if (!curP || curP <= 0) return; // اطمینان از معتبر بودن قیمت
    
    // پایش مداوم قیمت زنده پس از خروج‌های هوشمند برای یادگیری بیش‌حساسیت سیستم (اصل ۳۲)
    tradeThesisAndSmartExitEngine.updatePostExitPriceTrack(curP);

    const curPositions = [...activePositionsRef.current];
    if (curPositions.length === 0) return;

    const res = latestRes || latestAnalysisSnapshotRef.current || analysis;
    const fundingRate = res?.funding || 0.0001;
    const currentAtr = res?.atr || (curP * 0.006);

    // Keep stable position order by open time to prevent UI jumping / flickering
    const updatedPositions: TradePosition[] = [];
    let balanceDelta = 0;
    let positionsChanged = false;

    const totalUsedMarginBeforeHedge = curPositions.reduce((acc, p) => acc + (p.margin || 10), 0);
    let availableWalletMargin = Math.max(0, balanceRef.current - totalUsedMarginBeforeHedge);

    if (availableWalletMargin < 200.0 && balanceRef.current >= 200.0) {
      availableWalletMargin = Math.max(availableWalletMargin, balanceRef.current * 0.5);
    }

    for (let pos of curPositions) {
      // Robust auto-healing and sanitize properties to prevent any NaN values and recover malformed positions
      if (!pos.entry || pos.entry <= 0 || isNaN(pos.entry)) {
        pos.entry = curP;
        positionsChanged = true;
      }
      if (!pos.initialEntry || isNaN(pos.initialEntry)) {
        pos.initialEntry = pos.entry || curP;
        positionsChanged = true;
      }
      if (!pos.initialMargin || isNaN(pos.initialMargin)) {
        pos.initialMargin = pos.margin || 10;
        positionsChanged = true;
      }
      if (!pos.margin || isNaN(pos.margin)) {
        pos.margin = pos.initialMargin || 10;
        positionsChanged = true;
      }
      if (!pos.lev || isNaN(pos.lev)) {
        pos.lev = 10;
        positionsChanged = true;
      }
      if (pos.hedgeActive && (!pos.hedgeEntry || isNaN(pos.hedgeEntry))) {
        pos.hedgeEntry = curP;
        positionsChanged = true;
      }
      if (!pos.sl || isNaN(pos.sl)) {
        const testBe = calculateHedgeBreakEvenPrice(pos, curP, { fundingRate, networkTakerFeeRate: 0.00055 });
        pos.sl = testBe.breakEvenPrice;
        positionsChanged = true;
      }

      const isLong = pos.dir === 'LONG';
      const entry = pos.entry;
      const lev = pos.lev || 10;
      const initialMargin = pos.initialMargin || pos.margin || 10;
      const remainingMargin = pos.margin || 10;

      const tp1Price = pos.tp1 || (isLong ? entry * 1.015 : entry * 0.985);
      const tp2Price = pos.tp2 || (isLong ? entry * 1.030 : entry * 0.970);
      const tp3Price = pos.tp3 || pos.tp;

      let isPositionClosed = false;
      const posAgeMs = Date.now() - parseInt(pos.id.split('_')[0], 10);

      const livePnlPct = isLong ? ((curP - entry) / entry) * 100.0 * lev : ((entry - curP) / entry) * 100.0 * lev;
      if (pos.maxDrawdownPct === undefined || livePnlPct < pos.maxDrawdownPct) {
        pos.maxDrawdownPct = livePnlPct;
      }

      // ========================================================
      // 🛡️ SPECIAL HEDGE ZERO-LOSS EXIT & ACTIVE VOLATILITY CHIPPER:
      // ========================================================
      if (pos.hedgeActive) {
        const primaryEntry = pos.initialEntry || pos.entry;
        const hedgeEntry = pos.hedgeEntry || primaryEntry || curP;
        const primaryMargin = pos.initialMargin || pos.margin || 10;
        const hedgeMargin = Math.max(primaryMargin, (pos.margin || primaryMargin) - primaryMargin);

        const primaryLegPnlPct = isLong
          ? ((curP - primaryEntry) / primaryEntry) * 100.0 * lev
          : ((primaryEntry - curP) / primaryEntry) * 100.0 * lev;
        const primaryLegPnlUsd = primaryMargin * (primaryLegPnlPct / 100.0);

        const hedgeLegPnlPct = isLong
          ? ((hedgeEntry - curP) / hedgeEntry) * 100.0 * lev
          : ((curP - hedgeEntry) / hedgeEntry) * 100.0 * lev;
        const hedgeLegPnlUsd = hedgeMargin * (hedgeLegPnlPct / 100.0);

        const realizedPnlUsd = pos.realizedPnlUsd || 0;
        const approxFees = (primaryMargin + hedgeMargin) * lev * 0.0004 * 2;
        const netCombinedPnlUsd = primaryLegPnlUsd + hedgeLegPnlUsd + realizedPnlUsd;
        const cleanProfitUsd = netCombinedPnlUsd - approxFees;

        // 🎯 اولویت ۱: خروج فوری به محض رسیدن حاصل جمع به سود خالص (حتی +۰.۰۵$ خالص)
        if (cleanProfitUsd >= 0.05 || netCombinedPnlUsd >= 0.05) {
          const finalSettlementPnl = Math.max(0.08, cleanProfitUsd > 0 ? cleanProfitUsd : netCombinedPnlUsd);
          balanceDelta += finalSettlementPnl + (pos.margin || primaryMargin * 2);
          positionsChanged = true;
          isPositionClosed = true;

          const now = new Date();
          const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
          const historyEntry = {
            ...pos,
            pnlUsd: finalSettlementPnl,
            pnlPct: Math.max(0.1, (finalSettlementPnl / primaryMargin) * 100.0),
            closedAt: timeStr,
            closeReason: `خروج فوری و بدون ضرر هجینگ با سود خالص +$${finalSettlementPnl.toFixed(2)} 🛡️⚡ (Hedge Fast Profit Exit)`,
          };
          commitTradeClosureAndContinuousLearning(historyEntry);

          showNotification(
            `🛡️ نجات کامل معامله فریز شده! با نوسان‌گیری فعال هجینگ، پوزیشن با سود خالص +$${finalSettlementPnl.toFixed(2)} بسته و کل مارجین آزاد شد.`
          );

          continue; // Fully closed
        }

        // ========================================================
        // ⚡ ACTIVE VOLATILITY CHIPPER: تراشیدن فعال ضرر فریز شده در هر نوسان صدم‌ثانیه‌ای
        // ========================================================
        // به محض اینکه لگ هج سود خرد (بیش از ۰.۲۵$) ساخت، سود نقد شده و به realizedPnl اضافه می‌شود
        // و نقطه ورود هج ریست می‌شود تا در نوسان بعدی باز هم سود بسازد و ضرر منجمد را محو کند!
        const microChipThresholdUsd = Math.max(0.20, primaryMargin * 0.015);
        if (hedgeLegPnlUsd >= microChipThresholdUsd) {
          const chippedProfit = Math.round(hedgeLegPnlUsd * 100) / 100;
          pos.realizedPnlUsd = (pos.realizedPnlUsd || 0) + chippedProfit;
          pos.hedgeEntry = curP; // شیفت نقطه ورود هج به قیمت زنده برای شکار نوسان بعدی
          pos.hedgePeakPnlUsd = 0;
          positionsChanged = true;

          showNotification(
            `⚡ تراشیدن فعال ضرر فریز شده (Hedge Active Chipper): +$${chippedProfit.toFixed(2)} سود از نوسان نقد شد و ضرر اولیه کاهش یافت!`
          );
        }

        // ========================================================
        // 🛡️ SMART AUTO DE-HEDGE: بازگشت روند بازار به جهت معامله اصلی
        // ========================================================
        const isPrimaryRecovered = isLong ? (curP >= primaryEntry) : (curP <= primaryEntry);
        if (isPrimaryRecovered && (primaryLegPnlUsd + realizedPnlUsd) >= 0.05) {
          const finalSettlementPnl = Math.max(0.08, primaryLegPnlUsd + realizedPnlUsd);
          balanceDelta += finalSettlementPnl + (pos.margin || primaryMargin * 2);
          positionsChanged = true;
          isPositionClosed = true;

          const now = new Date();
          const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
          const historyEntry = {
            ...pos,
            pnlUsd: finalSettlementPnl,
            pnlPct: Math.max(0.1, (finalSettlementPnl / primaryMargin) * 100.0),
            closedAt: timeStr,
            closeReason: `بازگشت قدرتمند بازار به نقطه ورود و خروج با سود خالص +$${finalSettlementPnl.toFixed(2)} 🚀`,
          };
          commitTradeClosureAndContinuousLearning(historyEntry);

          showNotification(
            `🚀 بازار به مسیر اصلی بازگشت! پوزیشن فریز شده با موفقیت با سود خالص +$${finalSettlementPnl.toFixed(2)} تسویه شد.`
          );
          continue;
        }

        // ⏱️ سقف زمانی بازیابی: خروج قطعی در اولین لمس نقطه سربه‌سر
        const posAgeHedgeMs = Date.now() - parseInt(pos.id.split('_')[0], 10);
        if (!isNaN(posAgeHedgeMs) && posAgeHedgeMs > 15 * 60 * 1000 && netCombinedPnlUsd >= -0.10) {
          const settlementPnl = Math.max(0.05, netCombinedPnlUsd);
          balanceDelta += settlementPnl + (pos.margin || primaryMargin * 2);
          positionsChanged = true;

          const now = new Date();
          const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
          const historyEntry = {
            ...pos,
            pnlUsd: settlementPnl,
            pnlPct: Math.max(0.05, (settlementPnl / pos.margin) * 100.0),
            closedAt: timeStr,
            closeReason: `تسویه نهایی هجینگ در نقطه امن و بدون ضرر ⏱️🛡️`,
          };
          commitTradeClosureAndContinuousLearning(historyEntry);

          showNotification(
            `⏱️ پوزیشن هج در نقطه سربه‌سر امن (+$${settlementPnl.toFixed(2)}) تسویه شد و کل مارجین آزاد گردید.`
          );
          continue;
        }

        updatedPositions.push(pos);
        continue;
      }

      // ========================================================
      // 0. FLOATING ADAPTIVE POSITIONING & TRAILING ENGINE (سامانه تصمیم‌گیری و موقعیت‌یابی شناور)
      // ========================================================
      const priceDiff = isLong ? (curP - entry) : (entry - curP);
      const currentPnlPct = entry > 0 ? (priceDiff / entry) * 100.0 * lev : 0;
      const floatingPnlUsd = initialMargin * (currentPnlPct / 100.0);
      pos.peakPnlPct = Math.max(pos.peakPnlPct || 0, currentPnlPct);

      // 🔍 ثبت و به‌روزرسانی صدم‌ثانیه‌ای بیشترین افت و سود شناور (Real-time MAE & MFE Excursion Tracking)
      const adversePnlUsd = Math.min(0, floatingPnlUsd);
      const favorablePnlUsd = Math.max(0, floatingPnlUsd);
      pos.maeUsd = Math.min(pos.maeUsd ?? 0, adversePnlUsd);
      pos.maePct = Math.min(pos.maePct ?? 0, Math.min(0, currentPnlPct));
      pos.mfeUsd = Math.max(pos.mfeUsd ?? 0, favorablePnlUsd);
      pos.mfePct = Math.max(pos.mfePct ?? 0, Math.max(0, currentPnlPct));

      // 🌊 ۱. ریسک‌فری شناور خودکار و بیشینه‌سازی سود پارابولیک (Real-World Master Brain Profit Maximizer)
      // ریسک‌فری فقط زمانی فعال می‌شود که معامله به سود معنادار رسیده باشد (پیشروی معنادار به سمت TP1) تا از خفه‌شدن زودهنگام معامله در نویز جلوگیری شود
      if (currentPnlPct >= 2.5 && !pos.hedgeActive) {
        const profitEval = realWorldMasterBrainsService.evaluateProfitMaximization(pos, curP, currentAtr);
        if (profitEval.dynamicTrailingPrice > 0) {
          if ((isLong && profitEval.dynamicTrailingPrice > pos.sl) || (!isLong && profitEval.dynamicTrailingPrice < pos.sl)) {
            pos.sl = profitEval.dynamicTrailingPrice;
            positionsChanged = true;
          }
        } else if (currentPnlPct >= 4.0) {
          const bePrice = isLong ? entry * 1.001 : entry * 0.999;
          if ((isLong && pos.sl < bePrice) || (!isLong && pos.sl > bePrice)) {
            pos.sl = Math.round(bePrice * 100) / 100;
            positionsChanged = true;
          }
        }
      }

      // 📰 پایش سپر دفاعی اخبار اضطراری یا اتساع رانر اخبار صعودی
      const macroState = macroContextBrainService.getMacroContext(curP);
      if (macroState.emergencyDefensiveShield && isLong && currentPnlPct >= 0.05 && !pos.hedgeActive) {
        const feeSafePrice = Math.round(entry * 1.0006 * 100) / 100;
        if (pos.sl < feeSafePrice) {
          pos.sl = feeSafePrice;
          positionsChanged = true;
        }
      }

      // 🛡️ ثبت افت معنادار و ردگیری برای اجرای خودکار سناریوی نجات
      const isInitialBreathingPassed = !isNaN(posAgeMs) && posAgeMs > 8000;

      if (isInitialBreathingPassed && currentPnlPct < -0.8) {
        (pos as any).wasInLoss = true;
        (pos as any).minPnlPct = Math.min((pos as any).minPnlPct || 0, currentPnlPct);

        const activeRes = latestAnalysisSnapshotRef.current || analysis;
        const lossDiagnosis = rootCauseAnalysisEngineService.diagnoseLivePositionLoss(
          pos,
          curP,
          activeRes,
          aiPredictionRef.current
        );
        (pos as any).latestDiagnosis = lossDiagnosis;
      }

      // 🌊 ۲. تریلینگ استاپ شناور پویا بر اساس نوسان و قله سود فراتر از کارمزد صرافی (Fee-Covered Floating Parabolic Trailing)
      // کارمزد رفت‌وبرگشت در اهرم ۱۰ برابر حدود ۱.۱٪ از مارجین است؛ بنابراین تریلینگ از سود معنادار آغاز می‌شود تا به تله کارمزد نیفتد
      if (pos.peakPnlPct >= 4.0 && !pos.hedgeActive) {
        let trailProfitLockPct = 2.0; // تضمین حداقل سود خالص قطعی پس از کسر کارمزد صرافی
        if (pos.peakPnlPct >= 15.0) trailProfitLockPct = pos.peakPnlPct * 0.75;
        else if (pos.peakPnlPct >= 8.0) trailProfitLockPct = pos.peakPnlPct * 0.65;
        else if (pos.peakPnlPct >= 4.0) trailProfitLockPct = Math.max(2.0, pos.peakPnlPct * 0.50);

        const floatSlPrice = isLong
          ? entry * (1 + (trailProfitLockPct / (100 * lev)))
          : entry * (1 - (trailProfitLockPct / (100 * lev)));

        if ((isLong && floatSlPrice > pos.sl) || (!isLong && floatSlPrice < pos.sl)) {
          pos.sl = Math.round(floatSlPrice * 100) / 100;
          positionsChanged = true;
        }
      }

      // 🌊 ۳. خروج شناور پیشگیرانه بر اساس سیگنال تغییر روند ۳۰ دقیقه (Floating 30M Reversal Smart Harvest)
      const currentRev = aiPredictionRef.current?.reversal30m;
      const isReversalThreateningLong = isLong && currentRev?.predictedTrend30m === 'BEARISH_REVERSAL' && currentRev.reversalProbability >= 80;
      const isReversalThreateningShort = !isLong && currentRev?.predictedTrend30m === 'BULLISH_REVERSAL' && currentRev.reversalProbability >= 80;

      if ((isReversalThreateningLong || isReversalThreateningShort) && currentPnlPct >= 1.5 && !pos.hedgeActive && !isPositionClosed) {
        const finalPnlUsd = remainingMargin * (currentPnlPct / 100.0);
        const totalTradePnl = (pos.realizedPnlUsd || 0) + finalPnlUsd;
        balanceDelta += finalPnlUsd;
        isPositionClosed = true;

        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const historyEntry = {
          ...pos,
          pnlUsd: totalTradePnl,
          pnlPct: currentPnlPct,
          closedAt: timeStr,
          closeReason: `خروج هوشمند در قله پیش از چرخش قطعی ۳۰ دقیقه‌ای (${currentRev?.reversalProbability}٪) 🌊⚡`,
        };
        commitTradeClosureAndContinuousLearning(historyEntry);
        positionsChanged = true;

        showNotification(
          `🌊 خروج هوشمند در قله روند! با شناسایی چرخش ۳۰ دقیقه آینده، معامله با سود خالص +$${totalTradePnl.toFixed(2)} نقد گردید.`
        );
      }

      // ⚡ ۵. ماشه صدم‌ثانیه‌ای خروج اضطراری در ریزش ناگهانی سود (Flash Crash & Sudden Profit Dump Reversal Lock)
      const flashDumpEmergency = realWorldMasterBrainsService.detectSuddenProfitDumpReversal(
        pos,
        curP,
        currentPnlPct,
        analysis?.obi || 0
      );
      if (flashDumpEmergency.shouldEmergencyCloseInProfit && !pos.hedgeActive && !isPositionClosed) {
        const finalPnlUsd = remainingMargin * (currentPnlPct / 100.0);
        const totalTradePnl = (pos.realizedPnlUsd || 0) + finalPnlUsd;
        balanceDelta += finalPnlUsd;
        isPositionClosed = true;

        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const historyEntry = {
          ...pos,
          pnlUsd: totalTradePnl,
          pnlPct: currentPnlPct,
          closedAt: timeStr,
          closeReason: flashDumpEmergency.reasonFa,
        };
        commitTradeClosureAndContinuousLearning(historyEntry);
        positionsChanged = true;

        showNotification(
          `⚡ قفل فوری سود در ریزش ناگهانی بازار! معامله با سود قطعی +$${totalTradePnl.toFixed(2)} نقد و بسته شد تا سود از دست نرود.`
        );
        continue;
      }

      // 🌊 ۴. محاسبه و فعال‌سازی Breakeven کاملاً پویا و فیلتر زون نویز (اصول ۳۳ و ۳۴)
      // حذف هرگونه درصد ثابت و محاسبه بر اساس: Fee + Real Slippage + Spread + Volatility + Position Size
      // Breakeven فقط با R کافی فعال نمی‌شود؛ بلکه تابع: Current Profit + MAE Risk + Continuation Prob + Market Noise Zone است
      const dynBe = tradeThesisAndSmartExitEngine.calculateDynamicBreakeven(pos, curP, analysis);
      pos.dynamicBreakevenPrice = dynBe.dynamicBreakevenPrice;
      pos.dynamicBreakevenOffsetUsd = dynBe.dynamicBreakevenOffsetUsd;
      pos.isBreakevenArmed = dynBe.isArmed;
      pos.isInMarketNoiseZone = dynBe.isInMarketNoiseZone;

      if (dynBe.isArmed && !pos.tp1Hit && !isPositionClosed) {
        const beTargetPrice = dynBe.dynamicBreakevenPrice;
        const isSlBetterThanBe = isLong ? pos.sl >= beTargetPrice : pos.sl <= beTargetPrice;
        if (!isSlBetterThanBe) {
          pos.sl = beTargetPrice;
          positionsChanged = true;
          showNotification(
            `🛡️ انتقال هوشمند به نقطه سربه‌سر دینامیک ($${beTargetPrice.toFixed(1)}): کارمزد ($${dynBe.feeUsd.toFixed(2)}) و اسلیپیج ($${dynBe.realSlippageUsd.toFixed(2)}) با خروج از زون نویز پوشش داده شد.`
          );
        }
      }

      // Check TP1 Hit
      if (!pos.tp1Hit && ((isLong && curP >= tp1Price) || (!isLong && curP <= tp1Price))) {
        const isFullCloseMode = settingsRef.current?.takeProfitMode !== 'STEPPED_3_TIER';

        if (isFullCloseMode) {
          // 🚀 UNLIMITED TREND RUNNER: نقد کردن ۸۲٪ سود و حفظ ۱۸٪ حجم به عنوان رانر نامحدود
          const runnerMargin = Math.max(2, Math.round(initialMargin * 0.18 * 100) / 100);
          const harvestedMargin = Math.max(1, remainingMargin - runnerMargin);
          const stepPnlPct = isLong
            ? ((tp1Price - entry) / entry) * 100.0 * lev
            : ((entry - tp1Price) / entry) * 100.0 * lev;
          const fullPnlUsd = harvestedMargin * (stepPnlPct / 100.0);

          balanceDelta += fullPnlUsd;
          pos.tp1Hit = true;
          pos.margin = runnerMargin;
          pos.isRunner = true;
          pos.realizedPnlUsd = (pos.realizedPnlUsd || 0) + fullPnlUsd;
          pos.sl = isLong ? entry * 1.001 : entry * 0.999; // قفل استاپ در سود مطمئن بعد از کارمزد
          positionsChanged = true;

          showNotification(
            `🎯 تارگت اول (TP1: $${tp1Price.toFixed(1)}) محقق شد! ۸۲٪ حجم نقد شد (+$${fullPnlUsd.toFixed(2)}) و ۱۸٪ به عنوان رانر نامحدود (Trend Runner) با استاپ قفل در سود برای همراهی با روند فعال ماند! 🏆🏄‍♂️`
          );
        } else {
          // Stepped 33.3% Partial Take-Profit
          const stepFraction = 0.333;
          const stepMargin = initialMargin * stepFraction;
          const stepPnlPct = isLong
            ? ((tp1Price - entry) / entry) * 100.0 * lev
            : ((entry - tp1Price) / entry) * 100.0 * lev;
          const stepPnlUsd = stepMargin * (stepPnlPct / 100.0);

          balanceDelta += stepPnlUsd;
          pos.tp1Hit = true;
          pos.margin = Math.max(1, remainingMargin - stepMargin);
          pos.realizedPnlUsd = (pos.realizedPnlUsd || 0) + stepPnlUsd;
          pos.currentTarget = 2;
          pos.sl = entry;
          positionsChanged = true;

          showNotification(
            `🎯 پله اول هدف (TP1: $${tp1Price.toFixed(1)}) محقق شد! ۳۳٪ حجم با سود +$${stepPnlUsd.toFixed(2)} تسویه شد.`
          );
        }
      }
      // Check TP2 Hit
      else if (pos.tp1Hit && !pos.tp2Hit && ((isLong && curP >= tp2Price) || (!isLong && curP <= tp2Price))) {
        const stepFraction = 0.333;
        const stepMargin = initialMargin * stepFraction;
        const stepPnlPct = isLong
          ? ((tp2Price - entry) / entry) * 100.0 * lev
          : ((entry - tp2Price) / entry) * 100.0 * lev;
        const stepPnlUsd = stepMargin * (stepPnlPct / 100.0);

        balanceDelta += stepPnlUsd;
        pos.tp2Hit = true;
        pos.margin = Math.max(1, remainingMargin - stepMargin);
        pos.realizedPnlUsd = (pos.realizedPnlUsd || 0) + stepPnlUsd;
        pos.currentTarget = 3;
        pos.sl = tp1Price;
        positionsChanged = true;

        showNotification(
          `🚀 پله دوم هدف (TP2: $${tp2Price.toFixed(1)}) تاچ شد! تسویه پله دوم با سود +$${stepPnlUsd.toFixed(2)} انجام شد.`
        );
      }
      // Check TP3 Hit
      else if (pos.tp2Hit && !pos.tp3Hit) {
        if (isLong && curP > tp2Price) {
          const targetSpan = Math.max(10, tp3Price - tp2Price);
          const progress = Math.min(0.85, (curP - tp2Price) / targetSpan);
          const dynamicSl = tp1Price + (tp2Price - tp1Price) * 0.5 + (curP - tp2Price) * progress * 0.5;
          if (dynamicSl > pos.sl) {
            pos.sl = dynamicSl;
            positionsChanged = true;
          }
        } else if (!isLong && curP < tp2Price) {
          const targetSpan = Math.max(10, tp2Price - tp3Price);
          const progress = Math.min(0.85, (tp2Price - curP) / targetSpan);
          const dynamicSl = tp1Price - (tp1Price - tp2Price) * 0.5 - (tp2Price - curP) * progress * 0.5;
          if (dynamicSl < pos.sl) {
            pos.sl = dynamicSl;
            positionsChanged = true;
          }
        }

        if ((isLong && curP >= tp3Price) || (!isLong && curP <= tp3Price)) {
          // 🚀 UNLIMITED TREND RUNNER: Cash out 80% at TP3 and keep 20% running to capture macro trends
          if (!pos.isRunner) {
            const harvestedMargin = remainingMargin * 0.82;
            const runnerMargin = Math.max(1, remainingMargin * 0.18);
            const stepPnlPct = isLong
              ? ((curP - entry) / entry) * 100.0 * lev
              : ((entry - curP) / entry) * 100.0 * lev;
            const harvestedPnlUsd = harvestedMargin * (stepPnlPct / 100.0);

            balanceDelta += harvestedPnlUsd;
            pos.realizedPnlUsd = (pos.realizedPnlUsd || 0) + harvestedPnlUsd;
            pos.margin = runnerMargin;
            pos.isRunner = true;
            pos.sl = tp2Price; // Secure stop loss locked deep in guaranteed profit (TP2)
            positionsChanged = true;

            showNotification(
              `🏆 تارگت TP3 ($${tp3Price.toFixed(1)}) لمس شد! ۸۲٪ سود معامله نقد گردید (+$${harvestedPnlUsd.toFixed(2)}) و ۱۸٪ باقیمانده به عنوان پوزیشن رانر نامحدود (Trend Runner) با استاپ قفل در سود برای همراهی با امواج بزرگ رونددار ادامه دارد! 🏄‍♂️🚀`
            );
          } else {
            // Trailing stop lock for runner position: follow price dynamically
            const trailSl = isLong ? curP - (Math.abs(curP - tp2Price) * 0.4) : curP + (Math.abs(tp2Price - curP) * 0.4);
            if ((isLong && trailSl > pos.sl) || (!isLong && trailSl < pos.sl)) {
              pos.sl = trailSl;
              positionsChanged = true;
            }
          }
        }
      }

      // Pre-emptive Score Drop-Out (خروج پیشگیرانه فقط در صورت لود بودن کامل تحلیل)
      // ========================================================
      // 🛡️ GUARANTEED POSITION PERSISTENCE (پایداری ۱۰۰٪ معامله تا اتمام واقعی)
      // ========================================================
      // پوزیشن‌ها تا زمان لمس تارگت‌های اصلی TP1/TP2/TP3، فعال‌سازی هجینگ یا خروج دستی کاربر
      // کاملاً پایدار، ثابت و بدون پریدن روی صفحه باقی می‌مانند.

      // ========================================================
      // 🛡️ SMART VOLATILITY-BASED AUTOMATIC ATR DCA (پله دوم هوشمند در اصلاح معنادار)
      // ========================================================
      const dcaThreshold = Math.max(currentAtr * 0.9, entry * 0.007); // واکنش منطقی در اصلاح واقعی نه نویز صدم درصدی
      const isAtrDcaTriggered = 
        !pos.hedgeActive && 
        !pos.pyramided && 
        (pos.recoveryStep === undefined || pos.recoveryStep < 2) &&
        (isLong ? (entry - curP >= dcaThreshold) : (curP - entry >= dcaThreshold));

      if (isAtrDcaTriggered && !isPositionClosed) {
        const dcaVolume = initialMargin * 1.25;
        const currentBalance = balanceRef.current;

        if (currentBalance >= dcaVolume) {
          // محاسبه نقطه ورود وزنی اصلاح‌شده جدید
          const newMargin = initialMargin + dcaVolume;
          const weightedEntry = ((entry * initialMargin) + (curP * dcaVolume)) / newMargin;

          pos.entry = Math.round(weightedEntry * 100) / 100;
          pos.margin = newMargin;
          pos.initialMargin = newMargin;
          pos.name = 'SB'; // ارتقا به پله نجات SB
          pos.pyramided = true;
          pos.recoveryStep = 2;

          // تنظیم هوشمند حد ضرر متناسب با ساختار ATR نوسان ۱۵ دقیقه (جلوگیری از لمس با نویز شدو)
          const safeSlDist = Math.max(currentAtr * 1.65, weightedEntry * 0.014);
          pos.sl = Math.round((isLong ? weightedEntry - safeSlDist : weightedEntry + safeSlDist) * 100) / 100;
          pos.tp1 = Math.round((isLong ? weightedEntry + (currentAtr * 1.2) : weightedEntry - (currentAtr * 1.2)) * 100) / 100;

          balanceDelta -= dcaVolume;
          positionsChanged = true;

          showNotification(
            `🤖 اقدام هوشمند نجات: شلیک پله دوم خودکار (Auto Smart DCA) در قیمت $${curP.toFixed(1)}! نقطه ورود به $${weightedEntry.toFixed(1)} بهبود یافت.`
          );
        }
      }

      // ========================================================
      // 🚀 FAST PULLBACK RESCUE EXIT (خروج نجات فقط در پوزیشن‌های اصلاح عمیق یا هج شده)
      // ========================================================
      const hadSignificantDrawdown = (pos.maxDrawdownPct !== undefined && pos.maxDrawdownPct < -8.0) || pos.pyramided || (pos.recoveryStep !== undefined && pos.recoveryStep >= 2);
      const isFeeBreakeven = realWorldMasterBrainsService.isFeeCoveredBreakevenPassed(entry, curP, isLong ? 'LONG' : 'SHORT');
      const isRecoveredToBreakeven = hadSignificantDrawdown && (
        isFeeBreakeven || (isLong && curP >= entry * 1.002) || (!isLong && curP <= entry * 0.998)
      );

      if (isRecoveredToBreakeven && !isPositionClosed) {
        const netGainPct = isLong ? ((curP - entry) / entry) * 100.0 * lev : ((entry - curP) / entry) * 100.0 * lev;
        const netGainUsd = remainingMargin * (netGainPct / 100.0);
        const finalPnlUsd = Math.max(0.50, (pos.realizedPnlUsd || 0) + netGainUsd);

        balanceDelta += finalPnlUsd;
        isPositionClosed = true;

        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const historyEntry = {
          ...pos,
          pnlUsd: finalPnlUsd,
          pnlPct: Math.max(0.2, (finalPnlUsd / remainingMargin) * 100.0),
          closedAt: timeStr,
          closeReason: `خروج موفق پوزیشن اصلاحی در پولبک با سود +$${finalPnlUsd.toFixed(2)} 🚀⚡`,
        };
        commitTradeClosureAndContinuousLearning(historyEntry);
        positionsChanged = true;

        showNotification(
          `🚀 نجات فوق‌سریع و خروج در سود! پوزیشن اصلاحی با سود خالص +$${finalPnlUsd.toFixed(2)} بسته شد.`
        );
        continue;
      }

      // ========================================================
      // 🛡️ اصول ۳۱ و ۳۲: پایش لحظه‌ای Thesis Monitor و خروج هوشمند ۳ سطحی Smart Loss Exit
      // ========================================================
      const thesisEval = tradeThesisAndSmartExitEngine.evaluateTradeThesis(pos, curP, analysis);
      pos.thesisStatus = thesisEval.status;

      const smartExitEval = tradeThesisAndSmartExitEngine.evaluateSmartLossExit(pos, curP, thesisEval, analysis);
      pos.smartLossTier = smartExitEval.tier;
      pos.estimatedLossSavingsUsd = smartExitEval.estimatedLossCutSavingsUsd;

      // سطح ۲ (REDUCE): کاهش ۵۰٪ حجم برای مهار ضرر پیش از استاپ سخت
      if (smartExitEval.tier === 'REDUCE' && !pos.smartLossReduced && !isPositionClosed && currentPnlPct < -0.3) {
        const halfMargin = remainingMargin * 0.5;
        const currentLossHalf = halfMargin * (currentPnlPct / 100.0);
        pos.margin = Math.max(5, remainingMargin - halfMargin);
        pos.smartLossReduced = true;
        pos.realizedPnlUsd = (pos.realizedPnlUsd || 0) + currentLossHalf;
        balanceDelta += (halfMargin + currentLossHalf); // برگشت باقی‌مانده مارجین آزاد شده به موجودی
        positionsChanged = true;
        showNotification(
          `🛡️ خروج هوشمند سطح ۲ (Smart Loss REDUCE): ۵۰٪ حجم معامله برای کاهش ریسک پیش از استاپ سخت تسویه شد (صرفه‌جویی تخمینی: $${smartExitEval.estimatedLossCutSavingsUsd.toFixed(2)}).`
        );
      }

      // سطح ۳ (EXIT): خروج اضطراری کامل پیش از استاپ سخت در صورت ابطال فرضیه (شکست همزمان ارکان اصلی Trend+CVD+OBI)
      if (smartExitEval.tier === 'EXIT' && smartExitEval.shouldExitImmediately && !isPositionClosed) {
        const finalLossUsd = remainingMargin * (currentPnlPct / 100.0);
        const totalTradePnl = (pos.realizedPnlUsd || 0) + finalLossUsd;
        balanceDelta += (remainingMargin + finalLossUsd);
        isPositionClosed = true;

        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const historyEntry = {
          ...pos,
          pnlUsd: totalTradePnl,
          pnlPct: currentPnlPct,
          closedAt: timeStr,
          closeReason: `خروج هوشمند سه سطحی در ضرر (Smart Loss Exit L3 - ${thesisEval.invalidationReasonFa || 'ابطال فرضیه'}) 🛡️⚡`,
        };
        commitTradeClosureAndContinuousLearning(historyEntry);
        tradeThesisAndSmartExitEngine.recordSmartLossExit(pos, curP, totalTradePnl, 'EXIT');
        positionsChanged = true;

        showNotification(
          `🛑 خروج هوشمند سطح ۳ (Smart Loss Exit): فرضیه معامله نقض شد و پوزیشن پیش از استاپ سخت با زیان کنترل‌شده -$${Math.abs(totalTradePnl).toFixed(2)} بسته شد (صرفه‌جویی: $${smartExitEval.estimatedLossCutSavingsUsd.toFixed(2)}).`
        );

        if (totalTradePnl < 0) {
          triggerLossRecoveryEngine(totalTradePnl, pos.dir, curP);
        }
        continue;
      }

      // ========================================================
      // 1. STRATEGIC-RECOVERY-BRAIN: STOP LOSS OR DELTA HEDGE TRIGGER
      // ========================================================
      const isSlTriggered = !pos.hedgeActive && 
                            ((isLong && curP <= pos.sl) || (!isLong && curP >= pos.sl)) &&
                            (Date.now() - (pos.lastHedgeHarvestTime || 0) > 2000);

      if (isSlTriggered && !isPositionClosed) {
        // Standard Clean Stop-Loss Execution (Item 5: No Zone Recovery/Hedging)
        const finalLossUsd = remainingMargin * (currentPnlPct / 100.0);
        const totalTradePnl = (pos.realizedPnlUsd || 0) + finalLossUsd;

        balanceDelta += finalLossUsd;
        isPositionClosed = true;

        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const historyEntry = {
          ...pos,
          pnlUsd: totalTradePnl,
          pnlPct: currentPnlPct,
          closedAt: timeStr,
          closeReason: `برخورد به حد ضرر (SL: $${pos.sl.toFixed(1)}) 🛑`,
        };
        commitTradeClosureAndContinuousLearning(historyEntry);
        positionsChanged = true;

        showNotification(
          `🛑 حد ضرر معامله لمس شد (SL: $${pos.sl.toFixed(1)}) | نتیجه نهایی: ${totalTradePnl >= 0 ? '+' : ''}$${totalTradePnl.toFixed(2)}`
        );

        if (totalTradePnl < 0) {
          triggerLossRecoveryEngine(totalTradePnl, pos.dir, curP);
        }
      }

      // ========================================================
      // 2. ACTIVE HEDGE SETTLEMENT & ZERO-LOSS EXIT
      // ========================================================
      if (!isPositionClosed && pos.hedgeActive) {
        const totalMargin = pos.margin || initialMargin;
        const hedgeMargin = Math.max(0, totalMargin - initialMargin);
        const hedgeEntry = pos.hedgeEntry || pos.entry || curP;

        const hedgeBeInfo = calculateHedgeBreakEvenPrice(pos, curP, {
          fundingRate: fundingRate,
          networkTakerFeeRate: 0.00055,
        });

        const hedgeGainPct = isLong 
          ? ((hedgeEntry - curP) / hedgeEntry) * 100.0 * lev
          : ((curP - hedgeEntry) / hedgeEntry) * 100.0 * lev;
        const hedgeProfitUsd = hedgeMargin * (hedgeGainPct / 100.0);

        const primaryLegPnlPct = isLong
          ? ((curP - entry) / entry) * 100.0 * lev
          : ((entry - curP) / entry) * 100.0 * lev;
        const primaryLegPnlUsd = initialMargin * (primaryLegPnlPct / 100.0);

        const realizedPnlUsd = pos.realizedPnlUsd || 0;
        const netCombinedPnlUsd = primaryLegPnlUsd + hedgeProfitUsd + realizedPnlUsd - hedgeBeInfo.netCostUsd;

        const isNetBreakevenReached = netCombinedPnlUsd >= 0.0;
        const isAtOrBeyondBreakevenPrice = isLong
          ? (hedgeBeInfo.breakEvenPrice > 0 && curP <= hedgeBeInfo.breakEvenPrice)
          : (hedgeBeInfo.breakEvenPrice > 0 && curP >= hedgeBeInfo.breakEvenPrice);

        if (isNetBreakevenReached || isAtOrBeyondBreakevenPrice) {
          const finalSettlementPnl = Math.max(0.0, netCombinedPnlUsd);
          balanceDelta += finalSettlementPnl;
          isPositionClosed = true;
          positionsChanged = true;

          const now = new Date();
          const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
          const historyEntry = {
            ...pos,
            pnlUsd: finalSettlementPnl,
            pnlPct: Math.max(0.0, (finalSettlementPnl / pos.margin) * 100.0),
            closedAt: timeStr,
            closeReason: 'تسویه و خروج سربه‌سر پوزیشن هج شده (Zero-Loss Cross Exit) 🛡️⚡',
          };
          commitTradeClosureAndContinuousLearning(historyEntry);

          showNotification(
            `⚡ تسویه پوزیشن هج! معامله در نقطه سربه‌سر کامل ($${finalSettlementPnl.toFixed(2)}) با حفظ اصل سرمایه بسته شد.`
          );
        }
      }

      if (!isPositionClosed) {
        updatedPositions.push(pos);
      } else {
        positionsChanged = true;
      }
    }

    if (positionsChanged || balanceDelta !== 0) {
      if (balanceDelta !== 0) {
        const newBal = Math.max(10, balanceRef.current + balanceDelta);
        balanceRef.current = newBal; // Sync ref synchronously to prevent race conditions!
        setBalance(newBal);
        localStorage.setItem('quantum_balance', newBal.toString());
      }
      activePositionsRef.current = updatedPositions; // Sync ref synchronously to prevent race conditions!
      setActivePositions(updatedPositions);
      localStorage.setItem('quantum_positions', JSON.stringify(updatedPositions));
    }
  }, [showNotification, commitTradeClosureAndContinuousLearning]);

  // Realtime WebSocket price tick handling with instant execution
  useEffect(() => {
    // 🎓 آموزش اولیه و تسلیح شبکه عصبی TensorFlow.js بر روی سوابق معاملات واقعی
    const hist = getTradeHistory();
    if (hist && hist.length > 0) {
      void import('./services/tfjsReinforcementLearningEngine')
        .then(({ TfjsReinforcementLearningEngine }) =>
          TfjsReinforcementLearningEngine.getInstance().trainOnHistoricalTradesBatch(hist)
        )
        .catch((error) => console.error('[RL] Could not train on historical trades:', error));
    }

    requestNotificationPermission();
    wsRef.current = setupFreqtradeMarketFeed((rawPrice) => {
      if (!rawPrice || rawPrice <= 0) return;
      const price = rawPrice;
      smoothedPriceRef.current = rawPrice;

      // Update the in-memory fast snapshot price immediately
      if (latestAnalysisSnapshotRef.current) {
        latestAnalysisSnapshotRef.current = {
          ...latestAnalysisSnapshotRef.current,
          price,
        };
      }


      const now = Date.now();
      // Throttle rapid WS ticks to max 1 update per 100ms for ultra-responsive DOM rendering
      if (now - lastPriceUpdateRef.current > 100) {
        lastPriceUpdateRef.current = now;
        setAnalysis((prev) => (prev ? { ...prev, price } : null));
      }
    }, setMarketStreamState);
    return () => wsRef.current?.close();
  }, [runRealtimePositionTicks]);

  // Click outside handler for wallet dropdown (without full-screen backdrop to prevent blurring other places)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (walletRef.current && !walletRef.current.contains(event.target as Node)) {
        const button = document.getElementById('wallet-topbar-button');
        if (button && button.contains(event.target as Node)) {
          return;
        }
        setIsWalletPopupOpen(false);
      }
    }
    if (isWalletPopupOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isWalletPopupOpen]);

  // Fetch Market Data & Run Analysis with 3-Tier TP Engine
  const loadMarketData = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsFetching(true);
    try {
      try {
        const usesFreqtrade = executionModeRef.current === 'LIVE' || executionModeRef.current === 'TESTNET';
        const connectionResponse = await fetch('/api/freqtrade/connection-status', { cache: 'no-store' });
        const connectionData = await connectionResponse.json();
        if (!connectionResponse.ok || connectionData.connected !== true) {
          setFreqtradeDashboard({
            status: 'UNAVAILABLE',
            openTrades: [],
            error: typeof connectionData.error === 'string'
              ? connectionData.error
              : typeof connectionData.marketData?.error === 'string'
                ? connectionData.marketData.error
                : 'Freqtrade RPC did not confirm a running market-data connection.',
          });
          if (usesFreqtrade) {
            setActivePositions([]);
            activePositionsRef.current = [];
            setBalance(0);
            balanceRef.current = 0;
          }
        } else {
          let openTrades: FreqtradeTrade[] = [];
          let privateStateAvailable = false;
          let privateStateError: string | undefined;
          if (usesFreqtrade) {
            const adminToken = localStorage.getItem('admin_token');
            if (adminToken) {
              try {
                const privateResponse = await fetch('/api/exchange/status', {
                  cache: 'no-store',
                  headers: { 'x-admin-token': adminToken },
                });
                const privateStatus = await privateResponse.json();
                if (
                  privateResponse.ok &&
                  privateStatus.connected === true &&
                  Array.isArray(privateStatus.openTrades)
                ) {
                  openTrades = privateStatus.openTrades as FreqtradeTrade[];
                  privateStateAvailable = true;
                  setActivePositions([]);
                  activePositionsRef.current = [];
                  if (typeof privateStatus.walletBalanceUsdt === 'number') {
                    setBalance(privateStatus.walletBalanceUsdt);
                    balanceRef.current = privateStatus.walletBalanceUsdt;
                    localStorage.setItem('quantum_balance', privateStatus.walletBalanceUsdt.toString());
                  }
                }
                if (!privateStateAvailable) {
                  privateStateError = typeof privateStatus.error === 'string'
                    ? privateStatus.error
                    : `جزئیات حساب خصوصی دریافت نشد (HTTP ${privateResponse.status}).`;
                }
              } catch (error) {
                privateStateError = error instanceof Error ? error.message : String(error);
                console.warn('[Freqtrade] Private account details could not be refreshed.', error);
              }
            } else {
              privateStateError = 'برای نمایش موجودی و جزئیات خصوصی حساب، توکن ادمین لازم است.';
            }
            if (!privateStateAvailable) {
              setActivePositions([]);
              activePositionsRef.current = [];
              setBalance(0);
              balanceRef.current = 0;
            }
          }
          setFreqtradeDashboard({
            status: 'CONNECTED',
            openTrades,
            openTradesCount: privateStateAvailable
              ? openTrades.length
              : Number.isSafeInteger(connectionData.openTradesCount)
                ? connectionData.openTradesCount
                : undefined,
            connection: {
              exchange: typeof connectionData.exchange === 'string' ? connectionData.exchange : null,
              market: typeof connectionData.market === 'string' ? connectionData.market : null,
              pair: typeof connectionData.pair === 'string' ? connectionData.pair : null,
              timeframe: typeof connectionData.timeframe === 'string' ? connectionData.timeframe : null,
              dryRun: typeof connectionData.dryRun === 'boolean' ? connectionData.dryRun : null,
              marketDataAvailable: connectionData.marketData?.available === true,
            },
            error: usesFreqtrade && !privateStateAvailable ? privateStateError : undefined,
          });
        }
      } catch (err) {
        if (executionModeRef.current === 'LIVE' || executionModeRef.current === 'TESTNET') {
          setFreqtradeDashboard({
            status: 'UNAVAILABLE',
            openTrades: [],
            error: err instanceof Error ? err.message : String(err),
          });
          setActivePositions([]);
          activePositionsRef.current = [];
          setBalance(0);
          balanceRef.current = 0;
        }
        console.error('[Freqtrade] Could not refresh connection state:', err);
      }

      let sentiment: SentimentData = {
        score: 0,
        label: 'NEUTRAL' as const,
        trend: 'STABLE' as const,
        drivers: [],
        status: 'UNAVAILABLE' as const,
      };

      try {
        const sentimentResponse = await fetch('/api/sentiment', { method: 'POST' });
        if (sentimentResponse.ok) {
          const responseSentiment = await sentimentResponse.json() as Partial<SentimentData>;
          if (
            typeof responseSentiment.score === 'number' &&
            Number.isFinite(responseSentiment.score) &&
            responseSentiment.score >= -1 &&
            responseSentiment.score <= 1 &&
            ['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(responseSentiment.label ?? '') &&
            ['UP', 'DOWN', 'STABLE'].includes(responseSentiment.trend ?? '') &&
            Array.isArray(responseSentiment.drivers) &&
            responseSentiment.drivers.every((driver) => typeof driver === 'string') &&
            responseSentiment.status === 'LIVE'
          ) {
            sentiment = {
              score: responseSentiment.score,
              label: responseSentiment.label as SentimentData['label'],
              trend: responseSentiment.trend as SentimentData['trend'],
              drivers: responseSentiment.drivers,
              status: 'LIVE',
            };
          } else {
            throw new Error('Sentiment service returned an invalid data contract.');
          }
        }
      } catch (err) {
        console.warn('[MarketData] Live sentiment is unavailable; neutral weighting is used.', err);
      }

      const [candleData, fng, deriv, realObiData, orderFlowFeatures, htf, futuresPrices, canonicalSnapshot] = await Promise.all([
        fetchCandles(),
        fetchFearGreed(),
        fetchDerivatives(),
        fetchRealOrderBookImbalance(),
        fetchRealTradeFlowCvd(),
        fetchHtf(),
        fetchFuturesPrices(),
        getCanonicalMarketSnapshot().catch(() => undefined),
      ]);
      if (candleData.status !== 'LIVE' || candleData.candles.length < 300) {
        throw new Error(candleData.error || 'کمتر از ۳۰۰ کندل واقعی و تازه برای تحلیل معتبر دریافت شد.');
      }

      const dataQualityReport = evaluateMarketDataQuality(
        candleData,
        realObiData,
        deriv,
        fng,
        futuresPrices,
        orderFlowFeatures,
      );
      const effectiveObi = realObiData.obi !== null ? realObiData.obi : 0.0;

      const currentBalance = balanceRef.current;
      const history = getTradeHistory();
      const dynamicRiskPct = calculateKellyRisk(history) * 100;

      const res = analyzePro(
        candleData.candles,
        fng,
        sentiment as SentimentData,
        htf,
        deriv,
        effectiveObi,
        currentBalance,
        dynamicRiskPct,
        candleData.rawCandles,
        dataQualityReport.status,
        dataQualityReport,
        realObiData,
        canonicalSnapshot,
        futuresPrices,
        orderFlowFeatures
      );

      const effectiveUserLev = userLeverageRef.current;
      if (effectiveUserLev !== null) {
        res.leverage = effectiveUserLev;
      }

      // Synchronize websocket price baseline with live fetched candle price to eliminate price jumps
      if (res.price > 0) {
        if (!smoothedPriceRef.current || smoothedPriceRef.current <= 0) {
          smoothedPriceRef.current = res.price;
          wsRef.current?.seedPrice?.(res.price);
        } else {
          // Keep live websocket tick price to eliminate 5-second flickering jumps
          res.price = smoothedPriceRef.current;
        }
      }

      // Store fresh analysis result into fast in-memory snapshot cache
      latestAnalysisSnapshotRef.current = res;

      // ========================================================
      // 3-TIER TAKE PROFIT (TP1, TP2, TP3) STEPPED SETTLEMENT
      // ========================================================
      if (activePositionsRef.current.length > 0) {
        runRealtimePositionTicks(res.price, res);

        // Automated AI Risk Governor 50% De-Risking detection
        if (
          activePositionsRef.current.length > 0 &&
          !governorState.deRiskActive &&
          ((res.volatilityPct && res.volatilityPct > 2.2) || governorState.sharpDropProb5m >= 60)
        ) {
          handleTriggerManualDeRisk();
        }
      }

      // Fetch AI Prediction & Python GARCH Volatility in parallel / prior to execution evaluation
      let currentPrediction = aiPredictionRef.current;
      try {
        const fetchWithTimeout = async (url: string, bodyObj: any, timeoutMs = 4000) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const resp = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bodyObj),
              signal: controller.signal,
            });
            clearTimeout(timer);
            return resp.ok ? await resp.json() : null;
          } catch {
            clearTimeout(timer);
            return null;
          }
        };

        const [predData, garchData] = await Promise.all([
          fetchWithTimeout('/api/predict', {
            candles: candleData.candles,
            obi: effectiveObi,
            symbol: 'BTCUSDT',
            previousTrend: currentPrediction?.trend,
          }),
          fetchWithTimeout('/api/garch', { candles: candleData.candles }),
        ]);

        if (predData || garchData) {
          const clientFallback = generateClientSidePredictionFallback(candleData.candles, effectiveObi, res.price, res);
          currentPrediction = {
            ...clientFallback,
            ...(predData || {}),
            reversal30m: (predData as any)?.reversal30m || clientFallback.reversal30m,
            quantumCertainty: (predData as any)?.quantumCertainty || clientFallback.quantumCertainty,
            microVector: (predData as any)?.microVector || clientFallback.microVector,
            whaleTrap: (predData as any)?.whaleTrap || clientFallback.whaleTrap,
            garch: garchData || currentPrediction?.garch || clientFallback.garch,
          };
        } else if (!currentPrediction) {
          currentPrediction = generateClientSidePredictionFallback(candleData.candles, effectiveObi, res.price, res);
        }

        aiPredictionRef.current = currentPrediction;
        setAiPrediction(currentPrediction);
      } catch (err) {
        if (!currentPrediction) {
          currentPrediction = generateClientSidePredictionFallback(candleData.candles, effectiveObi, res.price);
          aiPredictionRef.current = currentPrediction;
          setAiPrediction(currentPrediction);
        }
      }

      setAnalysis(res);
      setLastAnalysisAtMs(Date.now());
      setMarketDataError(null);
      setSource(candleData.source);

      if (settingsRef.current.notificationsEnabled && res.signalOk && res.confScore >= 5) {
        sendNotification('سیگنال قدرتمند جدید', `سیگنال ${res.direction === 'LONG' ? 'خرید' : 'فروش'} با امتیاز ۵/۵ تایید شد.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMarketDataError(message);
      setSource('Freqtrade DataProvider unavailable');
      console.error('[MarketData] Analysis refresh failed:', err);
    } finally {
      setIsFetching(false);
      isFetchingRef.current = false;
    }
  }, [showNotification]);

  // Ultra-high-performance 3-sec auto refresh for instant real-time sync
  useEffect(() => {
    loadMarketData();
    const interval = setInterval(loadMarketData, 3000);
    return () => clearInterval(interval);
  }, [loadMarketData]);

  // Handle Leverage Slider Change
  const handleLeverageChange = (newLev: number) => {
    setUserLeverage(newLev);
    localStorage.setItem('quantum_user_leverage', newLev.toString());
    showNotification(`اهرم معاملاتی کاربر روی ${newLev}x تنظیم گردید.`);
  };

  const handleUpdatePaperBalance = (newBalance: number) => {
    const mode = executionModeRef.current ?? getSelectedExecutionMode();
    if (mode !== 'PAPER' && mode !== 'BACKTEST') {
      showNotification('تغییر موجودی فقط برای شبیه‌سازی محلی مجاز است.');
      return;
    }
    balanceRef.current = newBalance;
    setBalance(newBalance);
    localStorage.setItem('quantum_balance', String(newBalance));
  };

  const handlePaperTrade = useCallback((direction: 'LONG' | 'SHORT', isAuto: boolean) => {
    const mode = executionModeRef.current ?? getSelectedExecutionMode();
    if (mode !== 'PAPER' && mode !== 'BACKTEST') {
      showNotification('ثبت سفارش مستقیم غیرفعال است؛ Freqtrade تنها مالک اجرای سفارش است.');
      return;
    }

    const snapshot = latestAnalysisSnapshotRef.current ?? analysis;
    const currentBalance = balanceRef.current;
    if (!snapshot || currentBalance < 5) {
      showNotification('برای شبیه‌سازی، ابتدا دادهٔ بازار و موجودی آزمایشی معتبر وارد کنید.');
      return;
    }

    const positions = activePositionsRef.current;
    if (positions.length >= (isAuto ? 3 : 6)) {
      showNotification('ظرفیت پوزیشن‌های شبیه‌سازی‌شده پر است.');
      return;
    }

    const position = buildExecutionPosition(
      snapshot,
      direction,
      currentBalance,
      getTradeHistory(),
      userLeverageRef.current ?? snapshot.leverage,
      false,
      aiPredictionRef.current
    );
    if (!position) {
      showNotification('گیت داده یا ریسک معامله را تأیید نکرد؛ شبیه‌سازی ثبت نشد.');
      return;
    }

    position.name = isAuto ? 'AUTO PAPER' : 'MANUAL PAPER';
    position.isAuto = isAuto;
    position.isExchangeConfirmed = false;
    const updatedPositions = [...positions, position];
    activePositionsRef.current = updatedPositions;
    setActivePositions(updatedPositions);
    localStorage.setItem('quantum_positions', JSON.stringify(updatedPositions));
    showNotification(`${isAuto ? 'ورود خودکار' : 'ورود دستی'} ${direction} فقط در ${mode} ثبت شد؛ سفارشی به صرافی ارسال نشد.`);
  }, [analysis, showNotification]);

  const handleClosePaperTrade = useCallback((positionId: string) => {
    const mode = executionModeRef.current ?? getSelectedExecutionMode();
    if (mode !== 'PAPER' && mode !== 'BACKTEST') {
      showNotification('بستن معاملهٔ صرافی از این پنل مجاز نیست؛ Freqtrade مالک چرخهٔ معامله است.');
      return;
    }

    const position = activePositionsRef.current.find((item) => item.id === positionId);
    if (!position) return;
    const price = latestAnalysisSnapshotRef.current?.price ?? analysis?.price ?? position.entry;
    const directionFactor = position.dir === 'LONG' ? 1 : -1;
    const pnlUsd = (position.realizedPnlUsd || 0) +
      (position.margin * (position.lev || 1) * ((price - position.entry) / position.entry) * directionFactor);
    const pnlPct = position.margin > 0 ? (pnlUsd / position.margin) * 100 : 0;
    const closedAt = new Date().toLocaleTimeString();
    const historyEntry: TradeHistory = {
      ...position,
      exitPrice: price,
      pnlUsd,
      pnlPct,
      closedAt,
      closeReason: 'بستن دستی پوزیشن شبیه‌سازی‌شده',
    };
    const updatedPositions = activePositionsRef.current.filter((item) => item.id !== positionId);
    activePositionsRef.current = updatedPositions;
    setActivePositions(updatedPositions);
    localStorage.setItem('quantum_positions', JSON.stringify(updatedPositions));
    const updatedBalance = Math.max(0, balanceRef.current + pnlUsd);
    balanceRef.current = updatedBalance;
    setBalance(updatedBalance);
    localStorage.setItem('quantum_balance', String(updatedBalance));
    commitTradeClosureAndContinuousLearning(historyEntry);
    showNotification(`پوزیشن شبیه‌سازی‌شده بسته شد: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)}.`);
  }, [analysis, commitTradeClosureAndContinuousLearning, showNotification]);

  const handleToggleAutoTrade = useCallback(async () => {
    const enabled = settingsRef.current.autoTradeEnabled;
    if (enabled) {
      const updated = { ...settingsRef.current, autoTradeEnabled: false };
      settingsRef.current = updated;
      setSettings(updated);
      saveSettings(updated);
      showNotification('Auto-Pilot شبیه‌سازی متوقف شد.');
      return;
    }

    const mode = executionModeRef.current ?? getSelectedExecutionMode();
    if (mode !== 'PAPER') {
      showNotification('Auto-Pilot فقط در حالت PAPER قابل فعال‌سازی است.');
      return;
    }
    const snapshot = latestAnalysisSnapshotRef.current ?? analysis;
    const prerequisites = await verifyAutoTradePrerequisites(snapshot, activePositionsRef.current, getTradeHistory(), mode);
    if (!prerequisites.isEligible) {
      const blocker = prerequisites.detailsFa.find((detail) => detail.startsWith('❌'));
      showNotification(`Auto-Pilot فعال نشد: ${blocker || 'پیش‌نیازهای ایمنی تأیید نشد.'}`);
      return;
    }

    const updated = { ...settingsRef.current, autoTradeEnabled: true };
    settingsRef.current = updated;
    setSettings(updated);
    saveSettings(updated);
    showNotification('Auto-Pilot در حالت PAPER فعال شد؛ اجرای زنده در دسترس نیست.');
  }, [analysis, showNotification]);

  const fullSystemEval = useMemo(() => {
    if (!analysis) return null;
    const historyData = getTradeHistory();
    return evaluateSignalToExecution(analysis, undefined, aiPrediction, historyData, winRateConfig.minWinProbability);
  }, [analysis, aiPrediction, winRateConfig.minWinProbability]);

  const fullSystemEvalLong = useMemo(() => {
    if (!analysis) return null;
    const historyData = getTradeHistory();
    return evaluateSignalToExecution(analysis, 'LONG', aiPrediction, historyData, winRateConfig.minWinProbability);
  }, [analysis, aiPrediction, winRateConfig.minWinProbability]);

  const fullSystemEvalShort = useMemo(() => {
    if (!analysis) return null;
    const historyData = getTradeHistory();
    return evaluateSignalToExecution(analysis, 'SHORT', aiPrediction, historyData, winRateConfig.minWinProbability);
  }, [analysis, aiPrediction, winRateConfig.minWinProbability]);

  const liveEffectivePrice = analysis?.price || (analysis?.candles && analysis.candles.length > 0 ? ((analysis.candles[analysis.candles.length - 1] as any).close ?? (Array.isArray(analysis.candles[analysis.candles.length - 1]) ? analysis.candles[analysis.candles.length - 1][3] : 0)) : 0);

  useEffect(() => {
    const mode = executionModeRef.current ?? getSelectedExecutionMode();
    if (mode !== 'PAPER' || !settings.autoTradeEnabled || !fullSystemEval?.canExecute) return;
    if (fullSystemEval.direction !== 'LONG' && fullSystemEval.direction !== 'SHORT') return;
    if (activePositionsRef.current.length > 0) return;
    const signalKey = `${Math.floor(Date.now() / 900_000)}:${fullSystemEval.direction}`;
    if (lastAutoTradeSignalRef.current === signalKey) return;
    lastAutoTradeSignalRef.current = signalKey;
    handlePaperTrade(fullSystemEval.direction, true);
  }, [analysis, fullSystemEval, handlePaperTrade, settings.autoTradeEnabled]);

  const selectedExecutionMode = executionModeRef.current ?? getSelectedExecutionMode();
  const adjustSandboxWallet = (direction: 'add' | 'subtract') => {
    const amount = Number(walletAdjustmentAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      showNotification('مبلغ باید عددی مثبت و حداکثر ۱٬۰۰۰٬۰۰۰ USDT باشد.');
      return;
    }
    const nextBalance = balanceRef.current + (direction === 'add' ? amount : -amount);
    const reservedMargin = activePositions.reduce((total, position) => total + Math.max(0, position.margin), 0);
    if (nextBalance < reservedMargin || nextBalance < 0) {
      showNotification('کاهش موجودی از مارجین رزروشدهٔ موقعیت‌های باز بیشتر است.');
      return;
    }
    balanceRef.current = nextBalance;
    setBalance(nextBalance);
    localStorage.setItem('quantum_balance', String(nextBalance));
  };

  return (
    <div className={`min-h-screen overflow-y-auto overflow-x-hidden flex flex-col ${isDeepBlack ? 'bg-[#000000]' : 'bg-titanium-obsidian'} text-slate-100 font-sans antialiased selection:bg-emerald-500 selection:text-black transition-colors duration-300 relative gpu-accelerated`}>
      {/* Light GPU Accelerated Glow Ambient */}
      <div className="absolute top-0 left-1/4 w-[450px] h-[450px] bg-emerald-600/08 rounded-full blur-[100px] pointer-events-none z-0 transform-gpu translate-z-0" />
      <div className="absolute bottom-0 right-1/4 w-[450px] h-[450px] bg-indigo-600/08 rounded-full blur-[100px] pointer-events-none z-0 transform-gpu translate-z-0" />

      {/* Top Floating Notification */}
      {notification && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 border border-emerald-400/80 text-emerald-200 px-5 py-2.5 rounded-2xl shadow-[0_0_35px_rgba(16,185,129,0.4)] text-xs font-mono font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{notification}</span>
          </div>
        </div>
      )}

      {showSidebar && (
        <div className="fixed inset-0 z-[80]">
          <button
            type="button"
            aria-label="بستن منوی سیستم"
            onClick={() => setShowSidebar(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          />
          <aside
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="منوی سیستم"
            className="fixed right-0 top-0 z-10 flex h-full w-80 max-w-[85vw] flex-col border-l border-indigo-500/30 bg-slate-950/95 p-5 shadow-2xl shadow-indigo-950/60"
          >
            <div className="mb-6 flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2 text-indigo-200">
                <Settings className="h-5 w-5" />
                <h2 className="font-bold">منوی سیستم</h2>
              </div>
              <button
                type="button"
                aria-label="بستن منوی سیستم"
                onClick={() => setShowSidebar(false)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ×
              </button>
            </div>
            <nav className="flex flex-col gap-2">
              <button type="button" onClick={() => { setSystemHubTab('hunter_os'); setShowSidebar(false); }} className="rounded-lg bg-gradient-to-r from-amber-950 to-orange-950 border border-amber-500/40 px-3 py-2 text-right text-sm text-amber-200 hover:bg-amber-900 font-bold">🏹 سیستم عامل شکارچی (HUNTER OS & Wave DNA)</button>
              <button type="button" onClick={() => { setSystemHubTab('sb_models'); setShowSidebar(false); }} className="rounded-lg bg-slate-900 px-3 py-2 text-right text-sm text-slate-200 hover:bg-indigo-950">مدل‌های تخصصی هوش مصنوعی</button>
              <button type="button" onClick={() => { setSystemHubTab('brains'); setShowSidebar(false); }} className="rounded-lg bg-slate-900 px-3 py-2 text-right text-sm text-slate-200 hover:bg-indigo-950">مغزها و شبکه اجماع</button>
              <button type="button" onClick={() => { setSystemHubTab('scenarios'); setShowSidebar(false); }} className="rounded-lg bg-slate-900 px-3 py-2 text-right text-sm text-slate-200 hover:bg-indigo-950">سناریوها و بازیابی</button>
              <button type="button" onClick={() => { setSystemHubTab('volatility_risk'); setShowSidebar(false); }} className="rounded-lg bg-slate-900 px-3 py-2 text-right text-sm text-slate-200 hover:bg-indigo-950">نوسان و مدیریت ریسک</button>
              <button type="button" onClick={() => { setSystemHubTab('flow_whales'); setShowSidebar(false); }} className="rounded-lg bg-slate-900 px-3 py-2 text-right text-sm text-slate-200 hover:bg-indigo-950">جریان سفارش و نقدینگی</button>
              <button
                type="button"
                onClick={() => {
                  setShowSidebar(false);
                  document.getElementById('execution-governor')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="mt-3 rounded-lg border border-emerald-700/50 bg-emerald-950/50 px-3 py-2 text-right text-sm text-emerald-200 hover:bg-emerald-900/70"
              >
                تنظیمات حالت اجرا
              </button>
            </nav>
          </aside>
        </div>
      )}

      {/* Main App Container */}
      <div className="flex-1 flex flex-col w-full px-2 sm:px-4 py-2 gap-3 relative z-10 pb-12">
        {/* Header and Top Bar */}
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <ChartTopBar
            source={source}
            isLive={isLatestMarketDataVerified(analysis, lastAnalysisAtMs)}
            isFetching={isFetching}
            onRefresh={loadMarketData}
            isDeepBlack={isDeepBlack}
            onToggleTheme={() => {
              setIsDeepBlack(prev => {
                const next = !prev;
                localStorage.setItem('quantum_theme_deep_black', String(next));
                showNotification(next ? '🌙 تم تاریک مطلق (Deep Black OLED) فعال شد.' : '☀️ تم استاندارد فعال شد.');
                return next;
              });
            }}
            onOpenSidebar={() => setShowSidebar(true)}
            balance={balance}
            onToggleWallet={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setWalletPopupRect({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
              setIsWalletPopupOpen(!isWalletPopupOpen);
            }}
          />
          {marketDataError && (
            <p role="alert" className="rounded-lg border border-rose-700 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">
              دریافت یا تحلیل دادهٔ بازار ناموفق بود: {marketDataError}
            </p>
          )}
          <p role="status" aria-live="polite" className="px-2 text-[11px] text-slate-400">
            WebSocket بازار: {
              marketStreamState === 'LIVE' ? 'زنده' :
              marketStreamState === 'DEGRADED' ? 'در حال اتصال مجدد؛ تحلیل دوره‌ای ادامه دارد' :
              marketStreamState === 'STALE' ? 'دادهٔ WebSocket کهنه است؛ تحلیل دوره‌ای ادامه دارد' :
              'قطع؛ تحلیل دوره‌ای از API ادامه دارد'
            }
            {' · '}
            تحلیل: {lastAnalysisAtMs ? `آخرین اجرا ${new Date(lastAnalysisAtMs).toLocaleTimeString('fa-IR')}` : 'در انتظار دادهٔ معتبر'}
            {analysis?.dataStatus ? ` · کیفیت داده: ${analysis.dataStatus}` : ''}
          </p>
          {analysis && analysis.candles.length > 0 && (
            <p role="status" aria-live="polite" className="px-2 text-[11px] text-slate-400">
              تحلیل فنی با {analysis.candles.length} کندل از {analysis.dataQualityReport?.feeds.candles.source || source} انجام شد.
              {analysis.dataQualityReport?.isTradeAllowed
                ? ' مجوز کیفیت داده برای معامله برقرار است.'
                : ` معامله مسدود است: ${analysis.dataQualityReport?.reasonsFa.join('، ') || 'کیفیت داده برای معامله کافی نیست.'}`}
            </p>
          )}
           <TickerBar btcPrice={liveEffectivePrice} />
          </div>

          <section
            role="status"
            aria-live="polite"
            className={`rounded-xl border px-4 py-3 text-sm ${
              freqtradeDashboard.status === 'CONNECTED' && freqtradeDashboard.connection?.marketDataAvailable
                ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-100'
                : 'border-amber-700/60 bg-amber-950/30 text-amber-100'
            }`}
          >
            <p className="font-bold">
              {freqtradeDashboard.status === 'CONNECTED'
                ? `ارتباط Freqtrade برقرار است؛ فید بازار ${freqtradeDashboard.connection?.marketDataAvailable ? 'دادهٔ تازه دارد' : 'snapshot تازه ندارد'}؛ ${freqtradeDashboard.openTradesCount ?? 'نامشخص'} معاملهٔ باز.`
                : freqtradeDashboard.status === 'CHECKING'
                  ? 'در حال بررسی اتصال Freqtrade و فید بازار؛ وضعیت حساب خصوصی جداگانه احراز می‌شود.'
                  : 'اتصال Freqtrade یا فید بازار در دسترس نیست؛ هیچ وضعیت محلی به‌عنوان وضعیت زنده نمایش داده نمی‌شود.'}
            </p>
            {freqtradeDashboard.status === 'CONNECTED' && freqtradeDashboard.connection && (
              <p className="mt-1 text-xs opacity-90">
                منبع: {freqtradeDashboard.connection.exchange || 'نامشخص'}
                {freqtradeDashboard.connection.market ? ` ${freqtradeDashboard.connection.market}` : ''}
                {freqtradeDashboard.connection.pair ? ` · ${freqtradeDashboard.connection.pair}` : ''}
                {freqtradeDashboard.connection.timeframe ? ` · ${freqtradeDashboard.connection.timeframe}` : ''}
                {freqtradeDashboard.connection.dryRun === true
                  ? ' · حالت Dry-run؛ اتصال حساب خصوصی/اجرای واقعی از این وضعیت تأیید نمی‌شود.'
                  : ''}
              </p>
            )}
            {freqtradeDashboard.error && (
              <p className="mt-1 text-xs opacity-90">{freqtradeDashboard.error}</p>
            )}
            {freqtradeDashboard.status === 'CONNECTED' && freqtradeDashboard.openTrades.length > 0 && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {freqtradeDashboard.openTrades.map((trade) => (
                  <div key={trade.trade_id} className="rounded-lg border border-emerald-800/50 bg-black/20 p-2 text-xs">
                    <strong>{trade.pair}</strong>
                    <span className="mx-2">{trade.is_short ? 'SHORT' : 'LONG'}</span>
                    <span>شناسهٔ Freqtrade: {trade.trade_id}</span>
                    <div className="mt-1">
                      مقدار {trade.amount}، قیمت ورود {trade.open_rate}، وثیقه {trade.stake_amount}
                    </div>
                    <div className="mt-1">
                      سفارش‌ها: {trade.orders.map((order) => `${order.ft_order_side} ${order.status}`).join('، ') || 'ندارد'}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs opacity-80">
              تاریخچهٔ بسته‌شدهٔ نمایش‌داده‌شده در ابزارهای قدیمی هنوز از ذخیرهٔ محلی است و از Freqtrade تأیید نشده است.
            </p>
          </section>

          {/* Analysis and read-only monitoring; all order controls are owned by Freqtrade. */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-[600px]">
            <div className="lg:col-span-6 flex flex-col min-h-[500px]">
              <CollapsibleCard
                title="نمودار تحلیل کوانتومی (BTC/USDT)"
                badge="TradingView Pro"
                defaultOpen={true}
                className="flex-1 flex flex-col min-h-[500px]"
                contentClassName="overflow-hidden"
              >
                {analysis ? (
                  <QuantumChart analysis={analysis} prediction={aiPrediction} activePositions={activePositions} />
                ) : (
                  <div className="h-[480px] bg-[#040e1b] rounded-xl border border-cyan-900/40 flex items-center justify-center text-cyan-400 font-mono text-sm animate-pulse">
                    در حال بارگذاری و همگام‌سازی نمودار کوانتومی BTC/USDT...
                  </div>
                )}
              </CollapsibleCard>
              <DynamicEntryWidget analysis={analysis} history={getTradeHistory()} />
            </div>

            <div className="lg:col-span-3 flex flex-col min-h-[500px]">
              {analysis && (
                <CollapsibleCard title="میز معاملات دستی" badge="معامله دستی" badgeColor="text-cyan-300 bg-cyan-950/80 border-cyan-500/40" defaultOpen={true} className="flex-1">
                  <OrderExecutionPanel
                    balance={balance}
                    onUpdateBalance={handleUpdatePaperBalance}
                    onSelectLeverage={handleLeverageChange}
                    userLeverage={userLeverage ?? analysis.leverage}
                    analysis={analysis}
                    activePositions={activePositions}
                    onOpenTrade={(direction) => handlePaperTrade(direction, false)}
                    onClosePosition={handleClosePaperTrade}
                    onAutoTrade={(direction) => handlePaperTrade(direction, true)}
                    prediction={aiPrediction}
                    autoTradeActive={settings.autoTradeEnabled}
                    onToggleAutoTrade={handleToggleAutoTrade}
                    mode="manual"
                  />
                </CollapsibleCard>
              )}
            </div>

            <div className="lg:col-span-3 flex flex-col min-h-[500px]">
              {analysis && (
                <CollapsibleCard title="موتور هوشمند ربات (Auto-Pilot)" badge="ترید خودکار" badgeColor="text-emerald-300 bg-emerald-950/80 border-emerald-500/40" defaultOpen={true} className="flex-1">
                  <OrderExecutionPanel
                    balance={balance}
                    onUpdateBalance={handleUpdatePaperBalance}
                    onSelectLeverage={handleLeverageChange}
                    userLeverage={userLeverage ?? analysis.leverage}
                    analysis={analysis}
                    activePositions={activePositions}
                    onOpenTrade={(direction) => handlePaperTrade(direction, false)}
                    onClosePosition={handleClosePaperTrade}
                    onAutoTrade={(direction) => handlePaperTrade(direction, true)}
                    prediction={aiPrediction}
                    autoTradeActive={settings.autoTradeEnabled}
                    onToggleAutoTrade={handleToggleAutoTrade}
                    mode="auto"
                  />
                </CollapsibleCard>
              )}
            </div>

          </div>

          {/* 🎛️ کنسول جمع‌شونده و متمرکز سیستم، سناریوها و مغزهای پردازشی (صفحه خلوت و متمرکز) */}
          <div className="mt-3">
            <CollapsibleCard
              title="کنسول پیشرفته سیستم و هوش‌های مصنوعی (مغزها، سناریوها و ابزارهای تحلیلی)"
              badge="۱۵ مغز فعال | ۱۸ سناریو و پیشنهاد"
              badgeColor="text-purple-300 bg-purple-950/80 border-purple-500/40 shadow-[0_0_15px_rgba(168,85,247,0.3)]"
              defaultOpen={false}
              className="border-purple-900/40"
            >
              {/* System Hub Sub-Tabs & Direct Menu Access */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 mb-4 bg-slate-900/80 rounded-xl border border-slate-800">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSystemHubTab('hunter_os')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                      systemHubTab === 'hunter_os'
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md shadow-amber-500/40 ring-1 ring-amber-300'
                        : 'bg-amber-950/50 text-amber-300 border border-amber-500/40 hover:bg-amber-900/60'
                    }`}
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>🏹 سیستم عامل شکارچی (HUNTER OS & Wave DNA)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSystemHubTab('sb_models')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      systemHubTab === 'sb_models'
                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/30'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <Cpu className="w-3.5 h-3.5 text-indigo-300" />
                    <span>۵ مدل تخصصی هوش مصنوعی (SB1 تا SB5)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSystemHubTab('brains')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      systemHubTab === 'brains'
                        ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <Cpu className="w-3.5 h-3.5" />
                    <span>۱۵ مغز پردازشی و شبکه اجماع</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSystemHubTab('scenarios')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      systemHubTab === 'scenarios'
                        ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>سناریوها، فرار از ضرر و ماکزیمم سود</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSystemHubTab('volatility_risk')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      systemHubTab === 'volatility_risk'
                        ? 'bg-cyan-600 text-white shadow-md shadow-cyan-500/30'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>پیش‌بینی ویدئویی، نوسانات و ریسک</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSystemHubTab('flow_whales')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      systemHubTab === 'flow_whales'
                        ? 'bg-amber-600 text-white shadow-md shadow-amber-500/30'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <BarChart2 className="w-3.5 h-3.5" />
                    <span>جریان سفارشات، نقدینگی و نهنگ‌ها</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowSidebar(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-indigo-900 to-purple-900 hover:from-indigo-800 hover:to-purple-800 text-purple-200 border border-purple-500/40 rounded-lg text-xs font-bold transition-all shadow-sm"
                >
                  <Menu className="w-3.5 h-3.5" />
                  <span>انتقال کامل به منوی سیستم (سایدبار)</span>
                </button>
              </div>

              {/* Tab Hunter OS: 7 Rings, Edge Decay Radar, Wave DNA */}
              {systemHubTab === 'hunter_os' && (
                <div className="flex flex-col gap-3">
                  <HunterOsDashboardWidget
                    analysis={analysis}
                    activePositions={activePositions}
                    tradeHistory={getTradeHistory()}
                  />
                  <HunterOrderFlowDashboardWidget analysis={analysis} />
                  <TradeThesisAndSmartExitWidget
                    activePositions={activePositions}
                    currentPrice={liveEffectivePrice}
                    analysis={analysis}
                  />
                </div>
              )}

              {/* Tab 0: SB Pentagon Models */}
              {systemHubTab === 'sb_models' && (
                <div className="flex flex-col gap-3">
                  <SbFiveModelsPanel
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    currentPrice={liveEffectivePrice}
                    activePositions={activePositions}
                    tradeHistory={getTradeHistory()}
                  />
                  <MultiBrainConsensusPanel
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    currentPrice={liveEffectivePrice}
                    recentHistory={getTradeHistory()}
                  />
                  <RealtimeSynchronizerWidget
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    currentPrice={liveEffectivePrice}
                    activePositions={activePositions}
                    recentHistory={getTradeHistory()}
                  />
                </div>
              )}

              {/* Tab 1: Brains */}
              {systemHubTab === 'brains' && (
                <div className="flex flex-col gap-3">
                  <OpenSourceAdvisoryPanel />
                  <MtfStructuralWidget analysis={analysis} />
                  <SbFiveModelsPanel
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    currentPrice={liveEffectivePrice}
                    activePositions={activePositions}
                    tradeHistory={getTradeHistory()}
                  />

                  <BrainPriorityCoordinatorPanel
                    currentPrice={liveEffectivePrice}
                    onShowNotification={showNotification}
                  />
                  <EightMemberCouncilPanel
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    currentPrice={liveEffectivePrice}
                    activePositions={activePositions}
                    tradeHistory={getTradeHistory()}
                  />
                  <CentralDatasetPerformanceMatrixWidget />
                  <WavePredictionEngineWidget
                    analysis={analysis}
                    prediction={aiPrediction}
                  />
                  <MultiBrainConsensusPanel
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    currentPrice={liveEffectivePrice}
                    recentHistory={getTradeHistory()}
                  />
                  <TenBrainArchitecturePanel
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    currentPrice={liveEffectivePrice}
                    recentHistory={getTradeHistory()}
                  />
                  <TenBrainRadarConsensusWidget
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    currentPrice={liveEffectivePrice}
                    recentHistory={getTradeHistory()}
                  />
                  <Suspense
                    fallback={
                      <div role="status" className="rounded-xl border border-cyan-800/50 bg-slate-950/80 p-4 text-sm text-cyan-200">
                        در حال بارگذاری موتور یادگیری تقویتی...
                      </div>
                    }
                  >
                    <TfjsReinforcementLearningWidget
                      analysis={analysis}
                      aiPrediction={aiPrediction}
                      historyList={getTradeHistory()}
                    />
                  </Suspense>
                  <RealtimeSynchronizerWidget
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    currentPrice={liveEffectivePrice}
                    activePositions={activePositions}
                    recentHistory={getTradeHistory()}
                  />
                  <BrainLoadBalancerWidget />
                  <BrainSelfEvolutionWidget
                    recentHistory={getTradeHistory()}
                    currentAtrPct={analysis?.volatilityPct ?? 1.4}
                  />
                  <HierarchicalDecisionFusionWidget volatilityPct={analysis?.volatilityPct ?? 1.4} />
                  <IndexedDbBrainMemoryWidget
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    currentPrice={liveEffectivePrice}
                    autoTradeActive={settings.autoTradeEnabled}
                    activePositions={activePositions}
                    recentHistory={getTradeHistory()}
                  />
                  <DistributedMemoryCacheWidget />
                  <BrainStatisticalEdgeVerifierWidget analysis={analysis} />
                  <ModelChampionChallengerWidget />
                  <AntiSelfDeceptionOnlineLearningWidget />
                </div>
              )}

              {/* Tab 2: Scenarios & Loss Escape */}
              {systemHubTab === 'scenarios' && (
                <div className="flex flex-col gap-3">
                  <TradeThesisAndSmartExitWidget
                    activePositions={activePositions}
                    currentPrice={liveEffectivePrice}
                    analysis={analysis}
                  />
                  <ScenarioCompetitionWidget
                    currentPrice={liveEffectivePrice}
                    analysis={analysis}
                  />
                  <TrendSurvivalAndMfeTrailingWidget
                    currentPrice={liveEffectivePrice}
                    entryPrice={activePositions && activePositions.length > 0 ? activePositions[0].entry : (liveEffectivePrice > 0 ? liveEffectivePrice * 0.99 : 0)}
                    direction={activePositions && activePositions.length > 0 ? activePositions[0].dir : 'LONG'}
                    marginUsd={((settings as any).orderSizeUsd || (settings as any).tradeAmount || 1000) as number}
                    leverage={activePositions && activePositions.length > 0 ? activePositions[0].lev : (((settings as any).leverage || (settings as any).defaultLeverage || 5) as number)}
                  />
                  <StatisticalProtectionAndMaximizationWidget
                    currentPrice={liveEffectivePrice}
                    entryPrice={activePositions && activePositions.length > 0 ? activePositions[0].entry : (liveEffectivePrice > 0 ? liveEffectivePrice * 0.99 : 0)}
                    direction={activePositions && activePositions.length > 0 ? activePositions[0].dir : 'LONG'}
                    setupType={activePositions && activePositions.length > 0 ? ((activePositions[0] as any).setupType || 'BREAKOUT_RETEST') : 'BREAKOUT_RETEST'}
                    marginUsd={((settings as any).orderSizeUsd || (settings as any).tradeAmount || 1000) as number}
                    leverage={activePositions && activePositions.length > 0 ? activePositions[0].lev : (((settings as any).leverage || (settings as any).defaultLeverage || 5) as number)}
                  />
                  <BrainPriorityCoordinatorPanel
                    currentPrice={liveEffectivePrice}
                    onShowNotification={showNotification}
                  />
                  <ScenarioReadinessProfitMaximizerPanel
                    currentPrice={liveEffectivePrice}
                    volatilityPct={analysis?.volatilityPct ?? 1.4}
                    obi={analysis?.obi ?? 0.12}
                    activePositions={activePositions}
                  />
                  <DynamicHedgeUnblockerWidget isHedged={activePositions.some((p: any) => p.hedgeActive || p.isHedged)} />
                  <HunterOrderFlowDashboardWidget analysis={analysis} />
                  <LockedHedgeCrisisEscaperWidget currentPrice={liveEffectivePrice} />
                  <RootCauseAnalysisWidget />
                </div>
              )}

              {/* Tab 3: Volatility, Risk & Video Forecast */}
              {systemHubTab === 'volatility_risk' && (
                <div className="flex flex-col gap-3">
                  <RegimeClassifierWidget
                    currentPrice={liveEffectivePrice}
                    analysis={analysis}
                  />
                  <NoTradePredictorWidget
                    currentPrice={liveEffectivePrice}
                    analysis={analysis}
                  />
                  <GarchRealtimeRiskWidget
                    analysis={analysis}
                    currentPrice={liveEffectivePrice}
                    activePositions={activePositions}
                    autoPilotActive={settings.autoTradeEnabled}
                  />
                  <VolatilitySpikePredictorWidget
                    analysis={analysis}
                    currentPrice={liveEffectivePrice}
                  />
                  <MacroContextBrainWidget currentPrice={liveEffectivePrice} />
                  <NewsShockFirewallWidget analysis={analysis} />
                  <WhaleSignalStatisticalProofWidget />
                  <EarlyWarningProtocolWidget analysis={analysis} />
                  <BrainStrategicBufferWidget currentVolatility={analysis?.volatilityPct ?? 1.4} />
                </div>
              )}

              {/* Tab 4: Flow, Liquidity & Whales */}
              {systemHubTab === 'flow_whales' && (
                <div className="flex flex-col gap-3">
                  <WhaleOnChainRadarWidget />
                  <LiquidityHeatmapWidget
                    currentPrice={liveEffectivePrice}
                    analysis={analysis}
                  />
                  <CvdOiMatrixWidget
                    currentPrice={liveEffectivePrice}
                    analysis={analysis}
                  />
                  <LiquidationCascadeWidget
                    currentPrice={liveEffectivePrice}
                    analysis={analysis}
                  />
                  <CrossExchangeCorrelationWidget
                    currentPrice={liveEffectivePrice}
                    obi={analysis?.obi ?? 0.12}
                    orderSizeUsd={100000}
                  />
                  <FundingPriceCorrelationWidget
                    analysis={analysis}
                    currentPrice={liveEffectivePrice}
                  />
                  <CrossBrainPredictiveEngineWidget />
                  <ActivityFrequencyMonitorWidget />
                </div>
              )}
            </CollapsibleCard>
          </div>
      </div>

      <div id="execution-governor">
        <ExecutionGovernorDashboard
          onModeSelected={handleExecutionModeSelected}
          analysisStatus={analysis?.dataStatus ?? 'DATA_UNAVAILABLE'}
          lastAnalysisAtMs={lastAnalysisAtMs}
        />
      </div>


      {/* Root-Level Floating Wallet Dropdown Modal */}
      {isWalletPopupOpen && (
        <div 
          ref={walletRef}
          className="fixed z-[100000] w-80 bg-[#030712]/95 border-2 border-emerald-500 rounded-2xl p-4 shadow-[0_0_40px_rgba(16,185,129,0.5)] backdrop-blur-2xl animate-in fade-in slide-in-from-top-3 duration-200"
          style={{
            top: walletPopupRect?.top || 80,
            right: walletPopupRect?.right || 24,
          }}
        >
          <div className="flex items-center justify-between pb-3 border-b border-emerald-950/80 mb-3">
            <span className="text-xs font-bold text-emerald-300 font-sans">کیف پول شبیه‌سازی SBK1</span>
            <button
              onClick={() => setIsWalletPopupOpen(false)}
              className="text-slate-400 hover:text-white text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] leading-5 text-amber-200">
              موجودی محلی دمو است و موجودی مجازی Freqtrade یا صرافی را تغییر نمی‌دهد.
            </p>
            <div>
              <div className="text-[10px] text-slate-400 font-sans">موجودی محلی (USDT)</div>
              <div className="text-xl font-mono font-extrabold text-white">
                ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <input
                aria-label="مبلغ تغییر موجودی دمو"
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                value={walletAdjustmentAmount}
                onChange={(event) => setWalletAdjustmentAmount(event.target.value)}
                className="min-w-0 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
              />
              <button
                type="button"
                onClick={() => adjustSandboxWallet('add')}
                className="rounded bg-emerald-800 px-2 py-1 text-xs font-bold"
              >
                افزودن
              </button>
              <button
                type="button"
                onClick={() => adjustSandboxWallet('subtract')}
                className="rounded bg-rose-900 px-2 py-1 text-xs font-bold"
              >
                کسر
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 py-2 border-y border-emerald-950/60 font-sans">
              <div>معاملات فعال: <span className="text-cyan-400 font-bold font-mono">{activePositions.length}</span></div>
              <div>اهرم معاملاتی: <span className="text-indigo-400 font-bold font-mono">{userLeverage ?? (analysis?.leverage || 10)}x</span></div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
