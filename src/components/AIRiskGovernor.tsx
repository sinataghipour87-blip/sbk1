import React, { useState } from 'react';
import { ShieldAlert, Zap, TrendingDown, Activity, AlertTriangle, Cpu, CheckCircle2, DollarSign, BarChart2 } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';

export interface RiskGovernorState {
  sharpDropProb5m: number; // e.g., 18% to 85%
  macroCorrelationScore: number; // -1.0 to +1.0 (e.g., -0.82 with DXY)
  deRiskActive: boolean;
  reducedExposurePct: number; // 50%
  liquidationRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  lastDeRiskTimestamp: string | null;
}

interface AIRiskGovernorProps {
  governorState: RiskGovernorState;
  onTriggerManualDeRisk: () => void;
  onResetRiskGovernor: () => void;
}

export const AIRiskGovernor: React.FC<AIRiskGovernorProps> = ({
  governorState,
  onTriggerManualDeRisk,
  onResetRiskGovernor,
}) => {
  const isHighRisk = governorState.sharpDropProb5m >= 65;

  const riskColor =
    governorState.sharpDropProb5m >= 75
      ? 'text-rose-400 border-rose-500/50 bg-rose-950/40'
      : governorState.sharpDropProb5m >= 50
      ? 'text-amber-400 border-amber-500/50 bg-amber-950/40'
      : 'text-emerald-400 border-emerald-500/50 bg-emerald-950/40';

  const riskBadge =
    governorState.sharpDropProb5m >= 75
      ? 'ریزش شارپ بحرانی (Critical Spill Risk)'
      : governorState.sharpDropProb5m >= 50
      ? 'هشدار نوسان متوسط (Warning)'
      : 'وضعیت نرمال و امن (Safe Window)';

  return (
    <CollapsibleCard
      title="ماژول SB-Risk-Governor (فرماندار هوشمند ریسک کلان SB)"
      badge="MACRO & FLASH-CRASH GUARD"
      defaultOpen={true}
      icon={<ShieldAlert className="w-5 h-5 text-purple-400" />}
      headerAction={
        governorState.deRiskActive ? (
          <span className="px-2.5 py-0.5 rounded-lg bg-rose-500/20 border border-rose-500/50 text-rose-300 text-[11px] font-mono font-bold flex items-center gap-1 animate-pulse">
            <AlertTriangle className="w-3 h-3 text-rose-400" /> کاهش ۵۰٪ ریسک
          </span>
        ) : (
          <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> وضعیت امن SB
          </span>
        )
      }
    >
      <div className="space-y-4">
        {/* Metrics Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1. Sharp Drop Probability 5m */}
          <div className={`p-3 rounded-xl border ${riskColor}`}>
            <span className="text-[11px] text-slate-300 block mb-1">احتمال ریزش شارپ (۵ دقیقه آینده):</span>
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-mono font-extrabold">{governorState.sharpDropProb5m}%</span>
              <span className="text-[10px] font-mono font-bold">{riskBadge}</span>
            </div>
            <div className="mt-2 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  governorState.sharpDropProb5m >= 65 ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]' : 'bg-emerald-400'
                }`}
                style={{ width: `${governorState.sharpDropProb5m}%` }}
              />
            </div>
          </div>

          {/* 2. DXY Macro Correlation */}
          <div className="bg-[#0b041a] border border-purple-900/60 rounded-xl p-3">
            <span className="text-[11px] text-slate-300 block mb-1">همبستگی کلان با شاخص DXY:</span>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-mono font-bold text-purple-300">
                {governorState.macroCorrelationScore.toFixed(2)}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">معکوس قوی (High Negative)</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">جهت‌گیری آنی در اسپایک‌های دلار</p>
          </div>

          {/* 3. Reduce Exposure Status */}
          <div className="bg-[#0b041a] border border-purple-900/60 rounded-xl p-3">
            <span className="text-[11px] text-slate-300 block mb-1">کاهش خودکار مارجین (De-Risk):</span>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-mono font-bold text-amber-300">
                {governorState.reducedExposurePct}%
              </span>
              <span className="text-[10px] text-slate-400">کاهش ۵۰٪ حجم ریسک</span>
            </div>
            <p className="text-[10px] text-emerald-400 mt-1">انتقال سریع ۵۰٪ مارجین به کیف پول</p>
          </div>

          {/* 4. Liquidation Cascade Threat */}
          <div className="bg-[#0b041a] border border-purple-900/60 rounded-xl p-3">
            <span className="text-[11px] text-slate-300 block mb-1">خطر لیکوئیدیشن آبشاری فیوچرز:</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-sm font-mono font-bold ${isHighRisk ? 'text-rose-400' : 'text-emerald-400'}`}>
                {governorState.liquidationRiskLevel}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">پایش تراکم حد ضررها در L2</p>
          </div>
        </div>

        {/* Control Banner */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#060112] border border-purple-900/60 p-3 rounded-xl text-xs">
          <div className="flex items-center gap-2 text-slate-200">
            <Cpu className="w-4 h-4 text-purple-400 shrink-0" />
            <span>
              در صورت عبور احتمال ریزش شارپ از ۶۵٪، الگوریتم SB به صورت خودکار ۵۰٪ مارجین پوزیشن فعال را آزاد کرده و استاپ را روی نقطه ورود قفل می‌کند.
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
            <div className="px-3 py-1.5 rounded-lg bg-purple-950/80 border border-purple-400/50 text-purple-200 font-mono font-bold text-xs flex items-center gap-1.5 shadow-[0_0_12px_rgba(168,85,247,0.2)]">
              <TrendingDown className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              <span>🛡️ کاهش ۵۰٪ ریسک SB (فعال)</span>
            </div>

            <button
              onClick={onResetRiskGovernor}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-purple-900/80 text-slate-300 hover:text-white transition-colors text-xs font-mono"
            >
              بازتنظیم
            </button>
          </div>
        </div>

        {/* ۳۲. بخش کالیبراسیون ریسک پویا (Dynamic Multi-Factor Risk Sizing) */}
        <div className="bg-slate-950/90 border border-indigo-900/50 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold text-indigo-200">
                مدیریت ریسک پویا و کالیبره‌شده (بند ۳۲ - حذف ریسک ثابت ۱.۵٪):
              </span>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
              فرمول ۷ عامله فعال
            </span>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            ریسک سرمایه در هر پوزیشن هرگز مقدار ثابت ۱.۵٪ نیست؛ بلکه به صورت لحظه‌ای با ۷ فاکتور زنده تطبیق داده می‌شود:
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-[10px] font-mono">
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
              <span className="text-slate-400 block text-[9px]">۱. نوسان (Volatility)</span>
              <span className="font-bold text-amber-300">GARCH / ATR</span>
            </div>
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
              <span className="text-slate-400 block text-[9px]">۲. افت سرمایه (DD)</span>
              <span className="font-bold text-cyan-300">سپر دراوداون</span>
            </div>
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
              <span className="text-slate-400 block text-[9px]">۳. لبه آماری (Edge)</span>
              <span className="font-bold text-emerald-300">Expectancy R</span>
            </div>
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
              <span className="text-slate-400 block text-[9px]">۴. احتمال (Prob)</span>
              <span className="font-bold text-indigo-300">Central Prob</span>
            </div>
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
              <span className="text-slate-400 block text-[9px]">۵. فاصله اطمینان (CI)</span>
              <span className="font-bold text-purple-300">Wilson Bounds</span>
            </div>
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
              <span className="text-slate-400 block text-[9px]">۶. همبستگی (Corr)</span>
              <span className="font-bold text-rose-300">DXY / Beta</span>
            </div>
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
              <span className="text-slate-400 block text-[9px]">۷. رژیم (Regime)</span>
              <span className="font-bold text-yellow-300">۹ رژیم کالیبره</span>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
};
