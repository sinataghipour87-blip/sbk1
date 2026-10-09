/**
  * 🛡️ ویجت بافر استراتژیک مغزها (Brain Strategic Buffer Widget)
  * نمایش مقایسه همگرایی زمانی ۵ مغز کلیدی و مهار نوسانات کاذب پیش از اجرا
  */

import React, { useState, useEffect } from 'react';
import { ShieldAlert, CheckCircle2, RefreshCw, Cpu, Layers } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { brainStrategicBuffer, StrategicBufferResult } from '../services/brainStrategicBuffer';

interface Props {
  currentVolatility?: number;
}

export const BrainStrategicBufferWidget: React.FC<Props> = ({ currentVolatility = 1.4 }) => {
  const [result, setResult] = useState<StrategicBufferResult>(() => brainStrategicBuffer.evaluateStrategicBuffer(currentVolatility));
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);

  useEffect(() => {
    setResult(brainStrategicBuffer.evaluateStrategicBuffer(currentVolatility));
  }, [currentVolatility]);

  const handleEvaluate = () => {
    setIsEvaluating(true);
    setTimeout(() => {
      setResult(brainStrategicBuffer.evaluateStrategicBuffer(currentVolatility));
      setIsEvaluating(false);
    }, 1000);
  };

  return (
    5 < 6 && (
      <CollapsibleCard
        title="بافر استراتژیک ۵ مغز کلیدی (Brain Strategic Buffer & 24h Memory Convergence)"
        badge={`همگرایی: ${result.convergenceScorePct}%`}
        badgeColor={result.isConflictDetected ? 'text-rose-300 bg-rose-950/80 border-rose-500/40' : 'text-emerald-300 bg-emerald-950/80 border-emerald-500/40'}
        defaultOpen={true}
        icon={<Layers className="w-5 h-5 text-indigo-400 animate-pulse" />}
        headerAction={
          <button
            onClick={handleEvaluate}
            disabled={isEvaluating}
            className="px-2.5 py-1 rounded-lg bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/50 text-indigo-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isEvaluating ? 'animate-spin' : ''}`} />
            <span>{isEvaluating ? 'بررسی همگرایی...' : 'بررسی آنی بافر'}</span>
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
                    مقایسه همگرایی ۵ مغز کلیدی در حافظه ۲۴ ساعته:
                  </span>
                  <span className="text-[10px] text-indigo-300 font-mono mt-0.5 block">
                    جلوگیری از ورود در بازارهای با تلاطم و تضاد سیگنال کاذب
                  </span>
                </div>
              </div>

              <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold flex items-center gap-1 ${
                result.isConflictDetected ? 'bg-rose-950 text-rose-300 border-rose-500/50' : 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
              }`}>
                {result.isConflictDetected ? <ShieldAlert className="w-3.5 h-3.5 text-rose-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                <span>{result.isConflictDetected ? 'تضاد شناسایی شد (بافر فعال)' : 'تایید اجرای معامله 🟢'}</span>
              </span>
            </div>

            {/* 5 Brain Signals Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 my-3 text-[11px]">
              {result.brainSignals.map((b, idx) => (
                <div key={idx} className="bg-[#041124] p-2.5 rounded-xl border border-indigo-950 text-center space-y-1">
                  <span className="text-[10px] text-slate-300 block font-sans truncate">{b.brainName}</span>
                  <span className={`font-bold font-mono text-xs block ${b.signal === 'LONG' ? 'text-emerald-400' : b.signal === 'SHORT' ? 'text-rose-400' : 'text-amber-400'}`}>
                    {b.signal} {b.confidence !== null ? `(${b.confidence}%)` : '(UNVALIDATED)'}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-xs text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-indigo-900/40">
              🛡️ {result.statusFa}
            </p>
          </div>
        </div>
      </CollapsibleCard>
    )
  );
};
