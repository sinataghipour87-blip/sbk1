/**
 * 🧠 ویجت موتور پیش‌بینی متقاطع مغزها (Cross-Brain Predictive Engine Widget)
 * تله‌متری اجماع نهایی تصمیم‌گیری ۱۰ مغز پردازشی با کمک لایه شبکه عصبی شبکه کوچک.
 */

import React, { useState, useEffect } from 'react';
import { Network, Activity, RefreshCw, ShieldCheck, Zap, AlertTriangle } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { crossBrainPredictiveEngineService, CrossBrainPrediction } from '../services/crossBrainPredictiveEngine';

export const CrossBrainPredictiveEngineWidget: React.FC = () => {
  const [prediction, setPrediction] = useState<CrossBrainPrediction>(() =>
    crossBrainPredictiveEngineService.getPredictionConsensus()
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const handleSyncNeuralNet = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setPrediction(crossBrainPredictiveEngineService.getPredictionConsensus());
      setIsSyncing(false);
    }, 850);
  };

  return (
    <CollapsibleCard
      title="موتور پیش‌بینی متقاطع مغزها (Cross-Brain Predictive Engine)"
      badge={`ضریب اجماع نهایی: ${prediction.consensusConfidencePct}%`}
      badgeColor={prediction.isTradeApproved ? 'text-emerald-300 bg-emerald-950/80 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]' : 'text-amber-300 bg-amber-950/80 border-amber-500/40'}
      defaultOpen={true}
      icon={<Network className="w-5 h-5 text-indigo-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleSyncNeuralNet}
          disabled={isSyncing}
          className="px-2.5 py-1 rounded-lg bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/50 text-indigo-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'تلفیق شبکه عصبی...' : 'کالیبره شبکه عصبی'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        <div className="bg-[#020917] border border-indigo-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-indigo-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-500/20 rounded-lg text-indigo-400 border border-indigo-500/30">
                <Network className="w-4 h-4 text-indigo-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  تجمیع و تلفیق نهایی آرا با مدل عصبی کوچک:
                </span>
                <span className="text-[10px] text-indigo-300 font-mono mt-0.5 block">
                  محاسبه ضریب اطمینان اجماع نهایی (Consensus Confidence) بر اساس وزن اثرگذاری مغزها
                </span>
              </div>
            </div>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold flex items-center gap-1 ${
              prediction.isTradeApproved ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50' : 'bg-amber-950 text-amber-300 border-amber-500/50'
            }`}>
              {prediction.isTradeApproved ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
              <span>{prediction.isTradeApproved ? 'سیگنال تاییدشده 🟢' : 'فاقد اجماع لازم'}</span>
            </span>
          </div>

          {/* Consensus confidence bar */}
          <div className="my-3 space-y-1.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400 font-sans">ضریب اطمینان اجماع:</span>
              <span className="text-cyan-300 font-bold">{prediction.consensusConfidencePct}%</span>
            </div>
            <div className="w-full bg-[#051329] h-2.5 rounded-full overflow-hidden border border-indigo-950">
              <div
                className="bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-700"
                style={{ width: `${prediction.consensusConfidencePct}%` }}
              ></div>
            </div>
          </div>

          {/* Grid of brains and their weights/signals */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 my-3 text-[10px]">
            {prediction.brainDecisions.map((brain) => (
              <div key={brain.brainId} className="bg-[#041124] p-2 rounded-xl border border-indigo-950/80 text-center space-y-1">
                <span className="text-slate-300 block font-sans truncate">{brain.nameFa}</span>
                <div className="flex items-center justify-between text-[9px] px-1 bg-[#020712] py-0.5 rounded border border-indigo-950">
                  <span className="text-slate-400">وزن: {Math.round(brain.weight * 100)}%</span>
                  <span className={brain.individualSignal === 'LONG' ? 'text-emerald-400' : 'text-slate-400'}>
                    {brain.individualSignal}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-indigo-900/40">
            🧠 {prediction.decisionStatusFa}
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
};
