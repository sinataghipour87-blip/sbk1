import React, { useState, useEffect } from 'react';
import {
  Activity,
  Cpu,
  RefreshCw,
  ShieldCheck,
  Zap,
  CheckCircle2,
  Sliders,
  Radio,
  Clock
} from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { activityFrequencyMonitor, ActivityMonitorReport } from '../services/activityFrequencyMonitor';

export const ActivityFrequencyMonitorWidget: React.FC = () => {
  const [report, setReport] = useState<ActivityMonitorReport>(() => activityFrequencyMonitor.evaluateAndMonitor());
  const [isManualRebooting, setIsManualRebooting] = useState<boolean>(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const res = activityFrequencyMonitor.evaluateAndMonitor();
      setReport(res);
    }, 5000); // به‌روزرسانی بلادرنگ هر ۵ ثانیه (شبیه‌ساز بازه ۶۰ ثانیه‌ای)
    return () => clearInterval(interval);
  }, []);

  const handleManualReinstantiation = () => {
    setIsManualRebooting(true);
    setTimeout(() => {
      const res = activityFrequencyMonitor.evaluateAndMonitor();
      setReport(res);
      setIsManualRebooting(false);
    }, 800);
  };

  return (
    <CollapsibleCard
      title="ماژول پایش فرکانس فعالیت و بازنگری خودکار مغزها (Activity Frequency Monitor)"
      badge="پایش فرکانس هر ۶۰ ثانیه"
      badgeColor="text-emerald-300 bg-emerald-950/80 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
      defaultOpen={true}
      icon={<Radio className="w-5 h-5 text-emerald-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleManualReinstantiation}
          disabled={isManualRebooting}
          className="px-2.5 py-1 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isManualRebooting ? 'animate-spin' : ''}`} />
          <span>{isManualRebooting ? 'در حال بازنگری شبکه...' : 'بازنگری دستی (Re-instantiate)'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        {/* Status Header Bar */}
        <div className="bg-[#020917] border border-emerald-500/30 rounded-2xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 rounded-xl text-emerald-400 border border-emerald-500/30">
              <Activity className="w-4 h-4 text-emerald-300 animate-pulse" />
            </div>
            <div>
              <div className="text-white font-bold font-sans text-xs">وضعیت همگام‌سازی و فرکانس پردازش شبکه:</div>
              <div className="text-[11px] text-emerald-400 font-mono mt-0.5">
                مجموع پردازش‌ها در هر ۶۰ ثانیه: {report.totalExecutions60s} | کل بازنگری‌ها (Reboots): {report.reinstantiationsTriggered}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-xl bg-emerald-950 text-emerald-300 border border-emerald-500/40 text-xs font-bold font-mono">
              همگام‌سازی شبکه: {report.networkSyncPct.toFixed(1)}٪ 🟢
            </span>
          </div>
        </div>

        {/* 10 Brains Activity Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {report.brains.map((b) => (
            <div key={b.brainId} className="bg-[#041124] p-3 rounded-xl border border-emerald-950/70 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-200 font-sans font-bold truncate">{b.nameFa}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                  b.status === 'ACTIVE' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                }`}>
                  {b.status}
                </span>
              </div>
              <div className="flex items-baseline justify-between text-[11px] font-mono">
                <span className="text-slate-400">فرکانس ۶۰s:</span>
                <span className="text-emerald-400 font-bold">{b.processedCount60s} پردازش</span>
              </div>
              <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-emerald-950">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, (b.processedCount60s / 80) * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1">
                <span>سلامت: <strong className="text-emerald-300">{b.healthScorePct}٪</strong></span>
                <span className="text-cyan-400">⚡ پایدار</span>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-[#040e21] p-3 rounded-xl border border-emerald-900/40 text-[11px] text-slate-200 leading-relaxed font-sans flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{report.statusMessageFa}</span>
        </div>
      </div>
    </CollapsibleCard>
  );
};
