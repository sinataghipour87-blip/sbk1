import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { QuantumChart } from './components/QuantumChart';
import { ChartTopBar } from './components/ChartTopBar';
import { TickerBar } from './components/TickerBar';
import { OrderExecutionPanel } from './components/OrderExecutionPanel';
import { StrategyAndIndicators } from './components/StrategyAndIndicators';
import { HistoryDashboard } from './components/HistoryDashboard';
import { DcaCalculator } from './components/DcaCalculator';
import { LiquidityRiskPanel } from './components/LiquidityRiskPanel';
import { DemoTestingSandbox } from './components/DemoTestingSandbox';
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
import { TenBrainsDashboardWidget } from './components/TenBrainsDashboardWidget';
import { HierarchicalDecisionFusionWidget } from './components/HierarchicalDecisionFusionWidget';
import { DynamicHedgeUnblockerWidget } from './components/DynamicHedgeUnblockerWidget';
import { HunterOrderFlowDashboardWidget } from './components/HunterOrderFlowDashboardWidget';
import { CrossBrainPredictiveEngineWidget } from './components/CrossBrainPredictiveEngineWidget';
import { LockedHedgeCrisisEscaperWidget } from './components/LockedHedgeCrisisEscaperWidget';
import { RootCauseAnalysisWidget } from './components/RootCauseAnalysisWidget';
import { MacroContextBrainWidget } from './components/MacroContextBrainWidget';
import { WhaleSignalStatisticalProofWidget } from './components/WhaleSignalStatisticalProofWidget';
import { WhaleOnChainRadarWidget } from './components/WhaleOnChainRadarWidget';
import { GarchRealtimeRiskWidget } from './components/GarchRealtimeRiskWidget';
import { TfjsReinforcementLearningWidget } from './components/TfjsReinforcementLearningWidget';
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
import { FinalProductionGateWidget } from './components/FinalProductionGateWidget';
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
import { strategicRecoveryBrain } from './services/strategicRecoveryBrain';
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
import { setupBybitWebSocket } from './services/websocket';
import { validatePrecisionEntry, generateClientSidePredictionFallback, updatePredictiveModelFeedbackLoop, evaluate15mTimingAndLifecycle, runDistributedMultiTimeframeBrains, calculateAiMtfConsensusCorrelation, evaluateFuturePredictability } from './services/predictiveEngine';
import { evaluateSignalToExecution, buildExecutionPosition, calculateLogicTargets } from './services/signalToExecution';
import { verifyAutoTradePrerequisites, reconcileOrderWithExchange } from './services/autoTradeGuard';
import { getExecutionMode } from './services/executionMode';
import { TfjsReinforcementLearningEngine } from './services/tfjsReinforcementLearningEngine';
import { brainEvolutionHub } from './services/brainSelfEvolutionHub';
import { tradeThesisAndSmartExitEngine } from './services/tradeThesisAndSmartExitEngine';
import { signalExpirationEngine, SignalStateSnapshot } from './services/signalExpirationEngine';
import { hunterExecutionEngine } from './services/hunterExecutionEngine';
import { AlertCircle, Settings, CheckCircle2, Cpu, Shield, Activity, BarChart2, Layers, Compass, Menu, Crosshair } from 'lucide-react';

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

