/**
 * 🛡️ ویجت پروتکل هشدار زودهنگام مغزها (Brain Consensus Early Warning Protocol Widget)
 * نمایش وضعیت هشدار پیش‌دستانه نوسان و تقویت خودکار وزن مغزهای محافظتی به جای توقف معاملات
 */

import React, { useState, useEffect } from 'react';
import { ShieldAlert, ShieldCheck, Zap, Activity, Cpu, AlertTriangle } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { evaluateEarlyWarningProtocol, EarlyWarningState } from '../services/earlyWarningProtocol';

interface Props {
  analysis?: any;
}

export const EarlyWarningProtocolWidget: React.FC<Props> = ({ analysis }) => {
  const [warningState, setWarningState] = useState<EarlyWarningState>(() => {
    const vol = analysis?.volatilityPct ?? 1.4;
    const obi = analysis?.obi ?? 0.12;
    return evaluateEarlyWarningProtocol(vol, obi, 'EXPANSION');
  });

  useEffect(() => {
    const vol = analysis?.volatilityPct ?? 1.4;
    const obi = analysis?.obi ?? 0.12;
    const regime = vol > 3.0 ? 'SPIKE_TURBULENCE' : 'EXPANSION';
    setWarningState(evaluateEarlyWarningProtocol(vol, obi, regime));
  }, [analysis]);

  return (
    <CollapsibleCard
      title="پروتکل هشدار زودهنگام مغزها (Brain Consensus Early Warning Protocol)"
      badge="Early Warning Safety Core"
      badgeColor="text-amber-300 bg-amber-950/80 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
      defaultOpen={true}
      icon={<ShieldAlert className="w-5 h-5 text-amber-400 animate-pulse" />}
    >
      <div className="space-y-3 font-mono text-xs">
        <div className={`border rounded-2xl p-3.5 shadow-xl transition-all ${
          warningState.isEarlyWarningTriggered
            ? 'bg-amber-950/30 border-amber-500/50'
            : 'bg-[#020917] border-indigo-500/40'
        }`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-indigo-950">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg border ${
                warningState.isEarlyWarningTriggered ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
              }`}>
                {warningState.isEarlyWarningTriggered ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <ShieldCheck className="w-4 h-4 text-indigo-300" />}
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  وضعیت پروتکل هشدار پیش‌دستانه نوسان:
                </span>
                <span className="text-[10px] text-amber-300 font-mono mt-0.5 block">
                  {warningState.activeProtocolNameFa}
                </span>
              </div>
            </div>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold flex items-center gap-1 ${
              warningState.isEarlyWarningTriggered
                ? 'bg-amber-950 text-amber-300 border-amber-500/50'
                : 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
            }`}>
              {warningState.isEarlyWarningTriggered ? <Zap className="w-3.5 h-3.5 text-amber-400" /> : <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
              <span>سطح تهدید: {warningState.volatilityThreatLevel}</span>
            </span>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 my-3 text-[11px]">
            <div className="bg-[#041124] p-2.5 rounded-xl border border-indigo-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">تقویت وزن مغزهای امن:</span>
              <span className="font-bold text-amber-300 text-sm">+{warningState.safeBrainsWeightBoostPct}٪</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-indigo-950 text-center">
              <span className="text-[10px] text-slate-400 block font-sans">وضعیت تداوم معاملات:</span>
              <span className="font-bold text-emerald-400 text-sm">فعال و بدون توقف 🟢</span>
            </div>
            <div className="bg-[#041124] p-2.5 rounded-xl border border-indigo-950 text-center col-span-2 sm:col-span-1">
              <span className="text-[10px] text-slate-400 block font-sans">سیستم شناور و هدج:</span>
              <span className="font-bold text-cyan-300 text-sm">کاملاً همگام</span>
            </div>
          </div>

          <p className="text-xs text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-indigo-900/40">
            🛡️ <strong>اقدام اصلاحی خودکار:</strong> {warningState.mitigationActionFa}
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
};
