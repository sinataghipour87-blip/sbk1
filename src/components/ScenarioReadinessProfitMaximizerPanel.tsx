import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Zap,
  Sparkles,
  RefreshCw,
  Flame,
  Layers,
  Award,
  TrendingUp,
  AlertOctagon,
  CheckCircle2,
  Sliders,
  Filter,
  Check,
  Play
} from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { scenarioReadinessEngine, ScenarioReadinessReport, SystemStrategicProposal } from '../services/scenarioReadinessEngine';
import { profitMaximizerTrailingEngine, PositionProfitState } from '../services/profitMaximizerTrailingEngine';

interface Props {
  currentPrice?: number;
  volatilityPct?: number;
  obi?: number;
  activePositions?: any[];
}

export const ScenarioReadinessProfitMaximizerPanel: React.FC<Props> = ({
  currentPrice = 0,
  volatilityPct = 1.4,
  obi = 0.12,
  activePositions = []
}) => {
  const [report, setReport] = useState<ScenarioReadinessReport | null>(null);
  const [profitState, setProfitState] = useState<PositionProfitState | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [appliedNotification, setAppliedNotification] = useState<string | null>(null);

  useEffect(() => {
    const scReport = scenarioReadinessEngine.evaluateScenarios(currentPrice, volatilityPct, obi);
    setReport(scReport);

    const activePos = activePositions && activePositions.length > 0 ? activePositions[0] : null;
    const entry = activePos?.entryPrice || currentPrice;
    const pState = profitMaximizerTrailingEngine.evaluatePositionProfitTrailing(entry, currentPrice, activePos?.type || 'LONG');
    setProfitState(pState);
  }, [currentPrice, volatilityPct, obi, activePositions]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      const scReport = scenarioReadinessEngine.evaluateScenarios(currentPrice, volatilityPct, obi);
      setReport(scReport);

      const activePos = activePositions && activePositions.length > 0 ? activePositions[0] : null;
      const entry = activePos?.entryPrice || currentPrice;
      const pState = profitMaximizerTrailingEngine.evaluatePositionProfitTrailing(entry, currentPrice, activePos?.type || 'LONG');
      setProfitState(pState);
      setIsRefreshing(false);
    }, 800);
  };

  const handleApplyAllProposals = () => {
    scenarioReadinessEngine.applyAllProposals();
    const updated = scenarioReadinessEngine.evaluateScenarios(currentPrice, volatilityPct, obi);
    setReport(updated);
    setAppliedNotification('تمام پیشنهادات راهبردی با موفقیت بر هسته و مغزهای پردازشی اعمال و تثبیت شدند.');
    setTimeout(() => setAppliedNotification(null), 4000);
  };

  const handleToggleProposal = (id: string, currentApplied: boolean) => {
    if (currentApplied) {
      scenarioReadinessEngine.removeProposal(id);
    } else {
      scenarioReadinessEngine.applyProposal(id);
    }
    const updated = scenarioReadinessEngine.evaluateScenarios(currentPrice, volatilityPct, obi);
    setReport(updated);
  };

  if (!report || !profitState) return null;

  const proposals = report.proposals || [];
  const filteredProposals =
    selectedCategory === 'ALL'
      ? proposals
      : proposals.filter((p) => p.category === selectedCategory);

  const appliedCount = proposals.filter((p) => p.isApplied).length;

  return (
    <CollapsibleCard
      title="ماتریس آمادگی ۵ سناریوی بازار و موتور بیشینه‌سازی سود شناور (Scenario Readiness & Profit Maximizer)"
      badge="آمادگی ۱۰۰٪ سناریوها"
      badgeColor="text-emerald-300 bg-emerald-950/80 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
      defaultOpen={true}
      icon={<ShieldCheck className="w-5 h-5 text-emerald-400 animate-pulse" />}
      headerAction={
        <div className="flex items-center gap-2">
          <button
            onClick={handleApplyAllProposals}
            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-[0_0_12px_rgba(16,185,129,0.4)] transition-all"
            title="اعمال و اجرای کلیه پیشنهادات سیستم"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>اجرای تمام پیشنهادات ({appliedCount}/{proposals.length})</span>
          </button>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-2.5 py-1 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'در حال پایش سناریوها...' : 'ارزیابی آمادگی'}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        {/* Banner Alert when proposals are applied */}
        {appliedNotification && (
          <div className="bg-emerald-950/90 border border-emerald-500/60 p-2.5 rounded-xl text-emerald-200 text-xs font-sans flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{appliedNotification}</span>
          </div>
        )}

        {/* Top Profit Maximizer & Zero-Loss Banner */}
        <div className="bg-[#020d1c] border border-emerald-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5 border-b border-emerald-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-500/20 rounded-lg text-emerald-300 border border-emerald-500/30">
                <Flame className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  وضعیت بیشینه‌سازی سود شناور و خروج بی‌زیان:
                </span>
                <span className="text-[10px] text-slate-300 font-sans mt-0.5 block">
                  {profitState.actionGuidanceFa}
                </span>
              </div>
            </div>

            <span className="px-3 py-1 rounded-lg bg-emerald-950 text-emerald-300 border border-emerald-500/50 text-xs font-bold font-sans">
              سطح قفل سود: {profitState.activeLockRung}
            </span>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 text-center">
            <div className="bg-[#041328] p-2.5 rounded-xl border border-emerald-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">PnL جاری معامله:</span>
              <span className={`text-base font-black ${profitState.unrealizedPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {profitState.unrealizedPnlPct > 0 ? '+' : ''}{profitState.unrealizedPnlPct}٪
              </span>
            </div>

            <div className="bg-[#041328] p-2.5 rounded-xl border border-emerald-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">تریلینگ شناور چندعامله:</span>
              <span className="text-base font-black text-cyan-300">{profitState.currentTrailingOffsetPct}٪</span>
            </div>

            <div className="bg-[#041328] p-2.5 rounded-xl border border-emerald-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">سود قفل‌شده در حساب:</span>
              <span className="text-base font-black text-amber-300">${profitState.lockedProfitUsd.toLocaleString()}</span>
            </div>

            <div className="bg-[#041328] p-2.5 rounded-xl border border-emerald-950">
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">HEURISTIC SCORE تداوم موج:</span>
              <span className="text-base font-black text-emerald-400">{profitState.continuationHeuristicScore}/100</span>
            </div>
          </div>

          {/* ۲۳. ماشین وضعیت موج (Wave State Machine) - ۸ فاز پیوسته */}
          <div className="mt-3 pt-3 border-t border-emerald-950/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white font-sans flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                <span>ماشین وضعیت موج (Wave State Machine):</span>
              </span>
              <span className="text-[10px] font-bold text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-500/40">
                وضعیت کنونی: {profitState.waveState}
              </span>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 text-[9.5px] font-mono text-center">
              {[
                { id: 'WAVE_FORMING', labelFa: '۱. شکل‌گیری' },
                { id: 'WAVE_CONFIRMED', labelFa: '۲. تایید موج' },
                { id: 'EARLY_ACCELERATION', labelFa: '۳. شتاب اولیه' },
                { id: 'TREND_EXPANSION', labelFa: '۴. انبساط روند' },
                { id: 'MATURE_WAVE', labelFa: '۵. موج بالغ' },
                { id: 'EXHAUSTION_WARNING', labelFa: '۶. هشدار خستگی' },
                { id: 'DISTRIBUTION', labelFa: '۷. توزیع' },
                { id: 'EXIT', labelFa: '۸. خروج نهایی' }
              ].map((st) => {
                const isActive = profitState.waveState === st.id;
                return (
                  <div
                    key={st.id}
                    className={`p-1.5 rounded-lg border transition-all ${
                      isActive
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold shadow-[0_0_10px_rgba(6,182,212,0.4)] scale-105'
                        : 'bg-[#030e20] border-slate-800/80 text-slate-500'
                    }`}
                  >
                    <div className="truncate">{st.labelFa}</div>
                    <div className="text-[8px] opacity-75">{st.id}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ۲۲ & ۲۴ & ۲۵: تفکیک حفاظت از سود، بیشینه‌سازی سود و خروج شواهد‌محور */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mt-3 pt-3 border-t border-emerald-950/80">
            {/* حفاظت سود (Profit Protection) */}
            <div className="bg-[#031326] p-2.5 rounded-xl border border-emerald-500/30 space-y-1.5">
              <div className="flex items-center justify-between border-b border-emerald-900/60 pb-1">
                <span className="text-white font-sans font-bold text-[11px] flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>حفاظت از سود (Protection)</span>
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                  profitState.profitProtection.isBreakevenArmed
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                }`}>
                  {profitState.profitProtection.isBreakevenArmed ? 'بریک‌اون مسلح 🔒' : 'تنفس پولبک 🌿'}
                </span>
              </div>
              <p className="text-slate-300 font-sans text-[10px] leading-relaxed">
                {profitState.profitProtection.protectionRationaleFa}
              </p>
              <div className="text-[9.5px] text-emerald-300 bg-[#010814] p-1.5 rounded border border-emerald-950">
                قیمت استاپ امن: <span className="text-white font-bold">${profitState.profitProtection.safeBufferPrice}</span>
              </div>
            </div>

            {/* بیشینه‌سازی سود و تخصیص پله‌ها (Profit Maximization & Tier Allocations) */}
            <div className="bg-[#031326] p-2.5 rounded-xl border border-cyan-500/30 space-y-1.5">
              <div className="flex items-center justify-between border-b border-cyan-900/60 pb-1">
                <span className="text-white font-sans font-bold text-[11px] flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                  <span>بیشینه‌سازی سود (Maximizer)</span>
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-cyan-950 text-cyan-300 border border-cyan-500/40">
                  Runner فعال 🌊
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-center text-[9.5px] font-mono">
                <div className="bg-[#020b18] p-1 rounded border border-cyan-950">
                  <div className="text-slate-400 text-[8.5px]">TP1 (کاهش ریسک)</div>
                  <div className="text-emerald-400 font-bold">{profitState.profitMaximization.tierAllocations.tp1AllocationPct}٪</div>
                </div>
                <div className="bg-[#020b18] p-1 rounded border border-cyan-950">
                  <div className="text-slate-400 text-[8.5px]">TP2 (تثبیت سود)</div>
                  <div className="text-cyan-400 font-bold">{profitState.profitMaximization.tierAllocations.tp2AllocationPct}٪</div>
                </div>
                <div className="bg-[#020b18] p-1 rounded border border-cyan-950">
                  <div className="text-slate-400 text-[8.5px]">Runner (موج‌سوار)</div>
                  <div className="text-amber-400 font-bold">{profitState.profitMaximization.tierAllocations.runnerAllocationPct}٪</div>
                </div>
              </div>
              <div className="text-[9.5px] text-cyan-300 bg-[#010814] p-1.5 rounded border border-cyan-950">
                تارگت انبساطی موج: <span className="text-white font-bold">${profitState.profitMaximization.runnerTargetExtPrice}</span>
              </div>
            </div>

            {/* شواهد خروج چندبُعدی Runner (Multi-Dimensional Exit Evidence) */}
            <div className="bg-[#031326] p-2.5 rounded-xl border border-indigo-500/30 space-y-1.5">
              <div className="flex items-center justify-between border-b border-indigo-900/60 pb-1">
                <span className="text-white font-sans font-bold text-[11px] flex items-center gap-1">
                  <AlertOctagon className="w-3.5 h-3.5 text-indigo-400" />
                  <span>شواهد خروج Runner (8 عامله)</span>
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                  profitState.exitSignals.shouldExitRunnerImmediately
                    ? 'bg-rose-950 text-rose-300 border border-rose-500/40 animate-pulse'
                    : 'bg-indigo-950 text-indigo-300 border border-indigo-500/40'
                }`}>
                  فوریت خروج: {profitState.exitSignals.compositeExitUrgencyScore}/100
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[9px] text-slate-300 font-sans">
                <div className="flex items-center justify-between bg-[#020914] p-1 rounded">
                  <span>شکست ساختار:</span>
                  <span className={profitState.exitSignals.isStructureBroken ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                    {profitState.exitSignals.isStructureBroken ? 'نقض شد ❌' : 'سالم ✔'}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-[#020914] p-1 rounded">
                  <span>چرخش Order Flow:</span>
                  <span className={profitState.exitSignals.isOrderFlowReversed ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                    {profitState.exitSignals.isOrderFlowReversed ? 'معکوس ❌' : 'همسو ✔'}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-[#020914] p-1 rounded">
                  <span>افت CVD / OBI:</span>
                  <span className={profitState.exitSignals.isCvdDeteriorated ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                    {profitState.exitSignals.isCvdDeteriorated ? 'افت شدید ❌' : 'پایدار ✔'}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-[#020914] p-1 rounded">
                  <span>خستگی مومنتوم:</span>
                  <span className={profitState.exitSignals.isMomentumFailed ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                    {profitState.exitSignals.isMomentumFailed ? 'اشباع ❌' : 'ادامه‌دار ✔'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 5 Scenario Readiness Matrix Grid */}
        <div className="space-y-1.5">
          <span className="text-slate-300 font-sans font-bold text-[11px] block">
            ماتریس آمادگی ۵ سناریوی بحرانی و حرکتی بازار:
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[10.5px]">
            {report.scenarios.map((sc) => (
              <div
                key={sc.id}
                className={`p-3 rounded-xl border space-y-1.5 ${
                  sc.activeStatusFa === 'ACTIVE_NOW'
                    ? 'bg-[#041829] border-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                    : 'bg-[#030c1d] border-slate-800/80'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    {sc.activeStatusFa === 'ACTIVE_NOW' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    ) : (
                      <Layers className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span>{sc.nameFa}</span>
                  </span>
                  <span className={`text-[9.5px] px-2 py-0.5 rounded font-bold font-sans ${
                    sc.activeStatusFa === 'ACTIVE_NOW'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}>
                    {sc.activeStatusFa === 'ACTIVE_NOW' ? 'سناریوی فعال در بازار ⚡' : `آمادگی ${sc.readinessScorePct}٪`}
                  </span>
                </div>

                <p className="text-slate-300 font-sans text-[10px] leading-relaxed">
                  <strong className="text-slate-200">محرک سناریو: </strong>{sc.triggerConditionFa}
                </p>

                <div className="text-[9.5px] text-indigo-300 font-sans bg-[#020814] p-1.5 rounded border border-indigo-950">
                  <strong className="text-emerald-400">استراتژی سود و خروج بی‌زیان: </strong>{sc.profitMaximizerStrategyFa}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actionable Strategic Proposals Hub */}
        <div className="bg-[#020b18] border border-cyan-500/30 rounded-2xl p-3.5 space-y-3 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-cyan-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-cyan-500/20 rounded-lg text-cyan-300 border border-cyan-500/30">
                <Sparkles className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <h5 className="text-white font-sans font-bold text-xs flex items-center gap-1.5">
                  <span>پیشنهادات استراتژیک سیستم (آمادگی سناریوها، سیستم شناور، پیش‌بینی دقیق و خروج سودآور)</span>
                  <span className="px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 text-[10px] border border-cyan-500/40 font-mono">
                    {appliedCount}/{proposals.length} فعال
                  </span>
                </h5>
                <p className="text-[10px] text-slate-400 font-sans mt-0.5">
                  ارتقای ظرفیت پردازشی مغزها، فرار از ضرر و تضمین کسب بیشترین سود در شرایط شناور واقعی
                </p>
              </div>
            </div>

            <button
              onClick={handleApplyAllProposals}
              className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-sans text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-[0_0_12px_rgba(16,185,129,0.3)] transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              <span>اجرای هوشمند تمام پیشنهادات</span>
            </button>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            <button
              onClick={() => setSelectedCategory('ALL')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-sans font-bold transition-all shrink-0 cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-[#041226] text-slate-300 hover:bg-[#061b39] border border-cyan-950'
              }`}
            >
              همه پیشنهادات ({proposals.length})
            </button>
            <button
              onClick={() => setSelectedCategory('SCENARIO_PREPAREDNESS')}
              className={`px-2 py-1 rounded-lg text-[10px] font-sans font-medium transition-all shrink-0 cursor-pointer ${
                selectedCategory === 'SCENARIO_PREPAREDNESS'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-[#041226] text-slate-300 hover:bg-[#061b39] border border-cyan-950'
              }`}
            >
              آمادگی سناریوها
            </button>
            <button
              onClick={() => setSelectedCategory('FLOATING_HARMONIZATION')}
              className={`px-2 py-1 rounded-lg text-[10px] font-sans font-medium transition-all shrink-0 cursor-pointer ${
                selectedCategory === 'FLOATING_HARMONIZATION'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-[#041226] text-slate-300 hover:bg-[#061b39] border border-cyan-950'
              }`}
            >
              هماهنگی شناور
            </button>
            <button
              onClick={() => setSelectedCategory('ACCURATE_PREDICTION')}
              className={`px-2 py-1 rounded-lg text-[10px] font-sans font-medium transition-all shrink-0 cursor-pointer ${
                selectedCategory === 'ACCURATE_PREDICTION'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-[#041226] text-slate-300 hover:bg-[#061b39] border border-cyan-950'
              }`}
            >
              پیش‌بینی دقیق
            </button>
            <button
              onClick={() => setSelectedCategory('LOSS_ESCAPE_BREAKEVEN')}
              className={`px-2 py-1 rounded-lg text-[10px] font-sans font-medium transition-all shrink-0 cursor-pointer ${
                selectedCategory === 'LOSS_ESCAPE_BREAKEVEN'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-[#041226] text-slate-300 hover:bg-[#061b39] border border-cyan-950'
              }`}
            >
              خروج بی‌زیان
            </button>
            <button
              onClick={() => setSelectedCategory('MAX_PROFIT_HARVEST')}
              className={`px-2 py-1 rounded-lg text-[10px] font-sans font-medium transition-all shrink-0 cursor-pointer ${
                selectedCategory === 'MAX_PROFIT_HARVEST'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-[#041226] text-slate-300 hover:bg-[#061b39] border border-cyan-950'
              }`}
            >
              سود حداکثری
            </button>
            <button
              onClick={() => setSelectedCategory('TRADE_FREQUENCY_PRESERVATION')}
              className={`px-2 py-1 rounded-lg text-[10px] font-sans font-medium transition-all shrink-0 cursor-pointer ${
                selectedCategory === 'TRADE_FREQUENCY_PRESERVATION'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-[#041226] text-slate-300 hover:bg-[#061b39] border border-cyan-950'
              }`}
            >
              حفظ تداوم معاملات
            </button>
            <button
              onClick={() => setSelectedCategory('MULTI_BRAIN_REINFORCEMENT')}
              className={`px-2 py-1 rounded-lg text-[10px] font-sans font-medium transition-all shrink-0 cursor-pointer ${
                selectedCategory === 'MULTI_BRAIN_REINFORCEMENT'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-[#041226] text-slate-300 hover:bg-[#061b39] border border-cyan-950'
              }`}
            >
              تقویت مغزها
            </button>
          </div>

          {/* Proposals List Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {filteredProposals.map((prop) => (
              <div
                key={prop.id}
                className={`p-3 rounded-xl border transition-all ${
                  prop.isApplied
                    ? 'bg-[#03152b] border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                    : 'bg-[#020a16] border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between border-b border-cyan-950/80 pb-1.5 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/40 font-sans">
                      {prop.categoryFa}
                    </span>
                    <span className="font-bold text-white text-xs font-sans">
                      {prop.titleFa}
                    </span>
                  </div>

                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                    {prop.impactLabel}
                  </span>
                </div>

                <p className="text-slate-300 text-[10.5px] font-sans leading-relaxed mb-2">
                  {prop.descriptionFa}
                </p>

                <div className="p-1.5 bg-[#010610] rounded-lg border border-slate-900 text-[10px] text-slate-300 font-sans mb-2.5">
                  <strong className="text-cyan-400">دستورالعمل اجرایی: </strong>
                  {prop.actionGuidanceFa}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-900">
                  <span className="text-[10px] font-mono text-slate-400">
                    ضریب تطبیق: {prop.impactScorePct}٪
                  </span>

                  <button
                    onClick={() => handleToggleProposal(prop.id, prop.isApplied)}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-sans font-bold flex items-center gap-1 transition-all cursor-pointer ${
                      prop.isApplied
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50 hover:bg-rose-950 hover:text-rose-300 hover:border-rose-500/50'
                        : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow'
                    }`}
                  >
                    {prop.isApplied ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>فعال و اعمال‌شده در سیستم</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-white" />
                        <span>اعمال این پیشنهاد</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
};
