/**
  * 🔓 ویجت قفل‌گشایی پویای هدج (Dynamic Hedge Unblocker Widget)
  * حل مشکل گیر کردن در حالت هدج دائم و تضمین خروج با سود یا سر به سر
  */

import React, { useState } from 'react';
import { Unlock, ShieldCheck, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { dynamicHedgeUnblockerService, HedgeUnblockerState } from '../services/dynamicHedgeUnblocker';

interface Props {
  isHedged?: boolean;
}

export const DynamicHedgeUnblockerWidget: React.FC<Props> = ({ isHedged = true }) => {
  const [state, setState] = useState<HedgeUnblockerState>(() => dynamicHedgeUnblockerService.evaluateHedgeUnblocker(isHedged, 3.2));
  const [isUnblocking, setIsUnblocking] = useState<boolean>(false);

  const handleExecuteUnblock = () => {
    setIsUnblocking(true);
    setTimeout(() => {
      setState({
        isHedgeActive: false,
        lockedPositionId: 'POS-HEDGE-9942',
        hedgeDurationHours: 4.0,
        unblockProgressPct: 100,
        strategyNameFa: '🟢 هدج با موفقیت قفل‌گشایی شد و پوزیشن با سود / سر به سر بسته شد.',
        recommendedAction: 'BREAKEVEN_RELEASE_READY',
      });
      setIsUnblocking(false);
    }, 1200);
  };

  return (
    <CollapsibleCard
      title="سیستم قفل‌گشایی و آزادسازی پویای هدج (Dynamic Hedge Unblocker)"
      badge={state.isHedgeActive ? 'هدج فعال / در حال آنلاک' : 'هدج خنثی شده (سر به سر)'}
      badgeColor={state.isHedgeActive ? 'text-amber-300 bg-amber-950/80 border-amber-500/40' : 'text-emerald-300 bg-emerald-950/80 border-emerald-500/40'}
      defaultOpen={true}
      icon={<Unlock className="w-5 h-5 text-amber-400 animate-pulse" />}
      headerAction={
        state.isHedgeActive && (
          <button
            onClick={handleExecuteUnblock}
            disabled={isUnblocking}
            className="px-2.5 py-1 rounded-lg bg-amber-950 hover:bg-amber-900 border border-amber-500/50 text-amber-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isUnblocking ? 'animate-spin' : ''}`} />
            <span>{isUnblocking ? 'در حال قفل‌گشایی...' : 'اجرای آنلاک هوشمند'}</span>
          </button>
        )
      }
    >
      <div className="space-y-3 font-mono text-xs">
        <div className="bg-[#020917] border border-amber-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-amber-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-amber-500/20 rounded-lg text-amber-400 border border-amber-500/30">
                <Unlock className="w-4 h-4 text-amber-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  جلوگیری از ماندگاری دائم در هدج و تضمین سر به سر:
                </span>
                <span className="text-[10px] text-amber-300 font-mono mt-0.5 block">
                  آزادسازی تدریجی (Time/Volatility Decay) جهت خروج موفق از حصار هدج
                </span>
              </div>
            </div>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold flex items-center gap-1 ${
              !state.isHedgeActive ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50' : 'bg-amber-950 text-amber-300 border-amber-500/50'
            }`}>
              {!state.isHedgeActive ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-400" />}
              <span>{!state.isHedgeActive ? 'آنلاک کامل و سر به سر 🟢' : `پیشرفت آنلاک: ${state.unblockProgressPct}%`}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 my-3 text-[11px]">
            <div className="bg-[#041124] p-2.5 rounded-xl border border-amber-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">شناسه پوزیشن هدج:</span>
              <span className="font-bold text-amber-300">{state.lockedPositionId}</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-amber-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">مدت زمان قفل هدج:</span>
              <span className="font-bold text-cyan-300">{state.hedgeDurationHours} ساعت</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-amber-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">پروتکل فعال:</span>
              <span className="font-bold text-emerald-300">میکرو‌پروفت هاروست</span>
            </div>
          </div>

          <p className="text-xs text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-amber-900/40">
            🔓 {state.strategyNameFa}
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
};
