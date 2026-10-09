/**
  * 🌐 ویجت تلفیق تصمیم‌گیری سلسله‌مراتبی (Hierarchical Decision Fusion Widget)
  * نمایش لایه‌های تخصصی مغزها، وزن لایه‌ها، همگرایی وزنی و خروجی نهایی سیستم.
  */

import React, { useState, useEffect } from 'react';
import { Layers, GitMerge, CheckCircle2, ShieldAlert, RefreshCw, Cpu } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { hierarchicalDecisionFusionService, HierarchicalFusionResult } from '../services/hierarchicalDecisionFusion';

interface Props {
  volatilityPct?: number;
}

export const HierarchicalDecisionFusionWidget: React.FC<Props> = ({ volatilityPct = 1.4 }) => {
  const [result, setResult] = useState<HierarchicalFusionResult>(() => hierarchicalDecisionFusionService.evaluateHierarchicalFusion(volatilityPct));
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);

  useEffect(() => {
    setResult(hierarchicalDecisionFusionService.evaluateHierarchicalFusion(volatilityPct));
  }, [volatilityPct]);

  const handleEvaluate = () => {
    setIsEvaluating(true);
    setTimeout(() => {
      setResult(hierarchicalDecisionFusionService.evaluateHierarchicalFusion(volatilityPct));
      setIsEvaluating(false);
    }, 900);
  };

  return (
    <CollapsibleCard
      title="تلفیق تصمیم‌گیری سلسله‌مراتبی لایه‌ها (Hierarchical Decision Fusion)"
      badge={`همگرایی وزنی: ${result.finalConvergenceScore}%`}
      badgeColor={result.isActionApproved ? 'text-emerald-300 bg-emerald-950/80 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]' : 'text-amber-300 bg-amber-950/80 border-amber-500/40'}
      defaultOpen={true}
      icon={<GitMerge className="w-5 h-5 text-indigo-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleEvaluate}
          disabled={isEvaluating}
          className="px-2.5 py-1 rounded-lg bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/50 text-indigo-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isEvaluating ? 'animate-spin' : ''}`} />
          <span>{isEvaluating ? 'محاسبه لایه‌ها...' : 'محاسبه همگرایی لایه‌ها'}</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        <div className="bg-[#020917] border border-indigo-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-indigo-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-500/20 rounded-lg text-indigo-400 border border-indigo-500/30">
                <Layers className="w-4 h-4 text-indigo-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  معماری لایه‌های تخصصی و میانگین وزنی همگرایی:
                </span>
                <span className="text-[10px] text-indigo-300 font-mono mt-0.5 block">
                  تصمیم‌گیری نهایی برآیند تجمیع تمام لایه‌های تکنیکال، نقدینگی، ریسک و هوش متاست
                </span>
              </div>
            </div>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold flex items-center gap-1 ${
              result.isActionApproved ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50' : 'bg-amber-950 text-amber-300 border-amber-500/50'
            }`}>
              {result.isActionApproved ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />}
              <span>{result.isActionApproved ? 'تایید لایه‌ها و اجرا 🟢' : 'احتیاط / تعلیق'}</span>
            </span>
          </div>

          {/* Layers List Grid */}
          <div className="space-y-2.5 my-3">
            {result.layers.map((layer) => (
              <div key={layer.layerId} className="bg-[#041124] p-3 rounded-xl border border-indigo-950/80 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30">
                      وزن: {Math.round(layer.weight * 100)}%
                    </span>
                    <span className="font-bold text-white font-sans text-xs">{layer.layerNameFa}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-slate-300">
                      همگرایی: <strong className="text-cyan-300">{layer.convergenceScore}%</strong>
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      layer.signal === 'LONG' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                    }`}>
                      {layer.signal}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-indigo-950/60">
                  <span className="text-[10px] text-slate-400 font-sans">مغزهای عضو:</span>
                  {layer.contributingBrains.map((b, i) => (
                    <span key={i} className="px-2 py-0.5 bg-[#020712] text-slate-300 rounded text-[10px] border border-indigo-950">
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-indigo-900/40">
            🌐 {result.fusionStatusFa}
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
};
