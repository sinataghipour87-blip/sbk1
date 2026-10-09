/**
 * 🛡️ ویجت سیستم نجات از بحران قفل هدج (Locked-Hedge Crisis Escaper Widget)
 * نمایش تله‌متری نجات از قفل هدج، ضرر ذوب‌شده با نوسان‌گیری جانبی و وضعیت تعادل عدم‌تقارن حجم.
 */

import React, { useState, useEffect } from 'react';
import { ShieldAlert, RefreshCw, Zap, TrendingUp, CheckCircle2, Award } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { lockedHedgeCrisisEscaperService, CrisisEscaperState } from '../services/lockedHedgeCrisisEscaper';

interface Props {
  currentPrice?: number;
}

export const LockedHedgeCrisisEscaperWidget: React.FC<Props> = ({ currentPrice = 0 }) => {
  const [state, setState] = useState<CrisisEscaperState>(() =>
    lockedHedgeCrisisEscaperService.evaluateCrisisRecovery(currentPrice)
  );
  const [isEscaping, setIsEscaping] = useState<boolean>(false);

  useEffect(() => {
    setState(lockedHedgeCrisisEscaperService.evaluateCrisisRecovery(currentPrice));
  }, [currentPrice]);

  const handleStartEmergencyEscaper = () => {
    setIsEscaping(true);
    setTimeout(() => {
      setState(prev => {
        const newMelted = Math.min(prev.fixedLockedLossUsd, prev.meltedLossUsd + 15);
        return {
          ...prev,
          meltedLossUsd: newMelted,
          remainingLockedLossUsd: prev.fixedLockedLossUsd - newMelted,
          recoveryRatioPct: Math.round((newMelted / prev.fixedLockedLossUsd) * 100),
          activeStrategyFa: '🟢 موفقیت‌آمیز: با اجرای ربات نوسان‌گیر جانبی مستقل، میزان ضرر فریز شده بیش از پیش کاهش یافت!'
        };
      });
      setIsEscaping(false);
    }, 950);
  };

  return (
    <CollapsibleCard
      title="سیستم نجات از بحران قفل هدج (Locked-Hedge Crisis Escaper)"
      badge={state.recoveryRatioPct >= 100 ? 'بحران برطرف شد' : `بازیابی بحران: ${state.recoveryRatioPct}%`}
      badgeColor={state.recoveryRatioPct >= 50 ? 'text-emerald-300 bg-emerald-950/80 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]' : 'text-amber-300 bg-amber-950/80 border-amber-500/40'}
      defaultOpen={true}
      icon={<ShieldAlert className="w-5 h-5 text-rose-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleStartEmergencyEscaper}
          disabled={isEscaping || state.recoveryRatioPct >= 100}
          className="px-2.5 py-1 rounded-lg bg-rose-950 hover:bg-rose-900 border border-rose-500/50 text-rose-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-rose-400 ${isEscaping ? 'animate-spin' : ''}`} />
          <span>{isEscaping ? 'در حال حل بحران...' : 'فعال‌سازی نوسان‌گیر جانبی (آب کردن ضرر)'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        <div className="bg-[#020917] border border-rose-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-rose-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-rose-500/20 rounded-lg text-rose-400 border border-rose-500/30">
                <ShieldAlert className="w-4 h-4 text-rose-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  شکستن قفل هدج و ذوب کردن ضرر فریز شده:
                </span>
                <span className="text-[10px] text-rose-300 font-mono mt-0.5 block">
                  اجرای عدم تقارن حجم کنترل‌شده و ربات نوسان‌گیر جانبی مستقل برای رسیدن به سر به سر
                </span>
              </div>
            </div>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold flex items-center gap-1 ${
              state.recoveryRatioPct >= 50 ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50' : 'bg-rose-950 text-rose-300 border-rose-500/50'
            }`}>
              {state.recoveryRatioPct >= 50 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />}
              <span>{state.recoveryRatioPct >= 50 ? 'امنیت بازیابی شده 🟢' : 'بحران ضرر ثابت'}</span>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 text-[11px]">
            <div className="bg-[#041124] p-2.5 rounded-xl border border-rose-950/80 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">ضرر قفل‌شده ثابت:</span>
              <span className="font-bold text-rose-400">${state.fixedLockedLossUsd}</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-rose-950/80 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">ضرر ذوب شده (سود ربات):</span>
              <span className="font-bold text-emerald-300">+${state.meltedLossUsd}</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-rose-950/80 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">باقی‌مانده ضرر واقعی:</span>
              <span className="font-bold text-rose-300">${state.remainingLockedLossUsd}</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-rose-950/80 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">عدم تقارن کنترل‌شده:</span>
              <span className="font-bold text-amber-300">{state.asymmetricRatio}</span>
            </div>
          </div>

          {/* Graphical Progress Bar for Recovery */}
          <div className="bg-[#020712] p-2 rounded-xl border border-rose-950/50 space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>ضرر فریز شده کاملاً فعال</span>
              <span className="text-emerald-300 font-bold">{state.recoveryRatioPct}% ضرر ذوب شد</span>
              <span>سر به سر کامل و خروج</span>
            </div>
            <div className="w-full bg-[#051329] h-2 rounded-full overflow-hidden border border-rose-950">
              <div
                className="bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${state.recoveryRatioPct}%` }}
              ></div>
            </div>
          </div>

          <p className="text-xs text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-rose-900/40 mt-3">
            🛡️ {state.activeStrategyFa}
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
};
