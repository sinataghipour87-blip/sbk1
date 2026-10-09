/**
  * 🧠 ویجت داشبورد مدیریتی ۱۱ مغز پردازشی (Eleven Brains Management Dashboard Widget)
  * نمایش لحظه‌ای وضعیت سلامتی (CPU/Latency)، بار کاری، ضریب دقت و آخرین تصمیمات معاملاتی ۱۱ مغز سیستم.
  */

import React, { useState, useMemo } from 'react';
import { Cpu, RefreshCw, CheckCircle2, Server, Lock, AlertTriangle } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { tenBrainsDashboardService, BrainStatus } from '../services/tenBrainsDashboardService';
import { evaluateSignalToExecution } from '../services/signalToExecution';

interface TenBrainsDashboardWidgetProps {
  analysis?: any;
  prediction?: any;
}

export const TenBrainsDashboardWidget: React.FC<TenBrainsDashboardWidgetProps> = ({ analysis, prediction }) => {
  const [brains, setBrains] = useState<BrainStatus[]>(() => tenBrainsDashboardService.getTenBrainsTelemetry());
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const evalResult = useMemo(() => {
    if (!analysis) return null;
    return evaluateSignalToExecution(analysis, analysis.direction || 'LONG', prediction);
  }, [analysis, prediction]);

  const isLocked = evalResult ? !evalResult.canExecute : false;

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setBrains(tenBrainsDashboardService.getTenBrainsTelemetry());
      setIsRefreshing(false);
    }, 800);
  };

  return (
    <CollapsibleCard
      title="داشبورد مدیریتی ۱۱ مغز پردازشی (Eleven Brains Real-Time Health & Telemetry)"
      badge={isLocked ? "EXECUTION_LOCKED 🔒" : "11/11 Active & Synchronized"}
      badgeColor={isLocked ? "text-rose-300 bg-rose-950/90 border-rose-500/60 shadow-[0_0_12px_rgba(244,63,94,0.4)]" : "text-cyan-300 bg-cyan-950/80 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.3)]"}
      defaultOpen={true}
      icon={<Cpu className="w-5 h-5 text-cyan-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'بروزرسانی تله‌متری...' : 'بروزرسانی آنی مغزها'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        {/* EXECUTION LOCKED BANNER */}
        {isLocked && evalResult && (
          <div className="bg-rose-950/90 border border-rose-500/80 p-3 rounded-xl flex items-center justify-between text-rose-200 font-mono text-xs shadow-lg animate-pulse">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-rose-400 shrink-0" />
              <div>
                <div className="font-bold text-white text-xs">قفل مرکز اجرای معامله (EXECUTION_LOCKED) 🔒</div>
                <div className="text-[11px] text-rose-300 mt-0.5">{evalResult.reasonFa}</div>
              </div>
            </div>
            <span className="bg-rose-500/20 text-rose-200 border border-rose-500/40 px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap">
              ورود مسدود
            </span>
          </div>
        )}

        <div className="bg-[#020917] border border-cyan-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-cyan-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-cyan-500/20 rounded-lg text-cyan-400 border border-cyan-500/30">
                <Server className="w-4 h-4 text-cyan-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  وضعیت سلامت و آرای پردازشی ۱۱ مغز (ارسال آرا به ماژول مرکزی signalToExecution):
                </span>
                <span className="text-[10px] text-cyan-300 font-mono mt-0.5 block">
                  هیچ مغزی به طور مستقل معامله باز نمی‌کند؛ تمام آرا به ماژول مرکزی ارسال و با canExecute تایید می‌شود.
                </span>
              </div>
            </div>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold flex items-center gap-1 ${
              isLocked
                ? 'bg-rose-950 text-rose-300 border-rose-500/60'
                : 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
            }`}>
              {isLocked ? <Lock className="w-3.5 h-3.5 text-rose-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{isLocked ? 'اجرا قفل شد 🔒' : 'پایدار و هماهنگ 🟢'}</span>
            </span>
          </div>

          {/* Brains Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 my-3 text-[11px]">
            {brains.map((b) => (
              <div key={b.id} className="bg-[#041124] p-3 rounded-xl border border-cyan-950/80 space-y-2 hover:border-cyan-500/40 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold border border-cyan-500/30">
                      #{b.id}
                    </span>
                    <span className="font-bold text-white font-sans text-xs">{b.nameFa}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    b.status === 'ACTIVE_HEALTHY' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                  }`}>
                    {b.status === 'ACTIVE_HEALTHY' ? 'رای ثبت شد' : 'در حال پردازش'}
                  </span>
                </div>

                {/* Metrics bar */}
                <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] bg-[#020917] p-2 rounded-lg border border-cyan-950">
                  <div>
                    <span className="text-slate-400 block font-sans">امتیاز تکنیکال:</span>
                    <span className="font-bold text-cyan-300">{b.technicalScore}/100</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-sans">ضریب اطمینان:</span>
                    <span className="font-bold text-amber-300">
                      {b.confidenceScore !== null ? `${b.confidenceScore}/100` : 'UNVALIDATED'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-sans">امتیاز اجماع:</span>
                    <span className="font-bold text-indigo-300">{b.consensusScore}/100</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-sans">احتمال کالیبره‌شده:</span>
                    {b.calibratedProbabilityPct !== null ? (
                      <span className="font-bold text-emerald-400">{b.calibratedProbabilityPct}%</span>
                    ) : (
                      <span className="font-bold text-slate-500 text-[9px] block">در انتظار داده</span>
                    )}
                  </div>
                </div>

                <div className="text-[11px] text-slate-300 font-sans bg-[#020712] p-2 rounded-lg border border-cyan-950/50 flex items-center justify-between">
                  <span className="truncate">رای مغز: <strong className="text-cyan-200">{b.lastDecision}</strong></span>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">ارسال به ماژول مرکزی</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-cyan-900/40">
            🧠 تمامی ۱۱ مغز پردازشی آرای تحلیلی خود را منحصراً به ماژول مرکزی ارسال می‌کنند و اجرا صرفاً منوط به خروجی canExecute است.
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
};
