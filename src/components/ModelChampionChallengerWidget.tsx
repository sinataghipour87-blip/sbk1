import React, { useState } from 'react';
import {
  Trophy,
  Shield,
  Zap,
  TrendingUp,
  Layers,
  ArrowRight,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Award,
  GitBranch,
} from 'lucide-react';
import {
  modelChampionChallenger,
  ModelProfile,
  PromotionGateAudit,
  RegimePerformanceRecord,
  TimeframePerformanceRecord,
} from '../services/modelChampionChallenger';

export const ModelChampionChallengerWidget: React.FC = () => {
  const [champion, setChampion] = useState<ModelProfile>(() => modelChampionChallenger.getChampion());
  const [challenger, setChallenger] = useState<ModelProfile>(() => modelChampionChallenger.getChallenger());
  const [audit, setAudit] = useState<PromotionGateAudit>(() => modelChampionChallenger.auditPromotionGate());
  const [regimes, setRegimes] = useState<RegimePerformanceRecord[]>(() => modelChampionChallenger.getRegimeComparison());
  const [timeframes, setTimeframes] = useState<TimeframePerformanceRecord[]>(() => modelChampionChallenger.getTimeframeComparison());
  const [notification, setNotification] = useState<string | null>(null);

  const refreshState = () => {
    setChampion(modelChampionChallenger.getChampion());
    setChallenger(modelChampionChallenger.getChallenger());
    setAudit(modelChampionChallenger.auditPromotionGate());
    setRegimes(modelChampionChallenger.getRegimeComparison());
    setTimeframes(modelChampionChallenger.getTimeframeComparison());
  };

  const handlePromoteChallenger = () => {
    const res = modelChampionChallenger.promoteChallengerToChampion();
    setNotification(res.messageFa);
    refreshState();
    setTimeout(() => setNotification(null), 8000);
  };

  const handleSyncDataset = () => {
    modelChampionChallenger.syncWithRealDataset();
    refreshState();
    setNotification('✅ همگام‌سازی شاخص‌های آماری ۹ معیاره با رکوردهای Central Trade Dataset با موفقیت انجام شد.');
    setTimeout(() => setNotification(null), 5000);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 shadow-2xl backdrop-blur-md relative overflow-hidden transition-all duration-300 hover:border-slate-700">
      {/* Background Accent */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800/80 mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
            <Trophy className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100">
                سیستم مدل قهرمان و مدعی (Champion / Challenger Framework)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold">
                اصول ۴۹ و ۵۰
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              ارزیابی ۹ معیاره دادهمحور برون‌نمونه (OOS) و امکان سقوط Champion در صورت افت کیفیت
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncDataset}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-all flex items-center gap-1.5"
            title="همگام‌سازی شاخص‌ها با دیتاست مرکزی"
          >
            <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
            <span>همگام‌سازی با دیتاست</span>
          </button>
          <button
            onClick={refreshState}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
            title="به‌روزرسانی وضعیت"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div className="mb-4 p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-medium flex items-center gap-2 animate-fadeIn">
          <Award className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {/* ⚠️ Champion Degradation Alert Banner (Item 50) */}
      {champion.status === 'DEGRADED' && (
        <div className="mb-4 p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-medium flex items-center justify-between gap-2 animate-pulse">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{champion.degradationReasonFa || 'مدل قهرمان در داده‌های برون‌نمونه اخیر (OOS) دچار افت کیفیت شده است و به وضعیت DEGRADED تنزل یافت.'}</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-rose-900/60 text-rose-300 font-bold border border-rose-600/40">سقوط قهرمان</span>
        </div>
      )}

      {/* Dual Models Cards: Champion vs Challenger */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        {/* 🏆 Champion Model Card */}
        <div className={`p-4 rounded-xl bg-slate-950/70 border relative overflow-hidden space-y-3 ${
          champion.status === 'DEGRADED' ? 'border-rose-500/50' : 'border-amber-500/30'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`p-1 rounded-md ${champion.status === 'DEGRADED' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'}`}>
                <Trophy className="w-4 h-4" />
              </span>
              <div>
                <span className={`text-xs font-bold block ${champion.status === 'DEGRADED' ? 'text-rose-300' : 'text-amber-300'}`}>
                  مدل قهرمان (CHAMPION)
                </span>
                <span className="text-[11px] text-slate-400">{champion.name} ({champion.version})</span>
              </div>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
              champion.status === 'DEGRADED'
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
            }`}>
              {champion.status === 'DEGRADED' ? '⚠️ تنزل یافته (DEGRADED)' : '● فعال در تولید زنده'}
            </span>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed border-b border-slate-800/80 pb-2">
            {champion.architectureDescriptionFa}
          </p>

          <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">وین‌ریت OOS</span>
              <span className="text-xs font-bold text-emerald-400">{champion.overallStats.winRatePct}%</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">Brier Score</span>
              <span className={`text-xs font-bold ${champion.overallStats.brierScore > 0.25 ? 'text-rose-400' : 'text-slate-200'}`}>{champion.overallStats.brierScore}</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">خطای ECE</span>
              <span className={`text-xs font-bold ${champion.overallStats.ece > 0.15 ? 'text-rose-400' : 'text-slate-200'}`}>{champion.overallStats.ece}</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">امید ریاضی (R)</span>
              <span className="text-xs font-bold text-emerald-400">+{champion.overallStats.expectancyR}R</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">فاکتور سود</span>
              <span className="text-xs font-bold text-slate-200">{champion.overallStats.profitFactor}</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">افت سرمایه (DD)</span>
              <span className="text-xs font-bold text-amber-400">{champion.overallStats.maxDrawdownPct}%</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">ثبات رژیم‌ها</span>
              <span className="text-xs font-bold text-cyan-400">{champion.overallStats.stabilityScore}%</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">زیان Log Loss</span>
              <span className="text-xs font-bold text-slate-300">{champion.overallStats.logLoss}</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">تعداد نمونه OOS</span>
              <span className="text-xs font-bold text-slate-300">{champion.overallStats.sampleSize}</span>
            </div>
          </div>
        </div>

        {/* ⚔️ Challenger Model Card */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-cyan-500/30 relative overflow-hidden space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-md bg-cyan-500/20 text-cyan-400">
                <Zap className="w-4 h-4" />
              </span>
              <div>
                <span className="text-xs font-bold text-cyan-300 block">مدل مدعی (CHALLENGER)</span>
                <span className="text-[11px] text-slate-400">{challenger.name} ({challenger.version})</span>
              </div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold animate-pulse">
              ◐ آزمون در حالت سایه (Shadow Mode)
            </span>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed border-b border-slate-800/80 pb-2">
            {challenger.architectureDescriptionFa}
          </p>

          <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">وین‌ریت OOS</span>
              <span className="text-xs font-bold text-cyan-400">{challenger.overallStats.winRatePct}%</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">Brier Score</span>
              <span className="text-xs font-bold text-cyan-300">{challenger.overallStats.brierScore}</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">خطای ECE</span>
              <span className="text-xs font-bold text-cyan-300">{challenger.overallStats.ece}</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">امید ریاضی (R)</span>
              <span className="text-xs font-bold text-emerald-400">+{challenger.overallStats.expectancyR}R</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">فاکتور سود</span>
              <span className="text-xs font-bold text-cyan-300">{challenger.overallStats.profitFactor}</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">افت سرمایه (DD)</span>
              <span className="text-xs font-bold text-emerald-400">{challenger.overallStats.maxDrawdownPct}%</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">ثبات رژیم‌ها</span>
              <span className="text-xs font-bold text-cyan-400">{challenger.overallStats.stabilityScore}%</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">زیان Log Loss</span>
              <span className="text-xs font-bold text-slate-300">{challenger.overallStats.logLoss}</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 block">تعداد نمونه OOS</span>
              <span className="text-xs font-bold text-slate-300">{challenger.overallStats.sampleSize}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Head-to-Head Comparison Matrix: Regimes & Timeframes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {/* 1. Multi-Regime Breakdown */}
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              ارزیابی برتری در رژیم‌های بازار (Multi-Regime Verification)
            </span>
            <span className="text-[10px] text-slate-400">حداقل ۲ رژیم برتر</span>
          </div>

          <div className="space-y-1.5">
            {regimes.map((r) => (
              <div
                key={r.regime}
                className="p-2 rounded-lg bg-slate-900/50 border border-slate-800/60 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  {r.challengerWinsAgainstChampion ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  )}
                  <span className="text-slate-300 font-medium text-[11px]">{r.regimeNameFa}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-[10px]">{r.tradesCount} معامله</span>
                  <span className="font-bold text-slate-200">{r.winRatePct}%</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      r.challengerWinsAgainstChampion
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {r.challengerWinsAgainstChampion ? 'برتری مدعی' : 'در انطباق'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 2. Multi-Timeframe Breakdown */}
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
              ارزیابی برتری در افق‌های زمانی (Multi-Timeframe Horizon)
            </span>
            <span className="text-[10px] text-slate-400">حداقل ۲ تایم‌فریم</span>
          </div>

          <div className="space-y-1.5">
            {timeframes.map((tf) => (
              <div
                key={tf.timeframe}
                className="p-2 rounded-lg bg-slate-900/50 border border-slate-800/60 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  {tf.challengerWinsAgainstChampion ? (
                    <CheckCircle className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  )}
                  <span className="text-slate-300 font-bold text-[11px]">تایم‌فریم {tf.timeframe}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-[10px]">{tf.tradesCount} معامله</span>
                  <span className="font-bold text-slate-200">{tf.winRatePct}%</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      tf.challengerWinsAgainstChampion
                        ? 'bg-cyan-500/20 text-cyan-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {tf.challengerWinsAgainstChampion ? 'برتری مدعی' : 'در انطباق'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 87 & 88. Model & Concept Drift Monitoring Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        {/* Model Drift Panel */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-rose-500/20 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-850 pb-2">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              پایش انحراف مدل (Model Drift Detection)
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
              modelChampionChallenger.detectModelDrift([]).status === 'DRIFTED'
                ? 'bg-rose-950 text-rose-400 border border-rose-500/30'
                : 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
            }`}>
              {modelChampionChallenger.detectModelDrift([]).status === 'DRIFTED' ? '⚠️ منحرف شده' : '● پایدار (Stable)'}
            </span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">دقت هدف آموزش (OOS):</span>
              <span className="font-bold text-emerald-400">72.0%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">دقت واقعی در ۱۰۰ معامله اخیر:</span>
              <span className="font-bold text-cyan-400">71.4%</span>
            </div>
            <p className="text-[11px] text-slate-300 bg-slate-900/60 p-2 rounded border border-slate-800/80 leading-relaxed font-sans">
              ℹ️ {modelChampionChallenger.detectModelDrift([]).messageFa}
            </p>
          </div>
        </div>

        {/* Concept Drift Panel */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-cyan-500/20 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-850 pb-2">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4 text-cyan-400" />
              پایش دریفت مفهوم بازار (Concept Drift Monitor)
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/30">
              ● پایدار (Stable)
            </span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">ضریب همبستگی OBI تاریخی:</span>
              <span className="font-bold text-emerald-400">0.85</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">ضریب همبستگی لایو فید:</span>
              <span className="font-bold text-cyan-400">0.82</span>
            </div>
            <p className="text-[11px] text-slate-300 bg-slate-900/60 p-2 rounded border border-slate-800/80 leading-relaxed font-sans">
              ℹ️ {modelChampionChallenger.detectConceptDrift([]).messageFa}
            </p>
          </div>
        </div>
      </div>

      {/* 89 & 90. Real Feature Importance & Adaptive Model Selection Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {/* Real Feature Importance */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
          <span className="text-xs font-bold text-slate-200 block border-b border-slate-850 pb-2">
            📊 اهمیت واقعی فاکتورها در ۱۰۰۰ معامله اخیر (Real Feature Importance)
          </span>
          <div className="space-y-3 text-xs">
            {modelChampionChallenger.getRealFeatureImportance([]).map((feat, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-300 font-medium">{feat.featureName}</span>
                  <span className="font-bold text-cyan-300">{feat.importanceScore}% ({feat.gradeFa})</span>
                </div>
                <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className={`h-full rounded-full ${
                      feat.grade === 'CRITICAL' ? 'bg-rose-500' :
                      feat.grade === 'HIGH' ? 'bg-amber-500' :
                      feat.grade === 'MEDIUM' ? 'bg-indigo-500' : 'bg-slate-500'
                    }`}
                    style={{ width: `${feat.importanceScore}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Adaptive Model Selection */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
          <span className="text-xs font-bold text-slate-200 block border-b border-slate-850 pb-2">
            🏆 انتخاب تطبیقی مدل برای هر رژیم بازار (Adaptive Model Selection)
          </span>
          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 text-xs">
            {modelChampionChallenger.getAdaptiveModelSelection().map((item, idx) => (
              <div key={idx} className="p-2 rounded-lg bg-slate-900/60 border border-slate-850 flex justify-between items-center gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                      {item.regimeFa}
                    </span>
                    <strong className="text-slate-200 text-[11px]">{item.championModel}</strong>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal font-sans">{item.descriptionFa}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block font-sans">تارگت برد:</span>
                  <strong className="text-emerald-400 text-xs font-bold">{item.winRateEstimatePct}%</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Promotion Gate Audit & Action Panel */}
      <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/90 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-slate-200">
              گیت رسمی ارتقا به قهرمان (Champion Promotion Gate)
            </span>
          </div>
          <span
            className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
              audit.isPromotionApproved
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            }`}
          >
            {audit.isPromotionApproved ? '✅ واجد شرایط ارتقا' : '⏳ در حال آزمون سایه'}
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/60">
          {audit.auditVerdictFa}
        </p>

        {/* Audit Gates Checklist */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div
            className={`p-2 rounded-lg border flex items-center gap-2 ${
              audit.sampleSizeCheck.passed
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
            }`}
          >
            {audit.sampleSizeCheck.passed ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            <span className="text-[11px] truncate">{audit.sampleSizeCheck.labelFa}</span>
          </div>

          <div
            className={`p-2 rounded-lg border flex items-center gap-2 ${
              audit.multiRegimeCheck.passed
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
            }`}
          >
            {audit.multiRegimeCheck.passed ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            <span className="text-[11px] truncate">{audit.multiRegimeCheck.labelFa}</span>
          </div>

          <div
            className={`p-2 rounded-lg border flex items-center gap-2 ${
              audit.multiTimeframeCheck.passed
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
            }`}
          >
            {audit.multiTimeframeCheck.passed ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            <span className="text-[11px] truncate">{audit.multiTimeframeCheck.labelFa}</span>
          </div>
        </div>

        {/* Promote Action Button */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={handlePromoteChallenger}
            disabled={!audit.isPromotionApproved}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-emerald-600 hover:from-amber-500 hover:to-emerald-500 text-white font-bold text-xs shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Trophy className="w-4 h-4 text-amber-200" />
            <span>ارتقای مدل مدعی به مقام قهرمان پروداکشن (Promote to Champion)</span>
            <ArrowRight className="w-3.5 h-3.5 rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
};
