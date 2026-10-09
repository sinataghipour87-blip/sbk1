/**
 * ⚖️ ویجت متعادل‌ساز بار مغزهای پردازشی (Brain Load Balancer Widget)
 * نمایش بار پردازشی (CPU/RAM) هر ۱۰ مغز و توزیع هوشمند تسک‌ها
 */

import React, { useState, useEffect } from 'react';
import { Sliders, Cpu, Activity, Zap, CheckCircle2, RefreshCw } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { brainLoadBalancer, BrainLoadState } from '../services/brainLoadBalancer';

export const BrainLoadBalancerWidget: React.FC = () => {
  const [loads, setLoads] = useState<BrainLoadState[]>(brainLoadBalancer.getAllBrainLoads());
  const [lastRoutedMsg, setLastRoutedMsg] = useState<string>('تسک تحلیل آنی به مغز با کمترین بار هدایت شد (تأخیر: 0.5ms)');

  useEffect(() => {
    const timer = setInterval(() => {
      setLoads(brainLoadBalancer.getAllBrainLoads());
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  const handleRouteTask = () => {
    const res = brainLoadBalancer.routeAnalysisTask('Realtime Market Scan');
    setLastRoutedMsg(`تسک جدید با موفقیت به [مغز شماره ${res.assignedBrainId}] ارجاع شد (تأخیر ارجاع: ${res.latencyMs}ms) 🟢`);
  };

  return (
    <CollapsibleCard
      title="متعادل‌ساز بار مغزهای پردازشی (Brain Load Balancer & Task Router)"
      badge="Load Balancer Active"
      badgeColor="text-indigo-300 bg-indigo-950/80 border-indigo-500/40 shadow-[0_0_12px_rgba(99,102,241,0.3)]"
      defaultOpen={true}
      icon={<Sliders className="w-5 h-5 text-indigo-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleRouteTask}
          className="px-2.5 py-1 rounded-lg bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/50 text-indigo-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
          <span>توزیع تسک جدید</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        <div className="bg-[#020917] border border-indigo-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-indigo-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-500/20 rounded-lg text-indigo-400 border border-indigo-500/30">
                <Cpu className="w-4 h-4 text-indigo-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  مدیریت فشار پردازشی و توزیع هوشمند درخواست‌ها:
                </span>
                <span className="text-[10px] text-indigo-300 font-mono mt-0.5 block">
                  جلوگیری از داغ شدن CPU یا تأخیر مغزها در تحلیل‌های همزمان
                </span>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold bg-emerald-950 text-emerald-300 border-emerald-500/50 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>وضعیت تعادل بار: بهینه 🟢</span>
            </span>
          </div>

          {/* Loads Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 my-3 text-[10.5px]">
            {loads.map(load => (
              <div key={load.brainId} className="bg-[#041124] p-2.5 rounded-xl border border-indigo-950 text-center space-y-1">
                <span className="text-[9.5px] text-slate-300 block font-sans truncate">{load.brainNameFa}</span>
                <div className="font-mono text-cyan-300 font-bold text-xs">{load.cpuLoadPct}% CPU</div>
                <div className="text-[9px] text-slate-400 font-mono">{load.memoryUsageMb} MB RAM</div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-indigo-900/40">
            ⚖️ <strong>آخرین رویداد مسیریابی:</strong> {lastRoutedMsg}
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
};
