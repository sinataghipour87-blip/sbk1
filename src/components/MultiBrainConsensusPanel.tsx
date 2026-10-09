import React, { useState, useEffect } from 'react';
import {
  Brain,
  Zap,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  Layers,
  Lock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Sliders,
  Target,
  BarChart2,
  Cpu,
  CheckCircle2
} from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { runUnifiedMultiBrainEnsemble, MultiBrainConsensusReport } from '../services/multiBrainEnsemble';

interface Props {
  analysis?: any;
  aiPrediction?: any;
  currentPrice?: number;
  recentHistory?: any[];
}

export const MultiBrainConsensusPanel: React.FC<Props> = ({
  analysis,
  aiPrediction,
  currentPrice = 0,
  recentHistory = []
}) => {
  const [report, setReport] = useState<MultiBrainConsensusReport | null>(null);
  const [isTraining, setIsTraining] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'PIPELINE' | 'MODELS' | 'BRAINS' | 'PROPOSALS'>('PIPELINE');
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(null);

  useEffect(() => {
    const res = runUnifiedMultiBrainEnsemble(analysis, aiPrediction, currentPrice, recentHistory);
    setReport(res);
  }, [analysis, aiPrediction, currentPrice, recentHistory]);

  const handleManualTrain = () => {
    setIsTraining(true);
    setTimeout(() => {
      const updated = runUnifiedMultiBrainEnsemble(analysis, aiPrediction, currentPrice, recentHistory);
      setReport(updated);
      setIsTraining(false);
    }, 1200);
  };

  if (!report) return null;

  return (
    <CollapsibleCard
      title="مرکز اجماع ۲۱ بخش پردازشی و مدل‌های آماری کالیبره‌شده"
      badge="۴ مدل مستقل + ۱۷ پردازشگر ویژگی"
      defaultOpen={true}
      icon={<Brain className="w-5 h-5 text-indigo-400 animate-pulse" />}
      headerAction={
        <div className="flex items-center gap-2">
          <button
            onClick={handleManualTrain}
            disabled={isTraining}
            className="px-2.5 py-1 rounded-lg bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-500/50 text-indigo-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
          >
            <RefreshCw className={`w-3 h-3 text-indigo-400 ${isTraining ? 'animate-spin' : ''}`} />
            <span>{isTraining ? 'در حال همگام‌سازی مدل‌ها...' : 'ارزیابی کالیبراسیون'}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Header Quick Metrics Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 font-mono text-xs">
          {/* Master Direction & Consensus Score */}
          <div className="bg-[#030c1d] border border-indigo-500/40 rounded-xl p-3 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">جهت اجماع مدل‌ها:</span>
              <span className={`text-sm font-black flex items-center gap-1 ${
                report.masterDirection === 'LONG' ? 'text-emerald-400' : report.masterDirection === 'SHORT' ? 'text-rose-400' : 'text-amber-300'
              }`}>
                {report.masterDirection === 'LONG'
                  ? <TrendingUp className="w-4 h-4" />
                  : report.masterDirection === 'SHORT'
                    ? <TrendingDown className="w-4 h-4" />
                    : <AlertTriangle className="w-4 h-4" />}
                <span>{report.masterDirection === 'LONG' ? 'صعودی (LONG)' : report.masterDirection === 'SHORT' ? 'نزولی (SHORT)' : 'توقف (WAIT)'}</span>
              </span>
              <span className="text-[9px] text-indigo-300 block font-sans mt-0.5">
                احتمال اجماع مدل‌ها: {report.consensusScorePct}٪
              </span>
              <span className="text-[9px] text-amber-300 block font-sans mt-0.5">
                ریسک اختلاف مدل‌ها: {report.modelDisagreement.disagreementIndex}٪ · {report.modelDisagreement.verdictFa}
              </span>
            </div>
            <div className="w-11 h-11 rounded-xl bg-indigo-950/80 border border-indigo-500/40 flex items-center justify-center font-bold text-indigo-300">
              {report.consensusScorePct}%
            </div>
          </div>

          {/* Win Rate Forecast */}
          <div className="bg-[#030c1d] border border-cyan-500/40 rounded-xl p-3">
            <span className="text-[10px] text-slate-400 block mb-0.5 font-sans">احتمال برد کالیبره‌شده:</span>
            <div className="text-base font-black text-cyan-300">
              {report.winProbabilityPct !== null ? `${report.winProbabilityPct}٪` : 'نامشخص'}
            </div>
            <span className="text-[9px] text-emerald-400 block font-sans">
              درجه: [{report.confidenceGrade}]
            </span>
          </div>

          {/* Risk Protection */}
          <div className="bg-[#030c1d] border border-emerald-500/40 rounded-xl p-3">
            <span className="text-[10px] text-emerald-400 block mb-0.5 font-sans font-bold flex items-center gap-1">
              <Lock className="w-3 h-3 text-emerald-400" /> محافظت از اصل سرمایه:
            </span>
            <div className="text-xs font-bold text-emerald-300">
              ${report.brain5RiskHedging.riskBreakevenTriggerPrice.toLocaleString()}
            </div>
            <span className="text-[9px] text-slate-400 block font-sans">
              تریلینگ استاپ با بافر کارمزد ۰.۰۵٪
            </span>
          </div>

          {/* Trade Frequency Policy */}
          <div className="bg-[#030c1d] border border-amber-500/40 rounded-xl p-3">
            <span className="text-[10px] text-amber-300 block mb-0.5 font-sans font-bold flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400" /> فرکانس معاملاتی:
            </span>
            <div className="text-xs font-bold text-amber-200">
              ورود فقط با Edge معتبر
            </div>
            <span className="text-[9px] text-slate-400 block font-sans">
              در صورت نبود ستاپ: NO TRADE
            </span>
          </div>
        </div>

        {/* Tab Selection Navigation */}
        <div className="flex border-b border-slate-800 gap-2">
          <button
            onClick={() => setActiveTab('PIPELINE')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer font-sans flex items-center gap-1.5 ${
              activeTab === 'PIPELINE'
                ? 'bg-indigo-950/80 text-indigo-300 border-t border-x border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>معماری پایپ‌لاین</span>
          </button>
          <button
            onClick={() => setActiveTab('MODELS')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer font-sans flex items-center gap-1.5 ${
              activeTab === 'MODELS'
                ? 'bg-indigo-950/80 text-indigo-300 border-t border-x border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>۴ مدل آماری مستقل</span>
          </button>
          <button
            onClick={() => setActiveTab('BRAINS')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer font-sans flex items-center gap-1.5 ${
              activeTab === 'BRAINS'
                ? 'bg-indigo-950/80 text-indigo-300 border-t border-x border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>۲۱ بخش پردازشی</span>
          </button>
          <button
            onClick={() => setActiveTab('PROPOSALS')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer font-sans flex items-center gap-1.5 ${
              activeTab === 'PROPOSALS'
                ? 'bg-indigo-950/80 text-indigo-300 border-t border-x border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>پیشنهادهای اجرایی</span>
          </button>
        </div>

        {/* TAB 1: PIPELINE ARCHITECTURE */}
        {activeTab === 'PIPELINE' && (
          <div className="bg-[#020917] border border-indigo-950 rounded-xl p-4 space-y-4 font-mono">
            <h4 className="text-xs font-bold text-slate-200 font-sans flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              <span>جریان پردازش و کالیبراسیون داده تا احتمال مرکزی:</span>
            </h4>

            <div className="p-3 bg-[#040e21] rounded-xl border border-indigo-900/60 text-xs text-indigo-200 space-y-2">
              <div className="font-bold text-cyan-300 font-sans">
                {report.pipelineArchitecture.pipelineFlowFa}
              </div>
              <p className="text-slate-300 font-sans text-[11px] leading-relaxed">
                تمام خروجی‌های سیستم از طریق کالیبراسیون آماری مستقل محاسبه شده و هیچ عدد دست‌ساز یا ادعای سود تضمینی در محاسبات وجود ندارد.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs pt-1 font-sans">
              <div className="bg-[#040e21] p-2.5 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block">فیدهای داده خام:</span>
                <span className="text-xs font-bold text-indigo-300">{report.pipelineArchitecture.rawDataFeedsCount} فید زنده</span>
              </div>
              <div className="bg-[#040e21] p-2.5 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block">پردازشگرهای ویژگی:</span>
                <span className="text-xs font-bold text-cyan-300">{report.pipelineArchitecture.featureProcessorsCount} ماژول</span>
              </div>
              <div className="bg-[#040e21] p-2.5 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block">مدل‌های پیش‌بینی مستقل:</span>
                <span className="text-xs font-bold text-emerald-400">{report.pipelineArchitecture.statisticalModelsCount} مدل</span>
              </div>
              <div className="bg-[#040e21] p-2.5 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block">روش کالیبراسیون:</span>
                <span className="text-xs font-bold text-amber-300">{report.pipelineArchitecture.calibrationMethod}</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: 4 INDEPENDENT MODELS */}
        {activeTab === 'MODELS' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-sans">
            {report.independentModels.map((m) => (
              <div key={m.modelId} className="bg-[#040e21] border border-indigo-900/60 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-indigo-950 pb-2">
                  <span className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                    <BarChart2 className="w-4 h-4 text-cyan-400" />
                    <span>{m.nameFa}</span>
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                    m.prediction === 'BULLISH'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : m.prediction === 'BEARISH'
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : 'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}>
                    {m.prediction}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1 text-slate-300">
                  <div>احتمال خام: <strong className="text-cyan-300">{m.rawProbabilityPct !== null ? `${m.rawProbabilityPct}٪` : 'نامشخص'}</strong></div>
                  <div>دقت OOS: <strong className="text-emerald-300">{m.historicalPrecisionPct !== null ? `${m.historicalPrecisionPct}٪` : 'UNVALIDATED'}</strong></div>
                  <div>حجم نمونه: <strong className="text-indigo-300">{m.sampleSize}</strong></div>
                  <div>ضریب استقلال (Decorrelation): <strong className="text-amber-300">{(1 - m.correlationWithOtherModels).toFixed(2)}</strong></div>
                  <div>سلامت مدل: <strong className={m.healthState === 'HEALTHY' ? 'text-emerald-300' : 'text-rose-300'}>{m.healthState}</strong></div>
                  <div>وزن Ensemble: <strong className="text-cyan-300">{m.healthState === 'HEALTHY' ? `${(m.effectiveWeight * 100).toFixed(1)}٪` : '۰٪ · خارج از Ensemble'}</strong></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 3: 21 BRAINS DETAILED BREAKDOWN */}
        {activeTab === 'BRAINS' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Brain 1 */}
            <div className="bg-[#040e21] border border-indigo-900/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-indigo-950 pb-2">
                <span className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                  <Brain className="w-4 h-4 text-indigo-400" />
                  <span>{report.brain1Macro.nameFa}</span>
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                  [{report.brain1Macro.brainType}]
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {report.brain1Macro.rationaleFa}
              </p>
              <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-400 pt-1">
                <span>هرست: {report.brain1Macro.hurstExponent}</span>
                <span>امتیاز شواهد اولیه: {report.brain1Macro.rawEvidenceScore}</span>
              </div>
            </div>

            {/* Brain 2 */}
            <div className="bg-[#040e21] border border-indigo-900/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-indigo-950 pb-2">
                <span className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                  <Target className="w-4 h-4 text-cyan-400" />
                  <span>{report.brain2Liquidity.nameFa}</span>
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                  [{report.brain2Liquidity.brainType}]
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {report.brain2Liquidity.rationaleFa}
              </p>
              <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-400 pt-1">
                <span>دیوار OBI: {(report.brain2Liquidity.obiValue * 100).toFixed(1)}٪</span>
                <span>استخر نقدینگی: ${report.brain2Liquidity.liquidityPoolUsd.toLocaleString()}</span>
              </div>
            </div>

            {/* Brain 3 */}
            <div className="bg-[#040e21] border border-indigo-900/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-indigo-950 pb-2">
                <span className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>{report.brain3Volatility.nameFa}</span>
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                  [{report.brain3Volatility.brainType}]
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {report.brain3Volatility.rationaleFa}
              </p>
              <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-400 pt-1">
                <span>استاپ شناور: {report.brain3Volatility.adaptiveTrailingOffsetPct}٪</span>
                <span>پیش‌بینی نوسان: {report.brain3Volatility.volatilityForecastPct}٪</span>
              </div>
            </div>

            {/* Brain 4 */}
            <div className="bg-[#040e21] border border-indigo-900/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-indigo-950 pb-2">
                <span className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>{report.brain4Pattern.nameFa}</span>
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                  [{report.brain4Pattern.brainType}]
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {report.brain4Pattern.rationaleFa}
              </p>
              <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-400 pt-1">
                <span>احتمال چرخش ۳۰m: {report.brain4Pattern.reversal30mProbabilityPct}٪</span>
                <span>انطباق: {report.brain4Pattern.patternMatchPct}%</span>
              </div>
            </div>

            {/* Brain 5 */}
            <div className="bg-[#041228] border border-emerald-500/40 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-emerald-950 pb-2">
                <span className="text-xs font-bold text-emerald-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>{report.brain5RiskHedging.nameFa}</span>
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                  [{report.brain5RiskHedging.brainType}]
                </span>
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">
                {report.brain5RiskHedging.rationaleFa}
              </p>
            </div>

            {/* Brain 15 */}
            <div className="bg-[#040e21] border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-slate-400" />
                  <span>{report.brain15FrequencyPreserver.nameFa}</span>
                </span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700">
                  [PASSIVE MONITOR]
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                {report.brain15FrequencyPreserver.rationaleFa}
              </p>
            </div>
          </div>
        )}

        {/* TAB 4: STRUCTURED PROPOSALS LIST */}
        {activeTab === 'PROPOSALS' && (
          <div className="space-y-2.5 font-sans">
            <span className="text-xs font-bold text-slate-300 block mb-1">
              پیشنهادهای اجرایی اصلاح کالیبراسیون و انطباق با واقعیت بازار:
            </span>
            {report.proposalsListFa.map((prop) => {
              const isExpanded = expandedProposalId === prop.id;
              return (
                <div
                  key={prop.id}
                  className="bg-[#030d1e] border border-indigo-900/60 rounded-xl p-3 transition-all hover:border-indigo-500/50"
                >
                  <div
                    onClick={() => setExpandedProposalId(isExpanded ? null : prop.id)}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <h5 className="text-xs font-bold text-slate-100">{prop.titleFa}</h5>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/80">
                        {prop.status}
                      </span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-2.5 pt-2.5 border-t border-indigo-950 space-y-2 text-xs">
                      <p className="text-slate-300 leading-relaxed">{prop.descriptionFa}</p>
                      <div className="bg-[#020814] p-2 rounded-lg border border-cyan-900/50 text-[11px] text-cyan-300 font-mono">
                        🔥 اثر بر عملکرد: {prop.impactFa}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer Learning Log Banner */}
        <div className="text-[11px] text-indigo-200 bg-indigo-950/40 p-2.5 rounded-xl border border-indigo-900/50 font-sans flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            {report.learningFeedbackStatusFa}
          </span>
          <span className="text-[9px] font-mono text-slate-400">آخرین به روز رسانی: {report.timestamp}</span>
        </div>
      </div>
    </CollapsibleCard>
  );
};
