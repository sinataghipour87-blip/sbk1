import React, { useMemo } from 'react';
import {
  Swords,
  Trophy,
  AlertTriangle,
  Zap,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Activity,
  BarChart3,
  TrendingUp,
  Scale,
  Flame,
  Check,
  X
} from 'lucide-react';
import {
  AnalysisResult,
  CompetitiveScenarioType,
  MarketScenarioCandidate,
  ScenarioCompetitionReport,
} from '../types/trading';
import { runScenarioCompetition, SCENARIO_NAMES_FA } from '../services/scenarioCompetitionEngine';

interface ScenarioCompetitionWidgetProps {
  analysis?: AnalysisResult | null;
  currentPrice: number;
}

export const ScenarioCompetitionWidget: React.FC<ScenarioCompetitionWidgetProps> = ({ analysis, currentPrice }) => {
  const price = currentPrice > 0 ? currentPrice : (analysis?.price ?? 0);

  const report: ScenarioCompetitionReport = useMemo(() => {
    if (analysis?.scenarioCompetitionReport) {
      return analysis.scenarioCompetitionReport;
    }
    const candles = analysis?.rawCandles || analysis?.candles || [];
    return runScenarioCompetition(candles, price, analysis);
  }, [analysis, price]);

  // تعیین استایل تصمیم نهایی
  const getDecisionBadge = (decision: ScenarioCompetitionReport['tradeDecision']) => {
    switch (decision) {
      case 'EXECUTE_WINNING_SCENARIO':
        return {
          label: '🎯 اجرای سناریوی برنده با شواهد کامل',
          style: 'text-emerald-300 bg-emerald-950 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]',
        };
      case 'NO_TRADE_CLOSE_COMPETITION':
        return {
          label: '⛔ NO TRADE (رقابت فشرده ۲ سناریو با اختلاف < ۸٪)',
          style: 'text-amber-300 bg-amber-950 border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.3)]',
        };
      default:
        return {
          label: '⛔ NO TRADE (عدم احراز کامل ۵ شرط شواهد)',
          style: 'text-rose-300 bg-rose-950 border-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.3)]',
        };
    }
  };

  const decisionBadge = getDecisionBadge(report.tradeDecision);

  return (
    <div className="bg-slate-900/90 border border-amber-900/50 rounded-2xl p-4 shadow-2xl text-slate-100 flex flex-col gap-4">
      {/* هدر */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-amber-950/80 border border-amber-500/40 rounded-xl text-amber-400">
            <Swords className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-amber-200 flex items-center gap-2">
              موتور رقابت هم‌زمان ۶ سناریوی بازار (Scenario Competition Engine)
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-amber-950 text-amber-300 border border-amber-800">
                ارزیابی ۵ شرط الزامی Evidence
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              رقابت هم‌زمان سناریوها و انتخاب برنده مشروط به احراز کامل احتمال، امید ریاضی، فاصله اطمینان، انطباق رژیم و نقدینگی
            </p>
          </div>
        </div>

        <div className={`px-3.5 py-1.5 rounded-xl border text-xs font-mono font-black ${decisionBadge.style}`}>
          {decisionBadge.label}
        </div>
      </div>

      {/* خلاصه تحلیلی تصمیم رقابت و وضعیت فاصله ۲ سناریوی برتر */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-400/30 rounded-xl text-amber-300 shrink-0">
            <Trophy className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-300">
                سناریوی پیشتاز برتر:
              </span>
              <span className="text-xs font-black font-mono bg-amber-950 text-amber-200 border border-amber-700 px-2 py-0.5 rounded">
                {report.winningScenario?.scenarioTypeFa || 'نامشخص'}
              </span>
              <span className="text-xs font-mono font-bold text-emerald-400">
                ({report.winningScenario?.evidence.probabilityPct}٪)
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
              {report.verdictFa}
            </p>
          </div>
        </div>

        {/* آمار فاصله رقابت */}
        <div className="flex items-center gap-3 shrink-0 bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 text-xs font-mono">
          <div className="text-right">
            <div className="text-[10px] text-slate-400">سناریوی دوم (Runner-up)</div>
            <div className="font-bold text-slate-300">
              {report.runnerUpScenario?.scenarioTypeFa.split(' ')[0]} ({report.runnerUpScenario?.evidence.probabilityPct}٪)
            </div>
          </div>
          <div className="w-px h-8 bg-slate-800" />
          <div className="text-right">
            <div className="text-[10px] text-slate-400">فاصله رقابتی (Gap)</div>
            <div className={`font-black ${report.probabilityGapPct >= 8 ? 'text-emerald-400' : 'text-rose-400 font-bold animate-pulse'}`}>
              {report.probabilityGapPct}٪ {report.probabilityGapPct < 8 ? '(بسیار نزدیک ⚠️)' : '(شفاف)'}
            </div>
          </div>
        </div>
      </div>

      {/* شبکه ۶ سناریوی رقیب و ارزیابی چک‌لیست ۵ شرط شواهد (Evidence Checklist) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {report.candidates.map((candidate, idx) => {
          const isWinner = report.winningScenario?.scenarioType === candidate.scenarioType;
          const ev = candidate.evidence;

          return (
            <div
              key={candidate.scenarioType}
              className={`p-3 rounded-xl border transition-all flex flex-col justify-between ${
                isWinner
                  ? 'bg-amber-950/30 border-amber-500 shadow-md ring-1 ring-amber-500/50'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-200">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[10px] font-black ${
                      idx === 0 ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                    }`}>
                      #{idx + 1}
                    </span>
                    <span>{candidate.scenarioTypeFa}</span>
                  </div>

                  <span className={`font-mono font-black text-sm px-2 py-0.5 rounded border ${
                    candidate.evidence.probabilityPct >= 55 ? 'text-emerald-300 bg-emerald-950 border-emerald-800' : 'text-slate-400 bg-slate-900 border-slate-800'
                  }`}>
                    {candidate.evidence.probabilityPct}٪
                  </span>
                </div>

                {/* چک‌لیست ۵ شرط الزامی Evidence */}
                <div className="space-y-1.5 text-[10px] font-mono my-2.5">
                  <div className="flex items-center justify-between bg-slate-900/80 px-2 py-1 rounded">
                    <span className="text-slate-400">۱. احتمال وقوع (&gt; 55%):</span>
                    <span className={`font-bold flex items-center gap-1 ${ev.probabilityPct >= 55 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ev.probabilityPct}% {ev.probabilityPct >= 55 ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    </span>
                  </div>

                  <div className="flex items-center justify-between bg-slate-900/80 px-2 py-1 rounded">
                    <span className="text-slate-400">۲. امید ریاضی (&gt; +0.20R):</span>
                    <span className={`font-bold flex items-center gap-1 ${ev.expectedValueR >= 0.20 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ev.expectedValueR > 0 ? `+${ev.expectedValueR}R` : `${ev.expectedValueR}R`} {ev.expectedValueR >= 0.20 ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    </span>
                  </div>

                  <div className="flex items-center justify-between bg-slate-900/80 px-2 py-1 rounded">
                    <span className="text-slate-400">۳. فاصله اطمینان (&ge; 60):</span>
                    <span className={`font-bold flex items-center gap-1 ${ev.confidenceIntervalScore >= 60 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ev.confidenceIntervalScore} {ev.confidenceIntervalScore >= 60 ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    </span>
                  </div>

                  <div className="flex items-center justify-between bg-slate-900/80 px-2 py-1 rounded">
                    <span className="text-slate-400">۴. انطباق رژیم بازار (&ge; 60):</span>
                    <span className={`font-bold flex items-center gap-1 ${ev.regimeFitScore >= 60 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ev.regimeFitScore} {ev.regimeFitScore >= 60 ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    </span>
                  </div>

                  <div className="flex items-center justify-between bg-slate-900/80 px-2 py-1 rounded">
                    <span className="text-slate-400">۵. ساختار نقدینگی/CVD (&ge; 60):</span>
                    <span className={`font-bold flex items-center gap-1 ${ev.liquidityStructureScore >= 60 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ev.liquidityStructureScore} {ev.liquidityStructureScore >= 60 ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    </span>
                  </div>
                </div>
              </div>

              {/* وضعیت شواهد نهایی ۵ گانه */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px]">
                <span className="text-slate-400">احراز کامل شواهد:</span>
                <span className={`px-2 py-0.5 rounded font-mono font-bold border ${
                  candidate.evidencePassed
                    ? 'text-emerald-300 bg-emerald-950 border-emerald-800'
                    : 'text-rose-300 bg-rose-950 border-rose-800'
                }`}>
                  {candidate.evidencePassed ? '✓ تایید کامل (PASSED)' : '✖ رد شواهد (FAILED)'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
