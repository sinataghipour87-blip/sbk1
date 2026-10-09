/**
 * 🧬 ویجت مرکز تکامل خودکار مغزها با زمان‌بندی پویا ATR (Brain Self-Evolution Hub Widget)
 * نمایش کالبدشکافی معاملات ضررده و تنظیم پویا بازه یادگیری بر اساس تلاطم بازار
 */

import React, { useState, useEffect } from 'react';
import { Dna, RefreshCw, Cpu, Sparkles, CheckCircle2, Clock } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { brainEvolutionHub, EvolutionReport } from '../services/brainSelfEvolutionHub';

interface Props {
  recentHistory?: any[];
  currentAtrPct?: number;
}

export const BrainSelfEvolutionWidget: React.FC<Props> = ({ recentHistory = [], currentAtrPct = 1.4 }) => {
  const [report, setReport] = useState<EvolutionReport>(() => brainEvolutionHub.runSelfEvolutionCycle(recentHistory, currentAtrPct));
  const [isEvolving, setIsEvolving] = useState<boolean>(false);

  useEffect(() => {
    setReport(brainEvolutionHub.runSelfEvolutionCycle(recentHistory, currentAtrPct));
  }, [currentAtrPct, recentHistory]);

  const handleRunEvolution = () => {
    setIsEvolving(true);
    setTimeout(() => {
      const res = brainEvolutionHub.runSelfEvolutionCycle(recentHistory, currentAtrPct);
      setReport(res);
      setIsEvolving(false);
    }, 1200);
  };

  return (
    <CollapsibleCard
      title="مرکز تکامل خودکار مغزها و زمان‌بند پویا ATR (Dynamic ATR Evolution Hub)"
      badge={`بازه تکامل: ${report.dynamicIntervalHours}h`}
      badgeColor="text-indigo-300 bg-indigo-950/80 border-indigo-500/40 shadow-[0_0_12px_rgba(99,102,241,0.3)]"
      defaultOpen={true}
      icon={<Dna className="w-5 h-5 text-indigo-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleRunEvolution}
          disabled={isEvolving}
          className="px-2.5 py-1 rounded-lg bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/50 text-indigo-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isEvolving ? 'animate-spin' : ''}`} />
          <span>{isEvolving ? 'در حال تکامل و کالیبراسیون...' : 'اجرای یادگیری مجدد آنی'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        <div className="bg-[#020917] border border-indigo-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-indigo-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-500/20 rounded-lg text-indigo-400 border border-indigo-500/30">
                <Clock className="w-4 h-4 text-indigo-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  زمان‌بند پویا مبتنی بر تلاطم بازار (ATR Scheduler):
                </span>
                <span className="text-[10px] text-indigo-300 font-mono mt-0.5 block">
                  تنظیم خودکار بازه یادگیری مغزها (به جای ۱۲ ساعت ثابت در بازار متلاطم)
                </span>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold bg-indigo-950 text-indigo-300 border-indigo-500/50 flex items-center gap-1">
              <span>وضعیت ATR: {report.marketVolatilityStateFa}</span>
            </span>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 text-[11px]">
            <div className="bg-[#041124] p-2.5 rounded-xl border border-indigo-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">بازه زمانی تکامل:</span>
              <span className="font-bold text-cyan-300 text-sm">{report.dynamicIntervalHours} ساعت</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-indigo-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">ضررهای کالبدشکافی‌شده:</span>
              <span className="font-bold text-rose-400 text-sm">{report.totalLosingTradesAnalyzed} معامله</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-indigo-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">سخت‌گیری آستانه سیگنال:</span>
              <span className="font-bold text-emerald-400 text-sm">+{report.optimizedThresholdDelta}٪</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-indigo-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">آخرین بازبینی:</span>
              <span className="font-bold text-indigo-300 text-xs">{report.lastEvolutionTimestamp}</span>
            </div>
          </div>

          <p className="text-xs text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-indigo-900/40">
            🧬 {report.evolutionStatusFa}
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
};