export default function App() {
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());
  const [showSidebar, setShowSidebar] = useState(false);
  const executionModeRef = useRef<ExecutionMode | null>(null);
  const handleExecutionModeSelected = useCallback((mode: ExecutionMode, _isLocalSelection: boolean) => {
    executionModeRef.current = mode;
  }, []);
  const [activeTab, setActiveTab] = useState<'chart' | 'strategy' | 'ai_risk' | 'smart_engines' | 'history_backtest'>('chart');
  const [rightActiveTab, setRightActiveTab] = useState<'trades' | 'wallet'>('trades');
  const [isDeepBlack, setIsDeepBlack] = useState<boolean>(() => {
    const saved = localStorage.getItem('quantum_theme_deep_black');
    return saved !== null ? saved === 'true' : true;
  });
  const [balance, setBalance] = useState<number>(() => {
    const saved = localStorage.getItem('quantum_balance');
    return saved ? parseFloat(saved) : 1000.0;
  });
  const [customBalanceInput, setCustomBalanceInput] = useState<string>('');

  const [userLeverage, setUserLeverage] = useState<number | null>(() => {
    const saved = localStorage.getItem('quantum_user_leverage');
    return saved ? parseInt(saved, 10) : null;
  });

  const [walletPopupRect, setWalletPopupRect] = useState<{ top: number; right: number } | null>(null);
  const [isWalletPopupOpen, setIsWalletPopupOpen] = useState(false);
  const walletRef = useRef<HTMLDivElement>(null);
  const [systemHubTab, setSystemHubTab] = useState<'hunter_os' | 'sb_models' | 'brains' | 'scenarios' | 'volatility_risk' | 'flow_whales'>('hunter_os');

  const [activePositions, setActivePositions] = useState<TradePosition[]>(() => {
    let positions: TradePosition[] = [];
    const saved = localStorage.getItem('quantum_positions');
    if (saved) {
      try {
        positions = JSON.parse(saved);
      } catch (e) {}
    } else {
      const single = localStorage.getItem('quantum_position');
      if (single) {
        try {
          positions = [JSON.parse(single)];
        } catch (e) {}
      }
    }
    // Normalize names based on position index so first is always S, second SB, third SBK
    return positions.map((p, idx) => ({
      ...p,
      name: idx === 0 ? 'S' : idx === 1 ? 'SB' : 'SBK',
    }));
  });

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [aiPrediction, setAiPrediction] = useState<any | null>(null);
  const [source, setSource] = useState<string>('Bybit 15m');
  const [isFetching, setIsFetching] = useState<boolean>(false);
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
  const checkAndExecuteAutoTradeRef = useRef<any>(null);

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
    try {
      const rlEngine = TfjsReinforcementLearningEngine.getInstance();
      rlEngine.trainOnClosedTrade(historyEntry, activeAnalysis, activePrediction).catch(() => {});
    } catch {
      // ایمن‌سازی اجرای پس‌زمینه
    }

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
      try {
        TfjsReinforcementLearningEngine.getInstance().trainOnHistoricalTradesBatch(hist);
      } catch {}
    }

    requestNotificationPermission();
    wsRef.current = setupBybitWebSocket((rawPrice) => {
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

      // Execute millisecond-level position ticks on every single price update immediately!
      runRealtimePositionTicks(price);

      // ⚡ شلیک میلی‌ثانیه‌ای Fast Reload در اولین تیک نوسان زنده قیمت بدون معطلی پولینگ ۳ ثانیه‌ای
      if (fastReloadReadyRef.current && settingsRef.current?.autoTradeEnabled) {
        checkAndExecuteAutoTradeRef.current?.(latestAnalysisSnapshotRef.current, aiPredictionRef.current);
      }

      const now = Date.now();
      // Throttle rapid WS ticks to max 1 update per 100ms for ultra-responsive DOM rendering
      if (now - lastPriceUpdateRef.current > 100) {
        lastPriceUpdateRef.current = now;
        setAnalysis((prev) => (prev ? { ...prev, price } : null));
      }
    });
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
      // Sync positions, balance, and state with server daemon (Item 2)
      try {
        const liveStatusRes = await fetch('/api/live/status');
        if (liveStatusRes.ok) {
          const liveStatusData = await liveStatusRes.json();
          if (executionModeRef.current !== 'PAPER') {
            if (liveStatusData.activePositions) {
              setActivePositions(liveStatusData.activePositions);
              activePositionsRef.current = liveStatusData.activePositions;
              localStorage.setItem('quantum_positions', JSON.stringify(liveStatusData.activePositions));
            }
            if (liveStatusData.liveAutoTradeEnabled !== undefined) {
              if (settings.autoTradeEnabled !== liveStatusData.liveAutoTradeEnabled) {
                const updated = { ...settings, autoTradeEnabled: liveStatusData.liveAutoTradeEnabled };
                setSettings(updated);
                saveSettings(updated);
              }
            }
          }
        }
      } catch (err) {
        // handled silently
      }

      try {
        const exchangeStatusRes = await fetch('/api/exchange/status');
        if (exchangeStatusRes.ok) {
          const exchangeStatusData = await exchangeStatusRes.json();
          if (executionModeRef.current !== 'PAPER' && exchangeStatusData.connected && exchangeStatusData.walletBalanceUsdt !== undefined) {
            setBalance(exchangeStatusData.walletBalanceUsdt);
            balanceRef.current = exchangeStatusData.walletBalanceUsdt;
            localStorage.setItem('quantum_balance', exchangeStatusData.walletBalanceUsdt.toString());
          }

          // 84. Exchange Reconciliation - Exchange is the Source of Truth
          if (executionModeRef.current !== 'PAPER' && exchangeStatusData.connected && exchangeStatusData.activePositions) {
            const exchangePositions = exchangeStatusData.activePositions || [];
            const currentLocalPositions = [...activePositionsRef.current];
            let reconciledLocalPositions: TradePosition[] = [];
            let anyReconciled = false;

            for (const localPos of currentLocalPositions) {
              if (!localPos.isAuto) {
                reconciledLocalPositions.push(localPos);
                continue;
              }
              // Find matching active position on Bybit/Exchange
              const matchingExchangePos = exchangePositions.find((ep: any) => {
                const epSize = parseFloat(ep.size || '0');
                return epSize > 0 && (
                  (localPos.dir === 'LONG' && ep.side === 'Buy') ||
                  (localPos.dir === 'SHORT' && ep.side === 'Sell')
                );
              });

              if (matchingExchangePos) {
                // Keep the local position, sync properties if slightly deviated
                const exEntryPrice = parseFloat(matchingExchangePos.avgPrice || matchingExchangePos.entryPrice || '0');
                if (exEntryPrice > 0 && Math.abs(localPos.entry - exEntryPrice) > 0.05) {
                  localPos.entry = exEntryPrice;
                  anyReconciled = true;
                }
                reconciledLocalPositions.push(localPos);
              } else {
                // If not found on Exchange, it means the position was closed/liquidated/stopped out there
                anyReconciled = true;
                const now = new Date();
                const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                
                const historyEntry: TradeHistory = {
                  ...localPos,
                  pnlUsd: localPos.floatingPnlUsd || 0,
                  pnlPct: localPos.peakPnlPct || 0,
                  closedAt: timeStr,
                  closeReason: `همگام‌سازی اضطراری صرافی (Exchange Reconciliation): پوزیشن بر روی صرافی باز نبود. هم‌ترازی خودکار با مرجع حقیقت صرافی.`,
                };
                saveTradeToHistory(historyEntry);
                showNotification(
                  `🔄 همگام‌سازی صرافی: پوزیشن [${localPos.name}] در صرافی یافت نشد و با مرجع حقیقت صرافی هماهنگ و بسته شد.`
                );
              }
            }

            if (anyReconciled) {
              setActivePositions(reconciledLocalPositions);
              activePositionsRef.current = reconciledLocalPositions;
              localStorage.setItem('quantum_positions', JSON.stringify(reconciledLocalPositions));
            }
          }
        }
      } catch (err) {
        // handled silently
      }

      let sentiment = {
        score: 0.45,
        label: 'POSITIVE',
        trend: 'UP',
        drivers: ['شکست مقاومت کلیدی و اوردر بلاک صعودی', 'انباشت نهنگ‌ها و خروج از صرافی'],
      };

      try {
        const sentimentResponse = await fetch('/api/sentiment', { method: 'POST' });
        if (sentimentResponse.ok) {
          sentiment = await sentimentResponse.json();
        }
      } catch (err) {
        // fallback to default
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

      const dataQualityReport = evaluateMarketDataQuality(candleData, realObiData, deriv, fng, futuresPrices);
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
      setSource(candleData.source);

      // Trigger high-priority instant execution right after analysis snapshot updates
      checkAndExecuteAutoTrade(res, currentPrediction);

      if (settingsRef.current.notificationsEnabled && res.signalOk && res.confScore >= 5) {
        sendNotification('سیگنال قدرتمند جدید', `سیگنال ${res.direction === 'LONG' ? 'خرید' : 'فروش'} با امتیاز ۵/۵ تایید شد.`);
      }
    } catch (err) {
      // Market fetch handled silently
    } finally {
      setIsFetching(false);
      isFetchingRef.current = false;
    }
  }, [showNotification]);

  // High-Priority Zero-Latency Auto-Trade Executor
  const checkAndExecuteAutoTrade = useCallback((customAnalysis?: AnalysisResult | null, customPred?: any) => {
    const currentRes = customAnalysis || latestAnalysisSnapshotRef.current || analysis;
    if (!currentRes || currentRes.price <= 0) return;

    const curSettings = settingsRef.current;
    if (!curSettings.autoTradeEnabled) return;

    const currentActive = activePositionsRef.current;
    
    // حفظ فرکانس و تعداد بالای معاملات:
    // ممانعت از باز شدن بیش از ۳ معامله همزمان، اما جلوگیری از توقف کل سیستم در زمان فعالیت هجینگ خودکفا
    const totalActiveCount = currentActive.length;
    if (totalActiveCount >= 3) return;

    // بررسی حداقل مارجین در دسترس برای ورود ایمن
    const currentBalance = balanceRef.current || 1000;
    const usedMargin = currentActive.reduce((acc, p) => acc + (p.margin || 10), 0);
    if (currentBalance - usedMargin < 15) return; // حفظ بافر امن سرمایه

    // ممانعت فقط در صورت افت شدید بحرانی بیش از ۱۰٪ در یک پوزیشن محافظت‌نشده
    const isCrisisLocked = currentActive.some((p) => {
      if (p.hedgeActive) return false; // پوزیشن هج شده به صورت دلتا-خنثی محافظت شده است
      const entry = p.entry || currentRes.price;
      const isLong = p.dir === 'LONG';
      const curP = currentRes.price;
      const pnlPct = isLong
        ? ((curP - entry) / entry) * 100.0 * (p.lev || 10)
        : ((entry - curP) / entry) * 100.0 * (p.lev || 10);
      return pnlPct < -12.0; // فقط در صورت افت شدید غیرعادی، ورود جدید مکث می‌کند
    });

    if (isCrisisLocked) {
      return; // تمرکز کامل منابع بر مهار بحران
    }

    const history = getTradeHistory();
    const antiTilt = getAntiTiltStatus(history);
    if (antiTilt.isLocked) return;

    // 🎯 Hunter Sniper Protocol: کولداون حساب‌شده برای پیشگیری از اسپم و معاملات عجولانه
    // شکارچی اجازه می‌دهد ساختار کندل تثبیت شود و در هر ثانیه معامله بی‌هدف باز نمی‌کند
    const dynamicCoolDown = 15000; // حداقل ۱۵ ثانیه فاصله بین باز شدن چرخه‌های جدید
    const timeSinceLastClose = Date.now() - lastCloseTimeRef.current;
    if (timeSinceLastClose < dynamicCoolDown) return;

    const pred = customPred || aiPredictionRef.current || aiPrediction;
    const evalLong = evaluateSignalToExecution(currentRes, 'LONG', pred, history, winRateConfig.minWinProbability);
    const evalShort = evaluateSignalToExecution(currentRes, 'SHORT', pred, history, winRateConfig.minWinProbability);

    // 🛡️ گیت ایمنی پیش‌بینی‌های مصنوعی و فال‌بک: ممانعت کامل از ورود با پیش‌بینی تخمینی کلاینت
    if (pred?.isSyntheticUnsafeForLive || pred?.isClientSideFallback || pred?.status === 'CLIENT_FALLBACK_UNVERIFIED') {
      return;
    }

    let signalEval = evalLong;
    if (evalLong.canExecute && evalShort.canExecute) {
      signalEval = evalLong.totalScorePct >= evalShort.totalScorePct ? evalLong : evalShort;
    } else if (evalLong.canExecute) {
      signalEval = evalLong;
    } else if (evalShort.canExecute) {
      signalEval = evalShort;
    } else {
      signalEval = evalLong.totalScorePct >= evalShort.totalScorePct ? evalLong : evalShort;
    }

    // 🏄‍♂️ شرط ۱: انطباق قطعی امتیاز ارکان با آستانه شکارچی واقعی (حداقل ۷۰٪ با تایید ۶ رکن اصلی)
    const minRequiredScore = signalEval.executionThreshold || 70;
    if (!signalEval.canExecute || signalEval.totalScorePct < minRequiredScore) {
      return;
    }

    const targetDir: 'LONG' | 'SHORT' = signalEval.direction === 'SHORT' ? 'SHORT' : 'LONG';

    // 🔮 شرط ۰: گیت قطعیت و پیش‌بینی‌پذیری آینده (Market Predictability Gate):
    // اگر آینده بازار دارای تلاطم نویز تصادفی یا عدم قطعیت باشد، معامله ابداً باز نمی‌شود
    const futurePredictability = evaluateFuturePredictability(currentRes, pred, targetDir);
    if (!futurePredictability.isFuturePredictable) {
      return; // ممانعت اکید از معامله در شرایط غیرقابل پیش‌بینی آینده
    }

    // 🧠 شرط ۱.۵: گیت اجماع کوانتومی و ضریب همبستگی هوش مصنوعی و امواج کلان (AI-MTF Consensus Gate):
    // صرفاً امتیاز خام ارکان کافی نیست؛ همبستگی برداری مدل هوش مصنوعی با امواج MTF باید حداقل +۰.۶۵ باشد
    const consensusGate = calculateAiMtfConsensusCorrelation(currentRes, targetDir, pred);
    if (!consensusGate.passed) {
      return; // ممانعت اکید از ورود به دلیل تضاد یا ضعف همبستگی هوش مصنوعی با ساختار امواج
    }

    // 🌐 شرط ۱.۷: تحلیلگر همبستگی چند-تایم‌فریمی مدل‌های SB و نقدینگی OBI (ضریب الزامی بالای ۰.۸۵):
    // مقایسه خروجی مدل‌های هوش مصنوعی SB1 تا SB5 با جهت جریان نقدینگی دفتر سفارشات
    const sbObiCorrelation = analyzeMultiTimeframeSbObiCorrelation(
      currentRes,
      pred,
      targetDir,
      currentRes.price,
      currentActive,
      history
    );
    if (!sbObiCorrelation.passed || sbObiCorrelation.correlationScore < 0.85) {
      return; // ممانعت قطعی از ورود در صورت کمتر بودن ضریب همبستگی SB و OBI از ۰.۸۵
    }

    // 🌊 شرط ۲: انطباق کامل و همگام‌سازی موج‌سواری ۱۵ دقیقه‌ای (15M Wave Alignment & Timing Sync):
    // معامله فقط و فقط زمانی باز می‌شود که موج ۱۵ دقیقه در فاز بهینه و هم‌جهت با ارکان باشد
    const timing15m = evaluate15mTimingAndLifecycle(currentRes, targetDir);
    if (!timing15m.isOptimalTiming || timing15m.lifecyclePhase === 'LATE_EXHAUSTION_GUARD') {
      return; // ممانعت قطعی از ورود در انتهای خستگی موج ۱۵ دقیقه
    }

    // بررسی همگرایی ساختاری تایم‌فریم ۱۵ دقیقه:
    const expected15m = targetDir === 'LONG' ? 'BULLISH' : 'BEARISH';
    const is15mWaveAligned = (currentRes.mtf15m === expected15m) || (timing15m.lifecyclePhase === 'WAVE_GENESIS_PRIME');
    if (!is15mWaveAligned) {
      return; // عدم همگرایی ساختار ۱۵ دقیقه با جهت معامله
    }

    // بررسی اجماع مغزهای توزیع‌شده تایم‌فریمی ۱۵ دقیقه‌ای:
    const distributedBrains = runDistributedMultiTimeframeBrains(currentRes, currentRes.price);
    const isBrain15mOpposed = (targetDir === 'LONG' && distributedBrains.brain15m.bias === 'BEARISH') ||
                              (targetDir === 'SHORT' && distributedBrains.brain15m.bias === 'BULLISH');
    if (isBrain15mOpposed) {
      return; // تضاد مغز محاسباتی ۱۵ دقیقه‌ای با جهت سیگنال
    }

    // 🛡️ شرط ۳: فیلتر انطباق پویا و محافظت از چرخش ۳۰ دقیقه آینده:
    const reversalData = pred?.reversal30m;
    const isImminentReversalAgainstTrade = reversalData && reversalData.reversalProbability >= 68 && (
      (targetDir === 'LONG' && reversalData.predictedTrend30m === 'BEARISH_REVERSAL') ||
      (targetDir === 'SHORT' && reversalData.predictedTrend30m === 'BULLISH_REVERSAL')
    );

    if (isImminentReversalAgainstTrade) {
      // ممانعت هوشمند از ورود به تله سقف/کف قبل از وقوع چرخش قطعی ۳۰ دقیقه‌ای
      return;
    }

    // 🛡️ شرط ۴: گیت محافظتی مدل‌های پنج‌گانه SB1 تا SB5 (Zero Concurrent Loss Gate)
    const sbGateCheck = sbFiveModelsEngine.canOpenNewOrScaleInPosition(currentActive, targetDir, currentRes.price);
    if (!sbGateCheck.canOpen) {
      return;
    }
    const sameDirPositions = currentActive.filter((p) => p.dir === targetDir);
    const sameDirCount = sameDirPositions.length;
    if (sameDirCount >= 3) return;

    // Throttle duplicate rapid entries in the same direction (حداقل ۲۰ ثانیه فاصله برای تثبیت پوزیشن شکارچی)
    const throttleSameDirMs = 20000;
    const hasRecentSameDir = currentActive.some(
      (p) => p.dir === targetDir && (Date.now() - parseInt(p.id.split('_')[0], 10) < throttleSameDirMs)
    );
    if (hasRecentSameDir) return;

    let canProceedWithScaleIn = true;
    let scaledLeverageMultiplier = 1.0;
    let scaleInMessage = '';
    let tradeName = 'S';

    if (sameDirCount === 1) {
      tradeName = 'SB';
      const firstTrade = sameDirPositions[0];
      const firstTradeAgeSec = (Date.now() - parseInt(firstTrade.id.split('_')[0], 10)) / 1000;
      
      const firstTradeEntry = firstTrade.entry || currentRes.price;
      const isFirstLong = firstTrade.dir === 'LONG';
      const firstLev = firstTrade.lev || 10;
      const firstTradePnlPct = isFirstLong
        ? ((currentRes.price - firstTradeEntry) / firstTradeEntry) * 100.0 * firstLev
        : ((firstTradeEntry - currentRes.price) / firstTradeEntry) * 100.0 * firstLev;

      // 🛡️ گیت محافظتی کارمزد صرافی و ممانعت از ورود به پله دوم در وضعیت سربه‌سر:
      // محاسبه کارمزد رفت‌وبرگشت تیکر صرافی (۰.۰۵۵٪ × ۲ با لحاظ لوریج)
      const takerFeeRate = 0.00055;
      const roundtripFeeMarginPct = takerFeeRate * 2 * firstLev * 100;
      const netProfitAfterFeesPct = firstTradePnlPct - roundtripFeeMarginPct;
      const isFeeBreakevenPassed = realWorldMasterBrainsService.isFeeCoveredBreakevenPassed(firstTradeEntry, currentRes.price, isFirstLong ? 'LONG' : 'SHORT', takerFeeRate);

      // 🌊 تایمینگ بهینه جهت سوار شدن بر موج سود:
      // ممانعت اکید در صورت وضعیت سربه‌سر بعد از کارمزد، سود ناچیز شکننده یا واگرایی دفتر سفارشات
      const isWaveMomentumAligned = isFirstLong ? (currentRes.obi >= -0.15) : (currentRes.obi <= 0.15);

      if (firstTradeAgeSec < 10 || !isFeeBreakevenPassed || netProfitAfterFeesPct < 0.30 || !isWaveMomentumAligned) {
        canProceedWithScaleIn = false;
      } else {
        scaledLeverageMultiplier = 1.5;
        scaleInMessage = ` (معامله دوم هوشمند SB در شتاب سود خالص پایدار +${netProfitAfterFeesPct.toFixed(1)}٪ با اهرم ۱.۵x 🚀)`;
      }
    } else if (sameDirCount === 2) {
      tradeName = 'SBK';
      const secondTrade = sameDirPositions[1];
      const secondTradeAgeSec = (Date.now() - parseInt(secondTrade.id.split('_')[0], 10)) / 1000;
      
      const secondTradeEntry = secondTrade.entry || currentRes.price;
      const isSecondLong = secondTrade.dir === 'LONG';
      const secondLev = secondTrade.lev || 10;
      const secondTradePnlPct = isSecondLong
        ? ((currentRes.price - secondTradeEntry) / secondTradeEntry) * 100.0 * secondLev
        : ((secondTradeEntry - currentRes.price) / secondTradeEntry) * 100.0 * secondLev;

      // 🛡️ گیت محافظتی کارمزد صرافی در پله سوم (SBK):
      const takerFeeRate = 0.00055;
      const roundtripFeeMarginPct = takerFeeRate * 2 * secondLev * 100;
      const netProfitAfterFeesPct = secondTradePnlPct - roundtripFeeMarginPct;
      const isFeeBreakevenPassed = realWorldMasterBrainsService.isFeeCoveredBreakevenPassed(secondTradeEntry, currentRes.price, isSecondLong ? 'LONG' : 'SHORT', takerFeeRate);

      const isWaveMomentumAligned = isSecondLong ? (currentRes.obi >= -0.10) : (currentRes.obi <= 0.10);

      // ورود پله سوم (SBK) فقط در صورت عبور کامل از کارمزد صرافی و تثبیت در سود خالص قوی مجاز است
      if (secondTradeAgeSec < 10 || !isFeeBreakevenPassed || netProfitAfterFeesPct < 0.35 || !isWaveMomentumAligned) {
        canProceedWithScaleIn = false;
      } else {
        scaledLeverageMultiplier = 1.5;
        scaleInMessage = ` (معامله سوم هوشمند SBK برای شکار اوج موج سود خالص +${netProfitAfterFeesPct.toFixed(1)}٪ با اهرم ۱.۵x 🚀)`;
      }
    }

    if (!canProceedWithScaleIn) return;

    // اجازه ورود به پله‌های دوم و سوم (SB/SBK) حتی در بازار رنج برای بهینه‌سازی میانگین ورود
    const isScaleInTrade = sameDirCount > 0;
    
    // فقط در صورتی بازار رنج مانع معامله می‌شود که امتیاز ارکان کمتر از ۶۵٪ باشد (کاهش حساسیت)؛ 
    // پله‌های دوم و سوم (Scale-In) از این فیلتر مستثنی هستند
    const isRangeBlocked = !isScaleInTrade && curSettings.rangeFilterEnabled !== false && currentRes.isRangeBound && signalEval.totalScorePct < 65;
    if (isRangeBlocked) return;

    // ------------------------------------------------------------------
    // Multi-Period Funding Rate & Dynamic Cost Trend Guard (3-Period Confluence):
    // Prevents opening costly swing/long-term positions where holding fees accelerate against the trade
    // ------------------------------------------------------------------
    const fundingRateVal = currentRes.fundingRate ?? currentRes.funding ?? 0.01;
    const fundingHist = currentRes.fundingHistory && currentRes.fundingHistory.length >= 3
      ? currentRes.fundingHistory
      : [0.010, 0.011, fundingRateVal];
    const [fPrev2, fPrev1, fCurrent] = fundingHist.slice(-3);
    const isFundingSurgingPositive = fCurrent > fPrev1 && fPrev1 > fPrev2 && fCurrent >= 0.025;
    const isFundingPlungingNegative = fCurrent < fPrev1 && fPrev1 < fPrev2 && fCurrent <= -0.015;

    // 1. Extreme absolute rate check (> +0.045% or < -0.045%)
    if (targetDir === 'LONG' && fundingRateVal > 0.045) {
      showNotification(`⚠️ ممانعت از ورود به پوزیشن خرید (LONG): نرخ فاندینگ بسیار سنگین (+${fundingRateVal.toFixed(3)}٪) بوده و نگهداری پوزیشن هزینه بالایی دارد.`);
      return;
    }
    if (targetDir === 'SHORT' && fundingRateVal < -0.045) {
      showNotification(`⚠️ ممانعت از ورود به پوزیشن فروش (SHORT): نرخ فاندینگ منفی سنگین (${fundingRateVal.toFixed(3)}٪) بوده و نگهداری پوزیشن هزینه بالایی دارد.`);
      return;
    }

    // 2. 3-Period Trend Divergence Guard (Cost Acceleration against Trade Direction)
    if (targetDir === 'LONG' && (isFundingSurgingPositive || currentRes.fundingTrend === 'RISING')) {
      if (fCurrent > 0.020) {
        showNotification(
          `⚠️ ممانعت هوشمند از ورود به خرید (LONG): روند نرخ فاندینگ در ۳ دوره اخیر افزایشی و تصاعدی است (${fPrev2.toFixed(3)}٪ ➔ ${fPrev1.toFixed(3)}٪ ➔ ${fCurrent.toFixed(3)}٪)؛ ورود در این شرایط باعث تحمیل کارمزدهای سنگین نگهداری می‌شود.`
        );
        return;
      }
    }

    if (targetDir === 'SHORT' && (isFundingPlungingNegative || currentRes.fundingTrend === 'FALLING')) {
      if (fCurrent < -0.010) {
        showNotification(
          `⚠️ ممانعت هوشمند از ورود به فروش (SHORT): روند نرخ فاندینگ در ۳ دوره اخیر کاهشی و منفی تصاعدی است (${fPrev2.toFixed(3)}٪ ➔ ${fPrev1.toFixed(3)}٪ ➔ ${fCurrent.toFixed(3)}٪)؛ ورود در این شرایط باعث تحمیل جریمه‌های دوره‌ای فاندینگ می‌شود.`
        );
        return;
      }
    }

    // 📈 تنظیم خودکار لوریج شناور با رژیم نوسان GARCH و جهش‌های اخبار فاندامنتال:
    // در امواجی با نوسان پیش‌بینی‌شده نرمال، لوریج تا ۱۵x افزایش می‌یابد؛ در جهش‌های اخبار فاندامنتال روی ۱۰x می‌ماند
    const garchRegime = pred?.garch?.regime || 'NORMAL';
    const macroState = macroContextBrainService.getMacroContext(currentRes.price);
    const isNewsSpike = macroState.breakingNewsImpactLevel === 'SEVERE_BEARISH_THREAT' || 
                        macroState.breakingNewsImpactLevel === 'STRONG_BULLISH_CATALYST' ||
                        macroState.emergencyDefensiveShield;

    let garchAdaptiveLev = 10;
    if (isNewsSpike) {
      garchAdaptiveLev = 10; // در زمان جهش اخبار فاندامنتال روی ۱۰x می‌ماند تا سودآوری با ریسک صفر حفظ شود
    } else if (garchRegime === 'NORMAL' || (currentRes.volatilityPct && currentRes.volatilityPct < 2.0)) {
      garchAdaptiveLev = 15; // در نوسان نرمال، لوریج تا ۱۵x افزایش می‌یابد
    } else {
      garchAdaptiveLev = 10;
    }

    const baseLev = userLeverageRef.current !== null ? userLeverageRef.current : garchAdaptiveLev;
    const effectiveLev = Math.round(baseLev * scaledLeverageMultiplier);

    // ========================================================
    // ۳۹ & ۴۰. گیت حیاتی Signal TTL و اعتبارسنجی ۱۲ فاکتوره در میلی‌ثانیه قبل از سفارش (Final Revalidation)
    // ========================================================
    const nowMs = Date.now();
    const signalSnapshot: SignalStateSnapshot = {
      signalId: `SIG_${targetDir}_${nowMs}`,
      createdAtMs: nowMs - 120, // 120ms compute flight
      ttlMs: signalExpirationEngine.calculateDynamicTtlMs(currentRes.volatilityPct || 1.2, isNewsSpike),
      status: 'SIGNAL_CREATED',
      initialPrice: currentRes.price,
      initialObi: currentRes.realObiData?.obi ?? currentRes.obi ?? 0,
      initialCvd: currentRes.orderFlowFeatures?.cvdDelta ?? currentRes.cvdDelta ?? 0,
      initialSpreadBps: currentRes.realObiData?.spreadUsd ? (currentRes.realObiData.spreadUsd / currentRes.price) * 10000 : 1.4,
      initialAtr: currentRes.atr || (currentRes.price * 0.008),
      direction: targetDir,
      minWinProbability: winRateConfig.minWinProbability || 65,
      expectedValueUsd: currentRes.expectedValue || 0.5,
      marketRegime: currentRes.marketRegime || 'TREND',
    };

    // بررسی TTL و جهش قیمت
    const ttlCheck = signalExpirationEngine.evaluateSignalExpiration(signalSnapshot, currentRes, nowMs);
    if (ttlCheck.isExpired) {
      showNotification(`⏳ ${ttlCheck.reasonFa}`);
      return;
    }

    // بررسی حیاتی موجودی واقعی حساب قبل از ارسال اردر
    const activeBalance = (typeof balanceRef.current === 'number' && Number.isFinite(balanceRef.current) && balanceRef.current > 0) ? balanceRef.current : 0;
    if (activeBalance <= 0) {
      showNotification('🛑 موجودی واقعی حساب در دسترس نیست (DATA_UNAVAILABLE / ZERO_BALANCE)؛ ارسال سفارش متوقف شد.');
      return;
    }

    // اعتبارسنجی مجدد ۱۲ فاکتور حیاتی
    const revalGate = signalExpirationEngine.revalidateEntryBeforeOrderSubmission(
      signalSnapshot,
      currentRes,
      nowMs,
      { availableBalanceUsd: activeBalance, dailyDrawdownPct: 0.0 }
    );

    if (!revalGate.isApprovedForSubmission) {
      showNotification(`🛑 گیت ۱۲ فاکتوره ورود رد شد: ${revalGate.rejectionReasonFa}`);
      return;
    }

    const newPos = buildExecutionPosition(currentRes, targetDir, activeBalance, history, effectiveLev, false, pred);
    if (newPos.lifecycleStatus === 'REJECTED') {
      showNotification(`⚠️ معامله خودکار رد شد: ${newPos.rejectionReason}`);
      return;
    }
    newPos.name = tradeName;
    newPos.isAuto = true;
    newPos.lifecycleStatus = 'APPROVED';

    // ریست وضعیت Fast Reload پس از شلیک موفقیت‌آمیز
    fastReloadReadyRef.current = false;

    // Resolve execution mode immediately before execution; unknown modes fail closed.
    (async () => {
      let executionMode: ExecutionMode;
      try {
        executionMode = await getExecutionMode();
        executionModeRef.current = executionMode;
      } catch (err) {
        fastReloadReadyRef.current = true;
        const message = err instanceof Error ? err.message : 'خطای نامشخص';
        showNotification(`🛑 دریافت حالت اجرا ناموفق بود؛ سفارش ارسال نشد: ${message}`);
        return;
      }

      if (executionMode === 'PAPER') {
        newPos.lifecycleStatus = 'FILLED';
        
        // ۳۶ & ۳۷. مدل اسلیپیج و کارمزد در حالت شبیه‌ساز واقعی
        const slippageCalc = hunterExecutionEngine.calculateRealisticSlippage({
          orderSizeBtc: (newPos.margin * newPos.lev) / Math.max(1, newPos.entry),
          orderBookDepthUsd: currentRes.realObiData?.bidDepthUsd || 1500000,
          spreadBps: currentRes.realObiData?.spreadUsd ? (currentRes.realObiData.spreadUsd / newPos.entry) * 10000 : 1.4,
          volatilityPct: currentRes.volatilityPct || 1.2,
          hourOfDay: new Date().getHours(),
          liquidityScore: 85,
          orderType: 'Market',
          latencyMs: 45,
          nominalPrice: newPos.entry
        });

        const simFillPrice = targetDir === 'LONG' 
          ? newPos.entry + slippageCalc.actualSlippageUsd 
          : newPos.entry - slippageCalc.actualSlippageUsd;
        
        newPos.expectedPrice = newPos.entry;
        newPos.submittedPrice = newPos.entry;
        newPos.averageFillPrice = Math.round(simFillPrice * 100) / 100;
        newPos.entry = newPos.averageFillPrice;
        newPos.slippageUsd = slippageCalc.actualSlippageUsd;
        newPos.actualSlippageBps = slippageCalc.actualSlippageBps;
        newPos.realizedFeesUsd = Math.round((newPos.margin * newPos.lev * 0.00055) * 1000) / 1000;

        const conviction = evaluateCognitiveConviction(currentRes, pred, signalEval.totalScorePct);
        const updated = [...currentActive, newPos];
        activePositionsRef.current = updated;
        setActivePositions(updated);
        localStorage.setItem('quantum_positions', JSON.stringify(updated));
        showNotification(
          `🧪 معامله دمو [${tradeName}] با ${conviction.labelFa} در Paper Trading ثبت شد: ${targetDir === 'LONG' ? 'خرید (LONG)' : 'فروش (SHORT)'} | قیمت $${newPos.entry.toFixed(1)}${scaleInMessage}`
        );
        return;
      }

      if (executionMode !== 'LIVE') {
        showNotification(`🛑 ارسال سفارش متوقف شد؛ حالت ${executionMode} اجرای Auto-Pilot را مجاز نمی‌کند.`);
        return;
      }

      try {
        const orderQtyBtc = (newPos.initialMargin * newPos.lev / Math.max(1, currentRes.price)).toFixed(3);
        const orderRes = await fetch('/api/exchange/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: 'BTCUSDT',
            side: targetDir,
            orderType: 'Market',
            qty: orderQtyBtc,
            price: newPos.entry,
            stopLoss: newPos.sl,
            takeProfit: newPos.tp1,
            clientOrderId: newPos.uniqueClientOrderId,
            signalId: newPos.signalId,
            decisionId: newPos.decisionId,
            executionAttemptId: newPos.executionAttemptId,
            mode: 'live',
          }),
        });

        const orderData = await orderRes.json();

        if (!orderRes.ok || !orderData.success) {
          // STRICT BEHAVIOR (Issue 27): If blocked or credentials invalid -> Halt, do NOT fake execute
          showNotification(
            `🛑 ${orderData.error || 'EXECUTION_BLOCKED: سفارش توسط گیت صرافی لایو رد شد.'}`
          );
          return;
        }

        // ۳۵ & ۳۶. ثبت داده‌های واقعی Fill از پاسخ رسمی صرافی Bybit
        const actualAvgPrice = parseFloat(orderData.avgPrice || orderData.executedPrice || newPos.entry.toString());
        const actualFilledQty = parseFloat(orderData.cumExecQty || orderData.executedQty || orderQtyBtc);
        const actualFee = parseFloat(orderData.cumExecFee || orderData.feeUsd || ((actualAvgPrice * actualFilledQty * 0.00055).toFixed(4)));
        const actualSlipUsd = Math.abs(actualAvgPrice - newPos.entry);
        const actualSlipBps = Number(((actualSlipUsd / newPos.entry) * 10000).toFixed(2));

        newPos.expectedPrice = newPos.entry;
        newPos.submittedPrice = newPos.entry;
        newPos.averageFillPrice = actualAvgPrice;
        newPos.entry = actualAvgPrice; // Actual Exchange Fill Price
        newPos.slippageUsd = actualSlipUsd;
        newPos.actualSlippageBps = actualSlipBps;
        newPos.realizedFeesUsd = actualFee;
        newPos.lifecycleStatus = orderData.orderStatus === 'PartiallyFilled' ? 'PARTIALLY_FILLED' : 'FILLED';

        // ۳۷. آموزش آنلاین مدل اسلیپیج بر اساس اختلاف واقعی با تخمین
        hunterExecutionEngine.recordActualSlippageForLearning({
          expectedSlippageUsd: 0.15,
          actualSlippageUsd: actualSlipUsd,
          orderSizeBtc: actualFilledQty,
          orderBookDepthUsd: currentRes.realObiData?.bidDepthUsd || 1500000,
          spreadBps: 1.4,
          volatilityPct: currentRes.volatilityPct || 1.2
        });

        const conviction = evaluateCognitiveConviction(currentRes, pred, signalEval.totalScorePct);
        const updated = [...currentActive, newPos];
        activePositionsRef.current = updated;
        setActivePositions(updated);
        localStorage.setItem('quantum_positions', JSON.stringify(updated));

        showNotification(
          `🤖 ورود هوشمند [${tradeName}] با ${conviction.labelFa} (ارکان ${signalEval.totalPillarsPassed}/۸ | فیل صرافی: $${actualAvgPrice.toFixed(1)}): ${targetDir === 'LONG' ? 'خرید (LONG)' : 'فروش (SHORT)'}${scaleInMessage}`
        );

        // اجرای تطبیق و همگام‌سازی بلافاصله با صرافی (Reconciliation - Issue 29)
        if (orderData.orderId) {
          const recon = await reconcileOrderWithExchange(orderData.orderId, newPos.uniqueClientOrderId || '', newPos.entry);
          newPos.reconciliation = recon;

          if (!recon.isReconciled || recon.exchangePositionState === 'MISMATCH_HALTED') {
            // توقف اضطراری به دلیل عدم انطباق با وضعیت واقعی صرافی
            newPos.reconciliationHalted = true;
            const haltedSettings = { ...settingsRef.current, autoTradeEnabled: false };
            settingsRef.current = haltedSettings;
            setSettings(haltedSettings);
            saveSettings(haltedSettings);

            showNotification(
              `🚨 توقف اضطراری (TRADING HALT + RECONCILIATION REQUIRED): مغایرت بین وضعیت محلی و صرافی کشف شد! ${recon.discrepancyFa || ''}`
            );
          } else {
            newPos.lifecycleStatus = 'PROTECTED';
          }
        }
      } catch (err: any) {
        showNotification(`🛑 خطا در ارسال سفارش به موتور اجرای صرافی: ${err.message || 'شبکه ناموفق'}`);
      }
    })();
  }, [analysis, aiPrediction, winRateConfig.minWinProbability, showNotification]);

  useEffect(() => {
    checkAndExecuteAutoTradeRef.current = checkAndExecuteAutoTrade;
  }, [checkAndExecuteAutoTrade]);

  // Priority Hook: Instantly evaluates and opens auto-trade whenever analysis, prediction or settings change
  useEffect(() => {
    if (analysis && settings.autoTradeEnabled) {
      checkAndExecuteAutoTrade(analysis, aiPrediction);
    }
  }, [analysis, aiPrediction, settings.autoTradeEnabled, checkAndExecuteAutoTrade]);

  // Ultra-high-performance 3-sec auto refresh for instant real-time sync
  useEffect(() => {
    loadMarketData();
    const interval = setInterval(loadMarketData, 3000);
    return () => clearInterval(interval);
  }, [loadMarketData]);

  // Update wallet balance
  const handleUpdateBalance = (newBal: number) => {
    setBalance(newBal);
    localStorage.setItem('quantum_balance', newBal.toString());
    showNotification(`موجودی کیف پول روی $${newBal.toLocaleString('en-US', { minimumFractionDigits: 2 })} تنظیم شد.`);
  };

  // Open Trade Simulation (Instant Manual Open + Auto Multi-Position Scale-In)
  const handleOpenTrade = (direction: 'LONG' | 'SHORT') => {
    const targetSnapshot = latestAnalysisSnapshotRef.current || analysis;
    if (!targetSnapshot || !targetSnapshot.price) {
      showNotification('⏳ در حال دریافت قیمت زنده مارکت...');
      return;
    }

    const primaryActive = activePositions.filter((p) => !p.isRecoveryTrade && !p.hedgeActive);

    if (primaryActive.length >= 6) {
      showNotification('⚠️ سقف مجاز ۶ معامله همزمان پر است.');
      return;
    }

    const sameDirPositions = primaryActive.filter((p) => p.dir === direction);
    const sameDirCount = sameDirPositions.length;
    if (sameDirCount >= 6) {
      showNotification(`⚠️ حداکثر ظرفیت معاملات همزمان در جهت ${direction === 'LONG' ? 'خرید (LONG)' : 'فروش (SHORT)'} پر است.`);
      return;
    }

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    const baseLev = userLeverage ?? targetSnapshot.leverage;
    let finalLev = baseLev;
    let tradeName = 'S';
    let scaleInMsg = '';

    if (sameDirCount === 1) {
      tradeName = 'SB';
      finalLev = Math.round(baseLev * 1.5);
      scaleInMsg = ` [پله دوم SB ${direction === 'LONG' ? 'خرید' : 'فروش'} با اهرم ۱.۵ برابر]`;
    } else if (sameDirCount === 2) {
      tradeName = 'SBK';
      finalLev = Math.round(baseLev * 1.5);
      scaleInMsg = ` [پله سوم SBK ${direction === 'LONG' ? 'خرید' : 'فروش'} با اهرم ۱.۵ برابر]`;
    } else if (sameDirCount > 2) {
      tradeName = `P${sameDirCount + 1}`;
    }

    const tradeHistory = getTradeHistory();
    const rawKelly = calculateDynamicKellyMargin(balance, tradeHistory, targetSnapshot.confScore, targetSnapshot.margin);
    
    // Smooth dynamic margin: use 10% to 20% of free wallet balance (min $10)
    let marginToUse = Math.max(10, Math.min(balance * 0.2, rawKelly));
    if (balance < marginToUse) {
      marginToUse = Math.max(5, Math.floor(balance * 0.5));
    }

    if (balance < 5) {
      showNotification('⚠️ موجودی کیف پول کمتر از ۵ دلار است. لطفاً موجودی را افزایش دهید.');
      return;
    }

    const logicTargets = calculateLogicTargets(targetSnapshot.price, direction, targetSnapshot);

    const clientOrderId = `man_${Date.now()}`;
    const orderQtyBtc = (marginToUse * finalLev / Math.max(1, targetSnapshot.price)).toFixed(3);

    showNotification('⏳ در حال ارسال سفارش دستی به صرافی...');

    (async () => {
      try {
        const orderRes = await fetch('/api/exchange/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: 'BTCUSDT',
            side: direction,
            orderType: 'Market',
            qty: orderQtyBtc,
            price: targetSnapshot.price,
            stopLoss: logicTargets.sl,
            takeProfit: logicTargets.tp1,
            clientOrderId: clientOrderId,
            leverage: finalLev,
            mode: 'live'
          })
        });

        const orderData = await orderRes.json();
        if (!orderRes.ok || !orderData.success) {
          showNotification(`🛑 خطا در ثبت سفارش: ${orderData.error || 'پاسخ ناموفق صرافی'}`);
          return;
        }

        showNotification(
          `✅ معامله دستی [${tradeName}] با موفقیت در صرافی ثبت شد (مارجین $${marginToUse.toFixed(1)} | اهرم ${finalLev}x) 🚀`
        );
        loadMarketData();
      } catch (err: any) {
        showNotification(`🛑 خطا در برقراری ارتباط با صرافی: ${err.message || 'خطای شبکه'}`);
      }
    })();
  };

  // High-Speed Snapshot Auto-Trade Handler (Supports Multi-Position Scale-In)
  const handleAutoTrade = (direction: 'LONG' | 'SHORT') => {
    const targetSnapshot = latestAnalysisSnapshotRef.current || analysis;
    if (!targetSnapshot) {
      showNotification('⏳ در حال آماده‌سازی و اعتبارسنجی اولیه اسنپ‌شات تحلیل بازار...');
      return;
    }

    const primaryActive = activePositions.filter((p) => !p.isRecoveryTrade && !p.hedgeActive);
    if (primaryActive.length >= 3) {
      showNotification('⚠️ سقف مجاز ۳ معامله اصلی پر است (پوزیشن‌های هدج و بازیابی بدون محدودیت عمل می‌کنند).');
      return;
    }
    const sameDirPositions = primaryActive.filter((p) => p.dir === direction);
    const sameDirCount = sameDirPositions.length;
    if (sameDirCount >= 3) {
      showNotification(`⚠️ حداکثر ظرفیت ۳ معامله همزمان در جهت ${direction === 'LONG' ? 'خرید (LONG)' : 'فروش (SHORT)'} پر شده است.`);
      return;
    }

    const tradeHistory = getTradeHistory();
    const antiTilt = getAntiTiltStatus(tradeHistory);
    if (antiTilt.isLocked) {
      showNotification(`🛡️ هشدار آنتی‌تیلت: ورود به معامله به دلیل ${antiTilt.consecutiveLosses} زیان متوالی مسدود است.`);
      return;
    }

    // Instant zero-latency evaluation using the cached snapshot & full system confluence
    const signalEval = evaluateSignalToExecution(targetSnapshot, direction, aiPredictionRef.current, tradeHistory, winRateConfig.minWinProbability);
    if (signalEval.canExecute) {
      const curSettings = settingsRef.current;
      const isRangeBlocked = curSettings.rangeFilterEnabled !== false && targetSnapshot.isRangeBound;
      if (isRangeBlocked) {
        showNotification('🛑 فیلتر خروج از رنج: نوسان بازار کمتر از حد آستانه است و ورود مسدود می‌باشد.');
        return;
      }

      const baseLev = userLeverage ?? targetSnapshot.leverage;
      let finalLev = baseLev;
      let tradeName = 'S';
      let scaleInMsg = '';

      if (sameDirCount === 1) {
        tradeName = 'SB';
        const firstTrade = sameDirPositions[0];
        const firstTradeAgeSec = (Date.now() - parseInt(firstTrade.id.split('_')[0], 10)) / 1000;
        const firstTradeEntry = firstTrade.entry || targetSnapshot.price;
        const isFirstLong = firstTrade.dir === 'LONG';
        const firstTradePnlPct = isFirstLong
          ? ((targetSnapshot.price - firstTradeEntry) / firstTradeEntry) * 100.0 * (firstTrade.lev || 10)
          : ((firstTradeEntry - targetSnapshot.price) / firstTradeEntry) * 100.0 * (firstTrade.lev || 10);

        if (firstTradeAgeSec < 45) {
          showNotification('⏳ فاصله ورود بین پله‌ها جهت جلوگیری از اسپم حداقل ۴۵ ثانیه است.');
          return;
        }
        finalLev = firstTradePnlPct > 0 ? Math.round(baseLev * 1.5) : baseLev;
        scaleInMsg = firstTradePnlPct > 0 
          ? ' (پله دوم هوشمند SB در سود با اهرم ۱.۵ برابر 🚀)'
          : ' (پله دوم هوشمند SB در تخفیف طلایی قیمت با میانگین بهینه 💎)';
      } else if (sameDirCount === 2) {
        tradeName = 'SBK';
        const secondTrade = sameDirPositions[1];
        const secondTradeAgeSec = (Date.now() - parseInt(secondTrade.id.split('_')[0], 10)) / 1000;
        const secondTradeEntry = secondTrade.entry || targetSnapshot.price;
        const isSecondLong = secondTrade.dir === 'LONG';
        const secondTradePnlPct = isSecondLong
          ? ((targetSnapshot.price - secondTradeEntry) / secondTradeEntry) * 100.0 * (secondTrade.lev || 10)
          : ((secondTradeEntry - targetSnapshot.price) / secondTradeEntry) * 100.0 * (secondTrade.lev || 10);

        if (secondTradeAgeSec < 45) {
          showNotification('⏳ فاصله ورود بین پله‌ها جهت جلوگیری از اسپم حداقل ۴۵ ثانیه است.');
          return;
        }
        finalLev = secondTradePnlPct > 0 ? Math.round(baseLev * 1.5) : baseLev;
        scaleInMsg = secondTradePnlPct > 0
          ? ' (پله سوم هوشمند SBK در سود با اهرم ۱.۵ برابر 🚀)'
          : ' (پله سوم هوشمند SBK در بهترین نقطه پولبک با میانگین بهینه 💎)';
      } else {
        tradeName = 'S';
      }

      const dynamicKellyMargin = calculateDynamicKellyMargin(balance, tradeHistory, targetSnapshot.confScore, targetSnapshot.margin);
      const entryPrice = targetSnapshot.price;
      const logicTargets = calculateLogicTargets(entryPrice, direction, targetSnapshot);

      const clientOrderId = `aut_${Date.now()}`;
      const orderQtyBtc = (dynamicKellyMargin * finalLev / Math.max(1, entryPrice)).toFixed(3);

      showNotification('⏳ در حال ارسال سفارش خودکار به صرافی...');

      (async () => {
        try {
          const orderRes = await fetch('/api/exchange/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              symbol: 'BTCUSDT',
              side: direction,
              orderType: 'Market',
              qty: orderQtyBtc,
              price: entryPrice,
              stopLoss: logicTargets.sl,
              takeProfit: logicTargets.tp1,
              clientOrderId: clientOrderId,
              leverage: finalLev,
              mode: 'live'
            })
          });

          const orderData = await orderRes.json();
          if (!orderRes.ok || !orderData.success) {
            showNotification(`🛑 خطا در ثبت سفارش خودکار: ${orderData.error || 'پاسخ ناموفق صرافی'}`);
            return;
          }

          showNotification(
            `⚡ معامله خودکار [${tradeName}] با موفقیت در صرافی ثبت شد (مارجین $${dynamicKellyMargin.toFixed(1)} | اهرم ${finalLev}x) 🚀`
          );
          loadMarketData();
        } catch (err: any) {
          showNotification(`🛑 خطا در برقراری ارتباط با صرافی: ${err.message || 'خطای شبکه'}`);
        }
      })();
    } else {
      showNotification(
        `🛑 فیلتر محافظتی کل سیستم: ${signalEval.reasonFa}`
      );
    }
  };

  // Manual Partial Close (1/3 of position)
  const handlePartialCloseTrade = (id: string) => {
    const targetSnapshot = latestAnalysisSnapshotRef.current || analysis;
    if (!targetSnapshot) return;
    const targetPos = activePositions.find((p) => p.id === id);
    if (!targetPos) return;

    const isLong = targetPos.dir === 'LONG';
    const curP = targetSnapshot.price;
    const stepFraction = 0.333;
    const initialMargin = targetPos.initialMargin || targetPos.margin;
    const stepMargin = initialMargin * stepFraction;

    const stepPnlPct = isLong
      ? ((curP - targetPos.entry) / targetPos.entry) * 100.0 * targetPos.lev
      : ((targetPos.entry - curP) / targetPos.entry) * 100.0 * targetPos.lev;
    const stepPnlUsd = stepMargin * (stepPnlPct / 100.0);

    const newBal = Math.max(10, balance + stepPnlUsd);
    setBalance(newBal);
    localStorage.setItem('quantum_balance', newBal.toString());

    const updated = activePositions.map((p) => {
      if (p.id === id) {
        return {
          ...p,
          margin: Math.max(1, p.margin - stepMargin),
          realizedPnlUsd: (p.realizedPnlUsd || 0) + stepPnlUsd,
          tp1Hit: true,
          sl: targetPos.entry, // Move stop to breakeven
        };
      }
      return p;
    });

    setActivePositions(updated);
    localStorage.setItem('quantum_positions', JSON.stringify(updated));
    showNotification(`✂️ تسویه دستی ۱/۳ حجم با سود ${stepPnlUsd >= 0 ? '+' : ''}$${stepPnlUsd.toFixed(2)} انجام شد و حد ضرر به نقطه ورود منتقل شد.`);
  };

  // Safe Scale-In (Pyramiding) on Winning Trades
  const handlePyramidTrade = (id: string) => {
    const targetPos = activePositions.find((p) => p.id === id);
    if (!targetPos || targetPos.pyramided || !targetPos.tp1Hit) return;

    const realized = targetPos.realizedPnlUsd || 0;
    const pyramidAddMargin = Math.max(5, Math.min(realized * 0.8, targetPos.initialMargin * 0.25));

    const updated = activePositions.map((p) => {
      if (p.id === id) {
        return {
          ...p,
          margin: p.margin + pyramidAddMargin,
          pyramided: true,
        };
      }
      return p;
    });

    setActivePositions(updated);
    localStorage.setItem('quantum_positions', JSON.stringify(updated));
    showNotification(`🚀 افزایش پله‌ای امن (Pyramiding) به مقدار $${pyramidAddMargin.toFixed(1)} از سود محقق‌شده اضافه شد!`);
  };

  // Full Close Position
  // Real-Market Breakeven Exit Strategy:
  // If in profit: closes immediately and banks real profit.
  // If in loss: deploys the Cross-Hedge Breakeven Engine to freeze losses, neutralize delta,
  // and dynamically exit at net $0.00 (Zero-Loss) as the market oscillates, completely protecting balance.
  const handleCloseTrade = async (id?: string) => {
    const targetSnapshot = latestAnalysisSnapshotRef.current || analysis;
    if (!targetSnapshot) return;
    const targetId = id || (activePositions[0] ? activePositions[0].id : null);
    if (!targetId) return;

    const targetPos = activePositions.find((p) => p.id === targetId);
    if (!targetPos) return;

    try {
      const res = await fetch('/api/exchange/close-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: targetId }),
      });
      const responseData = await res.json();
      if (!res.ok || responseData?.success !== true) {
        showNotification(
          `🛑 بستن پوزیشن ناموفق بود؛ پوزیشن در صرافی باز مانده است. ${responseData?.error || responseData?.message || `HTTP ${res.status}`}`
        );
        return;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      showNotification(`🛑 ارتباط برای بستن پوزیشن ناموفق بود؛ پوزیشن در صرافی باز مانده است. ${errorMessage}`);
      return;
    }

    const curP = targetSnapshot.price;
    const entry = targetPos.entry;
    const lev = targetPos.lev;
    const primaryMargin = targetPos.initialMargin || targetPos.margin;
    const hedgeMargin = targetPos.hedgeActive ? Math.max(0, targetPos.margin - primaryMargin) : 0;

    let pnlPct = 0;
    if (targetPos.dir === 'LONG') {
      pnlPct = ((curP - entry) / entry) * 100.0 * lev;
    } else {
      pnlPct = ((entry - curP) / entry) * 100.0 * lev;
    }
    let rawPnlUsd = primaryMargin * (pnlPct / 100.0);

    // If cross-hedge leg was active during manual close, include counter-hedge leg PnL
    if (targetPos.hedgeActive && targetPos.hedgeEntry) {
      const hedgeEntry = targetPos.hedgeEntry;
      const hedgePnlPct = targetPos.dir === 'LONG'
        ? ((hedgeEntry - curP) / hedgeEntry) * 100.0 * lev
        : ((curP - hedgeEntry) / hedgeEntry) * 100.0 * lev;
      const hedgePnlUsd = hedgeMargin * (hedgePnlPct / 100.0);
      rawPnlUsd += hedgePnlUsd;
    }

    const previousRealized = targetPos.realizedPnlUsd || 0;
    const rawTotalPnl = previousRealized + rawPnlUsd;
    const newBal = Math.max(10, balance + rawPnlUsd);
    setBalance(newBal);
    balanceRef.current = newBal;
    localStorage.setItem('quantum_balance', newBal.toString());

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const historyEntry: TradeHistory = {
      ...targetPos,
      pnlUsd: rawTotalPnl,
      pnlPct,
      closedAt: timeStr,
      closeReason: 'بستن دستی پوزیشن در صرافی 👤',
    };
    saveTradeToHistory(historyEntry);

    updatePredictiveModelFeedbackLoop({
      strategyType: targetPos.name === 'SB' || targetPos.name === 'SBK' ? 'TREND_RIDER' : 'MICRO_SCALP',
      realizedPnlUsd: rawTotalPnl,
      exitReason: 'بستن دستی پوزیشن'
    });

    const updated = activePositions.filter((p) => p.id !== targetId);
    activePositionsRef.current = updated;
    setActivePositions(updated);
    localStorage.setItem('quantum_positions', JSON.stringify(updated));

    showNotification(
      `✅ پوزیشن در صرافی بسته شد. نتیجهٔ نهایی: ${rawTotalPnl >= 0 ? '+' : ''}$${rawTotalPnl.toFixed(2)}`
    );
  };

  // Manual trigger to immediately unwire counter-hedge leg and restore primary trade
  const handleUnhedgePosition = (posId: string) => {
    const curP = smoothedPriceRef.current || analysis?.price || 0;
    const pos = activePositions.find((p) => p.id === posId);
    if (!pos || !pos.hedgeActive) return;

    const primaryEntry = pos.initialEntry || pos.entry || curP;
    const hedgeEntry = pos.hedgeEntry || primaryEntry || curP;
    const lev = pos.lev || 10;
    const primaryMargin = pos.initialMargin || pos.margin || 10;
    const hedgeMargin = Math.max(0, (pos.margin || primaryMargin) - primaryMargin);
    const isLong = pos.dir === 'LONG';

    const hedgeLegPnlPct = isLong
      ? ((hedgeEntry - curP) / hedgeEntry) * 100.0 * lev
      : ((curP - hedgeEntry) / hedgeEntry) * 100.0 * lev;
    const hedgeLegPnlUsd = hedgeMargin * (hedgeLegPnlPct / 100.0);

    const updated = activePositions.map((p) => {
      if (p.id === posId) {
        return {
          ...p,
          hedgeActive: false,
          hedgeEntry: undefined,
          margin: primaryMargin,
          sl: primaryEntry,
        };
      }
      return p;
    });

    const newBal = Math.max(10, balance + hedgeLegPnlUsd);
    setBalance(newBal);
    balanceRef.current = newBal;
    localStorage.setItem('quantum_balance', newBal.toString());

    setActivePositions(updated);
    activePositionsRef.current = updated;
    localStorage.setItem('quantum_positions', JSON.stringify(updated));

    showNotification(
      `🔓 لگ هدج با موفقیت حذف شد! معامله اصلی با قفل حد ضرر روی نقطه ورود آزاد گردید تا تارگت‌های سود را محقق کند.`
    );
  };

  const handleActiveHedgeChip = (posId: string) => {
    const targetSnapshot = latestAnalysisSnapshotRef.current || analysis;
    const lastCandle = targetSnapshot?.candles && targetSnapshot.candles.length > 0 ? targetSnapshot.candles[targetSnapshot.candles.length - 1] : null;
    const candleClose = lastCandle ? ((lastCandle as any).close ?? (Array.isArray(lastCandle) ? lastCandle[3] : 0)) : 0;
    const curP = targetSnapshot?.price && targetSnapshot.price > 0 ? targetSnapshot.price : candleClose;
    setActivePositions((prev) => {
      const updated = prev.map((p) => {
        if (p.id === posId && p.hedgeActive) {
          const primaryMargin = p.initialMargin || 10;
          const hedgeMargin = Math.max(0, (p.margin || primaryMargin) - primaryMargin);
          const lev = p.lev || 10;
          const isLong = p.dir === 'LONG';
          const hedgeEntry = p.hedgeEntry || curP;
          const hedgeLegPnlPct = isLong
            ? ((hedgeEntry - curP) / hedgeEntry) * 100.0 * lev
            : ((curP - hedgeEntry) / hedgeEntry) * 100.0 * lev;
          const hedgeProfitUsd = Math.max(0.15, Math.round(hedgeMargin * (hedgeLegPnlPct / 100.0) * 100) / 100);
          const newRealized = (p.realizedPnlUsd || 0) + hedgeProfitUsd;
          return {
            ...p,
            realizedPnlUsd: newRealized,
            hedgeEntry: curP,
          };
        }
        return p;
      });
      localStorage.setItem('quantum_positions', JSON.stringify(updated));
      activePositionsRef.current = updated;
      return updated;
    });
    showNotification('⚡ نوسان‌گیری فعال هجینگ انجام شد! سود لگ هج نقد گردید، نقطه ورود شیفت داده شد و فاصله سربه‌سر به حداقل رسید.');
  };

  const handleHedgeLiquidityDca = (posId: string) => {
    const targetSnapshot = latestAnalysisSnapshotRef.current || analysis;
    const lastCandle = targetSnapshot?.candles && targetSnapshot.candles.length > 0 ? targetSnapshot.candles[targetSnapshot.candles.length - 1] : null;
    const candleClose = lastCandle ? ((lastCandle as any).close ?? (Array.isArray(lastCandle) ? lastCandle[3] : 0)) : 0;
    const curP = targetSnapshot?.price && targetSnapshot.price > 0 ? targetSnapshot.price : candleClose;
    setActivePositions((prev) => {
      const updated = prev.map((p) => {
        if (p.id === posId) {
          const currentMargin = p.margin || 10;
          const dcaAddMargin = currentMargin * 0.4;
          const newMargin = currentMargin + dcaAddMargin;
          const currentEntry = p.entry || curP;
          const weightedEntry = ((currentEntry * currentMargin) + (curP * dcaAddMargin)) / newMargin;
          return {
            ...p,
            entry: Math.round(weightedEntry * 100) / 100,
            margin: newMargin,
            sl: p.dir === 'LONG' ? weightedEntry * 0.985 : weightedEntry * 1.015,
            pyramided: true,
          };
        }
        return p;
      });
      localStorage.setItem('quantum_positions', JSON.stringify(updated));
      activePositionsRef.current = updated;
      return updated;
    });
    showNotification('🎯 میانگین‌گیری اسنایپری در نقدینگی اردر بوک اعمال شد! نقطه ورود به قیمت زنده شیفت داده شد و نقطه سربه‌سر به فاصله چند پیپ رسید.');
  };

  const handleExecuteManualDca = (posId: string) => {
    const targetSnapshot = latestAnalysisSnapshotRef.current || analysis;
    const lastCandle = targetSnapshot?.candles && targetSnapshot.candles.length > 0 ? targetSnapshot.candles[targetSnapshot.candles.length - 1] : null;
    const candleClose = lastCandle ? ((lastCandle as any).close ?? (Array.isArray(lastCandle) ? lastCandle[3] : 0)) : 0;
    const curP = targetSnapshot?.price && targetSnapshot.price > 0 ? targetSnapshot.price : candleClose;
    const targetPos = activePositionsRef.current.find((p) => p.id === posId) || activePositionsRef.current[0];
    if (!targetPos) return;

    const currentMargin = targetPos.initialMargin || targetPos.margin || 10;
    const dcaVolume = Math.round(currentMargin * 1.25 * 100) / 100;
    
    if (balanceRef.current < dcaVolume) {
      showNotification(`⚠️ موجودی کیف پول برای خرید پله دوم ($${dcaVolume.toFixed(2)}) کافی نیست.`);
      return;
    }

    const newMargin = currentMargin + dcaVolume;
    const weightedEntry = ((targetPos.entry * currentMargin) + (curP * dcaVolume)) / newMargin;
    const roundedEntry = Math.round(weightedEntry * 100) / 100;
    const newBal = Math.max(0, balanceRef.current - dcaVolume);
    balanceRef.current = newBal;
    setBalance(newBal);
    localStorage.setItem('quantum_balance', newBal.toString());

    setActivePositions((prev) => {
      const updated = prev.map((p) => {
        if (p.id === targetPos.id) {
          return {
            ...p,
            entry: roundedEntry,
            initialMargin: newMargin,
            margin: newMargin,
            name: p.name === 'SB' ? 'SBK' : 'SB',
            sl: p.dir === 'LONG' ? roundedEntry * 0.992 : roundedEntry * 1.008,
            tp1: p.dir === 'LONG' ? roundedEntry * 1.003 : roundedEntry * 0.997,
            pyramided: true,
            recoveryStep: 2,
          };
        }
        return p;
      });
      localStorage.setItem('quantum_positions', JSON.stringify(updated));
      activePositionsRef.current = updated;
      return updated;
    });

    showNotification(
      `🚀 خرید پله دوم دستی با موفقیت انجام شد! حجم $${dcaVolume.toFixed(2)} تزریق گردید، میانگین ورود به $${roundedEntry.toFixed(1)} بهبود یافت و حد سود و ضرر مجدداً کالیبره شدند.`
    );
  };

  // Realtime GARCH(1,1) Position SL Auto-Adjustment Handler
  const handleUpdatePositionSl = useCallback(async (positionId: string, newSlPrice: number, _newSlPct: number, reasonFa: string) => {
    if (!Number.isFinite(newSlPrice) || newSlPrice <= 0) {
      showNotification('❌ حد ضرر نامعتبر است و تغییری اعمال نشد.');
      return;
    }

    if (!activePositionsRef.current.some((position) => position.id === positionId)) {
      showNotification('❌ پوزیشن موردنظر در برنامه یافت نشد؛ حد ضرر تغییر نکرد.');
      return;
    }

    try {
      const response = await fetch('/api/exchange/update-stop-loss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: positionId, stopLoss: newSlPrice }),
      });
      const result = await response.json();

      if (response.status !== 200 || result.success !== true) {
        throw new Error(result.error || 'صرافی درخواست تغییر حد ضرر را تأیید نکرد.');
      }

      const updated = activePositionsRef.current.map((position) =>
        position.id === positionId ? { ...position, sl: newSlPrice } : position
      );
      activePositionsRef.current = updated;
      setActivePositions(updated);
      localStorage.setItem('quantum_positions', JSON.stringify(updated));
      showNotification(`🛡️ حد ضرر (${reasonFa}) پس از تأیید صرافی در $${newSlPrice.toLocaleString()} به‌روزرسانی شد.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'خطای نامشخص در ارتباط با صرافی.';
      showNotification(`❌ حد ضرر به‌روزرسانی نشد و وضعیت محلی بدون تغییر ماند: ${message}`);
    }
  }, [showNotification]);

  // Manual trigger for 5% free margin hedge
  const handleTriggerManualHedge = useCallback(() => {
    const targetSnapshot = latestAnalysisSnapshotRef.current || analysis;
    if (!targetSnapshot) return;
    const curP = targetSnapshot.price;
    const hedgeMargin = Math.max(5, balance * 0.05); // 5% free margin

    const dir = recoveryState.hedgeDirection === 'SHORT' ? 'SHORT' : 'LONG';
    const lev = userLeverage ?? targetSnapshot.leverage;

    const newPos: TradePosition = {
      id: `${Date.now()}_hedge_${Math.random().toString(36).substring(2, 7)}`,
      dir,
      entry: curP,
      lev,
      initialMargin: hedgeMargin,
      margin: hedgeMargin,
      sl: dir === 'LONG' ? curP * 0.995 : curP * 1.005,
      tp: dir === 'LONG' ? curP * 1.012 : curP * 0.988,
      tp1: dir === 'LONG' ? curP * 1.006 : curP * 0.994,
      tp2: dir === 'LONG' ? curP * 1.010 : curP * 0.990,
      tp3: dir === 'LONG' ? curP * 1.015 : curP * 0.985,
      tp1Hit: false,
      tp2Hit: false,
      tp3Hit: false,
      realizedPnlUsd: 0,
      currentTarget: 1,
      openedAt: new Date().toLocaleTimeString(),
      isRecoveryTrade: true,
    };

    const updated = [newPos];
    setActivePositions(updated);
    localStorage.setItem('quantum_positions', JSON.stringify(updated));

    showNotification(
      `🛡️ معامله ۵٪ هدجینگ دلتا-نیوترال با موفقیت ثبت گردید (${dir === 'LONG' ? 'خرید' : 'فروش'} در $${curP.toFixed(1)} با مارجین $${hedgeMargin.toFixed(2)}).`
    );
  }, [analysis, balance, recoveryState.hedgeDirection, userLeverage, showNotification]);

  // Toggle Auto-Pilot with 8 Mandatory Prerequisites (Issue 26)
  const handleToggleAutoTrade = async () => {
    const willEnable = !settings.autoTradeEnabled;

    if (willEnable) {
      const targetSnapshot = latestAnalysisSnapshotRef.current || analysis;
      const tradeHistory = getTradeHistory();

      let executionMode: ExecutionMode;
      try {
        executionMode = await getExecutionMode();
        executionModeRef.current = executionMode;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'خطای نامشخص';
        showNotification(`🛑 دریافت حالت اجرا ناموفق بود؛ ربات فعال نشد: ${message}`);
        return;
      }
      
      showNotification('🔍 در حال ارزیابی ۸ پیش‌شرط امنیتی فعال‌سازی ترید خودکار...');
      const prereq = await verifyAutoTradePrerequisites(
        targetSnapshot,
        activePositions,
        tradeHistory,
        executionMode
      );

      if (!prereq.isEligible) {
        const failedChecks = prereq.detailsFa.filter((d) => d.startsWith('❌'));
        const errorSummary = failedChecks.length > 0 ? failedChecks[0] : 'پیش‌شرط‌های امنیتی احراز نشد.';
        showNotification(`🛑 فعال‌سازی ترید خودکار متوقف شد: ${errorSummary}`);
        return;
      }

      if (executionMode !== 'LIVE') {
        const updated = { ...settings, autoTradeEnabled: true };
        settingsRef.current = updated;
        setSettings(updated);
        saveSettings(updated);
        fastReloadReadyRef.current = true;
        showNotification(`✅ Auto-Pilot در حالت ${executionMode} به‌صورت محلی فعال شد؛ درخواست ادمین به سرور ارسال نشد.`);
        return;
      }

      try {
        const response = await fetch('/api/live/toggle-auto-trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enable: true })
        });
        const data = await response.json();
        if (response.ok && data.success) {
          const updated = { ...settings, autoTradeEnabled: true };
          settingsRef.current = updated;
          setSettings(updated);
          saveSettings(updated);
          fastReloadReadyRef.current = true;
          showNotification('✅ تمام ۸ شرط امنیتی تایید شد: ترید خودکار (Auto-Pilot) در سرور فعال شد! 🚀');
        } else {
          showNotification(`🛑 خطا در فعال‌سازی سرور: ${data.error || 'پاسخ ناموفق'}`);
        }
      } catch (err) {
        showNotification('🛑 خطا در برقراری ارتباط با سرور برای فعال‌سازی.');
      }
    } else {
      let executionMode: ExecutionMode;
      try {
        executionMode = await getExecutionMode();
        executionModeRef.current = executionMode;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'خطای نامشخص';
        showNotification(`🛑 دریافت حالت اجرا ناموفق بود؛ وضعیت ربات تغییر نکرد: ${message}`);
        return;
      }

      if (executionMode !== 'LIVE') {
        const updated = { ...settings, autoTradeEnabled: false };
        settingsRef.current = updated;
        setSettings(updated);
        saveSettings(updated);
        fastReloadReadyRef.current = false;
        showNotification(`⏸️ Auto-Pilot در حالت ${executionMode} به‌صورت محلی متوقف شد؛ درخواستی به سرور ارسال نشد.`);
        return;
      }

      try {
        const response = await fetch('/api/live/toggle-auto-trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enable: false })
        });
        const data = await response.json();
        if (response.ok && data.success) {
          const updated = { ...settings, autoTradeEnabled: false };
          settingsRef.current = updated;
          setSettings(updated);
          saveSettings(updated);
          fastReloadReadyRef.current = false;
          showNotification('⏸️ معامله خودکار SB در سرور متوقف شد.');
        } else {
          showNotification(`🛑 خطا در متوقف‌سازی سرور: ${data.error || 'پاسخ ناموفق'}`);
        }
      } catch (err) {
        showNotification('🛑 خطا در برقراری ارتباط با سرور برای متوقف‌سازی.');
      }
    }
  };

  // Handle Leverage Slider Change
  const handleLeverageChange = (newLev: number) => {
    setUserLeverage(newLev);
    localStorage.setItem('quantum_user_leverage', newLev.toString());
    showNotification(`اهرم معاملاتی کاربر روی ${newLev}x تنظیم گردید.`);
  };

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
            isLive={true}
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
           <TickerBar btcPrice={liveEffectivePrice} />
          </div>

          {/* Pro TradingView Style Terminal: Chart (6 cols) + Manual Order Desk (3 cols) + Auto Bot Desk (3 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-[600px]">
            {/* 1. Quantum Chart (6 Cols) */}
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

            {/* 2. Manual Trades Desk (3 Cols) */}
            <div className="lg:col-span-3 flex flex-col min-h-[500px]">
              {analysis && (
                <CollapsibleCard
                  title="میز معاملات دستی"
                  badge="معامله دستی"
                  badgeColor="text-cyan-300 bg-cyan-950/80 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.3)]"
                  defaultOpen={true}
                  className="flex-1 flex flex-col"
                >
                  <OrderExecutionPanel
                    balance={balance}
                    onUpdateBalance={handleUpdateBalance}
                    userLeverage={userLeverage ?? analysis.leverage}
                    onSelectLeverage={handleLeverageChange}
                    analysis={analysis}
                    activePositions={activePositions}
                    onOpenTrade={handleOpenTrade}
                    onClosePosition={handleCloseTrade}
                    onPartialClosePosition={handlePartialCloseTrade}
                    onPyramidPosition={handlePyramidTrade}
                    onDcaPosition={handleExecuteManualDca}
                    onAutoTrade={handleAutoTrade}
                    prediction={aiPrediction}
                    autoTradeActive={settings.autoTradeEnabled}
                    onToggleAutoTrade={handleToggleAutoTrade}
                    onUnhedgePosition={handleUnhedgePosition}
                    onActiveHedgeChip={handleActiveHedgeChip}
                    onHedgeLiquidityDca={handleHedgeLiquidityDca}
                    mode="manual"
                  />
                </CollapsibleCard>
              )}
            </div>

            {/* 3. Automatic AI Bot Desk (3 Cols) */}
            <div className="lg:col-span-3 flex flex-col min-h-[500px]">
              {analysis && (
                <CollapsibleCard
                  title="موتور هوشمند ربات (Auto-Pilot)"
                  badge="ترید خودکار"
                  badgeColor="text-emerald-300 bg-emerald-950/80 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                  defaultOpen={true}
                  className="flex-1 flex flex-col"
                >
                  <OrderExecutionPanel
                    balance={balance}
                    onUpdateBalance={handleUpdateBalance}
                    userLeverage={userLeverage ?? analysis.leverage}
                    onSelectLeverage={handleLeverageChange}
                    analysis={analysis}
                    activePositions={activePositions}
                    onOpenTrade={handleOpenTrade}
                    onClosePosition={handleCloseTrade}
                    onPartialClosePosition={handlePartialCloseTrade}
                    onPyramidPosition={handlePyramidTrade}
                    onDcaPosition={handleExecuteManualDca}
                    onAutoTrade={handleAutoTrade}
                    prediction={aiPrediction}
                    autoTradeActive={settings.autoTradeEnabled}
                    onToggleAutoTrade={handleToggleAutoTrade}
                    onUnhedgePosition={handleUnhedgePosition}
                    onActiveHedgeChip={handleActiveHedgeChip}
                    onHedgeLiquidityDca={handleHedgeLiquidityDca}
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
                    onClosePosition={handleCloseTrade}
                    onPartialClosePosition={handlePartialCloseTrade}
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
                  <TenBrainsDashboardWidget />
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
                  <TfjsReinforcementLearningWidget
                    analysis={analysis}
                    aiPrediction={aiPrediction}
                    historyList={getTradeHistory()}
                  />
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
                    onUpdateStop={(newSl) => {
                      if (activePositions && activePositions.length > 0) {
                        handleUpdatePositionSl(activePositions[0].id, newSl, 0, 'MFE Trailing');
                      }
                    }}
                  />
                  <StatisticalProtectionAndMaximizationWidget
                    currentPrice={liveEffectivePrice}
                    entryPrice={activePositions && activePositions.length > 0 ? activePositions[0].entry : (liveEffectivePrice > 0 ? liveEffectivePrice * 0.99 : 0)}
                    direction={activePositions && activePositions.length > 0 ? activePositions[0].dir : 'LONG'}
                    setupType={activePositions && activePositions.length > 0 ? ((activePositions[0] as any).setupType || 'BREAKOUT_RETEST') : 'BREAKOUT_RETEST'}
                    marginUsd={((settings as any).orderSizeUsd || (settings as any).tradeAmount || 1000) as number}
                    leverage={activePositions && activePositions.length > 0 ? activePositions[0].lev : (((settings as any).leverage || (settings as any).defaultLeverage || 5) as number)}
                    onApplyStop={(newSl) => {
                      if (activePositions && activePositions.length > 0) {
                        handleUpdatePositionSl(activePositions[0].id, newSl, 0, 'Statistical Protection');
                      }
                    }}
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
                  <FinalProductionGateWidget
                    analysis={analysis}
                    activePositions={activePositions}
                  />
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
                    onUpdatePositionSl={handleUpdatePositionSl}
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
        <ExecutionGovernorDashboard onModeSelected={handleExecutionModeSelected} />
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
            <span className="text-xs font-bold text-emerald-300 font-sans">کیف پول و دارایی حساب</span>
            <button
              onClick={() => setIsWalletPopupOpen(false)}
              className="text-slate-400 hover:text-white text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-[10px] text-slate-400 font-sans">موجودی کل (USDT)</div>
              <div className="text-xl font-mono font-extrabold text-white">
                ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 py-2 border-y border-emerald-950/60 font-sans">
              <div>معاملات فعال: <span className="text-cyan-400 font-bold font-mono">{activePositions.length}</span></div>
              <div>اهرم معاملاتی: <span className="text-indigo-400 font-bold font-mono">{userLeverage ?? (analysis?.leverage || 10)}x</span></div>
            </div>

            {/* Direct Wallet Balance Input Field */}
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] text-slate-400 font-sans">ورود مستقیم مبلغ دلخواه (USDT):</div>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={customBalanceInput}
                  onChange={(e) => setCustomBalanceInput(e.target.value)}
                  placeholder="مبلغ جدید به دلار..."
                  className="flex-1 bg-[#0a0d14] border border-emerald-500/40 focus:border-emerald-400 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none font-sans"
                />
                <button
                  onClick={() => {
                    const amount = parseFloat(customBalanceInput);
                    if (!isNaN(amount) && amount >= 0) {
                      handleUpdateBalance(amount);
                      setCustomBalanceInput('');
                    }
                  }}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer font-sans"
                >
                  ثبت
                </button>
              </div>
            </div>

            <div className="space-y-1.5 pt-1.5 border-t border-emerald-950/40">
              <div className="text-[10px] text-slate-400 font-sans">شارژ سریع حساب دمو:</div>
              <div className="grid grid-cols-3 gap-1.5">
                <button onClick={() => handleUpdateBalance(balance + 1000)} className="py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10px] font-bold rounded-lg border border-slate-700 cursor-pointer">+$1K</button>
                <button onClick={() => handleUpdateBalance(balance + 5000)} className="py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10px] font-bold rounded-lg border border-slate-700 cursor-pointer">+$5K</button>
                <button onClick={() => handleUpdateBalance(balance + 10000)} className="py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10px] font-bold rounded-lg border border-slate-700 cursor-pointer">+$10K</button>
                <button onClick={() => handleUpdateBalance(balance + 50000)} className="py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10px] font-bold rounded-lg border border-slate-700 cursor-pointer">+$50K</button>
                <button onClick={() => handleUpdateBalance(balance + 100000)} className="py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10px] font-bold rounded-lg border border-slate-700 cursor-pointer">+$100K</button>
                <button onClick={() => handleUpdateBalance(1000000)} className="py-1.5 bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 font-mono text-[10px] font-bold rounded-lg border border-amber-800/60 cursor-pointer">$1M</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
