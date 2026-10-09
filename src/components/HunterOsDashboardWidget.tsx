import React, { useState, useEffect, useMemo } from 'react';
import {
  AnalysisResult,
  TradePosition,
  TradeHistory,
  HunterRingStatus,
  EdgeDecayRadarMetrics,
  WaveDnaSignature,
  WaveDnaDatabaseReport,
  HunterEpisodicMemoryRecord,
  HunterMemoryInsights,
  CounterfactualAnalysis,
} from '../types/trading';
import { hunterOsEngine } from '../services/hunterOsEngine';
import {
  Shield,
  Crosshair,
  Activity,
  Flame,
  Radio,
  Dna,
  Zap,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  ArrowRight,
  Eye,
  Radar,
  RefreshCw,
  LogOut,
  Sliders,
  BookOpen,
  Sparkles,
  Target,
  Split,
  Award,
  HelpCircle,
  Check,
  Compass,
} from 'lucide-react';

interface HunterOsDashboardWidgetProps {
  analysis: AnalysisResult | null;
  activePositions: TradePosition[];
  tradeHistory?: TradeHistory[];
  onClosePosition?: (positionId: string, reason?: string) => void;
  onPartialClosePosition?: (positionId: string, percentage: number) => void;
}

export const HunterOsDashboardWidget: React.FC<HunterOsDashboardWidgetProps> = ({
  analysis,
  activePositions,
  tradeHistory = [],
  onClosePosition,
  onPartialClosePosition,
}) => {
  const [activeTab, setActiveTab] = useState<'RINGS' | 'RADAR' | 'DNA' | 'MEMORY'>('RINGS');
  const [simElapsedSeconds, setSimElapsedSeconds] = useState(480);
  const [refreshTicker, setRefreshTicker] = useState(0);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);

  // Position currently tracked (or null)
  const currentPos = activePositions && activePositions.length > 0 ? activePositions[0] : null;

  // Auto increment simulated wave timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSimElapsedSeconds((prev) => prev + 5);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Compute 7 Rings
  const rings: HunterRingStatus[] = useMemo(() => {
    return hunterOsEngine.evaluateSevenRings(analysis, currentPos, tradeHistory);
  }, [analysis, currentPos, tradeHistory, refreshTicker]);

  // Compute Edge Decay Radar
  const edgeRadar: EdgeDecayRadarMetrics = useMemo(() => {
    return hunterOsEngine.evaluateEdgeDecayRadar(currentPos, analysis);
  }, [currentPos, analysis, refreshTicker]);

  // Compute Live Wave DNA
  const liveWaveDna: WaveDnaSignature = useMemo(() => {
    return hunterOsEngine.extractLiveWaveDna(analysis, currentPos, simElapsedSeconds);
  }, [analysis, currentPos, simElapsedSeconds, refreshTicker]);

  // Match with Wave DNA Database
  const waveReport: WaveDnaDatabaseReport = useMemo(() => {
    return hunterOsEngine.matchWaveDnaSimilarity(liveWaveDna, 15);
  }, [liveWaveDna, refreshTicker]);

  // Hunter Episodic Memory Insights
  const memoryInsights: HunterMemoryInsights = useMemo(() => {
    return hunterOsEngine.getHunterMemoryInsights();
  }, [refreshTicker]);

  const selectedMemory = useMemo(() => {
    if (!selectedMemoryId && memoryInsights.memories.length > 0) {
      return memoryInsights.memories[0];
    }
    return memoryInsights.memories.find((m) => m.memoryId === selectedMemoryId) || memoryInsights.memories[0] || null;
  }, [selectedMemoryId, memoryInsights]);

  // Handle Manual Save to Wave DNA Dataset
  const handleSaveCurrentWave = () => {
    const finalizedDna: WaveDnaSignature = {
      ...liveWaveDna,
      dnaId: `DNA_${Date.now().toString(36).toUpperCase()}`,
      outcome: edgeRadar.currentEvR >= 0.3 ? 'CONTINUED' : edgeRadar.currentEvR <= -0.1 ? 'FAILED' : 'REVERSED',
      actualRealizedR: Number(edgeRadar.currentEvR.toFixed(2)),
    };
    hunterOsEngine.recordCompletedWaveDna(finalizedDna);
    setRefreshTicker((prev) => prev + 1);
  };

  // Run live simulation on active position if exists
  const activePositionSim: CounterfactualAnalysis | null = useMemo(() => {
    if (!currentPos) return null;
    const pseudoHistory: TradeHistory = {
      ...currentPos,
      pnlUsd: currentPos.realizedPnlUsd || ((analysis?.price ? (currentPos.dir === 'LONG' ? analysis.price - currentPos.entry : currentPos.entry - analysis.price) : 0) * (currentPos.initialMargin / currentPos.entry) * currentPos.lev),
      pnlPct: 0,
      closedAt: new Date().toLocaleTimeString(),
      exitPrice: analysis?.price || currentPos.entry,
    };
    return hunterOsEngine.runCounterfactualSimulation(pseudoHistory, analysis);
  }, [currentPos, analysis]);

  return (
    <div className="w-full bg-slate-900/90 border border-amber-500/30 rounded-xl p-4 sm:p-5 text-slate-100 shadow-2xl backdrop-blur-md flex flex-col gap-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/50 rounded-xl text-amber-400 shadow-inner">
            <Crosshair className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black tracking-wide bg-gradient-to-r from-amber-400 via-orange-300 to-yellow-200 bg-clip-text text-transparent">
                HUNTER OS • معماری شکارچی هفت‌حلقه
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase">
                V5.0 Engine
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Scout → Prepare → Ambush → Confirm → Snipe → Ride → Protect → Harvest → Learn
            </p>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/80 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveTab('RINGS')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              activeTab === 'RINGS'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30 font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>۷ حلقه شکارچی</span>
          </button>
          <button
            onClick={() => setActiveTab('RADAR')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              activeTab === 'RADAR'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30 font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radar className="w-3.5 h-3.5" />
            <span>رادار زوال لبه (Decay)</span>
          </button>
          <button
            onClick={() => setActiveTab('DNA')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              activeTab === 'DNA'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30 font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Dna className="w-3.5 h-3.5" />
            <span>ژنوم موج (Wave DNA)</span>
          </button>
          <button
            onClick={() => setActiveTab('MEMORY')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              activeTab === 'MEMORY'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 shadow-md shadow-emerald-500/30 font-black'
                : 'text-emerald-400/80 hover:text-emerald-300'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>حافظه درسی و Counterfactual</span>
          </button>
        </div>
      </div>


      {/* --------------------------------------------------------------------- */}
      {/* TAB 1: 7 RINGS HUNTER ARCHITECTURE */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'RINGS' && (
        <div className="flex flex-col gap-4">
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <span className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-400" />
              <strong>وضعیت عملیاتی شکارچی:</strong> عدم اقدام تصادفی — عبور گام‌به‌گام از اسکن تا یادگیری موج
            </span>
            <span className="text-slate-400 font-mono text-[11px]">
              Active Position: {currentPos ? `${currentPos.dir} @ $${currentPos.entry}` : 'بدون پوزیشن باز (در حالت Ambush/Scout)'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {rings.map((ring, idx) => {
              const isCurrentRider = ring.ringId === 'WAVE_RIDER' && currentPos;
              const isExitTriggered = ring.ringId === 'EXIT_LEARN' && edgeRadar.recommendedAction !== 'HOLD';

              return (
                <div
                  key={ring.ringId}
                  className={`relative p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-2 ${
                    isExitTriggered
                      ? 'bg-rose-950/40 border-rose-500/60 shadow-lg shadow-rose-950/50'
                      : isCurrentRider
                      ? 'bg-emerald-950/40 border-emerald-500/60 shadow-lg shadow-emerald-950/50'
                      : ring.isComplete
                      ? 'bg-slate-950/80 border-slate-700/80'
                      : 'bg-slate-950/40 border-slate-800/40 opacity-70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-amber-400 font-bold">
                      RING #{idx + 1}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        ring.isComplete
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {ring.metricValue}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                      {ring.nameFa}
                    </h3>
                    <p className="text-[11px] text-amber-300/80 font-medium">{ring.stageNameFa}</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">{ring.statusTextFa}</p>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden mt-2">
                    <div
                      className={`h-full transition-all duration-500 ${
                        ring.score >= 80 ? 'bg-emerald-500' : ring.score >= 50 ? 'bg-amber-500' : 'bg-slate-600'
                      }`}
                      style={{ width: `${ring.score}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hunter Pipeline Sequence Strip */}
          <div className="bg-slate-950/90 p-3 rounded-xl border border-slate-800 flex items-center justify-between overflow-x-auto text-xs font-mono text-slate-400">
            <span className="text-emerald-400 font-bold">Scout</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mx-1" />
            <span className="text-emerald-400 font-bold">Prepare</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mx-1" />
            <span className="text-amber-400 font-bold">Ambush</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mx-1" />
            <span className="text-amber-400 font-bold">Confirm</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mx-1" />
            <span className="text-cyan-400 font-bold">Snipe</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mx-1" />
            <span className="text-purple-400 font-bold">Ride</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mx-1" />
            <span className="text-indigo-400 font-bold">Protect</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mx-1" />
            <span className="text-orange-400 font-bold">Harvest</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mx-1" />
            <span className="text-rose-400 font-bold">Learn</span>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 2: EDGE DECAY RADAR */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'RADAR' && (
        <div className="flex flex-col gap-4">
          {/* Main Action Banner */}
          <div
            className={`p-4 rounded-xl border flex flex-col md:flex-row items-center justify-between gap-4 transition-all ${
              edgeRadar.recommendedAction === 'EXIT'
                ? 'bg-rose-950/60 border-rose-500/80 text-rose-200'
                : edgeRadar.recommendedAction === 'REDUCE'
                ? 'bg-amber-950/60 border-amber-500/80 text-amber-200'
                : 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`p-3 rounded-xl border ${
                  edgeRadar.recommendedAction === 'EXIT'
                    ? 'bg-rose-900/40 border-rose-500 text-rose-300'
                    : edgeRadar.recommendedAction === 'REDUCE'
                    ? 'bg-amber-900/40 border-amber-500 text-amber-300'
                    : 'bg-emerald-900/40 border-emerald-500 text-emerald-300'
                }`}
              >
                {edgeRadar.recommendedAction === 'EXIT' ? (
                  <AlertTriangle className="w-7 h-7 animate-bounce" />
                ) : edgeRadar.recommendedAction === 'REDUCE' ? (
                  <Sliders className="w-7 h-7" />
                ) : (
                  <Shield className="w-7 h-7" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase font-mono tracking-wider font-bold opacity-80">
                    فرمان بدون‌تعصب رادار:
                  </span>
                  <span
                    className={`text-lg font-black px-2.5 py-0.5 rounded ${
                      edgeRadar.recommendedAction === 'EXIT'
                        ? 'bg-rose-500 text-slate-950 font-black'
                        : edgeRadar.recommendedAction === 'REDUCE'
                        ? 'bg-amber-500 text-slate-950 font-black'
                        : 'bg-emerald-500 text-slate-950 font-black'
                    }`}
                  >
                    {edgeRadar.recommendedAction}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-black/40 border border-current">
                    Urgency: {edgeRadar.urgencyLevel}
                  </span>
                </div>
                <p className="text-xs mt-1.5 max-w-2xl leading-relaxed">{edgeRadar.actionReasonFa}</p>
              </div>
            </div>

            {/* Quick Execution Buttons */}
            {currentPos && (
              <div className="flex items-center gap-2 shrink-0">
                {edgeRadar.recommendedAction === 'REDUCE' && onPartialClosePosition && (
                  <button
                    onClick={() => onPartialClosePosition(currentPos.id, 50)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-lg transition-all shadow-md"
                  >
                    سیو سود و کاهش ۵۰٪ حجم
                  </button>
                )}
                {onClosePosition && (
                  <button
                    onClick={() => onClosePosition(currentPos.id, `Edge Decay: ${edgeRadar.recommendedAction}`)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black rounded-lg transition-all shadow-md shadow-rose-900/50"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>خروج فوری از معامله</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Metrics Comparison Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Entry Edge Box */}
            <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-mono">1. لبه اولیه (Entry Edge)</span>
              <div className="mt-2 flex items-baseline justify-between">
                <div>
                  <span className="text-2xl font-black text-cyan-400">{edgeRadar.entryProbabilityPct}%</span>
                  <p className="text-[10px] text-slate-400">احتمال تاییدیه ورود</p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black text-emerald-400">+{edgeRadar.entryEvR}R</span>
                  <p className="text-[10px] text-slate-400">امید ریاضی (EV)</p>
                </div>
              </div>
            </div>

            {/* Current Edge Box */}
            <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-mono">2. لبه لحظه‌ای (Current Edge)</span>
              <div className="mt-2 flex items-baseline justify-between">
                <div>
                  <span
                    className={`text-2xl font-black ${
                      edgeRadar.currentProbabilityPct >= 65 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {edgeRadar.currentProbabilityPct}%
                  </span>
                  <p className="text-[10px] text-slate-400">احتمال فعال فعلی</p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-xl font-black ${
                      edgeRadar.currentEvR >= 0.25
                        ? 'text-emerald-400'
                        : edgeRadar.currentEvR > 0
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {edgeRadar.currentEvR >= 0 ? `+${edgeRadar.currentEvR}R` : `${edgeRadar.currentEvR}R`}
                  </span>
                  <p className="text-[10px] text-slate-400">امید ریاضی لحظه‌ای</p>
                </div>
              </div>
            </div>

            {/* Decay Ratio Box */}
            <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-mono">3. نسبت بقای لبه (Edge Retained)</span>
              <div className="mt-2 flex items-baseline justify-between">
                <span
                  className={`text-2xl font-black ${
                    edgeRadar.decayRatioPct >= 70
                      ? 'text-emerald-400'
                      : edgeRadar.decayRatioPct >= 40
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  {edgeRadar.decayRatioPct}%
                </span>
                <span className="text-xs font-mono text-slate-400">
                  ΔEV: {edgeRadar.evDeltaR >= 0 ? `+${edgeRadar.evDeltaR}R` : `${edgeRadar.evDeltaR}R`}
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden mt-2">
                <div
                  className={`h-full ${
                    edgeRadar.decayRatioPct >= 70 ? 'bg-emerald-500' : edgeRadar.decayRatioPct >= 40 ? 'bg-amber-500' : 'bg-rose-500'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, edgeRadar.decayRatioPct))}%` }}
                />
              </div>
            </div>

            {/* Momentum & Adverse Pressure */}
            <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-mono">4. فرسایش مومنتوم و فشار</span>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-slate-400">فرسایش مومنتوم:</span>
                <span className="font-mono text-amber-400 font-bold">{edgeRadar.momentumErosionPct}%</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-slate-400">فشار معکوس سفارشات:</span>
                <span className="font-mono text-rose-400 font-bold">{edgeRadar.adversePressurePct}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 3: WAVE DNA & GENOMIC SIMILARITY MATCHING */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'DNA' && (
        <div className="flex flex-col gap-4">
          {/* Wave Matching Result Card */}
          <div className="p-4 bg-slate-950/80 border border-cyan-500/40 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-lg shadow-cyan-950/30">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/40 rounded-xl text-cyan-400">
                <Dna className="w-6 h-6 animate-spin" style={{ animationDuration: '10s' }} />
              </div>
              <div>
                <h3 className="text-sm font-black text-cyan-300">
                  شناسایی و تطبیق ژنومی با دیتابیس امواج (Wave DNA Matcher)
                </h3>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  {waveReport.verdictFa}
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs font-mono">
                  <span className="text-slate-400">
                    کل امواج ثبت‌شده در دیتابیس: <strong className="text-white">{waveReport.totalWavesInDataset}</strong>
                  </span>
                  <span className="text-emerald-400">
                    موفق (ادامه موج): <strong>{waveReport.continuationCount}</strong> ({waveReport.continuationRatePct ?? 0}%)
                  </span>
                  <span className="text-rose-400">
                    ناموفق (شکست یا بازگشت): <strong>{waveReport.failedCount}</strong> ({waveReport.failureRatePct ?? 0}%)
                  </span>
                  {waveReport.averageMfeR !== null && (
                    <span className="text-cyan-400">
                      میانگین MFE: <strong>+{waveReport.averageMfeR}R</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={handleSaveCurrentWave}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-black rounded-lg transition-all shadow-md shrink-0"
            >
              <Database className="w-3.5 h-3.5" />
              <span>ثبت موج در دیتابیس ژنومی</span>
            </button>
          </div>

          {/* Current Live Wave DNA Signature Details */}
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase font-mono mb-2 flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              امضای ژنتیکی موج زنده فعلی (Live Wave DNA):
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">Origin (منشا)</span>
                <span className="text-xs font-bold text-amber-300 font-mono">{liveWaveDna.origin}</span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">Direction (جهت)</span>
                <span
                  className={`text-xs font-bold font-mono ${
                    liveWaveDna.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {liveWaveDna.direction}
                </span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">Regime (رژیم)</span>
                <span className="text-xs font-bold text-slate-300 font-mono">{liveWaveDna.regime}</span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">Momentum</span>
                <span className="text-xs font-bold text-cyan-300 font-mono">{liveWaveDna.momentum}</span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">Volume Z-Score</span>
                <span className="text-xs font-bold text-slate-200 font-mono">{liveWaveDna.volumeZScore}x</span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">CVD Slope</span>
                <span className="text-xs font-bold text-slate-200 font-mono">{liveWaveDna.cvdDeltaPct}%</span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">OBI Imbalance</span>
                <span className="text-xs font-bold text-purple-300 font-mono">{liveWaveDna.obiImbalance}</span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">Liquidity Depth</span>
                <span className="text-xs font-bold text-blue-300 font-mono">{liveWaveDna.liquidityScore}/100</span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">Volatility (ATR)</span>
                <span className="text-xs font-bold text-yellow-300 font-mono">{liveWaveDna.volatilityAtrPct}%</span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">MFE / MAE</span>
                <span className="text-xs font-bold text-emerald-400 font-mono">
                  +{liveWaveDna.mfeR}R / -{liveWaveDna.maeR}R
                </span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">Duration (ثانیه)</span>
                <span className="text-xs font-bold text-slate-300 font-mono">{liveWaveDna.durationSeconds}s</span>
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">Acceleration</span>
                <span className="text-xs font-bold text-orange-300 font-mono">{liveWaveDna.accelerationScore}/100</span>
              </div>
              <div className="col-span-2 p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg">
                <span className="text-[10px] text-slate-500 block">Exhaustion Pattern (الگوی خستگی)</span>
                <span className="text-xs font-bold text-rose-300 font-mono">{liveWaveDna.exhaustionPattern}</span>
              </div>
            </div>
          </div>

          {/* Top Matches in Historical Dataset */}
          {waveReport.topMatches && waveReport.topMatches.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase font-mono mb-2 flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-cyan-400" />
                نزدیک‌ترین امواج تاریخی ثبت‌شده (KNN Vector Similarity):
              </h4>
              <div className="flex flex-col gap-2">
                {waveReport.topMatches.map((match, idx) => (
                  <div
                    key={match.matchedDna.dnaId || idx}
                    className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between text-xs font-mono"
                  >
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-cyan-400 border border-slate-800 font-bold">
                        شباهت: {match.similarityScorePct}%
                      </span>
                      <span className="text-slate-300">
                        {match.matchedDna.origin} ({match.matchedDna.direction})
                      </span>
                      <span className="text-slate-500 hidden sm:inline">
                        Regime: {match.matchedDna.regime}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          match.outcome === 'CONTINUED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {match.outcome === 'CONTINUED' ? 'ادامه موج (موفق)' : 'شکست موج'}
                      </span>
                      <span className="font-bold text-slate-200">
                        {match.realizedR >= 0 ? `+${match.realizedR}R` : `${match.realizedR}R`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 4: HUNTER EPISODIC MEMORY & COUNTERFACTUAL LEARNING */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'MEMORY' && (
        <div className="flex flex-col gap-5">
          {/* Top Strategic Intelligence Banner */}
          <div className="p-4 bg-gradient-to-br from-emerald-950/50 via-slate-950 to-teal-950/40 border border-emerald-500/40 rounded-xl flex flex-col gap-4 shadow-xl">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/40 rounded-xl text-emerald-400">
                  <BookOpen className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-emerald-300 flex items-center gap-2">
                    حافظه استراتژیک شکارچی (Hunter Episodic Intelligence)
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40">
                      {memoryInsights.totalAnalyzedMemories} درس ثبت‌شده
                    </span>
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    تبدیل هر معامله به درس ریاضی: تحلیل حالت‌های شرطی (Counterfactual) و کشف پارامترهای بهینه
                  </p>
                </div>
              </div>

              {/* R Comparison Badge */}
              <div className="flex items-center gap-3 bg-slate-950/90 px-3.5 py-2 rounded-xl border border-slate-800">
                <div>
                  <span className="text-[10px] text-slate-400 block font-mono">سود واقعی کسب‌شده:</span>
                  <span className="text-sm font-black text-cyan-400">+{memoryInsights.totalCapturedR}R</span>
                </div>
                <div className="h-6 w-px bg-slate-800" />
                <div>
                  <span className="text-[10px] text-slate-400 block font-mono">سود بهینه در دسترس:</span>
                  <span className="text-sm font-black text-emerald-400">+{memoryInsights.potentialOptimalR}R</span>
                </div>
                <div className="h-6 w-px bg-slate-800" />
                <div>
                  <span className="text-[10px] text-slate-400 block font-mono">اختلاف قابل بهبود:</span>
                  <span className="text-sm font-black text-amber-400">+{memoryInsights.averageMissedRPerTrade}R / ترید</span>
                </div>
              </div>
            </div>

            {/* Learned Policies Summary Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                  <Target className="w-3 h-3 text-cyan-400" />
                  بهینه‌سازی ورود (Best Entry Offset)
                </span>
                <span className="text-sm font-black text-cyan-300 font-mono mt-1 block">
                  +{memoryInsights.learnedOptimalEntryOffsetAtr} ATR صبر
                </span>
                <p className="text-[10px] text-slate-400 mt-1">قرار دادن لیمیت در پولبک به جای مارکت اوردر</p>
              </div>

              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                  <Shield className="w-3 h-3 text-amber-400" />
                  فاصله بهینه استاپ (Best Stop Buffer)
                </span>
                <span className="text-sm font-black text-amber-300 font-mono mt-1 block">
                  +{memoryInsights.learnedOptimalStopBufferAtr} ATR بافر
                </span>
                <p className="text-[10px] text-slate-400 mt-1">حفاظت در برابر شدوهای شکار نقدینگی</p>
              </div>

              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-emerald-400" />
                  استراتژی خروج برتر (Best Exit Policy)
                </span>
                <span className="text-sm font-black text-emerald-300 font-mono mt-1 block">
                  {memoryInsights.learnedBestExitStrategy}
                </span>
                <p className="text-[10px] text-slate-400 mt-1">تریلینگ ساختاری موج با ثبت سقف MFE</p>
              </div>

              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                  <Award className="w-3 h-3 text-indigo-400" />
                  مدل قابل‌اتکا و مخالف
                </span>
                <span className="text-xs font-bold text-slate-200 font-mono mt-1 block truncate">
                  موافق: {memoryInsights.mostReliableModel}
                </span>
                <span className="text-[10px] text-rose-400 block truncate">
                  مخالف مکرر: {memoryInsights.mostFrequentContrarianModel}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 leading-relaxed">
              💡 <strong>خلاصه یادگیری خودکار:</strong> {memoryInsights.strategicImprovementSummaryFa}
            </p>
          </div>

          {/* Counterfactual Lab Matrix */}
          {selectedMemory && (
            <div className="bg-slate-950/90 p-4 rounded-xl border border-slate-800 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Split className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-sm font-black text-slate-100">
                    آزمایشگاه سناریوهای شرطی (Counterfactual Lab) برای معامله: {selectedMemory.memoryId}
                  </h4>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-slate-400">بازده واقعی ثبت‌شده:</span>
                  <span
                    className={`font-black px-2 py-0.5 rounded ${
                      selectedMemory.realizedR > 0
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {selectedMemory.realizedR > 0 ? `+${selectedMemory.realizedR}R` : `${selectedMemory.realizedR}R`}
                  </span>
                  <span className="text-slate-400">بهترین بازده ممکن:</span>
                  <span className="font-black px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                    +{selectedMemory.counterfactual.optimalRealizedR}R
                  </span>
                </div>
              </div>

              {/* 3 Pillars of Counterfactual Branches */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* 1. Entry Variations */}
                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-cyan-300 flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-cyan-400" />
                      ۱. شبیه‌سازی نقطه ورود (Entry Offsets)
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    {Object.values(selectedMemory.counterfactual.entryBranches).map((branch) => (
                      <div
                        key={branch.name}
                        className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col gap-1 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-200">{branch.nameFa}</span>
                          <span
                            className={`font-mono font-black ${
                              branch.realizedR >= selectedMemory.realizedR ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {branch.realizedR > 0 ? `+${branch.realizedR}R` : `${branch.realizedR}R`}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400">{branch.descriptionFa}</p>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono mt-0.5">
                          <span>قیمت: ${branch.entryPrice.toLocaleString()}</span>
                          <span className={branch.pnlDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            تغییر: {branch.pnlDeltaPct >= 0 ? `+${branch.pnlDeltaPct}%` : `${branch.pnlDeltaPct}%`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Stop Variations */}
                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-amber-400" />
                      ۲. شبیه‌سازی حد ضرر (Stop Buffers)
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    {Object.values(selectedMemory.counterfactual.stopBranches).map((branch) => (
                      <div
                        key={branch.name}
                        className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col gap-1 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-200">{branch.nameFa}</span>
                          <span
                            className={`font-mono font-black ${
                              branch.realizedR >= selectedMemory.realizedR ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {branch.realizedR > 0 ? `+${branch.realizedR}R` : `${branch.realizedR}R`}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400">{branch.descriptionFa}</p>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono mt-0.5">
                          <span>استاپ: ${branch.stopPrice.toLocaleString()}</span>
                          <span className={branch.pnlDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            تغییر: {branch.pnlDeltaPct >= 0 ? `+${branch.pnlDeltaPct}%` : `${branch.pnlDeltaPct}%`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Exit Variations */}
                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-emerald-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      ۳. شبیه‌سازی خروج (Exit Timing)
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    {Object.values(selectedMemory.counterfactual.exitBranches).map((branch) => (
                      <div
                        key={branch.name}
                        className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col gap-1 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-200">{branch.nameFa}</span>
                          <span
                            className={`font-mono font-black ${
                              branch.realizedR >= selectedMemory.realizedR ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {branch.realizedR > 0 ? `+${branch.realizedR}R` : `${branch.realizedR}R`}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400">{branch.descriptionFa}</p>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono mt-0.5">
                          <span>خروج: ${branch.exitPrice.toLocaleString()}</span>
                          <span className={branch.pnlDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            تغییر: {branch.pnlDeltaPct >= 0 ? `+${branch.pnlDeltaPct}%` : `${branch.pnlDeltaPct}%`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Counterfactual Verdict */}
              <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    <strong>حکم ارزیابی شرطی:</strong> {selectedMemory.counterfactual.bestBranchVerdictFa}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono shrink-0">
                  درس آموخته‌شده: {selectedMemory.actionableAdjustment.lessonSummaryFa}
                </div>
              </div>
            </div>
          )}

          {/* Deep Episodic Memory Ledger (Answers to All 12 Core Questions) */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold text-slate-400 uppercase font-mono flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              دفترچه جامع کالبدشکافی و درس‌های تاریخی (Episodic Post-Mortem Ledger):
            </h4>

            <div className="flex flex-col gap-3">
              {memoryInsights.memories.map((mem) => {
                const isSelected = selectedMemory?.memoryId === mem.memoryId;
                return (
                  <div
                    key={mem.memoryId}
                    onClick={() => setSelectedMemoryId(mem.memoryId)}
                    className={`cursor-pointer p-4 rounded-xl border transition-all flex flex-col gap-3 ${
                      isSelected
                        ? 'bg-slate-950 border-emerald-500/80 shadow-lg shadow-emerald-950/40'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-black font-mono ${
                            mem.direction === 'LONG'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          }`}
                        >
                          {mem.direction}
                        </span>
                        <span className="font-mono text-xs text-slate-200 font-bold">{mem.symbol}</span>
                        <span className="text-[11px] text-slate-400 font-mono">@{mem.entryPrice.toLocaleString()}$</span>
                        <span className="text-[10px] text-slate-500">{mem.timestampIso.split('T')[0]}</span>
                      </div>

                      <div className="flex items-center gap-2 font-mono text-xs">
                        <span className="text-slate-400">سود/زیان:</span>
                        <span
                          className={`font-black ${
                            mem.realizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {mem.realizedPnlUsd >= 0 ? `+$${mem.realizedPnlUsd}` : `-$${Math.abs(mem.realizedPnlUsd)}`} (
                          {mem.realizedR > 0 ? `+${mem.realizedR}R` : `${mem.realizedR}R`})
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-900 border border-slate-800 text-slate-300 font-bold">
                          {mem.outcome}
                        </span>
                      </div>
                    </div>

                    {/* 12-Factor Deep Q&A Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
                      {/* Q1 & Q2 */}
                      <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-amber-400 font-bold block">۱. چرا وارد شدیم؟ (Root Thesis)</span>
                        <p className="text-slate-300 mt-1 leading-relaxed">{mem.entryReasonFa}</p>
                      </div>

                      {/* Q3 & Q4 */}
                      <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-cyan-400 font-bold block">۲. مدل‌های موافق و مخالف</span>
                        <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
                          <span className="text-emerald-400">موافق: {mem.agreeingModels.join(', ')}</span>
                          <span className="text-rose-400">
                            مخالف: {mem.disagreeingModels.length > 0 ? mem.disagreeingModels.join(', ') : 'هیچ (اجماع کامل)'}
                          </span>
                        </div>
                      </div>

                      {/* Q5 & Q6 */}
                      <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-purple-400 font-bold block">۳. کیفیت ورود و تریگر</span>
                        <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
                          <span className="text-slate-300">Trigger: {mem.triggerEventFa}</span>
                          <span className="text-slate-400">
                            Wave Stage: {mem.waveStageAtEntry} • Prob: {mem.entryProbabilityPct}% • Quality: {mem.entryQualityScore}/100
                          </span>
                        </div>
                      </div>

                      {/* Q7 & Q8 */}
                      <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-emerald-400 font-bold block">۴. چرا سود یا ضرر کرد؟ (Root Cause)</span>
                        <p className="text-slate-300 mt-1 leading-relaxed">{mem.profitOrLossReasonFa}</p>
                      </div>

                      {/* Q9 & Q10 */}
                      <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-yellow-400 font-bold block">۵. بهترین Entry و Exit واقعی</span>
                        <div className="mt-1 flex flex-col gap-0.5 text-[11px] font-mono">
                          <span className="text-cyan-400">بهترین ورود: ${mem.realBestEntryPrice.toLocaleString()}</span>
                          <span className="text-emerald-400">بهترین خروج: ${mem.realBestExitPrice.toLocaleString()}</span>
                          <span className="text-slate-400">MFE: +{mem.optimalMfeR}R • MAE: -{mem.worstMaeR}R</span>
                        </div>
                      </div>

                      {/* Q11 & Q12 */}
                      <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-teal-400 font-bold block">۶. درس استخراج‌شده برای معاملات بعد</span>
                        <p className="text-slate-300 mt-1 leading-relaxed">{mem.actionableAdjustment.lessonSummaryFa}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

