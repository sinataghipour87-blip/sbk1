import React, { useState, useEffect } from 'react';
import {
  Brain,
  Zap,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Activity,
  Layers,
  Flame,
  BarChart2,
  Sliders,
  Cpu,
  RefreshCw,
  Award,
  CheckCircle2
} from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { runUnifiedMultiBrainEnsemble, MultiBrainConsensusReport } from '../services/multiBrainEnsemble';
import { activityFrequencyMonitor, ActivityMonitorReport } from '../services/activityFrequencyMonitor';

interface Props {
  analysis?: any;
  aiPrediction?: any;
  currentPrice?: number;
  recentHistory?: any[];
}

export const TenBrainArchitecturePanel: React.FC<Props> = ({
  analysis,
  aiPrediction,
  currentPrice = 0,
  recentHistory = []
}) => {
  const [report, setReport] = useState<MultiBrainConsensusReport | null>(null);
  const [activityReport, setActivityReport] = useState<ActivityMonitorReport | null>(null);

  useEffect(() => {
    const res = runUnifiedMultiBrainEnsemble(analysis, aiPrediction, currentPrice, recentHistory);
    setReport(res);
  }, [analysis, aiPrediction, currentPrice, recentHistory]);

  useEffect(() => {
    const refreshActivity = () => setActivityReport(activityFrequencyMonitor.evaluateAndMonitor());
    refreshActivity();
    const activityTimer = setInterval(refreshActivity, 15000);
    return () => clearInterval(activityTimer);
  }, []);

  const handleRefreshReport = () => {
    const updated = runUnifiedMultiBrainEnsemble(analysis, aiPrediction, currentPrice, recentHistory);
    setReport(updated);
    setActivityReport(activityFrequencyMonitor.evaluateAndMonitor());
  };

  if (!report) return null;

  return (
    <CollapsibleCard
      title="پردازشگرهای داخلی و اجماع مدل‌ها (غیر از رأی اعضای شورا)"
      badge="گزارش تحلیلی"
      badgeColor="text-indigo-300 bg-indigo-950/80 border-indigo-500/40 shadow-[0_0_12px_rgba(99,102,241,0.3)]"
      defaultOpen={true}
      icon={<Brain className="w-5 h-5 text-indigo-400 animate-pulse" />}
      headerAction={
        <button
          onClick={handleRefreshReport}
          className="px-2.5 py-1 rounded-lg bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/50 text-indigo-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
         type="button">
          <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
          <span>به‌روزرسانی گزارش</span>
        </button>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        {/* Consensus Metric Banner */}
        <div className="bg-[#020917] border border-indigo-500/40 rounded-2xl p-3.5 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-indigo-950">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-500/20 rounded-lg text-indigo-400 border border-indigo-500/30">
                <Cpu className="w-4 h-4 text-indigo-300" />
              </div>
              <div>
                <span className="text-xs font-bold text-white font-sans block">
                  گزارش تشخیصی زیرماژول‌های پردازشی (بدون رأی مستقل شورا):
                </span>
                <span className="text-[10px] text-indigo-300 font-mono mt-0.5 block">
                  ضریب همگرایی: {report.consensusScorePct}٪ | درجه اطمینان: [{report.confidenceGrade}]
                </span>
              </div>
            </div>

            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-sans font-bold flex items-center gap-1 ${
              report.masterDirection === 'LONG' ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50' : 'bg-rose-950 text-rose-300 border-rose-500/50'
            }`}>
              {report.masterDirection === 'LONG' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              <span>جهت خام پردازشگرها: {report.masterDirection} (نه اجماع کالیبره‌شده)</span>
            </span>
          </div>

          {/* 11 Brains Quick Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 my-3 text-[10.5px]">
            <div className="bg-[#041124] p-2 rounded-xl border border-indigo-950 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۱. امتیاز روند heuristic:</span>
              <span className="font-bold text-indigo-300">{report.brain1Macro.scorePct}٪</span>
            </div>
            <div className="bg-[#041124] p-2 rounded-xl border border-indigo-950 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۲. برآورد heuristic از OBI:</span>
              <span className="font-bold text-cyan-300">{report.brain2Liquidity.whaleAggressionScore}/100</span>
            </div>
            <div className="bg-[#041124] p-2 rounded-xl border border-indigo-950 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۳. رژیم GARCH:</span>
              <span className="font-bold text-emerald-300">{report.brain3Volatility.garchRegime}</span>
            </div>
            <div className="bg-[#041124] p-2 rounded-xl border border-indigo-950 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۴. الگوی ۳۰m:</span>
              <span className="font-bold text-amber-300">
                {report.brain4Pattern.patternMatchPct === null ? 'ناموجود' : `${report.brain4Pattern.patternMatchPct}٪`}
              </span>
            </div>
            <div className="bg-[#041124] p-2 rounded-xl border border-indigo-950 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۵. ریسک صفر:</span>
              <span className="font-bold text-emerald-400">تضمین 🟢</span>
            </div>
            <div className="bg-[#041124] p-2 rounded-xl border border-indigo-950 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۶. آن‌چین نهنگ:</span>
              <span className="font-bold text-cyan-300">
                {report.brain6OnChainWhale.onChainScorePct === null
                  ? 'UNAVAILABLE'
                  : `${report.brain6OnChainWhale.onChainScorePct}٪ heuristic`}
              </span>
            </div>
            <div className="bg-[#041124] p-2 rounded-xl border border-indigo-950 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۷. دلتای CVD:</span>
              <span className="font-bold text-indigo-300">
                {report.brain7OrderBookCvd.isEmpiricalMetric
                  ? `${report.brain7OrderBookCvd.cvdDeltaScore ?? 'UNAVAILABLE'}/100`
                  : 'UNAVAILABLE'}
              </span>
            </div>
            <div className="bg-[#041124] p-2 rounded-xl border border-indigo-950 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۸. فاندامنتال کلان:</span>
              <span className="font-bold text-amber-300">
                {report.brain8FundamentalMacro.newsOscillatorScore === null
                  ? 'UNAVAILABLE'
                  : report.brain8FundamentalMacro.newsOscillatorScore}
              </span>
            </div>
            <div className="bg-[#041124] p-2 rounded-xl border border-indigo-950 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۹. احتمال بیزی:</span>
              <span className="font-bold text-cyan-300">
                {report.brain9BayesianProbabilistic.calibratedProbabilityPct === null
                  ? 'UNCALIBRATED'
                  : `${report.brain9BayesianProbabilistic.calibratedProbabilityPct}٪`}
              </span>
            </div>
            <div className="bg-[#041124] p-2 rounded-xl border border-indigo-950 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۱۰. Auto-Pilot:</span>
              <span className="font-bold text-indigo-300">اجرا نشده</span>
            </div>
            <div className="col-span-2 sm:col-span-2 bg-[#041128] p-2 rounded-xl border border-indigo-500/40 text-center">
              <span className="text-[9px] text-slate-400 block font-sans">۱۱. ردیاب دستکاری نهنگ:</span>
              <span className="font-bold text-emerald-400 truncate block">
                {report.brain11OnChainWhaleSentiment?.whaleSentimentBias === 'MANIPULATION_ALERT'
                  ? '⚠️ هشدار heuristic بر پایه OBI'
                  : `برآورد OBI: ${report.brain11OnChainWhaleSentiment?.whaleSentimentBias ?? 'ناموجود'}؛ تراکنش نهنگ: ناموجود`}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-200 leading-relaxed font-sans bg-[#040e21] p-2.5 rounded-xl border border-indigo-900/40">
            {report.learningFeedbackStatusFa}
          </p>

          {/* Legacy display weights do not feed the server signal runner. */}
          <div className="mt-3 pt-3 border-t border-indigo-950 space-y-2">
            <div className="flex items-center justify-between text-xs text-indigo-300 font-bold font-sans">
              <span>وزن‌های نمایشی/سازگاری رابط کاربری:</span>
              <span className="text-[10px] text-slate-400 font-mono">در runner اعمال نمی‌شوند</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5 text-[10px]">
              <div className="bg-[#030712] p-2 rounded-xl border border-indigo-950 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۱ (کلان):</span>
                <span className="font-mono text-cyan-300 font-bold">{(report.dynamicWeights.brain1MacroWeight * 100).toFixed(1)}٪</span>
              </div>
              <div className="bg-[#030712] p-2 rounded-xl border border-indigo-950 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۲ (نقدینگی):</span>
                <span className="font-mono text-cyan-300 font-bold">{(report.dynamicWeights.brain2LiquidityWeight * 100).toFixed(1)}٪</span>
              </div>
              <div className="bg-[#030712] p-2 rounded-xl border border-indigo-950 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۳ (GARCH):</span>
                <span className="font-mono text-cyan-300 font-bold">{(report.dynamicWeights.brain3VolatilityWeight * 100).toFixed(1)}٪</span>
              </div>
              <div className="bg-[#030712] p-2 rounded-xl border border-indigo-950 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۴ (الگو):</span>
                <span className="font-mono text-cyan-300 font-bold">{(report.dynamicWeights.brain4PatternWeight * 100).toFixed(1)}٪</span>
              </div>
              <div className="bg-[#030712] p-2 rounded-xl border border-indigo-950 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۵ (ریسک):</span>
                <span className="font-mono text-cyan-300 font-bold">{(report.dynamicWeights.brain5RiskHedgingWeight * 100).toFixed(1)}٪</span>
              </div>
              <div className="bg-[#030712] p-2 rounded-xl border border-indigo-950 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۶ (آن‌چین):</span>
                <span className="font-mono text-cyan-300 font-bold">{(report.dynamicWeights.brain6OnChainWeight * 100).toFixed(1)}٪</span>
              </div>
              <div className="bg-[#030712] p-2 rounded-xl border border-indigo-950 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۷ (CVD):</span>
                <span className="font-mono text-cyan-300 font-bold">{(report.dynamicWeights.brain7CvdWeight * 100).toFixed(1)}٪</span>
              </div>
              <div className="bg-[#030712] p-2 rounded-xl border border-indigo-950 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۸ (اخبار):</span>
                <span className="font-mono text-cyan-300 font-bold">{(report.dynamicWeights.brain8MacroNewsWeight * 100).toFixed(1)}٪</span>
              </div>
              <div className="bg-[#030712] p-2 rounded-xl border border-indigo-950 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۹ (بیزی):</span>
                <span className="font-mono text-cyan-300 font-bold">{(report.dynamicWeights.brain9BayesianWeight * 100).toFixed(1)}٪</span>
              </div>
              <div className="bg-[#030712] p-2 rounded-xl border border-indigo-950 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۱۰ (Auto-Pilot):</span>
                <span className="font-mono text-cyan-300 font-bold">{(report.dynamicWeights.brain10AutoPilotWeight * 100).toFixed(1)}٪</span>
              </div>
              <div className="col-span-2 bg-[#041220] p-2 rounded-xl border border-indigo-500/30 text-center">
                <span className="text-[9px] text-slate-400 block font-sans">مغز ۱۱ (تراکنش نهنگ):</span>
                <span className="font-mono text-emerald-300 font-bold">{(report.dynamicWeights.brain11WhaleSentimentWeight * 100).toFixed(1)}٪</span>
              </div>
            </div>
          </div>

          {/* Health-Monitor 60s Module Section */}
          <div className="mt-3 pt-3 border-t border-indigo-950 space-y-2">
            <div className="flex items-center justify-between text-xs text-indigo-300 font-bold font-sans">
              <span>پالس‌های ثبت‌شدهٔ پردازشی در ۶۰ ثانیه:</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {activityReport ? `${activityReport.totalExecutions60s} رویداد | ${activityReport.timestamp}` : 'داده در دسترس نیست'}
              </span>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5 text-[10px]">
              {(activityReport?.brains ?? []).map(brain => (
                <div key={brain.brainId} className="p-2 rounded-xl border border-indigo-950 bg-[#030712] text-slate-300 text-center">
                  <div className="font-sans font-bold truncate text-[9.5px]">{brain.nameFa}</div>
                  <div className="font-mono text-cyan-300 mt-0.5">{brain.processedCount60s} پالس</div>
                  <div className="text-[8.5px] text-slate-400 font-mono">{brain.status === 'ACTIVE' ? 'پالس ثبت شده' : 'بدون پالس ثبت شده'}</div>
                </div>
              ))}
            </div>

            <div className="text-[10px] text-slate-400 font-sans">
              این شمارش فقط پالس‌های واقعی ثبت‌شده را نمایش می‌دهد؛ پالس خودکار، امتیاز سلامت یا بازراه‌اندازی شبیه‌سازی نمی‌شود.
            </div>
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
};
