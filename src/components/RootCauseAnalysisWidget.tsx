/**
 * 🔍 ویجت موتور ریشه‌یابی و تحلیل علل شکست (Root-Cause Analysis Engine Widget)
 * نمایش لاگ پس از مرگ معاملاتی، بررسی متغیرهای لغزش نقدینگی و جریمه وزنی خودکار مغزهای خطاکار.
 */

import React, { useState, useEffect } from 'react';
import { Search, ShieldCheck, RefreshCw, AlertOctagon, TrendingDown, Cpu, Zap, Activity, CheckCircle2 } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { rootCauseAnalysisEngineService, FailedHedgePostMortem, PositionLossDiagnosis } from '../services/rootCauseAnalysisEngine';

export const RootCauseAnalysisWidget: React.FC = () => {
  const [report, setReport] = useState<FailedHedgePostMortem>(() =>
    rootCauseAnalysisEngineService.getPostMortemReport()
  );
  const [latestDiagnosis, setLatestDiagnosis] = useState<PositionLossDiagnosis | null>(() =>
    rootCauseAnalysisEngineService.getLatestDiagnosis()
  );
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const diag = rootCauseAnalysisEngineService.getLatestDiagnosis();
      if (diag) setLatestDiagnosis(diag);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleRunAnalysis = () => {
    setIsAnalyzing(true);
    setTimeout(() => {
      setReport(rootCauseAnalysisEngineService.getPostMortemReport());
      const diag = rootCauseAnalysisEngineService.getLatestDiagnosis();
      if (diag) setLatestDiagnosis(diag);
      setIsAnalyzing(false);
    }, 900);
  };

  return (
    <CollapsibleCard
      title="موتور خودکار ریشه‌یابی و جریمه مغزها (Root-Cause Analysis Engine)"
      badge={`شناسه بررسی: ${report.failureId}`}
      badgeColor="text-rose-300 bg-rose-950/80 border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.2)]"
      defaultOpen={true}
      icon={<Search className="w-5 h-5 text-rose-400" />}
      headerAction={
        <button
          onClick={handleRunAnalysis}
          disabled={isAnalyzing}
          className="px-2.5 py-1 rounded-lg bg-rose-950 hover:bg-rose-900 border border-rose-500/50 text-rose-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-rose-400 ${isAnalyzing ? 'animate-spin' : ''}`} />
          <span>{isAnalyzing ? 'در حال واکاوی علل...' : 'بررسی و توازن مجدد'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        <div className="bg-[#020917] border border-rose-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-rose-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-rose-500/20 rounded-lg text-rose-400 border border-rose-500/30">
                <AlertOctagon className="w-4 h-4 text-rose-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  تحلیل آماری لحظه شکست هدج و کالیبراسیون مجدد:
                </span>
                <span className="text-[10px] text-rose-300 font-mono mt-0.5 block">
                  تشخیص خطای همبستگی مغزها در شرایط نوسان شدید (VIX) و تعدیل وزن آن‌ها برای دفعه بعد
                </span>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold bg-rose-950 text-rose-300 border-rose-500/50 flex items-center gap-1">
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
              <span>ریسک VIX در شکست: {report.vixAtEntry} ⚠️</span>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 text-[11px]">
            <div className="bg-[#041124] p-2.5 rounded-xl border border-rose-950/80 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">عمق دفتر سفارشات:</span>
              <span className="font-bold text-slate-300">${report.orderbookDepthUsd.toLocaleString()}</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-rose-950/80 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">جریان نقدینگی خالص:</span>
              <span className="font-bold text-rose-300">${report.liquidityFlowDelta.toLocaleString()}</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-rose-950/80 text-center col-span-2">
              <span className="text-[10px] text-slate-400 block font-sans">مغزهای مسئول خطا و جریمه‌شده:</span>
              <span className="font-bold text-amber-300">
                {report.faultyBrainIds.map(id => `مغز ${id}`).join(' و ')}
              </span>
            </div>
          </div>

          {/* Adjusted Brain Weights Table */}
          <div className="bg-[#020712] p-2.5 rounded-xl border border-rose-950/40 space-y-2">
            <span className="text-[10px] text-slate-400 font-sans block">تعدیل جدید ضرایب مغزها پس از بازخورد شکست:</span>
            <div className="grid grid-cols-5 gap-1.5 text-[9px] text-center">
              {Object.entries(report.adjustedBrainWeights).map(([id, weight]) => {
                const isFaulty = report.faultyBrainIds.includes(Number(id));
                return (
                  <div key={id} className={`p-1.5 rounded border ${
                    isFaulty ? 'bg-rose-950/40 border-rose-500/30 text-rose-300' : 'bg-indigo-950/20 border-indigo-950 text-slate-300'
                  }`}>
                    <span>مغز {id}: </span>
                    <strong className="block text-[10px]">{Math.round(weight * 100)}%</strong>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-rose-900/40 mt-3">
            🔍 {report.recalibrationActionFa}
          </p>

          {/* ⚡ بخش عیب‌یابی آنی و سناریوی فعال نجات معامله در ضرر */}
          {latestDiagnosis ? (
            <div className="bg-[#031526] border border-emerald-500/40 rounded-2xl p-3.5 shadow-xl mt-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-emerald-500/20 rounded-lg text-emerald-400 border border-emerald-500/30 animate-pulse">
                    <Zap className="w-4 h-4 text-emerald-300" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-white font-sans block">
                      عیب‌یابی آنی علت افت معامله و سناریوی نجات فعال:
                    </span>
                    <span className="text-[10px] text-emerald-300 font-mono">
                      ثبت در ساعت {latestDiagnosis.detectedAt} | ضریب اطمینان نجات: {latestDiagnosis.confidenceScorePct}%
                    </span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-sans font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/50">
                  {latestDiagnosis.rescueScenarioTitleFa}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-sans">
                <div className="bg-[#020b18] p-2 rounded-xl border border-emerald-900/40">
                  <span className="text-[10px] text-slate-400 block">ریشه افت شناسایی شده (از بین ۱۰ علت):</span>
                  <span className="font-bold text-rose-300 block mt-0.5">{latestDiagnosis.rootCauseTitleFa}</span>
                  <span className="text-[10px] text-slate-300 block mt-0.5">{latestDiagnosis.rootCauseDetailsFa}</span>
                </div>
                <div className="bg-[#020b18] p-2 rounded-xl border border-amber-900/40">
                  <span className="text-[10px] text-slate-400 block">مدل مسئول و کاهش وزن انتخابی:</span>
                  <span className="font-bold text-amber-300 block mt-0.5">{latestDiagnosis.responsibleModelId}</span>
                  <span className="text-[10px] text-amber-200/80 block mt-0.5">
                    تعدیل خودکار وزن مدل مسئول به جای توقف کور کل سیستم (بند ۳۳ و ۳۴)
                  </span>
                </div>
                <div className="bg-[#020b18] p-2 rounded-xl border border-emerald-900/40">
                  <span className="text-[10px] text-slate-400 block">اقدام خودکار نجات و سربه‌سر:</span>
                  <span className="font-bold text-emerald-300 block mt-0.5">{latestDiagnosis.actionGuidanceFa}</span>
                  <span className="text-[10px] text-cyan-300 block mt-0.5">
                    تارگت سربه‌سر: ${latestDiagnosis.targetBreakevenPrice.toLocaleString()} | زمان تخمینی تسویه: {latestDiagnosis.estimatedRecoverySeconds} ثانیه
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[#031526]/50 border border-emerald-500/20 rounded-xl p-2.5 text-center mt-3">
              <span className="text-[11px] text-emerald-300 font-sans flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>موتور ریشه‌یابی و سناریوی نجات زنده آماده است؛ در صورت افت هر پوزیشن، فوراً اقدام خودکار انجام می‌شود.</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
};
