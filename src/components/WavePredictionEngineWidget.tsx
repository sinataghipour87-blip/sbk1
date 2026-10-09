import React from 'react';
import { Waves, Target, ShieldAlert, Sparkles, CheckCircle2, Clock, AlertTriangle, ArrowRight, Zap, Scale } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { runWavePredictionEngine, WaveEngineFullResult } from '../services/predictiveEngine';

interface Props {
  analysis?: any;
  prediction?: any;
}

export const WavePredictionEngineWidget: React.FC<Props> = ({ analysis, prediction }) => {
  if (!analysis) return null;

  const waveEngine: WaveEngineFullResult = runWavePredictionEngine(analysis, prediction);
  const { stageDetails, predictionMetrics, candidateSelection, antiChasingGuard, eventTriggerSequence } = waveEngine;

  return (
    <CollapsibleCard
      title="موتور هوشمند پیش‌بینی امواج و انتخاب نقطه ورود (Wave Prediction Engine)"
      badge={stageDetails.currentStage}
      badgeColor={stageDetails.isTradeableStage ? 'text-emerald-300 bg-emerald-950/80 border-emerald-500/40' : 'text-amber-300 bg-amber-950/80 border-amber-500/40'}
      defaultOpen={true}
      icon={<Waves className="w-5 h-5 text-cyan-400 animate-pulse" />}
    >
      <div className="space-y-4">
        {/* Banner Overview */}
        <div className="p-3 bg-[#030d1e] border border-cyan-500/40 rounded-xl flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span className="font-sans font-bold text-slate-200">مرحله زنده موج:</span>
            <span className="text-cyan-300 font-bold">{stageDetails.stageNameFa}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 font-sans">اطمینان مرحله:</span>
            <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 font-bold border border-cyan-800">
              {stageDetails.stageConfidencePct !== null ? `${stageDetails.stageConfidencePct}٪` : 'UNVALIDATED'}
            </span>
          </div>
        </div>

        {/* 1. Four separately learned wave outcomes */}
        <div className="bg-[#020814] border border-indigo-900/60 rounded-xl p-3.5 space-y-2 font-mono text-xs">
          <div className="text-slate-300 font-sans font-bold text-xs flex items-center gap-1.5 border-b border-indigo-950 pb-2">
            <Target className="w-3.5 h-3.5 text-cyan-400" />
            <span>چهار خروجی مستقل مدل موج (Outcome-Based):</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 pt-1">
            <div className="bg-[#040e21] p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 font-sans block mb-0.5">۱) نرخ continuation تجربیِ موج هم‌کلاس:</span>
              <span className="text-sm font-black text-cyan-300">{predictionMetrics.continuationProbabilityPct === null ? 'UNVALIDATED' : `${predictionMetrics.continuationProbabilityPct}٪`}</span>
            </div>

            <div className="bg-[#040e21] p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 font-sans block mb-0.5">۲) حرکت باقیماندهٔ مورد انتظار:</span>
              <span className="text-sm font-black text-emerald-400">
                {predictionMetrics.expectedMoveMagnitudeAtr === null || predictionMetrics.expectedMoveMagnitudePct === null
                  ? 'UNVALIDATED'
                  : `${predictionMetrics.expectedMoveMagnitudeAtr} ATR (${predictionMetrics.expectedMoveMagnitudePct}٪)`}
              </span>
            </div>

            <div className="bg-[#040e21] p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 font-sans block mb-0.5">۳) مدت باقی‌ماندهٔ مورد انتظار:</span>
              <span className="text-sm font-black text-amber-300 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>{predictionMetrics.expectedDurationMinutes === null ? 'UNVALIDATED' : `${predictionMetrics.expectedDurationMinutes} دقیقه`}</span>
              </span>
            </div>

            <div className="bg-[#040e21] p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 font-sans block mb-0.5">۴) احتمال بازگشت:</span>
              <span className="text-sm font-black text-rose-300">
                {predictionMetrics.reversalProbabilityPct === null ? 'UNVALIDATED' : `${predictionMetrics.reversalProbabilityPct}٪`}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 pt-2 text-[10px] text-slate-400">
            <span>Outcome پس از Stage: 5m {predictionMetrics.outcomeProbabilityByHorizon['5m'] === null ? 'UNVALIDATED' : `${predictionMetrics.outcomeProbabilityByHorizon['5m']}٪`}</span>
            <span>15m {predictionMetrics.outcomeProbabilityByHorizon['15m'] === null ? 'UNVALIDATED' : `${predictionMetrics.outcomeProbabilityByHorizon['15m']}٪`}</span>
            <span>30m {predictionMetrics.outcomeProbabilityByHorizon['30m'] === null ? 'UNVALIDATED' : `${predictionMetrics.outcomeProbabilityByHorizon['30m']}٪`}</span>
            <span>60m {predictionMetrics.outcomeProbabilityByHorizon['60m'] === null ? 'UNVALIDATED' : `${predictionMetrics.outcomeProbabilityByHorizon['60m']}٪`}</span>
          </div>
        </div>

        {/* 2. ANTI-CHASING GUARD (ITEM 14) */}
        <div className={`p-3.5 rounded-xl border font-mono text-xs space-y-2 ${
          antiChasingGuard.isChasingDetected
            ? 'bg-rose-950/30 border-rose-500/50 text-rose-200'
            : 'bg-[#020814] border-emerald-500/40 text-slate-200'
        }`}>
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <span className="font-sans font-bold flex items-center gap-1.5">
              <ShieldAlert className={`w-4 h-4 ${antiChasingGuard.isChasingDetected ? 'text-rose-400 animate-bounce' : 'text-emerald-400'}`} />
              <span>فیلتر آنتی‌چیسینگ و سنجش تعقیب قیمت (Anti-Chasing Filter):</span>
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              antiChasingGuard.isChasingDetected ? 'bg-rose-900/90 text-rose-200 border border-rose-600' : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
            }`}>
              {antiChasingGuard.chaseStatus}
            </span>
          </div>

          <p className="font-sans text-[11.5px] leading-relaxed">
            {antiChasingGuard.reasonFa}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px] pt-1">
            <div className="bg-[#040e21] p-2 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[9.5px]">فاصله از مبدا موج:</span>
              <span className="font-bold text-slate-200">{antiChasingGuard.distanceFromWaveOriginPct}٪</span>
            </div>
            <div className="bg-[#040e21] p-2 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[9.5px]">فاصله از VWAP:</span>
              <span className="font-bold text-slate-200">{antiChasingGuard.distanceFromEmaVwapPct}٪</span>
            </div>
            <div className="bg-[#040e21] p-2 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[9.5px]">حرکت طی‌شده (MFE):</span>
              <span className="font-bold text-amber-300">{antiChasingGuard.currentMoveMfePct}٪</span>
            </div>
            <div className="bg-[#040e21] p-2 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[9.5px]">حرکت باقیمانده:</span>
              <span className="font-bold text-emerald-400">{antiChasingGuard.remainingMoveExpectedPct}٪</span>
            </div>
          </div>
        </div>

        {/* 3. EVENT-BASED TRIGGER SEQUENCE CHECKLIST (ITEM 15) */}
        <div className="bg-[#020814] border border-indigo-900/60 rounded-xl p-3.5 space-y-2.5 font-mono text-xs font-sans">
          <div className="flex items-center justify-between border-b border-indigo-950 pb-2">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>زنجیره رویدادهای ورود (Event-Based Trigger Sequence):</span>
            </span>
            <span className="text-xs font-mono font-bold text-indigo-300">
              {eventTriggerSequence.completedStepsCount} / {eventTriggerSequence.totalStepsCount} مرحله
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {eventTriggerSequence.sequenceNodes.map((node) => (
              <div
                key={node.id}
                className={`p-2 rounded-lg border flex items-start gap-2 text-[11px] ${
                  node.isConfirmed
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                    : 'bg-slate-900/40 border-slate-800 text-slate-400'
                }`}
              >
                {node.isConfirmed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <span className="font-bold block">{node.nameFa}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">{node.detailsFa}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. CANDIDATES SELECTION BY EXPECTED VALUE (ITEM 13) */}
        <div className="bg-[#020814] border border-indigo-900/60 rounded-xl p-3.5 space-y-3 font-mono text-xs font-sans">
          <div className="flex items-center justify-between border-b border-indigo-950 pb-2">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-emerald-400" />
              <span>ارزیابی و انتخاب نقطه ورود بر اساس امید ریاضی (EV Selection):</span>
            </span>
            {candidateSelection.selectedCandidate && (
              <span className="text-[10.5px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                بهترین کاندید: {candidateSelection.selectedCandidate.id}
              </span>
            )}
          </div>

          <p className="text-[11.5px] text-cyan-300 bg-[#040e21] p-2.5 rounded-lg border border-indigo-900/50">
            📌 {candidateSelection.selectionReasonFa}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {candidateSelection.candidates.map((cand) => {
              const isSelected = candidateSelection.selectedCandidate?.id === cand.id;
              return (
                <div
                  key={cand.id}
                  className={`p-3 rounded-xl border space-y-2 transition-all ${
                    isSelected
                      ? 'bg-[#04142a] border-emerald-500/70 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                      : 'bg-[#030b1a] border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 font-sans">
                    <span className="text-xs font-bold text-slate-100">{cand.nameFa}</span>
                    {isSelected && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">برتر (EV Max)</span>}
                  </div>

                  <div className="space-y-1 text-[10.5px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-400">قیمت ورود:</span>
                      <strong className="text-slate-200">${cand.entryPrice.toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">نسبت R:R:</span>
                      <strong className="text-emerald-400">{cand.expectedR}R</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">احتمال رسیدن به TP:</span>
                      <strong className="text-cyan-300">{cand.tpProbabilityPct}٪</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">بازه اطمینان ۹۵٪:</span>
                      <strong className="text-indigo-300">
                        {cand.confidenceInterval
                          ? `${(cand.confidenceInterval.lowerBound * 100).toFixed(1)}–${(cand.confidenceInterval.upperBound * 100).toFixed(1)}٪`
                          : 'UNVALIDATED'}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">خطای کالیبراسیون / OOS:</span>
                      <strong className="text-indigo-300">
                        {cand.calibrationError !== null
                          ? `${(cand.calibrationError * 100).toFixed(1)}٪ | ${cand.sampleSize}/${cand.requiredOosSampleSize}`
                          : 'UNVALIDATED'}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Fill / MAE / MFE تاریخی:</span>
                      <strong className="text-indigo-300">
                        {cand.fillRate !== null
                          ? `${(cand.fillRate * 100).toFixed(1)}٪ | ${cand.historicalMaePct ?? 'N/A'} | ${cand.historicalMfePct ?? 'N/A'}`
                          : 'UNVALIDATED'}
                      </strong>
                    </div>
                    <div className="flex justify-between border-t border-slate-800/80 pt-1">
                      <span className="text-slate-400 font-sans font-bold">Expectancy واقعی Dataset:</span>
                      <strong className={`font-black ${cand.expectedValueUsd > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {cand.expectedValueUsd > 0 ? '+' : ''}${cand.expectedValueUsd.toFixed(2)}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
};
