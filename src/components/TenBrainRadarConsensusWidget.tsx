import React, { useState, useEffect } from 'react';
import {
  Cpu,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  Network,
  Sparkles
} from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { runUnifiedMultiBrainEnsemble, MultiBrainConsensusReport } from '../services/multiBrainEnsemble';

interface Props {
  analysis?: any;
  aiPrediction?: any;
  currentPrice?: number;
  recentHistory?: any[];
}

export const TenBrainRadarConsensusWidget: React.FC<Props> = ({
  analysis,
  aiPrediction,
  currentPrice = 0,
  recentHistory = [],
}) => {
  const [report, setReport] = useState<MultiBrainConsensusReport | null>(null);
  const [activeTab, setActiveTab] = useState<'RADAR' | 'HEALTH_GRID' | 'PROPOSALS'>('RADAR');

  useEffect(() => {
    const res = runUnifiedMultiBrainEnsemble(analysis, aiPrediction, currentPrice, recentHistory);
    setReport(res);
  }, [analysis, aiPrediction, currentPrice, recentHistory]);

  const handleRefresh = () => {
    const res = runUnifiedMultiBrainEnsemble(analysis, aiPrediction, currentPrice, recentHistory);
    setReport(res);
  };

  if (!report) return null;

  const hasCalibratedConsensus = report.pipelineArchitecture.statisticalModelsCount >= 2;
  const brainsData = [
    { id: 'b1', nameFa: '۱. روند فرکتالی کلان', details: report.brain1Macro.rationaleFa },
    { id: 'b2', nameFa: '۲. نقدینگی و اردر بوک', details: report.brain2Liquidity.rationaleFa },
    { id: 'b3', nameFa: '۳. نوسان‌سنج GARCH', details: report.brain3Volatility.rationaleFa },
    { id: 'b4', nameFa: '۴. الگوهای ۳۰m و واگرایی', details: report.brain4Pattern.rationaleFa },
    { id: 'b5', nameFa: '۵. مدیریت ریسک', details: report.brain5RiskHedging.rationaleFa },
    { id: 'b6', nameFa: '۶. جریان آن‌چین', details: report.brain6OnChainWhale.rationaleFa },
    { id: 'b7', nameFa: '۷. دلتای سفارشات / CVD', details: report.brain7OrderBookCvd.rationaleFa },
    { id: 'b8', nameFa: '۸. اخبار و فاندامنتال', details: report.brain8FundamentalMacro.rationaleFa },
    { id: 'b9', nameFa: '۹. مدل بیزی', details: report.brain9BayesianProbabilistic.rationaleFa },
    { id: 'b10', nameFa: '۱۰. هماهنگ‌ساز خروج', details: report.brain10AutoPilotHarmonizer.rationaleFa },
    { id: 'b11', nameFa: '۱۱. تراکنش‌های نهنگ', details: report.brain11OnChainWhaleSentiment?.rationaleFa ?? 'داده در دسترس نیست.' },
  ];

  return (
    <CollapsibleCard
      title="گزارش خروجی پردازشگرها و اجماع مدل‌ها"
      badge="نمایش تشخیصی"
      badgeColor="text-cyan-300 bg-cyan-950/80 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
      defaultOpen={true}
      icon={<Network className="w-5 h-5 text-cyan-400 animate-pulse" />}
      headerAction={
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>به‌روزرسانی گزارش</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4 font-mono text-xs">
        {/* Navigation sub-tabs */}
        <div className="grid grid-cols-3 gap-2 bg-[#020917] p-1.5 rounded-xl border border-cyan-950">
          <button
            onClick={() => setActiveTab('RADAR')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'RADAR'
                ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                : 'text-slate-400 hover:text-white bg-[#041124]'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>اجماع تحلیلی</span>
          </button>
          <button
            onClick={() => setActiveTab('HEALTH_GRID')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'HEALTH_GRID'
                ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                : 'text-slate-400 hover:text-white bg-[#041124]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>خروجی پردازشگرها</span>
          </button>
          <button
            onClick={() => setActiveTab('PROPOSALS')}
            className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'PROPOSALS'
                ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                : 'text-slate-400 hover:text-white bg-[#041124]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>پیشنهادها ({report.proposalsListFa.length})</span>
          </button>
        </div>

        {/* Tab 1: Radar Consensus View */}
        {activeTab === 'RADAR' && (
          <div className="bg-[#020917] border border-cyan-500/30 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-cyan-950">
              <div>
                <h4 className="text-white font-bold font-sans text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <span>جهت اجماع مدل‌های کالیبره‌شده: <span className={report.masterDirection === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>[{hasCalibratedConsensus ? report.masterDirection : 'HOLD / INSUFFICIENT DATA'}]</span></span>
                </h4>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                  امتیاز همگرایی خام: {report.consensusScorePct}٪ | احتمال برد کالیبره‌شده: {report.winProbabilityPct !== null ? `${report.winProbabilityPct}٪` : 'نامشخص'}
                </p>
              </div>
              <span className="px-3 py-1 rounded-xl bg-cyan-950/85 text-cyan-300 border border-cyan-500/40 text-xs font-bold">
                درجه اطمینان: {report.confidenceGrade}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {brainsData.map((brain) => (
                <div key={brain.id} className="bg-[#041124] p-3 rounded-xl border border-cyan-950/60 space-y-1.5">
                  <div className="text-slate-200 font-sans font-bold text-xs">{brain.nameFa}</div>
                  <p className="text-[11px] text-slate-300 font-sans leading-relaxed">{brain.details}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 font-sans">این خروجی‌ها امتیاز سلامت، latency، وزن آموخته‌شده یا مجوز اجرای زنده نیستند.</p>
          </div>
        )}

        {/* Tab 2: Health & Latency Grid */}
        {activeTab === 'HEALTH_GRID' && (
          <div className="bg-[#020917] border border-cyan-500/30 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-cyan-950">
              <h4 className="text-white font-bold font-sans text-sm">خلاصهٔ خروجی پردازشگرها</h4>
              <span className="text-[11px] text-slate-400 font-mono">سلامت و latency اندازه‌گیری نمی‌شوند</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-cyan-950 text-cyan-400 font-sans">
                    <th className="py-2 px-3">نام مغز پردازشی</th>
                    <th className="py-2 px-3">خروجی / منبع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cyan-950/40 text-slate-300">
                  {brainsData.map((brain) => (
                    <tr key={brain.id} className="hover:bg-cyan-950/20 transition-all">
                      <td className="py-2.5 px-3 font-sans font-bold text-white">{brain.nameFa}</td>
                      <td className="py-2.5 px-3 font-sans text-slate-300">{brain.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Proposals & Scenario Matrix */}
        {activeTab === 'PROPOSALS' && (
          <div className="bg-[#020917] border border-cyan-500/30 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-cyan-950">
              <h4 className="text-white font-bold font-sans text-sm">پیشنهادهای معماری ({report.proposalsListFa.length})</h4>
              <span className="text-[11px] text-slate-400 font-mono">به‌معنای اجرای سفارش نیست</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[350px] overflow-y-auto pr-1">
              {report.proposalsListFa.map((prop) => (
                <div key={prop.id} className="bg-[#041124] p-3 rounded-xl border border-cyan-950/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white font-sans">{prop.titleFa}</span>
                    <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-[10px] font-mono">
                      {prop.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 font-sans leading-relaxed">{prop.descriptionFa}</p>
                  <div className="text-[10px] text-slate-300 font-mono bg-slate-950/40 p-2 rounded-lg border border-slate-700/40">
                    <strong>اثر مورد انتظار:</strong> {prop.impactFa}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-[#040e21] p-3 rounded-xl border border-cyan-900/40 text-[11px] text-slate-200 leading-relaxed font-sans flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{report.learningFeedbackStatusFa}</span>
        </div>
      </div>
    </CollapsibleCard>
  );
};
