import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Zap,
  Lock,
  Cpu,
  Layers,
  Activity,
  Award,
  Filter,
} from 'lucide-react';
import {
  brainStatisticalEdgeVerifier,
  SystemBrainsTruthValidationReport,
  BrainEdgeAudit,
} from '../services/brainStatisticalEdgeVerifier';
import { AnalysisResult, TradeHistory } from '../types/trading';
import { getTradeHistory } from '../services/history';

interface BrainStatisticalEdgeVerifierWidgetProps {
  analysis?: AnalysisResult | null;
}

export const BrainStatisticalEdgeVerifierWidget: React.FC<BrainStatisticalEdgeVerifierWidgetProps> = ({
  analysis,
}) => {
  const [report, setReport] = useState<SystemBrainsTruthValidationReport>(() =>
    brainStatisticalEdgeVerifier.verifyAllBrainsEdge(analysis ?? null, getTradeHistory())
  );

  const runTruthAudit = () => {
    const history = getTradeHistory();
    setReport(brainStatisticalEdgeVerifier.verifyAllBrainsEdge(analysis ?? null, history));
  };

  useEffect(() => {
    runTruthAudit();
    const interval = setInterval(runTruthAudit, 12000);
    return () => clearInterval(interval);
  }, [analysis]);

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 shadow-2xl backdrop-blur-md relative overflow-hidden transition-all duration-300 hover:border-slate-700">
      {/* Background Accent */}
      <div className="absolute -top-24 -left-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
            <Cpu className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100">
                سیستم حقیقت‌سنجی آماری و ممیزی Edge مغزها (Brain Edge Verification System)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                قانون ممیزی لبه آماری
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              مغزی که Edge اثبات‌شده در رژیم جاری ندارد حق افزایش Probability نهایی را ندارد (افزایش مجاز = ۰.۰٪)
            </p>
          </div>
        </div>

        <button
          onClick={runTruthAudit}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all flex items-center gap-1.5 text-xs"
        >
          <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
          <span>ارزیابی حقیقت</span>
        </button>
      </div>

      {/* Overall Truth Summary Box */}
      <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-slate-200">
              نتیجه ممیزی لبه آماری در رژیم فعلی بازار ({report.activeRegime})
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{report.overallTruthSummaryFa}</p>
        </div>

        <div className="flex items-center gap-2 text-center flex-shrink-0">
          <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30">
            <span className="text-[10px] text-slate-400 block">دارای Edge</span>
            <span className="text-sm font-bold text-emerald-400">{report.brainsWithVerifiedEdgeCount} مغز</span>
          </div>
          <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-500/30">
            <span className="text-[10px] text-slate-400 block">فاقد Edge (۰.۰٪)</span>
            <span className="text-sm font-bold text-rose-400">{report.brainsDeniedBoostCount} مغز</span>
          </div>
        </div>
      </div>

      {/* Brain Audits Grid */}
      <div className="space-y-2">
        <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-cyan-400" />
          لیست ممیزی تک‌تک مغزهای سیستم، زمان‌های شکست و مجوز افزایش احتمال
        </span>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {report.audits.map((a: BrainEdgeAudit) => (
            <div
              key={a.brainId}
              className={`p-3.5 rounded-xl border transition-all space-y-2 ${
                a.hasVerifiedEdge
                  ? 'bg-slate-950/60 border-emerald-500/30'
                  : 'bg-slate-950/80 border-slate-800/80'
              }`}
            >
              {/* Card Top Header */}
              <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                <div className="flex items-center gap-2">
                  {a.hasVerifiedEdge ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <Lock className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  )}
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">{a.brainNameFa}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{a.brainCodeName}</span>
                  </div>
                </div>

                <span
                  className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${
                    a.hasVerifiedEdge
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  }`}
                >
                  {a.hasVerifiedEdge ? 'VERIFIED EDGE' : 'BOOST DENIED (0.0%)'}
                </span>
              </div>

              {/* Statistical Proof Metrics */}
              <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
                <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block">اندازه نمونه</span>
                  <span className="font-bold text-slate-200">{a.sampleSize}</span>
                </div>
                <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block">وین‌ریت</span>
                  <span className={`font-bold ${a.winRatePct >= 55 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {a.winRatePct}%
                  </span>
                </div>
                <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block">امید ریاضی</span>
                  <span className={`font-bold ${a.expectancyR > 0.15 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    +{a.expectancyR}R
                  </span>
                </div>
                <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block">P-Value</span>
                  <span className="font-bold text-cyan-300">{a.pValue}</span>
                </div>
              </div>

              {/* Failure Conditions Explanation */}
              <div className="text-[10px] text-slate-400 bg-slate-900/40 p-2 rounded-lg border border-slate-800/60 space-y-1">
                <div>
                  <strong className="text-rose-400">زمان‌های شکست مغز: </strong>
                  {a.failureConditionsFa.join(' | ')}
                </div>
                {a.failureReasonFa && (
                  <div className="text-amber-300 font-medium pt-0.5">
                    <strong>دلیل رد لبه آماری: </strong>
                    {a.failureReasonFa}
                  </div>
                )}
              </div>

              {/* Authority Status Delta */}
              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/60">
                <span className="text-slate-400">افزایش احتمال اولیه vs مجاز:</span>
                <div className="flex items-center gap-2 font-bold">
                  <span className="line-through text-slate-500">+{a.rawProposedProbabilityDeltaPct}%</span>
                  <span className={a.allowedProbabilityBoostPct > 0 ? 'text-emerald-400' : 'text-rose-400 font-black'}>
                    +{a.allowedProbabilityBoostPct.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
